# `/swarm` Epic + Child Issues — Draft for Review

**Target repo for issues:** `vibeacademy/agile-flow-meta`
**Target repo for PRs/code:** `vibeacademy/agile-flow`
**Format:** matches #71 (children) and #54 (epic)
**Expected issue numbers:** epic = #72, children = #73–#78 (assumes nothing else gets filed first)

---

## Epic #72 — /swarm: parallel ticket implementations with preview comparison

**Title:** `epic: /swarm command for parallel ticket implementations`

**Body:**

```markdown
## Epic: /swarm -- Parallel Implementations with Preview Comparison

### Vision

Add a `/swarm` slash command that takes a single ticket and spawns N parallel implementations in isolated worktrees. Each variant lands as its own PR with its own preview environment, so a human can compare approaches live and pick the winner. Turns "which UX treatment is better?" from a paper debate into a side-by-side gemba walk.

### Problem Statement

Today, `/work-ticket` produces one implementation per ticket. For tickets where multiple reasonable approaches exist (different UX treatments, different perf trade-offs, different levels of refactoring), picking the right one on paper is guesswork. The human can only review what the single worker produced -- there is no way to compare alternatives without sequential, expensive rework.

The preview-environment infrastructure already supports per-PR isolation (Render previews + Supabase branch DBs). `/swarm` exploits that capability: fan out N implementations, let previews run in parallel, let the human pick.

### Features Included

- [ ] #73 -- Add `.claude/worktrees/` to `.gitignore` (P1, XS)
- [ ] #74 -- Create `swarm-planner` agent definition (P1, S)
- [ ] #75 -- Create `/swarm` slash command (P1, M)
- [ ] #76 -- Extend `github-ticket-worker` for swarm mode (P1, S)
- [ ] #77 -- Create `docs/SWARM-WORKFLOW.md` (P1, S)
- [ ] #78 -- Wire `/swarm` into `CLAUDE.md` and `README.md` (P1, XS)

### Dependencies

- #73 is independent, do first (prevents worktree accumulation polluting commits).
- #74 must complete before #75 (the command invokes the planner agent).
- #75 and #76 must both complete before end-to-end testing.
- #77 and #78 land last (document what was built).

### Success Criteria

- `/swarm <issue> --variants 3` produces 3 PRs, each on its own branch, each with its own preview URL.
- Each variant is visibly distinct (planner generates distinct briefs before any code is written).
- Human can click through preview URLs in under 1 minute from swarm completion.
- No account-switch collisions, no branch-name collisions, no shared-state corruption between variants.
- A failed-build variant does not block the other variants; it gets labeled `swarm-failed` and stays open as a data point.

### Design Document

Full design lives in `docs/plans/SWARM-COMMAND-PLAN.md` on the `feature/issue-72-swarm-epic` branch (or wherever this epic's design doc is persisted).

### Scope: v1 (this epic) vs v2 (future)

**In scope for v1:**
- The `/swarm` command with planner, fan-out, serialized PR creation, summary comment
- DoR enforcement, cost warning, `--yes` skip flag
- Default 3 variants, max 5

**Deliberately deferred to v2:**
- `/swarm-pick <variant>` command to merge winner + close losers in one shot
- Auto-cleanup of worktrees after merge
- Cross-variant quality ranking by `pr-reviewer`
- Multi-account worker pools (variant-specific bot accounts)

### Effort Estimate

Total: ~1.5-2 days across 6 tickets (1 XS, 1 S, 1 M, 1 S, 1 S, 1 XS).

### Priority

P1 -- High-leverage framework capability. Not blocking any other epic.
```

---

## Issue #73 — Add `.claude/worktrees/` to `.gitignore`

**Title:** `chore: gitignore .claude/worktrees/`

**Body:**

```markdown
## Problem Statement

`.claude/worktrees/` currently appears as untracked in `git status` output and is not in `.gitignore`. As `/swarm` lands, this directory will frequently contain multiple active worktrees (one per variant). Without gitignore, contributors will accidentally commit worktree metadata and the `git status` noise obscures real changes.

**Parent Epic:** #72 -- /swarm command for parallel ticket implementations
**Effort Estimate:** XS
**Priority:** P1

---

## A. Environment Context

- Project: agile-flow (Markdown/Bash/YAML template repo)
- Key reference files:
  - `.gitignore` -- the file to modify
  - `.claude/worktrees/` -- the directory to ignore (contains live git worktrees for parallel agent work)
- Files to modify:
  - MODIFY `.gitignore`

---

## B. Guardrails

- Do NOT remove or relocate existing worktrees on disk -- those are live working trees.
- Do NOT add `.claude/` wholesale -- only the `worktrees/` subdirectory should be ignored.
- Do NOT add a wildcard that would ignore legitimate `.claude/` content (agents, commands, hooks, settings).

---

## C. Happy Path

1. Add the line `.claude/worktrees/` to `.gitignore` in an appropriate section (e.g., near other local/ephemeral paths).
2. Verify `git status` no longer lists `.claude/worktrees/` as untracked.
3. Verify that `git status` still surfaces legitimate `.claude/` changes (e.g., touch `.claude/agents/test.md` and confirm it shows).

---

## D. Definition of Done

- [ ] `.gitignore` contains `.claude/worktrees/`
- [ ] `git status` in a clean tree does not mention `.claude/worktrees/`
- [ ] `git check-ignore .claude/worktrees/` returns a match
- [ ] No other `.claude/` paths are inadvertently ignored
```

---

## Issue #74 — Create `swarm-planner` agent definition

**Title:** `feat(agents): add swarm-planner agent`

**Body:**

```markdown
## Problem Statement

`/swarm` needs a planner step that reads a ticket and generates N distinct implementation briefs before any code is written. Without a planner, N parallel workers converge on identical implementations because they all read the same ticket and follow the same instincts. The planner is the cheapest human-in-the-loop checkpoint -- it ensures the variants are actually different before spending compute.

**Parent Epic:** #72 -- /swarm command for parallel ticket implementations
**Effort Estimate:** S
**Priority:** P1

---

## A. Environment Context

- Project: agile-flow (Markdown/Bash/YAML template repo)
- Key reference files:
  - `.claude/agents/github-ticket-worker.md` -- reference for agent file structure (frontmatter, NON-NEGOTIABLE PROTOCOL block, workflow sections)
  - `.claude/agents/system-architect.md` -- another reference for agent format
  - `docs/TICKET-FORMAT.md` -- canonical ticket format; planner must understand this to read tickets intelligently
  - `docs/plans/SWARM-COMMAND-PLAN.md` -- design doc, see "Phase 1: The Planner" section
- Files to create:
  - CREATE `.claude/agents/swarm-planner.md`

---

## B. Guardrails

- Agent MUST NOT write code, create branches, or create PRs -- its only output is Markdown briefs.
- Agent MUST NOT modify the ticket or the board.
- Agent MUST refuse to proceed if the ticket does not meet Definition of Ready.
- Agent MUST produce **distinct** angles, not minor variations -- e.g., "modal vs inline vs progressive disclosure", not "blue button vs green button".
- Follow the frontmatter + NON-NEGOTIABLE PROTOCOL + workflow structure used by `github-ticket-worker.md`.

---

## C. Happy Path

1. Create `.claude/agents/swarm-planner.md` with:
   - Frontmatter: `name`, `description`, `model` (sonnet), `color`
   - NON-NEGOTIABLE PROTOCOL block listing boundaries (no code, no branches, no board edits, DoR enforcement)
   - Workflow section covering:
     - Read the ticket body and acceptance criteria
     - Verify DoR is met (Environment Context, Guardrails, Happy Path, Definition of Done all present)
     - Generate N distinct implementation angles (where N comes from the caller)
     - For each angle, produce a ~100-word brief: the core idea, what makes it distinct from the others, the expected trade-offs
     - Write all briefs to `reports/swarms/issue-{N}-briefs.md` with a header summarizing the ticket and listing the N angles
   - Example inputs/outputs showing a ticket with 3 distinct UX angles

---

## D. Definition of Done

- [ ] `.claude/agents/swarm-planner.md` exists and follows the existing agent file pattern
- [ ] Frontmatter includes name, description, model, color
- [ ] NON-NEGOTIABLE PROTOCOL block is present and explicit about what the agent cannot do
- [ ] Workflow section describes inputs (ticket, N), outputs (briefs file), and the DoR check
- [ ] File contains at least one concrete example showing N=3 distinct angles
- [ ] No other agent files modified
```

---

## Issue #75 — Create `/swarm` slash command

**Title:** `feat(cmd): add /swarm command for parallel ticket implementations`

**Body:**

```markdown
## Problem Statement

Add the `/swarm` slash command that orchestrates the full workflow: planner -> fan-out -> parallel workers -> aggregate comment. This is the user-facing surface of the feature. Without it, the planner agent (#74) and worker extension (#76) have nothing to connect them.

**Parent Epic:** #72 -- /swarm command for parallel ticket implementations
**Effort Estimate:** M
**Priority:** P1

**Depends on:** #74 (planner agent)

---

## A. Environment Context

- Project: agile-flow (Markdown/Bash/YAML template repo)
- Key reference files:
  - `.claude/commands/work-ticket.md` -- closest structural analog (pre-flight, critical rules, reference material sections)
  - `.claude/commands/upgrade.md` -- smaller command following the same pattern
  - `.claude/agents/swarm-planner.md` -- the planner this command invokes (lands in #74)
  - `.claude/agents/github-ticket-worker.md` -- the worker this command invokes in parallel (extended in #76)
  - `docs/plans/SWARM-COMMAND-PLAN.md` -- design doc, see "Workflow" and "Phase 3: Parallel Implementation" sections
- Files to create:
  - CREATE `.claude/commands/swarm.md`

---

## B. Guardrails

- Command MUST verify Definition of Ready before launching any workers.
- Command MUST print a cost estimate and require confirmation unless `--yes` is passed.
- Command MUST serialize PR creation across variants (avoid `va-worker` account-switch races).
- Command MUST refuse to run if the ticket is already "In Progress" on the board.
- Command MUST NOT auto-merge any PR.
- Command MUST NOT move losing variants' PRs to closed (v1 leaves that to the human; v2 adds `/swarm-pick`).
- Default variant count: 3. Maximum: 5. Reject `--variants 1` (pointless) and `--variants >5`.
- Failed-build variants get labeled `swarm-failed` and left open -- failures are information.

---

## C. Happy Path

1. Create `.claude/commands/swarm.md` with:
   - Frontmatter (description, optionally model/color)
   - Pre-flight verification: gh auth status, board accessible, ticket exists, ticket meets DoR, ticket not already In Progress
   - Critical Rules section listing all guardrails above
   - Reference material describing the 5-phase workflow:
     1. **Plan** -- invoke `swarm-planner` to produce N briefs, pause for human confirmation unless `--yes`
     2. **Fan out** -- create N worktrees under `.claude/worktrees/swarm-{issue}-{a,b,c,...}/`, create N branches `feature/issue-{N}-{slug}-variant-{a,b,c,...}`, move ticket to In Progress (once)
     3. **Parallel implementation** -- invoke N `github-ticket-worker` agents in parallel via Task tool, each scoped to its worktree/branch/brief
     4. **Serialize PR creation** -- as workers finish, open PRs one at a time (avoids account-switch race)
     5. **Aggregate** -- post summary comment on the ticket listing PR links, preview URLs, and briefs; move ticket to In Review
   - Cost-warning template showing estimated compute + build minutes
   - Result Block at the end (per AGENT-OUTPUT-STANDARD)

---

## D. Definition of Done

- [ ] `.claude/commands/swarm.md` exists and follows the existing command file pattern
- [ ] Pre-flight section checks: gh auth, board access, ticket DoR, ticket not In Progress
- [ ] Critical Rules section enumerates all guardrails
- [ ] Reference material documents all 5 phases with enough detail to execute
- [ ] Cost-warning template is present and mentions `--yes` skip flag
- [ ] Branch naming convention documented: `feature/issue-{N}-{slug}-variant-{letter}`
- [ ] Result Block at the end matches AGENT-OUTPUT-STANDARD.md format
- [ ] `/swarm` appears correctly when `/` is typed in a Claude Code session (format validation)
```

---

## Issue #76 — Extend `github-ticket-worker` for swarm mode

**Title:** `feat(agents): add swarm mode to github-ticket-worker`

**Body:**

```markdown
## Problem Statement

When `/swarm` invokes `github-ticket-worker` in parallel, each worker receives a pre-assigned worktree, pre-assigned branch, and a variant brief. The current worker is designed for sequential solo work: it selects tickets itself, creates its own branch, and moves the ticket to "In Progress" (which the orchestrator now handles once). Swarm mode must bypass these steps.

This is the one place the single-worker assumption is relaxed. It touches a NON-NEGOTIABLE PROTOCOL block and deserves careful review.

**Parent Epic:** #72 -- /swarm command for parallel ticket implementations
**Effort Estimate:** S
**Priority:** P1

**Depends on:** #73 (gitignore worktrees)

---

## A. Environment Context

- Project: agile-flow (Markdown/Bash/YAML template repo)
- Key reference files:
  - `.claude/agents/github-ticket-worker.md` -- the file being modified; the NON-NEGOTIABLE PROTOCOL block at the top must not be weakened
  - `docs/plans/SWARM-COMMAND-PLAN.md` -- design doc, see "Phase 3: Parallel Implementation Details"
- Files to modify:
  - MODIFY `.claude/agents/github-ticket-worker.md` (add swarm-mode section)

---

## B. Guardrails

- Do NOT weaken the existing NON-NEGOTIABLE PROTOCOL. Worker still cannot merge PRs, cannot push to main, cannot move tickets to Done.
- Do NOT remove the "one at a time" rule for solo work. Parallelism applies only in swarm mode, and the parallelism is enforced by the orchestrator (`/swarm`), not the worker.
- Swarm mode MUST be explicit: it activates only when the invoker passes a worktree path, branch name, and variant brief. Without all three, the worker falls back to normal solo behavior.
- In swarm mode, the worker MUST NOT move the ticket to In Progress (orchestrator does it once).
- In swarm mode, the worker MUST still create a PR, tag it with `swarm-variant-{letter}` label, and move the ticket to In Review only if it is the last variant to finish. (Or: always attempt the move, orchestrator handles idempotence. Pick one and document it in this ticket's PR.)
- In swarm mode, if the build fails, the worker MUST label its PR `swarm-failed` and still open the PR -- failures are information.

---

## C. Happy Path

1. Add a "Swarm Mode" section to `.claude/agents/github-ticket-worker.md` below the existing workflow section.
2. Document the three inputs that activate swarm mode: worktree path, branch name, variant brief.
3. Document how swarm mode differs from solo mode (skips ticket selection, skips branch creation, skips In Progress move, follows orchestrator-assigned naming).
4. Document the PR labeling: all swarm PRs get `swarm-variant-{letter}`; failed builds also get `swarm-failed`.
5. Document that swarm mode respects all NON-NEGOTIABLE PROTOCOL rules (still cannot merge, etc.).

---

## D. Definition of Done

- [ ] `.claude/agents/github-ticket-worker.md` has a "Swarm Mode" section
- [ ] NON-NEGOTIABLE PROTOCOL block is unchanged
- [ ] "One at a time" rule for solo work is preserved
- [ ] Swarm-mode activation criteria are explicit (three required inputs)
- [ ] PR labeling rules documented: `swarm-variant-{letter}`, `swarm-failed`
- [ ] Ticket-movement behavior in swarm mode is documented unambiguously
- [ ] PR reviewer requests explicit approval for the protocol-section changes
```

---

## Issue #77 — Create `docs/SWARM-WORKFLOW.md`

**Title:** `docs: add SWARM-WORKFLOW.md`

**Body:**

```markdown
## Problem Statement

`/swarm` is a new workflow pattern with non-obvious mechanics: parallel workers, worktrees, preview comparison, human-pick step. Without a user-facing guide, workshop participants who see `/swarm` in the command list won't know when to use it, how to compare previews, or how to close losing variants.

**Parent Epic:** #72 -- /swarm command for parallel ticket implementations
**Effort Estimate:** S
**Priority:** P1

**Depends on:** #75 (command must exist before it can be documented)

---

## A. Environment Context

- Project: agile-flow (Markdown/Bash/YAML template repo)
- Key reference files:
  - `docs/UPGRADING.md` -- structural analog (participant-facing guide for a new command)
  - `docs/EPHEMERAL-PR-ENVIRONMENTS.md` -- existing doc explaining preview environments
  - `docs/BRANCHING-STRATEGY.md` -- existing branch-naming conventions
  - `.claude/commands/swarm.md` -- the command being documented (lands in #75)
  - `docs/plans/SWARM-COMMAND-PLAN.md` -- design doc
- Files to create:
  - CREATE `docs/SWARM-WORKFLOW.md`

---

## B. Guardrails

- Do NOT duplicate design-doc content; reference it.
- Do NOT document internal implementation details (worktree paths, orchestrator phases); focus on participant experience.
- Do NOT prescribe a decision framework for picking variants (that's user judgment).
- Keep it concise -- aim for one readable page, not an exhaustive manual.

---

## C. Happy Path

1. Create `docs/SWARM-WORKFLOW.md` covering:
   - **When to use `/swarm`** -- tickets with multiple reasonable approaches (UX, perf, refactor depth); not for bug fixes or trivially-scoped work
   - **How to invoke** -- `/swarm <issue> --variants N` with examples
   - **What happens** -- brief recap of planner -> fan out -> parallel PRs -> summary comment (link to design doc for details)
   - **How to compare previews** -- where to find the preview URLs (summary comment on the issue), how to click through, what to look for
   - **How to pick a winner** -- merge the chosen PR normally; close the losers with a comment linking to the winner; mention future `/swarm-pick` command
   - **Handling failed variants** -- PRs labeled `swarm-failed` are information, not garbage; read them before closing
   - **Cost awareness** -- swarm costs N× compute + N× preview builds; default 3, max 5
   - **Limitations in v1** -- no `/swarm-pick`, no auto-worktree-cleanup, single shared `va-worker` account
2. Add a link to `SWARM-WORKFLOW.md` from `CLAUDE.md` reference table (handled in #78).

---

## D. Definition of Done

- [ ] `docs/SWARM-WORKFLOW.md` exists
- [ ] Covers: when-to-use, how-to-invoke, what-happens, how-to-compare, how-to-pick, failed-variants, cost-awareness, v1-limitations
- [ ] Links to `docs/EPHEMERAL-PR-ENVIRONMENTS.md` for preview infrastructure
- [ ] Links to `docs/plans/SWARM-COMMAND-PLAN.md` for design rationale
- [ ] Does not duplicate command reference material from `.claude/commands/swarm.md`
- [ ] `markdownlint docs/SWARM-WORKFLOW.md` returns 0 (if markdownlint installed)
```

---

## Issue #78 — Wire `/swarm` into `CLAUDE.md` and `README.md`

**Title:** `docs: wire /swarm into CLAUDE.md and README.md`

**Body:**

```markdown
## Problem Statement

After `/swarm` and its documentation land, they need discoverability. The Slash Commands table in `CLAUDE.md` is the canonical command index, and `README.md` lists commands under "After Bootstrap". Without these entries, participants won't find `/swarm` unless they explicitly browse `.claude/commands/`.

**Parent Epic:** #72 -- /swarm command for parallel ticket implementations
**Effort Estimate:** XS
**Priority:** P1

**Depends on:** #75 (command must exist), #77 (workflow doc must exist)

---

## A. Environment Context

- Project: agile-flow (Markdown/Bash/YAML template repo)
- Key reference files:
  - `CLAUDE.md` -- contains "Slash Commands" table and "Reference" table (docs/)
  - `README.md` -- contains "After Bootstrap" command list
  - `.claude/commands/swarm.md` -- the command being indexed (lands in #75)
  - `docs/SWARM-WORKFLOW.md` -- the doc being indexed (lands in #77)
- Files to modify:
  - MODIFY `CLAUDE.md`
  - MODIFY `README.md`

---

## B. Guardrails

- Do NOT duplicate existing descriptions -- use one-line summaries matching the style of neighboring entries.
- Do NOT reorder existing table rows unnecessarily.
- Do NOT add emojis inside the ASCII tables (breaks column alignment per CLAUDE.md formatting standards).
- Keep the README's "After Bootstrap" list grouped the same way it is today (daily development, planning, decisions).

---

## C. Happy Path

1. Add a row to `CLAUDE.md`'s "Slash Commands" table: `/swarm` with a one-line description matching the table's existing style.
2. Add a row to `CLAUDE.md`'s "Reference" table pointing at `docs/SWARM-WORKFLOW.md`.
3. Add `/swarm` to `README.md`'s "After Bootstrap" section under the most appropriate grouping (likely "Daily development" alongside `/work-ticket`).
4. Verify alignment of ASCII tables after edits.
5. Verify all new cross-references resolve.

---

## D. Definition of Done

- [ ] `CLAUDE.md` Slash Commands table includes `/swarm`
- [ ] `CLAUDE.md` Reference table includes `docs/SWARM-WORKFLOW.md`
- [ ] `README.md` "After Bootstrap" section mentions `/swarm`
- [ ] No ASCII table columns broken
- [ ] No emojis in tables
- [ ] All cross-references resolve
```

---

## Ordering Recap (for `/groom-backlog`)

Ship order:

1. **#73** (gitignore) -- independent, trivial, ship first to avoid noise in later PRs
2. **#74** (planner agent) -- pure addition, no risk, blocks #75
3. **#75** (`/swarm` command) -- depends on #74; medium risk (new orchestration pattern)
4. **#76** (extend worker) -- touches NON-NEGOTIABLE PROTOCOL, highest scrutiny; can ship in parallel with #75 but safer after
5. **#77** (workflow doc) -- depends on #75 existing so screenshots/examples are real
6. **#78** (wire into CLAUDE.md + README) -- depends on #75 and #77; trivial once upstream lands

---

## What I need from you before filing

1. **Confirm the meta-repo target.** Issues in `vibeacademy/agile-flow-meta`, PRs in `vibeacademy/agile-flow`, per the pattern used for #71 and #157-160. Yes?
2. **Confirm epic numbering style.** #54 uses `epic:` prefix in the title; I matched that. OK?
3. **Priority labels.** #71 used `priority:P1` as a project-board field (not a GH label). I'll leave labels blank in the issue body and you or the groomer can set board fields. OK?
4. **Should the design doc move?** Right now `docs/plans/SWARM-COMMAND-PLAN.md` lives in the `agile-flow` repo on a feature branch. If issues live in `agile-flow-meta`, you may want the design doc there too (like `remove-github-mcp-server.md` referenced in #157). Your call.

Once you confirm, I can file all 7 issues in one batch.
