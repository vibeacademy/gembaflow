// Tech-tree board renderer (Appendix A.4 + A.7): dependency DAG styled like a
// game research tree — track columns, convergence tiers, critical path, waves,
// victory condition, human-ops overlay, SVG edges, lineage highlighting.
//
// Track layout generalization (spec §4.1 was bespoke to a 3-track campaign):
// consecutive non-convergence tiers render as N track columns; a tier whose
// nodes' hard deps span ≥2 tracks renders as a full-width convergence row.

import {
  escapeHtml,
  statusChip,
  idChip,
  priorityChip,
  humanOpsChip,
  beadDataScript,
  pageShell,
  trackColorVar,
} from "./theme.mjs";

const TREE_CSS = `
.legend { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 0 0 14px; font-size: 12px; color: var(--muted); }
.legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: baseline; }
.legend .edge-sample { display: inline-block; width: 26px; border-top: 2px solid var(--muted); vertical-align: middle; margin-right: 4px; }
.legend .edge-sample.soft { border-top-style: dashed; }
.warning {
  background: color-mix(in srgb, var(--human) 12%, var(--panel)); border: 1px solid var(--human);
  border-radius: 10px; padding: 10px 14px; margin: 0 0 14px; font-size: 13px;
}
.well {
  position: relative; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 14px; padding: 18px;
}
#edges { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.zone { position: relative; z-index: 2; }
.tier-label {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px;
  letter-spacing: .14em; text-transform: uppercase; color: var(--muted);
  margin: 22px 2px 8px;
}
.tier-label:first-child { margin-top: 0; }
.tracks { display: grid; gap: 16px; align-items: start; }
.track-col { display: grid; gap: 30px; align-content: start; }
.track-head {
  font-family: "Avenir Next Condensed", "Avenir Next", Futura, "Trebuchet MS", sans-serif;
  font-size: 15px; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 2px;
}
.row { display: grid; gap: 16px; }
.row.single { justify-content: center; }
.row.single .card { width: min(460px, 100%); }
.card {
  position: relative; background: var(--panel); border: 1px solid var(--line);
  border-left: 3px solid var(--doc); border-radius: 9px; padding: 10px 12px;
  box-shadow: var(--shadow); transition: opacity .15s ease, transform .15s ease;
}
.card .wash { position: absolute; inset: 0; border-radius: 8px; opacity: .09; pointer-events: none; }
.card.human-ops::after {
  content: ""; position: absolute; top: 0; right: 0;
  border-top: 18px solid var(--human); border-left: 18px solid transparent;
  border-top-right-radius: 9px;
}
.card .chips { position: relative; display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.card .t { position: relative; font-size: 14.5px; font-weight: 600; line-height: 1.35; text-wrap: balance; }
.card .what { position: relative; font-size: 12.5px; color: var(--muted); margin-top: 4px; }
.card .operator { position: relative; font-size: 11.5px; margin-top: 6px; }
.card .operator b {
  color: var(--human); font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
}
.card .needs {
  position: relative; font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px; color: var(--muted); border-top: 1px dashed var(--line);
  margin-top: 8px; padding-top: 6px;
}
.board.focusing .card { opacity: .22; }
.board.focusing .card.lineage { opacity: 1; transform: translateY(-1px); }
.victory {
  margin-top: 22px; background: var(--panel); border: 1px solid var(--line);
  border-left: 4px solid var(--win); border-radius: 10px; padding: 14px 18px;
}
.victory .k {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px;
  letter-spacing: .14em; text-transform: uppercase; color: var(--win);
}
.waves { margin-top: 28px; border-collapse: collapse; width: 100%; font-size: 13px; }
.waves th, .waves td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
.waves th {
  background: var(--panel-2); font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
}
.waves td .mono { font-size: 11px; }
@media (max-width: 860px) {
  .tracks, .row { grid-template-columns: 1fr !important; }
  #edges { display: none; }
}
`;

const TREE_JS = `
(function () {
  var board = document.getElementById('tree-board');
  var svg = document.getElementById('edges');
  var edgeList = JSON.parse(document.getElementById('edge-data').textContent);
  var cards = {};
  // Match both bead-level cards (.card) and epic-overview cards (.epic-card) —
  // the epic view reuses this drawing script; matching only .card left the
  // lookup map empty and silently skipped every epic edge.
  board.querySelectorAll('.card[id^="n-"], .epic-card[id^="n-"]').forEach(function (c) { cards[c.id.slice(2)] = c; });

  // --- SVG edge drawing ---
  var raf = null;
  function draw() {
    raf = null;
    if (window.innerWidth <= 860) { svg.innerHTML = ''; return; }
    var wellRect = board.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + wellRect.width + ' ' + wellRect.height);
    svg.setAttribute('width', wellRect.width);
    svg.setAttribute('height', wellRect.height);
    var parts = [];
    edgeList.forEach(function (e, i) {
      var a = cards[e.from], b = cards[e.to];
      if (!a || !b) return;
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var x1 = ra.left + ra.width / 2 - wellRect.left, y1 = ra.bottom - wellRect.top;
      var x2 = rb.left + rb.width / 2 - wellRect.left, y2 = rb.top - wellRect.top;
      var dy = Math.max(24, Math.abs(y2 - y1) / 2);
      var d = 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2;
      var dash = e.soft ? ' stroke-dasharray="6 5"' : '';
      parts.push('<path class="edge" data-from="' + e.from + '" data-to="' + e.to +
        '" d="' + d + '" fill="none" stroke="' + e.color + '" stroke-width="1.8" opacity="0.45"' + dash + '/>');
      parts.push('<circle cx="' + x2 + '" cy="' + y2 + '" r="3" fill="' + e.color +
        '" opacity="0.6" data-from="' + e.from + '" data-to="' + e.to + '" class="edge-dot"/>');
    });
    svg.innerHTML = parts.join('');
  }
  function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(requestDraw).observe(board);
  window.addEventListener('load', requestDraw);
  requestDraw();

  // --- lineage highlight (BFS both directions) ---
  var parents = {}, children = {};
  edgeList.forEach(function (e) {
    (children[e.from] = children[e.from] || []).push(e.to);
    (parents[e.to] = parents[e.to] || []).push(e.from);
  });
  function lineageOf(id) {
    var seen = { }; seen[id] = true;
    var queue = [id];
    while (queue.length) {
      var cur = queue.shift();
      (parents[cur] || []).forEach(function (p) { if (!seen[p]) { seen[p] = true; queue.push(p); } });
    }
    var queue2 = [id];
    while (queue2.length) {
      var cur2 = queue2.shift();
      (children[cur2] || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; queue2.push(c); } });
    }
    return seen;
  }
  var pinned = null;
  function focus(id) {
    var lineage = lineageOf(id);
    board.classList.add('focusing');
    Object.keys(cards).forEach(function (k) {
      cards[k].classList.toggle('lineage', !!lineage[k]);
    });
    svg.querySelectorAll('.edge, .edge-dot').forEach(function (p) {
      var inL = lineage[p.getAttribute('data-from')] && lineage[p.getAttribute('data-to')];
      p.setAttribute('opacity', inL ? '0.95' : '0.07');
    });
  }
  function unfocus() {
    board.classList.remove('focusing');
    svg.querySelectorAll('.edge').forEach(function (p) { p.setAttribute('opacity', '0.45'); });
    svg.querySelectorAll('.edge-dot').forEach(function (p) { p.setAttribute('opacity', '0.6'); });
  }
  Object.keys(cards).forEach(function (id) {
    var card = cards[id];
    card.addEventListener('mouseenter', function () { if (!pinned) focus(id); });
    card.addEventListener('mouseleave', function () { if (!pinned) unfocus(); });
    card.addEventListener('focus', function () { if (!pinned) focus(id); });
    card.addEventListener('blur', function () { if (!pinned) unfocus(); });
    card.addEventListener('click', function () {
      if (pinned === id) { pinned = null; unfocus(); }
      else { pinned = id; focus(id); }
    });
  });
})();
`;

function firstSentence(text) {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  const m = /^(.{10,180}?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : t.slice(0, 160);
}

function nodeCard(bead, model, { repoUrl, trackIndex }) {
  // Defensive lookup: when renderDrillIn is called in campaign mode, the model
  // is campaign-filtered and may not contain entries for non-campaign children.
  // Falling back to [] keeps drill-in rendering safe (no throw, reduced info).
  const needs = model.into.get(bead.id) ?? [];
  const blocked = needs.some((b) => model.beadById(b)?.status !== "closed");
  const classes = ["card"];
  if (bead.humanOps) classes.push("human-ops");
  const colorVar = (model.criticalPathSet?.has(bead.id) ?? false)
    ? "--chain"
    : trackColorVar(trackIndex);
  const chips = [
    idChip(bead),
    priorityChip(bead),
    statusChip(bead, { blocked, repoUrl }),
  ];
  if (bead.type !== "task") {
    chips.push(`<span class="chip type-chip">${escapeHtml(bead.type)}</span>`);
  }
  if (bead.humanOps) chips.push(humanOpsChip(bead));
  const operator = bead.operator
    ? `<div class="operator"><b>Operator:</b> ${escapeHtml(bead.operator.summary)}${bead.operator.steps.length > 1 ? ` <span class="mono">(+${bead.operator.steps.length - 1} steps — hover the badge)</span>` : ""}</div>`
    : "";
  const tierLabel = model.tier?.get(bead.id) ?? "?";
  return `<article class="${classes.join(" ")}" id="n-${escapeHtml(bead.id)}" data-track="${escapeHtml(bead.track ?? "general")}" data-needs="${escapeHtml(needs.join(" "))}" tabindex="0" style="border-left-color: var(${colorVar});">
  <div class="wash" style="background: var(${colorVar});"></div>
  <div class="chips">${chips.join(" ")}</div>
  <div class="t">${escapeHtml(bead.title)}</div>
  <div class="what">${escapeHtml(firstSentence(bead.description))}</div>
  ${operator}
  <div class="needs">needs: ${needs.length ? escapeHtml(needs.join(", ")) : "nothing"} · tier ${tierLabel}</div>
</article>`;
}

/**
 * Layout: walk tiers 0..max; consecutive non-convergence tiers are grouped
 * into one track-column segment; each convergence tier is a full-width row.
 */
function layoutZones(model) {
  const zones = [];
  let currentSegment = null;
  for (let t = 0; t <= model.maxTier; t++) {
    const tierNodes = model.nodes.filter((n) => model.tier.get(n.id) === t);
    if (!tierNodes.length) continue;
    if (model.convergenceTiers.has(t)) {
      currentSegment = null;
      zones.push({ kind: "row", tier: t, nodes: tierNodes });
    } else {
      if (!currentSegment) {
        currentSegment = { kind: "tracks", fromTier: t, toTier: t, nodes: [] };
        zones.push(currentSegment);
      }
      currentSegment.toTier = t;
      currentSegment.nodes.push(...tierNodes);
    }
  }
  return zones;
}

const EPIC_CSS = `
.epic-toolbar { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; }
.epic-toolbar label { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.epic-toolbar select { font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; background: var(--panel); color: var(--ink); }
.epic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.epic-card {
  position: relative; background: var(--panel); border: 1px solid var(--line);
  border-left: 3px solid var(--doc); border-radius: 9px; padding: 12px 14px;
  box-shadow: var(--shadow); cursor: pointer; transition: transform .1s ease;
}
.epic-card:hover, .epic-card:focus { transform: translateY(-2px); outline: 2px solid var(--int); outline-offset: 2px; }
.epic-card.loose { opacity: 0.5; cursor: default; }
.epic-card.loose:hover, .epic-card.loose:focus { transform: none; }
.epic-card .epic-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.epic-card .epic-title { font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.epic-card .epic-progress { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; color: var(--muted); margin-top: 4px; }
.epic-card .epic-track { font-size: 11px; color: var(--muted); margin-top: 2px; }
.chip.epic-status-done { background: var(--win); border-color: var(--win); color: var(--chip-fg); }
.chip.epic-status-in-progress { background: var(--int); border-color: var(--int); color: var(--chip-fg); }
.chip.epic-status-blocked { border-style: dashed; color: var(--muted); }
.chip.epic-status-ready { border-color: var(--win); color: var(--win); font-weight: 700; }
.drill-back { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; background: var(--panel); color: var(--ink); cursor: pointer; margin-bottom: 14px; }
.drill-back:hover { background: var(--panel-2); }
.drill-title { font-size: 18px; font-weight: 700; margin: 0 0 12px; font-family: "Avenir Next Condensed", "Avenir Next", Futura, "Trebuchet MS", sans-serif; }
.drill-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
`;

const EPIC_JS = `
(function () {
  var overviewEl = document.getElementById('epic-overview');
  var drillEl = document.getElementById('drill-in-panel');
  if (!overviewEl || !drillEl) return;
  var drillData = {};
  try { drillData = JSON.parse(document.getElementById('drill-in-data').textContent); } catch (e) {}

  function showDrill(epicId) {
    var html = drillData[epicId];
    if (html == null) return;
    drillEl.innerHTML = html;
    overviewEl.style.display = 'none';
    drillEl.style.display = 'block';
    drillEl.querySelector('.drill-back') && drillEl.querySelector('.drill-back').focus();
  }
  function showOverview() {
    overviewEl.style.display = '';
    drillEl.style.display = 'none';
    drillEl.innerHTML = '';
  }
  drillEl.addEventListener('click', function (e) {
    if (e.target.closest('.drill-back')) showOverview();
  });
  drillEl.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.drill-back')) {
      e.preventDefault(); showOverview();
    }
  });

  var filterSel = document.getElementById('epic-filter');
  if (filterSel) {
    filterSel.addEventListener('change', function () {
      var val = filterSel.value;
      if (val) { showDrill(val); }
      else { showOverview(); filterSel.value = ''; }
    });
  }

  overviewEl.querySelectorAll('.epic-card:not(.loose)').forEach(function (card) {
    var id = card.getAttribute('data-epic-id');
    if (!id) return;
    card.addEventListener('click', function () { showDrill(id); if (filterSel) filterSel.value = id; });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDrill(id); if (filterSel) filterSel.value = id; }
    });
  });
})();
`;

/** Render the epic-collapsed overview grid. */
function epicCard(epicNode, epicCriticalPathSet) {
  const isOnChain = epicCriticalPathSet.has(epicNode.id);
  // Use track palette based on track name.
  const trackToVar = { infrastructure: "--gate", library: "--lib", chain: "--chain", integration: "--int", general: "--doc" };
  const trackVar = isOnChain ? "--chain" : (trackToVar[epicNode.track] ?? "--doc");
  const statusClass = `epic-status-${epicNode.status}`;
  const statusLabel = epicNode.status === "in-progress" ? "IN PROGRESS"
    : epicNode.status === "done" ? "DONE"
    : epicNode.status === "blocked" ? "LOCKED"
    : "AVAILABLE";
  return `<article class="epic-card" id="n-${escapeHtml(epicNode.id)}" data-epic-id="${escapeHtml(epicNode.id)}" tabindex="0" style="border-left-color: var(${trackVar});" aria-label="${escapeHtml(epicNode.title)}">
  <div class="epic-chips">
    <span class="chip id">${escapeHtml(epicNode.id)}</span>
    <span class="chip ${statusClass}">${escapeHtml(statusLabel)}</span>
  </div>
  <div class="epic-title">${escapeHtml(epicNode.title)}</div>
  <div class="epic-progress">${epicNode.closedCount}/${epicNode.totalCount} closed</div>
  <div class="epic-track" style="color: var(${trackVar});">${escapeHtml(epicNode.track)}</div>
</article>`;
}

/** Build SVG edge data array for epic DAG (client-side drawing). */
function epicEdgeData(drawnEpicEdges, epicCriticalPathSet, epicNodes) {
  const nodeMap = new Map(epicNodes.map((n) => [n.id, n]));
  const trackToVar = { infrastructure: "--gate", library: "--lib", chain: "--chain", integration: "--int", general: "--doc" };
  return drawnEpicEdges.map((e) => {
    const onChain = epicCriticalPathSet.has(e.from) && epicCriticalPathSet.has(e.to);
    const srcNode = nodeMap.get(e.from);
    const trackVar = onChain ? "--chain" : (trackToVar[srcNode?.track] ?? "--doc");
    // Use "n-<id>" so TREE_JS card lookup (id^="n-") finds the epic cards.
    return { from: e.from, to: e.to, soft: false, color: `var(${trackVar})` };
  });
}

/** Pre-render bead-level drill-in HTML for one epic's children. */
function renderDrillIn(epicId, epicTitle, beads, model) {
  const children = [...beads.values()].filter(
    (b) => b.parent === epicId && b.type !== "epic",
  ).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!children.length) {
    return `<button class="drill-back" aria-label="Back to epic overview">&#8592; Back</button>
<div class="drill-title">${escapeHtml(epicTitle)}</div>
<p style="color: var(--muted); font-size: 13px;">No beads in this epic.</p>`;
  }
  const cards = children.map((b) => {
    const trackIndex = model.tracks ? model.tracks.indexOf(b.track ?? "general") : 0;
    const idx = trackIndex === -1 ? 0 : trackIndex;
    return nodeCard(b, model, { repoUrl: null, trackIndex: idx });
  }).join("\n");
  return `<button class="drill-back" aria-label="Back to epic overview">&#8592; Back to overview</button>
<div class="drill-title">${escapeHtml(epicTitle)}</div>
<div class="drill-grid">${cards}</div>`;
}

function renderEpicTechtree({ beads, model, epicModel, stats, config, repoUrl, generatedAt, title }) {
  const { epicNodes, drawnEpicEdges, epicCriticalPath, epicCriticalPathSet, looseCount, cycleMembers } = epicModel;

  // Sort epic nodes by tier then id for stable layout.
  const sortedEpics = [...epicNodes].sort((a, b) => {
    const ta = epicModel.epicTier.get(a.id) ?? 0;
    const tb = epicModel.epicTier.get(b.id) ?? 0;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : 1;
  });

  const epicCardsHtml = sortedEpics
    .map((en) => epicCard(en, epicCriticalPathSet))
    .join("\n");

  const looseHtml = looseCount > 0
    ? `<article class="epic-card loose" tabindex="-1" aria-label="Loose work (${looseCount} open beads without an epic)">
  <div class="epic-chips"><span class="chip">LOOSE</span></div>
  <div class="epic-title">Loose work (${looseCount} open)</div>
  <div class="epic-progress">Open beads without a parent epic</div>
  <div class="epic-track">general</div>
</article>`
    : "";

  // Filter <select> for keyboard/accessible drill-in.
  const filterOptions = sortedEpics
    .map((en) => `<option value="${escapeHtml(en.id)}">${escapeHtml(en.id)} — ${escapeHtml(en.title)}</option>`)
    .join("");

  // Pre-render drill-in HTML for each epic.
  const drillInData = {};
  for (const en of epicNodes) {
    drillInData[en.id] = renderDrillIn(en.id, en.title, beads, model);
  }

  const cycleWarning = cycleMembers.length
    ? `<div class="warning"><strong>Epic dependency cycle detected:</strong> <span class="mono">${escapeHtml(cycleMembers.join(", "))}</span> — run <code>bd dep cycles</code> and fix the wiring.</div>`
    : "";

  // SVG edge data for client-side drawing.
  const edgeData = epicEdgeData(drawnEpicEdges, epicCriticalPathSet, epicNodes);

  const body = `<div class="page">
<p class="eyebrow">${escapeHtml(config.phaseLabel ?? "beads DAG")} · updated ${escapeHtml(generatedAt)}</p>
<h1>${escapeHtml(title)}</h1>
<p class="lede">Epic-collapsed view: each card is an epic. Click to drill into its beads.
See also the <a href="kanban.html">kanban board</a>.</p>
${cycleWarning}
<div class="stats">
  <div class="stat"><div class="n">${epicNodes.length}</div><div class="l">epics</div></div>
  <div class="stat"><div class="n">${stats.done}</div><div class="l">done</div></div>
  <div class="stat"><div class="n">${stats.inProgress + stats.inReview}</div><div class="l">in flight</div></div>
  <div class="stat"><div class="n">${epicCriticalPath.length}</div><div class="l">deep, critical path</div></div>
  <div class="stat"><div class="n">${looseCount}</div><div class="l">open loose beads</div></div>
</div>
<div class="epic-toolbar">
  <label for="epic-filter">Drill into epic:</label>
  <select id="epic-filter" aria-label="Select an epic to drill into its beads">
    <option value="">— overview —</option>
    ${filterOptions}
  </select>
</div>
<div id="epic-overview">
  <div class="well" id="tree-board">
    <svg id="edges" aria-hidden="true"></svg>
    <div class="epic-grid">
      ${epicCardsHtml}
      ${looseHtml}
    </div>
  </div>
</div>
<div id="drill-in-panel" style="display:none;"></div>
<footer>bd is the source of truth; this page regenerates automatically on every bd mutation (and on session start). Epic view shows epics as collapsed nodes; click to see individual beads.</footer>
</div>
<script type="application/json" id="edge-data">${JSON.stringify(edgeData).replaceAll("</", "<\\/")}</script>
<script type="application/json" id="drill-in-data">${JSON.stringify(drillInData).replaceAll("</", "<\\/")}</script>
${beadDataScript(beads)}`;

  return pageShell({
    title,
    faviconGlyph: "\u{1F5FA}",
    css: TREE_CSS + EPIC_CSS,
    body,
    js: TREE_JS + EPIC_JS,
  });
}


export function renderTechtree({ beads, model, epicModel, stats, config, repoUrl, generatedAt }) {
  model.beadById = (id) => beads.get(id);
  const title = config.title ? `${config.title} — Tech Tree` : "Tech Tree — the beads DAG";

  // Epic-collapsed view: render when 2+ epics are present (single-epic DAGs
  // are not worth collapsing — fall through to bead-level view).
  if (epicModel && epicModel.epicNodes.length >= 2) {
    return renderEpicTechtree({ beads, model, epicModel, stats, config, repoUrl, generatedAt, title });
  }
  const trackIndexOf = (track) => {
    const i = model.tracks.indexOf(track ?? "general");
    return i === -1 ? model.tracks.length : i;
  };

  const zones = layoutZones(model);
  const zoneHtml = zones
    .map((zone) => {
      if (zone.kind === "row") {
        const cards = zone.nodes
          .map((n) => nodeCard(n, model, { repoUrl, trackIndex: trackIndexOf(n.track) }))
          .join("\n");
        const single = zone.nodes.length === 1 ? " single" : "";
        const cols = zone.nodes.length === 1 ? "" : `style="grid-template-columns: repeat(${Math.min(zone.nodes.length, 3)}, 1fr);"`;
        return `<div class="zone">
  <div class="tier-label">tier ${zone.tier} · convergence — unlocks when the tracks above land</div>
  <div class="row${single}" ${cols}>${cards}</div>
</div>`;
      }
      // Track-columns segment.
      const activeTracks = model.tracks.filter((t) =>
        zone.nodes.some((n) => (n.track ?? "general") === t),
      );
      const cols = activeTracks
        .map((track) => {
          const nodes = zone.nodes
            .filter((n) => (n.track ?? "general") === track)
            .sort((a, b) => {
              const ta = model.tier.get(a.id);
              const tb = model.tier.get(b.id);
              if (ta !== tb) return ta - tb;
              return a.id < b.id ? -1 : 1;
            });
          const idx = trackIndexOf(track);
          return `<div class="track-col">
  <h3 class="track-head" style="color: var(${trackColorVar(idx)});">${escapeHtml(track)}</h3>
  ${nodes.map((n) => nodeCard(n, model, { repoUrl, trackIndex: idx })).join("\n  ")}
</div>`;
        })
        .join("\n");
      const label =
        zone.fromTier === zone.toTier
          ? `tier ${zone.fromTier}`
          : `tiers ${zone.fromTier}–${zone.toTier}`;
      return `<div class="zone">
  <div class="tier-label">${label}</div>
  <div class="tracks" style="grid-template-columns: repeat(${activeTracks.length}, 1fr);">
${cols}
  </div>
</div>`;
    })
    .join("\n");

  // Edge data for the client-side SVG layer (drawn edges only; transitive
  // edges reduced — disclosed in the footer).
  const edgeData = [
    ...model.drawnHardEdges.map((e) => ({
      from: e.from,
      to: e.to,
      soft: false,
      color: `var(${
        model.criticalPathSet.has(e.from) && model.criticalPathSet.has(e.to)
          ? "--chain"
          : trackColorVar(trackIndexOf(beads.get(e.from)?.track))
      })`,
    })),
    ...model.softEdges.map((e) => ({
      from: e.from,
      to: e.to,
      soft: true,
      color: "var(--doc)",
    })),
  ];

  const victory = model.victory
    ? `<div class="victory">
  <div class="k">Victory condition</div>
  <div class="t" style="font-weight:600; margin-top:4px;">${escapeHtml(model.victory.title)}</div>
  <div class="what" style="color:var(--muted); font-size:13px; margin-top:4px;">${escapeHtml(firstSentence(model.victory.description))}</div>
</div>`
    : "";

  const waveRows = model.waves
    .map((wave, i) => {
      const trigger =
        i === 0
          ? "claimable now"
          : `when ${model.waves[i - 1].join(", ")} close`;
      const unlocks = model.waves[i + 1] ? model.waves[i + 1].join(", ") : "—";
      return `<tr>
  <td class="mono">wave ${i + 1}</td>
  <td>${escapeHtml(trigger)}</td>
  <td><span class="mono">${escapeHtml(wave.join(", "))}</span></td>
  <td><span class="mono">${escapeHtml(unlocks)}</span></td>
</tr>`;
    })
    .join("\n");

  const cycleWarning = model.cycleMembers.length
    ? `<div class="warning"><strong>Dependency cycle detected:</strong> <span class="mono">${escapeHtml(model.cycleMembers.join(", "))}</span> — run <code>bd dep cycles</code> and fix the wiring; tiers below exclude these beads.</div>`
    : "";

  const legendTracks = model.tracks
    .map(
      (t, i) =>
        `<span><span class="swatch" style="background: var(${trackColorVar(i)});"></span>${escapeHtml(t)}</span>`,
    )
    .join("\n  ");

  const body = `<div class="page">
<p class="eyebrow">${escapeHtml(config.phaseLabel ?? "beads DAG")} · updated ${escapeHtml(generatedAt)}</p>
<h1>${escapeHtml(title)}</h1>
<p class="lede">Why this order: the dependency graph, straight from <code>bd</code>. Hover or focus any card
to light up its full lineage — what it needs and what it unlocks; click pins. Cards with a red corner +
HUMAN OPS chip cannot reach done without a human operator. The copper chain is the critical path
(${model.criticalPath.length} deep) — everything else must fit inside its shadow.
See also the <a href="kanban.html">kanban board</a>.</p>
${cycleWarning}
<div class="stats">
  <div class="stat"><div class="n">${stats.totalOnBoard}</div><div class="l">beads on board</div></div>
  <div class="stat"><div class="n">${stats.done}</div><div class="l">done</div></div>
  <div class="stat"><div class="n">${stats.inProgress + stats.inReview}</div><div class="l">in flight</div></div>
  <div class="stat"><div class="n">${stats.criticalPathDepth}</div><div class="l">deep, critical path</div></div>
  <div class="stat"><div class="n">${stats.humanGated}</div><div class="l">need a human operator</div></div>
</div>
<div class="legend">
  ${legendTracks}
  <span><span class="swatch" style="background: var(--human);"></span>human ops required — hover the HUMAN OPS badge for the runbook</span>
  <span><span class="edge-sample"></span>hard dependency</span>
  <span><span class="edge-sample soft"></span>soft / related</span>
</div>
<div class="well" id="tree-board">
  <svg id="edges" aria-hidden="true"></svg>
${zoneHtml}
${victory}
</div>
<table class="waves">
  <thead><tr><th>Wave</th><th>Trigger</th><th>Claim</th><th>Unlocks</th></tr></thead>
  <tbody>
${waveRows || `<tr><td colspan="4">No open beads in the graph.</td></tr>`}
  </tbody>
</table>
<footer>bd is the source of truth; this page regenerates automatically on every bd mutation (and on
session start). Transitive edges are not drawn — <code>bd dep tree</code> has the full set. Direction is
always downward (blocker above, unlocked below).</footer>
</div>
<script type="application/json" id="edge-data">${JSON.stringify(edgeData).replaceAll("</", "<\\/")}</script>
${beadDataScript(beads)}`;

  return pageShell({
    title,
    faviconGlyph: "\u{1F5FA}",
    css: TREE_CSS,
    body,
    js: TREE_JS,
  });
}
