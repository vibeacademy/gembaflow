# Beads Conventions

The contract between agents (who write bd state) and the board renderer
(`scripts/render-boards.mjs`, which reads it). This document is the
**single canonical reference for the beads label vocabulary** and for the
conventions the board-model mapping does not cover: branch/PR conventions,
the full mechanical-hygiene rules, script conventions, board semantics
(epic-as-node, anti-Goodhart guardrails), and regen cadence.

One canonical location per fact (CLAUDE.md critical rule 7):

| Fact | Canonical location |
|------|--------------------|
| Board-model mapping (Backlog/Ready/In Progress/In Review/Done → bead states) | CLAUDE.md § "Work-Item Tracking (Beads)" |
| Label vocabulary, branch/PR conventions, hygiene rules, board semantics | This document |
| bd version pin, install, init sequence, upgrade procedure, fork migration | `docs/BEADS.md` |
| Anti-Goodhart grooming protocol (operational form) | `.claude/agents/agile-backlog-prioritizer.md` §6e |

## The tracker

Beads (`bd`) is the only issue tracker (CLAUDE.md critical rule 9). Issues
live in a local Dolt database under `.beads/`; sync rides the git origin on
hidden ref `refs/dolt/data`; `.beads/issues.jsonl` is a passive export —
grep it, never edit it. **Sync is a push**: `bd dolt push` / `bd dolt pull`
write against the git remote and sit behind an `ask` permission — agents
never sync autonomously; the operator syncs deliberately.

## Board-model mapping

The canonical mapping table lives in CLAUDE.md § "Work-Item Tracking
(Beads)" — reference it there; do not duplicate it. This document holds the
label vocabulary and conventions that table doesn't cover.

## Label vocabulary (renderer contract)

| Label | Written by | Meaning / board effect |
|-------|-----------|------------------------|
| `campaign:<slug>` | grooming/kickoff | campaign membership: copper border, kanban filter, tech-tree scope |
| `track:<name>` | creation/grooming | tech-tree column; unlabeled beads land in `general` |
| `human-ops` | anyone filing | cannot reach done without a human operator: red corner + interactive HUMAN OPS chip (hover = runbook flyout, click = full step modal). Directions via `bd note <id>` with an `Operator:` block — the prefix line plus numbered/bulleted step lines. Notes are append-only: the LAST `Operator:` block supersedes earlier ones, so amend runbooks by appending a fresh block |
| `in-review` + `pr:<N>` | worker, when the PR opens | In Review column, `IN REVIEW · PR #N` chip (linked). Highest `pr:` wins after a re-roll |
| `verdict:go` / `verdict:no-go` / `verdict:fixed` | reviewer (go/no-go), worker (fixed) | chip states `GO · PR #N awaits merge` / `NO-GO · fixing` / `fixed · re-review`. Mutually exclusive — remove the old one when transitioning. Full verdict prose still goes in `bd comment` |
| `safety:<class>` | grooming | drain safety class; **the bead label is the source of truth** — the worker copies it onto the PR at creation |
| `effort:<S/M/L/XL>` | grooming/migration | effort estimate (beads has no effort field) |

Waves and tiers are **computed** from the dependency graph — never labels.

## Branches and PRs

- Branch: `feature/<bead-id>-short-description` (e.g. `feature/va-3f2-checkout-webhook`).
- PR body cites the bead: `Bead: <id>`. `Closes #N` is retired.
- The worker copies the bead's `safety:*` label onto the PR at creation
  (the agent-merge gate reads it from the PR).
- After opening the PR: `bd update <id> --add-label in-review --add-label pr:<N>`
  and `bd comment <id> "PR: <url>"` — greppable in both directions.

## Mechanical hygiene (all agents, non-negotiable)

CLAUDE.md critical rule 10 is the always-in-context digest of this list;
this is the full statement.

1. Never `bd edit` or `bd create-form` (interactive — they hang agents).
   Always `bd update` flags. Both are permission-denied anyway.
2. Always `--json` when parsing bd output (see script conventions below).
3. Never mutate `.beads/issues.jsonl`.
4. `bd note` for scope amendments; never rewrite descriptions — the history
   of what was agreed must survive.
5. Never bare `bd link` (its default direction has burned live deployments).
   Always `bd dep add <blocked> --blocked-by <blocker>`. After ANY
   dependency-wiring session: `bd dep cycles` + eyeball `bd ready`.
6. Workers never `bd close`. Only the orchestrator/human path closes, and
   only after `gh pr view <N> --json state,mergedAt` confirms the merge.
7. `bd ready` is mechanical, not editorial — it does not check
   Definition-of-Ready completeness, and it surfaces epics and label-drifted
   beads. Consumers selecting work filter `--type=task`; treat output as
   "claimable", never "recommended".

## Script conventions (shell code that touches bd)

Two adoption gotchas from the reference fork (downstream report §4, items
3–4) are binding conventions for any script in this repo that calls `bd`:

1. **bd prose output is not a stable interface.** bd is an active 1.x; its
   prose changed between releases during the reference fork's own two-day
   experiment (the "no cycles" phrasing moved in bd 1.1.0 and a clean
   migration failed its own verification gate). Always `--json`, even in
   shell gates and one-off scripts. The framework already encodes this:
   `scripts/check-bd.sh` reads `bd version --json`, the migrator's
   verification gate reads `bd dep cycles --json`, and
   `scripts/render-boards.mjs --check` validates bd's JSON output shape on
   upgrades (`docs/BEADS.md` § "Upgrade procedure").
2. **Target macOS bash 3.2.** `set -u` plus an empty-array expansion aborts
   the script; the `${arr[@]+"${arr[@]}"}` guard is mandatory whenever an
   array can be empty. And any migration-style script must be idempotent,
   because it WILL die mid-run — converge on a stable key instead of
   duplicating (the migrator uses `--external-ref` as that key; see
   `scripts/migrate-issues-to-beads.sh` for the reference implementation of
   both rules).

## Boards

`.gembaflow-boards/{kanban,techtree}.html` — gitignored, generated,
read-only projections. Regenerated **once per turn** (Stop hook), on
session start, and manually via `/board-refresh`. Campaign/track/victory
config: `.gembaflow-boards.config.json` (committed). No agent or human ever
edits the HTML; no secondary writable board exists (GitHub Projects is
retired).

**The kanban is the headline board. The tech tree is experimental** — a
projection-only view whose value is still being evaluated. It ships because
it is cheap (same renderer, same data) and the anti-Goodhart guardrails
below make it safe to ignore; plan work from `bd ready` and the kanban, and
treat the tree as a map, never a scoreboard.

### Dark-theme contrast (erratum, already fixed here)

The reference boards handoff's dark-theme chip spec fails WCAG — white text
on its dark pastel chip colors lands around 1.9:1 contrast. The framework
renderer already ships the fix (downstream report §4, item 6): a
`--chip-fg` token per theme (white on dark, near-black on light) in
`scripts/lib/boards/theme.mjs`, contrast-asserted by a WCAG AA (>= 4.5:1)
test in `scripts/render-boards.test.mjs`. If you restyle the boards, keep
the contrast assertion green — do not reintroduce the erratum by copying
chip colors from the original handoff's Appendix A.

### Epic-as-node (tech tree)

The tech tree defaults to the epic-collapsed view:

- **Epic = node.** Each `--type=epic` bead is rendered as a single node.
  Node data: progress (closed/total children), derived status (done /
  in-progress / blocked / ready), and the epic's `track:` label.
- **Edges are derived.** An edge A → B exists in the epic DAG iff any bead
  in epic A blocks any bead in epic B. Edges are computed from bead-level
  blocking dependencies; they are NEVER wired directly between epics.
- **Loose work bucket.** Beads with no `--parent` epic collapse into a
  single greyed "Loose work (N)" bucket node. The bucket is excluded from
  the critical path; it is a triage queue reviewed each grooming session,
  not a shame bin.
- **Drill-in.** Clicking an epic node (or using the epic filter) re-renders
  the bead-level DAG scoped to that epic's children.
- **Epic filter.** Both boards expose an epic filter. The kanban filters by
  epic membership; the tech tree filter triggers drill-in mode.

### Grooming implications (anti-Goodhart guardrails)

The tech tree is a **projection** of bd state, never a target. These rules
govern every agent that reads or writes bd state (operational form:
`.claude/agents/agile-backlog-prioritizer.md` §6e):

1. **The tree is a read-only output.** `bd ready` / priorities / the
   dependency graph are the only legitimate planning inputs. The renderer
   reads bd state; nothing reads the renderer.
2. **Never add or omit deps to improve the DAG's appearance.** A dependency
   is wired iff the blocker literally prevents execution. If the tree looks
   wrong, the only fix is correcting data that is actually wrong.
3. **Deliberately-loose is a valid first-class state.** Never stuff a bead
   into a marginally-related epic for visibility. Mark loose beads
   explicitly with `bd note <id> "Deliberately loose: no epic fit"`.
4. **Epic boundaries follow closeable delivery scope, never visualization
   aesthetics.** Do not split or merge epics to improve the tree's
   appearance.
5. **The groomer reports what the data says.** `bd ready` is the *outcome*
   of grooming, not a goal to optimise against. If the ready queue looks
   surprising, investigate the data — never paper over it.

### Regen cadence

Regen fires once per turn (Stop hook,
`.claude/hooks/render-boards-on-bd.sh`) rather than on every mutating bd
command, coalescing any number of `bd` mutations in a turn into one render.
SessionStart hard-refreshes, and `/board-refresh` remains as the manual
escape hatch.

Historical note (reference fork PR #127 model): the prior per-mutation
PostToolUse gate used two strategies — a verb-regex fast path and a
jsonl-mtime freshness check — and cost ~300ms on each of 40+ commands
during grooming sessions. Both strategies are retired; the Stop hook
renders unconditionally at turn end — simpler and cheaper.

## Honest limits (where the warranty ends)

Adopted from the reference fork's downstream report §6, kept honest:

- **Humans have no write UI.** The rendered boards are read-only by design;
  every human mutation goes through the operator's terminal. Fine for a
  solo-operator fork. Multi-stakeholder forks — where non-terminal
  stakeholders must file or edit work items — need the `--external-ref`
  mirror pattern: keep GitHub Issues as the human-facing surface and mirror
  actionable items into beads with `bd create ... --external-ref gh-<N>`,
  exactly as the migrator and the grooming-intake path already do.
- **Cross-repo federation is untested.** One tracker spanning several repos
  (a meta board) has not been exercised here; it is under evaluation (the
  migrator's `--ref-prefix` exists so repo-qualified refs don't collide
  when it is). Do not architect around multi-repo beads yet.
- **Environment hygiene is out of band.** Misconfigured deploy-target and
  error-tracking environment variables (Sentry DSNs, Render service ids)
  caused two of the reference fork's four drain findings. The framework can
  lint for these but not fix them — they are operator responsibilities.
- **bd 1.x churn is real.** The CLI surface moved even during the reference
  fork's two-day experiment. The framework's countermeasure is the hard
  version pin plus the loud gate (`scripts/check-bd.sh`) and the renderer
  shape-validator (`scripts/render-boards.mjs --check`); on any upgrade,
  follow `docs/BEADS.md` § "Upgrade procedure" to the letter.
