// Graph computation for the board renderer: column mapping, dependency
// classification, transitive reduction, tiers, critical path, waves, tracks.
//
// All output is deterministic: every set is ordered, and critical-path ties
// break lexicographically by bead id, so the same bd state always renders
// byte-identical HTML.

/** Stable sort helper: priority ascending (P0 first), then id. */
function byPriorityThenId(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Map every bead to a kanban column. Order of evaluation matters:
 * PR-open (projected via pr:/in-review labels) is the operative in-review
 * signal regardless of claim state (handoff anti-pattern 5).
 */
export function columnOf(bead, readyIds) {
  if (bead.status === "closed") return "done";
  if (bead.status === "deferred") return "icebox";
  if (bead.inReview || bead.prNumber !== null) return "inReview";
  if (bead.status === "in_progress" || bead.status === "hooked") {
    return "inProgress";
  }
  if (readyIds.has(bead.id)) return "ready";
  return "backlog"; // open, blocked, pinned, anything else
}

/** Group beads into ordered kanban columns. */
export function buildColumns(beads, readyIds) {
  const columns = {
    backlog: [],
    ready: [],
    inProgress: [],
    inReview: [],
    done: [],
    icebox: [],
  };
  for (const bead of beads.values()) {
    columns[columnOf(bead, readyIds)].push(bead);
  }
  for (const key of Object.keys(columns)) {
    if (key === "done") {
      // Done: newest closure first.
      columns.done.sort((a, b) => {
        const ta = a.closedAt ?? "";
        const tb = b.closedAt ?? "";
        if (ta !== tb) return ta < tb ? 1 : -1;
        return a.id < b.id ? -1 : 1;
      });
    } else {
      columns[key].sort(byPriorityThenId);
    }
  }
  return columns;
}

/**
 * Build the dependency graph over the tech-tree node set.
 *
 * Nodes: campaign beads (when a campaign is configured) excluding epics —
 * the epic is the campaign container, parent-child edges are grouping, not
 * blocking. Without a campaign, all non-epic beads that have at least one
 * hard edge (either direction) plus all non-closed non-epic beads.
 */
export function buildGraph(beads, readyIds, config = {}) {
  const campaign = config.campaign ?? null;
  const all = [...beads.values()];

  let nodes = all.filter((b) => b.type !== "epic");
  if (campaign) {
    nodes = nodes.filter((b) => b.campaign === campaign);
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : 1));
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Edges within the node set. hard: blocker → blocked. soft: relates-to.
  const hardEdges = [];
  const softEdges = [];
  const seenSoft = new Set();
  for (const bead of nodes) {
    for (const dep of bead.deps) {
      if (!nodeIds.has(dep.blocker)) continue;
      if (dep.type === "blocks") {
        hardEdges.push({ from: dep.blocker, to: bead.id });
      } else if (dep.type === "relates-to") {
        // relates-to is bidirectional; dedupe on the unordered pair and
        // draw once (lexicographically smaller id as source).
        const [a, b] = [dep.blocker, bead.id].sort();
        const key = `${a}→${b}`;
        if (!seenSoft.has(key)) {
          seenSoft.add(key);
          softEdges.push({ from: a, to: b });
        }
      }
      // parent-child: grouping only, never drawn.
    }
  }
  hardEdges.sort((a, b) =>
    `${a.from}→${a.to}` < `${b.from}→${b.to}` ? -1 : 1,
  );
  softEdges.sort((a, b) =>
    `${a.from}→${a.to}` < `${b.from}→${b.to}` ? -1 : 1,
  );

  // Adjacency over hard edges.
  const out = new Map(nodes.map((n) => [n.id, []]));
  const into = new Map(nodes.map((n) => [n.id, []]));
  for (const e of hardEdges) {
    out.get(e.from).push(e.to);
    into.get(e.to).push(e.from);
  }

  // Kahn topological order; leftovers are cycle members.
  const indegree = new Map(nodes.map((n) => [n.id, into.get(n.id).length]));
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  queue.sort();
  const topo = [];
  while (queue.length) {
    const id = queue.shift();
    topo.push(id);
    const next = [];
    for (const succ of out.get(id)) {
      indegree.set(succ, indegree.get(succ) - 1);
      if (indegree.get(succ) === 0) next.push(succ);
    }
    next.sort();
    queue.push(...next);
    queue.sort();
  }
  const cycleMembers = nodes
    .map((n) => n.id)
    .filter((id) => !topo.includes(id))
    .sort();

  // Tiers: longest-path depth from roots (cycle members land in tier 0 of
  // whatever remains reachable — they carry a warning banner instead).
  const tier = new Map(nodes.map((n) => [n.id, 0]));
  for (const id of topo) {
    for (const succ of out.get(id)) {
      tier.set(succ, Math.max(tier.get(succ), tier.get(id) + 1));
    }
  }

  // Critical path: deepest root→sink chain, lexicographic tie-break.
  // longest(id) = longest path length starting at id.
  const longest = new Map();
  const nextOnPath = new Map();
  for (const id of [...topo].reverse()) {
    let best = 0;
    let bestSucc = null;
    const succs = [...out.get(id)].sort();
    for (const succ of succs) {
      const len = 1 + (longest.get(succ) ?? 0);
      if (len > best || (len === best && bestSucc !== null && succ < bestSucc)) {
        best = len;
        bestSucc = succ;
      }
    }
    longest.set(id, best);
    nextOnPath.set(id, bestSucc);
  }
  let start = null;
  for (const id of topo) {
    if (into.get(id).length > 0) continue; // roots only
    if (
      start === null ||
      longest.get(id) > longest.get(start) ||
      (longest.get(id) === longest.get(start) && id < start)
    ) {
      start = id;
    }
  }
  const criticalPath = [];
  for (let id = start; id !== null && id !== undefined; id = nextOnPath.get(id)) {
    criticalPath.push(id);
  }

  // Transitive reduction (drawing only): drop hard edge A→C when C is
  // reachable from A via a path of length ≥ 2.
  const reach = new Map(); // id → Set of ids reachable via ≥1 hop
  for (const id of [...topo].reverse()) {
    const r = new Set();
    for (const succ of out.get(id)) {
      r.add(succ);
      for (const rr of reach.get(succ) ?? []) r.add(rr);
    }
    reach.set(id, r);
  }
  const drawnHardEdges = hardEdges.filter((e) => {
    for (const mid of out.get(e.from)) {
      if (mid !== e.to && (reach.get(mid) ?? new Set()).has(e.to)) return false;
    }
    return true;
  });

  // Waves: topological batches over non-closed nodes. Wave 1 = claimable the
  // moment the campaign starts (all hard blockers already closed).
  const done = new Set(
    nodes.filter((n) => n.status === "closed").map((n) => n.id),
  );
  const remaining = new Set(
    nodes
      .filter((n) => n.status !== "closed" && !cycleMembers.includes(n.id))
      .map((n) => n.id),
  );
  const waves = [];
  while (remaining.size) {
    const wave = [...remaining]
      .filter((id) => into.get(id).every((b) => done.has(b)))
      .sort();
    if (!wave.length) break; // residual cycle — banner covers it
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      done.add(id);
    }
  }

  // Tracks: ordered by config, then first-appearance alphabetical.
  const trackNames = [];
  const configTracks = Array.isArray(config.tracks) ? config.tracks : [];
  for (const name of configTracks) trackNames.push(name);
  const seen = new Set(trackNames);
  for (const n of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const t = n.track ?? "general";
    if (!seen.has(t)) {
      seen.add(t);
      trackNames.push(t);
    }
  }

  // Convergence tiers: a tier renders full-width when its nodes' hard deps
  // span ≥ 2 distinct tracks.
  const maxTier = Math.max(0, ...[...tier.values()]);
  const convergenceTiers = new Set();
  for (let t = 0; t <= maxTier; t++) {
    const tierNodes = nodes.filter((n) => tier.get(n.id) === t);
    for (const n of tierNodes) {
      const depTracks = new Set(
        into
          .get(n.id)
          .map((id) => beads.get(id)?.track ?? "general"),
      );
      if (depTracks.size >= 2) {
        convergenceTiers.add(t);
        break;
      }
    }
  }

  return {
    nodes,
    nodeIds,
    hardEdges,
    drawnHardEdges,
    softEdges,
    into,
    out,
    tier,
    maxTier,
    criticalPath,
    criticalPathSet: new Set(criticalPath),
    waves,
    tracks: trackNames,
    convergenceTiers,
    cycleMembers,
  };
}

/**
 * Build the epic-collapsed DAG for the tech-tree default view.
 *
 * Algorithm:
 * - Epic nodes: each unique epic bead that has at least one non-epic child.
 * - "Loose work" count: OPEN (status=open|in_progress) non-epic beads with no
 *   parent or whose parent is not an epic present in the dataset. Closed and
 *   deferred parentless beads are excluded so the bucket reflects triage work
 *   that still needs an epic home, not accumulated history. Returned as
 *   looseCount; the renderer synthesises the __loose__ card.
 * - Cross-epic edges: A→B iff any bead in epicA hard-blocks any bead in epicB.
 *   Deduplicated. Transitive-reduced at the epic level. Lexicographic sort on
 *   all sets for byte-stable output.
 * - Epic node data: { id, title, closedCount, totalCount, status, track }
 *   status: "done"=all children closed; "in-progress"=any child in-flight;
 *           "blocked"=has incoming epic edge from a non-done source; else "ready"
 *   track: from the epic's own track: label, fallback "general"
 * - Critical path: same longest-path algorithm as buildGraph but operating on
 *   epic nodes (excluding __loose__).
 * - Returns: { epicNodes, epicEdges, drawnEpicEdges, epicCriticalPath,
 *              epicCriticalPathSet, looseCount, epicTier, epicInto, epicOut,
 *              cycleMembers }
 */
export function buildEpicGraph(beads, readyIds) {
  const all = [...beads.values()];

  // Build epicId → epic bead map.
  const epicBeads = new Map();
  for (const b of all) {
    if (b.type === "epic") epicBeads.set(b.id, b);
  }

  // Build epicId → children (non-epic beads).
  const epicChildren = new Map();
  for (const [id] of epicBeads) epicChildren.set(id, []);

  let looseCount = 0;
  for (const b of all) {
    if (b.type === "epic") continue;
    const pid = b.parent;
    if (pid && epicChildren.has(pid)) {
      epicChildren.get(pid).push(b);
    } else if (b.status === "open" || b.status === "in_progress") {
      looseCount++;
    }
  }

  // Only keep epics that have at least one child.
  const activeEpicIds = [...epicChildren.entries()]
    .filter(([, children]) => children.length > 0)
    .map(([id]) => id)
    .sort();

  if (activeEpicIds.length === 0) {
    return {
      epicNodes: [],
      epicEdges: [],
      drawnEpicEdges: [],
      epicCriticalPath: [],
      epicCriticalPathSet: new Set(),
      looseCount,
      epicTier: new Map(),
      epicInto: new Map(),
      epicOut: new Map(),
      cycleMembers: [],
    };
  }

  // Build bead-to-epicId lookup for non-epic beads.
  const beadEpic = new Map(); // beadId → epicId (for active epics only)
  for (const eid of activeEpicIds) {
    for (const b of epicChildren.get(eid)) {
      beadEpic.set(b.id, eid);
    }
  }

  // Cross-epic edges: epicA→epicB iff any child of A hard-blocks any child of B.
  const edgeSet = new Set();
  for (const b of all) {
    if (b.type === "epic") continue;
    const toEpic = beadEpic.get(b.id);
    if (!toEpic) continue; // loose bead
    for (const dep of b.deps) {
      if (dep.type !== "blocks") continue;
      const fromEpic = beadEpic.get(dep.blocker);
      if (!fromEpic || fromEpic === toEpic) continue;
      edgeSet.add(`${fromEpic}→${toEpic}`);
    }
  }
  const epicEdges = [...edgeSet]
    .sort()
    .map((key) => {
      const [from, to] = key.split("→");
      return { from, to };
    });

  // Adjacency maps.
  const epicOut = new Map(activeEpicIds.map((id) => [id, []]));
  const epicInto = new Map(activeEpicIds.map((id) => [id, []]));
  for (const e of epicEdges) {
    if (epicOut.has(e.from)) epicOut.get(e.from).push(e.to);
    if (epicInto.has(e.to)) epicInto.get(e.to).push(e.from);
  }
  // Sort adjacency lists.
  for (const [, arr] of epicOut) arr.sort();
  for (const [, arr] of epicInto) arr.sort();

  // Kahn topological sort; leftovers are cycle members.
  const indegree = new Map(activeEpicIds.map((id) => [id, epicInto.get(id).length]));
  const queue = activeEpicIds.filter((id) => indegree.get(id) === 0).sort();
  const topo = [];
  const queueArr = [...queue];
  while (queueArr.length) {
    queueArr.sort();
    const id = queueArr.shift();
    topo.push(id);
    for (const succ of [...epicOut.get(id)].sort()) {
      indegree.set(succ, indegree.get(succ) - 1);
      if (indegree.get(succ) === 0) queueArr.push(succ);
    }
  }
  const cycleMembers = activeEpicIds
    .filter((id) => !topo.includes(id))
    .sort();

  // Tiers.
  const epicTier = new Map(activeEpicIds.map((id) => [id, 0]));
  for (const id of topo) {
    for (const succ of epicOut.get(id)) {
      epicTier.set(succ, Math.max(epicTier.get(succ), epicTier.get(id) + 1));
    }
  }

  // Compute per-epic child status metrics.
  const epicStatusRaw = new Map(); // "done" | "in-progress" | "pending"
  for (const eid of activeEpicIds) {
    const children = epicChildren.get(eid);
    const total = children.length;
    const closedCount = children.filter((b) => b.status === "closed").length;
    let status;
    if (closedCount === total) {
      status = "done";
    } else {
      const inFlight = children.some(
        (b) =>
          b.status !== "closed" &&
          (b.status === "in_progress" ||
            b.status === "hooked" ||
            b.inReview ||
            b.prNumber !== null),
      );
      status = inFlight ? "in-progress" : "pending";
    }
    epicStatusRaw.set(eid, status);
  }

  // Resolve "blocked" status (needs incoming epic from non-done source).
  const epicStatusFinal = new Map();
  for (const eid of activeEpicIds) {
    const raw = epicStatusRaw.get(eid);
    if (raw === "done" || raw === "in-progress") {
      epicStatusFinal.set(eid, raw);
    } else {
      const isBlocked = epicInto.get(eid).some(
        (src) => epicStatusFinal.get(src) !== "done" && epicStatusRaw.get(src) !== "done",
      );
      epicStatusFinal.set(eid, isBlocked ? "blocked" : "ready");
    }
  }

  // Build epic node objects.
  const epicNodes = activeEpicIds.map((eid) => {
    const epicBead = epicBeads.get(eid);
    const children = epicChildren.get(eid);
    return {
      id: eid,
      title: epicBead?.title ?? eid,
      closedCount: children.filter((b) => b.status === "closed").length,
      totalCount: children.length,
      status: epicStatusFinal.get(eid),
      track: epicBead?.track ?? "general",
    };
  });

  // Critical path (longest path, lexicographic tie-break, excluding __loose__).
  const longest = new Map();
  const nextOnPath = new Map();
  for (const id of [...topo].reverse()) {
    let best = 0;
    let bestSucc = null;
    for (const succ of [...epicOut.get(id)].sort()) {
      const len = 1 + (longest.get(succ) ?? 0);
      if (len > best || (len === best && bestSucc !== null && succ < bestSucc)) {
        best = len;
        bestSucc = succ;
      }
    }
    longest.set(id, best);
    nextOnPath.set(id, bestSucc);
  }
  let cpStart = null;
  for (const id of topo) {
    if (epicInto.get(id).length > 0) continue;
    if (
      cpStart === null ||
      longest.get(id) > longest.get(cpStart) ||
      (longest.get(id) === longest.get(cpStart) && id < cpStart)
    ) {
      cpStart = id;
    }
  }
  const epicCriticalPath = [];
  for (let id = cpStart; id !== null && id !== undefined; id = nextOnPath.get(id)) {
    epicCriticalPath.push(id);
  }

  // Transitive reduction on epic edges.
  const reach = new Map();
  for (const id of [...topo].reverse()) {
    const r = new Set();
    for (const succ of epicOut.get(id)) {
      r.add(succ);
      for (const rr of reach.get(succ) ?? []) r.add(rr);
    }
    reach.set(id, r);
  }
  const drawnEpicEdges = epicEdges.filter((e) => {
    for (const mid of epicOut.get(e.from)) {
      if (mid !== e.to && (reach.get(mid) ?? new Set()).has(e.to)) return false;
    }
    return true;
  });

  return {
    epicNodes,
    epicEdges,
    drawnEpicEdges,
    epicCriticalPath,
    epicCriticalPathSet: new Set(epicCriticalPath),
    looseCount,
    epicTier,
    epicInto,
    epicOut,
    cycleMembers,
  };
}

/** Victory bead: configured id, else the critical path's sink. */
export function victoryBead(graphModel, beads, config = {}) {
  if (config.victoryBeadId && beads.has(config.victoryBeadId)) {
    return beads.get(config.victoryBeadId);
  }
  const sink = graphModel.criticalPath[graphModel.criticalPath.length - 1];
  return sink ? beads.get(sink) : null;
}

/** Stat strip numbers shared by both boards. */
export function buildStats(graphModel, columns) {
  const campaignScope = graphModel.nodes;
  return {
    done: campaignScope.filter((n) => n.status === "closed").length,
    inProgress:
      campaignScope.filter(
        (n) => columnOf(n, new Set()) === "inProgress",
      ).length,
    inReview: campaignScope.filter((n) => n.inReview || n.prNumber !== null)
      .filter((n) => n.status !== "closed").length,
    criticalPathDepth: graphModel.criticalPath.length,
    humanGated: campaignScope.filter((n) => n.humanOps).length,
    totalOnBoard: campaignScope.length,
    columnCounts: Object.fromEntries(
      Object.entries(columns).map(([k, v]) => [k, v.length]),
    ),
  };
}
