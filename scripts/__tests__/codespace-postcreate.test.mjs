// @vitest-environment node
// Tests for the settings-materialization block in scripts/codespace-postcreate.sh.
//
// Strategy: run the real script in a temp directory that mimics the repo
// structure (only the files the settings block needs), with a controlled PATH
// so sourced libs and external commands (npm, gh, uv, git) are stubbed or
// absent. We isolate the settings block behavior under the four cases that
// matter: (a) no live settings + template present → copy; (b) settings.json
// already present → no-op; (c) settings.local.json already present → no-op;
// (d) neither live settings nor template → warning.
//
// The script uses `set -u` (not `set -e`), so every code path runs to
// completion and collects into WELCOME.md rather than aborting.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "codespace-postcreate.sh");

// Minimal settings.template.json content — real shape, enough to be
// identifiable after the copy.
const TEMPLATE_CONTENT = JSON.stringify(
  { permissions: { allow: ["Bash(bd:*)"], deny: [], ask: [] }, hooks: {} },
  null,
  2
);

let workRoot;

/** Create a fresh fake repo root with the minimum scaffold. */
function makeFakeRepo(opts = {}) {
  const dir = mkdtempSync(join(workRoot, "repo-"));
  // .claude directory
  mkdirSync(join(dir, ".claude"), { recursive: true });
  // scripts/lib — for sourced libs (stubs that do nothing)
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  // Stub lib/version-stamp.sh (sourced at script start)
  writeFileSync(
    join(dir, "scripts", "lib", "version-stamp.sh"),
    "gembaflow_version_stamp() { return 0; }\n"
  );
  // Stub lib/bd-version.sh (sourced before the bd install block)
  writeFileSync(
    join(dir, "scripts", "lib", "bd-version.sh"),
    'GEMBAFLOW_BD_VERSION="1.1.0"\n'
  );
  // settings.template.json (optionally absent)
  if (opts.withTemplate !== false) {
    writeFileSync(join(dir, ".claude", "settings.template.json"), TEMPLATE_CONTENT);
  }
  // Pre-existing live settings (optionally present)
  if (opts.withSettingsJson) {
    writeFileSync(join(dir, ".claude", "settings.json"), '{"pre":"existing"}\n');
  }
  if (opts.withSettingsLocal) {
    writeFileSync(
      join(dir, ".claude", "settings.local.json"),
      '{"pre":"existing-local"}\n'
    );
  }
  return dir;
}

/**
 * Build a PATH containing stubs for every external binary the script invokes
 * so the test doesn't need npm, gh, uv, or git installed (or in a state that
 * would interfere).  All stubs exit 0 silently unless noted.
 */
function makeStubDir() {
  const dir = mkdtempSync(join(workRoot, "stubs-"));
  const stubs = {
    // git: minimal subset the script calls
    git: `#!/bin/sh
case "$*" in
  "config --global user.name") echo "Test User" ;;
  "config --global user.email") echo "test@example.com" ;;
  *) true ;;
esac
exit 0`,
    // gh: api user call returns a usable noreply address
    gh: `#!/bin/sh
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  printf '"12345+testuser@users.noreply.github.com"'
fi
exit 0`,
    // npm: pretend bd install succeeds; check-bd.sh calls npm install
    npm: "#!/bin/sh\nexit 0",
    // uv: not called (no pyproject.toml in fake repo), stub anyway
    uv: "#!/bin/sh\nexit 0",
  };
  for (const [name, body] of Object.entries(stubs)) {
    const p = join(dir, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
  return dir;
}

/**
 * Also stub scripts/check-bd.sh inside the fake repo so the bd-install block
 * thinks bd is installed (avoids npm install path).
 */
function addCheckBdStub(repoDir) {
  const checkBd = join(repoDir, "scripts", "check-bd.sh");
  writeFileSync(checkBd, "#!/bin/sh\nexit 0\n");
  chmodSync(checkBd, 0o755);
}

/** Run the script in the fake repo. Returns { status, stdout, stderr, welcome }. */
function runScript(repoDir) {
  const stubDir = makeStubDir();
  addCheckBdStub(repoDir);
  const res = spawnSync("/bin/bash", [SCRIPT], {
    cwd: repoDir,
    encoding: "utf8",
    env: {
      PATH: [stubDir, "/usr/bin", "/bin"].join(":"),
      HOME: repoDir,
      GITHUB_USER: "testuser",
      GITHUB_REPOSITORY: "testorg/testrepo",
    },
  });
  let welcome = "";
  const welcomePath = join(repoDir, "WELCOME.md");
  if (existsSync(welcomePath)) {
    welcome = readFileSync(welcomePath, "utf8");
  }
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    welcome,
  };
}

beforeAll(() => {
  workRoot = mkdtempSync(join(tmpdir(), "postcreate-test-"));
});

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

describe("codespace-postcreate.sh — settings materialization", () => {
  it("copies template to settings.local.json when no live settings exist", () => {
    const repo = makeFakeRepo({ withTemplate: true });
    const { status } = runScript(repo);
    expect(status).toBe(0);
    const localPath = join(repo, ".claude", "settings.local.json");
    expect(existsSync(localPath)).toBe(true);
    expect(readFileSync(localPath, "utf8")).toBe(TEMPLATE_CONTENT);
  });

  it("mentions the copy in WELCOME.md when settings are materialized", () => {
    const repo = makeFakeRepo({ withTemplate: true });
    const { welcome } = runScript(repo);
    expect(welcome).toContain("settings.template.json");
    expect(welcome).toContain("settings.local.json");
    // Should NOT show the warning about missing settings
    expect(welcome).not.toContain("bd permission gates and board hooks are inactive");
  });

  it("does NOT overwrite an existing settings.json (no-clobber guard)", () => {
    const repo = makeFakeRepo({ withTemplate: true, withSettingsJson: true });
    const originalContent = readFileSync(join(repo, ".claude", "settings.json"), "utf8");
    runScript(repo);
    expect(readFileSync(join(repo, ".claude", "settings.json"), "utf8")).toBe(
      originalContent
    );
    // settings.local.json must NOT have been created
    expect(existsSync(join(repo, ".claude", "settings.local.json"))).toBe(false);
  });

  it("does NOT overwrite an existing settings.local.json (no-clobber guard)", () => {
    const repo = makeFakeRepo({ withTemplate: true, withSettingsLocal: true });
    const originalContent = readFileSync(
      join(repo, ".claude", "settings.local.json"),
      "utf8"
    );
    runScript(repo);
    expect(readFileSync(join(repo, ".claude", "settings.local.json"), "utf8")).toBe(
      originalContent
    );
  });

  it("emits a note_warning when template is missing and no live settings exist", () => {
    const repo = makeFakeRepo({ withTemplate: false });
    const { status, welcome } = runScript(repo);
    expect(status).toBe(0); // non-fatal — script continues
    expect(welcome).toContain("settings.template.json");
    // The warning text names what is inactive
    expect(welcome).toContain("bd permission gates and board hooks are inactive");
  });

  it("is idempotent — second run is a no-op when settings.local.json already exists", () => {
    const repo = makeFakeRepo({ withTemplate: true });
    // First run copies
    runScript(repo);
    const afterFirst = readFileSync(join(repo, ".claude", "settings.local.json"), "utf8");
    // Second run must not clobber
    runScript(repo);
    expect(readFileSync(join(repo, ".claude", "settings.local.json"), "utf8")).toBe(
      afterFirst
    );
  });
});
