// @vitest-environment node
// Tests for scripts/check-bd.sh — the bd (beads) version gate — and for
// scripts/lib/bd-version.sh, the single source of truth for the pin.
//
// Strategy: spawn the real gate script with a controlled PATH containing a
// stub `bd` executable, so no real bd install is required (or touched).
// The pinned version is read from scripts/lib/bd-version.sh at test time so
// these tests never drift from the pin.
//
// This file MUST run in the "node" environment (child_process, fs).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const GATE = join(REPO_ROOT, "scripts", "check-bd.sh");
const VERSION_LIB = join(REPO_ROOT, "scripts", "lib", "bd-version.sh");

/** The pinned version, parsed from the one canonical constant. */
function pinnedVersion() {
  const src = readFileSync(VERSION_LIB, "utf8");
  const m = src.match(/^GEMBAFLOW_BD_VERSION="([^"]+)"$/m);
  if (!m) throw new Error("GEMBAFLOW_BD_VERSION not found in scripts/lib/bd-version.sh");
  return m[1];
}

let workDir;

/**
 * Create a directory containing a stub `bd`.
 * mode:
 *   - "version": reports the given version via `bd version --json`
 *   - "no-json": errors on `bd version --json` (simulates a pre---json bd)
 */
function stubBdDir(mode, version = "") {
  const dir = mkdtempSync(join(workDir, "stub-"));
  let body;
  if (mode === "no-json") {
    body = '#!/bin/sh\necho "bd version ancient" \nexit 1\n';
  } else {
    body = [
      "#!/bin/sh",
      'if [ "$1" = "version" ] && [ "$2" = "--json" ]; then',
      `  printf '{\\n  "branch": "v${version}",\\n  "build": "test-stub",\\n  "schema_version": 1,\\n  "version": "${version}"\\n}\\n'`,
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n");
  }
  const bd = join(dir, "bd");
  writeFileSync(bd, body);
  chmodSync(bd, 0o755);
  return dir;
}

/** Run the gate with a controlled PATH. Returns { status, stdout, stderr }. */
function runGate(pathDirs, args = []) {
  const res = spawnSync("/bin/bash", [GATE, ...args], {
    encoding: "utf8",
    env: {
      // System dirs supply sed/head/dirname; pathDirs supply (or omit) bd.
      PATH: [...pathDirs, "/usr/bin", "/bin"].join(":"),
      HOME: workDir,
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "check-bd-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("scripts/lib/bd-version.sh (the pin)", () => {
  it("declares exactly one semver-shaped GEMBAFLOW_BD_VERSION constant", () => {
    const version = pinnedVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const src = readFileSync(VERSION_LIB, "utf8");
    const decls = src.match(/^GEMBAFLOW_BD_VERSION=/gm);
    expect(decls).toHaveLength(1);
  });
});

describe("scripts/check-bd.sh (the gate)", () => {
  it("passes when the installed bd matches the pin", () => {
    const pin = pinnedVersion();
    const { status, stdout } = runGate([stubBdDir("version", pin)]);
    expect(status).toBe(0);
    expect(stdout).toContain("OK:");
    expect(stdout).toContain(pin);
    expect(stdout).toContain("scripts/lib/bd-version.sh");
  });

  it("passes silently with --quiet when versions match", () => {
    const pin = pinnedVersion();
    const { status, stdout } = runGate([stubBdDir("version", pin)], ["--quiet"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("fails loudly on a version mismatch, naming both versions", () => {
    const pin = pinnedVersion();
    const { status, stderr } = runGate([stubBdDir("version", "0.99.0")]);
    expect(status).toBe(1);
    expect(stderr).toContain("FAILED");
    expect(stderr).toContain("0.99.0");
    expect(stderr).toContain(pin);
    // Remediation must be actionable: a version-explicit install command.
    expect(stderr).toContain(`npm install -g @beads/bd@${pin}`);
    // And it must point at the upgrade procedure, not just "reinstall".
    expect(stderr).toContain("docs/BEADS.md");
  });

  it("fails loudly when bd is not installed at all", () => {
    const emptyDir = mkdtempSync(join(workDir, "empty-"));
    mkdirSync(emptyDir, { recursive: true });
    const { status, stderr } = runGate([emptyDir]);
    expect(status).toBe(1);
    expect(stderr).toContain("FAILED");
    expect(stderr).toContain("not installed");
    expect(stderr).toContain(`npm install -g @beads/bd@${pinnedVersion()}`);
  });

  it("fails loudly when bd does not support `version --json` (CLI drift)", () => {
    const { status, stderr } = runGate([stubBdDir("no-json")]);
    expect(status).toBe(1);
    expect(stderr).toContain("FAILED");
    expect(stderr).toContain("bd version --json");
  });

  it("is not fooled by schema_version in the JSON payload", () => {
    // The stub emits schema_version: 1 before version; a naive parser could
    // grab the wrong field. Matching pin must still pass.
    const pin = pinnedVersion();
    const { status } = runGate([stubBdDir("version", pin)]);
    expect(status).toBe(0);
  });
});
