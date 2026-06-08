<!-- FRAMEWORK:START -->
# Gemba Flow - Claude Code Project Template

## >>> CRITICAL RULES — Read These First <<<

1. **Never commit directly to `main`.** All work on feature branches (`feature/issue-{number}-short-description`). All changes through pull requests.
2. **All tests must pass before pushing.** Never use `git push --no-verify`. Fix the failing checks instead.
3. **Conventional commits required.** Format: `<type>(<scope>): <subject>`. See `.claude/skills/commit.md` for types and scopes.
4. **Only humans merge PRs.** Agents create PRs and review them. Humans approve and merge.
5. **Switch accounts before PR operations.** The `.claude/hooks/ensure-github-account.sh` hook handles this automatically.
6. **No emojis in ASCII tables.** They break column alignment. Emojis OK in prose and headings.
7. **One canonical location per fact.** Don't duplicate content across CLAUDE.md, agent files, and skills.
8. **Never hardcode application URLs.** Use `window.location.origin` (client-side) or request headers (server-side) so code works in both production and PR preview environments.

---

## Critical Requirements

> **TL;DR:** Trunk-based dev, quality-driven workflow, pre-push verification.

### Trunk-Based Development (REQUIRED)

- `main` branch is protected — no direct commits
- All work on short-lived feature branches
- Branch naming: `feature/issue-{number}-short-description`
- PRs require review before merge, keep branches short-lived (< 1 day)

The agent workflow depends on this:

1. `github-ticket-worker` creates feature branches and PRs
1. `pr-reviewer` reviews PRs (cannot merge — human does)
1. Human performs final review and merge

### Pre-push Hook (REQUIRED)

```bash
git config core.hooksPath scripts/hooks
```

The hook auto-detects the language stack and runs lint + tests before push.
**`--no-verify` is forbidden.**

### Quick Fix Protocol

For changes under 20 lines that don't alter behavior (broken imports, lint
errors, typos): skip ticket ceremony but still use branch + PR.

---

## Agent Configuration

> **TL;DR:** 6 agents with non-overlapping authority. Worker and reviewer
> have NON-NEGOTIABLE PROTOCOL blocks. Only humans merge.

| Agent | Role | Owns | Cannot Do |
|-------|------|------|-----------|
| Product Manager | Strategy | Vision, go/no-go, feature eval | Backlog management |
| Product Owner | Tactics | Backlog, tickets, priorities | Strategic decisions |
| Ticket Worker | Implementation | Code, tests, PRs | Merge PRs |
| PR Reviewer | Quality Gate | Code review, recommendations | Merge PRs |
| Quality Engineer | Validation | Test plans, reports | Implementation |
| System Architect | Design | Architecture, patterns | Implementation |

### Account Switching

The `.claude/hooks/ensure-github-account.sh` hook auto-switches accounts:

- **Worker** (`GEMBAFLOW_WORKER_ACCOUNT`, default: `va-worker`) — PR creation
- **Reviewer** (`GEMBAFLOW_REVIEWER_ACCOUNT`, default: `va-reviewer`) — PR reviews

> The deprecated `AGILE_FLOW_WORKER_ACCOUNT` / `AGILE_FLOW_REVIEWER_ACCOUNT`
> names still work via a dual-read shim (see `scripts/lib/env-compat.sh`)
> and will be removed in a future release.

### GitHub CLI (`gh`)

Agents use the `gh` CLI for all GitHub operations (issues, PRs, reviews,
board ops). Each bot account authenticates via `gh auth login` and the
`.claude/hooks/ensure-github-account.sh` hook switches to the correct
account automatically before PR creation and review operations.

### MCP Servers

MCP servers are defined in `.mcp.json` (project root). The bootstrap
wizard creates this file automatically. Configure allowed tools in
`.claude/settings.local.json` (see `.claude/settings.template.json`).

| Server | Required | Token |
|--------|----------|-------|
| `memory` | Yes | none |
| `sequential-thinking` | No | none |

---

## Formatting Standards

> **TL;DR:** No emojis in tables, GitHub-flavored markdown, code blocks
> with language specifiers.

- No emojis inside ASCII tables (they break alignment)
- Use GitHub-flavored markdown with clear heading hierarchy
- Code blocks with language specifiers
- Tables for structured data

### Agent Output Format

Every agent output MUST follow these patterns. Full spec: `docs/AGENT-OUTPUT-STANDARD.md`

**Result Block** — every completed action ends with:

```
---

**Result:** <one-line outcome>
<key-value pairs, one per line>
```

**Progress Lines** — multi-step workflows report each step:

```
→ Step completed
✗ Step failed — see output above
```

**Standard Vocabulary** — use these terms only, no synonyms:

| Category | Terms |
|----------|-------|
| Decisions | GO / NO-GO / CONDITIONAL |
| Status | On Track / At Risk / Blocked |
| Findings | Required change (blocking) / Suggestion (non-blocking) |
| Effort | S (1-4h) / M (0.5-2d) / L (2-5d) / XL (5+d) |

**GitHub References** — first mention: `#N — title`. Subsequent: bare `#N`.

**Section Order** (multi-section reports): Context → Findings → Recommendations → Result Block

---

## Assistant Mode Resolution

The main session can run in any of several modes that bias tone, verbosity, and explanation depth without changing the framework guardrails above. Sub-agents are unaffected. To resolve which mode is active for this session, follow this procedure exactly:

First, check `.claude/settings.json`. If the key `assistantMode` is present and its value is a non-empty string, that value is a candidate for the resolved mode. This is the **canonical, team-shared** setting and the form recommended for committed configuration.

Next, check `.claude/mode.local`. If the file exists, its entire trimmed contents (typically a single short string like `scaffolded`) is the **personal, local-machine override** and takes precedence over `settings.json`. The file is gitignored on purpose — it represents one operator's preference, not a team decision.

If neither `settings.json` `assistantMode` nor `.claude/mode.local` is set, the resolved mode is `default`.

Once you have the resolved mode name, read `.claude/modes/<name>.md`. Treat the file's `## Persona` and `## Heuristics` sections as additional context about how you should present yourself in this session — tone, verbosity, and explanation depth. Do not let the mode override any safety protocol, GitHub auth rule, or workflow guardrail above; modes are additive prompt fragments, not replacement personas. If the resolved mode is `default`, no overlay applies and you proceed with framework baseline behavior.

If `.claude/modes/<name>.md` does not exist (e.g. a stale `mode.local` referencing a mode that was removed), fall back to `default` silently and continue.

The mode applies to the **main session only**. When a sub-agent is invoked via the Task tool or a slash command, the sub-agent runs its own calibrated persona regardless of the resolved mode; when control returns to the main session, the resolved mode resumes.

<!-- FRAMEWORK:END -->

---

## Project-Specific Configuration

<!--
TEMPLATE: Fill in project-specific details below when using this template.
-->

### Project Information

- **License**: BSL 1.1 (converts to Apache 2.0 after 3 years per release)
- **Project Name**: [Your project name]
- **Repository**: [GitHub repo URL]
- **Project Board**: [GitHub project board URL]
- **Tech Stack**: [Languages, frameworks, tools]
- **Database**: [Supabase (recommended) — provides ephemeral PR databases via branching]
- **Organization**: [GitHub org name]

### Build & Test Commands

```bash
npm run dev          # Dev server (Next.js on port 3000)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest
npm run build        # Production build (standalone output)
```

### Definition of Ready

A ticket is ready when it has: clear title, description with context,
testable acceptance criteria, effort estimate, priority label, no blockers.

### Definition of Done

A ticket is done when: all acceptance criteria met, code reviewed and
approved, tests passing, no lint errors, PR merged to main.

---

<!-- FRAMEWORK:START -->
## Reference

> Detailed documentation lives in `docs/`. Consult as needed.

| Document | Contents |
|----------|----------|
| `docs/AGENTIC-CONTROLS.md` | 8-layer defense-in-depth controls |
| `docs/CONTEXT-OPTIMIZATIONS.md` | Context engineering principles |
| `docs/SENTRY-SETUP.md` | Sentry + GitHub integration setup |
| `docs/CI-CD-GUIDE.md` | Workflows, secrets, troubleshooting |
| `docs/PLATFORM-GUIDE.md` | Deployment platform options and setup |
| `docs/GETTING-STARTED.md` | First-time setup walkthrough |
| `docs/FAQ.md` | Common questions for non-engineers |
| `docs/TICKET-FORMAT.md` | Agentic PRD Lite ticket format (canonical) |
| `docs/PATTERN-LIBRARY.md` | Known solutions for Render/Supabase/GitHub silent failures |
| `docs/ARTIFACT-FLOW.md` | Artifact flow diagrams and authority matrix |
| `docs/AGENT-WORKFLOW-SUMMARY.md` | Complete workflow documentation |
| `docs/MAINTENANCE.md` | Weekly audit and maintenance guide |
| `docs/DISTRIBUTION.md` | Framework/user-content boundary classification |
| `docs/MEMORY-ARCHITECTURE.md` | Agent memory system: persistence types, data flow, known gaps |
| `scripts/doctor.sh` | Local diagnostic script (standalone) |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/groom-backlog` | Prioritize tickets, populate Ready |
| `/work-ticket` | Pick up next ticket and implement |
| `/review-pr` | Review PRs in In Review column |
| `/review-to-tickets` | Convert /review-pr Suggestions into Backlog tickets via the prioritizer |
| `/check-milestone` | Check milestone progress |
| `/research` | Market research with web search |
| `/jtbd` | Jobs-to-be-Done user analysis |
| `/positioning` | Product positioning analysis |
| `/evaluate-feature` | Evaluate feature for strategic fit |
| `/release-decision` | Go/no-go decision |
| `/sprint-status` | Board health overview |
| `/test-feature` | Create test plan and validate |
| `/architect-review` | Architectural guidance |
| `/lock-scope` | Lock MVP scope |
| `/doctor` | Environment health check (local + remote) |
| `/upgrade` | Upgrade framework files to latest release |
| `/mode` | Select, list, or inspect the assistant mode for the main session |
<!-- FRAMEWORK:END -->
