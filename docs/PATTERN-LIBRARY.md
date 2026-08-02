# Pattern Library: Render + Supabase + GitHub Stack

> Canonical reference for agents and workshop participants. Each pattern documents
> the **correct** way to solve a known problem, the **gotcha** that causes it, and
> **sample code** that works.

---

## Table of Contents

1. [Supabase Auth: Magic Link Redirect Flow](#1-supabase-auth-magic-link-redirect-flow)
2. [Supabase: JWT Ref Routing (The #1 Preview Env Gotcha)](#2-supabase-jwt-ref-routing)
3. [Supabase: Fetching Branch Database Credentials](#3-supabase-fetching-branch-database-credentials)
4. [Supabase: Auth Redirect URLs for Preview Environments](#4-supabase-auth-redirect-urls-for-preview-environments)
5. [Supabase: Migration Filename Collisions](#5-supabase-migration-filename-collisions)
6. [Supabase: PostgREST Schema Cache After DDL Changes](#6-supabase-postgrest-schema-cache-after-ddl-changes)
7. [Render: Preview Environment Variable Injection](#7-render-preview-environment-variable-injection)
8. [Render: Environment Variables Require Redeploy](#8-render-environment-variables-require-redeploy)
9. [Render: Next.js Standalone Mode Breaks Static Files](#9-render-nextjs-standalone-mode-breaks-static-files)
10. [Render: Reverse Proxy Headers for Redirects](#10-render-reverse-proxy-headers-for-redirects)
11. [Render: Free Tier Spin-Down and Cold Starts](#11-render-free-tier-spin-down-and-cold-starts)
12. [Tailwind CSS: CDN vs Build-Time Compilation](#12-tailwind-css-cdn-vs-build-time-compilation)
13. [GitHub Actions: hashFiles() Scope Limitation](#13-github-actions-hashfiles-scope-limitation)
14. [GitHub Actions: Graceful Secret Gating](#14-github-actions-graceful-secret-gating)
15. [GitHub Actions: CI Checks Not Attaching to PR](#15-github-actions-ci-checks-not-attaching-to-pr)
16. [GitHub Actions: Reusable Workflow Missing workflow_call](#16-github-actions-reusable-workflow-missing-workflow_call)
17. [GitHub Projects: Labels vs Board Columns](#17-github-projects-labels-vs-board-columns) — RETIRED (historical)
18. [GitHub Projects: CLI Truncation at 30 Items](#18-github-projects-cli-truncation-at-30-items) — RETIRED (historical)
19. [GitHub: Account Switching for Multi-Agent Workflows](#19-github-account-switching-for-multi-agent-workflows)
20. [GitHub MCP Server vs gh CLI for Agent Workflows](#20-github-mcp-server-vs-gh-cli-for-agent-workflows)
21. [Python: Async Functions That Block the Event Loop](#21-python-async-functions-that-block-the-event-loop)
22. [Python: HTML Form Empty Values vs Defaults](#22-python-html-form-empty-values-vs-defaults)
23. [Server-Side URLs: Never Hardcode Origins](#23-server-side-urls-never-hardcode-origins)
24. [Magic Link Auth: Complete Implementation (Next.js)](#24-magic-link-auth-complete-implementation-nextjs)
25. [Neon Auth: Magic Link Implementation (FastAPI)](#25-neon-auth-magic-link-implementation-fastapi)
26. [Neon Auth: Trusted Domains for Preview Environments](#26-neon-auth-trusted-domains-for-preview-environments)
27. [Neon Auth: Migration from Custom Magic Links](#27-neon-auth-migration-from-custom-magic-links)
28. [GitHub Actions: Workflow Pushes With GITHUB_TOKEN Don't Re-Trigger CI](#28-github-actions-workflow-pushes-with-github_token-dont-re-trigger-ci)

---

## 1. Supabase Auth: Magic Link Redirect Flow

**Gotcha:** Supabase magic links redirect users back to your app using the
`site_url` configured in your Supabase project. In preview environments, this
defaults to your production URL, so the user authenticates successfully but
lands on production instead of the preview.

**Pattern:**

```yaml
# In preview-deploy.yml — configure Supabase auth for the preview URL
- name: Configure auth redirect URLs
  run: |
    # site_url = base URL only (NO path suffix)
    curl -X PATCH \
      "https://api.supabase.com/v1/projects/${BRANCH_REF}/config/auth" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "site_url": "'"${PREVIEW_BASE_URL}"'",
        "uri_allow_list": [
          "'"${PREVIEW_BASE_URL}"'/api/auth/callback",
          "'"${PREVIEW_BASE_URL}"'/auth/callback"
        ]
      }'
```

**Common mistake:** Setting `site_url` to `${PREVIEW_BASE_URL}/api/auth/callback`.
The `site_url` is the **base URL only**. Callback paths go in `uri_allow_list`.

**Framework-specific paths:**
- Next.js: `/api/auth/callback`
- FastAPI/Python: `/auth/callback`

When copying workflows between projects, audit all URL paths for framework differences.

---

## 2. Supabase: JWT Ref Routing

**Gotcha:** Supabase API keys are JWTs containing a `ref` claim that determines
which project receives the request — **regardless of the URL you set**. Changing
`SUPABASE_URL` to a branch URL while keeping production keys routes requests to
production silently.

```
SUPABASE_URL=https://branch-xyz.supabase.co     # Branch URL
SUPABASE_KEY=eyJh...ref:"prod-project-ref"...   # Production ref in JWT!
# Result: requests go to PRODUCTION despite branch URL
```

**Pattern:** You must update **all three** environment variables for preview:

```bash
# All three must come from the branch, not production
SUPABASE_URL="https://${BRANCH_REF}.supabase.co"
SUPABASE_KEY="${BRANCH_ANON_KEY}"          # Branch-specific anon key
SUPABASE_SERVICE_KEY="${BRANCH_SERVICE_KEY}" # Branch-specific service_role key
```

**Why this matters:** The `0xbigboss/supabase-branch-gh-action` only returns
`anon_key`. The `service_role_key` must be fetched separately (see Pattern 3).

---

## 3. Supabase: Fetching Branch Database Credentials

**Gotcha:** The standard Supabase branch GitHub Action only provides the branch
URL and `anon_key`. Server-side operations (admin API, service role access)
require the `service_role_key`, which must be fetched from the Management API.

**Pattern:**

```yaml
# preview-deploy.yml
- name: Get Supabase branch credentials
  id: supabase-branch
  uses: 0xbigboss/supabase-branch-gh-action@v1
  with:
    supabase-access-token: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    supabase-project-ref: ${{ secrets.SUPABASE_PROJECT_REF }}
    wait-for-migrations: true

- name: Fetch service_role key from Management API
  id: service-key
  run: |
    BRANCH_REF="${{ steps.supabase-branch.outputs.branch_project_ref }}"

    SERVICE_ROLE_KEY=$(curl -s \
      "https://api.supabase.com/v1/projects/${BRANCH_REF}/api-keys" \
      -H "Authorization: Bearer ${{ secrets.SUPABASE_ACCESS_TOKEN }}" \
      | jq -r '.[] | select(.name == "service_role") | .api_key')

    echo "service_role_key=${SERVICE_ROLE_KEY}" >> "$GITHUB_OUTPUT"
```

**Also note:** The `supabase branches get` CLI command returns the **parent
project's URL**, not the branch URL. Always use the Management API for
branch-specific data.

---

## 4. Supabase: Auth Redirect URLs for Preview Environments

**Gotcha:** Each Supabase branch database inherits the parent project's auth
config, including `site_url` and allowed redirect URLs. Preview environments
need their own redirect URLs configured or auth callbacks will fail.

**Pattern:**

```yaml
- name: Configure preview auth redirects
  run: |
    BRANCH_REF="${{ steps.supabase-branch.outputs.branch_project_ref }}"
    PREVIEW_URL="https://${SERVICE_NAME}-pr-${{ github.event.pull_request.number }}.onrender.com"

    curl -X PATCH \
      "https://api.supabase.com/v1/projects/${BRANCH_REF}/config/auth" \
      -H "Authorization: Bearer ${{ secrets.SUPABASE_ACCESS_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d '{
        "site_url": "'"${PREVIEW_URL}"'",
        "uri_allow_list": [
          "'"${PREVIEW_URL}"'/api/auth/callback",
          "'"${PREVIEW_URL}"'/auth/callback"
        ]
      }'
```

---

## 5. Supabase: Migration Filename Collisions

**Gotcha:** Concurrent PRs can create migration files with the same version
prefix (e.g., two `007_` files). This causes `duplicate key value violates
unique constraint "schema_migrations_pkey"` when Supabase applies migrations.

**Pattern:** Use timestamps instead of sequential numbers:

```bash
# Instead of: 007_add_leads.sql
# Use: 20260322143000_add_leads.sql
supabase migration new add_leads
# Generates: supabase/migrations/20260322143000_add_leads.sql
```

The `supabase migration new` command generates timestamp-based filenames by
default. Never manually create migration files with numeric prefixes.

---

## 6. Supabase: PostgREST Schema Cache After DDL Changes

**Gotcha:** When applying DDL changes outside of `supabase db push` (e.g., via
Management API or direct SQL), PostgREST may continue serving the old schema.

**Pattern:**

```sql
-- Run against the branch database after DDL changes
NOTIFY pgrst, 'reload schema';
```

Standard `supabase db push` handles this automatically. You only need this when
applying migrations through other means.

---

## 7. Render: Preview Environment Variable Injection

**Gotcha:** Render preview services follow the naming convention
`{service-name}-pr-{number}`. The workflow must discover the preview service ID
via Render's API before injecting environment variables.

**Pattern:**

```yaml
- name: Find Render preview service
  id: find-service
  run: |
    SERVICE_NAME="myapp"
    PR_NUMBER="${{ github.event.pull_request.number }}"

    # Poll for up to 10 minutes (Render may take time to create preview)
    for i in $(seq 1 60); do
      SERVICES=$(curl -s \
        "https://api.render.com/v1/services?name=${SERVICE_NAME}-pr-${PR_NUMBER}" \
        -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}")

      SERVICE_ID=$(echo "$SERVICES" | jq -r '.[0].service.id // empty')

      if [ -n "$SERVICE_ID" ]; then
        echo "service_id=${SERVICE_ID}" >> "$GITHUB_OUTPUT"
        break
      fi
      sleep 10
    done

- name: Inject Supabase credentials into Render preview
  run: |
    SERVICE_ID="${{ steps.find-service.outputs.service_id }}"

    for VAR_NAME in SUPABASE_URL SUPABASE_KEY SUPABASE_SERVICE_KEY; do
      curl -s -X PUT \
        "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${VAR_NAME}" \
        -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}" \
        -H "Content-Type: application/json" \
        -d '{"value": "'"${!VAR_NAME}"'"}'
    done

    # CRITICAL: Trigger redeploy — variables don't apply until redeployed
    curl -s -X POST \
      "https://api.render.com/v1/services/${SERVICE_ID}/deploys" \
      -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}"
```

---

## 8. Render: Environment Variables Require Redeploy

**Gotcha:** Updating environment variables via Render's API reports success,
but **running containers continue using old values**. A redeploy is required.

**Pattern:** Always trigger a redeploy after updating environment variables:

```bash
# Step 1: Update the variable
curl -X PUT "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/MY_VAR" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -d '{"value": "new-value"}'

# Step 2: REQUIRED — trigger redeploy
curl -X POST "https://api.render.com/v1/services/${SERVICE_ID}/deploys" \
  -H "Authorization: Bearer ${RENDER_API_KEY}"
```

**Without step 2:** The API returns 200 OK but the running service never sees
the new value.

---

## 9. Render: Next.js Standalone Mode Breaks Static Files

**Gotcha:** Using `output: "standalone"` in `next.config.ts` requires manually
copying `.next/static` and `public/` into `.next/standalone/`. This copy step
is fragile on Render and causes all CSS/JS/fonts to 404.

**Pattern:** Don't use standalone mode on Render. Use `next start` directly:

```yaml
# render.yaml
services:
  - type: web
    name: myapp
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start   # runs 'next start' — handles static files natively
    envVars:
      - key: NODE_VERSION
        value: "22"
```

```json
// package.json
{
  "scripts": {
    "start": "next start"
  }
}
```

```typescript
// next.config.ts — NO standalone output
const nextConfig: NextConfig = {
  // Do NOT add: output: "standalone"
};
```

---

## 10. Render: Reverse Proxy Headers for Redirects

**Gotcha:** Render runs a reverse proxy in front of your app. Server-side code
that constructs redirect URLs from `request.url` gets the **internal** origin
(e.g., `https://localhost:10000`) instead of the public URL.

**Pattern (Next.js):**

```typescript
// middleware.ts or API route
function getExternalOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

// Use for redirects
const origin = getExternalOrigin(request);
return NextResponse.redirect(new URL("/dashboard", origin));
```

**Pattern (Python/FastAPI):**

```python
def get_external_origin(request: Request) -> str:
    host = request.headers.get("x-forwarded-host", request.headers.get("host"))
    proto = request.headers.get("x-forwarded-proto", "https")
    return f"{proto}://{host}"
```

**Rule:** Never use `request.url` or `new URL(path, request.url)` for
constructing redirect URLs on Render. Always read the forwarded headers.

---

## 11. Render: Free Tier Spin-Down and Cold Starts

**Gotcha:** Free-tier Render services spin down after 15 minutes of inactivity.
The first request after spin-down takes 30-60 seconds. This is **normal behavior**,
not a bug.

**Pattern:**
- For workshops/demos: warn participants about cold start delays
- For production: upgrade to Starter plan ($7/mo) to keep the service running
- For health checks in CI: set timeout to 300 seconds, not the default 30

```yaml
# render.yaml
services:
  - type: web
    healthCheckPath: /api/health
    # Free tier may need longer timeout for first health check
```

---

## 12. Tailwind CSS: CDN vs Build-Time Compilation

**Gotcha:** The Tailwind CDN Play script (`<script src="https://cdn.tailwindcss.com">`)
works for prototyping but is **not suitable for production**:
- Rate-limited and blocked by corporate firewalls
- No tree-shaking (loads entire framework)
- Runtime CSS generation performance penalty

**Pattern:** Use build-time compilation:

```bash
# Install
npm install -D tailwindcss @tailwindcss/postcss postcss

# For Tailwind v4 (current)
# postcss.config.mjs
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

```css
/* app/globals.css — Tailwind v4 syntax */
@import "tailwindcss";

@theme {
  --color-primary: #your-color;
  --radius-lg: 0.5rem;
}
```

```css
/* For Tailwind v3 (legacy) */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**For Python/Jinja projects** without a Node build pipeline, add a Tailwind CLI
build step to your Dockerfile:

```dockerfile
# Download Tailwind standalone CLI
RUN curl -sL https://github.com/tailwindlabs/tailwindcss/releases/latest/download/tailwindcss-linux-x64 \
    -o /usr/local/bin/tailwindcss && chmod +x /usr/local/bin/tailwindcss
RUN tailwindcss -i ./src/static/input.css -o ./src/static/styles.css --minify
```

---

## 13. GitHub Actions: hashFiles() Scope Limitation

**Gotcha:** `hashFiles()` used in a **job-level** `if` condition runs before
`actions/checkout`, when the workspace is empty. It always returns an empty
string, silently skipping the job.

**Wrong:**

```yaml
jobs:
  lint:
    if: hashFiles('pyproject.toml') != ''  # ALWAYS empty — runs before checkout
    steps:
      - uses: actions/checkout@v4
```

**Correct:**

```yaml
jobs:
  lint:
    steps:
      - uses: actions/checkout@v4
      - name: Check if Python project
        id: check
        run: |
          if [ -f "pyproject.toml" ]; then
            echo "is_python=true" >> "$GITHUB_OUTPUT"
          fi
      - name: Run linter
        if: steps.check.outputs.is_python == 'true'
        run: ruff check .
```

---

## 14. GitHub Actions: Graceful Secret Gating

**Gotcha:** Workflows that require optional secrets (Supabase, Render) fail
noisily when those secrets aren't configured, causing red CI for participants
who haven't completed setup yet.

**Pattern:** Gate optional steps on secret existence:

```yaml
jobs:
  deploy-preview:
    # Skip entire job if Render isn't configured
    if: ${{ secrets.RENDER_API_KEY != '' }}
    steps: ...

  setup-supabase:
    steps:
      - name: Create Supabase branch
        # Skip step if Supabase isn't configured
        if: ${{ secrets.SUPABASE_ACCESS_TOKEN != '' }}
        run: ...
```

This lets the template work for participants at different stages of setup
without false CI failures.

---

## 15. GitHub Actions: CI Checks Not Attaching to PR

**Gotcha:** CI checks may run and pass but not attach to the PR as required
status checks. `gh pr checks` shows no checks. This is a GitHub race condition.

**Pattern:** Push an empty commit to retrigger CI:

```bash
git commit --allow-empty -m "chore: retrigger CI checks"
git push
```

Checks attach properly on the second run. This is the standard workaround.

---

## 16. GitHub Actions: Reusable Workflow Missing workflow_call

**Gotcha:** If `ci.yml` is called as a reusable workflow from
`preview-deploy.yml` using `uses: ./.github/workflows/ci.yml`, but `ci.yml`
doesn't have `workflow_call:` in its `on:` block, GitHub silently fails with
"This run likely failed because of a workflow file issue" and 0 jobs run.

**Pattern:** Always include `workflow_call` when a workflow might be reused:

```yaml
# .github/workflows/ci.yml
on:
  push:
    branches: [main]
  pull_request:
  workflow_call:   # REQUIRED for reusable workflow support
```

---

## 17. GitHub Projects: Labels vs Board Columns

> **RETIRED (historical)** — the GitHub Project board is retired for beads
> (`bd`); the label/column confusion no longer applies because bead state
> and labels are the only mechanism. Kept as evidence of why the board
> needed ~420 lines of hygiene protocol.

**Gotcha:** GitHub has two completely separate systems — **labels** (metadata
tags on issues) and **columns** (workflow state on project boards). Using
`gh issue edit --add-label Ready` does NOT move an item to the "Ready" column.

**Wrong (historical):**

```bash
# This adds a label, does NOT move on the board
gh issue edit 79 --add-label Ready
```

The historical "correct" fix was a two-step GraphQL dance (`gh api graphql`
to find the item id, then an `updateProjectV2ItemFieldValue` mutation to move
the column). **The bd equivalent** needs neither labels-vs-columns awareness
nor GraphQL — state is state, and Ready is computed, not a column anyone
moves items into:

```bash
# In Progress is a claim, not a column move
bd update va-79a --claim

# In Review is a label pair, applied when the PR opens
bd update va-79a --add-label in-review --add-label pr:108

# Ready is never written at all - bd ready computes open+unblocked
# (--limit 0: bd ready silently caps at 100 by default - docs/BEADS.md gotcha 10)
bd ready --json --limit 0
```

**Prevention:** none needed — the failure mode no longer exists.

---

## 18. GitHub Projects: CLI Truncation at 30 Items

> **RETIRED (historical)** — board retired for beads; this gotcha is part
> of why. Kept as evidence.

**Gotcha:** `gh project item-list` silently returns only the first 30 items
with **no truncation warning**. Boards with more items appear complete but
aren't.

**Pattern:** Always use the GraphQL API for project board queries:

```bash
gh api graphql --paginate -f query='
  query($cursor: String) {
    organization(login: "myorg") {
      projectV2(number: 13) {
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            content {
              ... on Issue { number title }
            }
          }
        }
      }
    }
  }'
```

---

## 19. GitHub: Account Switching for Multi-Agent Workflows

**Gotcha:** When using separate GitHub accounts for worker (code/PRs) and
reviewer (reviews), the wrong account can author PRs or post self-reviews.

**Pattern:** Check and switch before operations:

```bash
# Pre-flight check
CURRENT=$(gh auth status 2>&1 | grep "Logged in" | awk '{print $NF}')
if [ "$CURRENT" != "va-worker" ]; then
  gh auth switch --user va-worker
fi

# Now safe to push and create PR
git push -u origin feature/va-42a-add-auth
gh pr create --title "feat(auth): add magic link flow"
```

**Automation:** Use a pre-tool hook (`.claude/hooks/ensure-github-account.sh`)
to auto-switch based on the operation being performed.

---

## 20. GitHub MCP Server vs gh CLI for Agent Workflows

**Gotcha:** The GitHub MCP server reads `GITHUB_PERSONAL_ACCESS_TOKEN` at
startup and ignores `gh auth switch`. This makes it use the wrong account for
multi-account workflows, causing self-reviews and wrong PR authorship.

**Pattern:** Use `gh` CLI instead of GitHub MCP for all operations in
multi-account setups:

```bash
# gh CLI respects account switching
gh auth switch --user va-reviewer
gh pr review 42 --approve --body "LGTM"
```

(Work-item state changes go through the local `bd` CLI, which needs no
GitHub auth at all — the account question only arises for `gh` operations.)

Remove the GitHub MCP server from `.mcp.json` if using multi-account workflows.

---

## 21. Python: Async Functions That Block the Event Loop

**Gotcha:** Marking a function `async def` doesn't make its contents
non-blocking. Synchronous I/O calls (like `anthropic.messages.create()`)
inside async functions block the entire event loop, causing SSE streams to
batch up instead of streaming progressively.

**Wrong:**

```python
async def run_pipeline(self, ctx):
    await bridge.put_event(conv_id, start_event)
    response = self.client.messages.create(...)  # BLOCKS event loop
    await bridge.put_event(conv_id, end_event)   # Delayed until above completes
```

**Correct:**

```python
from anthropic import AsyncAnthropic

async def run_pipeline(self, ctx):
    await bridge.put_event(conv_id, start_event)
    response = await self.async_client.messages.create(...)  # Non-blocking
    await bridge.put_event(conv_id, end_event)
```

**Quick workaround** (if you can't switch to async client immediately):

```python
await bridge.put_event(conv_id, event)
await asyncio.sleep(0)  # Yield control to event loop before blocking call
response = self.client.messages.create(...)
```

---

## 22. Python: HTML Form Empty Values vs Defaults

**Gotcha:** `dict.get(key, "default")` returns `""` (empty string, which is
truthy-ish for `get()`) when an HTML form sends the key with an empty value.
The default is only used when the key is **missing**, not when it's empty.

**Wrong:**

```python
trial_slot = form_data.get("trial_slot", "default_slot")
# Returns "" if form sent empty value, NOT "default_slot"
```

**Correct:**

```python
trial_slot = form_data.get("trial_slot") or "default_slot"
# Handles both missing key AND empty string
```

---

## 23. Server-Side URLs: Never Hardcode Origins

**Gotcha:** Hardcoded URLs break in preview environments where the origin
differs from production. Using `request.url` on Render returns the internal
origin (e.g., `localhost:10000`), not the public URL.

**Rule:** Use `window.location.origin` (client-side) or request headers
(server-side). Never hardcode application URLs.

```typescript
// Client-side
const callbackUrl = `${window.location.origin}/api/auth/callback`;

// Server-side (see Pattern 10 for full implementation)
const origin = getExternalOrigin(request);
```

---

## 24. Magic Link Auth: Complete Implementation (Next.js)

This is not a gotcha pattern — it's a **complete implementation recipe** for
magic link authentication with Supabase in Next.js App Router. Every workshop
participant needs auth, and the architecture has exactly one correct shape.

### Why this recipe exists

Magic link auth requires **two callback handlers** — a server-side API route
and a client-side page. Most Supabase docs only show the server-side route.
Without the client-side page, magic links redirect correctly but the user
ends up back on the login page with no error. This is because Supabase puts
tokens in the URL **hash fragment** (`#access_token=...`), which never reaches
the server.

### Architecture

```
User enters email on /login
  → Supabase sends magic link email
  → emailRedirectTo: window.location.origin + "/auth/callback"

User clicks magic link
  → Browser navigates to /auth/callback#access_token=...&refresh_token=...
  → Client-side page detects hash fragment
  → Supabase JS client exchanges token via onAuthStateChange
  → Redirects to / (dashboard)

Every subsequent request
  → Middleware refreshes session via supabase.auth.getUser()
  → Unauthenticated users redirected to /login
  → Auth routes (/login, /auth/callback, etc.) skip redirect check
```

### Required files

```
lib/supabase/client.ts          # Browser client (createBrowserClient)
lib/supabase/server.ts          # Server client with cookie handling
lib/supabase/middleware.ts       # Session refresh + route protection
middleware.ts                    # Next.js middleware entry point
app/api/auth/callback/route.ts   # Server-side: handles code/token_hash params
app/(auth)/auth/callback/page.tsx # Client-side: handles hash fragment tokens
app/(auth)/login/page.tsx         # Login form (email input → OTP)
app/(auth)/check-email/page.tsx   # Confirmation page after sending link
app/(auth)/layout.tsx             # Auth layout (no app shell)
```

### Dependencies

```bash
npm install @supabase/ssr @supabase/supabase-js
```

### Environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

These are the only variables needed for auth. No `SUPABASE_SERVICE_ROLE_KEY`
required on the client side. The preview-deploy workflow handles injecting
branch-specific values automatically.

### File 1: Browser client — `lib/supabase/client.ts`

```typescript
import { createBrowserClient as createClient } from "@supabase/ssr";

export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

### File 2: Server client — `lib/supabase/server.ts`

```typescript
import { createServerClient as createClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerClient() {
  const cookieStore = await cookies();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignored in Server Components where cookies cannot be set
          }
        },
      },
    }
  );
}
```

### File 3: Middleware logic — `lib/supabase/middleware.ts`

Critical details:
- Must allowlist auth routes or you get infinite redirects
- Gracefully skip if Supabase env vars aren't set (local dev without secrets)
- Redirect authenticated users away from auth pages

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_ROUTES = ["/login", "/signup", "/check-email", "/auth/callback"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Skip if Supabase not configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isAuthRoute = AUTH_ROUTES.some((route) => path.startsWith(route));

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

### File 4: Middleware entry point — `middleware.ts`

```typescript
import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/error-events).*)",
  ],
};
```

### File 5: Server-side callback — `app/api/auth/callback/route.ts`

Handles `code` (PKCE/OAuth) and `token_hash` (OTP) query parameters.
Uses reverse proxy headers for correct redirect origin (see Pattern #10).

```typescript
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Render reverse proxy: detect actual public origin
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${host}`;

  const supabase = await createServerClient();

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (token_hash && type) {
    await supabase.auth.verifyOtp({ token_hash, type: type as "magiclink" });
  }

  return NextResponse.redirect(origin);
}
```

### File 6: Client-side callback — `app/(auth)/auth/callback/page.tsx`

**This is the critical file most implementations miss.** Magic links put
tokens in the URL hash fragment (`#access_token=...`). Hash fragments never
reach the server, so this client-side page must handle the token exchange.

```typescript
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();

    // Supabase JS client automatically detects hash fragment tokens
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        router.push("/");
        router.refresh();
      }
    });

    // Surface errors from the hash
    const hash = window.location.hash.substring(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const error = params.get("error_description");
      if (error) {
        router.push(`/login?error=${encodeURIComponent(error)}`);
      }
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <div className="mx-auto w-12 h-12 mb-4 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <h1 className="text-xl font-semibold">Signing you in...</h1>
        <p className="text-muted-foreground mt-2">
          Please wait while we verify your identity.
        </p>
      </div>
    </div>
  );
}
```

### File 7: Login page — `app/(auth)/login/page.tsx`

Key detail: `emailRedirectTo` must use `window.location.origin` so it works
in both production and preview environments (see Pattern #23).

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // CRITICAL: use origin so this works in preview environments
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Log in</h1>
        <p className="text-muted-foreground">
          Enter your email and we will send you a magic link.
        </p>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="border rounded px-3 py-2"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={loading}
          className="bg-primary text-primary-foreground rounded px-4 py-2">
          {loading ? "Sending link..." : "Send magic link"}
        </button>
      </form>
    </div>
  );
}
```

### File 8: Check email page — `app/(auth)/check-email/page.tsx`

Note: `useSearchParams()` requires `<Suspense>` in App Router or static
prerendering fails.

```typescript
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="text-muted-foreground mt-2">
          We sent a confirmation link to{" "}
          {email ? <span className="font-medium text-foreground">{email}</span> : "your email"}.
        </p>
        <p className="text-sm text-muted-foreground mt-4">
          Click the link in your email to sign in.
        </p>
        <Link href="/login" className="text-sm text-primary hover:underline mt-4 block">
          Back to login
        </Link>
      </div>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense>
      <CheckEmailContent />
    </Suspense>
  );
}
```

### Cross-references

- **Pattern #1** — Auth `site_url` must be base URL only when configuring preview environments
- **Pattern #4** — Preview auth redirect URLs must include the callback path in `uri_allow_list`
- **Pattern #10** — Server-side callback must use `X-Forwarded-Host`/`X-Forwarded-Proto`
- **Pattern #23** — `emailRedirectTo` must use `window.location.origin`, never hardcoded

### Common mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Missing client-side callback page | Magic link redirects to `/auth/callback`, user lands back on login | Add `app/(auth)/auth/callback/page.tsx` |
| Using `request.url` in server callback | Redirect goes to `localhost:10000` in Render | Read `x-forwarded-host` and `x-forwarded-proto` headers |
| Hardcoded `emailRedirectTo` URL | Auth works in prod, fails in preview | Use `window.location.origin` |
| Missing `<Suspense>` around `useSearchParams()` | Build fails with prerendering error | Wrap component in `<Suspense>` |
| Auth routes not in middleware allowlist | Infinite redirect loop on `/login` | Add all auth paths to `AUTH_ROUTES` array |
| Supabase env vars missing in local dev | Middleware crashes on startup | Add graceful skip when vars not set |

---

## 25. Neon Auth: Magic Link Implementation (FastAPI)

**Gotcha:** When migrating from a custom magic-link system (e.g., Resend + your
own token table) to Neon Auth, developers often try to preserve their existing
`/login` and `/auth/verify` routes. Neon Auth handles the entire magic-link flow
internally — your app only needs to: (1) redirect users to Neon's auth URL, and
(2) handle the callback with the session token Neon provides.

> **Endpoint paths shown below are illustrative.** Neon Auth is built on Stack
> Auth, and the exact endpoint shape may differ in your project (e.g.
> `/handler/authorize` rather than `/authorize`). Verify the current paths
> against the [Neon Auth documentation](https://neon.tech/docs/neon-auth) for
> your project version before copy-pasting.

**Pattern:**

Neon Auth manages magic links, email delivery, and token verification. Your app
delegates to Neon and consumes the result.

### Step 1: Environment Variables

```bash
# .env
NEON_AUTH_URL=https://auth.neon.tech          # Neon Auth endpoint
NEON_PROJECT_ID=your-project-id               # From Neon Console
NEON_AUTH_CLIENT_ID=your-client-id            # From Neon Console → Auth
NEON_AUTH_CLIENT_SECRET=your-client-secret    # From Neon Console → Auth
APP_BASE_URL=https://your-app.com             # Your app's base URL
SESSION_SECRET=your-session-signing-secret    # For signing session cookies
```

### Step 2: Auth Routes (FastAPI)

```python
# app/api/auth.py
"""Neon Auth integration.

Neon handles magic-link generation, email sending, and token verification.
We redirect to Neon for sign-in and handle the callback to create our session.
"""

import secrets
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session
from app.models.user import User
from app.services.session import SESSION_COOKIE_NAME, sign_session

router = APIRouter()
SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/login")
def login(settings: SettingsDep) -> RedirectResponse:
    """Redirect to Neon Auth for magic-link sign-in."""

    # One-time state for CSRF protection on the /auth/callback round-trip
    state = secrets.token_urlsafe(32)

    callback_url = f"{settings.app_base_url}/auth/callback"

    params = {
        "client_id": settings.neon_auth_client_id,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": "openid email",
        "state": state,
    }

    auth_url = f"{settings.neon_auth_url}/authorize?{urlencode(params)}"
    response = RedirectResponse(url=auth_url)
    # Persist the state in a short-lived, HttpOnly cookie so /auth/callback can
    # verify it. samesite="lax" allows the cookie to survive the OAuth redirect.
    response.set_cookie(
        key="auth_state",
        value=state,
        max_age=600,  # 10 minutes — the auth flow should complete quickly
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return response


@router.get("/auth/callback")
async def auth_callback(
    request: Request,
    code: str,
    state: str,
    settings: SettingsDep,
    db: Session = Depends(get_session),
) -> RedirectResponse:
    """Handle Neon Auth callback, exchange code for tokens, create session."""

    # Verify state matches what we set at /login (CSRF protection).
    # secrets.compare_digest is constant-time to defeat timing side-channels.
    expected_state = request.cookies.get("auth_state")
    if not expected_state or not secrets.compare_digest(state, expected_state):
        raise HTTPException(status_code=400, detail="Invalid state — possible CSRF")

    # Exchange authorization code for tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            f"{settings.neon_auth_url}/oauth/token",
            data={
                "grant_type": "authorization_code",
                "client_id": settings.neon_auth_client_id,
                "client_secret": settings.neon_auth_client_secret,
                "code": code,
                "redirect_uri": f"{settings.app_base_url}/auth/callback",
            },
        )
    
    if token_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Authentication failed")
    
    tokens = token_response.json()
    
    # Get user info from Neon
    async with httpx.AsyncClient() as client:
        userinfo_response = await client.get(
            f"{settings.neon_auth_url}/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
    
    if userinfo_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to get user info")
    
    userinfo = userinfo_response.json()
    email = userinfo["email"]
    
    # Find or create user in your database
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, created_at=datetime.now(UTC))
        db.add(user)
        db.commit()
        db.refresh(user)
    
    # Create session cookie
    cookie_value = sign_session(user_id=user.id, secret=settings.session_secret)
    
    response = RedirectResponse(url="/dashboard", status_code=303)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=cookie_value,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    # Clear the one-time auth_state cookie — the CSRF round-trip is complete
    response.delete_cookie(key="auth_state")
    return response


@router.get("/logout")
def logout() -> RedirectResponse:
    """Clear session cookie and redirect to home."""
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie(key=SESSION_COOKIE_NAME)
    return response
```

### Key Differences from Custom Magic Links

| Custom (Resend) | Neon Auth |
|-----------------|-----------|
| You generate tokens | Neon generates tokens |
| You store token hashes | Neon stores tokens |
| You send emails via Resend API | Neon sends emails |
| You verify tokens on `/auth/verify` | You exchange auth code on callback |
| You need `magic_link_token` table | No token table needed |
| You manage TTL and single-use logic | Neon handles it |

### Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Keeping old `/login` POST route | Form submits fail | Change to GET redirect to Neon |
| Not removing token table migration | Dead code, confusion | Drop table after migration complete |
| Missing `state` parameter | CSRF vulnerability | Always generate and verify state |
| Hardcoded callback URL | Works in prod, fails in preview | Use env var `APP_BASE_URL` |

---

## 26. Neon Auth: Trusted Domains for Preview Environments

**Gotcha:** Neon Auth validates redirect URIs against a whitelist of "trusted
domains" configured in the Neon Console. Preview environments (e.g., Cloud Run
`https://myapp-abc123-us-central1.run.app`) need their URLs added or auth
callbacks will fail with "untrusted redirect" errors.

**Pattern:**

Neon Auth supports **wildcard trusted domains** (shipped May 2026). Use them
to cover all preview URLs with a single entry.

### Step 1: Identify Your Preview URL Pattern

```bash
# Cloud Run pattern (example):
https://myapp-pr-{sha}-us-central1.run.app

# Render pattern (example):
https://myapp-pr-{number}.onrender.com

# Vercel pattern (example):
https://myapp-git-{branch}-{team}.vercel.app
```

### Step 2: Add Wildcard in Neon Console

Navigate to: **Neon Console → Project → Auth → Trusted Domains**

```
# For Cloud Run:
https://myapp-pr-*.us-central1.run.app

# For Render:
https://myapp-pr-*.onrender.com

# For Vercel:
https://myapp-git-*.vercel.app
```

**Critical:** Use the most specific wildcard possible. `https://*.run.app` is
too broad — it would trust ANY Cloud Run service.

### Step 3: Verify in Preview Deploy Workflow

```yaml
# .github/workflows/preview-deploy.yml
- name: Verify Neon Auth accepts preview URL
  run: |
    # The wildcard should already cover this URL
    echo "Preview URL: ${{ env.PREVIEW_URL }}"
    echo "Ensure Neon Console has wildcard: https://myapp-pr-*.us-central1.run.app"
```

### If Wildcards Don't Work (Fallback)

If your URL pattern doesn't match Neon's wildcard syntax, add entries per PR:

```yaml
- name: Add preview URL to Neon trusted domains
  run: |
    curl -X POST \
      "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/auth/trusted_domains" \
      -H "Authorization: Bearer $NEON_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"domain": "'$PREVIEW_URL'"}'
```

And clean up on PR close:

```yaml
# preview-cleanup.yml
- name: Remove preview URL from Neon trusted domains
  run: |
    # Fetch domain ID first, then DELETE
```

---

## 27. Neon Auth: Migration from Custom Magic Links

**Gotcha:** Migrating from a custom magic-link implementation (token table +
email service like Resend) to Neon Auth requires a careful, phased rollout.
Going straight to "delete the old code" risks breaking auth for active users
with unexpired magic-link tokens in flight.

**Pattern:**

Use a feature flag to run both auth paths in parallel during migration.

### Phase 1: Add Neon Auth Alongside Existing

```python
# app/config.py
class Settings:
    auth_provider: str = "resend"  # "resend" | "neon" | "both"
```

```python
# app/api/auth.py
@router.get("/login")
def login(settings: SettingsDep):
    if settings.auth_provider in ("neon", "both"):
        return neon_login_redirect(settings)
    else:
        return show_email_form()  # Old Resend flow


@router.post("/login")
def login_post(email: str, settings: SettingsDep):
    """Old Resend-based flow — only active when auth_provider != 'neon'."""
    if settings.auth_provider == "neon":
        raise HTTPException(status_code=410, detail="Use GET /login")
    # ... existing Resend magic-link logic
```

### Phase 2: Parallel Testing

```yaml
# For 1-2 weeks, run both:
AUTH_PROVIDER=both

# New users get Neon Auth (GET /login redirects to Neon)
# Old tokens still work (POST /login and /auth/verify still active)
```

### Phase 3: Full Cutover

```yaml
AUTH_PROVIDER=neon
```

### Phase 4: Cleanup (After 2 Weeks Clean)

Only after `AUTH_PROVIDER=neon` has been stable in production for 2+ weeks:

1. **Remove Resend code path** — delete `POST /login`, old `/auth/verify`
2. **Drop `magic_link_token` table** — Alembic migration
3. **Remove `RESEND_API_KEY` secret** — from CI/CD and hosting platform
4. **Remove `resend` dependency** — from `pyproject.toml`
5. **Remove `AUTH_PROVIDER` flag** — simplify config

### Migration Checklist

- [ ] Neon Auth enabled in Neon Console
- [ ] Trusted domains configured (including wildcards for previews)
- [ ] `AUTH_PROVIDER=both` deployed to staging
- [ ] Manual test: new sign-in flow works via Neon
- [ ] Manual test: old magic-link tokens still verify
- [ ] `AUTH_PROVIDER=both` deployed to production
- [ ] Monitor for 1 week — check error rates, support tickets
- [ ] `AUTH_PROVIDER=neon` deployed to production
- [ ] Monitor for 2 weeks — no fallback to old flow
- [ ] Cleanup PRs: remove Resend code, drop table, remove secrets
- [ ] Remove feature flag

---

## 28. GitHub Actions: Workflow Pushes With GITHUB_TOKEN Don't Re-Trigger CI

**Gotcha:** A workflow that runs an auto-fixer (ruff, eslint, prettier, etc.)
and pushes the result back to the PR branch using the default `GITHUB_TOKEN`
will **never re-trigger CI** on that push. GitHub deliberately suppresses
workflow runs for events created by `GITHUB_TOKEN` to prevent infinite loops.

The PR sits at `mergeStateStatus=BLOCKED` because required checks were never
re-run against the auto-fix commit — even though the lint failure that
motivated the fix is now resolved. A human has to push a no-op commit (or
close/reopen the PR) to wake CI up.

**Symptom:**

- PR opened, lint fails
- Auto-fix workflow runs, commits "style: auto-fix lint issues", pushes
- No new CI run appears for that commit
- PR status: BLOCKED, "Required check `lint` has not run"
- Human pushes `git commit --allow-empty -m "chore: retrigger CI"` → CI runs → green

**Root cause:** From GitHub Actions docs:

> When you use the repository's `GITHUB_TOKEN` to perform tasks, events
> triggered by the `GITHUB_TOKEN` will not create a new workflow run.

This is intentional, infinite-loop prevention — without it, an auto-fix
workflow could push, retrigger itself, push again, forever.

**Resolution: prefer lint-as-CI-check over lint-as-auto-fix.**

Make lint a **failing** CI check in `ci.yml` (fail-loud, fail-fast) and rely
on local pre-push hooks (`scripts/hooks/`) for the auto-fix UX. The
contributor sees the failure locally before pushing — no CI round-trip
required, no token-signing dance.

```yaml
# ci.yml — the correct pattern
jobs:
  python:
    steps:
      - name: Lint with ruff
        run: uv run --extra dev ruff check .   # FAILS the job if violations
```

**Escape hatch (if you genuinely need an auto-fix workflow):** Use a PAT
(personal access token) belonging to a bot account instead of `GITHUB_TOKEN`.
Commits signed by a PAT do re-trigger workflows. The trade-off is secret
provisioning (PAT storage, rotation, scope minimization) and the risk of
infinite loops, which you must explicitly prevent (e.g., `if:
github.actor != 'your-bot'` on the auto-fix job).

For most repos, the simpler answer is: don't auto-fix in CI. Lint locally.

**References:**

- [GitHub Actions: events from GITHUB_TOKEN don't trigger workflows](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow)
- cubrox session journal `2026-05-25` §9.3 (downstream fork that surfaced this in production)
- Agile Flow issue [#327](https://github.com/vibeacademy/agile-flow/issues/327) — deletion of `auto-fix.yml` from this template

---

## Quick Reference: The Preview Environment Checklist

When setting up ephemeral PR environments with Render + Supabase, verify:

- [ ] `workflow_call` trigger exists in `ci.yml`
- [ ] Supabase branch action fetches **both** `anon_key` and `service_role_key`
- [ ] Auth `site_url` is set to preview base URL (no path suffix)
- [ ] Auth `uri_allow_list` includes framework-specific callback path
- [ ] Render env vars are updated AND a redeploy is triggered
- [ ] Server-side redirects use `X-Forwarded-Host`/`X-Forwarded-Proto`
- [ ] Health check timeout is 300s (not default 30s)
- [ ] All optional secrets use `if: ${{ secrets.TOKEN != '' }}` gating
- [ ] Migration filenames use timestamps, not sequential numbers
- [ ] Next.js does NOT use `output: "standalone"`
- [ ] Auth has both server-side API route AND client-side callback page
- [ ] `emailRedirectTo` uses `window.location.origin` (not hardcoded)
- [ ] Middleware allowlists auth routes (`/login`, `/auth/callback`, etc.)
