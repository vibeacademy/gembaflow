// @vitest-environment node
// Tests for scripts/write-drain-state.mjs — the schema-validated drain
// state writer (drain finding 4: hand-authored state JSON drifts from
// the summary renderer's schema; the helper turns silent drift into a
// loud write-time failure).
//
// This file MUST run in the "node" environment (child_process, fs).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePatch } from "../write-drain-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const WRITER = join(REPO_ROOT, "scripts", "write-drain-state.mjs");

let workDir;
let fileCount = 0;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "write-drain-state-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function stateFile() {
  return join(workDir, `drain-state-${fileCount++}.json`);
}

function runWriter(patch, file) {
  const input = typeof patch === "string" ? patch : JSON.stringify(patch);
  return spawnSync("node", [WRITER, file], { encoding: "utf8", input });
}

describe("write-drain-state.mjs (CLI)", () => {
  it("creates the state file from a valid patch and stamps lastWriteTime", () => {
    const file = stateFile();
    const r = runWriter(
      { drainId: "drain-2026-08-01T00:00Z", startTime: "2026-08-01T00:00:00Z" },
      file,
    );
    expect(r.status).toBe(0);
    const state = JSON.parse(readFileSync(file, "utf8"));
    expect(state.drainId).toBe("drain-2026-08-01T00:00Z");
    expect(state.lastWriteTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("merges a patch into existing state without dropping fields", () => {
    const file = stateFile();
    runWriter({ drainId: "drain-x", snapshotOrder: ["va-1", "va-2"] }, file);
    const r = runWriter(
      { currentCycle: 1, currentTicket: { bead: "va-1", prNumber: 61 } },
      file,
    );
    expect(r.status).toBe(0);
    const state = JSON.parse(readFileSync(file, "utf8"));
    expect(state.drainId).toBe("drain-x");
    expect(state.snapshotOrder).toEqual(["va-1", "va-2"]);
    expect(state.currentTicket).toEqual({ bead: "va-1", prNumber: 61 });
  });

  it("rejects an unknown top-level field, naming it", () => {
    const file = stateFile();
    const r = runWriter({ shippedTickets: [] }, file);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("SCHEMA VIOLATION");
    expect(r.stderr).toContain('"shippedTickets"');
    expect(existsSync(file)).toBe(false);
  });

  it("rejects an off-schema bucket-entry field (the va-17h drift class)", () => {
    const file = stateFile();
    const r = runWriter(
      { shipped: [{ bead: "va-1", title: "t", issue: 42 }] },
      file,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"issue"');
    expect(r.stderr).toContain("shipped[0]");
  });

  it("rejects an unknown currentTicket subfield", () => {
    const file = stateFile();
    const r = runWriter({ currentTicket: { bead: "va-1", deployId: "d-1" } }, file);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"deployId"');
  });

  it("rejects a non-string snapshotOrder entry", () => {
    const file = stateFile();
    const r = runWriter({ snapshotOrder: [17, "va-2"] }, file);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("snapshotOrder");
  });

  it("rejects invalid JSON on stdin", () => {
    const file = stateFile();
    const r = runWriter("{not json", file);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("not valid JSON");
  });

  it("refuses to clobber a corrupt existing state file", () => {
    const file = stateFile();
    writeFileSync(file, "{corrupt");
    const r = runWriter({ drainId: "drain-x" }, file);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to clobber");
    expect(readFileSync(file, "utf8")).toBe("{corrupt");
  });

  it("leaves no .tmp file behind (atomic tmp+rename)", () => {
    const file = stateFile();
    const r = runWriter({ drainId: "drain-x" }, file);
    expect(r.status).toBe(0);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("writes state the wake-up-summary renderer accepts end to end", async () => {
    const file = stateFile();
    const r = runWriter(
      {
        drainId: "drain-e2e",
        startTime: "2026-08-01T00:00:00Z",
        endTime: "2026-08-01T02:00:00Z",
        shipped: [
          { bead: "va-1a2", title: "ship it", safetyClass: "internal", prNumber: 61, mergeSha: "abc1234" },
        ],
        productionStatus: { healthCheckOk: true },
      },
      file,
    );
    expect(r.status).toBe(0);
    const { render } = await import(join(REPO_ROOT, "scripts", "emit-drain-summary.mjs"));
    const md = render(JSON.parse(readFileSync(file, "utf8")));
    expect(md).toContain("drain-e2e");
    expect(md).toContain("va-1a2");
  });
});

describe("validatePatch (unit)", () => {
  it("returns no violations for a full valid state", () => {
    expect(
      validatePatch({
        drainId: "d",
        drainBead: "va-9",
        aborted: false,
        blocked: [{ bead: "va-2", reason: "red CI" }],
        rolledBack: [],
        mergedNotDeployed: [],
        skipped: [{ bead: "va-3", reason: "safety:hot" }],
        resumedFromInterruption: false,
        currentCycleStep: "7-bridge-dispatch",
        currentTicket: null,
        productionStatus: { sentryBaselineBefore: 0.1, sentryBaselineAfter: 0.1, healthCheckOk: true },
      }),
    ).toEqual([]);
  });

  it("rejects a non-object patch", () => {
    expect(validatePatch([1, 2])).toHaveLength(1);
    expect(validatePatch(null)).toHaveLength(1);
  });

  it("collects multiple violations in one pass", () => {
    const violations = validatePatch({
      bogus: 1,
      shipped: [{ issue: 42 }],
      currentTicket: { deployId: "d" },
    });
    expect(violations.length).toBe(3);
  });
});
