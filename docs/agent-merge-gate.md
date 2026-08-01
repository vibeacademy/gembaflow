# Agent Merge Gate

The `agent-merge-gate` is the conditional unlock that lets the
`/drain` skill merge PRs to `main` autonomously overnight — a narrow,
re-verified exception to CLAUDE.md Critical Rule #4 ("Only humans
merge PRs").

It lives at [`.github/workflows/agent-merge.yml`](../.github/workflows/agent-merge.yml).
Reverting the unlock is a one-line operation: delete that file. The
drain workflow's call then fails, and merge permission is back to
humans-only with no other code changes.

This workflow ships in the framework's beads-native state (epic #574
E4) — the gating logic, `IGNORED_CHECKS` allowlist, and `caller` input
were empirically validated in the `gembaflow-site` downstream fork
during the autonomous-drain validation phase (2026-06-08 →
2026-06-10), and the beads adaptation (PR-carried safety label + bead
citation) in the reference fork's first autonomous drain under beads
(run va-17h, 2026-07-11: 3/3 shipped, 0 claim races). Downstream forks
install the workflow per `docs/drain-customization.md` and customize
the `IGNORED_CHECKS` env-var to match their own observed CI flakiness.

## What it does

When invoked with a PR number, the workflow re-verifies seven
conditions. Any single failure aborts the workflow non-zero before
the merge step runs. Only when all seven pass does the workflow execute
`gh pr merge <PR> --squash --delete-branch`.

The seven conditions are deliberately **defense in depth** — the
calling workflow (drain) is expected to have already checked them.
This gate re-checks anyway, on the principle that the callable
surface should self-protect.

Conditions 1-6 live in [`scripts/check-merge-gate.sh`](../scripts/check-merge-gate.sh)
(unit-tested in `scripts/__tests__/check-merge-gate.test.mjs`); the
workflow fetches the PR state JSON and delegates, so the condition
logic is exercisable without dispatching a workflow run.

## The seven conditions

| # | Condition | How it's checked |
|---|---|---|
| 1 | The PR body cites a bead | A line matching `Bead: <id>` in the PR's own body. Work items live in the local bd (beads) tracker, which Actions runners cannot query — the citation is the PR's link back to its work item |
| 2 | The PR carries exactly one `safety:*` label, and it is not `safety:hot` | Read the PR's own labels; the worker copies the bead's safety label onto the PR at creation (label authority: the bead is the source of truth) |
| 3 | All status checks on the PR are `SUCCESS`/NEUTRAL/SKIPPED and the rollup is COMPLETE, **excluding any check names in the workflow-level `IGNORED_CHECKS` env var** | `gh pr view --json statusCheckRollup`; filter rollup by name against `IGNORED_CHECKS`; reject if any remaining check is `FAILURE`, `CANCELLED`, `TIMED_OUT`, or still running (`PENDING`, `IN_PROGRESS`, `QUEUED`, or conclusion-less — an incomplete rollup fails loudly, naming the unfinished check). See "Informational checks" section below |
| 4 | The PR is `OPEN` and its base is `main` | Standard PR state check |
| 5 | The PR has no `do-not-merge` label | Standard label exclusion |
| 6 | Second-identity approval — **config-gated** via the workflow-level `REVIEWER_APPROVAL_LOGIN` env var | Non-empty: the latest review authored by exactly that login must be `APPROVED` and bound to the PR's **current head commit** (`review.commit.oid == headRefOid` — a stale approval on an earlier commit is refused, naming both commits). Empty: the condition is skipped with a loud `::warning::` naming the residual reliance on citation+label+rollup alone. See "The reviewer-approval condition is configurable, not doctrinal" below |
| 7 | The caller is the drain workflow | Audit-logged from the `caller` input; emits a warning (not an error) if `caller != goal-drain` because the called workflow cannot cryptographically prove its parent. The other six conditions remain the load-bearing safety. |

### The reviewer-approval condition is configurable, not doctrinal

Condition 6 exists to keep the autonomous merge path a **two-identity
path**: `repository_dispatch` is sendable by any write-scoped identity,
so without a second-identity check a compromised or prompt-injected
worker account could open a cited, labeled, green PR and self-merge it.
Requiring an APPROVED review from a distinct reviewer login closes that
— the worker identity cannot produce it (escalation resolution on #578,
Option A — operator 2026-08-01).

The stance is a **config choice**, set in the workflow env exactly like
`IGNORED_CHECKS` (repo-controlled; PR content can never toggle or
satisfy it):

- **Upstream's copy sets `va-reviewer`** — its drain practice posts the
  verdict via `gh pr review --approve` under the reviewer bot, so the
  gate requires that approval, freshly bound to the current head commit
  (a post-approval push must be re-approved).
- **Never-approve forks set `''` knowingly** — their GO/NO-GO verdict
  lives in review comments and the bead's `verdict:*` label
  (`verdict:go` / `verdict:no-go` — see `.claude/commands/review-pr.md`
  step 5), which an Actions runner cannot read (the bd tracker is
  local), and `/drain` dispatches only after GO. Emptying the config is
  a deliberate acceptance that the gate's mechanical conditions rely on
  citation+label+rollup alone; the gate says so loudly on every run.

Workflow files are not in `syncDirectories`, so each fork makes this
choice on its own manual-install copy.

## How it's invoked

### Real merges (`/drain` via the bridge workflow)

The `/drain` skill (Claude Code skill, ships in the `.claude/commands/`
set when the drain epic lands upstream) can't call the gate via
`workflow_call` directly — it only has `gh` CLI access, which fires
`workflow_dispatch`. Real merges route through the **drain-merge
bridge** (`.github/workflows/drain-merge-bridge.yml`, ships in the
same drain epic as a sibling ticket to this one), which accepts a
`repository_dispatch` event from the skill and calls the gate via
`workflow_call`:

```yaml
# .github/workflows/drain-merge-bridge.yml — the bridge
on:
  repository_dispatch:
    types: [drain-merge]
jobs:
  call-gate:
    uses: ./.github/workflows/agent-merge.yml
    with:
      pr_number: ${{ github.event.client_payload.pr_number }}
      caller: goal-drain
      dry_run: false
    permissions:
      contents: write
      pull-requests: write
      checks: read
      actions: read
```

The `/drain` skill fires the event with:

```bash
gh api -X POST /repos/<owner>/<repo>/dispatches \
  -f event_type=drain-merge \
  -F client_payload[pr_number]=<PR>
```

Where `<owner>/<repo>` is the fork's own repo path.

### Dry-run testing (`workflow_dispatch`)

Humans (or other tooling) can manually invoke the workflow for testing
via the GitHub Actions UI or `gh workflow run`. The `dry_run` input
defaults to `true` for `workflow_dispatch` and CANNOT be set to `false`
for that trigger — the workflow rejects the invocation if a human
attempts a real merge through the dispatch path.

```bash
# Dry-run against any PR from the fork's feature branch
gh workflow run agent-merge.yml \
  --ref <feature-branch> \
  -f pr_number=<PR> \
  -f dry_run=true
```

This runs all seven verification steps and logs "would merge" on the
final step instead of executing the merge.

## Why workflow_dispatch can only dry-run

Real merges require a `workflow_call` invocation with an explicit
`caller` input. The drain orchestrator sets `caller: goal-drain`. A
human dispatching the workflow gets `caller: workflow_dispatch`
(default) and a forced `dry_run=true`. This means:

- The architectural intent ("drain is the only caller") is preserved
  in the audit log
- Humans can still test the conditions empirically
- A human cannot use the gate as a backdoor to merge a PR they
  couldn't otherwise merge — the six other conditions remain in force

## Drain merge bridge

`.github/workflows/drain-merge-bridge.yml` (ships in the same drain
epic) is the workflow that closes the gap between the Claude Code
`/drain` skill (which can only fire `workflow_dispatch`) and the gate
(which only accepts real merges via `workflow_call`). The bridge:

- Triggers on `repository_dispatch` with `event_type: drain-merge`
- Has zero `steps:` — its only job is `uses: ./.github/workflows/agent-merge.yml`
- Hardcodes `caller: goal-drain` and `dry_run: false` when calling the
  gate
- Has workflow-level `permissions: {}` (deny by default); the
  job-level permissions grant only what the gate needs

The bridge preserves the `workflow_dispatch` rejection rule intact —
real merges still only route through `workflow_call`. The bridge is
just a small adapter from the skill's `gh api dispatches` invocation
to the gate's required entry path.

### Legitimate event types

Only one event type is currently supported: `drain-merge`. New event
types are additive (each maps to a separate jobs block in the bridge
or a separate bridge file) and require an architect review before
adding. The bridge is not a generic dispatch handler; each accepted
event type is an explicit decision documented here.

### Reverting the bridge

```bash
git rm .github/workflows/drain-merge-bridge.yml
git commit -m "revert: remove drain-merge bridge (return to v1 operator-merges-manually)"
git push
```

The `/drain` skill's `gh api dispatches` call still fires, but no
workflow listens for the event — it becomes a no-op. The skill's
merge step fails to find a workflow run; the drain halts the way it
does in v1 (operator merges manually). No other workflows are
affected.

## Informational checks

Condition 3 honors a workflow-level `IGNORED_CHECKS` env var (a JSON
array of status-check names) so that checks that are technically
failing — or still running — for reasons unrelated to code
correctness (typically provider-side reliability or lag) don't block
legitimate ready-to-merge PRs.

The allowlist also covers the **rollup-completeness race**: the
reference fork's first autonomous dispatch (drain run va-17h, finding
1) was denied because an informational provider-side check lagged CI
by ~10 minutes — strict mode correctly refused the incomplete rollup.
The codified default fix is on the drain side (`.claude/commands/drain.md`
per-iteration step 7a waits for the FULL rollup before dispatching);
an `IGNORED_CHECKS` entry meeting the 3-criteria bar below is the
alternative when a check is genuinely informational AND chronically
laggy. Never widen the gate's success set itself.

### Default (framework-shipped) value

```yaml
IGNORED_CHECKS: '[]'
```

The framework ships with an empty allowlist — strict mode. Forks
populate the list based on their own observed CI flakiness. For
example, a Render-deployed fork experiencing intermittent preview-
deploy reliability issues might add `"Deploy to Render Preview"` to
the list.

### Adding a check to the ignored list

Edit the `IGNORED_CHECKS` env var in
`.github/workflows/agent-merge.yml` on the fork. The bar for adding
a check is **conservative**: the check must be (a) genuinely
informational — its failure does not indicate broken code; AND
(b) empirically flaky enough that it blocks legitimate ready-to-merge
PRs at a meaningful rate; AND (c) not covered by another required
check (i.e., not the only thing exercising a particular code path).

The audit log emits a `::notice::` line naming every ignored check
name + status it skipped, so the operator can spot when an ignored
check that SHOULD have been informational starts reporting
consistently-FAILURE (a possible sign of a real regression hidden by
the allowlist).

### When the list is empty

Strict-mode: every status check in the rollup must
`SUCCESS`/`NEUTRAL`/`SKIPPED`. This is the framework-shipped v1
behavior. Empty list preserves backward compatibility with strict
forks.

### Future enhancement

Branch-protection-driven required-checks is the cleaner long-term
separation but isn't yet wired (when branch protection isn't
configured on `main`, the lookup returns empty and falls through to
the same `IGNORED_CHECKS` path). A future ticket can layer
branch-protection lookup on top of the current workflow-level
allowlist, taking the union of "required by branch protection" AND
"not in IGNORED_CHECKS" as the relevant subset.

## Permissions

The workflow's `verify-and-merge` job runs with:

- `contents: write` — required to merge
- `pull-requests: write` — required to merge and to delete the source
  branch
- `checks: read` + `actions: read` — required for the
  `statusCheckRollup` GraphQL field used by condition 3

(`issues: read` is no longer needed — conditions 1+2 read the PR's
own body and labels since the beads cutover; the
`closingIssuesReferences` linked-issue path is gone.)

These are granted at the **job level**, not via secrets, and not
inherited by any other job in the same workflow run. The blast radius
of a compromised workflow run is bounded to this one job.

The default `GITHUB_TOKEN` (with the job-level permissions above) is
sufficient. No long-lived PAT or third-party secret is required.

## Reverting the unlock

```bash
git rm .github/workflows/agent-merge.yml
git commit -m "revert: remove agent-merge gate (return to humans-only merge)"
git push
```

Drain's call (if the drain epic has landed) now fails at the workflow
lookup step. No PRs are mergeable by agents. CLAUDE.md Critical Rule
§4 is back in full force with no other code changes.

## Testing

Before merging this workflow into a fork's `main`, three test
invocations are recommended:

- **Happy path** — dispatch against the gate's own PR after the full
  check rollup is green and complete, with the `Bead: <id>` citation,
  exactly one `safety:*` label on the PR, and (when
  `REVIEWER_APPROVAL_LOGIN` is set) a fresh APPROVED review from that
  login at the current head → all seven conditions pass → "would
  merge" log → exit 0.
- **Deliberate failure 1** — dispatch against a closed/merged PR →
  condition 4 fails ("PR not open") → exit non-zero.
- **Deliberate failure 2** — dispatch against a non-existent PR
  number → fetch step fails → exit non-zero.

### Validation log

- **2026-08-01** — post-merge validation per PR #586's plan, executed
  against this repo's own gate (the live-merge case is the *first*
  agent-merged PR on this repository). Test artifact: branch
  `chore/gate-validation-001` (this change). Cases:
  - **DENY/citation** — malformed `Bead:` citation in the PR body →
    condition 1 FAIL (dry-run dispatch).
  - **DENY/labels** — second `safety:*` label added → condition 2 FAIL
    (dry-run dispatch).
  - **DENY/stale-approval** — reviewer approval bound to a pre-push
    head commit → condition 6 FAIL naming both commit oids (dry-run
    dispatch).
  - **HAPPY/dry-run** — fresh approval at head, all conditions
    satisfied → PASS with the dry-run "skipping the actual merge"
    outcome.
  - **LIVE** — `repository_dispatch` (`drain-merge`) through the bridge
    → gate verified all seven conditions and squash-merged.

  Run IDs for each case are recorded on issue #578 (the E4 ticket).

## References

- [`.github/workflows/agent-merge.yml`](../.github/workflows/agent-merge.yml) —
  the workflow source
- [`docs/safety-classes.md`](safety-classes.md) — the `safety:*`
  taxonomy that conditions 1–2 enforce
- CLAUDE.md "Critical Rules" §4 — the human-merge rule this gate
  conditionally overrides
