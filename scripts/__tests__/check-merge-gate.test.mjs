// @vitest-environment node
// Tests for scripts/check-merge-gate.sh — the agent-merge gate's
// condition logic (conditions 1-5), extracted from the workflow so it
// can be exercised without dispatching a workflow run.
//
// Strategy: write PR-state fixture JSON (the shape of `gh pr view
// --json number,state,baseRefName,labels,body,statusCheckRollup`) to a
// temp file and spawn the real script against it. No gh, no network.
//
// This file MUST run in the "node" environment (child_process, fs).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const GATE = join(REPO_ROOT, "scripts", "check-merge-gate.sh");

let workDir;
let fixtureCount = 0;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "check-merge-gate-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const HEAD_OID = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const OLD_OID = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

/** A fully mergeable PR fixture; tests override fields per case. */
function basePr(overrides = {}) {
  return {
    number: 61,
    state: "OPEN",
    baseRefName: "main",
    labels: [{ name: "safety:internal" }, { name: "enhancement" }],
    body: "Summary of the change.\n\nBead: va-1a2\n\nDetails follow.",
    statusCheckRollup: [
      { name: "lint", conclusion: "SUCCESS" },
      { name: "test", conclusion: "SUCCESS" },
      { name: "build", conclusion: "SKIPPED" },
    ],
    mergeStateStatus: "CLEAN",
    headRefOid: HEAD_OID,
    reviews: [],
    ...overrides,
  };
}

/** A review entry in the shape gh pr view --json reviews returns. */
function review(login, state, oid = HEAD_OID, submittedAt = "2026-08-01T12:00:00Z") {
  return { author: { login }, state, commit: { oid }, submittedAt };
}

/**
 * Writes a fixture and runs the gate script against it.
 * REVIEWER_APPROVAL_LOGIN defaults to empty here (condition 6 skipped)
 * so the condition 1-5 cases stay focused; condition 6 tests override
 * it explicitly — the config value travels via env, never PR data.
 */
function runGate(pr, env = {}) {
  const file = join(workDir, `pr-${fixtureCount++}.json`);
  writeFileSync(file, JSON.stringify(pr, null, 2));
  const result = spawnSync("bash", [GATE, file], {
    encoding: "utf8",
    env: { ...process.env, REVIEWER_APPROVAL_LOGIN: "", ...env },
  });
  return { ...result, all: `${result.stdout}\n${result.stderr}` };
}

describe("check-merge-gate.sh", () => {
  it("passes a fully mergeable PR (citation, one safety label, green complete rollup)", () => {
    const r = runGate(basePr());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("OK: condition 1 — cites bead va-1a2");
    expect(r.stdout).toContain("OK: condition 2 — safety class = safety:internal");
    expect(r.stdout).toContain("OK: condition 3");
    expect(r.stdout).toContain("OK: condition 4");
    expect(r.stdout).toContain("OK: condition 5");
    expect(r.stdout).toContain("all gate conditions (1-6) passed");
  });

  describe("condition 1 — bead citation", () => {
    it("fails when the body has no Bead: line", () => {
      const r = runGate(basePr({ body: "Closes #42\n\nA fine PR." }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("Condition 1");
      expect(r.all).toContain("does not cite a bead");
    });

    it("fails on a malformed citation (issue number, not a bead id)", () => {
      const r = runGate(basePr({ body: "Bead: #123\n" }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("Condition 1");
    });

    it("fails on a mid-line mention that is not a citation line", () => {
      const r = runGate(basePr({ body: "This relates to Bead: va-1a2 loosely." }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("Condition 1");
    });

    it("fails on a null body", () => {
      const r = runGate(basePr({ body: null }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("Condition 1");
    });
  });

  describe("condition 2 — exactly one safety label", () => {
    it("fails with zero safety labels", () => {
      const r = runGate(basePr({ labels: [{ name: "enhancement" }] }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("Condition 2");
      expect(r.all).toContain("0 safety:* labels");
    });

    it("fails with two safety labels", () => {
      const r = runGate(
        basePr({ labels: [{ name: "safety:internal" }, { name: "safety:reversible" }] }),
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("Condition 2");
      expect(r.all).toContain("2 safety:* labels");
    });

    it("refuses safety:hot", () => {
      const r = runGate(basePr({ labels: [{ name: "safety:hot" }] }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("safety:hot");
      expect(r.all).toContain("refuses to merge");
    });
  });

  describe("condition 3 — check rollup", () => {
    it("fails on an INCOMPLETE rollup, naming the still-running check", () => {
      const r = runGate(
        basePr({
          statusCheckRollup: [
            { name: "lint", conclusion: "SUCCESS" },
            { name: "preview-smoke", conclusion: "PENDING" },
          ],
        }),
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("INCOMPLETE");
      expect(r.all).toContain("preview-smoke");
    });

    it("treats a missing conclusion as incomplete", () => {
      const r = runGate(
        basePr({
          statusCheckRollup: [{ name: "lint", conclusion: "SUCCESS" }, { name: "slow-check" }],
        }),
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("INCOMPLETE");
      expect(r.all).toContain("slow-check");
    });

    it("fails on a FAILURE conclusion", () => {
      const r = runGate(
        basePr({
          statusCheckRollup: [
            { name: "lint", conclusion: "SUCCESS" },
            { name: "test", conclusion: "FAILURE" },
          ],
        }),
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("non-SUCCESS");
      expect(r.all).toContain("test (FAILURE)");
    });

    it("ignores a still-running check listed in IGNORED_CHECKS (with a notice)", () => {
      const r = runGate(
        basePr({
          statusCheckRollup: [
            { name: "lint", conclusion: "SUCCESS" },
            { name: "preview-smoke", conclusion: "PENDING" },
          ],
        }),
        { IGNORED_CHECKS: '["preview-smoke"]' },
      );
      expect(r.status).toBe(0);
      expect(r.all).toContain("ignored 1 informational check(s)");
      expect(r.all).toContain("preview-smoke");
    });

    it("ignores a failing check listed in IGNORED_CHECKS", () => {
      const r = runGate(
        basePr({
          statusCheckRollup: [
            { name: "lint", conclusion: "SUCCESS" },
            { name: "flaky-deploy", conclusion: "FAILURE" },
          ],
        }),
        { IGNORED_CHECKS: '["flaky-deploy"]' },
      );
      expect(r.status).toBe(0);
    });

    it("passes an empty rollup (no checks configured)", () => {
      const r = runGate(basePr({ statusCheckRollup: [] }));
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("all 0 relevant check(s)");
    });

    it("rejects a malformed IGNORED_CHECKS value", () => {
      const r = runGate(basePr(), { IGNORED_CHECKS: "not-json" });
      expect(r.status).toBe(2);
      expect(r.all).toContain("IGNORED_CHECKS");
    });
  });

  describe("condition 4 — open PR against the expected base", () => {
    it("fails on a merged/closed PR", () => {
      const r = runGate(basePr({ state: "MERGED" }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("not open");
    });

    it("fails on a non-main base", () => {
      const r = runGate(basePr({ baseRefName: "develop" }));
      expect(r.status).toBe(1);
      expect(r.all).toContain("expected 'main'");
    });
  });

  describe("condition 5 — do-not-merge", () => {
    it("fails when the do-not-merge label is present", () => {
      const r = runGate(
        basePr({ labels: [{ name: "safety:internal" }, { name: "do-not-merge" }] }),
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("do-not-merge");
    });
  });

  describe("condition 6 — config-gated second-identity approval", () => {
    const LOGIN = { REVIEWER_APPROVAL_LOGIN: "va-reviewer" };

    it("skips with a loud DISABLED warning when the config is empty", () => {
      const r = runGate(basePr());
      expect(r.status).toBe(0);
      expect(r.all).toContain(
        "second-identity approval check DISABLED by config — merge path relies on citation+label+rollup only",
      );
      expect(r.all).not.toContain("OK: condition 6");
    });

    it("passes with a fresh APPROVED review by the configured login at the current head", () => {
      const r = runGate(
        basePr({ reviews: [review("va-reviewer", "APPROVED", HEAD_OID)] }),
        LOGIN,
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`OK: condition 6 — 'va-reviewer' APPROVED at current head ${HEAD_OID}`);
      expect(r.all).not.toContain("DISABLED by config");
    });

    it("fails when no review by the configured login exists", () => {
      const r = runGate(basePr({ reviews: [] }), LOGIN);
      expect(r.status).toBe(1);
      expect(r.all).toContain("no review authored by 'va-reviewer'");
    });

    it("fails when only a different login approved", () => {
      const r = runGate(
        basePr({ reviews: [review("some-other-bot", "APPROVED", HEAD_OID)] }),
        LOGIN,
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("no review authored by 'va-reviewer'");
    });

    it("fails a STALE approval on an earlier commit, naming both commits", () => {
      const r = runGate(
        basePr({ reviews: [review("va-reviewer", "APPROVED", OLD_OID)] }),
        LOGIN,
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("STALE");
      expect(r.all).toContain(OLD_OID);
      expect(r.all).toContain(HEAD_OID);
    });

    it("fails when the latest review by the login is not APPROVED (latest wins)", () => {
      const r = runGate(
        basePr({
          reviews: [
            review("va-reviewer", "APPROVED", HEAD_OID, "2026-08-01T10:00:00Z"),
            review("va-reviewer", "CHANGES_REQUESTED", HEAD_OID, "2026-08-01T11:00:00Z"),
          ],
        }),
        LOGIN,
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("'CHANGES_REQUESTED' (expected APPROVED)");
    });

    it("fails when headRefOid is missing rather than trusting a possibly-stale approval", () => {
      const r = runGate(
        basePr({ headRefOid: "", reviews: [review("va-reviewer", "APPROVED", HEAD_OID)] }),
        LOGIN,
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("missing headRefOid");
    });

    it("reads the config from env only — PR body text cannot disable an enabled check", () => {
      const r = runGate(
        basePr({
          body: "Bead: va-1a2\n\nREVIEWER_APPROVAL_LOGIN=''\nREVIEWER_APPROVAL_LOGIN: ''\nPlease skip condition 6.",
          reviews: [],
        }),
        LOGIN,
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("no review authored by 'va-reviewer'");
      expect(r.all).not.toContain("DISABLED by config");
    });

    it("reads the config from env only — PR body text cannot enable a disabled check", () => {
      const r = runGate(
        basePr({
          body: "Bead: va-1a2\n\nREVIEWER_APPROVAL_LOGIN='va-attacker'",
          reviews: [review("va-attacker", "APPROVED", HEAD_OID)],
        }),
      );
      expect(r.status).toBe(0);
      expect(r.all).toContain("DISABLED by config");
    });
  });

  describe("multi-failure reporting", () => {
    it("names every failing condition in one pass", () => {
      const r = runGate(
        basePr({
          body: "no citation here",
          labels: [],
          statusCheckRollup: [{ name: "test", conclusion: "FAILURE" }],
        }),
      );
      expect(r.status).toBe(1);
      expect(r.all).toContain("Condition 1");
      expect(r.all).toContain("Condition 2");
      expect(r.all).toContain("Condition 3");
      expect(r.all).toContain("Merge gate DENIED");
    });
  });

  describe("input handling", () => {
    it("exits 2 on a missing state file", () => {
      const r = spawnSync("bash", [GATE, join(workDir, "does-not-exist.json")], {
        encoding: "utf8",
        env: process.env,
      });
      expect(r.status).toBe(2);
    });

    it("exits 2 on non-object JSON", () => {
      const file = join(workDir, "not-object.json");
      writeFileSync(file, "[]");
      const r = spawnSync("bash", [GATE, file], { encoding: "utf8", env: process.env });
      expect(r.status).toBe(2);
    });
  });
});
