#!/usr/bin/env node
// scripts/write-drain-state.mjs
//
// Schema-validated writer for the /drain skill's on-disk state file.
// ALL drain state writes go through this helper — never free-form
// JSON authoring.
//
// Rationale (fork drain run va-17h, finding 4): the orchestrator
// hand-authored the state JSON with off-schema field names, which
// silently degraded the first wake-up-summary render — the renderer
// (scripts/emit-drain-summary.mjs) read `state.shipped ?? []` and got
// nothing, so the operator woke up to an empty summary of a successful
// run. A helper that rejects unknown fields turns that silent drift
// into a loud, immediate failure at write time.
//
// The canonical state shape is the top-of-file contract in
// scripts/emit-drain-summary.mjs; the allowlists below mirror it and
// MUST be updated in lockstep when that contract changes.
//
// Usage (merge-patch semantics — read state, shallow-merge the patch,
// stamp lastWriteTime, write atomically via tmp+rename):
//   echo '{"currentCycle": 2, "currentTicket": {"bead": "va-1a2", "prNumber": 61}}' \
//     | node scripts/write-drain-state.mjs /tmp/drain-state-<drainId>.json
//
// Top-level keys in the patch replace the existing value wholesale
// (arrays and nested objects are not deep-merged) — the skill always
// writes complete values for the fields it touches.
//
// Exit codes:
//   0 — state written
//   1 — usage error, unreadable/unparseable input, or SCHEMA VIOLATION
//       (the error names the off-schema field and the allowed set)
//
// The drain skill treats a non-schema write failure (disk full, etc.)
// as best-effort (warn and continue); a schema violation is an
// orchestrator bug and the message is designed to make it obvious.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

/** Top-level fields of the drain state contract. */
const ALLOWED_TOP = new Set([
  "drainId",
  "drainBead",
  "startTime",
  "endTime",
  "aborted",
  "abortReason",
  "shipped",
  "blocked",
  "rolledBack",
  "mergedNotDeployed",
  "skipped",
  "productionStatus",
  "resumedFromInterruption",
  "originalStartTime",
  "resumedAt",
  "currentCycle",
  "currentCycleStep",
  "currentTicket",
  "snapshotOrder",
  "lastWriteTime",
]);

/** Outcome-bucket arrays whose entries share one row shape. */
const BUCKET_FIELDS = new Set([
  "shipped",
  "blocked",
  "rolledBack",
  "mergedNotDeployed",
  "skipped",
]);

/** Allowed keys on a bucket entry (see emit-drain-summary.mjs renderers). */
const ALLOWED_BUCKET_ENTRY = new Set([
  "bead",
  "title",
  "safetyClass",
  "prNumber",
  "mergeSha",
  "reason",
  "auditCommentUrl",
  "rollbackRunId",
]);

/** Allowed keys on currentTicket (the in-flight work item). */
const ALLOWED_CURRENT_TICKET = new Set(["bead", "prNumber", "mergeSha", "bridgeRunId"]);

/** Allowed keys on productionStatus. */
const ALLOWED_PRODUCTION_STATUS = new Set([
  "sentryBaselineBefore",
  "sentryBaselineAfter",
  "healthCheckOk",
]);

/**
 * Validates a merge patch against the drain-state schema.
 *
 * @param {object} patch - candidate state fields
 * @returns {string[]} human-readable violations (empty when valid)
 */
export function validatePatch(patch) {
  const violations = [];
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return ["patch must be a JSON object of state fields"];
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_TOP.has(key)) {
      violations.push(
        `unknown top-level field "${key}" — allowed: ${[...ALLOWED_TOP].join(", ")}`,
      );
      continue;
    }
    if (BUCKET_FIELDS.has(key)) {
      if (!Array.isArray(value)) {
        violations.push(`"${key}" must be an array of outcome entries`);
        continue;
      }
      value.forEach((entry, i) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          violations.push(`"${key}[${i}]" must be an object`);
          return;
        }
        for (const entryKey of Object.keys(entry)) {
          if (!ALLOWED_BUCKET_ENTRY.has(entryKey)) {
            violations.push(
              `unknown field "${entryKey}" in "${key}[${i}]" — allowed: ${[...ALLOWED_BUCKET_ENTRY].join(", ")}`,
            );
          }
        }
      });
    } else if (key === "currentTicket" && value !== null) {
      if (typeof value !== "object" || Array.isArray(value)) {
        violations.push(`"currentTicket" must be an object (or null)`);
        continue;
      }
      for (const subKey of Object.keys(value)) {
        if (!ALLOWED_CURRENT_TICKET.has(subKey)) {
          violations.push(
            `unknown field "${subKey}" in "currentTicket" — allowed: ${[...ALLOWED_CURRENT_TICKET].join(", ")}`,
          );
        }
      }
    } else if (key === "productionStatus" && value !== null) {
      if (typeof value !== "object" || Array.isArray(value)) {
        violations.push(`"productionStatus" must be an object (or null)`);
        continue;
      }
      for (const subKey of Object.keys(value)) {
        if (!ALLOWED_PRODUCTION_STATUS.has(subKey)) {
          violations.push(
            `unknown field "${subKey}" in "productionStatus" — allowed: ${[...ALLOWED_PRODUCTION_STATUS].join(", ")}`,
          );
        }
      }
    } else if (key === "snapshotOrder") {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        violations.push(`"snapshotOrder" must be an array of bead-id strings`);
      }
    }
  }
  return violations;
}

function readStdin() {
  return readFileSync(0, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error(
      "Usage: echo '<json-patch>' | node scripts/write-drain-state.mjs <state-file>",
    );
    process.exit(1);
  }
  const stateFile = args[0];

  let patch;
  try {
    patch = JSON.parse(readStdin());
  } catch (err) {
    console.error(`write-drain-state: stdin is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const violations = validatePatch(patch);
  if (violations.length > 0) {
    console.error(
      "write-drain-state: SCHEMA VIOLATION — refusing to write off-schema drain state (this is how the fork's first wake-up summary silently degraded):",
    );
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  let state = {};
  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch (err) {
      console.error(
        `write-drain-state: existing state file is not valid JSON (${err.message}) — refusing to clobber ${stateFile}`,
      );
      process.exit(1);
    }
  }

  const next = { ...state, ...patch, lastWriteTime: new Date().toISOString() };

  // Atomic write: tmp + rename so a partial write can't corrupt the
  // resume payload (per the drain spec's state-persistence contract).
  const tmpFile = `${stateFile}.tmp`;
  writeFileSync(tmpFile, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmpFile, stateFile);
  console.log(`wrote ${stateFile} (${Object.keys(next).length} top-level fields)`);
}

// Only run main when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
