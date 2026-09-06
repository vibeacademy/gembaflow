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
| `json-validate` | JSON file validity (`scripts/validation/validate-json.sh`) |
| `version-parity` | `.gembaflow-version`/`package.json` version parity (split from the former `typecheck` umbrella in #361, then split again in #428 so each job's name matches its purpose — does not run `tsc`) |
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

#### Docs-only PR gate

Every CI job except `lint` and the gate itself is gated behind a reusable
workflow at `.github/workflows/_detect-changes.yml` that computes a single
`should-run-ci` boolean via `dorny/paths-filter@v3`. PRs touching only
documentation (README, CHANGELOG, `docs/**`, etc.) skip the full CI fleet,
saving ~6 of 7+ jobs plus the ~5-minute Render preview compute.

**Positive allowlist — anything matching triggers CI:**

- `app/**`, `components/**`, `lib/**`, `worker/**`, `types/**`,
  `__tests__/**` (code)
- `scripts/**` (framework scripts)
- `.claude/{agents,commands,skills,hooks}/**` (validated config — see
  carve-out below)
- `.gembaflow-meta/**`, `.gembaflow-overrides`, `.gembaflow-version`,
  `.gembaflow-config.example.json` (framework state files affecting
  downstream-fork sync)
- `.github/workflows/**`, `.github/actions/**` (self-referential — a
  workflow change must run CI against itself)
- `package.json`, `package-lock.json`, `pyproject.toml`, `uv.lock`,
  `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`,
  `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`,
  `.markdownlint.json` (validation toolchain configs)

Anything NOT matching the allowlist is treated as docs-only.

**Two carve-outs — these run UNGATED:**

- **`lint` (markdown lint).** Runs on every PR including docs-only.
  Docs-only PRs are exactly the class that benefits most from markdown
  lint (broken tables, MD004/MD038/MD049 traps); the action takes ~5s.
- **`detect / detect-changes` (the gate itself).** Always runs so its
  output is available to gated jobs downstream. Always passes.

**`.claude/{agents,commands,skills,hooks}/**` is validated config, NOT
docs.** Despite living in a directory that looks docs-shaped, these
files are consumed by `lint-agent-policies`, `test`, and
`template-cleanliness` jobs which run validators against them. Edits
here trigger the full CI fleet. Without this carve-out, a malformed
agent (e.g. #488's YAML frontmatter bug) could merge green via the
docs-only path.

**Skipped-as-passing semantics.** Per GitHub's May 2022 status-check
update, jobs that don't run because their `if:` evaluated to false are
treated as PASSING for required-status-check purposes. Branch
protection rules still resolve green on docs-only PRs.

**Job names preserved.** No existing check name was renamed by the
gating change. Branch-protection rules pinning specific check names
(`build`, `test`, `lint`, `node`, `python`, `version-parity`,
`json-validate`, etc.) are unaffected.

**For forks:** the allowlist is a single-file override surface
(`.github/workflows/_detect-changes.yml`). Forks that need to add or
remove path patterns edit that one file. New top-level directories
default to triggering CI — moving a path into the docs-only category
is an explicit, reviewable change.

### Release (`release.yml`)

Triggers when a `v*` tag is pushed. Extracts the matching section from
`CHANGELOG.md` and creates a GitHub Release.

### Auto Review (`auto-review.yml`)

Posts a review reminder comment on new PRs, prompting the team to run
`/review-pr` for an agent review.

### Auto-close test fixtures (`auto-close-test-fixtures.yml`)

Auto-closes downstream-report issues filed by `va-worker` whose titles start
with the bracketed prefix and a literal "Test " word — the QE-pollution pattern
that the bulk-close on 2026-05-20 manually cleaned up. The workflow gates on
the conjunction of three criteria (label `downstream-report` + author
`va-worker` + the test-fixture title prefix); any non-match is a no-op exit-0. Real downstream reports from
human authors or differently-titled issues are never touched. Companion to the
`--dry-run` and `--fixture-repo` flags from #316 — those let `/report-issue` be
run without filing anything, and this workflow catches any QE run that still
files against upstream.

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

A leading `Detect Deploy Config` job checks which secrets are set and
publishes `render_configured` / `supabase_configured` outputs (secrets
are not readable in job-level `if:` expressions, so downstream jobs gate
on these outputs). When the Render secrets are missing, the
`Deploy to Render Preview` job is **skipped** (neutral) instead of
reporting green success without having deployed anything. Skipped jobs
satisfy required status checks, so check names pinned in rulesets keep
resolving.

Render must also have the top-level `previews:` block with
`generation: automatic` in `render.yaml` (already configured in this
template).

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

All Supabase steps (including the `Wait for Supabase Branch` job) are
gated on `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` via the
`Detect Deploy Config` job — if not configured, they show as skipped and
the preview deploys without database wiring (DB-less forks carry none of
the Supabase machinery at runtime).

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
