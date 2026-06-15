#!/usr/bin/env node
// scripts/deploy-status/interface.mjs
//
// Provider-plugin contract + dispatcher for /drain step 9 (deploy-wait).
// Reads DRAIN_DEPLOY_PLANE from the environment, dispatches to the matching
// per-provider adapter, and forwards the adapter's JSON envelope on stdout
// unchanged. Always exits 0 — the caller (drain.md per-iteration step 9)
// interprets the JSON envelope.
//
// Why this exists: drain v1 shipped with a Render-only deploy-status script
// (`scripts/render-deploy-status.mjs`) embedded directly in step 9 of the
// per-iteration cycle. Forks on non-Render planes (Cloud Run, Fly, etc.)
// could not use the script. This dispatcher closes that gap with a single
// well-defined plugin contract that #495 (Cloud Run adapter) and any future
// adapters can conform to without modifying the drain runtime itself.
//
// ── Interface contract (every adapter MUST conform) ─────────────────────────
//
// Invocation:
//   node <adapter> <commit-sha>
//
// Input:
//   - argv[2]   commit-sha (required)
//
// Environment:
//   - Plane-specific credentials (e.g. RENDER_API_TOKEN, GCP_PROJECT_ID).
//     Adapters consume what they need; the dispatcher does not validate
//     credentials — that's the adapter's job.
//
// Output envelope (one JSON line on stdout):
//   {
//     live: boolean,           // is THIS commit's deploy serving traffic?
//     status: string|null,     // adapter-native deploy state (e.g. "live", "build_failed", "pending", null)
//     source: string,          // "<plane>" on success, "unavailable" if the adapter could not determine
//     reason?: string,         // adapter-side explanation when source === "unavailable" (raw cause)
//     hint?: string,           // operator-facing fix hint when source === "unavailable"
//     deployId?: string,       // adapter-native deploy identifier when known
//     sha?: string             // commit-sha echoed back (sanity check)
//   }
//
// Exit code: 0 always. Adapter failures surface as JSON (source="unavailable").
//
// ── Plane selection ─────────────────────────────────────────────────────────
//
// DRAIN_DEPLOY_PLANE env var selects the adapter; defaults to "render" so
// existing Render-using forks see zero behavior change after this dispatcher
// is wired into drain.md step 9. Supported values:
//
//   render     → scripts/render-deploy-status.mjs (shipped)
//   cloud-run  → scripts/cloud-run-deploy-status.mjs (to be shipped in #495)
//
// Unknown plane → exit 0 with a JSON error envelope so the caller's existing
// "if source == unavailable, fall back to curl" branch handles it (per
// docs/testing/render-gating.md § Fallback).
//
// ── Adding a new adapter ────────────────────────────────────────────────────
//
// 1. Ship `scripts/<plane>-deploy-status.mjs` conforming to the contract above.
// 2. Add an entry to PLANE_ADAPTERS below mapping the plane name → script path.
// 3. Document the env-var conventions in docs/testing/<plane>-gating.md.
// 4. Operators set DRAIN_DEPLOY_PLANE=<plane> (in their shell or
//    .gembaflow-config.json — see #493).
//
// Drain.md step 9 invokes this file unchanged; the adapter selection happens
// at runtime.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLANE_ADAPTERS = {
  render: "render-deploy-status.mjs",
  "cloud-run": "cloud-run-deploy-status.mjs",
};

const DEFAULT_PLANE = "render";

function adapterPath(plane) {
  const filename = PLANE_ADAPTERS[plane];
  if (!filename) return null;
  // Adapters sit one directory up from this dispatcher (scripts/<plane>-deploy-status.mjs).
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", filename);
}

function emitUnavailable(reason, hint) {
  const envelope = { live: false, status: null, source: "unavailable", reason };
  if (hint) envelope.hint = hint;
  process.stdout.write(JSON.stringify(envelope) + "\n");
  process.exit(0);
}

function main() {
  const sha = process.argv[2];
  if (!sha) {
    console.error("Usage: node scripts/deploy-status/interface.mjs <commit-sha>");
    console.error("Selects an adapter via DRAIN_DEPLOY_PLANE (default: render) and forwards its JSON envelope on stdout.");
    process.exit(1);
  }

  const plane = process.env.DRAIN_DEPLOY_PLANE || DEFAULT_PLANE;
  const adapter = adapterPath(plane);

  if (!adapter) {
    emitUnavailable(
      `unknown DRAIN_DEPLOY_PLANE=${plane}`,
      `supported: ${Object.keys(PLANE_ADAPTERS).join(", ")}; set DRAIN_DEPLOY_PLANE=render to use the default`
    );
  }

  if (!existsSync(adapter)) {
    emitUnavailable(
      `adapter not installed for plane=${plane}`,
      `expected ${adapter}; ship the adapter or change DRAIN_DEPLOY_PLANE`
    );
  }

  // Spawn the adapter with the same env + sha argument; forward its stdout.
  const result = spawnSync("node", [adapter, sha], {
    env: process.env,
    encoding: "utf-8",
  });

  if (result.status !== 0 && result.status !== null) {
    emitUnavailable(
      `adapter exited with code ${result.status}`,
      `check ${adapter} stderr; expected exit 0 per the interface contract`
    );
  }

  // Validate the adapter emitted a parseable JSON envelope.
  const raw = (result.stdout || "").trim();
  if (!raw) {
    emitUnavailable(
      `adapter produced no stdout`,
      `adapter ${adapter} must emit a single JSON envelope per the interface contract`
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.live !== "boolean" || typeof parsed.source !== "string") {
      emitUnavailable(
        `adapter envelope missing required fields (live: boolean, source: string)`,
        `adapter ${adapter} did not conform to the interface contract`
      );
    }
    // Pass through verbatim — the dispatcher does not alter adapter output.
    process.stdout.write(raw + "\n");
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(0);
  } catch (e) {
    emitUnavailable(
      `adapter produced unparseable stdout: ${e.message}`,
      `expected one JSON line; got ${raw.slice(0, 120)}${raw.length > 120 ? "…" : ""}`
    );
  }
}

main();
