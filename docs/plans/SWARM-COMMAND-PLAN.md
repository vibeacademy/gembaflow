# `/swarm` Command — Design Plan

**Status:** Draft for review
**Author:** Claude
**Date:** 2026-04-05

## Goal

Add a `/swarm` slash command to agile-flow that takes a single GitHub issue and spawns **N parallel implementations** — each in its own worktree, branch, and PR. Each PR automatically gets its own preview environment (via existing Render + Supabase branching), so a human can compare the approaches live and pick the one they like best.

## User Story

> "I have ticket #123 about redesigning the onboarding flow. There are three
> reasonable UX treatments. I don't want to pick on paper — I want to see
> all three running in preview environments, click through them, and then
> keep the winner."

```
/swarm 123 --variants 3
```

→ Produces 3 PRs (`#124`, `#125`, `#126`), each on its own branch, each with a distinct preview URL. Human picks one, merges it, closes the others.

---

## Constraints Discovered from Codebase

These shaped the design — full details in the Explore agent report.

1. **Current architecture is explicitly single-worker.** `github-ticket-worker.md:220` says "one at a time." No locks, queues, or concurrency safeguards exist.
2. **Only one worker account (`va-worker`).** The account-switch hook has no mutual exclusion; concurrent workers would race.
3. **Branch naming is deterministic:** `feature/issue-{number}-short-description`. Two workers on the same ticket would collide on push.
4. **Preview environments are free.** Render + Supabase already create one per PR automatically via `preview-deploy.yml`. This is the killer feature that makes `/swarm` viable — no new infra needed.
5. **Worktrees are already in use ad-hoc.** `.claude/worktrees/` contains live worktrees (not gitignored). No tooling references them, but the `EnterWorktree` tool handles isolation.
6. **Commands invoke agents declaratively.** They describe which agent to launch; the assistant uses the Task tool. This makes parallel launching straightforward via multiple Task calls in one message.

---

## Design

### Command Surface

```
/swarm <issue-number> [--variants N] [--strategy <name>]
```

- `issue-number` (required): The GitHub issue to fan out.
- `--variants N` (default: 3, max: 5): How many parallel implementations.
- `--strategy` (optional): A prompt hint passed to each variant — e.g., `ux`, `perf`, `minimal-diff`. Default: just "produce distinct approaches."

### Branch Naming

Extend the existing convention with a variant suffix:

```
feature/issue-{N}-{slug}-variant-{a|b|c|...}
```

This keeps the existing branch-naming rule intact and makes the relationship between the variants obvious in the branch list and PR titles.

### Workflow

```
/swarm 123 --variants 3
         │
         ├─ Phase 1: Plan
         │   One planner agent reads ticket #123, generates N distinct
         │   implementation briefs. Each brief is a short "here's the
         │   angle this variant should take" paragraph. Saved as a
         │   Markdown artifact for the human to skim BEFORE any code
         │   is written (optional --yes flag to skip confirmation).
         │
         ├─ Phase 2: Fan out
         │   Create N git worktrees under .claude/worktrees/swarm-{issue}-{variant}/
         │   Each on its own branch: feature/issue-123-onboarding-variant-a, -b, -c
         │   Move ticket to "In Progress" on the board (once, not N times).
         │
         ├─ Phase 3: Parallel implementation
         │   Launch N github-ticket-worker agents in parallel via the Task tool,
         │   one Task call per variant, each scoped to its own worktree and
         │   given its specific brief. Each produces a PR.
         │
         ├─ Phase 4: Aggregate
         │   Post a "swarm summary" comment on issue #123 with:
         │     - Links to all N PRs
         │     - Links to all N preview URLs (once Render deploys)
         │     - Each variant's brief
         │   Move ticket to "In Review" (once).
         │
         └─ Phase 5 (human): Pick one
             Human reviews preview environments, merges the winner,
             closes the losers with a comment pointing at the merged PR.
```

### Phase 1: The Planner

A lightweight planner step is essential — otherwise all N variants converge on the same implementation. The planner:

1. Reads the issue body + acceptance criteria.
2. Generates N distinct "angles" (e.g., "variant-a: modal-based", "variant-b: inline wizard", "variant-c: progressive disclosure").
3. Writes these to `reports/swarms/issue-{N}-briefs.md` for human review.
4. Pauses and asks the user to confirm (unless `--yes` passed).

This keeps the human in the loop at the cheapest possible decision point: *before* we spend compute on parallel implementations.

### Phase 3: Parallel Implementation Details

Launched via a single assistant turn with N Task tool calls:

```
Task(github-ticket-worker, worktree=".claude/worktrees/swarm-123-a", brief="variant-a brief...", branch="feature/issue-123-onboarding-variant-a")
Task(github-ticket-worker, worktree=".claude/worktrees/swarm-123-b", brief="variant-b brief...", branch="feature/issue-123-onboarding-variant-b")
Task(github-ticket-worker, worktree=".claude/worktrees/swarm-123-c", brief="variant-c brief...", branch="feature/issue-123-onboarding-variant-c")
```

Each worker operates inside its own worktree — totally isolated filesystems, no collisions on files, node_modules, build artifacts.

### Handling the Shared Worker Account

This is the trickiest part. The `va-worker` account has no mutual exclusion in the hook. Three options, in order of simplicity:

**Option A — Serialize PR creation only (recommended for v1).** Workers implement + test + commit + push *in parallel*, but PR creation itself is serialized by the orchestrator. Each worker reports "ready to open PR" back to the orchestrator, which opens PRs one at a time. This is a tiny bottleneck (seconds per PR) and avoids the account-switch race entirely.

**Option B — Per-variant bot accounts.** `va-worker-a`, `va-worker-b`, etc. Works, but adds setup friction for every project that adopts swarm.

**Option C — Harden the hook with a mutex.** File-lock the account state. Harder to get right; defer.

**v1 decision: Option A.**

### Handling Branch Name Uniqueness

Deterministic suffix (`variant-a`, `variant-b`, ...) solves this. No locks needed.

### Board Movements

The ticket moves **once** (not N times):
- `/swarm` moves ticket to "In Progress" at start of Phase 2.
- `/swarm` moves ticket to "In Review" at end of Phase 4.
- The merged variant's PR closes the issue normally. Losing PRs are closed without closing the issue.

### Preview Environment Story

**This is the part that already works.** Every PR automatically gets:
- A Render preview URL: `https://app-pr-{number}.onrender.com`
- A Supabase branch DB
- Cleaned up automatically when the PR closes

Nothing new to build here. `/swarm` just has to link them prominently in the Phase 4 summary comment.

---

## Files to Create / Modify

### New files

1. **`.claude/commands/swarm.md`** — the slash command definition. Follows the existing pattern (frontmatter + pre-flight + critical rules + reference material). This is the main deliverable.

2. **`.claude/agents/swarm-planner.md`** — a lightweight new agent that generates the N variant briefs. Could alternatively be inlined into the command itself; leaning toward separate agent for clarity.

3. **`docs/SWARM-WORKFLOW.md`** — user-facing explainer: when to use `/swarm`, how to compare previews, how to close losers. Linked from README and CLAUDE.md reference table.

4. **`.gitignore` entry for `.claude/worktrees/`** — currently untracked but not ignored. Should be ignored (workstrees are ephemeral, local-only).

### Modifications

5. **`.claude/agents/github-ticket-worker.md`** — tiny addition to the workflow section describing "swarm mode": when invoked with a brief + pre-assigned worktree + pre-assigned branch, skip ticket selection and skip the "In Progress" move (the orchestrator handles board state). This is the one place the single-worker assumption must be relaxed.

6. **`CLAUDE.md`** — add `/swarm` to the Slash Commands table. Add `docs/SWARM-WORKFLOW.md` to the Reference table.

7. **`README.md`** — mention `/swarm` in the "After Bootstrap" command list.

### Deliberately NOT changing

- `.claude/hooks/ensure-github-account.sh` — Option A (serialized PR creation) avoids this.
- `preview-deploy.yml` / Render config — already works per-PR.
- `pr-reviewer` agent — no changes needed; it reviews each PR independently.

---

## Resolved Decisions

1. **Default variant count: 3.** Max 5 (ceiling unchanged).
2. **Planner: separate agent file** (`.claude/agents/swarm-planner.md`).
3. **Losing PRs: human handles in v1.** A `/swarm-pick <variant>` command arrives in Phase 2 to merge the winner and close losers in one shot.
4. **Build failures: leave PR open, label `swarm-failed`.** Failures are information, not garbage.
5. **Cost warning: yes.** `/swarm` prints a cost estimate (variants × approximate compute + preview build minutes) and requires confirmation before launching. Skippable with `--yes`.
6. **DoR check: required.** `/swarm` refuses to run on a ticket that doesn't meet Definition of Ready. Swarming is for comparing *complete* implementations, not exploring half-specified work.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Account-switch race on `va-worker` | Serialize PR creation (Option A) |
| Variants converge on identical implementations | Planner phase generates distinct briefs up front |
| Worktree disk bloat | Document cleanup; add to `.gitignore`; optionally auto-remove worktrees after PRs merge |
| Human decision paralysis with N variants | Default N=3; require a pick before swarming the next ticket |
| Preview env limits (Render free tier) | Document in `SWARM-WORKFLOW.md`; N=3 is typical Render free-tier-safe |
| Swarm on a ticket that's already being worked | Pre-flight check: refuse if ticket is already "In Progress" |

---

## Scope for v1

**In:**
- `/swarm <issue> --variants N` command
- Planner agent producing N briefs
- Worktree-isolated parallel workers
- Serialized PR creation
- Summary comment on the issue with PR + preview links
- Documentation in `docs/SWARM-WORKFLOW.md`

**Out (future):**
- `/swarm-pick <variant>` merge-winner-close-losers command
- Auto-cleanup of worktrees after merge
- Cross-variant quality ranking (let pr-reviewer rank them)
- Multi-account worker pools

---

## Recommendation

Build v1 as scoped above. Start with `.claude/commands/swarm.md` and the planner agent, test manually on a throwaway issue, then add docs and CLAUDE.md integration. Expect the first real run to surface one or two integration bugs (especially around the worker skipping "In Progress" movement), which is cheap to fix with the planner as a gate.

Please review and mark up. Happy to revise before any code gets written.
