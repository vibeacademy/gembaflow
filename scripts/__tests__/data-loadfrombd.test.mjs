// @vitest-environment node
// Unit tests for scripts/lib/boards/data.mjs — loadFromBd error and live paths.
//
// These tests mock node:child_process to exercise branches that fixture-based
// tests cannot reach (bd missing, partial failures, notes hydration, git
// remote failure). They do NOT spawn a real bd or git process.
//
// This file MUST run in the "node" environment (not jsdom) because:
//   - data.mjs uses node:child_process / node:fs which are not available in jsdom
//   - vi.mock("node:child_process") only intercepts properly in a Node environment
//
// Strategy: vi.mock('node:child_process') at the module level so Vitest can
// hoist it before ESM imports are resolved. Each test controls the mock
// return values via mockImplementation()/mockReturnValueOnce() on the
// execFileSync spy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Hoist the mock before module resolution (vi.mock is hoisted automatically
// by Vitest's transformer). We spread the real module and override only
// execFileSync so that data.mjs's named import picks up the stub, and any
// other named exports from node:child_process continue to work as-is.
// ---------------------------------------------------------------------------
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

// Import data.mjs AFTER the mock is declared so it picks up the stub.
// We also import the mocked module to control the spy in each test.
import { loadFromBd, repoUrlFromOrigin } from "../lib/boards/data.mjs";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory that has a .beads sub-directory (required by
 *  loadFromBd's early-exit guard). Returns the root dir path. */
function tmpWithBeads() {
  const root = mkdtempSync(join(tmpdir(), "data-lbd-test-"));
  mkdirSync(join(root, ".beads"), { recursive: true });
  return root;
}

/** JSON-serialise a fake bd list result to a Buffer (execFileSync returns a
 *  string when encoding: 'utf8' is passed — but the mock returns strings). */
function bdResult(arr) {
  return JSON.stringify(arr);
}

/** A minimal bead fixture that bdJson parses into a valid bead. */
function fakeBead(id, overrides = {}) {
  return {
    id,
    title: `Test bead ${id}`,
    status: "open",
    priority: 1,
    issue_type: "task",
    labels: [],
    dependencies: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadFromBd — missing .beads directory", () => {
  it("returns null when .beads directory does not exist", () => {
    // Use a temp dir WITHOUT .beads — no child_process calls should be made.
    const root = mkdtempSync(join(tmpdir(), "no-beads-"));
    try {
      const result = loadFromBd(root);
      expect(result).toBeNull();
      // execFileSync must NOT have been called (no bd or git invocation).
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("loadFromBd — bd open-list failure → null (silent no-op contract)", () => {
  let root;

  beforeEach(() => {
    root = tmpWithBeads();
    vi.clearAllMocks();
  });

  it("returns null when bd list --status=open throws (bd not installed / ENOENT)", () => {
    execFileSync.mockImplementation((cmd, args) => {
      // Only the first call is bd list --status=open; simulate bd missing.
      throw Object.assign(new Error("spawn bd ENOENT"), { code: "ENOENT" });
    });
    expect(loadFromBd(root)).toBeNull();
  });

  it("returns null when bd list --status=open exits non-zero", () => {
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error("Command failed: bd list --status=open"), {
        status: 1,
        stderr: "bd: unknown flag --status",
      });
    });
    expect(loadFromBd(root)).toBeNull();
  });

  it("returns null when bd list --status=open returns malformed JSON", () => {
    execFileSync.mockImplementation(() => "this is not json");
    expect(loadFromBd(root)).toBeNull();
  });
});

describe("loadFromBd — partial failure (open ok, others fail)", () => {
  let root;

  beforeEach(() => {
    root = tmpWithBeads();
    vi.clearAllMocks();
  });

  it("builds a beads map from open list even when in_progress/closed/ready commands fail", () => {
    const openBead = fakeBead("t-1");
    let callCount = 0;

    execFileSync.mockImplementation((cmd, args) => {
      callCount++;
      if (cmd === "bd") {
        // First call is "list --status=open" — return one bead.
        if (args.includes("--status=open")) {
          return bdResult([openBead]);
        }
        // "ready" call — return empty array.
        if (args.includes("ready")) {
          return bdResult([]);
        }
        // All other bd calls (in_progress, blocked, closed, deferred) fail.
        throw new Error("bd subcommand failed");
      }
      if (cmd === "git") {
        // git remote get-url origin — succeed with a known URL.
        return "https://github.com/example/repo.git\n";
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = loadFromBd(root);
    expect(result).not.toBeNull();
    expect(result.beads.has("t-1")).toBe(true);
    expect(result.beads.get("t-1").title).toBe("Test bead t-1");
    expect(result.repoUrl).toBe("https://github.com/example/repo");
  });

  it("returns an empty beads map (not null) when open succeeds but is empty and others fail", () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === "bd") {
        if (args.includes("--status=open")) return bdResult([]);
        if (args.includes("ready")) return bdResult([]);
        throw new Error("bd subcommand failed");
      }
      if (cmd === "git") return "https://github.com/example/repo.git\n";
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = loadFromBd(root);
    expect(result).not.toBeNull();
    expect(result.beads.size).toBe(0);
  });
});

describe("loadFromBd — human-ops notes hydration via bd show", () => {
  let root;

  beforeEach(() => {
    root = tmpWithBeads();
    vi.clearAllMocks();
  });

  it("hydrates notes and operator for a human-ops bead when list lacks notes", () => {
    const humanOpsBead = fakeBead("ho-1", {
      labels: ["human-ops"],
      notes: null,
    });
    const showResult = [
      {
        ...humanOpsBead,
        notes: "Some context\nOperator: accept the amended ADR and merge it",
      },
    ];

    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === "bd") {
        if (args.includes("--status=open")) return bdResult([humanOpsBead]);
        if (args.includes("ready")) return bdResult([]);
        // bd show ho-1 — called during notes hydration.
        if (args.includes("show")) return bdResult(showResult);
        // Other list commands succeed but return empty.
        return bdResult([]);
      }
      if (cmd === "git") return "https://github.com/example/repo.git\n";
      return bdResult([]);
    });

    const result = loadFromBd(root);
    expect(result).not.toBeNull();
    const bead = result.beads.get("ho-1");
    expect(bead).toBeDefined();
    expect(bead.humanOps).toBe(true);
    expect(bead.notes).toBe("Some context\nOperator: accept the amended ADR and merge it");
    expect(bead.operator).toEqual({
      summary: "accept the amended ADR and merge it",
      steps: ["accept the amended ADR and merge it"],
    });
  });

  it("leaves notes/operator null when bd show fails for a human-ops bead", () => {
    const humanOpsBead = fakeBead("ho-2", {
      labels: ["human-ops"],
      notes: null,
    });

    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === "bd") {
        if (args.includes("--status=open")) return bdResult([humanOpsBead]);
        if (args.includes("ready")) return bdResult([]);
        if (args.includes("show")) throw new Error("bd show failed");
        return bdResult([]);
      }
      if (cmd === "git") return "https://github.com/example/repo.git\n";
      return bdResult([]);
    });

    const result = loadFromBd(root);
    expect(result).not.toBeNull();
    const bead = result.beads.get("ho-2");
    expect(bead.humanOps).toBe(true);
    // Graceful degradation: hydration failed but bead still present.
    expect(bead.notes).toBeNull();
    expect(bead.operator).toBeNull();
  });

  it("does NOT call bd show for non-human-ops beads", () => {
    const normalBead = fakeBead("n-1", { labels: [] });
    const showSpy = vi.fn(() => bdResult([normalBead]));

    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === "bd") {
        if (args.includes("show")) return showSpy();
        if (args.includes("--status=open")) return bdResult([normalBead]);
        if (args.includes("ready")) return bdResult([]);
        return bdResult([]);
      }
      if (cmd === "git") return "https://github.com/example/repo.git\n";
      return bdResult([]);
    });

    loadFromBd(root);
    expect(showSpy).not.toHaveBeenCalled();
  });
});

describe("loadFromBd — git remote failure → repoUrl null", () => {
  let root;

  beforeEach(() => {
    root = tmpWithBeads();
    vi.clearAllMocks();
  });

  it("returns repoUrl: null when git remote get-url throws", () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === "bd") {
        if (args.includes("--status=open")) return bdResult([fakeBead("g-1")]);
        if (args.includes("ready")) return bdResult([]);
        return bdResult([]);
      }
      if (cmd === "git") throw new Error("git: not a git repository");
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = loadFromBd(root);
    expect(result).not.toBeNull();
    expect(result.repoUrl).toBeNull();
    // beads map is still populated despite git failure.
    expect(result.beads.has("g-1")).toBe(true);
  });
});

describe("repoUrlFromOrigin — URL parsing variants", () => {
  it("parses HTTPS remote with .git suffix", () => {
    expect(repoUrlFromOrigin("https://github.com/myorg/myrepo.git")).toBe(
      "https://github.com/myorg/myrepo",
    );
  });

  it("parses HTTPS remote without .git suffix", () => {
    expect(repoUrlFromOrigin("https://github.com/myorg/myrepo")).toBe(
      "https://github.com/myorg/myrepo",
    );
  });

  it("parses SSH remote (git@ form) with .git suffix", () => {
    expect(repoUrlFromOrigin("git@github.com:myorg/myrepo.git")).toBe(
      "https://github.com/myorg/myrepo",
    );
  });

  it("parses SSH remote (git@ form) without .git suffix", () => {
    expect(repoUrlFromOrigin("git@github.com:myorg/myrepo")).toBe(
      "https://github.com/myorg/myrepo",
    );
  });

  it("handles trailing newline (as returned by execFileSync)", () => {
    expect(repoUrlFromOrigin("git@github.com:myorg/myrepo.git\n")).toBe(
      "https://github.com/myorg/myrepo",
    );
  });

  it("returns null for a non-GitHub remote", () => {
    expect(repoUrlFromOrigin("git@gitlab.com:myorg/myrepo.git")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(repoUrlFromOrigin(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(repoUrlFromOrigin("")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(repoUrlFromOrigin(undefined)).toBeNull();
  });
});
