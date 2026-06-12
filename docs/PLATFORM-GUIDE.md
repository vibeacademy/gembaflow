# Platform Guide

Gemba Flow supports multiple deployment platforms. Your choice is stored
in `.claude/PROJECT.md` and read by the `devops-engineer` and
`system-architect` agents.

## Supported Platforms

| Platform | Best For | Free Tier | Preview Envs |
|----------|----------|-----------|-------------|
| Render | Full-stack web apps, APIs | Yes | Yes (built-in) |
| Cloudflare | Edge computing, static sites | Yes | Yes (Workers) |
| Vercel | Frontend apps, Next.js | Yes | Yes (automatic) |
| Railway | Containers, databases | Trial | Yes |
| Fly.io | Global edge containers | Yes | Manual |

## Default: Render

This template ships configured for Render:

- `render.yaml` defines the service with preview environments enabled
- `deploy.yml` deploys to Render on merge to main
- `preview-deploy.yml` manages Render preview environments
- `rollback-production.yml` rolls back via Render API

## Choosing Your Platform

Run `/bootstrap-architecture` to select your platform. The choice is
written to `.claude/PROJECT.md`:

```markdown
## Platform
- **Hosting**: render
- **Selected**: 2026-02-17
```

## Switching Platforms

To switch platforms after initial setup:

1. Update `.claude/PROJECT.md` with the new platform
2. Replace the platform-specific workflow files:
   - `deploy.yml` -- production deployment
   - `preview-deploy.yml` -- PR preview environments
   - `preview-cleanup.yml` -- cleanup on PR close
3. Update `render.yaml` / `vercel.json` / `fly.toml` as needed
4. Update repository secrets in GitHub Settings

## Platform-Specific Setup

### Render

Render is the default deployment platform for this template. This section
walks through the full setup from zero to production.

#### Step 1: Push Your Code First

Render needs code in your repository to build. Make sure you have at least
one commit on `main` before creating the service:

```bash
git add -A
git commit -m "Initialize project"
git push -u origin main
```

#### Step 2: Create a Web Service

For first-time users, **manual setup** is simpler than the Blueprint
(Infrastructure as Code) approach.

1. Go to <https://dashboard.render.com> and sign in.
2. Click **New > Web Service**.
3. Connect your GitHub repository.
4. Configure:
   - **Name**: your-project-name
   - **Region**: closest to your users
   - **Branch**: `main`
   - **Build Command**: see `render.yaml` (e.g., `npm install && npm run build`)
   - **Start Command**: see `render.yaml` (e.g., `npm start`)
   - **Instance Type**: Free (for getting started)
5. Click **Create Web Service**.

#### Step 3: Environment Variables

Add environment variables in Render Dashboard > your service > Environment:

| Variable | When to Add | Where to Get It |
|----------|-------------|-----------------|
| `SENTRY_DSN` | After creating a Sentry project | Sentry > Project Settings > Client Keys |
| `DATABASE_URL` | After linking a database | Render provides this automatically (see below) |
| `NODE_ENV` | At creation | Set to `production` |

**DATABASE_URL**: When you create a PostgreSQL database on Render and link
it to your service, Render automatically injects `DATABASE_URL` as an
environment variable. You do NOT need to copy/paste it manually.

To create a database:
1. Render Dashboard > **New > PostgreSQL**
2. Choose a name and plan (Free tier available)
3. Go to your Web Service > **Environment > Add Environment Group**
4. Link the database — `DATABASE_URL` is injected automatically

#### Step 4: GitHub Secrets for CI/CD

The GitHub Actions workflows need two secrets to deploy and manage preview
environments:

| Secret | Where to Find |
|--------|--------------|
| `RENDER_API_KEY` | Render Dashboard > Account Settings > API Keys |
| `RENDER_SERVICE_ID` | Render Dashboard > Your Service > Settings (in the URL: `https://dashboard.render.com/web/srv-xxxxx`, the `srv-xxxxx` part) |

Add these in GitHub: Repository > Settings > Secrets and variables >
Actions > New repository secret.

#### Blueprint vs Manual Setup

| | Blueprint (`render.yaml`) | Manual Setup |
|---|---|---|
| **How** | Render reads `render.yaml` from your repo | Configure via Render Dashboard UI |
| **Best for** | Teams, reproducible infra | First-time setup, learning |
| **Preview envs** | Automatic via `render.yaml` | Must configure manually |
| **Database** | Declared in YAML | Created separately in Dashboard |

The template ships a `render.yaml` file. Once you are comfortable, you can
switch to Blueprint mode: Render Dashboard > Blueprints > New Blueprint
Instance > connect your repo.

#### Common Gotchas

1. **First deploy fails**: Render cannot build if there is no code on the
   branch. Push at least one commit to `main` before creating the service.
2. **Free tier spin-down**: Free-tier services spin down after 15 minutes
   of inactivity. The first request after spin-down takes 30-60 seconds.
   This is normal.
3. **Preview environments**: Preview deploys are triggered by the
   `preview-deploy.yml` GitHub Action when a PR is opened. They require
   `RENDER_API_KEY` to be set in GitHub Secrets.
4. **Build cache**: If a build fails after changing stacks (e.g., Python
   to Node.js), clear the build cache: Service > Settings > Clear Build
   Cache, then trigger a manual deploy.

**Configuration file:** `render.yaml`

### Cloudflare

**Required secrets:**

| Secret | Where to Find |
|--------|--------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard > Profile > API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard > Overview (sidebar) |

**Configuration file:** `wrangler.toml`

### Vercel

**Required secrets:**

| Secret | Where to Find |
|--------|--------------|
| `VERCEL_TOKEN` | Vercel Dashboard > Settings > Tokens |
| `VERCEL_ORG_ID` | Vercel Dashboard > Settings > General |
| `VERCEL_PROJECT_ID` | Vercel Dashboard > Project > Settings |

**Configuration file:** `vercel.json`

### Railway

**Required secrets:**

| Secret | Where to Find |
|--------|--------------|
| `RAILWAY_TOKEN` | Railway Dashboard > Account > Tokens |

**Configuration file:** `railway.toml`

### Fly.io

**Required secrets:**

| Secret | Where to Find |
|--------|--------------|
| `FLY_API_TOKEN` | `fly tokens create deploy` |

**Configuration file:** `fly.toml`

## Database: Supabase (Recommended)

Supabase is the recommended database for Gemba Flow projects. Its native
**branching** feature creates an isolated Postgres instance for each PR —
migrations auto-applied, data fully isolated between PRs. Render's managed
Postgres cannot do this (all preview environments share the same database).

### Why Supabase

- **Ephemeral PR databases** — each PR gets its own Postgres via Supabase
  branching, with no shared state between previews
- **Automatic migrations** — `supabase/migrations/*.sql` files are applied
  to branch databases during preview deploy
- **Credential injection** — `preview-deploy.yml` fetches branch-specific
  `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SERVICE_KEY` and injects
  them into the Render preview service
- **Branch cleanup** — `preview-cleanup.yml` deletes the Supabase branch
  when the PR is closed

### Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com)
2. **Enable the GitHub integration** in Supabase Dashboard > Settings >
   Integrations > GitHub to enable automatic branch creation on PRs
3. **Add GitHub secrets** to your repository:

| Secret | Where to Find |
|--------|--------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase Dashboard > Account > Access Tokens |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard > Project Settings > General (the `Reference ID`). Use the project where the GitHub integration is installed (creates branch DBs on PR) -- typically production, NOT staging. |

1. **For production deploys**, also add:

| Secret | Where to Find |
|--------|--------------|
| `SUPABASE_DB_URL` | Supabase Dashboard > Project Settings > Database > Connection string |

### How the PR Lifecycle Works

```
PR opened
  -> Supabase GitHub integration creates a branch database
  -> preview-deploy.yml waits for the branch, fetches credentials
  -> Credentials (URL, anon_key, service_role_key) injected into Render preview
  -> Migrations applied via `supabase db push`
  -> Render preview redeployed with branch database credentials

PR closed
  -> preview-cleanup.yml deletes the Supabase branch
  -> Render cleans up the preview service automatically
```

### Environment Variables

Your application should read these environment variables for Supabase:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (branch URL in previews) |
| `SUPABASE_KEY` | Supabase anon key (public, safe for client-side) |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key (server-side only) |

### Important: JWT Ref Routing

Supabase routes requests based on the JWT `ref` claim, not the URL. The
GitHub Action (`0xbigboss/supabase-branch-gh-action`) only returns the
`anon_key`. The `preview-deploy.yml` workflow fetches both `anon_key` and
`service_role_key` from the Supabase Management API to ensure correct
routing to the branch database.

## Error Monitoring

The app ships with zero-config error telemetry — errors are captured and
turned into GitHub issues automatically. For a full monitoring dashboard,
you can connect an external service.

### Default: Self-Receiver (Zero Config)

No setup required. The app's built-in `/api/error-events` endpoint receives
errors from the Sentry SDK and creates GitHub issues labeled `bug:auto`.
See `docs/SENTRY-SETUP.md` for details.

### Optional: GlitchTip (Self-Hosted)

[GlitchTip](https://glitchtip.com) is an open-source, Sentry-compatible
error tracker. It uses the same Sentry SDK — just change the DSN.

**Why GlitchTip over Sentry SaaS:**

| Factor | GlitchTip | Sentry SaaS |
|--------|-----------|-------------|
| Cost | Render resources (~$14-25/mo) | Free tier, then scales |
| Privacy | 100% self-hosted | Third-party data processing |
| Maintenance | You manage updates | Zero maintenance |
| Features | Error tracking, basic APM, uptime | Full observability platform |

**Render deployment (3 services):**

| Service | Type | Purpose |
|---------|------|---------|
| glitchtip-web | Docker | Django backend + Angular frontend |
| glitchtip-worker | Docker | Celery worker for event processing |
| glitchtip-db | PostgreSQL | Error data and user accounts |

For deployment instructions, see the
[GlitchTip self-hosted guide](https://glitchtip.com/documentation/install).

**Connecting your app:**

```bash
# Set SENTRY_DSN to your GlitchTip instance
# This overrides the default self-receiver
SENTRY_DSN=https://key@your-glitchtip.onrender.com/1
```

Add `SENTRY_DSN` to your Render environment variables. The app will send
errors to GlitchTip instead of the built-in receiver.

### Optional: Sentry SaaS

[Sentry](https://sentry.io) is the original error tracking platform. The
free tier includes 5,000 errors per month.

**Setup:** See `docs/SENTRY-SETUP.md` for configuration steps.

**Required secrets:**

| Secret | Where to Find |
|--------|---------------|
| `SENTRY_DSN` | Sentry Dashboard > Project > Settings > Client Keys |

## Adding a New Platform

1. Create deployment workflow in `.github/workflows/`
2. Add platform detection to `.claude/agents/devops-engineer.md`
3. Add setup instructions to this guide
4. Document required secrets in `docs/CI-CD-GUIDE.md`

## Bootstrap-time templated values

Some shipped skill specs reference fork-specific values through placeholders
that the framework substitutes once during bootstrap. The framework ships one
spec; every fork bends it to its own org / board / bot accounts without
forking the file. The mechanism is consumed by `/work-ticket` (and `/drain`,
once T3 lands).

### The four placeholders

| Placeholder | Meaning |
|---|---|
| `{{org}}` | GitHub org login that hosts the framework + this fork |
| `{{board.id}}` | Project board number on the GitHub Project the team uses |
| `{{bot.worker}}` | GitHub login of the worker bot (opens PRs, makes commits) |
| `{{bot.reviewer}}` | GitHub login of the reviewer bot (posts `/review-pr` verdicts) |

### How substitution happens

1. **Config file.** `.gembaflow-config.json` (per-fork; gitignored) holds the
   four values. `.gembaflow-config.example.json` is the committed template
   that shows the schema.
2. **Substitution script.** `scripts/substitute-config-placeholders.sh` reads
   the config and runs in-place sed substitution across `.claude/commands/*.md`.
   Idempotent: re-running after a clean substitution is a no-op.
3. **When it runs.** `/bootstrap-workflow` step 7 runs the script once during
   the initial setup. After `/upgrade` ships a new spec file containing fresh
   placeholders, the operator re-runs the script to apply the existing
   `.gembaflow-config.json` values to the new file.

### CI smoke check

Forks that customize `.claude/commands/` can wire a CI job that runs:

```bash
bash scripts/substitute-config-placeholders.sh --check
```

The `--check` flag dry-runs the substitution and exits non-zero if any
unsubstituted placeholders remain. This catches the failure mode where a
spec file ships fresh placeholders that the fork forgot to substitute after
upgrade.

### Drain-specific customization

The `/drain` skill consumes the four placeholders plus several env vars (`RENDER_*`, `SENTRY_*`, `PUBLIC_BASE_URL`, optional `SLACK_WEBHOOK_URL`) and requires installing the `drain-merge-bridge.yml` workflow per-fork. The full customization contract — every value an operator must supply, where to find it, and what scope is required — lives in [`docs/drain-customization.md`](drain-customization.md). Pair with [`docs/drain-known-limitations.md`](drain-known-limitations.md) for what v1 deliberately does NOT do, and [`docs/drain-institutional-knowledge.md`](drain-institutional-knowledge.md) for the patterns and lessons accumulated during empirical development. The architectural decisions are recorded in [`docs/adr/0001-drain-skill-wraps-claude-code-goal-primitive.md`](adr/0001-drain-skill-wraps-claude-code-goal-primitive.md) and [`docs/adr/0002-drain-autonomous-merge-via-bridge-workflow.md`](adr/0002-drain-autonomous-merge-via-bridge-workflow.md).

### Why placeholders, not env vars

Env vars work for runtime substitution but don't help here — the skill specs
are read AS instructions by the agent, not executed as shell. Substituted
files are the natural artifact: the agent reads concrete account names and
project IDs, not template strings it would have to expand.

The cost is one bootstrap step + one `/upgrade` re-run when new placeholders
ship. The benefit is the framework's source-of-truth specs stay generic, and
forks don't carry merge conflicts on these files every release cycle.
