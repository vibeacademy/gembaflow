---
description: "Phase 2: Define Technical Architecture based on PRD"
---

Launch the system-architect agent to define the technical architecture based on your Product Requirements Document.

## Bootstrap Phase 2: Technical Architecture

**Prerequisite**: Phase 1 (Product Definition) must be complete.

The System Architect will read your PRD and help you define:

1. **Technology Stack** - Languages, frameworks, tools
2. **System Design** - Components, services, boundaries
3. **Data Models** - Entities, relationships, storage
4. **API Contracts** - Interfaces, protocols, patterns
5. **Infrastructure** - Hosting, deployment, scaling
6. **Development Standards** - Coding conventions, testing requirements

## Process

### 0. Platform Selection

Before diving into architecture, ask the user about their deployment platform:

```
What platform will you deploy to?

1. Render (Recommended for this template)
2. Cloudflare (Workers/Pages)
3. Vercel
4. Railway
5. Fly.io
6. Other (please specify)

Enter a number (1-6):
```

Write the platform choice to `.claude/PROJECT.md`:

```markdown
## Platform
- **Hosting**: [selected platform]
- **Selected**: [date]
```

This file is read by the `devops-engineer` and `system-architect` agents
to provide platform-specific guidance.

### Stack Transition

The template ships with a **Next.js starter** (TypeScript, React 19,
Vitest, ESLint). If the user selects Next.js, no transition is needed —
skip this section entirely.

If the user selects a **different stack**, follow the instructions below.

#### Swap to FastAPI (Python)

The FastAPI starter is archived at `starters/fastapi/`. To swap:

1. **Remove Next.js files from root**: Delete `package.json`,
   `package-lock.json`, `next.config.ts`, `tsconfig.json`,
   `vitest.config.ts`, `vitest.setup.ts`, `eslint.config.mjs`,
   `app/` (the Next.js app directory), `__tests__/`, and
   `instrumentation.ts`.
2. **Copy FastAPI files to root**:
   ```bash
   cp -r starters/fastapi/app/ app/
   cp -r starters/fastapi/tests/ tests/
   cp starters/fastapi/pyproject.toml pyproject.toml
   cp starters/fastapi/uv.lock uv.lock
   cp starters/fastapi/render.yaml render.yaml
   ```
3. **Update `CLAUDE.md`**: Replace the build/test commands section with:
   ```bash
   uv run uvicorn app.main:app --reload  # Dev server
   uv run ruff check .                    # Lint
   uv run pytest                          # Tests
   ```
4. **Initialize UI component library** (if selected): When the
   architecture includes shadcn/ui, this does not apply to FastAPI
   backends — skip this step.

The CI `python` job activates automatically when `pyproject.toml` exists
at root, and the `node` job auto-skips when `package.json` is absent.
No CI workflow changes are needed.

#### Swap to another stack (Go, etc.)

For stacks without a pre-built starter:

1. **Remove Next.js files from root**: Delete `package.json`,
   `package-lock.json`, `next.config.ts`, `tsconfig.json`,
   `vitest.config.ts`, `vitest.setup.ts`, `eslint.config.mjs`,
   `app/`, `__tests__/`, and `instrumentation.ts`.
2. **Scaffold a minimal starter app**: Include at minimum:
   - A root `/` route serving a landing page
   - A `/health` endpoint returning `{"status": "ok"}`
   - A `/error` endpoint that raises a deliberate error (for Sentry testing)
   - The **error receiver** (see below)
   - One passing test
3. **Update `render.yaml`**: Replace the Node.js build/start commands with
   the appropriate runtime. Reference:
   - **Go**: `buildCommand: go build -o server .`,
     `startCommand: ./server`
4. **Update `CLAUDE.md`**: Replace the build/test commands section with
   commands for the new stack.
5. **Initialize UI component library** (if selected): When the
   architecture includes shadcn/ui, run `npx shadcn@latest init --yes`
   and install base components (`button`, `input`, `label`, `card`)
   during scaffolding. This prevents feature PRs from being cluttered
   with component library setup.

**Non-Interactive Scaffolding**: When running scaffolding tools, always use
non-interactive flags to avoid blocking the agent:

| Tool | Flag |
|------|------|
| `create-next-app` | `--yes` (or `--ts --tailwind --eslint --app --src-dir --no-import-alias`) |
| `npm init` | `--yes` or `-y` |
| `create-vite` | Pass all options via CLI flags |
| `go mod init` | Non-interactive by default |

### Error Receiver (Required for All Stacks)

The default Next.js starter includes the error receiver at
`app/api/error-events/route.ts` (with parsing logic in
`app/api/error-events/parse.ts`). When switching stacks, you MUST port
this functionality. The receiver has four responsibilities:

1. **Self-DSN construction** — On startup, if no `SENTRY_DSN` env var is
   set, construct a DSN pointing back at the app itself using
   `RENDER_EXTERNAL_URL` (or `APP_URL` as fallback). Format:
   `https://self@{host}/api/error-events/0`. Initialize the Sentry SDK
   with this DSN so unhandled exceptions are sent to the app's own
   endpoint.

2. **Envelope endpoint** — `POST /api/error-events` (and
   `/api/error-events/{project_id}`) accepts Sentry envelope format
   (newline-delimited JSON). Parse the envelope to extract exception
   type, message, stacktrace, environment, and timestamp. Always return
   HTTP 200 (prevents SDK retries).

3. **GitHub issue creation** — When an error is received, create a GitHub
   issue via `POST /repos/{owner}/{repo}/issues` with label `bug:auto`.
   Requires `GITHUB_TOKEN` and `GITHUB_REPOSITORY` env vars. Issue title:
   `bug: {ExceptionType}: {message}`. Body includes error details and
   stacktrace in a code block.

4. **Rate limiting** — At most one issue per unique error message per
   hour. Use in-memory tracking (no external dependency needed).

**Environment variables** (document in your app's README or config):

| Variable | Required | Purpose |
|----------|----------|---------|
| `SENTRY_DSN` | No | External Sentry DSN (bypasses self-receiver) |
| `RENDER_EXTERNAL_URL` | Auto | Provided by Render; used to build self-DSN |
| `APP_URL` | No | Fallback if not on Render |
| `GITHUB_TOKEN` | Yes | Creates GitHub issues from errors |
| `GITHUB_REPOSITORY` | Yes | Target repo, e.g. `org/repo` |

**Stack-specific Sentry SDKs:**

| Stack | Package | Init Example |
|-------|---------|-------------|
| Next.js | `@sentry/nextjs` | `Sentry.init({ dsn })` in `instrumentation.ts` |
| Express | `@sentry/node` | `Sentry.init({ dsn })` before app setup |
| Go | `sentry-go` | `sentry.Init(sentry.ClientOptions{Dsn: dsn})` |

Reference the Next.js implementation (`app/api/error-events/route.ts` and
`app/api/error-events/parse.ts`) or the archived Python implementation
(`starters/fastapi/app/error_receiver.py`) for exact behavior.

### 1. PRD Analysis
The architect first analyzes your Product Requirements:
- What features need to be built?
- What scale do we need to support?
- What are the technical constraints?
- What integrations are required?

### 2. Technology Selection
For each layer of the stack:
- Present 2-3 options with trade-offs
- Recommend based on requirements
- Document the decision rationale

### 3. System Design
Define the high-level architecture:
- Component boundaries
- Data flow
- Integration points
- Security boundaries

### 4. Standards Definition
Establish development standards:
- Coding conventions
- Testing requirements
- Documentation standards
- Review criteria

## Output

This phase creates:

### docs/TECHNICAL-ARCHITECTURE.md
```markdown
# Technical Architecture

## Overview
[High-level system description]

## Technology Stack

### Frontend
- Framework: [e.g., React 18+]
- Language: [e.g., TypeScript 5.x]
- Styling: [e.g., Tailwind CSS]
- Build: [e.g., Vite]
- Testing: [e.g., Vitest + Testing Library]

### Backend
- Runtime: [e.g., Node.js 20+]
- Framework: [e.g., Express/Fastify]
- Language: [e.g., TypeScript]
- Testing: [e.g., Jest]

### Database
- Primary: [e.g., Supabase (PostgreSQL) — supports branching for ephemeral PR databases]
- Cache: [e.g., Redis]
- Search: [e.g., Elasticsearch] (if needed)

### Infrastructure
- Hosting: [e.g., Render/Cloudflare/Vercel/Railway/Fly.io]
- CI/CD: [e.g., GitHub Actions]
- Monitoring: [e.g., DataDog]

## System Design

### Component Diagram
[ASCII or description of components]

### Data Flow
[How data moves through the system]

### API Design
[REST/GraphQL/gRPC patterns]

## Data Models

### Core Entities
[Entity definitions and relationships]

### Database Schema
[Key tables/collections]

## Development Standards

### Code Style
- [Linting rules]
- [Formatting rules]
- [Naming conventions]

### Testing Requirements
- Unit test coverage: [e.g., 80%]
- Integration tests: [requirements]
- E2E tests: [requirements]

### Documentation
- [What needs documentation]
- [Documentation format]

### Code Review
- [Review checklist]
- [Approval requirements]

## Security

### Authentication
[Auth approach]

### Authorization
[Permissions model]

### Data Protection
[Encryption, PII handling]

## Scalability

### Current Targets
[Expected load]

### Scaling Strategy
[How we'll scale]

## Architecture Decision Records

### ADR-001: [First Decision]
- Status: Accepted
- Context: [Why this decision]
- Decision: [What we decided]
- Consequences: [Impact]
```

## CLAUDE.md Updates

This phase also updates CLAUDE.md with project-specific configuration:
- Technology stack details
- Code standards
- Build and test commands
- Definition of Ready/Done refinements

## Finish Up

The following files were created:
- docs/TECHNICAL-ARCHITECTURE.md
- .claude/PROJECT.md (platform selection)

Would you like me to commit these to a feature branch? (Recommended to keep `main` clean)

If yes, I will:
1. Create branch `docs/bootstrap-architecture`
2. Commit with message `docs: add technical architecture and platform config`
3. Push and offer to create a PR

## What Gets Unlocked

After Phase 2 is complete:
- **Ticket Worker** knows the tech stack and coding standards
- **PR Reviewer** knows what to check for
- **Quality Engineer** knows testing requirements
- **All agents** can give project-specific guidance

## Architecture Patterns

The architect will recommend patterns based on your needs:

| Pattern | Best For |
|---------|----------|
| Monolith | Small team, early stage, simple domain |
| Modular Monolith | Growing team, need boundaries |
| Microservices | Large scale, independent deployment |
| Serverless | Event-driven, variable load |
| JAMstack | Content sites, static-first |

## Tips for Success

1. **Start simple** - You can always add complexity later
2. **Optimize for change** - Requirements will evolve
3. **Document decisions** - Future you will thank present you
4. **Consider the team** - Pick tech your team can maintain
5. **Plan for testing** - Testability is an architecture concern

## Running This Command

1. Ensure Phase 1 is complete (PRD exists)
2. Type `/bootstrap-architecture`
3. Answer the architect's questions about constraints and preferences
4. Review the proposed architecture
5. Iterate until satisfied

When complete, run `bash bootstrap.sh` to continue to Phase 3.

## React/Next.js Testing Guidance

When the chosen stack includes React (e.g., Next.js with Vitest and React
Testing Library), the Vitest setup file MUST include cleanup after each
test to prevent DOM leaks:

```typescript
// vitest.setup.ts
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

Register this file in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

## ESLint Configuration for Template Projects

When scaffolding a Node.js project in a repo that previously had Python
files, the `.venv/` directory may still exist. ESLint must be configured
to ignore it:

```javascript
// eslint.config.mjs
export default [
  {
    ignores: ['.venv/', 'node_modules/', '.next/', 'dist/'],
  },
  // ... other config
];
```

This prevents ESLint from attempting to parse Python virtualenv files.

### Output Format

Report each phase with a Progress Line, then end with a Result Block:

```
→ Read PRODUCT-REQUIREMENTS.md
→ Selected platform: Render
→ Defined tech stack and data models
→ Generated TECHNICAL-ARCHITECTURE.md

---

**Result:** Architecture definition complete
Document: docs/TECHNICAL-ARCHITECTURE.md
Platform: Render
Stack: Next.js, Supabase, TypeScript
Next: /bootstrap-agents
```
