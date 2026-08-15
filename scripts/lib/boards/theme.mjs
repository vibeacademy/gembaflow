// Shared visual system for both boards, implementing Appendix A.1–A.3 and A.6
// of docs/plans/beads/gembaflow-upstream-boards-handoff.md: design tokens,
// typography, chip vocabulary, and the bead-detail flyout + modal.
//
// Both pages are fully self-contained: inline CSS, inline vanilla JS, no
// external requests. All dynamic strings are HTML-escaped before injection.

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escape JSON for embedding inside <script type="application/json">. */
export function escapeScriptJson(json) {
  return json.replaceAll("</", "<\\/");
}

// A.1 design tokens. Track colors cycle through the palette in track order.
export const TRACK_PALETTE = ["chain", "gate", "lib", "int", "doc"];

export function trackColorVar(trackIndex) {
  return `--${TRACK_PALETTE[trackIndex % TRACK_PALETTE.length]}`;
}

export const TOKEN_CSS = `
:root {
  --bg: #f1f3f6; --panel: #ffffff; --panel-2: #e9edf2;
  --ink: #1b2530; --muted: #5b6b7a; --line: #d3dae2;
  --chain: #a85f1f; --gate: #6d4fa8; --lib: #1f7d70;
  --int: #2f66a8; --doc: #5b6b7a; --win: #1f7d3a; --human: #b3403a;
  --chip-fg: #ffffff;
  --shadow: 0 1px 2px rgba(16,24,32,.06), 0 4px 14px rgba(16,24,32,.05);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f151c; --panel: #161e27; --panel-2: #1d2733;
    --ink: #dee6ed; --muted: #8a98a6; --line: #2a3644;
    --chain: #d08a4a; --gate: #a98bd4; --lib: #4baf9f;
    --int: #6b9bd8; --doc: #93a3b2; --win: #6fbf8f; --human: #e0837c;
  --chip-fg: #0f151c;
    --shadow: 0 1px 2px rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.3);
  }
}
:root[data-theme="light"] {
  --bg: #f1f3f6; --panel: #ffffff; --panel-2: #e9edf2;
  --ink: #1b2530; --muted: #5b6b7a; --line: #d3dae2;
  --chain: #a85f1f; --gate: #6d4fa8; --lib: #1f7d70;
  --int: #2f66a8; --doc: #5b6b7a; --win: #1f7d3a; --human: #b3403a;
  --chip-fg: #ffffff;
  --shadow: 0 1px 2px rgba(16,24,32,.06), 0 4px 14px rgba(16,24,32,.05);
}
:root[data-theme="dark"] {
  --bg: #0f151c; --panel: #161e27; --panel-2: #1d2733;
  --ink: #dee6ed; --muted: #8a98a6; --line: #2a3644;
  --chain: #d08a4a; --gate: #a98bd4; --lib: #4baf9f;
  --int: #6b9bd8; --doc: #93a3b2; --win: #6fbf8f; --human: #e0837c;
  --chip-fg: #0f151c;
  --shadow: 0 1px 2px rgba(0,0,0,.35), 0 4px 14px rgba(0,0,0,.3);
}
`;

export const BASE_CSS = `
* { box-sizing: border-box; }
html { overflow-x: hidden; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
h1, h2, h3, .display {
  font-family: "Avenir Next Condensed", "Avenir Next", Futura, "Trebuchet MS", sans-serif;
  text-wrap: balance;
}
code, .mono {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
a { color: var(--int); }
.page { max-width: 1280px; margin: 0 auto; padding: 28px 20px 60px; }
.eyebrow {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 6px;
}
h1 { font-size: 30px; margin: 0 0 8px; }
.lede { color: var(--muted); max-width: 72ch; margin: 0 0 20px; }
.lede a { color: var(--int); }
footer {
  margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--line);
  color: var(--muted); font-size: 12.5px;
}
:focus-visible { outline: 2px solid var(--int); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}

/* --- chips (A.3) --- */
.chip {
  display: inline-block; border-radius: 99px; padding: 1px 8px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px; line-height: 1.6; border: 1px solid var(--line);
  color: var(--ink); white-space: nowrap; vertical-align: middle;
}
.chip.id { font-weight: 700; }
.chip.id.has-detail { border-bottom: 1px dotted var(--muted); cursor: pointer; }
.chip.p0 { border-color: var(--chain); color: var(--chain); font-weight: 700; }
.chip.p1 { border-color: var(--int); color: var(--int); }
.chip.p2, .chip.p3, .chip.p4 { color: var(--muted); }
.chip.available { border-color: var(--win); color: var(--win); font-weight: 700; }
.chip.in-progress { background: var(--int); border-color: var(--int); color: var(--chip-fg); }
.chip.in-review { background: var(--gate); border-color: var(--gate); color: var(--chip-fg); }
a.chip.in-review, a.chip.done-chip { text-decoration: none; }
a.chip.in-review:hover, a.chip.done-chip:hover { text-decoration: underline; filter: brightness(1.12); }
.chip.done-chip { background: var(--win); border-color: var(--win); color: var(--chip-fg); }
.chip.locked, .chip.blocked { border-style: dashed; color: var(--muted); }
.chip.human { background: var(--human); border-color: var(--human); color: var(--chip-fg); font-weight: 700; }
.chip.human.has-steps { cursor: pointer; border-bottom: 2px dotted var(--chip-fg); }
#flyout ol.op-steps, #modal ol.op-steps { margin: 6px 0 0 0; padding-left: 20px; }
#flyout ol.op-steps li { font-size: 12px; margin: 3px 0; }
#modal ol.op-steps li { font-size: 14px; margin: 8px 0; line-height: 1.5; }
#modal .op-head { color: var(--human); font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 4px; }
.chip.type-chip { color: var(--muted); }

/* --- stat strip --- */
.stats {
  display: flex; flex-wrap: wrap; gap: 22px 36px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px;
  margin: 18px 0; box-shadow: var(--shadow);
}
.stat .n {
  font-family: "Avenir Next Condensed", "Avenir Next", Futura, "Trebuchet MS", sans-serif;
  font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.stat .l {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--muted);
}

/* --- flyout + modal (A.6) --- */
#flyout {
  position: fixed; z-index: 40; max-width: 380px; background: var(--panel);
  border: 1px solid var(--line); border-left: 3px solid var(--int);
  border-radius: 10px; padding: 12px 14px; box-shadow: var(--shadow);
  pointer-events: none; display: none; font-size: 13px;
}
#flyout .head { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
#flyout .t { font-weight: 600; margin-bottom: 6px; }
#flyout .row { color: var(--muted); font-size: 12px; margin: 2px 0; }
#flyout .reason { color: var(--win); }
#flyout .hint { margin-top: 8px; font-size: 11px; color: var(--muted); font-style: italic; }
#modal-overlay {
  position: fixed; inset: 0; z-index: 50; background: rgba(10,15,20,.5);
  display: none; align-items: center; justify-content: center; padding: 24px;
}
#modal {
  background: var(--panel); border-radius: 14px; max-width: 620px; width: 100%;
  max-height: 80vh; overflow: auto; padding: 20px 24px; box-shadow: var(--shadow);
}
#modal .head { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
#modal h2 { margin: 0 0 10px; font-size: 20px; }
#modal .row { margin: 6px 0; font-size: 14px; }
#modal .row b { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-right: 6px; }
#modal .desc { white-space: pre-wrap; }
#modal .reason { color: var(--win); }
`;

/**
 * Status chip HTML for one bead (shared vocabulary, A.3 + §4.2).
 * `blocked` = has unclosed hard blockers (tech tree LOCKED state).
 * `repoUrl` enables PR links.
 */
export function statusChip(bead, { blocked = false, repoUrl = null } = {}) {
  const pr = bead.prNumber;
  const prUrl = pr && repoUrl ? `${repoUrl}/pull/${pr}` : null;
  const link = (text, cls) =>
    prUrl
      ? `<a class="chip ${cls}" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`
      : `<span class="chip ${cls}">${escapeHtml(text)}</span>`;

  if (bead.status === "closed") {
    let n = pr;
    if (n === null && bead.closeReason) {
      const m = /PR #(\d+)/.exec(bead.closeReason);
      if (m) n = Number(m[1]);
    }
    const label = n ? `DONE · PR #${n}` : "DONE";
    return n && repoUrl
      ? `<a class="chip done-chip" href="${escapeHtml(`${repoUrl}/pull/${n}`)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
      : `<span class="chip done-chip">${escapeHtml(label)}</span>`;
  }
  if (pr !== null || bead.inReview) {
    const n = pr ?? "?";
    if (bead.verdict === "go") return link(`GO · PR #${n} awaits merge`, "in-review");
    if (bead.verdict === "no-go") return link(`NO-GO · PR #${n} · fixing`, "in-review");
    if (bead.verdict === "fixed") return link(`PR #${n} · fixed · re-review`, "in-review");
    return link(`IN REVIEW · PR #${n}`, "in-review");
  }
  if (bead.status === "in_progress" || bead.status === "hooked") {
    return `<span class="chip in-progress">IN PROGRESS</span>`;
  }
  if (blocked) return `<span class="chip locked">LOCKED</span>`;
  return `<span class="chip available">AVAILABLE</span>`;
}

export function idChip(bead) {
  return `<span class="chip id has-detail" data-bead="${escapeHtml(bead.id)}" tabindex="0">${escapeHtml(bead.id)}</span>`;
}

/** HUMAN OPS chip — interactive (flyout/modal with operator steps) when steps exist. */
export function humanOpsChip(bead, label = "HUMAN OPS") {
  if (bead.operator && bead.operator.steps.length) {
    return `<span class="chip human has-steps" data-bead="${escapeHtml(bead.id)}" tabindex="0" role="button" aria-label="Operator directions for ${escapeHtml(bead.id)}">${escapeHtml(label)}</span>`;
  }
  return `<span class="chip human">${escapeHtml(label)}</span>`;
}

export function priorityChip(bead) {
  const p = Math.min(Math.max(bead.priority, 0), 4);
  return `<span class="chip p${p}">P${p}</span>`;
}

/** Embedded bead-detail JSON map for the flyout/modal (A.6). */
export function beadDataScript(beads) {
  const map = {};
  const ids = [...beads.keys()].sort();
  for (const id of ids) {
    const b = beads.get(id);
    map[id] = {
      t: b.title,
      s: b.status,
      p: `P${b.priority}`,
      y: b.type,
      l: b.labels,
      d: b.description ?? "",
      k: b.deps.filter((d) => d.type === "blocks").map((d) => d.blocker).sort(),
      r: b.closeReason ?? null,
      o: b.operator ? b.operator.steps : null,
    };
  }
  return `<script type="application/json" id="bead-data">${escapeScriptJson(JSON.stringify(map))}</script>`;
}

/** Flyout + modal markup and behavior (A.6). */
export const DETAIL_HTML = `
<div id="flyout" role="tooltip" aria-hidden="true"></div>
<div id="modal-overlay">
  <div id="modal" role="dialog" aria-modal="true" aria-label="Bead detail"></div>
</div>
`;

export const DETAIL_JS = `
(function () {
  var data = {};
  try { data = JSON.parse(document.getElementById('bead-data').textContent); } catch (e) {}
  var flyout = document.getElementById('flyout');
  var overlay = document.getElementById('modal-overlay');
  var modal = document.getElementById('modal');
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function stepsHtml(steps, limit) {
    var items = limit ? steps.slice(0, limit) : steps; // 0 = no limit
    var h = '<ol class="op-steps">';
    for (var i = 0; i < items.length; i++) h += '<li>' + esc(items[i]) + '</li>';
    h += '</ol>';
    if (limit && steps.length > limit) h += '<div class="hint">+' + (steps.length - limit) + ' more — click the badge for the full runbook</div>';
    return h;
  }
  function detailHtml(id, full) {
    var b = data[id];
    if (!b) return '';
    var h = '<div class="head">' + esc(id) + ' · ' + esc(b.p) + ' · ' + esc(b.y) + ' · ' + esc(b.s) + '</div>';
    h += full ? '<h2>' + esc(b.t) + '</h2>' : '<div class="t">' + esc(b.t) + '</div>';
    if (b.l && b.l.length) h += '<div class="row"><b>labels</b> ' + esc(b.l.join(', ')) + '</div>';
    if (b.k && b.k.length) h += '<div class="row"><b>blocked by</b> ' + esc(b.k.join(', ')) + '</div>';
    if (b.d) h += '<div class="row desc">' + esc(full ? b.d : b.d.slice(0, 220) + (b.d.length > 220 ? '…' : '')) + '</div>';
    if (b.o && b.o.length) h += '<div class="row"><b>operator</b>' + stepsHtml(b.o, full ? 0 : 2) + '</div>';
    if (b.r) h += '<div class="row reason"><b>closed</b> ' + esc(b.r) + '</div>';
    if (!full) h += '<div class="hint">click id for the full card</div>';
    return h;
  }
  function operatorHtml(id, full) {
    var b = data[id];
    if (!b || !b.o || !b.o.length) return '';
    var h = '<div class="op-head">Operator runbook · ' + esc(id) + '</div>';
    h += full ? '<h2>' + esc(b.t) + '</h2>' : '<div class="t">' + esc(b.t) + '</div>';
    h += stepsHtml(b.o, full ? 0 : 3);
    if (!full) h += '<div class="hint">click for the full runbook</div>';
    return h;
  }
  function showFlyout(chip, id, renderer) {
    if (!data[id]) return;
    flyout.innerHTML = (renderer || detailHtml)(id, false);
    flyout.style.display = 'block';
    var r = chip.getBoundingClientRect();
    var top = r.bottom + 8;
    flyout.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 396)) + 'px';
    flyout.style.top = top + 'px';
    var fr = flyout.getBoundingClientRect();
    if (fr.bottom > window.innerHeight - 8) {
      flyout.style.top = Math.max(8, r.top - fr.height - 8) + 'px';
    }
  }
  function hideFlyout() { flyout.style.display = 'none'; }
  function openModal(id, renderer) {
    if (!data[id]) return;
    modal.innerHTML = (renderer || detailHtml)(id, true);
    overlay.style.display = 'flex';
  }
  function closeModal() { overlay.style.display = 'none'; }
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); hideFlyout(); } });
  function bindChip(chip, id, renderer) {
    chip.addEventListener('mouseenter', function () { showFlyout(chip, id, renderer); });
    chip.addEventListener('mouseleave', hideFlyout);
    chip.addEventListener('focus', function () { showFlyout(chip, id, renderer); });
    chip.addEventListener('blur', hideFlyout);
    chip.addEventListener('click', function (e) { e.stopPropagation(); hideFlyout(); openModal(id, renderer); });
    chip.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); hideFlyout(); openModal(id, renderer); }
    });
  }
  document.querySelectorAll('.chip.id.has-detail').forEach(function (chip) {
    var id = chip.getAttribute('data-bead');
    if (!data[id]) { chip.classList.remove('has-detail'); chip.removeAttribute('tabindex'); return; }
    bindChip(chip, id, detailHtml);
  });
  document.querySelectorAll('.chip.human.has-steps').forEach(function (chip) {
    var id = chip.getAttribute('data-bead');
    if (!data[id] || !data[id].o) { chip.classList.remove('has-steps'); chip.removeAttribute('tabindex'); return; }
    bindChip(chip, id, operatorHtml);
  });
})();
`;

/** Inline SVG favicon as a data URI; stable across republishes. */
export function favicon(glyph) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="1" y="13" font-size="13">${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Common page scaffold. */
export function pageShell({ title, faviconGlyph, css, body, js }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${favicon(faviconGlyph)}">
<style>${TOKEN_CSS}${BASE_CSS}${css}</style>
</head>
<body>
${body}
${DETAIL_HTML}
<script>${DETAIL_JS}</script>
<script>${js}</script>
</body>
</html>
`;
}
