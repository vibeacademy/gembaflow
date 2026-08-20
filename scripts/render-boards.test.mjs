// Tests for the deterministic board renderer (scripts/render-boards.mjs and
// scripts/lib/boards/*). Fixtures under scripts/fixtures/boards/ are captured
// from a real bd 1.1.0 database (captured with a neutral el- id prefix).
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { loadFromFixture, hydrateHumanOpsNotes, parseBdJson } from "./lib/boards/data.mjs";
import { buildColumns, buildGraph, buildEpicGraph, columnOf } from "./lib/boards/graph.mjs";
import { beadDataScript, DETAIL_HTML, DETAIL_JS } from "./lib/boards/theme.mjs";

// How long jsdom needs after JSDOM() construction before inline <script> tags
// have finished evaluating (event listeners registered, DOM mutations applied).
// 30 ms is the empirically observed minimum; bump if tests become flaky.
const JSDOM_SETTLE_MS = 30;

/**
 * Flush one requestAnimationFrame turn in a JSDOM window deterministically.
 *
 * JSDOM with pretendToBeVisual:true supports rAF but never drives the frame
 * loop on its own — callbacks queue up and never fire unless explicitly
 * triggered.  This helper schedules a no-op rAF callback and awaits it,
 * which causes JSDOM to fire all previously queued rAF callbacks in order
 * before resolving.  Use it instead of a raw setTimeout when the code under
 * test draws via requestAnimationFrame (e.g. SVG edge drawing on load).
 *
 * @param {Window} win - The JSDOM window object.
 * @returns {Promise<void>}
 */
export async function waitForFrame(win) {
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "render-boards.mjs");
const FIXTURES = join(HERE, "fixtures", "boards");

function render(fixture, outDir) {
  const result = execFileSync(
    process.execPath,
    [ENTRY, "--fixture", join(FIXTURES, fixture), "--out", outDir],
    { encoding: "utf8" },
  );
  return result;
}

describe("parseBdJson (bd JSON hygiene, docs/BEADS.md gotchas 9-10)", () => {
  it("parses clean bd JSON unchanged", () => {
    expect(parseBdJson('[{"id":"el-1","title":"ok"}]')).toEqual([
      { id: "el-1", title: "ok" },
    ]);
  });

  it("tolerates raw control characters inside JSON strings (gotcha 9)", () => {
    // bd 1.1.0 can emit a literal tab (carried over from an issue body)
    // unescaped inside a JSON string; JSON.parse alone rejects it.
    const raw = '[{"id":"el-1","description":"a\tliteral\ttab\x00here"}]';
    expect(() => JSON.parse(raw)).toThrow(); // the quirk is real
    const parsed = parseBdJson(raw);
    expect(parsed).toEqual([
      { id: "el-1", description: "a literal tab here" },
    ]);
  });

  it("preserves legal inter-token whitespace and escaped sequences", () => {
    const parsed = parseBdJson('\n\t[ {"id": "el-1", "title": "tab\\tkept"} ]\n');
    expect(parsed).toEqual([{ id: "el-1", title: "tab\tkept" }]);
  });

  it("returns null (never throws) on garbage or non-string input", () => {
    expect(parseBdJson("bd: something went wrong")).toBeNull();
    expect(parseBdJson("")).toBeNull();
    expect(parseBdJson(null)).toBeNull();
    expect(parseBdJson(undefined)).toBeNull();
  });
});

describe("data + graph layer", () => {
  const state = loadFromFixture(join(FIXTURES, "happy"));

  it("parses label conventions", () => {
    const el7 = state.beads.get("el-7");
    expect(el7.campaign).toBe("pilot");
    expect(el7.track).toBe("library");
    expect(el7.inReview).toBe(true);
    expect(el7.prNumber).toBe(41);
    expect(el7.verdict).toBe("go");
  });

  it("hydrates Operator directions from notes for human-ops beads", () => {
    const el3 = state.beads.get("el-3");
    expect(el3.humanOps).toBe(true);
    // Notes carry two Operator blocks; the LAST block supersedes (append-only
    // notes with bd-note amendment semantics).
    expect(el3.operator.steps).toHaveLength(4);
    expect(el3.operator.summary).toMatch(/^Review the amended ADR/);
    expect(el3.operator.steps[2]).toMatch(/terraform apply/);
  });

  it("maps columns with PR-open as the operative in-review signal", () => {
    const cols = buildColumns(state.beads, state.readyIds);
    const ids = Object.fromEntries(
      Object.entries(cols).map(([k, v]) => [k, v.map((b) => b.id)]),
    );
    // el-15 is labeled in-review but never claimed (anti-pattern 5): it must
    // land in In Review, not Ready, even though bd ready lists it.
    expect(ids.inReview).toContain("el-15");
    expect(ids.ready).not.toContain("el-15");
    expect(ids.inReview).toEqual(expect.arrayContaining(["el-7", "el-8"]));
    expect(ids.icebox).toEqual(["el-11"]);
    expect(ids.done).toEqual(expect.arrayContaining(["el-2", "el-13"]));
    // el-4, el-5 are open but hard-blocked → backlog.
    expect(ids.backlog).toEqual(expect.arrayContaining(["el-4", "el-5"]));
    expect(ids.ready).toContain("el-3");
  });

  it("computes tiers, critical path, and waves deterministically", () => {
    const model = buildGraph(state.beads, state.readyIds, { campaign: "pilot" });
    expect(model.criticalPath).toEqual(["el-2", "el-3", "el-4", "el-5"]);
    expect(model.tier.get("el-5")).toBe(3);
    expect(model.cycleMembers).toEqual([]);
    // Wave 1 = claimable now (all blockers closed); el-2 is closed so el-3 leads.
    expect(model.waves[0]).toContain("el-3");
    expect(model.waves[0]).not.toContain("el-4");
  });

  it("drops transitive edges from the drawn set but keeps them in the graph", () => {
    const model = buildGraph(state.beads, state.readyIds, { campaign: "pilot" });
    const drawn = model.drawnHardEdges.map((e) => `${e.from}→${e.to}`);
    expect(model.hardEdges.map((e) => `${e.from}→${e.to}`)).toContain("el-2→el-5");
    expect(drawn).not.toContain("el-2→el-5");
    expect(drawn).toEqual(
      expect.arrayContaining(["el-2→el-3", "el-3→el-4", "el-4→el-5"]),
    );
  });

  it("hydrates human-ops notes in a single batched fetch, never N+1", () => {
    // Five human-ops beads missing notes + one already-hydrated + one
    // non-human-ops. The fetcher stands in for the `bd show` subprocess:
    // the batching contract is at most ONE call regardless of bead count.
    const mkBead = (id, extra = {}) => ({
      id,
      humanOps: true,
      notes: null,
      operator: null,
      ...extra,
    });
    const beads = new Map([
      ["h-1", mkBead("h-1")],
      ["h-2", mkBead("h-2")],
      ["h-3", mkBead("h-3")],
      ["h-4", mkBead("h-4")],
      ["h-5", mkBead("h-5")],
      ["h-6", mkBead("h-6", { notes: "already here" })],
      ["t-1", mkBead("t-1", { humanOps: false })],
    ]);
    const calls = [];
    hydrateHumanOpsNotes(beads, (ids) => {
      calls.push(ids);
      return ids.map((id) => ({ id, notes: `Operator: step for ${id}` }));
    });
    // Subprocess-count assertion: one batched call, N+1 is a regression.
    expect(calls.length).toBeLessThanOrEqual(1);
    expect(calls[0]).toEqual(["h-1", "h-2", "h-3", "h-4", "h-5"]); // pending only
    expect(beads.get("h-3").notes).toBe("Operator: step for h-3");
    expect(beads.get("h-3").operator.summary).toBe("step for h-3");
    expect(beads.get("h-6").notes).toBe("already here"); // untouched
    expect(beads.get("t-1").notes).toBeNull(); // non-human-ops never hydrated
  });

  it("skips the notes fetch entirely when no human-ops bead needs hydration", () => {
    const beads = new Map([
      ["t-1", { id: "t-1", humanOps: false, notes: null, operator: null }],
      ["h-1", { id: "h-1", humanOps: true, notes: "n", operator: null }],
    ]);
    let calls = 0;
    hydrateHumanOpsNotes(beads, () => {
      calls += 1;
      return [];
    });
    expect(calls).toBe(0);
  });

  it("excludes epics from the tree and treats parent-child as grouping", () => {
    const model = buildGraph(state.beads, state.readyIds, { campaign: "pilot" });
    expect(model.nodeIds.has("el-1")).toBe(false);
    // parent-child edges never appear as hard edges.
    expect(model.hardEdges.some((e) => e.from === "el-1" || e.to === "el-1")).toBe(false);
  });
});

describe("renderer output", () => {
  let outDir;
  let kanban;
  let techtree;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "boards-test-"));
    render("happy", outDir);
    kanban = readFileSync(join(outDir, "kanban.html"), "utf8");
    techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
  });

  it("renders byte-identical output on a double render (determinism)", () => {
    const outDir2 = mkdtempSync(join(tmpdir(), "boards-test-2-"));
    render("happy", outDir2);
    expect(readFileSync(join(outDir2, "kanban.html"), "utf8")).toBe(kanban);
    expect(readFileSync(join(outDir2, "techtree.html"), "utf8")).toBe(techtree);
  });

  it("renders the full chip vocabulary", () => {
    for (const chip of [
      "GO · PR #41 awaits merge",
      "NO-GO · PR #44 · fixing",
      "IN REVIEW · PR #47",
      "DONE · PR #38",
      "HUMAN OPS",
      "LOCKED",
      "AVAILABLE",
    ]) {
      expect(techtree).toContain(chip);
    }
    expect(kanban).toContain("GO · PR #41 awaits merge");
  });

  it("links PR chips to the GitHub PR", () => {
    expect(techtree).toContain('href="https://github.com/example-org/example-repo/pull/41"');
  });

  it("escapes hostile bead content in HTML contexts", () => {
    for (const html of [kanban, techtree]) {
      const outsideJson = html.replace(
        /<script type="application\/json"[^>]*>.*?<\/script>/gs,
        "",
      );
      expect(outsideJson).not.toMatch(/<script>alert/);
      expect(outsideJson).not.toMatch(/<img src=x onerror/);
      expect(outsideJson).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });

  it("keeps embedded JSON parseable with </ escaped", () => {
    const m = /<script type="application\/json" id="bead-data">([^]*?)<\/script>/.exec(
      techtree,
    );
    expect(m[1].includes("</")).toBe(false);
    const map = JSON.parse(m[1]);
    expect(map["el-14"].t).toContain("<script>alert(1)</script>");
  });

  it("holds WCAG AA contrast (>=4.5:1) for chip and text pairs in both themes", () => {
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    const themes = {
      light: {
        chipFg: "#ffffff", ink: "#1b2530", muted: "#5b6b7a", panel: "#ffffff",
        filled: ["#2f66a8", "#6d4fa8", "#1f7d3a", "#b3403a"],
      },
      dark: {
        chipFg: "#0f151c", ink: "#dee6ed", muted: "#8a98a6", panel: "#161e27",
        filled: ["#6b9bd8", "#a98bd4", "#6fbf8f", "#e0837c"],
      },
    };
    for (const [name, t] of Object.entries(themes)) {
      for (const bg of t.filled) {
        expect(ratio(t.chipFg, bg), `${name} chip-fg on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(t.ink, t.panel), `${name} ink on panel`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.muted, t.panel), `${name} muted on panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes no external requests (self-contained pages)", () => {
    for (const html of [kanban, techtree]) {
      expect(html).not.toMatch(/src="https?:/);
      expect(html).not.toMatch(/href="https?:\/\/(?!github\.com)/);
      expect(html).not.toMatch(/@import|fonts\.googleapis|cdn\./);
    }
  });

  it("embeds operator steps in bead-data and makes the HUMAN OPS chip interactive", () => {
    const m = /<script type="application\/json" id="bead-data">([^]*?)<\/script>/.exec(kanban);
    const map = JSON.parse(m[1]);
    expect(map["el-3"].o).toHaveLength(4);
    expect(kanban).toContain('chip human has-steps');
  });

  it("shows the operator runbook on HUMAN OPS chip hover and click (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const chip = doc.querySelector('.chip.human.has-steps[data-bead="el-3"]');
    expect(chip).toBeTruthy();
    chip.dispatchEvent(new dom.window.Event("mouseenter"));
    const flyout = doc.getElementById("flyout");
    expect(flyout.style.display).toBe("block");
    expect(flyout.textContent).toContain("Operator runbook");
    expect(flyout.querySelectorAll("ol.op-steps li").length).toBe(3); // compact limit
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const modal = doc.getElementById("modal");
    expect(modal.querySelectorAll("ol.op-steps li").length).toBe(4); // full runbook
    expect(modal.textContent).toContain("terraform apply");
  });

  it("shows flyout on bead-id hover and modal on click (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const chip = doc.querySelector('.chip.id.has-detail[data-bead="el-4"]');
    chip.dispatchEvent(new dom.window.Event("mouseenter"));
    const flyout = doc.getElementById("flyout");
    expect(flyout.style.display).toBe("block");
    expect(flyout.textContent).toContain("Wire credential chain");
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const overlay = doc.getElementById("modal-overlay");
    expect(overlay.style.display).toBe("flex");
    expect(doc.getElementById("modal").textContent).toContain("Wire credential chain");
    doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay.style.display).toBe("none");
  });

  it("campaign filter toggles non-campaign cards and recounts (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const campaignBtn = doc.querySelector('.filter button[data-mode="campaign"]');
    campaignBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(campaignBtn.getAttribute("aria-pressed")).toBe("true");
    expect(doc.getElementById("board").classList.contains("campaign-only")).toBe(true);
  });
});

describe("modal shows full bead description (#645, 420-char cap fix)", () => {
  // Regression: beadDataScript() used to cap the embedded description at 420
  // chars, so the detail modal — which renders b.d raw — silently ended mid-
  // sentence. The fix embeds the full description; the flyout keeps its
  // client-side 220+ellipsis preview. The fixture bead ld-1 has a >900-char
  // description so the two behaviors are distinguishable.
  let outDir;
  let kanban;
  let fullDesc;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "boards-long-desc-"));
    render("long-desc", outDir);
    kanban = readFileSync(join(outDir, "kanban.html"), "utf8");
    const state = loadFromFixture(join(FIXTURES, "long-desc"));
    fullDesc = state.beads.get("ld-1").description;
  });

  it("embeds the FULL >420-char description in bead-data (no build-time cap)", () => {
    // Sanity: the fixture description is well past the old 420-char cap.
    expect(fullDesc.length).toBeGreaterThan(900);
    const m = /<script type="application\/json" id="bead-data">([^]*?)<\/script>/.exec(kanban);
    const map = JSON.parse(m[1]);
    // The embedded value must be the complete description, not sliced to 420.
    expect(map["ld-1"].d).toBe(fullDesc);
    expect(map["ld-1"].d.length).toBe(fullDesc.length);
    expect(map["ld-1"].d).toContain("several hundred beads."); // the tail past 420
  });

  it("flyout shows the 220+ellipsis preview while the modal shows the full text (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const chip = doc.querySelector('.chip.id.has-detail[data-bead="ld-1"]');
    expect(chip).toBeTruthy();

    // Hover → flyout carries only the short ellipsized preview.
    chip.dispatchEvent(new dom.window.Event("mouseenter"));
    const flyout = doc.getElementById("flyout");
    expect(flyout.style.display).toBe("block");
    const preview = fullDesc.slice(0, 220) + "…";
    expect(flyout.textContent).toContain(preview);
    // The tail past 420 must NOT appear in the compact flyout.
    expect(flyout.textContent).not.toContain("several hundred beads.");

    // Click → modal shows the complete description.
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const overlay = doc.getElementById("modal-overlay");
    expect(overlay.style.display).toBe("flex");
    const modal = doc.getElementById("modal");
    expect(modal.textContent).toContain(fullDesc);
    // Explicitly assert the past-420 tail reaches the modal.
    expect(modal.textContent).toContain("several hundred beads.");
  });
});

describe("epic filter (kanban)", () => {
  let outDir;
  let kanban;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "boards-epic-"));
    render("epic-filter", outDir);
    kanban = readFileSync(join(outDir, "kanban.html"), "utf8");
  });

  it("renders the epic filter <select> with All epics, individual epics sorted by id, and No epic", () => {
    // Both epics must appear as options, sorted by id (ef-1 before ef-2).
    expect(kanban).toContain('id="epic-filter"');
    expect(kanban).toContain('<option value="">All epics</option>');
    expect(kanban).toContain('<option value="ef-1">ef-1');
    expect(kanban).toContain('<option value="ef-2">ef-2');
    expect(kanban).toContain('<option value="none">No epic</option>');
    // ef-1 must come before ef-2 in the DOM.
    const ef1Pos = kanban.indexOf('value="ef-1"');
    const ef2Pos = kanban.indexOf('value="ef-2"');
    expect(ef1Pos).toBeLessThan(ef2Pos);
    // No epic must come last.
    const noEpicPos = kanban.indexOf('value="none"');
    expect(noEpicPos).toBeGreaterThan(ef2Pos);
  });

  it("renders <label> paired to <select> for keyboard accessibility", () => {
    expect(kanban).toContain('<label for="epic-filter">');
    expect(kanban).toContain('id="epic-filter"');
  });

  it("adds a parent-epic chip on cards that have a parent", () => {
    // ef-3 is a child of ef-1; its card must carry the chip.
    expect(kanban).toContain('chip epic-chip');
    // The chip text must be the parent id.
    expect(kanban).toMatch(/chip epic-chip[^>]*>ef-1</);
    expect(kanban).toMatch(/chip epic-chip[^>]*>ef-2</);
  });

  it("embeds data-epic attribute on each card matching its parent", () => {
    // ef-3 is under ef-1 → data-epic="ef-1"
    expect(kanban).toContain('data-epic="ef-1"');
    // ef-5 is under ef-2 → data-epic="ef-2"
    expect(kanban).toContain('data-epic="ef-2"');
    // ef-6 has no parent → data-epic=""
    expect(kanban).toContain('data-epic=""');
  });

  it("epic filter: selecting ef-1 hides ef-2 cards and shows ef-1 cards (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const sel = doc.getElementById("epic-filter");
    sel.value = "ef-1";
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    // ef-3 is under ef-1 — must be visible.
    const ef3Card = doc.querySelector('.card[data-epic="ef-1"]');
    expect(ef3Card).toBeTruthy();
    expect(ef3Card.style.display).not.toBe("none");
    // ef-5 is under ef-2 — must be hidden.
    const ef5Card = doc.querySelector('.card[data-epic="ef-2"]');
    expect(ef5Card).toBeTruthy();
    expect(ef5Card.style.display).toBe("none");
    // Parentless ef-6 is hidden too.
    const ef6Card = doc.querySelector('.card[data-epic=""]');
    expect(ef6Card).toBeTruthy();
    expect(ef6Card.style.display).toBe("none");
  });

  it("epic filter: 'No epic' shows only parentless cards (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const sel = doc.getElementById("epic-filter");
    sel.value = "none";
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    // Cards with a parent must be hidden.
    const ef1Cards = doc.querySelectorAll('.card[data-epic="ef-1"]');
    ef1Cards.forEach((card) => {
      expect(card.style.display).toBe("none");
    });
    // Parentless cards must be visible.
    const ef6Card = doc.querySelector('.card[data-epic=""]');
    expect(ef6Card).toBeTruthy();
    expect(ef6Card.style.display).not.toBe("none");
  });

  it("campaign + epic intersection: only alpha+ef-1 cards visible (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    // Activate campaign filter.
    const campaignBtn = doc.querySelector('.filter button[data-mode="campaign"]');
    expect(campaignBtn).toBeTruthy();
    campaignBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    // Now activate epic filter for ef-1.
    const sel = doc.getElementById("epic-filter");
    sel.value = "ef-1";
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    // board must carry campaign-only CSS class.
    expect(doc.getElementById("board").classList.contains("campaign-only")).toBe(true);
    // ef-2 card is hidden by epic filter.
    const ef2Cards = doc.querySelectorAll('.card[data-epic="ef-2"]');
    ef2Cards.forEach((card) => {
      expect(card.style.display).toBe("none");
    });
  });

  it("filtered-empty placeholder appears when all cards in a column are hidden by epic filter (jsdom)", async () => {
    // ef-2 has only ef-5 (checkout) under it; that card lands in 'ready'.
    // When we filter to ef-1, the ready column's ef-5 card is hidden
    // and the filtered-empty notice should show.
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const sel = doc.getElementById("epic-filter");
    sel.value = "ef-2";
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    // ef-3 (under ef-1) is in Ready and must be hidden.
    // That means the 'inProgress' column (which has ef-4, under ef-1) will be empty after ef-2 filter.
    const inProgressCol = doc.querySelector(".col.inProgress");
    const fe = inProgressCol.querySelector(".filtered-empty");
    expect(fe).toBeTruthy();
    expect(fe.style.display).toBe("block");
  });

  it("recount updates column counts after epic filter (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    // Get baseline ready count.
    const readyCol = doc.querySelector(".col.ready");
    const countBefore = Number(readyCol.querySelector(".count").textContent);
    // Filter to ef-2: only ef-5 is under ef-2 and it's in ready.
    const sel = doc.getElementById("epic-filter");
    sel.value = "ef-2";
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const countAfter = Number(readyCol.querySelector(".count").textContent);
    expect(countAfter).toBeLessThan(countBefore);
    expect(countAfter).toBe(1); // only ef-5 under ef-2 in ready
  });

  it("'All epics' restores full card visibility after filtering (jsdom)", async () => {
    const dom = new JSDOM(kanban, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const sel = doc.getElementById("epic-filter");
    // First filter to ef-1.
    sel.value = "ef-1";
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    // Then reset to All.
    sel.value = "";
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    // ef-5 (under ef-2) must be visible again.
    const ef5Cards = doc.querySelectorAll('.card[data-epic="ef-2"]');
    ef5Cards.forEach((card) => {
      expect(card.style.display).not.toBe("none");
    });
  });
});

describe("epic-collapse graph", () => {
  const epicFixtureDir = join(FIXTURES, "epic-collapse");
  const state = loadFromFixture(epicFixtureDir);
  const epicModel = buildEpicGraph(state.beads, state.readyIds);

  it("derives cross-epic edges from bead-level blocks edges", () => {
    // ea-t1 (in ea-1) blocks eb-t1 (in eb-1) → cross-epic edge ea-1→eb-1
    const edgeKeys = epicModel.epicEdges.map((e) => `${e.from}→${e.to}`);
    expect(edgeKeys).toContain("ea-1→eb-1");
    // ec-1 has no cross-epic edges
    expect(edgeKeys.some((k) => k.startsWith("ec-1→") || k.endsWith("→ec-1"))).toBe(false);
  });

  it("computes epic status correctly (done/in-progress/blocked/ready)", () => {
    const nodeMap = new Map(epicModel.epicNodes.map((n) => [n.id, n]));
    // ea-1: 1 open (ea-t1), 1 closed (ea-t2) → not all closed, no in-flight → ready
    expect(nodeMap.get("ea-1").status).toBe("ready");
    // eb-1: eb-t2 is in_progress → in-progress
    expect(nodeMap.get("eb-1").status).toBe("in-progress");
    // ec-1: ec-t1 open, ec-t2 closed → not all closed, no in-flight, no incoming epic edges → ready
    expect(nodeMap.get("ec-1").status).toBe("ready");
  });

  it("collects loose beads into the __loose__ bucket (open only)", () => {
    // loose-1 (open, no parent) counts; loose-2 (closed, no parent) must NOT.
    // looseCount reflects the triage queue of genuinely open work, not history.
    expect(epicModel.looseCount).toBe(1);
  });

  it("computes epic critical path and transitive-reduces epic edges", () => {
    // Only edge: ea-1→eb-1, so critical path is [ea-1, eb-1]
    expect(epicModel.epicCriticalPath).toEqual(["ea-1", "eb-1"]);
    // drawnEpicEdges same as epicEdges (no transitive edges to remove here)
    expect(epicModel.drawnEpicEdges.map((e) => `${e.from}→${e.to}`)).toContain("ea-1→eb-1");
    // No cycle members
    expect(epicModel.cycleMembers).toEqual([]);
  });

  it("renders epic nodes with progress counts in techtree HTML", () => {
    const outDir = mkdtempSync(join(tmpdir(), "boards-epic-"));
    render("epic-collapse", outDir);
    const techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
    // ea-1: 1 closed, 2 total
    expect(techtree).toContain("1/2 closed");
    // ec-1: 1 closed, 2 total
    // eb-1: 0 closed, 2 total
    expect(techtree).toContain("0/2 closed");
    // Epic titles present
    expect(techtree).toContain("Infrastructure Epic");
    expect(techtree).toContain("Library Epic");
    expect(techtree).toContain("Core Library Epic");
  });

  it("renders byte-identical output on double render (determinism)", () => {
    const outDir1 = mkdtempSync(join(tmpdir(), "boards-epic-det1-"));
    const outDir2 = mkdtempSync(join(tmpdir(), "boards-epic-det2-"));
    render("epic-collapse", outDir1);
    render("epic-collapse", outDir2);
    const t1 = readFileSync(join(outDir1, "techtree.html"), "utf8");
    const t2 = readFileSync(join(outDir2, "techtree.html"), "utf8");
    expect(t1).toBe(t2);
  });

  it("draws SVG edges between epic cards in the browser (regression: .epic-card selector)", async () => {
    // The drawing script's card lookup must match .epic-card nodes — matching
    // only .card left the lookup map empty and silently skipped every epic edge.
    const outDir = mkdtempSync(join(tmpdir(), "boards-epic-edges-"));
    render("epic-collapse", outDir);
    const techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
    const dom = new JSDOM(techtree, { runScripts: "dangerously", pretendToBeVisual: true });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const win = dom.window;
    // Force a draw pass (script also draws on load).
    win.dispatchEvent(new win.Event("load"));
    // Use waitForFrame() to deterministically flush the rAF-driven SVG draw
    // pass rather than relying on a fixed sleep.  JSDOM never self-ticks the
    // frame loop; awaiting a queued rAF callback is the reliable flush.
    await waitForFrame(win);
    const svg = win.document.getElementById("edges");
    const paths = svg.querySelectorAll("path.edge");
    // The fixture derives at least the ea-1→eb-1 cross-epic edge.
    expect(paths.length).toBeGreaterThan(0);
    const pairs = [...paths].map((p) => p.getAttribute("data-from") + "→" + p.getAttribute("data-to"));
    expect(pairs).toContain("ea-1→eb-1");
  });

  it("drill-in data is embedded as parseable JSON", () => {
    const outDir = mkdtempSync(join(tmpdir(), "boards-epic-drill-"));
    render("epic-collapse", outDir);
    const techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
    const m = /<script type="application\/json" id="drill-in-data">([^]*?)<\/script>/.exec(techtree);
    expect(m).not.toBeNull();
    const drillData = JSON.parse(m[1]);
    // Should have entries for each epic
    expect(typeof drillData["ea-1"]).toBe("string");
    expect(typeof drillData["eb-1"]).toBe("string");
    expect(typeof drillData["ec-1"]).toBe("string");
    // The drill-in for ea-1 should mention infra tasks
    expect(drillData["ea-1"]).toContain("Infra task");
  });

  it("escapes hostile epic titles in epicCard() HTML output (XSS regression)", () => {
    const outDir = mkdtempSync(join(tmpdir(), "boards-epic-xss-"));
    render("epic-collapse", outDir);
    const techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
    // Strip embedded JSON blobs so we only assert on rendered HTML markup.
    const outsideJson = techtree.replace(
      /<script type="application\/json"[^>]*>.*?<\/script>/gs,
      "",
    );
    // The raw <script> payload must not appear in the epicCard() rendered HTML.
    expect(outsideJson).not.toMatch(/<script>alert/);
    // epicCard() must escape the hostile epic title with escapeHtml().
    expect(outsideJson).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");

    // The drill-in panel HTML (stored as pre-rendered HTML inside a JSON blob)
    // must also escape the hostile task title — covers the renderDrillIn() path.
    const drillM = /<script type="application\/json" id="drill-in-data">([^]*?)<\/script>/.exec(techtree);
    expect(drillM).not.toBeNull();
    const drillData = JSON.parse(drillM[1]);
    const drillHtml = drillData["ed-1"];
    expect(typeof drillHtml).toBe("string");
    // The raw img/onerror payload must not appear unescaped in the drill-in HTML.
    expect(drillHtml).not.toMatch(/<img src=x onerror/);
    // The properly escaped form must be present.
    expect(drillHtml).toContain("&quot;&gt;&lt;img src=x onerror=alert(2)&gt;");
  });

  it("no-epics fixture falls back gracefully to bead-level view", () => {
    // The 'happy' fixture has el-1 as an epic, but buildEpicGraph with no campaign
    // returns epics. Check that when epicModel has no epicNodes (empty fixture),
    // the bead-level view renders. Use the 'empty' fixture.
    const emptyState = loadFromFixture(join(FIXTURES, "empty"));
    const emptyEpicModel = buildEpicGraph(emptyState.beads, emptyState.readyIds);
    expect(emptyEpicModel.epicNodes).toHaveLength(0);
    // Render the empty fixture and confirm it shows the bead-level "no open beads" message
    const outDir = mkdtempSync(join(tmpdir(), "boards-epic-fallback-"));
    render("empty", outDir);
    const techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
    // Falls back to bead-level view which shows wave table with "No open beads"
    expect(techtree).toContain("No open beads");
    // No epic-overview div in bead-level fallback
    expect(techtree).not.toContain('id="epic-overview"');
  });
});

describe("campaign-mode drill-in with non-campaign children", () => {
  // Regression guard: when config.campaign is set the graph model is campaign-
  // filtered. renderDrillIn() must not throw when an epic has children outside
  // the campaign — those children have no entry in model.into / model.tier.
  // Before the fix, model.into.get(bead.id).some(...) threw on undefined.

  let outDir;
  let techtree;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), "boards-campaign-drillin-"));
    render("campaign-drillin", outDir);
    techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
  });

  it("exits 0 and renders techtree when epic has non-campaign children", () => {
    // render() would throw via execFileSync on non-zero exit. If we reach here,
    // exit code was 0 and the renderer did not throw for non-campaign children.
    expect(techtree).toContain('id="epic-overview"');
  });

  it("includes the non-campaign child card in the drill-in data", () => {
    const m = /<script type="application\/json" id="drill-in-data">([^]*?)<\/script>/.exec(techtree);
    expect(m).not.toBeNull();
    const drillData = JSON.parse(m[1]);
    // cd-epic-1 has two children: cd-task-a (campaign) and cd-task-b (non-campaign).
    // Both must appear in the drill-in HTML — non-campaign child rendered with
    // reduced info (tier "?") rather than omitted or throwing.
    expect(drillData["cd-epic-1"]).toContain("Campaign task in mixed epic");
    expect(drillData["cd-epic-1"]).toContain("Non-campaign task in mixed epic");
  });

  it("non-campaign child card uses fallback tier label", () => {
    const m = /<script type="application\/json" id="drill-in-data">([^]*?)<\/script>/.exec(techtree);
    const drillData = JSON.parse(m[1]);
    // cd-task-b is not in the campaign model, so its tier is unknown.
    // The guard should render "tier ?" rather than crashing.
    expect(drillData["cd-epic-1"]).toContain("tier ?");
    // cd-task-a IS in the campaign model, so its tier should be a number.
    expect(drillData["cd-epic-1"]).toContain("tier 0");
  });

  it("renders byte-identical output on double render (determinism preserved)", () => {
    const outDir2 = mkdtempSync(join(tmpdir(), "boards-campaign-drillin-2-"));
    render("campaign-drillin", outDir2);
    const techtree2 = readFileSync(join(outDir2, "techtree.html"), "utf8");
    expect(techtree2).toBe(techtree);
  });
});

describe("failure behavior", () => {
  it("exits 0 and renders empty boards for an empty database", () => {
    const outDir = mkdtempSync(join(tmpdir(), "boards-empty-"));
    render("empty", outDir); // execFileSync throws on nonzero exit
    const kanban = readFileSync(join(outDir, "kanban.html"), "utf8");
    expect(kanban).toContain("bd ready is empty");
  });

  it("exits 0 and renders a warning banner on dependency cycles", () => {
    const outDir = mkdtempSync(join(tmpdir(), "boards-cycle-"));
    render("cycle", outDir);
    const techtree = readFileSync(join(outDir, "techtree.html"), "utf8");
    expect(techtree).toContain("Dependency cycle detected");
    expect(techtree).toContain("cy-1");
    // The non-cycle bead still renders as a card.
    expect(techtree).toContain('id="n-cy-4"');
  });

  it("exits 0 as a silent no-op when the fixture dir is missing", () => {
    const outDir = mkdtempSync(join(tmpdir(), "boards-missing-"));
    render("does-not-exist", outDir);
    expect(existsSync(join(outDir, "kanban.html"))).toBe(true); // empty state renders
  });
});

describe("--check shape validator", () => {
  /** Run `render-boards.mjs --check` against a fixture; never throws. */
  function check(fixture) {
    try {
      const stdout = execFileSync(
        process.execPath,
        [ENTRY, "--check", "--fixture", join(FIXTURES, fixture)],
        { encoding: "utf8" },
      );
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      return {
        status: err.status,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      };
    }
  }

  it("exits 0 with an OK message on a healthy fixture", () => {
    const result = check("happy");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--check OK");
  });

  it("exits 0 on an empty tracker (valid shape)", () => {
    const result = check("empty");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--check OK");
  });

  it("exits 1 and names the drift when bd emits an unknown dependency type", () => {
    const result = check("drifted");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--check FAILED");
    expect(result.stderr).toContain('unknown dependency type "supersedes"');
    expect(result.stderr).toContain("dr-1");
  });

  it("catches field drift on a NON-first bead (checkShape validates every bead)", () => {
    // dr-3 is the THIRD bead in the drifted fixture and is missing `status`.
    // A sample-only validator (first bead) would miss it — the full-array
    // validator must name both the bead and the field.
    const result = check("drifted");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("normalized bead dr-3 missing field: status");
    // The healthy non-first beads produce no missing-field noise.
    expect(result.stderr).not.toContain("dr-2 missing field");
    expect(result.stderr).not.toContain("dr-1 missing field");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Modal markdown rendering — escape-first subset renderer (#688)
//
// Reference implementations:
//   • vibeacademy/website PR #303 (fork bead va-x35.11) — primary
//   • vibeacademy/jiujitsology PR #2 (bead jj-1xt) — secondary (fenced blocks,
//     ordered lists, heading-level offset h3+)
//
// Security invariant: esc() runs BEFORE mdToHtml(); mdToHtml receives an
// already-escaped string and applies only structural transforms to it.
// ──────────────────────────────────────────────────────────────────────────────
describe("modal markdown rendering (gh-gf-688)", () => {
  /** Build a minimal self-contained page with one chip + the detail system. */
  function makePage(beads) {
    const chips = beads
      .map(
        (b) =>
          `<span class="chip id has-detail" data-bead="${b.id}" tabindex="0">${b.id}</span>`,
      )
      .join("");
    return `<!doctype html><html><body>${chips}${DETAIL_HTML}${beadDataScript(
      new Map(beads.map((b) => [b.id, b])),
    )}<script>${DETAIL_JS}</script></body></html>`;
  }

  /** Construct a minimal bead object compatible with beadDataScript(). */
  function bead(id, description) {
    return {
      id,
      title: `Title for ${id}`,
      status: "open",
      priority: 2,
      type: "task",
      labels: [],
      description,
      deps: [],
      closeReason: null,
      operator: null,
    };
  }

  /** Open the modal for a given bead id and return the modal element. */
  async function openModal(beads, id) {
    const dom = new JSDOM(makePage(beads), {
      runScripts: "dangerously",
      pretendToBeVisual: true,
    });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    doc
      .querySelector(`.chip.id.has-detail[data-bead="${id}"]`)
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    return doc.getElementById("modal");
  }

  it("promotes markdown syntax to formatted tags in the full modal", async () => {
    const desc =
      "### Problem Statement\n\nThis bead tests **markdown rendering** in the board modal.\n\n- First bullet item\n- Second bullet item with **bold**\n- Third item with `code`";
    const modal = await openModal([bead("md-1", desc)], "md-1");
    const region = modal.querySelector(".desc.md");
    expect(region).toBeTruthy();

    // ATX heading → h-element (h3+ to avoid colliding with the modal's h2 title)
    const heading = region.querySelector("h3,h4,h5,h6");
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain("Problem Statement");

    // **bold** → <strong>
    const strong = region.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong.textContent).toContain("markdown rendering");

    // `code` → <code>
    const code = region.querySelector("code");
    expect(code).toBeTruthy();
    expect(code.textContent).toContain("code");

    // - bullets → <ul><li>
    const listItems = region.querySelectorAll("ul li");
    expect(listItems.length).toBeGreaterThanOrEqual(2);
    expect(region.querySelector("ul")).toBeTruthy();

    // No literal markdown syntax must leak into the rendered output
    expect(region.innerHTML).not.toContain("### ");
    expect(region.innerHTML).not.toContain("**");
  });

  it("renders a fenced code block as <pre><code>", async () => {
    const desc = "Before:\n\n```\nbd show md-2\nbd list\n```\n\nAfter.";
    const modal = await openModal([bead("md-2", desc)], "md-2");
    const pre = modal.querySelector(".desc.md pre code");
    expect(pre).toBeTruthy();
    expect(pre.textContent).toContain("bd show md-2");
    expect(pre.textContent).toContain("bd list");
  });

  it("renders an ordered list as <ol><li>", async () => {
    const desc = "Steps:\n\n1. First step\n2. Second step\n3. Third step";
    const modal = await openModal([bead("md-3", desc)], "md-3");
    const region = modal.querySelector(".desc.md");
    expect(region.querySelector("ol")).toBeTruthy();
    expect(region.querySelectorAll("ol li").length).toBe(3);
    expect(region.innerHTML).not.toContain("1. First");
  });

  it("flyout preview is plain ellipsized text — no markdown rendered", async () => {
    const desc =
      "### Problem Statement\n\nThis bead tests **markdown rendering** in the board modal.\n\n- First bullet item";
    const dom = new JSDOM(makePage([bead("md-4", desc)]), {
      runScripts: "dangerously",
      pretendToBeVisual: true,
    });
    await new Promise((r) => setTimeout(r, JSDOM_SETTLE_MS));
    const doc = dom.window.document;
    const chip = doc.querySelector('.chip.id.has-detail[data-bead="md-4"]');
    chip.dispatchEvent(new dom.window.Event("mouseenter"));
    const flyout = doc.getElementById("flyout");
    const flyoutDesc = flyout.querySelector(".desc");
    // Flyout must NOT render headings or bold — plain pre-wrap text only
    expect(flyoutDesc.querySelector("h3")).toBeNull();
    expect(flyoutDesc.querySelector("strong")).toBeNull();
    expect(flyoutDesc.querySelector("ul")).toBeNull();
    // The flyout .desc must NOT carry the .md class
    expect(flyoutDesc.classList.contains("md")).toBe(false);
  });

  it("escape-first: markdown description containing hostile HTML renders formatted but escaped (XSS guard, gh-gf-688)", async () => {
    // The description contains markdown structure AND hostile HTML payloads.
    // esc() runs first → < becomes &lt; before mdToHtml sees the string.
    // mdToHtml must NOT produce live <script> or <img onerror> nodes.
    const desc =
      "### Heading\n\n**bold** text and <script>alert(1)</script>\n\n- item with <img src=x onerror=alert(2)>";
    const modal = await openModal([bead("md-xss", desc)], "md-xss");
    const region = modal.querySelector(".desc.md");
    expect(region).toBeTruthy();

    // Structural markdown must still render (escape-first does not suppress structure)
    const heading = region.querySelector("h3,h4,h5,h6");
    expect(heading).toBeTruthy();
    expect(heading.textContent).toContain("Heading");
    const strong = region.querySelector("strong");
    expect(strong).toBeTruthy();

    // No live <script> node inside the modal
    expect(modal.querySelector("script")).toBeNull();

    // No live <img> with onerror inside the modal
    for (const img of modal.querySelectorAll("img")) {
      expect(img.getAttribute("onerror")).toBeNull();
    }

    // The text content must contain the visible (harmless) text, not be blank
    expect(region.textContent).toContain("alert");
  });
});
