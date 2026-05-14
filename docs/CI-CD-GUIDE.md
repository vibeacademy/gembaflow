# CI/CD Guide

This document describes all GitHub Actions workflows, their triggers,
required secrets, and default states.

## Workflow Overview

| Workflow | File | Trigger | Default State | Required Secrets |
|----------|------|---------|---------------|------------------|
| CI | `ci.yml` | Push/PR to main | Active | None |
| Release | `release.yml` | Tag `v*` | Active | None |
| Deploy | `deploy.yml` | Push to main | Inert | RENDER_API_KEY, RENDER_SERVICE_ID |
| Preview Deploy | `preview-deploy.yml` | PR opened/updated | Inert | RENDER_API_KEY, RENDER_SERVICE_ID, SUPABASE_ACCESS_TOKEN*, SUPABASE_PROJECT_REF* |
| Preview Cleanup | `preview-cleanup.yml` | PR closed | Inert | RENDER_API_KEY, RENDER_SERVICE_ID, SUPABASE_ACCESS_TOKEN*, SUPABASE_PROJECT_REF* |
| Auto Review | `auto-review.yml` | PR opened/ready | Active | None |
| Auto Fix | `auto-fix.yml` | PR opened/updated | Active | None |
| Rollback | `rollback-production.yml` | Manual dispatch | Inert | RENDER_API_KEY, RENDER_SERVICE_ID |

*\* Optional — Supabase steps skip gracefully when these secrets are not configured.*

## Active by Default

These workflows run without any configuration.

### CI (`ci.yml`)

Runs on every push and pull request to `main`.

**Jobs:**

| Job | What It Checks |
|-----|----------------|
| `lint` | Markdown formatting (markdownlint) |
| `typecheck` | JSON file validity |
| `build` | Shell script correctness (shellcheck) |
| `test` | Command and agent file validation |
| `lint-agent-policies` | Agent policy safety rules |
| `node` | ESLint, tsc --noEmit, Vitest, Next.js build |
| `python` | Ruff lint, mypy (non-blocking), pytest with coverage |

The `node` job is conditional — it only runs when `package.json` exists.
The `python` job is conditional — it only runs when `pyproject.toml` exists.
Both can coexist; the template ships with Next.js by default so the `node`
job runs and the `python` job skips. If you swap to the FastAPI starter
(see `starters/fastapi/README.md`), the jobs reverse automatically.

Coverage threshold for the Python job defaults to 80% and can be overridden
via the `COVERAGE_THRESHOLD` environment variable.

### Release (`release.yml`)

Triggers when a `v*` tag is pushed. Extracts the matching section from
`CHANGELOG.md` and creates a GitHub Release.

### Auto Review (`auto-review.yml`)

Posts a review reminder comment on new PRs, prompting the team to run
`/review-pr` for an agent review.

### Auto Fix (`auto-fix.yml`)

Automatically fixes lint issues on PR branches. Detects the project
type and runs the appropriate fixer:

- **Python** (when `pyproject.toml` exists): runs `ruff check --fix`
  and `ruff format`
- **Node.js** (when `package.json` exists): runs `npx eslint . --fix`

Fixed files are committed back to the PR branch automatically.

## Enable When Ready

These workflows require secrets to be configured in the repository settings.
Until configured, they skip gracefully with no red CI.

### Deploy (`deploy.yml`)

Deploys to Render production on merge to `main`.

**To enable:**

1. Go to **Settings > Secrets and variables > Actions**
2. Add these repository secrets:

| Secret | Where to Find |
|--------|--------------|
| `RENDER_API_KEY` | Render Dashboard > Account Settings > API Keys |
| `RENDER_SERVICE_ID` | Render Dashboard > Service > Settings (starts with `srv-`) |

The workflow stores the previous deployment ID before deploying, which can
be used for rollback.

If a `supabase/migrations/` directory exists and `SUPABASE_DB_URL` is
configured, database migrations run automatically after deployment.

For preview environments, migrations are handled differently: the
`preview-deploy.yml` workflow links to the Supabase branch database and
runs `supabase db push` directly. This applies migrations to the isolated
branch database rather than the production database.

### Preview Deploy (`preview-deploy.yml`)

Creates a preview environment on Render for every pull request. Comments the
preview URL on the PR.

**Required secrets:** `RENDER_API_KEY`, `RENDER_SERVICE_ID`

Render must also have `previewsEnabled: true` in `render.yaml` (already
configured in this template).

**Optional Supabase secrets** (for ephemeral PR databases):

| Secret | Where to Find |
|--------|--------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase Dashboard > Account > Access Tokens |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard > Project Settings > General (Reference ID). Use the project where the GitHub integration is installed (creates branch DBs on PR) -- typically production, NOT staging. |

When Supabase is configured, the workflow:

1. Waits for the Supabase GitHub integration to create a branch database
2. Fetches branch credentials (`api_url`, `anon_key`, `service_role_key`)
3. Applies migrations via `supabase db push`
4. Injects `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY` into the
   Render preview service
5. Triggers a redeploy so the preview picks up the new credentials

All Supabase steps are gated on `SUPABASE_ACCESS_TOKEN` — if not configured,
the workflow skips them gracefully and deploys normally.

### Preview Cleanup (`preview-cleanup.yml`)

Cleans up preview environments when PRs are closed or merged.

**Required secrets:** Same as Deploy.

When `SUPABASE_ACCESS_TOKEN` is configured, also deletes the Supabase branch
database using `supabase branches delete`. Continues on error if the branch
doesn't exist (e.g., the GitHub integration already cleaned it up).

### Rollback Production (`rollback-production.yml`)

Emergency rollback triggered manually via GitHub Actions UI.

**To trigger:**

1. Go to **Actions > Rollback Production > Run workflow**
2. Optionally provide a specific deploy ID (defaults to previous deploy)
3. Provide the reason for rollback (required)

**Requires the same secrets as Deploy.**

## Troubleshooting

### Common CI Failures

| Failure | Cause | Fix |
|---------|-------|-----|
| `lint` fails | Markdown formatting issues | Run `markdownlint --fix **/*.md` |
| `node` lint fails | ESLint violations | Run `npm run lint` locally, then `npx eslint . --fix` |
| `node` typecheck fails | TypeScript errors | Run `npm run typecheck` and fix reported errors |
| `node` test fails | Vitest failures | Run `npm test` locally |
| `node` build fails | Next.js build error | Run `npm run build` locally and check output |
| `python` lint fails | Ruff violations | Run `uv run ruff check . --fix` |
| `python` tests fail | Test failures or coverage below threshold | Fix tests or lower `COVERAGE_THRESHOLD` |
| `lint-agent-policies` fails | Agent file missing safety phrases | Check `scripts/verify-agent-restrictions.sh` output |
| `build` fails | Shell script errors | Run `shellcheck <script>` locally |
| `auto-fix` skips your stack | No fixer detected | Ensure `package.json` (Node.js) or `pyproject.toml` (Python) exists in the repo root |

### Secret-Gated Workflows Show "Skipped"

This is expected behavior. The workflow checked for secrets, found none
configured, and skipped gracefully. Add the required secrets when you are
ready to enable the workflow.

### Preview URL Not Available

If the preview deploy workflow runs but the URL is not ready:

1. Check the Render dashboard for the preview service status
2. Preview services follow the naming pattern `{service-name}-pr-{number}`
3. First deploys take longer as Render provisions the service

### Coverage Threshold Failures

The default coverage threshold is 80%. To adjust:

1. Set `COVERAGE_THRESHOLD` as a repository variable (not secret)
2. Go to **Settings > Secrets and variables > Actions > Variables**
3. Add `COVERAGE_THRESHOLD` with your desired percentage
