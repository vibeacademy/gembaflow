# Agent Merge Gate

The `agent-merge-gate` is the conditional unlock that lets the
`/drain` skill merge PRs to `main` autonomously overnight — a narrow,
re-verified exception to CLAUDE.md Critical Rule #4 ("Only humans
merge PRs").

It lives at [`.github/workflows/agent-merge.yml`](../.github/workflows/agent-merge.yml).
Reverting the unlock is a one-line operation: delete that file. The
drain workflow's call then fails, and merge permission is back to
humans-only with no other code changes.

This workflow ships in the framework's v2-hardened state — the gating
logic, `IGNORED_CHECKS` allowlist, and `caller` input have been
empirically validated in the `gembaflow-site` downstream fork during
the autonomous-drain validation phase (2026-06-08 → 2026-06-10).
Downstream forks pull the workflow via `/upgrade` and customize the
`IGNORED_CHECKS` env-var to match their own observed CI flakiness.

## What it does

When invoked with a PR number, the workflow re-verifies seven
conditions in sequence. Any single failure aborts the workflow
non-zero before the merge step runs. Only when all seven pass does
the workflow execute `gh pr merge <PR> --squash --delete-branch`.

The seven conditions are deliberately **defense in depth** — the
calling workflow (drain) is expected to have already checked them.
This gate re-checks anyway, on the principle that the callable
surface should self-protect.

## The seven conditions

| # | Condition | How it's checked |
|---|---|---|
| 1 | The PR's linked issue has a `safety:*` label | Read `closingIssuesReferences` from the PR, `gh issue view <N> --json labels`, filter for `safety:` prefix |
| 2 | The safety class is not `safety:hot` | Same query; refuse if class is `:hot` |
| 3 | The PR has an `APPROVED` review from `va-reviewer` | Latest review by `va-reviewer` must have `state == APPROVED` |
| 4 | All status checks on the PR are `SUCCESS`/NEUTRAL/SKIPPED, **excluding any check names in the workflow-level `IGNORED_CHECKS` env var** | `gh pr view --json statusCheckRollup`; filter rollup by name against `IGNORED_CHECKS`; reject if any remaining check is `FAILURE`, `CANCELLED`, `TIMED_OUT`, `PENDING`, `IN_PROGRESS`, or `QUEUED`. See "Informational checks" section below |
| 5 | The PR is `OPEN` and its base is `main` | Standard PR state check |
| 6 | The caller is the drain workflow | Audit-logged from the `caller` input; emits a warning (not an error) if `caller != goal-drain` because the called workflow cannot cryptographically prove its parent. The other six conditions remain the load-bearing safety. |
| 7 | The PR has no `do-not-merge` label | Standard label exclusion |

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
      issues: read
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

Condition 4 honors a workflow-level `IGNORED_CHECKS` env var (a JSON
array of status-check names) so that checks that are technically
failing for reasons unrelated to code correctness — typically
provider-side reliability issues — don't block legitimate
ready-to-merge PRs.

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
  `statusCheckRollup` GraphQL field used by condition 4
- `issues: read` — required for the `closingIssuesReferences` GraphQL
  field used by conditions 1+2

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

- **Happy path** — dispatch against the gate's own PR after CI green +
  `va-reviewer` APPROVED → all seven conditions pass → "would merge"
  log → exit 0.
- **Deliberate failure 1** — dispatch against a closed/merged PR →
  condition 5 fails ("PR not open") → exit non-zero.
- **Deliberate failure 2** — dispatch against a non-existent PR
  number → fetch step fails → exit non-zero.

## References

- [`.github/workflows/agent-merge.yml`](../.github/workflows/agent-merge.yml) —
  the workflow source
- [`docs/safety-classes.md`](safety-classes.md) — the `safety:*`
  taxonomy that conditions 1–2 enforce
- CLAUDE.md "Critical Rules" §4 — the human-merge rule this gate
  conditionally overrides
