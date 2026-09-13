// @vitest-environment node
// Tests for scripts/lib/bootstrap-marker.sh — the Phase-4 completion-marker
// writer (gh-gf-524).
//
// Strategy: run the helper directly (`bash scripts/lib/bootstrap-marker.sh`,
// the /bootstrap slash-command invocation shape) inside a throwaway git repo
// seeded with fixture files, then assert on the marker JSON shape and the
// commit. Real git + jq; no network — the best-effort push fails fast (no
// `origin` remote) and must never fail the run.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const MARKER_SH = join(REPO_ROOT, "scripts", "lib", "bootstrap-marker.sh");
const MARKER_FILE = ".gembaflow-bootstrap-complete";

let workDir;

/** ISO8601 UTC without fractional seconds (the shape both writers emit). */
function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

function git(cwd, ...args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout;
}

/**
 * Create a throwaway git repo seeded with the given fixture files.
 *
 * @param {object} opts
 * @param {object|null} opts.versionManifest - .gembaflow-version content
 * @param {object|null} opts.config          - .gembaflow-config.json content
 * @param {string|null} opts.statusFile      - .claude/.bootstrap-status content
 */
function makeRepo({ versionManifest = null, config = null, statusFile = null } = {}) {
  const repo = mkdtempSync(join(workDir, "repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  // Template-born forks always have history; commit a seed file so the
  // marker's pathspec commit has a HEAD to build on.
  writeFileSync(join(repo, "README.md"), "seed\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-q", "-m", "seed");
  if (versionManifest !== null) {
    writeFileSync(join(repo, ".gembaflow-version"), JSON.stringify(versionManifest, null, 2));
  }
  if (config !== null) {
    writeFileSync(join(repo, ".gembaflow-config.json"), JSON.stringify(config, null, 2));
  }
  if (statusFile !== null) {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", ".bootstrap-status"), statusFile);
  }
  return repo;
}

/**
 * Create a bare origin for a repo, optionally rejecting pushes to
 * refs/heads/main via an update hook — simulating the Phase-4 provisioning
 * ruleset, which blocks direct pushes to main for ALL actors.
 */
function addBareOrigin(repo, { rejectMain = false } = {}) {
  const bare = mkdtempSync(join(workDir, "origin-"));
  spawnSync("git", ["init", "-q", "--bare", bare], { encoding: "utf8" });
  if (rejectMain) {
    const hook = join(bare, "hooks", "update");
    writeFileSync(hook, '#!/bin/bash\n[ "$1" = "refs/heads/main" ] && exit 1\nexit 0\n');
    chmodSync(hook, 0o755);
  }
  git(repo, "remote", "add", "origin", bare);
  return bare;
}

/** List refs present in a bare origin. */
function bareRefs(bare) {
  const res = spawnSync("git", ["--git-dir", bare, "for-each-ref", "--format=%(refname)"], {
    encoding: "utf8",
  });
  return (res.stdout ?? "").trim().split("\n").filter(Boolean);
}

/** Run the helper the way /bootstrap does: `bash scripts/lib/bootstrap-marker.sh`. */
function runMarker(repo) {
  const res = spawnSync("/bin/bash", [MARKER_SH], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, HOME: workDir },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function readMarker(repo) {
  return JSON.parse(readFileSync(join(repo, MARKER_FILE), "utf8"));
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "bootstrap-marker-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("gembaflow_write_bootstrap_marker (via direct execution)", () => {
  it("writes the schema_version-1 marker with all required fields", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(500) },
      statusFile: `phase0:complete\nstarted:${isoSecondsAgo(120)}\nphase1:complete\n`,
    });
    const { status } = runMarker(repo);
    expect(status).toBe(0);

    const marker = readMarker(repo);
    expect(marker.schema_version).toBe("1");
    expect(marker.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(marker.version).toBe("1.8.0");
    expect(marker.mode).toBe("solo");
    expect(typeof marker.duration_seconds).toBe("number");
    // No workshop block configured → no workshop field.
    expect(marker).not.toHaveProperty("workshop");
    // No operator-identifying data.
    expect(JSON.stringify(marker)).not.toContain("test@example.com");
  });

  it("derives duration_seconds from the status file's started: line", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(9999) },
      statusFile: `phase0:complete\nstarted:${isoSecondsAgo(120)}\n`,
    });
    runMarker(repo);
    const marker = readMarker(repo);
    // started: wins over installedAt; allow generous slack for slow CI.
    expect(marker.duration_seconds).toBeGreaterThanOrEqual(115);
    expect(marker.duration_seconds).toBeLessThan(600);
  });

  it("falls back to .gembaflow-version installedAt when no started: line exists", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(300) },
      statusFile: "phase0:complete\n",
    });
    runMarker(repo);
    const marker = readMarker(repo);
    expect(marker.duration_seconds).toBeGreaterThanOrEqual(295);
    expect(marker.duration_seconds).toBeLessThan(900);
  });

  it("writes duration_seconds: null when no timing signal exists (never fabricates)", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: null },
    });
    runMarker(repo);
    const marker = readMarker(repo);
    expect(marker.duration_seconds).toBeNull();
  });

  it("reports mode multi when solo_mode is explicitly false", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
      config: { solo_mode: false },
    });
    runMarker(repo);
    expect(readMarker(repo).mode).toBe("multi");
  });

  it("includes the workshop cohort only when workshop.enabled is true", () => {
    const enabled = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
      config: { solo_mode: true, workshop: { enabled: true, cohort: "2026-10-nashville" } },
    });
    runMarker(enabled);
    expect(readMarker(enabled).workshop).toBe("2026-10-nashville");
    expect(readMarker(enabled).schema_version).toBe("1");

    const disabled = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
      config: { solo_mode: true, workshop: { enabled: false, cohort: "2026-10-nashville" } },
    });
    runMarker(disabled);
    expect(readMarker(disabled)).not.toHaveProperty("workshop");
  });

  it("falls back to version unknown when .gembaflow-version is absent", () => {
    const repo = makeRepo({});
    runMarker(repo);
    expect(readMarker(repo).version).toBe("unknown");
  });
});

describe("gembaflow_commit_bootstrap_marker (via direct execution)", () => {
  it("commits the marker as its own commit with the canonical message", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
    });
    // An unrelated staged file must NOT ride the marker commit.
    writeFileSync(join(repo, "unrelated.txt"), "staged but unrelated\n");
    git(repo, "add", "unrelated.txt");

    const { status } = runMarker(repo);
    expect(status).toBe(0);

    const subject = git(repo, "log", "-1", "--format=%s").trim();
    expect(subject).toBe("chore(bootstrap): mark complete");
    const files = git(repo, "show", "--name-only", "--format=", "HEAD").trim().split("\n");
    expect(files).toEqual([MARKER_FILE]);
    // The marker is tracked (committed, NOT gitignored).
    expect(git(repo, "ls-files", MARKER_FILE).trim()).toBe(MARKER_FILE);
  });

  it("pushes the marker to the default branch when nothing blocks it", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
    });
    const bare = addBareOrigin(repo);
    const { status, stdout } = runMarker(repo);
    expect(status).toBe(0);
    expect(stdout).toContain("marker pushed to 'main' — fleet-check will report this fork GREEN");
    expect(bareRefs(bare)).toContain("refs/heads/main");
    expect(bareRefs(bare)).not.toContain("refs/heads/gembaflow/bootstrap-marker");
  });

  it("falls back to gembaflow/bootstrap-marker when the default-branch push is rejected (Phase-4 ruleset)", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
    });
    const bare = addBareOrigin(repo, { rejectMain: true });
    const { status, stdout, stderr } = runMarker(repo);
    expect(status).toBe(0);
    // Accurate messaging: rejection is expected, fallback worked, no action needed.
    expect(stdout).toContain("default-branch push rejected");
    expect(stdout).toContain("fallback branch 'gembaflow/bootstrap-marker'");
    expect(stdout).toContain("no action needed");
    // No stale "push or merge it" advice the attendee cannot follow.
    expect(stdout + stderr).not.toContain("push (or merge)");
    // The marker commit actually landed on the fallback ref, not main.
    expect(bareRefs(bare)).toContain("refs/heads/gembaflow/bootstrap-marker");
    expect(bareRefs(bare)).not.toContain("refs/heads/main");
  });

  it("survives total push failure (no origin remote) with exit 0 and accurate guidance", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
    });
    const { status, stderr } = runMarker(repo);
    expect(status).toBe(0);
    expect(stderr).toContain("push failed (default branch AND fallback branch");
    expect(stderr).toContain("YELLOW until a push succeeds");
    expect(existsSync(join(repo, MARKER_FILE))).toBe(true);
  });

  it("is idempotent — a re-run neither errors nor duplicates state", () => {
    const repo = makeRepo({
      versionManifest: { version: "1.8.0", installedAt: isoSecondsAgo(60) },
    });
    expect(runMarker(repo).status).toBe(0);
    expect(runMarker(repo).status).toBe(0);
    expect(readMarker(repo).schema_version).toBe("1");
  });
});
