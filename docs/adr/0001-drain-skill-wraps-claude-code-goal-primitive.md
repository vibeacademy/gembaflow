# ADR-0001: `/drain` skill wraps Claude Code's `/goal` primitive

**Status:** Accepted
**Date:** 2026-06-12 (ported to upstream from `vibeacademy/gembaflow-site`'s ADR-006)
**Supersedes:** none (first ADR upstream)
**Superseded by:** none

## Context

The `/drain` skill drives unattended overnight processing of the Ready column on a project board: pick the top ticket, run `/work-ticket` against it, watch CI, post a review verdict, dispatch a gated autonomous merge, mark Done, repeat until the snapshot is empty or a hard-stop condition fires. The orchestration is a loop; the loop driver had to be one of three things:

1. A custom GitHub Actions workflow (`goal-drain.yml`) running on a schedule, with state persisted between runs.
2. A long-lived Claude Code session iterating turn-by-turn against an operator's machine.
3. Claude Code's built-in `/goal` primitive, which already supports the "evaluator decides whether to fire another turn" loop shape.

The choice shapes everything downstream: where state lives, how the operator interacts with the run, what happens when the loop hits a hard stop, what telemetry the run produces.

## Decision

The drain skill is a **Claude Code skill** (`.claude/commands/drain.md`) that wraps the built-in `/goal` primitive. Each `/goal` turn advances one ticket through the per-iteration cycle; the evaluator checks the completion condition at the end of every turn and fires another turn if not met.

State lives in `/tmp/drain-state.json` on the operator's machine (built up incrementally during the run). The wake-up summary is rendered from that JSON at end-of-run and posted as a comment on the originating drain-run tracker issue.

## Consequences

### Positive

- **Zero net-new infrastructure.** No new workflow file, no scheduled trigger, no state-store service. The skill spec is the artifact; the `/goal` primitive is the engine.
- **Operator-visible loop.** The operator can see each turn happen in their Claude Code session. There's no "what's the cron doing right now" mystery.
- **Cancellable.** Closing the Claude Code session cancels the loop cleanly. There's no orphan workflow to kill.
- **Forks adopt easily.** Downstream forks `/upgrade` to pick up `drain.md`; no per-fork workflow file install beyond the bridge (ADR-0002).

### Negative

- **The operator's machine must stay on** for the duration of the run. v1 is operator-active; remote unattended operation is a future ticket (#419 — drain v3 state persistence + `--resume`).
- **The Claude Code session must stay open.** Closing it cancels the loop. v1 accepts this trade-off explicitly.
- **No persistence across sessions.** If the loop is killed mid-run, the operator restarts from the next ticket in the snapshot — the snapshot itself is preserved, but per-ticket state isn't. v3 addresses this.

### Out of scope (explicitly NOT done in v1)

- No `goal-drain.yml` workflow. Tickets that cite this file as a deliverable were written before this ADR landed; the supersession is flagged in PR bodies per [[Pattern-flag-architecture-supersession-in-ticket-text]].
- No shared `goal.md` skill. The Claude Code primitive is consumed directly; no abstraction layer is introduced.
- No Anthropic API integration for v1. The skill runs against Claude Code's session; remote API-driven execution is a future direction.

## Sources

- `vibeacademy/gembaflow-site` ADR-006 (PR #171, 2026-06-08) — original architectural decision in the empirical-development fork.
- `vibeacademy/gembaflow-meta:plans/drain-upstream-port.md` — port plan that brought this decision upstream.
- [[Pattern-flag-architecture-supersession-in-ticket-text]] — the discipline for handling tickets that pre-date this decision.

<!-- Source: Gemba Flow (https://github.com/vibeacademy/gembaflow) -->
<!-- SPDX-License-Identifier: BUSL-1.1 -->
