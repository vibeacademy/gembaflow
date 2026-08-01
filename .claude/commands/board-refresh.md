---
description: Regenerate the HTML board projections (kanban + tech tree) from beads state
---

Regenerate the read-only board projections from the beads tracker.

The boards normally regenerate automatically — a Stop hook fires
`.claude/hooks/render-boards-on-bd.sh --refresh` once per assistant turn
(coalescing any number of `bd` mutations made during the turn into a single
render), and a SessionStart hook does the same hard refresh when a session
begins. Use this command when state changed outside those paths: mutations
made in another terminal, after a `bd dolt pull`, or mid-turn when you want
fresh boards before the turn ends.

## Steps

1. Run the renderer:

   ```bash
   node scripts/render-boards.mjs
   ```

2. If it produced no output (it is silent by design), confirm the boards are
   fresh by checking the last line of `.gembaflow-boards/render.log`.

3. Report the absolute paths of both boards and offer to open them:

   ```bash
   open .gembaflow-boards/kanban.html .gembaflow-boards/techtree.html
   ```

## Output format

```
---

**Result:** Boards regenerated from beads state
Kanban: <absolute path>/.gembaflow-boards/kanban.html
Tech tree: <absolute path>/.gembaflow-boards/techtree.html
Last render: <last line of render.log>
```

## Notes

- The boards are read-only projections; beads (`bd`) is the source of truth.
  Never edit the HTML by hand — the next render overwrites it.
- The kanban is the headline board. The tech tree is **experimental** and
  projection-only — never a planning input or a target; the anti-Goodhart
  guardrails in `docs/BEADS-CONVENTIONS.md` apply.
- The renderer always exits 0. Failures land in `.gembaflow-boards/render.log`,
  not on stderr.
- Campaign scoping, track order, and the victory bead come from
  `.gembaflow-boards.config.json` (committed).
