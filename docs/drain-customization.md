# Drain customization

The drain skill ships with sensible defaults but exposes a customization surface that every fork operator should configure before the first run. This document is the **Layer 4 contract** — the complete list of values an operator must supply or accept, in one place.

## The templated values

The drain skill spec (`.claude/commands/drain.md`) and the worker spec (`.claude/commands/work-ticket.md`) reference fork-specific values through bootstrap-time placeholders. See [PLATFORM-GUIDE.md § "Bootstrap-time templated values"](PLATFORM-GUIDE.md) for the full mechanism.

| Placeholder | Where it's set | What it is |
|---|---|---|
| `{{org}}` | `.gembaflow-config.json` `.org` | GitHub org login that hosts the framework + this fork |
| `{{board.id}}` | *(RETIRED)* | Retired with the beads cutover (epic #574) — Ready is computed by `bd ready`, not a project board. Harmless if still present in an older config. |
| `{{bot.worker}}` | `.gembaflow-config.json` `.bot.worker` | Worker bot login — opens PRs, makes commits, runs `gh pr review --comment` for non-verdict notes |
| `{{bot.reviewer}}` | `.gembaflow-config.json` `.bot.reviewer` | Reviewer bot login — posts `gh pr review --approve` / `--request-changes` verdicts |

After `bootstrap-workflow` writes `.gembaflow-config.json` and runs `scripts/substitute-config-placeholders.sh`, these placeholders are replaced with concrete values in the shipped spec files. Re-run the substitution after any `/upgrade` that brings in updated specs.

## Required env vars for autonomous-merge gate

The gate workflow (`.github/workflows/agent-merge.yml`, from T1) reads these from `${{ secrets }}` at job run time:

| Secret | Required? | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | yes (auto-provided) | Default Actions token. Sufficient for the gate's read/write operations on PRs, issues, checks, and actions. |

The bridge workflow (`.github/workflows/drain-merge-bridge.yml`, from T3) inherits the same token shape — no extra secrets required for the merge path.

## Required env vars for observability

The two provider-specific scripts shipped in T3 require fork-specific configuration. Both are opt-in: if the env vars aren't set, the corresponding pre-flight check is skipped with a documented reason rather than failing the run.

### Render (deploy-status polling)

| Env var | Where to find | Purpose |
|---|---|---|
| `RENDER_API_KEY` | Render dashboard → Account Settings → API Keys | Authenticates to `https://api.render.com/v1/...` |
| `RENDER_SERVICE_ID` | Render dashboard → Service → Settings (URL path: `srv-...`) | Specific service to poll |

See [docs/testing/render-gating.md](testing/render-gating.md) for the full setup walkthrough.

### Sentry (error-rate baseline)

| Env var | Where to find | Purpose |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens → **Organization** tab | Authenticates to Sentry's API. **Use an org token, not a user token** — see [[Lesson-sentry-org-token-for-unattended-automation]]. |
| `SENTRY_API_URL` | Constant per region: SaaS-US `https://sentry.io/api/0`, EU `https://de.sentry.io/api/0`, self-hosted: your host + `/api/0` | API base URL |
| `SENTRY_ORG_SLUG` | Sentry → Settings → Organization (lowercase slug, not display name) | Org identifier in API URLs |
| `SENTRY_PROJECT_SLUG` | Sentry → Project → Settings (lowercase slug) | Project identifier in API URLs |

See [docs/testing/sentry-gating.md](testing/sentry-gating.md) for the full setup walkthrough.

**Required scope on the Sentry token:** `project:read` — least privilege; the baseline script only reads stats.

### Public base URL (post-merge validation)

| Env var | Where to find | Purpose |
|---|---|---|
| `PUBLIC_BASE_URL` | Your fork's deploy URL | Used by `drain.md`'s post-merge validation step (Playwright `@smoke-production` or `curl` probe) |

The drain spec instructs the operator to export this before invoking. A misconfigured fork sees the failure mode immediately rather than getting silent gembaflow-site URL leakage.

## Optional: Slack webhook

| Env var | When to set | What it does |
|---|---|---|
| `SLACK_WEBHOOK_URL` | If your team wants the wake-up summary posted to a Slack channel in addition to the drain-tracker issue | `emit-drain-summary.mjs`'s `postSlackSummary(md, state)` helper fires only when this is set |

If unset, the wake-up summary lands as a GitHub comment on the drain-run tracker issue only. The summary's content is identical in both surfaces.

## Required CI checks

The gate workflow's 7-condition autonomous-merge contract reads from `gh api repos/.../commits/.../status` and `.../check-runs`. A check's status must be `success`, `neutral`, or in the gate's `IGNORED_CHECKS` allowlist (default empty) for the merge to proceed.

A fork that wants `/drain` to autonomously merge must:

1. Ensure every required-status-check on the `main` ruleset reports a definitive status (`success` / `failure`) for the gate to read. Checks that report `skipping` are not OK by default.
2. Populate `IGNORED_CHECKS` in `.github/workflows/agent-merge.yml`'s env block if any informational-but-flaky checks are tolerable to ignore (e.g., a preview-deploy smoke test that's known to flake). See `docs/agent-merge-gate.md` for the 3-criteria bar for adding `IGNORED_CHECKS` entries.

## Optional: label colors

The `safety:*` labels created by T1 ship with canonical colors:

| Label | Color | Meaning |
|---|---|---|
| `safety:internal` | `0e8a16` (green) | Meta work; drain processes these freely (default filter) |
| `safety:reversible` | `fbca04` (yellow) | Small contained changes with downstream-fork visibility but revertable; drain processes with rate limit (1 per 30 min default) when `--include-reversible` passed |
| `safety:hot` | `d73a4a` (red) | Runtime-protected paths, ruleset changes, sync mechanics; drain ALWAYS refuses |
| `safety:flagged` | `1d76db` (blue) | App-shape forks only — code ships dark behind a feature flag; drain processes with appropriate gating |

Forks may pick different colors. The label *names* are load-bearing (the gate reads them); the *colors* are operator preference.

## Bridge workflow installation

`.github/workflows/drain-merge-bridge.yml` is the one piece of the drain runtime that does NOT propagate via sync (workflow files aren't in `syncDirectories`). Each fork installs it manually:

```bash
curl -fsSL https://raw.githubusercontent.com/vibeacademy/gembaflow/main/.github/workflows/drain-merge-bridge.yml \
  -o .github/workflows/drain-merge-bridge.yml
```

Or, if you have an upstream clone alongside your fork:

```bash
cp ../gembaflow/.github/workflows/drain-merge-bridge.yml .github/workflows/
```

After installing, commit the file. Verify the bridge resolves by dispatching it once in dry-run mode (see ADR-0002's "Defense-in-depth caveat" for the recommended dispatch shape).

## Customization summary checklist

Before the first real `/drain` run on your fork:

- [ ] `.gembaflow-config.json` exists with all four placeholders filled in
- [ ] `scripts/substitute-config-placeholders.sh --check` reports zero unsubstituted placeholders
- [ ] `RENDER_API_KEY`, `RENDER_SERVICE_ID` set in your shell or skill-invocation env (if using Render)
- [ ] `SENTRY_AUTH_TOKEN` (org-scoped), `SENTRY_API_URL`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG` set (if using Sentry)
- [ ] `PUBLIC_BASE_URL` set to your fork's deploy URL
- [ ] `.github/workflows/drain-merge-bridge.yml` installed (see § "Bridge workflow installation")
- [ ] `.github/workflows/agent-merge.yml` installed (same flow as above; copy from upstream `.github/workflows/`)
- [ ] All four `safety:*` labels created on the fork's primary repo (the gate reads these) — run `bash scripts/setup-safety-labels.sh` once on the repo; the helper is idempotent and can be re-run safely. Verify with `bash scripts/setup-safety-labels.sh --check`.
- [ ] At least one `/drain --dry-run` against a non-empty Ready column passed before any unattended overnight run (see [[Pattern-dryrun-before-first-overnight-automation]])

See [docs/drain-known-limitations.md](drain-known-limitations.md) for what `/drain` v1 deliberately does NOT do.

<!-- Source: Gemba Flow (https://github.com/vibeacademy/gembaflow) -->
<!-- SPDX-License-Identifier: BUSL-1.1 -->
