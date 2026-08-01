---
description: Convert /review-pr findings on a PR into backlog beads via the agile-backlog-prioritizer agent
---

<!-- FRAMEWORK:START -->

# /review-to-tickets — Convert review findings into backlog beads

Parse the most recent `/review-pr` comment on a target pull request, draft a
candidate bead per non-blocking suggestion, and delegate the
**file / dedupe / drop** decision to `agile-backlog-prioritizer`. The
prioritizer files chosen findings as **backlog beads** via `bd create`
(deliberately ungroomed — sequencing is a separate `/groom-backlog` decision),
posts a single structured summary comment on the source PR with a scope-impact
verdict, and exits. PRs — and the summary comment — stay on GitHub; only the
filing target is beads.

This command is the **manual escape hatch** for the same flow that
`pr-reviewer` invokes automatically after posting a review with non-blocking
suggestions. Same decider, different trigger.

## Audience and trigger model

The reader is an operator catching up on past reviews, re-running after a
follow-up review on the same PR, or bridging across repos. The agent-driven
auto-handoff is preferred in steady state — this command exists for:

- **Retroactive backfill** — runs against older reviews where the auto-handoff
  protocol wasn't in effect.
- **Re-runs** — idempotent via the HTML marker (`<!-- review-to-tickets:source=#N -->`)
  on the prioritizer's summary comment; previously filed findings are detected
  and skipped.
- **Cross-repo invocations** — when a review on `downstream-fork` should produce
  work items in `downstream-fork`'s tracker (or vice versa).

The command does NOT prompt the operator with a y/n confirmation per finding.
Per-finding decisions belong to `agile-backlog-prioritizer`. The operator sees
the scope-impact verdict on the summary comment and intervenes via
`/groom-backlog` if expansion was flagged.

## Critical Rules

1. **Never alter the source review comment.** The summary comment is posted as
   a fresh comment on the PR. The original review is the source of truth.
2. **Filed beads are deliberately ungroomed.** File with `bd create` (open
   status, priority, labels) and stop there — never wire dependencies or add
   `campaign:`/`track:` labels at filing time; in particular, never wire
   dependencies that would alter `bd ready` for an active campaign. A fresh
   open bead appears in `bd ready` mechanically; that is not a recommendation —
   sequencing is a `/groom-backlog` decision, not a `/review-to-tickets`
   decision.
3. **Required Changes from a NO-GO review are NOT routed through this flow.**
   They are PR blockers, not future work. If the source review's recommendation
   is NO-GO, this command files only the Suggestions; the Required Changes are
   handled as PR rework on the same branch.
4. **Idempotent re-runs.** Before drafting findings, scan the PR's comments for
   the marker `<!-- review-to-tickets:source=#<PR> -->`. If found, parse its
   filed-bead list and skip findings already filed. A re-run that detects
   nothing new exits 0 with "nothing new to file".
5. **Source attribution on every filed bead.** Each filed bead's description
   MUST reference the source PR number and a permalink to the source review
   comment, so future readers can trace back.
6. **GO with no findings exits 0.** A clean review produces a summary comment
   with scope-impact `none` and zero beads filed. Silence is not an option —
   the comment lands either way so the audit trail is complete.

## Pre-Flight Verification

Before invoking the prioritizer, verify:

1. **`gh` CLI is authenticated and the target repo is accessible** —
   `gh auth status` and `gh repo view <owner>/<repo> --json nameWithOwner`.
2. **GitHub account is correct** — match the expected worker/automation
   account for the target repo (see `.claude/agents/` README for bot accounts).
3. **Target PR exists and has at least one `/review-pr` template comment** —
   `gh pr view <N> --repo <owner>/<repo> --json comments,reviews`. If no
   matching comment, STOP and report "no review found — invoke `/review-pr`
   first."
4. **beads is operational in the filing repo** — `bd list --json -n 1`
   succeeds. Beads is per-repo: filing lands in the repo where `bd` runs
   (see cross-repo notes below). If `bd` fails, STOP and report.

## Workflow

1. **Resolve target.** `/review-to-tickets #324` (same-repo) or
   `/review-to-tickets vibeacademy/downstream-fork#223` (cross-repo URL form).
   With no argument, scan the active repo's open PRs for the most-recently-
   reviewed one that has not yet been processed (no marker comment).
2. **Fetch comments.** `gh pr view <N> --repo <owner>/<repo> --json comments,reviews`.
3. **Identify the most recent `/review-pr` template comment.** Match on the
   signature: starts with `## PR Review — #<N>` and contains a `### Recommendation`
   section. If multiple, use the newest. If none, exit with the "no review found"
   message above.
4. **Check idempotency marker.** Scan comments for
   `<!-- review-to-tickets:source=#<N> -->`. If found, extract the list of
   previously-filed bead ids — these will be subtracted from the
   candidate set in step 6.
5. **Parse the review into structured findings.**
   - **Required Changes** (numbered list under `### Required Changes`) — only
     routed in retroactive backfill against historical reviews. In normal
     operation, Required Changes block PR merge and are not future work.
   - **Suggestions** (bullet list under `### Suggestions`) — the primary input
     to the prioritizer.
6. **Draft candidate beads** for each finding (one per Suggestion; also per
   Required Change in retroactive-backfill mode). Each candidate has:
   - **Title**: `follow-up(#<PR>): <first line of finding, truncated to 70 chars>`
   - **Labels / priority**: Required (retroactive) → `-l follow-up -p P2`;
     Suggestion → `-l enhancement -p P3`
   - **Description**: the verbatim finding text + a `## Source` section linking
     the source PR and the source review comment permalink
   - **Status**: open, no dependencies, no `campaign:`/`track:` labels
     (Backlog per the CLAUDE.md § "Work-Item Tracking (Beads)" mapping;
     grooming does the wiring later)
   - **Skip** any candidate whose title-substring matches a bead id in
     the idempotency marker.
7. **Delegate to `agile-backlog-prioritizer`.** Invoke via the Task tool with:
   - PR number / URL
   - Source review comment URL
   - The candidate list (drafts from step 6)
   - The repo context for filing
   The prioritizer applies its decider protocol (file / dedupe / drop) — with
   duplicate detection as a title/description text match against existing
   beads (`bd list --json -n 0`) — files chosen candidates via `bd create`,
   and posts the structured summary comment under the source PR on GitHub.
8. **Wait for the prioritizer's report-back.** The command does not exit until
   the prioritizer has confirmed:
   - Filed bead ids (if any)
   - Dedupe links (if any)
   - Drop rationales (if any)
   - Scope-impact verdict
   - Summary comment URL
9. **Print the Result Block** below with the prioritizer's verdict surfaced.

## Usage

```
/review-to-tickets #324
/review-to-tickets vibeacademy/downstream-fork#223
/review-to-tickets                  # most-recently-reviewed unprocessed PR
```

## Handoff contract with `agile-backlog-prioritizer`

The prioritizer agent owns the **decision criteria** (file / dedupe / drop),
the **scope-impact taxonomy** (unchanged / expanded / none), and the
**verbatim summary comment template**. Those are defined in
`.claude/agents/agile-backlog-prioritizer.md` under "Review-Findings Decider
Protocol" and are the single source of truth. This command MUST NOT duplicate
that logic — it drafts candidates, hands off, surfaces the report.

The prioritizer's summary comment includes the marker
`<!-- review-to-tickets:source=#<PR> -->` on line 1 so subsequent re-runs of
this command can detect previously-filed findings. The filed list inside the
marker comment cites bead ids.

## Cross-repo invocation notes

When the argument is a cross-repo URL form (e.g.
`vibeacademy/downstream-fork#223`):

- Use `--repo <owner>/<repo>` on every `gh` call.
- **Beads is per-repo.** `bd create` files into the tracker of the repo it
  runs in — filing follow-ups for another repo requires running `bd` inside a
  checkout of that repo. For target repos not on beads, GitHub-issue filing
  (`gh issue create`) remains the fallback; cross-repo tracking-item creation
  beyond that is out of scope for this command.
- GitHub's auto-link from PR comment to cross-repo references does NOT fire
  reliably — the summary comment must include the explicit PR permalink so
  future readers can trace back.

## Output Format

End your output with a Result Block:

```
---

**Result:** Review findings processed
Source PR: #324 — feat: add health check endpoint
Source review comment: https://github.com/.../pull/324#issuecomment-...
Findings parsed: 4 (1 Required, 3 Suggestion)
Filed: 2 — va-4k1, va-4k2
Dedup'd: 1 — linked to va-3f9
Dropped: 1 — trivial style nit
Scope impact: unchanged
Summary comment: https://github.com/.../pull/324#issuecomment-...
```

For the "GO with no findings" path:

```
---

**Result:** No findings to file
Source PR: #324 — feat: add health check endpoint
Source review comment: https://github.com/.../pull/324#issuecomment-...
Findings parsed: 0
Scope impact: none
Summary comment: https://github.com/.../pull/324#issuecomment-...
```

For a re-run that finds no new work:

```
---

**Result:** Nothing new to file (idempotent re-run)
Source PR: #324 — feat: add health check endpoint
Previously filed: va-4k1, va-4k2
Scope impact: unchanged (from prior run)
```

<!-- Source: Gemba Flow (https://github.com/vibeacademy/gembaflow) -->
<!-- SPDX-License-Identifier: BUSL-1.1 -->

<!-- FRAMEWORK:END -->
