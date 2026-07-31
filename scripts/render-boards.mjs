#!/usr/bin/env node
// Deterministic board renderer: projects bd (beads) tracker state into two
// self-contained HTML boards — .gembaflow-boards/kanban.html and
// .gembaflow-boards/techtree.html.
//
// Invoked automatically by .claude/hooks/render-boards-on-bd.sh once per
// assistant turn (Stop hook) and on session start (SessionStart hook), and
// manually via /board-refresh.
//
// Contract (the hook depends on this):
// - Normal renders ALWAYS exit 0 — bd missing, no .beads/, parse errors, and
//   dependency cycles must never break an agent's bd command or a session.
//   Failures are logged to .gembaflow-boards/render.log instead.
// - Output writes are atomic (tmp + rename) so a browser mid-refresh never
//   sees a torn file.
// - Output is deterministic: same bd state → byte-identical HTML. The
//   "updated" stamp derives from the newest bead mutation, not wall clock.
//
// Usage:
//   node scripts/render-boards.mjs                 # render from live bd state
//   node scripts/render-boards.mjs --refresh       # same (hook SessionStart alias)
//   node scripts/render-boards.mjs --fixture <dir> # render from captured JSON
//   node scripts/render-boards.mjs --out <dir>     # override output dir
//   node scripts/render-boards.mjs --check         # validate bd JSON shape (exit 1 on drift)

import { mkdirSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFromBd, loadFromFixture, loadConfig } from "./lib/boards/data.mjs";
import {
  buildColumns,
  buildGraph,
  buildEpicGraph,
  buildStats,
  victoryBead,
} from "./lib/boards/graph.mjs";
import { renderKanban } from "./lib/boards/kanban.mjs";
import { renderTechtree } from "./lib/boards/techtree.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { fixture: null, out: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixture") args.fixture = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--check") args.check = true;
    // --refresh is accepted as a no-op alias (SessionStart hook passes it).
  }
  return args;
}

function log(outDir, message) {
  try {
    mkdirSync(outDir, { recursive: true });
    appendFileSync(join(outDir, "render.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never throw.
  }
}

function atomicWrite(path, content) {
  writeFileSync(`${path}.tmp`, content);
  renameSync(`${path}.tmp`, path);
}

/** Deterministic "updated" stamp: the newest mutation in the tracker itself. */
function lastMutationStamp(beads) {
  let max = "";
  for (const b of beads.values()) {
    for (const t of [b.updatedAt, b.closedAt]) {
      if (t && t > max) max = t;
    }
  }
  return max ? `${max.slice(0, 10)} ${max.slice(11, 16)} UTC` : "—";
}

/** Beads that are open but waiting on unclosed hard blockers get a chip. */
function markBlockedHints(beads) {
  for (const b of beads.values()) {
    if (b.status !== "open") continue;
    b.blockedHint = b.deps.some(
      (d) => d.type === "blocks" && beads.get(d.blocker)?.status !== "closed",
    );
  }
}

function checkShape(state) {
  const problems = [];
  if (!state) {
    problems.push("bd state unavailable (bd not installed or .beads/ missing)");
    return problems;
  }
  const sample = state.beads.values().next().value;
  if (!sample) return problems; // empty DB is a valid shape
  for (const field of ["id", "title", "status", "priority", "type", "labels", "deps"]) {
    if (!(field in sample)) problems.push(`normalized bead missing field: ${field}`);
  }
  for (const bead of state.beads.values()) {
    for (const d of bead.deps) {
      if (!["blocks", "parent-child", "relates-to"].includes(d.type)) {
        problems.push(`unknown dependency type "${d.type}" on ${bead.id} — bd upgrade changed the schema?`);
      }
    }
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out ? resolve(args.out) : join(ROOT, ".gembaflow-boards");

  let state;
  try {
    state = args.fixture ? loadFromFixture(resolve(args.fixture)) : loadFromBd(ROOT);
  } catch (err) {
    log(outDir, `data load failed: ${err.message}`);
    return;
  }

  if (args.check) {
    const problems = checkShape(state);
    if (problems.length) {
      console.error("render-boards --check FAILED:");
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
    } else {
      console.log("render-boards --check OK: bd JSON shape matches expectations");
    }
    return;
  }

  if (!state) {
    // bd missing or repo not initialized: silent no-op (fresh clones, CI).
    return;
  }

  try {
    const config = loadConfig(args.fixture ? resolve(args.fixture) : ROOT);
    markBlockedHints(state.beads);
    const columns = buildColumns(state.beads, state.readyIds);
    const model = buildGraph(state.beads, state.readyIds, config);
    model.victory = victoryBead(model, state.beads, config);
    const epicModel = buildEpicGraph(state.beads, state.readyIds);
    const stats = buildStats(model, columns);
    const generatedAt = lastMutationStamp(state.beads);

    const kanban = renderKanban({
      columns,
      beads: state.beads,
      stats,
      config,
      repoUrl: state.repoUrl,
      generatedAt,
    });
    const techtree = renderTechtree({
      beads: state.beads,
      model,
      epicModel,
      stats,
      config,
      repoUrl: state.repoUrl,
      generatedAt,
    });

    mkdirSync(outDir, { recursive: true });
    atomicWrite(join(outDir, "kanban.html"), kanban);
    atomicWrite(join(outDir, "techtree.html"), techtree);
    log(
      outDir,
      `rendered ${state.beads.size} beads (${model.nodes.length} on tree, ` +
        `${epicModel.epicNodes.length} epics, ` +
        `${model.cycleMembers.length ? `CYCLE: ${model.cycleMembers.join(",")}` : "no cycles"})`,
    );
  } catch (err) {
    log(outDir, `render failed: ${err.stack ?? err.message}`);
  }
}

main();
