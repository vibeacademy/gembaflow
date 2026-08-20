// @vitest-environment node
// Tests for scripts/lib/ruleset-probe.sh — the token-capability probe that
// guards Phase-4 ruleset POST in bootstrap.sh.
//
// Strategy: spawn a minimal wrapper script that sources ruleset-probe.sh and
// calls gembaflow_ruleset_probe, with a controlled PATH containing a stub `gh`
// binary that simulates each scenario. No real GitHub API is called.
//
// Branches under test:
//   Happy path  — probe returns 0 (gh api rulesets exits 0) → caller may POST
//   Branch 1    — probe 403 + user NOT admin → role error
//   Branch 2    — probe 403 + user IS admin + CODESPACES=true → token-scope wall
//   Branch 3    — probe 403 + user IS admin + CODESPACES unset → generic 403 fallback

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const PROBE_LIB = join(REPO_ROOT, "scripts", "lib", "ruleset-probe.sh");

// Thin wrapper that sources the lib and calls the probe, then exits with its
// return code.  Written to a temp file at test time so we can parametrize
// without embedding huge heredocs.
const WRAPPER = `#!/bin/bash
source "${PROBE_LIB}"
gembaflow_ruleset_probe "$1"
exit $?
`;

let workDir;

/**
 * Build a stub `gh` binary for the given scenario.
 *
 * Scenarios drive two call sites the probe makes:
 *   1. gh api repos/{slug}/rulesets        → probe call (exit 0 or 1)
 *   2. gh api user --jq .login             → current user lookup
 *   3. gh api repos/{slug}/collaborators/{user}/permission --jq .permission
 *
 * @param {object} opts
 * @param {boolean} opts.probeSuccess   - true → probe exits 0 (happy path)
 * @param {string}  opts.userLogin      - value returned for `gh api user`
 * @param {string}  opts.userPermission - value for the collaborator permission call
 */
function makeGhStub(opts) {
  const dir = mkdtempSync(join(workDir, "stub-"));
  const { probeSuccess = false, userLogin = "octocat", userPermission = "admin" } = opts;

  // The stub dispatches on the argument pattern.
  // - "api repos/.*/rulesets" with no --method or --jq → probe call
  // - "api user" → current user
  // - "api repos/.*/collaborators/.*" → permission check
  const probeExit = probeSuccess ? 0 : 1;
  const probeStderr = probeSuccess ? "" : "HTTP 403: Resource not accessible by integration";

  const body = `#!/bin/bash
# Stub gh binary for ruleset-probe tests
# Argument inspection (positional, not parsed):
case "$*" in
  "api user --jq .login")
    echo "${userLogin}"
    exit 0
    ;;
  api\\ repos/*/rulesets\\ --jq\\ length|\
  api\\ repos/*/rulesets\\ --jq\\ 'length')
    # This form is used by the existing-rulesets check, not the probe.
    echo "0"
    exit 0
    ;;
  api\\ repos/*/rulesets)
    # Capability probe — no extra flags
    if [ "${probeExit}" -eq 0 ]; then
      exit 0
    else
      echo "${probeStderr}" >&2
      exit 1
    fi
    ;;
  api\\ repos/*/collaborators/*/permission\\ --jq\\ .permission)
    echo "${userPermission}"
    exit 0
    ;;
  *)
    # Unrecognised call — fail loudly so tests surface unexpected usage.
    echo "STUB: unhandled gh call: $*" >&2
    exit 1
    ;;
esac
`;
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, body);
  chmodSync(ghPath, 0o755);
  return dir;
}

/** Run the probe wrapper with a controlled PATH and optional env overrides. */
function runProbe(stubDir, repoSlug = "owner/repo", extraEnv = {}) {
  const wrapperPath = join(workDir, "run-probe.sh");
  writeFileSync(wrapperPath, WRAPPER);
  chmodSync(wrapperPath, 0o755);

  const res = spawnSync("/bin/bash", [wrapperPath, repoSlug], {
    encoding: "utf8",
    env: {
      PATH: [stubDir, "/usr/bin", "/bin"].join(":"),
      HOME: workDir,
      // CODESPACES is unset by default; tests that need it pass it via extraEnv
      ...extraEnv,
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "ruleset-probe-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("gembaflow_ruleset_probe", () => {
  it("returns 0 when the probe call exits 0 (token has administration:read)", () => {
    const stubDir = makeGhStub({ probeSuccess: true });
    const { status } = runProbe(stubDir);
    expect(status).toBe(0);
  });

  it("returns 1 when probe 403 and user is not admin (branch 1 — role error)", () => {
    const stubDir = makeGhStub({
      probeSuccess: false,
      userLogin: "notadmin",
      userPermission: "write",
    });
    const { status, stdout } = runProbe(stubDir);
    expect(status).toBe(1);
    // Branch 1 message: mentions the role and suggests asking the owner
    expect(stdout).toContain("your role on this repo is");
    expect(stdout).toContain("admin access");
    // Must NOT mention Codespaces token-scope wall
    expect(stdout).not.toContain("Codespaces token");
    expect(stdout).not.toContain("installation token");
  });

  it("returns 1 and emits Codespaces UX when probe 403 + admin + CODESPACES=true (branch 2)", () => {
    const stubDir = makeGhStub({
      probeSuccess: false,
      userLogin: "codespacesuser",
      userPermission: "admin",
    });
    const { status, stdout } = runProbe(stubDir, "owner/repo", { CODESPACES: "true" });
    expect(status).toBe(1);
    // Branch 2 message: calm, actionable, no raw 403 dump
    expect(stdout).toContain("Codespaces token scope wall");
    expect(stdout).toContain("repo,workflow");
    expect(stdout).toContain("docs/codespaces-secrets.md");
    // Must NOT include project scope in the suggested scopes
    expect(stdout).not.toMatch(/repo,workflow,project/);
    expect(stdout).not.toMatch(/project,/);
    // Must NOT mention branch 1 role error
    expect(stdout).not.toContain("your role on this repo is");
  });

  it("branch 2 suggests admin:org only for org context, not as default scope", () => {
    const stubDir = makeGhStub({
      probeSuccess: false,
      userLogin: "codespacesuser",
      userPermission: "admin",
    });
    const { stdout } = runProbe(stubDir, "owner/repo", { CODESPACES: "true" });
    // admin:org is mentioned but only as an addendum for org forks
    expect(stdout).toContain("admin:org");
    // The primary scope suggestion is repo,workflow (without project)
    expect(stdout).toContain("repo,workflow");
  });

  it("returns 1 and emits generic 403 fallback when probe fails + admin + no CODESPACES (branch 3)", () => {
    const stubDir = makeGhStub({
      probeSuccess: false,
      userLogin: "localuser",
      userPermission: "admin",
    });
    // CODESPACES deliberately absent
    const { status, stdout } = runProbe(stubDir, "owner/repo", {});
    expect(status).toBe(1);
    // Branch 3: generic manual fallback, no Codespaces mention
    expect(stdout).toContain("403");
    expect(stdout).toContain("Manual fallback");
    expect(stdout).not.toContain("Codespaces token scope wall");
    expect(stdout).not.toContain("your role on this repo is");
  });

  it("happy path emits nothing to stdout (caller handles success silently)", () => {
    const stubDir = makeGhStub({ probeSuccess: true });
    const { status, stdout } = runProbe(stubDir);
    expect(status).toBe(0);
    // The probe itself prints nothing on success; bootstrap.sh prints the
    // "probing..." status line before calling it.
    expect(stdout.trim()).toBe("");
  });
});
