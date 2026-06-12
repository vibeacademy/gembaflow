# Sentry Error-Rate Gating

The `/goal deploy` (#118) and `/goal drain` (#126) validation workflows
treat **Sentry error rate** as one of the post-deploy gates: if the
5-minute window after a deploy shows error rates substantially above
the 30-day baseline, the deploy is rolled back automatically.

The two scripts that wrap this measurement live at:

- `scripts/sentry-baseline.mjs` — 30-day rolling baseline (median errors/min)
- `scripts/sentry-post-deploy-rate.mjs` — 5-minute post-deploy window (mean errors/min)

Architectural rationale: [`reports/deployment-architecture-2026-06-03.md` §6](../../reports/deployment-architecture-2026-06-03.md) and the devops-review §10 item 3 ("ignore if pre-deploy rate was zero").

## What the scripts measure

| Script | Window | Aggregate | Why |
|---|---|---|---|
| `sentry-baseline.mjs` | 30 days | median errors/min | Median is robust against single-event spikes; the goal is "what's normal," not "what's the worst hour." |
| `sentry-post-deploy-rate.mjs` | 5 minutes | mean errors/min | Mean catches a sustained elevation across all 5 buckets; a single elevated minute won't trip a false positive. |

Both query the same Sentry project-stats endpoint with different
window and resolution parameters.

## Configuration (environment variables)

| Variable | Required | Notes |
|---|---|---|
| `SENTRY_API_URL` | yes | Base URL — typically `https://sentry.io/api/0` |
| `SENTRY_AUTH_TOKEN` | yes | Sentry auth token with `project:read` scope |
| `SENTRY_ORG` | yes | Org slug (the path segment after `https://sentry.io/organizations/`) |
| `SENTRY_PROJECT` | yes | Project slug |

If **any** of these are missing, the script emits
`source: "unavailable"` with a reason naming the missing variable.
Exit code is `0` either way — the caller decides whether to skip the
gate or fail loudly. This is the devops-review-approved posture:
zero-traffic projects shouldn't break the deploy pipeline.

## Output shape

Both scripts emit one JSON line on stdout.

`sentry-baseline.mjs`:

```json
{
  "baseline_errors_per_min": 0.5,
  "source": "sentry",
  "window_days": 30,
  "sample_count": 720
}
```

`sentry-post-deploy-rate.mjs`:

```json
{
  "post_deploy_errors_per_min": 0.7,
  "source": "sentry",
  "window_minutes": 5,
  "sample_count": 5
}
```

When the measurement is unavailable (config missing, Sentry down,
HTTP non-2xx, or network throw), both shapes share the same envelope:

```json
{
  "baseline_errors_per_min": null,
  "source": "unavailable",
  "reason": "missing env: SENTRY_API_URL",
  "window_days": 30,
  "sample_count": 0
}
```

A warning line goes to stderr (`sentry-baseline: missing env: ...`)
so the calling workflow log captures the reason.

## When the scripts get called

The intended consumers, both still to be implemented:

- **`/goal deploy` (#122 — orchestrator):** runs `sentry-baseline.mjs`
  immediately before the deploy starts; runs
  `sentry-post-deploy-rate.mjs` 5 minutes after the deploy completes
  warm-up. The gate passes if
  `post_deploy_errors_per_min ≤ 2 × baseline_errors_per_min`
  (or always passes if `source === "unavailable"`, per the devops-review
  default).
- **`/goal drain` (#130 — orchestrator):** runs `sentry-baseline.mjs`
  during pre-flight (compares against last-24h baseline per drain §6);
  runs `sentry-post-deploy-rate.mjs` after each `safety:reversible`
  ticket merges. Drain stops if a rolled-back ticket's post-deploy
  rate doesn't return to baseline.

## Failure modes

The scripts intentionally fail soft:

| Failure | Behavior |
|---|---|
| Any required env var missing | `source: "unavailable"`, reason names the missing variable |
| Sentry returns HTTP non-2xx | `source: "unavailable"`, reason is `HTTP <code>` |
| `fetch` throws (DNS, TLS, timeout) | `source: "unavailable"`, reason quotes the error message |
| Sentry returns an empty series | `source: "sentry"`, value is `0`, `sample_count: 0` |
| Sentry returns all-zero buckets | `source: "sentry"`, value is `0`, `sample_count` matches bucket count |

The "all-zero" case is distinct from "unavailable" — zero traffic is
real data. The deploy gate uses this to decide whether to apply the
ratio check at all (zero baseline means the ratio is undefined, so the
gate should skip rather than divide by zero).

## Local invocation

```bash
# Real Sentry (must set env)
SENTRY_API_URL=https://sentry.io/api/0 \
SENTRY_AUTH_TOKEN=... \
SENTRY_ORG=... \
SENTRY_PROJECT=... \
node scripts/sentry-baseline.mjs

# Unconfigured (just exercises the unavailable path)
node scripts/sentry-baseline.mjs
# → emits {"baseline_errors_per_min":null,"source":"unavailable",...}
```

## References

- [`scripts/sentry-baseline.mjs`](../../scripts/sentry-baseline.mjs)
- [`scripts/sentry-post-deploy-rate.mjs`](../../scripts/sentry-post-deploy-rate.mjs)
- [`__tests__/sentry-baseline.test.ts`](../../__tests__/sentry-baseline.test.ts)
- [`__tests__/sentry-post-deploy-rate.test.ts`](../../__tests__/sentry-post-deploy-rate.test.ts)
- [`reports/deployment-architecture-2026-06-03.md`](../../reports/deployment-architecture-2026-06-03.md) — §6 validation suite, §10 devops review item 3
