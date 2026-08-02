// Data extraction layer for the board renderer.
//
// Queries bd (beads) via --json and normalizes everything into one internal
// bead shape, including the framework beads label conventions
// (campaign:/track:/pr:/verdict:/safety: prefixes, human-ops, in-review). Also supports loading from a fixture
// directory of captured JSON (for tests and offline development).
//
// bd JSON facts this module relies on (verified against bd 1.1.0):
// - `bd list --json` embeds `dependencies` as {issue_id, depends_on_id, type}
//   where type is "blocks" | "parent-child" | "relates-to" and depends_on_id
//   is the BLOCKER (issue_id depends on it).
// - `bd list --json` does NOT include `notes`; `bd show --json` and
//   `bd ready --json` do. Notes are hydrated via ONE batched multi-id
//   `bd show <id...>` call, only for beads labeled `human-ops` (the
//   Operator: line lives in notes) — never one subprocess per bead.
// - closed beads carry `close_reason` and `closed_at`.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BD_TIMEOUT_MS = 10_000;

/**
 * Parse bd --json output, tolerating bd 1.1.0's intermittent raw control
 * characters inside JSON strings (docs/BEADS.md gotcha 9: e.g. a literal
 * tab carried over from an issue body is emitted unescaped, and JSON.parse
 * rejects it). Control characters other than \n and \r are replaced with a
 * space — safe both inside strings (minor whitespace loss) and between
 * tokens (plain whitespace). Returns null on unparseable input.
 */
export function parseBdJson(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, " "));
  } catch {
    return null;
  }
}

/** Run a bd command, returning parsed JSON (null on any failure). */
function bdJson(args, cwd) {
  try {
    const out = execFileSync("bd", [...args, "--json"], {
      cwd,
      encoding: "utf8",
      timeout: BD_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseBdJson(out);
  } catch {
    return null;
  }
}

/** Parse conventions out of a raw bd issue's labels. */
function parseConventions(labels) {
  const conv = {
    campaign: null,
    track: null,
    humanOps: false,
    inReview: false,
    prNumber: null,
    verdict: null,
    safety: null,
  };
  for (const label of labels) {
    if (label.startsWith("campaign:")) conv.campaign = label.slice(9);
    else if (label.startsWith("track:")) conv.track = label.slice(6);
    else if (label === "human-ops") conv.humanOps = true;
    else if (label === "in-review") conv.inReview = true;
    else if (label.startsWith("pr:")) {
      const n = Number.parseInt(label.slice(3), 10);
      // Multiple pr: labels can exist after a re-roll; highest number wins.
      if (Number.isFinite(n) && (conv.prNumber === null || n > conv.prNumber)) {
        conv.prNumber = n;
      }
    } else if (label.startsWith("verdict:")) conv.verdict = label.slice(8);
    else if (label.startsWith("safety:")) conv.safety = label.slice(7);
  }
  return conv;
}

/**
 * Extract operator directions from a bead's notes.
 *
 * Convention: a block starts at a line beginning
 * `Operator:`; the text after the prefix is a step (or an intro), and any
 * immediately following numbered ("1." / "1)") or bulleted ("-" / "*")
 * lines are further steps. Multiple `bd note` entries may each contribute
 * an Operator block — all blocks concatenate into one step list.
 *
 * Returns { summary, steps } or null. `summary` is the first step (used on
 * the card's one-line Operator: display); `steps` is the full ordered list.
 */
function parseOperator(notes) {
  if (!notes) return null;
  const lines = notes.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const opMatch = /^Operator:\s*(.*)$/.exec(line.trim());
    if (opMatch) {
      current = [];
      blocks.push(current);
      if (opMatch[1].trim()) current.push(opMatch[1].trim());
      continue;
    }
    if (current) {
      const stepMatch = /^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(line);
      if (stepMatch) current.push(stepMatch[1].trim());
      else current = null; // blank or prose ends the block; later Operator: reopens
    }
  }
  // Notes are append-only; the LAST Operator block supersedes earlier ones
  // (bd note amendment semantics). Empty blocks are ignored.
  const last = [...blocks].reverse().find((b) => b.length);
  if (!last) return null;
  return { summary: last[0], steps: last };
}

/** Normalize one raw bd issue into the internal bead shape. */
function normalizeBead(raw) {
  const labels = raw.labels ?? [];
  const conv = parseConventions(labels);
  const deps = [];
  for (const d of raw.dependencies ?? []) {
    // depends_on_id blocks issue_id → edge blocker → bead.
    deps.push({ blocker: d.depends_on_id, type: d.type });
  }
  return {
    id: raw.id,
    title: raw.title ?? "",
    description: raw.description ?? "",
    status: raw.status,
    priority: typeof raw.priority === "number" ? raw.priority : 2,
    type: raw.issue_type ?? "task",
    labels,
    assignee: raw.assignee ?? null,
    notes: raw.notes ?? null,
    closeReason: raw.close_reason ?? null,
    closedAt: raw.closed_at ?? null,
    updatedAt: raw.updated_at ?? null,
    parent: raw.parent ?? null,
    deps,
    ...conv,
    operator: parseOperator(raw.notes),
  };
}

/**
 * Merge raw issue lists into a bead map (later lists win on id collisions,
 * which matters because `bd ready --json` carries `notes` while list doesn't).
 */
function buildBeadMap(rawLists) {
  const beads = new Map();
  for (const list of rawLists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const bead = normalizeBead(raw);
      const existing = beads.get(bead.id);
      if (existing && existing.notes && !bead.notes) {
        bead.notes = existing.notes;
        bead.operator = existing.operator;
      }
      beads.set(bead.id, bead);
    }
  }
  return beads;
}

/**
 * Hydrate notes for human-ops beads (Operator: line) — list output lacks
 * notes, so they come from `bd show`. `fetchShown` receives the FULL array of
 * bead ids still missing notes and must return an array of raw bd issues
 * (multi-id `bd show --json` shape, verified against bd 1.1.0). It is called
 * at most ONCE per load — batching is the contract, not an optimization:
 * per-bead subprocess spawns were the N+1 this replaces.
 */
export function hydrateHumanOpsNotes(beads, fetchShown) {
  const pending = [...beads.values()].filter(
    (b) => b.humanOps && b.notes === null,
  );
  if (!pending.length) return;
  const shown = fetchShown(pending.map((b) => b.id));
  const byId = new Map();
  const rawList = Array.isArray(shown) ? shown : shown ? [shown] : [];
  for (const raw of rawList) {
    if (raw && raw.id) byId.set(raw.id, raw);
  }
  for (const bead of pending) {
    const raw = byId.get(bead.id);
    if (raw && raw.notes) {
      bead.notes = raw.notes;
      bead.operator = parseOperator(raw.notes);
    }
  }
}

/** Derive https://github.com/<org>/<repo> from a git remote URL. */
export function repoUrlFromOrigin(remote) {
  if (!remote) return null;
  const m =
    /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

/** Read the committed board config; degrade gracefully when absent. */
export function loadConfig(rootDir) {
  const path = join(rootDir, ".gembaflow-boards.config.json");
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Malformed config must not break rendering.
  }
  return {};
}

/** Load board state live from bd. Returns null if bd/state is unavailable. */
export function loadFromBd(rootDir) {
  if (!existsSync(join(rootDir, ".beads"))) return null;

  const open = bdJson(["list", "--status=open", "-n", "0"], rootDir);
  if (open === null) return null; // bd missing or broken — silent no-op upstream
  const inProgress =
    bdJson(["list", "--status=in_progress", "-n", "0"], rootDir) ?? [];
  const blocked = bdJson(["list", "--status=blocked", "-n", "0"], rootDir) ?? [];
  const closed =
    bdJson(["list", "--status=closed", "--all", "-n", "0"], rootDir) ?? [];
  const deferred =
    bdJson(["list", "--status=deferred", "-n", "0"], rootDir) ?? [];
  // --limit 0: bd ready silently caps at 100 rows by default, with only a
  // stderr advisory (docs/BEADS.md gotcha 10) — without it, readyIds (and
  // the notes carried by ready output) truncate on large trackers.
  const ready = bdJson(["ready", "--limit", "0"], rootDir) ?? [];

  const beads = buildBeadMap([open, blocked, inProgress, closed, deferred, ready]);
  const readyIds = new Set(
    Array.isArray(ready) ? ready.map((r) => r.id) : [],
  );

  // Hydrate notes for human-ops beads in ONE batched subprocess (multi-id
  // `bd show` — verified against bd 1.1.0), replacing per-bead N+1 spawns.
  hydrateHumanOpsNotes(beads, (ids) => bdJson(["show", ...ids], rootDir) ?? []);

  let repoUrl = null;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: rootDir,
      encoding: "utf8",
      timeout: BD_TIMEOUT_MS,
    });
    repoUrl = repoUrlFromOrigin(remote);
  } catch {
    repoUrl = null;
  }

  return { beads, readyIds, repoUrl };
}

/** Load board state from a fixture directory of captured bd JSON. */
export function loadFromFixture(fixtureDir) {
  const readJson = (name, fallback) => {
    try {
      return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
    } catch {
      return fallback;
    }
  };
  const open = readJson("open.json", []);
  const blocked = readJson("blocked.json", []);
  const inProgress = readJson("in_progress.json", []);
  const closed = readJson("closed.json", []);
  const deferred = readJson("deferred.json", []);
  const ready = readJson("ready.json", []);

  const beads = buildBeadMap([open, blocked, inProgress, closed, deferred, ready]);
  // Fixture shows carry notes for human-ops beads. Fixtures store one
  // show-<id>.json per bead (captured single-id output), so the batch
  // fetcher flattens the per-id files into one multi-id-shaped array.
  hydrateHumanOpsNotes(beads, (ids) =>
    ids.flatMap((id) => {
      const shown = readJson(`show-${id}.json`, null);
      return Array.isArray(shown) ? shown : shown ? [shown] : [];
    }),
  );
  const readyIds = new Set(Array.isArray(ready) ? ready.map((r) => r.id) : []);
  return { beads, readyIds, repoUrl: "https://github.com/example-org/example-repo" };
}
