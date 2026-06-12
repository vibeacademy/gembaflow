# ADR-0002: Autonomous merge via bridge workflow + `repository_dispatch`

**Status:** Accepted
**Date:** 2026-06-12 (ported to upstream from `vibeacademy/gembaflow-site`'s ADR-007)
**Supersedes:** none (closes the v1-to-v2 boundary that ADR-0001 deferred)
**Superseded by:** none

## Context

The `/drain` skill (ADR-0001) needs to trigger an autonomous merge of a green-CI, GO-reviewed PR without softening the gate's safety contract. The gate workflow (`.github/workflows/agent-merge.yml`, from drain port T1 / `vibeacademy/gembaflow#415`) accepts merges only via `workflow_call` — `workflow_dispatch` is refused for real merges by the gate's safety step. The skill can't `workflow_call` directly (skills don't dispatch workflows; only other workflows can). So a triggering shape must exist that:

- The skill **can** dispatch (skills can call `gh api .../dispatches`).
- The gate **will** accept (the gate accepts `workflow_call`).
- Doesn't soften the gate's safety contract.

Four options were evaluated:

| Option | Shape | Verdict |
|---|---|---|
| A — Bridge workflow | New workflow listens for `repository_dispatch`, calls `agent-merge.yml` via `workflow_call`. The bridge is a 1-job, 0-step file with hardcoded inputs to the gate. | **Selected.** |
| B — Soften the gate | Have `agent-merge.yml` accept `workflow_dispatch` for real merges, gated on a different condition. | Rejected — softens the safety contract; the dispatch-refuses-real-merges rule is load-bearing. |
| C — Skill merges directly | Skill calls `gh pr merge` after posting GO. | Rejected — bypasses the gate entirely; the gate's 7-condition autonomous-merge contract is the value. |
| D — External orchestrator | A separate service (Vercel function, Lambda, etc.) handles dispatch translation. | Rejected — net-new infrastructure for a one-line YAML problem. |

## Decision

Option A — the bridge workflow. `.github/workflows/drain-merge-bridge.yml` triggers on `repository_dispatch: types: [drain-merge]`, has a single job with zero steps, and invokes `agent-merge.yml` via `uses: ./.github/workflows/agent-merge.yml` with `workflow_call` semantics and hardcoded `dry_run: false`. The drain skill signals the bridge via:

```bash
gh api -X POST /repos/{owner}/{repo}/dispatches \
  -f event_type=drain-merge \
  -F client_payload[pr_number]=<PR>
```

The bridge's workflow-level `permissions: {}` is deny-by-default; job-level permissions match exactly what the gate needs (`contents: write`, `pull-requests: write`, `checks: read`, `actions: read`, `issues: read`).

## Consequences

### Positive

- **The gate's safety contract is preserved unchanged.** The `workflow_dispatch`-refuses-real-merges rule still holds; the bridge enters via `workflow_call`, which the gate accepts.
- **Two-workflow audit trail.** Bridge run logs + gate run logs both kept in GitHub Actions history. A future auditor can reconstruct "who dispatched what, when, and was it approved."
- **Pattern generalizes.** Future autonomous-merge contexts (e.g., a hypothetical `/goal deploy`) can add new `repository_dispatch` event types to the bridge under a docs-governance rule documented in the bridge file header. See [[Pattern-bridge-workflow-for-skill-driven-autonomous-merge]].
- **Tiny revert path.** Delete the bridge file → the skill's dispatch call fires a no-op event (no workflow listens) → the drain's per-iteration cycle step 7 fails → drain halts at the gate the same way it does in v1 operator-active mode. No other workflows are affected.

### Negative

- **Two workflows instead of one.** A future maintainer reading just `agent-merge.yml` won't see the dispatch path; they'll need to grep for `workflow_call` usages or read the bridge file. The bridge's header comments name this explicitly.
- **The bridge is meta-only per fork.** `.github/workflows/` is NOT in `syncDirectories`, so the bridge doesn't propagate to forks via sync. Each fork installs the bridge manually after `/upgrade`. This is documented in `docs/drain-customization.md`.

### Defense-in-depth caveat

The gate's 7-condition autonomous-merge contract relies on the workflow having every permission required by every GraphQL/REST field its conditions read. Latent missing-permission bugs (e.g., the `issues: read` permission that was added in v2 hardening — see [[Pattern-defense-in-depth-permissions-need-real-use-empirical-testing]]) can hide in untested condition branches. The discipline is: dispatch the bridge + gate against a real PR with the full state shape (`Closes #N`, va-reviewer APPROVED, green CI, safety class set, no `do-not-merge` label) in `dry_run: true` mode at least once before any real autonomous run.

## Sources

- `vibeacademy/gembaflow-site` ADR-007 (PR #182, 2026-06-08) — original architectural decision in the empirical-development fork.
- T1 of the drain port (`vibeacademy/gembaflow#415`) — shipped `agent-merge.yml` upstream.
- T3 of the drain port (`vibeacademy/gembaflow#417`) — shipped `drain-merge-bridge.yml` upstream.
- [[Pattern-bridge-workflow-for-skill-driven-autonomous-merge]] — the generalizable pattern.
- [[Pattern-defense-in-depth-permissions-need-real-use-empirical-testing]] — why dry-running with the full state shape matters.

<!-- Source: Gemba Flow (https://github.com/vibeacademy/gembaflow) -->
<!-- SPDX-License-Identifier: BUSL-1.1 -->
