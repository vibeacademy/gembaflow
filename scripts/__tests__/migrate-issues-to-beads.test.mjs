// @vitest-environment node
// Tests for scripts/migrate-issues-to-beads.sh — the generalized fork
// migrator (GitHub issues -> beads).
//
// Two layers, per the E5 DoD:
//   1. Parsing-stage unit tests: the script's pure helpers (priority,
//      effort, dep extraction, external-ref key, ref-prefix option) are
//      exercised by `source`-ing the script (its main() is guarded by a
//      BASH_SOURCE check) and calling the functions directly.
//   2. Offline integration: a throwaway "repo" gets a copy of the script
//      plus stubbed `gh` (pinned issue fixture) and stubbed `bd`
//      (state-recording, crash-injectable). The migrator runs twice — the
//      second run must be a provable no-op — and a mid-run-death case
//      (crash right after a create, before the id-map append) must
//      converge on re-run via external-ref reconciliation.
//
// No gh, no bd, no network. This file MUST run in the "node" environment.
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  copyFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "migrate-issues-to-beads.sh");
const FIXTURES = join(REPO_ROOT, "scripts", "fixtures", "beads-migration");

// ---------------------------------------------------------------------------
// Layer 1 — parsing helpers (source the script, call the function)
// ---------------------------------------------------------------------------

function callHelper(fn, args = [], env = {}) {
  const shellArgs = args.map((_, i) => `"$${i + 1}"`).join(" ");
  const result = spawnSync(
    "bash",
    ["-c", `source "${SCRIPT}"; ${fn} ${shellArgs}`, "bash", ...args],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  return { stdout: result.stdout, status: result.status };
}

describe("parsing helpers", () => {
  it("parse_priority extracts P<k> from a Priority line", () => {
    const body = "Problem Statement:\nStuff.\n\nPriority: P0\nEffort Estimate: M";
    expect(callHelper("parse_priority", [body]).stdout).toBe("0");
  });

  it("parse_priority defaults to 2 when no Priority line exists", () => {
    expect(callHelper("parse_priority", ["no priority here"]).stdout).toBe("2");
  });

  it("parse_priority ignores inline mentions that are not a Priority line", () => {
    expect(callHelper("parse_priority", ["We may bump Priority later.\nPriority: P3 (inherited)"]).stdout).toBe("3");
  });

  it("parse_effort extracts the Effort Estimate token", () => {
    expect(callHelper("parse_effort", ["Effort Estimate: XL\nPriority: P1"]).stdout.trim()).toBe("XL");
  });

  it("parse_effort is empty when absent", () => {
    expect(callHelper("parse_effort", ["Priority: P1"]).stdout).toBe("");
  });

  it("parse_parent_epic extracts the epic number", () => {
    expect(callHelper("parse_parent_epic", ["Parent Epic: #574\nEffort Estimate: M"]).stdout.trim()).toBe("574");
  });

  it("parse_depends_on returns every Depends on line", () => {
    const body = "Depends on: #3\nMiddle text\nDepends on: #7 (soft)";
    expect(callHelper("parse_depends_on", [body]).stdout.trim().split("\n")).toEqual(["3", "7"]);
  });

  it("parse_blocks returns Blocks targets", () => {
    expect(callHelper("parse_blocks", ["Blocks: #12"]).stdout.trim()).toBe("12");
  });

  it("issue_type maps epic flag, bug label, and default task", () => {
    expect(callHelper("issue_type", ["enhancement", "1"]).stdout).toBe("epic");
    expect(callHelper("issue_type", ["bug,effort:S", "0"]).stdout).toBe("bug");
    expect(callHelper("issue_type", ["enhancement", "0"]).stdout).toBe("task");
  });

  it("external_ref uses the default gh- prefix", () => {
    const r = spawnSync("bash", ["-c", `source "${SCRIPT}"; external_ref 42`], {
      encoding: "utf8",
    });
    expect(r.stdout).toBe("gh-42");
  });

  it("external_ref honors a repo-qualified --ref-prefix (meta-board collision guard)", () => {
    const r = spawnSync(
      "bash",
      ["-c", `source "${SCRIPT}"; REF_PREFIX="gh-gembaflow-"; external_ref 42`],
      { encoding: "utf8" },
    );
    expect(r.stdout).toBe("gh-gembaflow-42");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — offline integration (stub gh + stub bd)
// ---------------------------------------------------------------------------

/** Builds a throwaway migrator "repo" with stub gh/bd first on PATH. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "migrate-beads-test-"));
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(root, ".beads"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "state"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts", "migrate-issues-to-beads.sh"));
  copyFileSync(join(REPO_ROOT, "scripts", "check-bd.sh"), join(root, "scripts", "check-bd.sh"));
  copyFileSync(
    join(REPO_ROOT, "scripts", "lib", "bd-version.sh"),
    join(root, "scripts", "lib", "bd-version.sh"),
  );
  symlinkSync(join(FIXTURES, "stub-bd.sh"), join(root, "bin", "bd"));
  symlinkSync(join(FIXTURES, "stub-gh.sh"), join(root, "bin", "gh"));
  return root;
}

function runMigrator(root, args, env = {}) {
  const result = spawnSync("bash", [join(root, "scripts", "migrate-issues-to-beads.sh"), ...args], {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      BD_STUB_STATE: join(root, "state"),
      GH_STUB_FIXTURE: join(FIXTURES, "issues.json"),
      GH_STUB_LOG: join(root, "gh-invocations.log"),
      ...env,
    },
  });
  return { ...result, all: `${result.stdout}\n${result.stderr}` };
}

function idMap(root) {
  const p = join(root, "reports", "beads-migration", "id-map.tsv");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean) : [];
}

function stubBeads(root) {
  const p = join(root, "state", "beads.tsv");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean) : [];
}

describe("migrator integration (stubbed gh + bd)", () => {
  let root;
  beforeEach(() => {
    root = makeRepo();
  });

  it("dry-run plans all 8 fixture issues and creates nothing", () => {
    const r = runMigrator(root, []);
    expect(r.status).toBe(0);
    expect(r.all).toContain("exported 8 open issues (2 epics)");
    expect((r.all.match(/would create:/g) || []).length).toBe(8);
    expect(stubBeads(root).length).toBe(0);
    expect(idMap(root).length).toBe(0);
  });

  it("--execute migrates epics first, carries priority/effort/labels, wires deps", () => {
    const r = runMigrator(root, ["--execute"]);
    expect(r.status).toBe(0);
    expect(stubBeads(root).length).toBe(8);
    expect(idMap(root).length).toBe(8);

    // Epics pass runs before tasks: fixture epics 101/102 get the first ids.
    const beads = stubBeads(root).map((l) => l.split("\t"));
    expect(beads[0]).toEqual(["gh-101", "tb-1", "epic", "1", "enhancement"]);
    expect(beads[1][2]).toBe("epic");

    // Priority + effort + label carry (issue 103: P0, effort:M).
    const signup = beads.find((b) => b[0] === "gh-103");
    expect(signup[3]).toBe("0");
    expect(signup[4]).toContain("effort:M");
    expect(signup[4]).toContain("enhancement");

    // Bug typing from the bug label (issue 105).
    expect(beads.find((b) => b[0] === "gh-105")[2]).toBe("bug");

    // Space-containing label survives as one argument (issue 108).
    expect(beads.find((b) => b[0] === "gh-108")[4]).toContain("good first issue");

    // Dep wiring: 104 blocked-by 103; 106 Blocks 107 -> 107 blocked-by 106.
    const deps = readFileSync(join(root, "state", "deps.tsv"), "utf8");
    const ids = Object.fromEntries(beads.map((b) => [b[0], b[1]]));
    expect(deps).toContain(`${ids["gh-104"]}\t${ids["gh-103"]}`);
    expect(deps).toContain(`${ids["gh-107"]}\t${ids["gh-106"]}`);

    // Parenting: 103/104 under 101; 106/107 under 102.
    const parents = readFileSync(join(root, "state", "parents.tsv"), "utf8");
    expect(parents).toContain(`${ids["gh-103"]}\t${ids["gh-101"]}`);
    expect(parents).toContain(`${ids["gh-106"]}\t${ids["gh-102"]}`);

    expect(r.all).toContain("run summary: created 8, skipped 0");
  });

  it("second run is a provable no-op (idempotent by external-ref)", () => {
    expect(runMigrator(root, ["--execute"]).status).toBe(0);
    const mapAfterFirst = idMap(root).join("\n");
    const r2 = runMigrator(root, ["--execute"]);
    expect(r2.status).toBe(0);
    expect(r2.all).toContain("run summary: created 0, skipped 8");
    expect(stubBeads(root).length).toBe(8);
    expect(idMap(root).join("\n")).toBe(mapAfterFirst);
  });

  it("mid-run death after the epic stage converges on re-run", () => {
    // Crash on create #2: the second epic exists in bd state but never
    // reaches the id-map — the worst-case death window.
    const r1 = runMigrator(root, ["--execute"], { BD_STUB_DIE_AFTER_CREATES: "2" });
    expect(r1.status).not.toBe(0);
    expect(stubBeads(root).length).toBe(2);
    expect(idMap(root).length).toBe(1); // gh-102 was created but not indexed

    const r2 = runMigrator(root, ["--execute"]);
    expect(r2.status).toBe(0);
    // Reconciliation recovered gh-102 from bd state instead of duplicating it.
    expect(r2.all).toContain("reconciled: gh-102");
    expect(r2.all).toContain("run summary: created 6, skipped 2");
    expect(stubBeads(root).length).toBe(8);
    expect(idMap(root).length).toBe(8);

    // And a third run is the converged no-op.
    const r3 = runMigrator(root, ["--execute"]);
    expect(r3.status).toBe(0);
    expect(r3.all).toContain("run summary: created 0, skipped 8");
    expect(stubBeads(root).length).toBe(8);
  });

  it("--ref-prefix repo-qualifies the idempotency key end to end", () => {
    const r = runMigrator(root, ["--execute", "--ref-prefix", "gh-gembaflow-"]);
    expect(r.status).toBe(0);
    expect(stubBeads(root)[0].startsWith("gh-gembaflow-101\t")).toBe(true);
    expect(idMap(root)[0].startsWith("gh-gembaflow-101\t")).toBe(true);
    // Verification counts only beads under the active prefix.
    expect(r.all).toContain("count OK: 8 beads for 8 issues (prefix gh-gembaflow-)");
  });

  it("--repo routes every gh call through -R <owner/repo>", () => {
    const r = runMigrator(root, ["--execute", "--close-github", "--repo", "acme/widgets"]);
    expect(r.status).toBe(0);
    const ghLog = readFileSync(join(root, "gh-invocations.log"), "utf8");
    const lines = ghLog.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^gh -R acme\/widgets /);
    }
  });

  it("--close-github closes each migrated issue and files a signpost", () => {
    const r = runMigrator(root, ["--close-github"]);
    expect(r.status).toBe(0);
    const ghLog = readFileSync(join(root, "gh-invocations.log"), "utf8");
    expect((ghLog.match(/issue close/g) || []).length).toBe(8);
    expect((ghLog.match(/issue comment/g) || []).length).toBe(8);
    expect(ghLog).toContain("issue create");
    expect(r.all).toContain("signpost issue:");
  });

  it("--export-file skips the gh export and runs offline", () => {
    const r = runMigrator(root, ["--execute", "--export-file", join(FIXTURES, "issues.json")], {
      // Poison the gh fixture: with --export-file, gh must never be asked.
      GH_STUB_FIXTURE: "/nonexistent/fixture.json",
    });
    expect(r.status).toBe(0);
    expect(stubBeads(root).length).toBe(8);
  });
});
