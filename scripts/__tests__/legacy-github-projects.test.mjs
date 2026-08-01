// @vitest-environment node
// Tests for scripts/lib/legacy-github-projects.sh — the DEPRECATED
// GitHub-Projects compatibility flag reader (default OFF; removal
// tracked in vibeacademy/gembaflow#587).
//
// Both flag positions are exercised, plus the deprecation-warning
// contract: every read of an ENABLED flag warns on stderr.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const LIB = join(REPO_ROOT, "scripts", "lib", "legacy-github-projects.sh");

let workDir;
let n = 0;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "legacy-projects-flag-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runFlag(configJson) {
  let configPath = join(workDir, `absent-${n++}.json`); // deliberately missing
  if (configJson !== null) {
    configPath = join(workDir, `config-${n++}.json`);
    writeFileSync(configPath, configJson);
  }
  const result = spawnSync(
    "bash",
    [
      "-c",
      `source "${LIB}"; if gembaflow_legacy_github_projects_enabled; then echo ENABLED; else echo DISABLED; fi`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GEMBAFLOW_LEGACY_PROJECTS_CONFIG: configPath },
    },
  );
  return result;
}

describe("legacy-github-projects flag helper", () => {
  it("defaults OFF when the config file does not exist", () => {
    const r = runFlag(null);
    expect(r.stdout.trim()).toBe("DISABLED");
    expect(r.stderr).toBe("");
  });

  it("is OFF when legacy.githubProjects is absent from the config", () => {
    const r = runFlag(JSON.stringify({ org: "acme", bot: { worker: "w", reviewer: "r" } }));
    expect(r.stdout.trim()).toBe("DISABLED");
    expect(r.stderr).toBe("");
  });

  it("is OFF when legacy.githubProjects is explicitly false", () => {
    const r = runFlag(JSON.stringify({ legacy: { githubProjects: false } }));
    expect(r.stdout.trim()).toBe("DISABLED");
  });

  it("is ON when legacy.githubProjects is true — and warns about deprecation", () => {
    const r = runFlag(JSON.stringify({ legacy: { githubProjects: true } }));
    expect(r.stdout.trim()).toBe("ENABLED");
    expect(r.stderr).toContain("DEPRECATION");
    expect(r.stderr).toContain("#587");
    expect(r.stderr).toContain("migrate-issues-to-beads.sh");
  });

  it("treats malformed JSON as OFF (fails closed to the beads path)", () => {
    const r = runFlag("{not json");
    expect(r.stdout.trim()).toBe("DISABLED");
  });
});
