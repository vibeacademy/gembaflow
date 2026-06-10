# Safety Classes — Drain Eligibility Taxonomy

Every open ticket (Backlog + Ready) on a fork's project board should
carry **exactly one** `safety:*` label that tells the `/drain` skill
(when present) whether the ticket is safe to process autonomously, and
if so, how to validate the merge.

This document is the framework's operational guide. Downstream forks
ship the same taxonomy via `/upgrade` and may calibrate the examples
to match their stack (a Next.js + Render fork's examples differ from a
docs-only fork's, but the four classes are the same).

## The four classes

| Label | Drain action | Validation depth |
|---|---|---|
| `safety:flagged` | Merge → validate via flag override → mark Done | Full validation suite, flag-override on |
| `safety:internal` | Merge → smoke (`/api/health` + `/` 200) → mark Done | Minimal — nothing user-facing changed |
| `safety:reversible` | Merge → full validation → mark Done OR rollback + mark Blocked | Full validation suite, no override |
| `safety:hot` | **Refused** — drain skips, ticket stays in Ready | n/a |

## Decision tree

```text
Does the change touch app/ or runtime components?
├── NO  → safety:internal
└── YES → Is it auth, payment, data-loss-risk, or schema migration?
         ├── YES → safety:hot
         └── NO  → Is the user-visible behavior gated by a feature flag?
                  ├── YES → safety:flagged
                  └── NO  → Is the change revertable within 15min by
                            git revert + redeploy, with no schema or
                            data effect?
                            ├── YES → safety:reversible
                            └── NO  → safety:hot
```

Mutually exclusive: a ticket carries exactly one label. When in doubt,
classify **higher** — `safety:hot` is a feature, not a failure.

## `safety:flagged`

User-visible behavior gated behind a feature-flag entry in the fork's
flag library (whatever the fork uses — `lib/feature-flags.ts`,
`config/flags.yaml`, a LaunchDarkly client, etc.). Default `false`;
only the validation suite (via a header/cookie override mechanism)
exercises the flagged-on path. Real users never see the change until a
separate promotion event flips the default.

**Drain action:** merge → wait for deploy → warm-up → validation suite
with flag override → on PASS mark Done (code is live, flag still false
for users); on FAIL trigger rollback.

**Examples:**

- Add a new homepage hero variant for A/B testing
- Enable a new search ranking algorithm
- Show a beta install option to opted-in cohort
- Add a beta-banner to `/quickstart`
- Roll out a new analytics event firing convention

Forks without a feature-flag library cannot use this class — they
have no override mechanism to validate against. If your fork doesn't
ship feature flags, your work falls into the other three classes (or
you add a flag library first as a `safety:internal` ticket).

## `safety:internal`

Touches only behind-the-scenes surfaces: tests, scripts, CI
configuration, build configuration, non-runtime utilities, or docs.
The deployed product looks and behaves identically to real users.

**Drain action:** merge → wait for deploy → smoke test only
(`curl -fsS /api/health` and `curl -fsS /` both return 200) → mark
Done. No browser automation; nothing user-facing changed to validate.

For forks with no application (docs/dotfile harness forks), there's
no deploy and no smoke test — the merge IS the work. Drain calibrates
its outcome accordingly.

**Examples:**

- Add jest-axe (or equivalent) accessibility assertions to existing
  test suites
- Feature flag library scaffold (touches `lib/`, `docs/`, env-var list)
- Sentry error-rate baseline scripts
- CI configuration changes (Lighthouse, lint, type-check workflows)
- Workflow files for orchestrator scaffolding without user-facing
  surface area

## `safety:reversible`

Small isolated change with real user-visible effect, but the effect
is fully revertable by `git revert` + redeploy within a 15-minute
rollback budget. No schema migrations, no data migration, no auth or
payment paths.

**Drain action:** merge → full validation suite against production
(no flag override — the change IS the user-visible state) → on PASS
mark Done; on FAIL rollback within 60 seconds and mark Blocked.

**Drain rate-limit:** at most one `safety:reversible` ticket per
30-minute window within a single drain run (configurable via
`DRAIN_REVERSIBLES_WINDOW_MIN`). Two reversibles back-to-back is the
failure shape we explicitly avoid — when both fail, debugging the
rollback target becomes ambiguous.

**Excluded from the default `--safety-class` filter** — drain runs
`flagged,internal` only unless the operator explicitly passes
`--include-reversible`.

**Examples:**

- One-line copy fix shipped via `/quick-fix` (e.g., "seven agents" →
  "six agents")
- CSS class addition isolated to one component
- Single-page typo fixes
- Brand color swap on a Hero component
- Server-side route change without schema or auth implications

## `safety:hot`

Anything where being wrong, even briefly, is harmful and not undoable
by a fast revert: auth flow changes, payment paths, data-loss-risk
code (deletes, exports, irreversible migrations), and database schema
migrations (since a shared production DB makes schema changes
impossible to dark-launch).

**Drain action:** **REFUSED.** Drain skips the ticket cleanly with an
audit comment, leaves it in Ready, and continues to the next ticket.
The wake-up summary lists every `safety:hot` ticket skipped so the
operator can promote them to a morning manual queue.

**Examples (keep this surface area small):**

- Change session token storage shape or location
- Add a Stripe checkout flow
- Migrate `users.id` from auto-increment to UUID
- Add a data-export endpoint (privacy regression risk)
- Implement password reset
- Loosen CSP to allow third-party iframes
- Any production-database schema migration

## When in doubt

Pick the **higher** class. The cost of a too-conservative
classification is the ticket waits for a human; the cost of a
too-permissive one is production breakage at 3am.

Borderline calls:

- Small bug fix in a server-side API route → `safety:reversible` if
  the failure mode is bounded; `safety:hot` if it touches auth /
  payment / data.
- New content page → `safety:flagged` if it adds navigation entries
  or conversion surface; `safety:internal` if it's only in `content/`
  and not linked from any sidebar yet; `safety:reversible` if it
  ships linked but tiny.
- Refactor that touches `components/` without behavior change →
  `safety:reversible` (component CSS could regress visually); promote
  to `safety:flagged` if you want the validation suite to exercise
  the new code path explicitly.

## How this gets enforced

- **At ticket-creation time:** the `/groom-backlog` Definition-of-Ready
  check refuses to promote any ticket to Ready without a `safety:*`
  label.
- **At drain entry:** the `/work-ticket` skill, when invoked with
  `DRAIN_CONTEXT=true`, reads the ticket's labels and:
  - exits with `safety:unclassified — abort` if no `safety:*` label or
    more than one;
  - exits with `safety:hot — refused by drain` if the class is `:hot`;
  - proceeds normally for `:flagged`, `:internal`, `:reversible` (the
    last only if the operator passed `--include-reversible`).
- **At drain merge:** the `agent-merge.yml` gate workflow re-verifies
  the label is one of the drain-eligible three before invoking
  `gh pr merge` (conditions 1–2 of the gate's 7-condition check).

## Revising a classification

Labels are mutable. If a ticket's scope evolves during implementation
and the new shape no longer fits its class, the worker (or reviewer)
updates the label on the issue and notes the change in the PR body. A
class-up is always fine; a class-down (e.g. `:reversible` →
`:internal`) requires explicit reasoning in the PR body, since it
widens the drain's permission to merge unattended.

## References

- [`.github/workflows/agent-merge.yml`](../.github/workflows/agent-merge.yml) —
  the gate workflow that enforces conditions 1–2 at merge time
- [`docs/agent-merge-gate.md`](agent-merge-gate.md) — operator-facing
  guide for the gate workflow, including the `IGNORED_CHECKS`
  allowlist policy
- `.claude/commands/work-ticket.md` — drain-mode pre-flight enforcement
  (port pending — see the drain epic)
- `.claude/commands/drain.md` — the skill that consumes this taxonomy
  (port pending — see the drain epic)
- `.claude/commands/groom-backlog.md` — Ready-promotion enforcement
