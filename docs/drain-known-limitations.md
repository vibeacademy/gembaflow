# Drain known limitations

This document collects what `/drain` v1 deliberately does NOT do, so operators don't discover these as surprises mid-run. Each limitation is paired with the planned resolution (where one exists) so the future direction is legible.

## v1 trade-offs (from ADR-0001)

### Operator's machine must stay on

The drain loop runs as a Claude Code session on the operator's machine. If the machine sleeps, suspends, or loses network, the loop stalls. There is no cloud-side continuation in v1.

**Resolution:** v3 (`vibeacademy/gembaflow#419` — state persistence + `--resume`) ships a mechanism for picking up a halted run from the operator's saved state on a different machine or after a restart. The state JSON shape was designed in T3 to be `--resume`-ready; v3 wires the actual mechanism.

### Claude Code session must stay open

Closing the Claude Code session cancels the loop. There's no background daemon.

**Resolution:** Same as above — v3.

### No persistence across sessions

If the loop is killed mid-run, the operator restarts from the next ticket in the snapshot. The snapshot itself is preserved (the drain-run tracker issue holds it), but per-ticket state (e.g., "we were on attempt 2 of 3 for the CI fix loop when the session died") is not.

**Resolution:** v3.

## Bridge workflow doesn't auto-install on forks

`.github/workflows/drain-merge-bridge.yml` is NOT in `syncDirectories` — workflow files don't propagate via `/upgrade`. Each fork installs it manually after upgrading (see `docs/drain-customization.md` § "Bridge workflow installation").

A fork that hasn't installed the bridge will see a clean `repository_dispatch` no-op (no workflow listens for the `drain-merge` event type), the drain's per-iteration cycle step 7 fails, and the drain halts at the gate the same way it does in pre-v2 operator-active mode.

**Resolution:** Either (a) introduce a workflow-distribution mechanism (extend `template-sync.sh` to sync `.github/workflows/` with an opt-in subset), or (b) accept the per-fork install as a documented bootstrap step. No ticket is currently filed; this is a known-gap-with-no-active-fix.

## Anthropic API resilience

The drain loop runs against Claude Code's session, which talks to Anthropic's API. If the API has an outage, the loop stalls until the API recovers. There's no graceful degradation path that picks up where the loop left off after an API recovery — operators must manually re-invoke `/drain` and the snapshot is rebuilt from the current Ready column.

**Resolution:** Partial — the `/drain --resume` mechanism shipped in v3 (`#419`) addresses the "restart from saved state" half. The "actively retry across API outages" half is not on the roadmap; the operator is expected to re-invoke after outage recovery.

## No native cross-repo merge orchestration

The meta `/drain` operates on a board that holds tickets from multiple repos (`gembaflow`, `gembaflow-meta`, `gembaflow-gcp`). Each ticket's home repo handles its own CI + merge. Drain orchestrates the loop; it doesn't coordinate cross-repo dependencies.

A ticket whose `Depends on:` line points at another repo's ticket is not specially handled — the dependency parser only checks `Depends on: #N` pattern within the same repo. Cross-repo dependencies (e.g., `Depends on: vibeacademy/gembaflow#XYZ`) are NOT detected as blockers.

**Resolution:** No ticket filed. The empirical pattern is to file the upstream ticket, get it merged, then file the downstream ticket — sequential rather than concurrent. If a real cross-repo dep emerges that this pattern can't handle, file the ticket.

## No `safety:flagged` class in meta

Meta has no feature-flag mechanism (it's docs/plans/dotfiles, not an application). The `safety:flagged` class — "code ships dark behind a feature flag, drain processes after flag-flip" — is an app-shape concept that lives on application forks (e.g., `gembaflow-site`).

**Resolution:** Not a gap — by design. App-shape forks define their own `safety:flagged` handling; meta doesn't need to.

## No `--include-hot` flag

`safety:hot` tickets are ALWAYS refused by drain. There is no override flag. The operator hand-merges hot tickets via direct `/work-ticket #N` invocation, which is the explicit human-in-the-loop boundary.

**Resolution:** Not planned. Adding `--include-hot` would weaken the safety contract. The hand-merge path is the right surface for hot work.

## Deploy validation is provider-shaped

`scripts/render-deploy-status.mjs` and `scripts/sentry-baseline.mjs` are Render-specific and Sentry-specific respectively. Each carries a `// provider: <name>-only` docstring at the top of the file that marks it as a candidate for the future provider-plugin generalization.

A fork that uses a different deploy or observability provider can:

1. Set the relevant env vars to empty so the drain skips those pre-flight checks gracefully (no failure, just no signal).
2. Replace the scripts with a provider-specific equivalent and update the env var contract.
3. Wait for the provider-plugin generalization tickets (`vibeacademy/gembaflow#420` for deploy, `#421` for observability) to ship a generic interface.

**Resolution:** `#420` and `#421` are filed and unblocked by T3's ship, but parked pending the empirical-grounding trigger (a second concrete deploy/observability provider materializing on a real downstream fork). Premature generalization risk otherwise.

## Sentry baseline of zero is ambiguous

A pre-deploy Sentry baseline of `0 errors/min` over a 30-day window has two interpretations: production is genuinely clean, OR Sentry isn't actually capturing events from the production runtime. The baseline script can't distinguish these — see [[Lesson-sentry-baseline-zero-is-ambiguous]].

**Resolution:** One-time verification — trigger a deliberate 500 from a test endpoint, confirm it lands in Sentry's UI within minutes. The check removes the ambiguity for all future drain runs. Operators should do this once during initial setup, before relying on the Sentry pre-flight as a real gate.

## Default `typecheck` doesn't run on `npm test`

Project's local `npm test` invokes Vitest only; `npm run typecheck` (which runs `tsc --noEmit`) is invoked in CI but is NOT part of the default local pre-flight. See [[Lesson-typecheck-only-runs-in-CI-not-local-npm-test]].

**Resolution:** Operator discipline — run `npm run typecheck` alongside `npm test` before pushing, OR extend the pre-push hook to chain typecheck. Not a drain-specific limitation, but commonly hits drain-shipped work because the drain's per-iteration cycle pushes from local without explicit typecheck.

<!-- Source: Gemba Flow (https://github.com/vibeacademy/gembaflow) -->
<!-- SPDX-License-Identifier: BUSL-1.1 -->
