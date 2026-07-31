// Kanban board renderer (Appendix A.5): six columns projected from bd state,
// campaign filter, epic filter dropdown, collapsed pre-campaign done history,
// empty states that say why they're empty.

import {
  escapeHtml,
  statusChip,
  idChip,
  priorityChip,
  humanOpsChip,
  beadDataScript,
  pageShell,
} from "./theme.mjs";

const COLUMNS = [
  { key: "backlog", title: "Backlog", color: "--doc", query: "bd list --status=open (minus bd ready)" },
  { key: "ready", title: "Ready", color: "--lib", query: "bd ready" },
  { key: "inProgress", title: "In Progress", color: "--int", query: "bd update <id> --claim" },
  { key: "inReview", title: "In Review", color: "--gate", query: "in-review + pr:<N> labels (PR open)" },
  { key: "done", title: "Done", color: "--win", query: "bd close <id> --reason=..." },
  { key: "icebox", title: "Icebox", color: "--line", query: "bd update <id> --status=deferred" },
];

const KANBAN_CSS = `
.filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 14px; }
.filter button {
  border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  border-radius: 99px; padding: 4px 14px; font: 600 12px ui-monospace, "SF Mono", Menlo, monospace;
  cursor: pointer;
}
.filter button[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.filter .epic-filter-group { display: flex; align-items: center; gap: 6px; margin-left: 8px; }
.filter .epic-filter-group label {
  font: 600 12px ui-monospace, "SF Mono", Menlo, monospace;
  color: var(--muted); white-space: nowrap;
}
.filter .epic-filter-group select {
  border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  border-radius: 6px; padding: 4px 8px; font: 12px ui-monospace, "SF Mono", Menlo, monospace;
  cursor: pointer; appearance: auto;
}
.filter .epic-filter-group select:focus { outline: 2px solid var(--int); outline-offset: 2px; }
.board {
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(238px, 1fr);
  gap: 12px; overflow-x: auto; padding-bottom: 8px;
}
.col {
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px;
  border-top: 3px solid var(--line); padding: 10px; min-height: 120px;
}
${COLUMNS.map((c) => `.col.${c.key} { border-top-color: var(${c.color}); }`).join("\n")}
.col h2 {
  display: flex; align-items: center; gap: 8px; margin: 2px 4px 2px;
  font-size: 14px; letter-spacing: .1em; text-transform: uppercase;
}
.col h2 .count {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 99px;
  padding: 0 8px; font-variant-numeric: tabular-nums;
}
.col .query { margin: 0 4px 10px; font-size: 10.5px; color: var(--muted); }
.card {
  position: relative; background: var(--panel); border: 1px solid var(--line);
  border-radius: 9px; padding: 8px 10px; margin-bottom: 8px; box-shadow: var(--shadow);
}
.card.pilot { border-left: 3px solid var(--chain); }
.card.human-ops::after {
  content: ""; position: absolute; top: 0; right: 0;
  border-top: 18px solid var(--human); border-left: 18px solid transparent;
  border-top-right-radius: 9px;
}
.card .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
.card .t { font-size: 12.5px; font-weight: 600; line-height: 1.35; }
.card .sub { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px; color: var(--muted); margin-top: 4px; }
.chip.epic-chip { color: var(--muted); font-size: 10px; }
.empty {
  border: 1px dashed var(--line); border-radius: 9px; padding: 12px;
  color: var(--muted); font-style: italic; font-size: 12.5px;
}
.filtered-empty {
  border: 1px dashed var(--line); border-radius: 9px; padding: 12px;
  color: var(--muted); font-style: italic; font-size: 12.5px; display: none;
}
details.history { margin-top: 6px; }
details.history summary {
  cursor: pointer; font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px; color: var(--muted);
}
details.history li { font-size: 12px; margin: 4px 0; }
.board.campaign-only .card:not(.pilot) { display: none; }
@media (max-width: 860px) {
  .stats { gap: 14px 20px; }
}
`;

const KANBAN_JS = `
(function () {
  var board = document.getElementById('board');
  var buttons = document.querySelectorAll('.filter button');
  var epicSelect = document.getElementById('epic-filter');
  // campaignOnly: true = show only pilot cards; epicFilter: '' = all, 'none' = no parent, else epic id
  var campaignOnly = false;
  var epicFilter = '';

  function applyFilters() {
    board.classList.toggle('campaign-only', campaignOnly);
    var cards = board.querySelectorAll('.card');
    cards.forEach(function (card) {
      var epicVal = card.getAttribute('data-epic') || '';
      var epicMatch = epicFilter === '' ||
        (epicFilter === 'none' ? epicVal === '' : epicVal === epicFilter);
      // Campaign filter is handled via CSS class; epic filter via inline display.
      if (!epicMatch) {
        card.style.display = 'none';
      } else {
        card.style.display = '';
      }
    });
    // Show/hide per-column filtered-empty notices.
    board.querySelectorAll('.col').forEach(function (col) {
      var visibleCards = 0;
      col.querySelectorAll('.card').forEach(function (card) {
        var epicVal = card.getAttribute('data-epic') || '';
        var epicMatch = epicFilter === '' ||
          (epicFilter === 'none' ? epicVal === '' : epicVal === epicFilter);
        var campaignMatch = !campaignOnly || card.classList.contains('pilot');
        if (epicMatch && campaignMatch) visibleCards++;
      });
      var fe = col.querySelector('.filtered-empty');
      if (fe) fe.style.display = visibleCards === 0 ? 'block' : 'none';
    });
    recount();
  }

  function recount() {
    board.querySelectorAll('.col').forEach(function (col) {
      var n = 0;
      col.querySelectorAll('.card').forEach(function (card) {
        var epicVal = card.getAttribute('data-epic') || '';
        var epicMatch = epicFilter === '' ||
          (epicFilter === 'none' ? epicVal === '' : epicVal === epicFilter);
        var campaignMatch = !campaignOnly || card.classList.contains('pilot');
        if (epicMatch && campaignMatch) n++;
      });
      col.querySelector('.count').textContent = n;
    });
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      campaignOnly = btn.dataset.mode === 'campaign';
      applyFilters();
    });
  });

  if (epicSelect) {
    epicSelect.addEventListener('change', function () {
      epicFilter = epicSelect.value;
      applyFilters();
    });
  }
})();
`;

function emptyReason(key, campaign) {
  const reasons = {
    backlog: "no open beads are waiting on grooming or blockers",
    ready: "nothing open and unblocked — bd ready is empty",
    inProgress: "no beads are claimed right now",
    inReview: "no open PRs — nothing labeled in-review",
    done: "no beads closed yet",
    icebox: "nothing deferred",
  };
  return reasons[key] ?? "empty";
}

/** Inline epic-parent chip — avoids touching theme.mjs to prevent merge conflict. */
function epicChip(epicId) {
  return `<span class="chip epic-chip">${escapeHtml(epicId)}</span>`;
}

function card(bead, { campaign, repoUrl }) {
  const classes = ["card"];
  if (campaign && bead.campaign === campaign) classes.push("pilot");
  if (bead.humanOps) classes.push("human-ops");
  const chips = [idChip(bead), priorityChip(bead)];
  if (bead.parent) chips.push(epicChip(bead.parent));
  if (bead.status === "blocked" || bead.blockedHint) {
    chips.push(`<span class="chip blocked">blocked</span>`);
  }
  chips.push(statusChip(bead, { repoUrl }));
  if (bead.humanOps) chips.push(humanOpsChip(bead, "HUMAN"));
  const subParts = [];
  if (bead.type !== "task") subParts.push(bead.type);
  if (bead.operator) {
    const n = bead.operator.steps.length;
    subParts.push(`Operator: ${bead.operator.summary}${n > 1 ? ` (+${n - 1} steps)` : ""}`);
  }
  if (bead.status === "closed" && bead.closedAt) {
    subParts.push(`closed ${bead.closedAt.slice(0, 10)}`);
  }
  const sub = subParts.length
    ? `<div class="sub">${escapeHtml(subParts.join(" · "))}</div>`
    : "";
  // data-epic enables client-side epic filtering; empty string = no parent.
  return `<article class="${classes.join(" ")}" data-epic="${escapeHtml(bead.parent ?? "")}">
  <div class="chips">${chips.join(" ")}</div>
  <div class="t">${escapeHtml(bead.title)}</div>
  ${sub}
</article>`;
}

function doneColumn(beadsInDone, { campaign, repoUrl }) {
  const campaignDone = campaign
    ? beadsInDone.filter((b) => b.campaign === campaign)
    : beadsInDone;
  const history = campaign
    ? beadsInDone.filter((b) => b.campaign !== campaign)
    : [];
  let html = campaignDone.map((b) => card(b, { campaign, repoUrl })).join("\n");
  if (!campaignDone.length && !history.length) {
    html = `<div class="empty">${escapeHtml(emptyReason("done"))}</div>`;
  }
  // Filtered-empty placeholder shown by JS when the active epic/campaign combo yields zero cards.
  html += `<div class="filtered-empty">No items match the active filter.</div>`;
  if (history.length) {
    html += `
<details class="history">
  <summary>${history.length} earlier closure${history.length === 1 ? "" : "s"} (pre-campaign)</summary>
  <ul>
    ${history
      .map(
        (b) =>
          `<li>${idChip(b)} ${escapeHtml(b.title)}${b.closeReason ? ` — <span class="mono">${escapeHtml(b.closeReason)}</span>` : ""}</li>`,
      )
      .join("\n    ")}
  </ul>
</details>`;
  }
  return html;
}

/**
 * Collect epics present in the beads map, sorted deterministically by id.
 * Returns an array of { id, title } objects.
 */
function collectEpics(beads) {
  const epics = [];
  const seen = new Set();
  // Collect beads that are explicitly typed as epics.
  for (const bead of beads.values()) {
    if (bead.type === "epic" && !seen.has(bead.id)) {
      epics.push({ id: bead.id, title: bead.title });
      seen.add(bead.id);
    }
  }
  // Also include parent ids referenced by tasks that might not be in the
  // beads map (unusual but defensive).
  for (const bead of beads.values()) {
    if (bead.parent && !seen.has(bead.parent)) {
      const parentBead = beads.get(bead.parent);
      epics.push({ id: bead.parent, title: parentBead ? parentBead.title : bead.parent });
      seen.add(bead.parent);
    }
  }
  epics.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return epics;
}

export function renderKanban({ columns, beads, stats, config, repoUrl, generatedAt }) {
  const campaign = config.campaign ?? null;
  const title = config.title ? `${config.title} — Kanban` : "Kanban — the beads board";
  const epics = collectEpics(beads);

  const colsHtml = COLUMNS.map((c) => {
    const items = columns[c.key];
    let body;
    if (c.key === "done") {
      body = doneColumn(items, { campaign, repoUrl });
    } else if (!items.length) {
      // Static empty state (no items at all) + filtered-empty placeholder.
      body = `<div class="empty">${escapeHtml(emptyReason(c.key, campaign))}</div>` +
        `<div class="filtered-empty">No items match the active filter.</div>`;
    } else {
      body = items.map((b) => card(b, { campaign, repoUrl })).join("\n") +
        `\n<div class="filtered-empty">No items match the active filter.</div>`;
    }
    return `<section class="col ${c.key}">
  <h2>${escapeHtml(c.title)} <span class="count">${items.length}</span></h2>
  <p class="query"><code>${escapeHtml(c.query)}</code></p>
  ${body}
</section>`;
  }).join("\n");

  // Epic filter select — rendered only when there is at least one epic.
  const epicSelectHtml = epics.length
    ? `<div class="epic-filter-group">
  <label for="epic-filter">Epic:</label>
  <select id="epic-filter">
    <option value="">All epics</option>
    ${epics.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.id)} — ${escapeHtml(e.title)}</option>`).join("\n    ")}
    <option value="none">No epic</option>
  </select>
</div>`
    : "";

  // Campaign filter pills + epic dropdown combined.
  const filterControls = campaign || epics.length
    ? `<div class="filter" role="group" aria-label="Board filter">${
        campaign
          ? `\n  <button type="button" data-mode="all" aria-pressed="true">All beads</button>\n  <button type="button" data-mode="campaign" aria-pressed="false">Campaign: ${escapeHtml(campaign)}</button>`
          : ""
      }${epicSelectHtml ? `\n  ${epicSelectHtml}` : ""}
</div>`
    : "";

  const body = `<div class="page">
<p class="eyebrow">${escapeHtml(config.phaseLabel ?? "beads board")} · updated ${escapeHtml(generatedAt)}</p>
<h1>${escapeHtml(title)}</h1>
<p class="lede">A read-only projection of <code>bd</code> — beads stays the source of truth.
Cards move when tracker state changes; this page regenerates automatically on every bd mutation.
See also the <a href="techtree.html">tech tree</a> for dependency strategy.</p>
${filterControls}
<div class="stats">
  <div class="stat"><div class="n">${stats.columnCounts.done}</div><div class="l">done</div></div>
  <div class="stat"><div class="n">${stats.columnCounts.inProgress}</div><div class="l">in progress</div></div>
  <div class="stat"><div class="n">${stats.columnCounts.inReview}</div><div class="l">in review</div></div>
  <div class="stat"><div class="n">${stats.columnCounts.ready}</div><div class="l">ready</div></div>
  <div class="stat"><div class="n">${stats.humanGated}</div><div class="l">need a human</div></div>
</div>
<div class="board" id="board">
${colsHtml}
</div>
<footer>bd is the source of truth; this page is regenerated automatically on every bd mutation
(and on session start). Refresh your browser to see the latest.</footer>
</div>
${beadDataScript(beads)}`;

  return pageShell({
    title,
    faviconGlyph: "\u{1F4CB}",
    css: KANBAN_CSS,
    body,
    js: KANBAN_JS,
  });
}
