# Render Deploy-Status Gating

The `/drain` skill (#180) and any future autonomous merge mechanism
need to know "is the specific deploy for this merge live yet?" before
running post-merge validation. The naive substitute — a `curl` probe
of the public URL — only tells you "some version of the site is
alive," not "the version with my merge is alive." For
`safety:internal` tickets (no user-visible change) the substitute is
fine; for `safety:flagged` or `safety:reversible` it's a real semantic
gap.

This gate closes the gap by querying Render's API for the deploy
matching the merge commit's SHA. The script that wraps it lives at:

- [`scripts/render-deploy-status.mjs`](../../scripts/render-deploy-status.mjs) — query Render's list-deploys endpoint for the deploy matching a given SHA

Companion: [`docs/testing/sentry-gating.md`](sentry-gating.md) follows
the same env-gated, structured-return-shape, never-throws pattern.

## What the script measures

The script queries Render's `GET /v1/services/{serviceId}/deploys?limit=20`
endpoint and searches the recent slice for a deploy whose `commit.id`
matches the given SHA. Returns:

| Status return | Meaning |
|---|---|
| `live` (with `live: true`) | The matching deploy is live — safe to run validation |
| `build_in_progress` / `update_in_progress` / etc. | Matching deploy exists but hasn't finished — poll again |
| `pending` | No matching deploy in the recent window — Render hasn't received the push yet, or it's older than the limit. Poll again |
| `build_failed` / `update_failed` / `canceled` | Matching deploy explicitly failed — don't proceed; fall back to rollback |
| `null` (with `source: "unavailable"`) | Token unconfigured, API unreachable, or network error — fall back to the curl probe |

## Configuration (environment variables)

| Variable | Required | Notes |
|---|---|---|
| `RENDER_API_TOKEN` | yes | Render API token. **Org tokens preferred** for unattended automation (survives operator changes; matches the Lesson-sentry-org-token-for-unattended-automation discipline from 2026-06-08). Render doesn't currently differentiate scopes — tokens are account-level. If you want a dedicated automation identity, create a separate Render account for automation in the long run. |
| `RENDER_SERVICE_ID` | yes | The service ID (starts with `srv-`). Find it in Render's dashboard URL when viewing the service. |
| `RENDER_API_BASE` | no | Defaults to `https://api.render.com/v1`. Override for self-hosted or test fixtures. |

If any required variable is missing, the script emits
`source: "unavailable"` with a reason naming the missing variable.
Exit code is `0` either way — the caller decides whether to fall back
to the curl probe (the `/drain` skill does fall back). This is the
same posture as `scripts/sentry-baseline.mjs` — zero-config or
zero-deployment projects shouldn't break the drain pipeline.

## Output shape

`render-deploy-status.mjs` emits one JSON line on stdout.

Happy path (deploy is live):

```json
{
  "live": true,
  "status": "live",
  "source": "render",
  "deployId": "dep-xxx",
  "sha": "abc123def456"
}
```

Deploy still building:

```json
{
  "live": false,
  "status": "build_in_progress",
  "source": "render",
  "deployId": "dep-xxx",
  "sha": "abc123def456"
}
```

No matching deploy in the recent window:

```json
{
  "live": false,
  "status": "pending",
  "source": "render",
  "sha": "abc123def456",
  "reason": "no deploy found for this sha in the recent window"
}
```

Unavailable (config missing, Render down, HTTP non-2xx, network throw,
unexpected response shape):

```json
{
  "live": false,
  "status": null,
  "source": "unavailable",
  "reason": "missing env: RENDER_API_TOKEN, RENDER_SERVICE_ID"
}
```

A warning line goes to stderr (`render-deploy-status: ...`) so the
calling workflow log captures the reason.

## Operator setup (manual, one-time)

Following the same shell-level pattern used for Sentry on 2026-06-08:

1. Log into Render (https://dashboard.render.com), navigate to **Account
   Settings → API Keys**, create a new API key. Copy the value
   immediately — Render won't show it again.
2. Find the service ID: navigate to the `gembaflow-site` service in
   the dashboard; the URL contains `srv-<id>` — copy that segment.
3. Persist both via fish universal variables:

   ```fish
   set -Ux RENDER_API_TOKEN <paste-token-here>
   set -Ux RENDER_SERVICE_ID srv-<paste-id-here>
   ```

4. **Restart Claude Code** (or wrap dependent commands in `fish -c "..."`)
   per the saved `Lesson-claude-code-bash-does-not-inherit-fish-universal-vars`
   discipline.
5. Verify: `fish -c "node scripts/render-deploy-status.mjs $(git rev-parse main)"`
   should emit a JSON line with `source: "render"` (not `"unavailable"`).

## Fallback behavior

When the env vars are unset OR Render's API is unreachable, the
`/drain` skill's step 9 polling loop exits immediately on
`source: "unavailable"` and step 10's curl probe (`curl /api/health`
&& `curl /` returning 200 from both) alone gates liveness. This is the
v1 behavior from before #180 shipped, and it remains the safe fallback
forever — the new env vars upgrade the gate without making it a hard
requirement.

The curl probe was empirically validated during the first real
`/drain` run on 2026-06-08 (drain anchor #174). It correctly gated
liveness for a `safety:internal` ticket (#132 → PR #175 → e1755f5)
without any Render API access.

## Auto-deploy webhook fallback (per #194)

Render's GitHub integration delivers webhooks to trigger auto-deploys
on push, but this delivery is **empirically unreliable** — two real
drain runs in succession on 2026-06-09 saw cases where pushes to
`main` didn't trigger Render's auto-deploy (no `deploy_started` event
in Render's events feed despite the commit landing on `main`).

The `/drain` skill's step 9 includes an **auto-trigger fallback**: if
5 consecutive `pending` polls (~2.5 minutes) indicate no deploy was
ever found for the merge SHA, the skill POSTs to
`/v1/services/{id}/deploys` with empty body — Render then builds the
latest commit on `main` (which IS the merge). The fallback fires at
most once per ticket cycle (an `AUTO_TRIGGERED` flag), so a failed
manual deploy doesn't trigger an endless retry loop.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DRAIN_RENDER_AUTO_TRIGGER` | `true` | When `true`, step 9 auto-triggers a Render deploy after 5 consecutive pending polls. Set to `false` to opt out (drain step 9 will time out and treat the ticket as merged-but-not-deployed per #189). |

### When to opt out

Set `DRAIN_RENDER_AUTO_TRIGGER=false` when:

- You're investigating provider-side reliability issues and want raw
  empirical data on how often Render's webhook delivery actually fails
  (the auto-trigger masks the symptom)
- You're running against a forked service where the manual-trigger API
  has different semantics than the standard Render API
- You want strict v1 behavior to validate the rest of the drain stack
  without the fallback layered on top

### Empirical history

- 2026-06-09 drain run #2 cycle 2 (PR #193 / #185): manual operator
  trigger needed; auto-deploy never fired
- 2026-06-09 drain run #2 cycle 3 (PR #195 / #149): Render preview
  build also didn't fire, causing gate refusal
- 2026-06-09 drain run #3 cycle 1 (PR #199 / #189): auto-deploy fired
  cleanly — confirming the intermittent (not total) nature
- 2026-06-09 drain run #3 cycle 2 (PR for #194 itself): if the
  fallback fires before this PR merges, that's the empirical
  validation of the fix shipping through its own mechanism

## Token rotation

Render API tokens currently have no expiry per their own dashboard.
Manually rotate by:

1. In Render's API Keys panel, click "Revoke" on the old token
2. Create a new token (same scope — least privilege, just `project:read`-equivalent semantic)
3. Update fish: `set -Ux RENDER_API_TOKEN <new>`
4. Restart Claude Code

Quarterly rotation matches the discipline applied to
`FEATURE_FLAG_OVERRIDE_SECRET` (per `render.yaml` annotation —
"Rotated quarterly per the flag-sunset audit").

## References

- [`scripts/render-deploy-status.mjs`](../../scripts/render-deploy-status.mjs) — the script
- [`scripts/sentry-baseline.mjs`](../../scripts/sentry-baseline.mjs) — the same pattern for Sentry error-rate
- [`docs/testing/sentry-gating.md`](sentry-gating.md) — the sister gating doc; same env-var contract
- [`.claude/commands/drain.md`](../../.claude/commands/drain.md) — step 9 uses this script + step 10 has the curl fallback
- [Render API reference — list deploys](https://api-docs.render.com/reference/list-deploys) — the underlying endpoint
