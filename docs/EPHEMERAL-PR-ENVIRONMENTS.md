# Ephemeral PR Environments

Every pull request gets its own isolated preview — a standalone Render
web service connected to a dedicated Supabase branch database. When the
PR closes, both are torn down automatically.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Pull Request Opened                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│   Supabase GitHub        │      │   Render Native Previews     │
│   Integration            │      │   (previews: automatic)      │
│                          │      │                              │
│   Creates branch DB      │      │   Creates preview service    │
│   automatically via      │      │   automatically from         │
│   webhook                │      │   render.yaml blueprint      │
└────────────┬─────────────┘      └──────────────┬───────────────┘
             │                                    │
             └────────────────┬───────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  preview-deploy.yml (GitHub Actions)                │
│                                                                     │
│  0. Detect config (which secrets are set; unconfigured = skip)      │
│  1. CI checks pass                                                  │
│  2. Wait for Supabase branch DB (up to 10 min)*                     │
│  3. Fetch branch credentials (URL, anon_key, service_role_key)*     │
│  4. Apply migrations (supabase db push)*                            │
│  5. Configure auth redirect URLs for preview*                       │
│  6. Find Render preview service via API                             │
│  7. Inject Supabase credentials into Render env vars*               │
│  8. Trigger Render redeploy*                                        │
│  9. Health check (/api/health)                                      │
│ 10. Post status comment on PR                                       │
│                                                                     │
│  * Supabase steps — skipped when Supabase secrets are not set.      │
│    Steps 6–10 are skipped entirely (neutral, NOT green success)     │
│    when Render secrets are not set.                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PREVIEW LIVE                                   │
│                                                                     │
│   https://app-pr-{number}.onrender.com                              │
│          │                                                          │
│          └──── connected to ────► Supabase branch database          │
│                                   (isolated Postgres instance)      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                        PR merged/closed
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                preview-cleanup.yml (GitHub Actions)                 │
│                                                                     │
│   • Deletes Supabase branch DB                                      │
│   • Render tears down preview service automatically                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What Creates What

| Resource | Created By | Destroyed By |
|----------|-----------|--------------|
| Render preview service | Render (native, via the top-level `previews:` block with `generation: automatic` in `render.yaml`) | Render (automatic on PR close) |
| Supabase branch database | Supabase GitHub integration (webhook) | `preview-cleanup.yml` via `supabase branches delete` |
| Env var wiring between them | `preview-deploy.yml` (GitHub Actions) | N/A (destroyed with service) |

---

## Required Secrets

Configure these in **Repository Settings > Secrets and variables > Actions**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     GitHub Repository Secrets                       │
├─────────────────────────────┬───────────────────────────────────────┤
│  RENDER_API_KEY             │  Render Dashboard > Account Settings  │
│                             │  > API Keys                           │
├─────────────────────────────┼───────────────────────────────────────┤
│  RENDER_SERVICE_ID          │  Render Dashboard > Service >         │
│                             │  Settings (srv-xxxxx in URL)          │
├─────────────────────────────┼───────────────────────────────────────┤
│  SUPABASE_ACCESS_TOKEN      │  Supabase Dashboard > Account >       │ 
│                             │  Access Tokens                        │
├─────────────────────────────┼───────────────────────────────────────┤
│  SUPABASE_PROJECT_REF       │  Supabase Dashboard > Project         │
│                             │  Settings > General (Reference ID).   │
│                             │  Use the project where the GitHub     │
│                             │  integration is installed (the one    │
│                             │  that creates branch databases on     │
│                             │  PR). Typically production, NOT       │
│                             │  staging.                             │
├─────────────────────────────┼───────────────────────────────────────┤
│  SUPABASE_DB_URL (optional) │  Supabase Dashboard > Project         │
│                             │  Settings > Database > Connection     │
│                             │  string (production migrations only)  │
└─────────────────────────────┴───────────────────────────────────────┘
```

### Which secrets are used where

```
preview-deploy.yml ──── RENDER_API_KEY
                   ──── RENDER_SERVICE_ID
                   ──── SUPABASE_ACCESS_TOKEN
                   ──── SUPABASE_PROJECT_REF

preview-cleanup.yml ─── SUPABASE_ACCESS_TOKEN
                    ─── SUPABASE_PROJECT_REF

deploy.yml (prod) ───── RENDER_API_KEY
                  ───── RENDER_SERVICE_ID
                  ───── SUPABASE_DB_URL
```

---

## Detailed Flow: PR Opened

### Step 1 — Native platforms create resources

Two things happen in parallel, triggered by the PR branch push:

**Render** reads `render.yaml`, sees the top-level `previews:` block
(`generation: automatic`), and spins up a preview service named
`{base-service}-pr-{number}`.

**Supabase** GitHub integration (configured in Supabase Dashboard >
Settings > Integrations > GitHub) detects the new branch and creates an
isolated Postgres database with its own API endpoint, `anon_key`, and
`service_role_key`.

### Step 2 — GitHub Actions orchestrates the wiring

`preview-deploy.yml` runs on `pull_request: [opened, synchronize, reopened]`:

0. **Config detection** — a cheap `Detect Deploy Config` job reads which
   secrets are set and publishes `render_configured` /
   `supabase_configured` job outputs (secrets cannot be referenced in
   job-level `if:` expressions, so downstream jobs gate on these outputs
   instead). When Render secrets are missing, the entire
   `Deploy to Render Preview` job is **skipped (neutral)** — it no longer
   reports green success having deployed nothing. When Supabase secrets
   are missing, the `Wait for Supabase Branch` job and every
   Supabase-specific step are skipped. Skipped jobs satisfy required
   status checks (GitHub's May 2022 status-check semantics — see the
   note in `_detect-changes.yml`), so pinning these check names in a
   ruleset stays safe.

1. **CI checks** — lint, type-check, tests must pass first.

2. **Wait for Supabase branch** — uses `0xbigboss/supabase-branch-gh-action@v1`
   which polls the Supabase Management API until the branch DB is ready
   (up to 10 minutes).

3. **Fetch credentials** — extracts `api_url` and `anon_key` from the
   action output. Calls the Supabase Management API directly to fetch
   `service_role_key` (the action only returns `anon_key`).

4. **Apply migrations** — runs `supabase link --project-ref $BRANCH_REF`
   then `supabase db push` to apply all `supabase/migrations/*.sql`
   files to the branch database.

5. **Configure auth** — updates the branch's auth redirect URLs to allow
   `https://app-pr-{number}.onrender.com/**` via the Management API.

6. **Find Render preview** — queries the Render API, searching for a
   service whose name matches `pr-{number}`. Polls up to 60 times
   (10-second intervals).

7. **Inject env vars** — PUTs the Supabase branch credentials into the
   Render preview service:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

8. **Redeploy** — triggers a Render redeploy so the preview picks up
   the new credentials.

9. **Health check** — GETs `/api/health` on the preview URL, retrying
   up to 15 times.

10. **PR comment** — posts (or updates) a status table on the PR with
    links and pass/fail for each step.

### Step 3 — Preview is live

The preview app at `https://app-pr-{number}.onrender.com` is fully
functional with its own database. Data changes are isolated from
production and other PRs.

---

## Detailed Flow: PR Closed

`preview-cleanup.yml` runs on `pull_request: [closed]`:

1. **Delete Supabase branch** — runs
   `supabase --experimental branches delete "$BRANCH_NAME" --yes`.
   Continues on error (the branch may already be gone).

2. **Render cleanup** — Render automatically tears down the preview
   service. No API call needed.

---

## Detailed Flow: PR Merged (Production)

`deploy.yml` runs on `push` to `main`:

1. Deploys to the production Render service.
2. If `supabase/migrations/` exists and `SUPABASE_DB_URL` is configured,
   runs `npx supabase db push --db-url "$SUPABASE_DB_URL"` to apply
   migrations to production.

---

## Graceful Degradation

The system works even with partial configuration. The `Detect Deploy
Config` job detects which secrets are present, and unconfigured paths
show as **skipped** (neutral) in the PR checks — never as green success:

| Missing Secret | Behavior |
|---------------|----------|
| `SUPABASE_ACCESS_TOKEN` | `Wait for Supabase Branch` job + all Supabase steps skipped; preview deploys without database wiring (DB-less forks) |
| `SUPABASE_PROJECT_REF` | Same as above |
| `RENDER_API_KEY` | `Deploy to Render Preview` job skipped (reports neutral, not success) |
| `RENDER_SERVICE_ID` | Same as above |
| `SUPABASE_DB_URL` | Production migrations skipped; preview flow unaffected |

---

## Troubleshooting

### PostgREST schema cache not refreshed

If you apply DDL changes to a branch database outside of `supabase db push`
(e.g., via the Management API or a direct SQL connection), PostgREST may
continue serving the old schema. Reload the cache by running this SQL
against the branch database:

```sql
NOTIFY pgrst, 'reload schema';
```

The standard `supabase db push` migration flow handles this automatically.

### Wrong `SUPABASE_PROJECT_REF`

If your preview environment silently falls back to production data instead
of using an isolated branch database, check that `SUPABASE_PROJECT_REF`
points to the project where the Supabase GitHub integration is installed.
Users with multiple Supabase projects (staging + production) commonly set
this to the wrong one. See the [Required Secrets](#required-secrets) table
above.

---

## Key Technical Detail: JWT Routing

Supabase routes API requests based on the `ref` claim in the JWT, not
the URL. This is why the workflow must fetch both `anon_key` and
`service_role_key` from the Supabase Management API for the specific
branch — using production keys against a branch URL would still route
to the production database.
