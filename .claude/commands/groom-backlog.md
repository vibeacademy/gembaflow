---
description: Groom beads - complete DoR, set priorities, wire dependencies (bd ready is the outcome)
---

Launch the agile-backlog-prioritizer agent to perform comprehensive backlog grooming.

> **Core model**: Ready is COMPUTED, not curated. `bd ready` mechanically
> surfaces every open, unblocked bead — there is no "move to Ready" action.
> Grooming makes beads *become* ready: complete their Definition of Ready,
> set priority, and wire or clear dependencies. See CLAUDE.md
> § "Work-Item Tracking (Beads)" for the canonical board-model mapping.

## What This Command Does

1. **Review Product Strategy**
   - Read `docs/PRODUCT-REQUIREMENTS.md` for current goals
   - Read `docs/PRODUCT-ROADMAP.md` for current phase and milestones
   - Verify backlog reflects strategic priorities

2. **Analyze Backlog Health**
   - Count beads by status from `bd list --json --limit 0` and
     `bd ready --json --limit 0` (bd JSON hygiene: `docs/BEADS-CONVENTIONS.md`
     § "Script conventions" item 3),
     grouped per the CLAUDE.md § "Work-Item Tracking (Beads)" mapping
     (backlog = open minus ready; icebox = `--status=deferred`; etc.)
   - Assess ticket quality (descriptions, acceptance criteria, `effort:*` labels)
   - Identify stale beads (>30 days without activity)

3. **Prioritize Using CD3**
   - Calculate Cost of Delay / Duration for backlog items
   - Weight by user impact and business value
   - Consider feature dependencies

4. **Assess Ticket Scope**
   - For each bead being groomed toward ready, check:
     - One ticket = one deployable change (single PR)
     - If >3 files for unrelated reasons → flag for decomposition
     - If environment context exceeds 4 sentences → flag for decomposition
     - If happy path has >1 major branch point → flag for splitting
     - If effort estimate is XL → recommend breaking into smaller tickets
   - Tickets that fail scoping should be decomposed on the spot (create
     child beads with `bd create`) rather than allowed to become ready

5. **Ensure Definition of Ready**
   - Verify top tickets have clear titles and descriptions
   - Confirm acceptance criteria are specific and testable
   - Check `effort:<S/M/L/XL>` labels and priorities
   - Validate technical guidance is provided
   - Verify tickets include the 4 Power Sections (A. Environment Context, B. Guardrails, C. Happy Path, D. Definition of Done)
   - Reference `docs/TICKET-FORMAT.md` for the expected format

6. **Assign epics and wire dependencies at the bead level**
   - For each bead being groomed, assign it to an epic (`bd update <id> --parent <epic-id>`)
     or deliberately mark it loose (`bd note <id> "Deliberately loose: no epic fit"`).
     Loose is a valid first-class state — it is NOT incomplete grooming. The Loose-work
     bucket is a triage queue, not a shame bin. Never assign a bead to a
     marginally-related epic for tree visibility.
   - Wire dependencies at the true bead level only (`bd dep add <blocked>
     --blocked-by <blocker>` — explicit direction, **never bare `bd link`**,
     never epic-to-epic edges). Epic-to-epic edges in the tech tree are DERIVED
     from bead-level cross-epic blocking edges; they are a visualization output,
     not an input.
   - After ANY dependency wiring: `bd dep cycles --json` must return `[]`,
     then eyeball `bd ready` to confirm the intended beads surfaced.
   - Anti-Goodhart: the tech tree is a PROJECTION, never a TARGET. Never
     add or omit deps to make the DAG look tidier. If the tree looks wrong,
     the only legitimate fix is correcting data that is actually wrong.
     (See `.claude/agents/agile-backlog-prioritizer.md §6e` for the full
     non-negotiable guardrail list.)

7. **Make Beads Become Ready**
   - There is no "move to Ready" action — a bead becomes ready when it is
     open, unblocked, and its DoR is complete. For the top 2-5 candidates:
     complete the DoR, set priority (`bd update <id> -p <0-3>`).
   - Defer out-of-scope beads to the icebox: `bd update <id> --status=deferred`
   - Balance quick wins with strategic features

8. **Identify Issues**
   - Flag tickets needing refinement
   - Identify dependency conflicts
   - File open architecture questions as decision beads (`--type=decision`)
     and wire implementation beads as blocked by them
     (`bd dep add <impl> --blocked-by <decision>`) — decisions are physical
     gates, not comments
   - Flag beads that need human console work: add the `human-ops` label and
     `bd note <id> "Operator: <exact manual action>"`
   - Note scope creep or misalignment with roadmap

## Output

The agent will report:
- Backlog health metrics
- Beads that became ready this session
- Tickets needing refinement
- Scoping issues: tickets flagged for decomposition (too broad for single-PR agent implementation)
- Blockers and risks
- Recommendations for next grooming session

See `docs/TICKET-FORMAT.md` for the canonical ticket format specification.

### Output Format

End your output with a Result Block:

```
---

**Result:** Backlog groomed
Became ready: 4 beads (va-21, va-22, va-23, va-24)
Backlog remaining: 8 beads
Flags: 2 beads need refinement (va-30, va-31)
Dependency check: bd dep cycles --json → []
Boards: refreshed automatically (hook) — .gembaflow-boards/{kanban,techtree}.html
Next grooming: after current sprint completes
```
