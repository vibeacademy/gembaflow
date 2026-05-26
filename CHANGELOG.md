# Changelog

All notable changes to Gemba Flow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-05-26

**Phase 0.5 of the agile-flow → Gemba Flow rebrand.** This release is the critical-path enabler for the upcoming repo rename. Active forks **must** run `/upgrade` against this release before the rename happens — without it, `/upgrade` will silently break the moment the rename's 301 redirect lands.

### Added

- **`upstream` field in `.agile-flow-version`** — Downstream variant forks (e.g. `agile-flow-gcp`, future `agile-flow-aws`) can now declare their own upstream repo for `/upgrade` syncing. Falls back to the hardcoded `vibeacademy/agile-flow` default when absent. Accepts bare `owner/repo`, full HTTPS URL, or git URL forms — all normalized internally. (#342, supersedes #204)
- **Pattern #28** in `docs/PATTERN-LIBRARY.md` — "GitHub Actions: Workflow Pushes With `GITHUB_TOKEN` Don't Re-Trigger CI". Documents the auto-fix workflow gotcha, the lint-as-CI-check resolution, and the PAT-based escape hatch. (#338)
- **Canonical PAT scope set** documented in `.claude/README.md` with per-scope rationale. Includes a `gh auth refresh` remediation block for existing reviewer PATs missing the `project` scope. (#340)

### Changed

- **`/upgrade` (template-sync.sh) is now redirect-safe.** The `curl` call to the GitHub releases API uses `-L` to follow 301 redirects, so it continues working transparently when an upstream repo is renamed. Adds a `vibeacademy/gembaflow` fallback that triggers only when the primary returns 404, with a single informational stderr line. (#342)
- **Pre-flight checks** in `/create-ticket`, `/quick-fix`, `/work-ticket`, `/bootstrap-workflow` now use `gh auth status` + `gh repo view --json nameWithOwner` instead of the (since-removed) MCP GitHub server probe. (#339)
- **Account-switch hook** (`.claude/hooks/ensure-github-account.sh`) now routes `gh pr review` and `gh pr comment` to the reviewer account in addition to `gh pr create` → worker. Routing is intentionally narrow: `gh issue create`, `gh issue comment`, and `gh project item-*` are NOT auto-routed (command patterns can't reliably distinguish worker from reviewer context). Slash commands are responsible for explicit `gh auth switch` when they need a specific account. (#340)
- **Setup script** (`scripts/setup-accounts.sh`) now prints required PAT scopes inline at paste time, including the `gh auth refresh` upgrade command for existing reviewer PATs. (#340)

### Removed

- **`.github/workflows/auto-fix.yml`** — auto-fix-via-`GITHUB_TOKEN` is fundamentally broken (GitHub deliberately suppresses workflow re-triggers from `GITHUB_TOKEN`-signed pushes, leaving PRs at `BLOCKED` until a human pushes a no-op commit). Lint coverage is preserved via the existing `ci.yml` ruff/eslint jobs; pre-push hooks in `scripts/hooks/` provide local-dev auto-fix UX. See Pattern #28 for the full gotcha writeup. (#338)

### Fixed

- **Stale doc references to `auto-fix.yml`** in `docs/CI-CD-GUIDE.md`, `docs/DISTRIBUTION.md`, `docs/LEAN-PRINCIPLES.md` — the workflow table row, dedicated section, distribution table row, and "CI auto-fix" waste-elimination claim are all corrected. `LEAN-PRINCIPLES.md` now correctly identifies pre-push lint hooks (rather than the deleted CI auto-fix) as the waiting-waste mitigation. (#338)

### Upgrade notes

After running `/upgrade` against this release:

- Optionally add an `upstream` field to your `.agile-flow-version` if you're a variant fork (e.g. `agile-flow-gcp` pointing at `vibeacademy/agile-flow-gcp`). Forks without the field continue working unchanged against the canonical default.
- If your reviewer PAT is missing the `project` scope, follow the remediation block in `.claude/README.md` (`gh auth refresh --user {org}-reviewer --scopes repo,workflow,project,gist,read:org`). The `verify-bot-permissions.sh` test now checks for this scope.
- Active downstream forks (notably `agile-flow-gcp`) should run `/upgrade` against this release **before** the GitHub repo rename for the gembaflow rebrand. Without it, `/upgrade` will silently fail on the rename's 301 redirect.

### Rebrand sequence (context)

This is **Phase 0.5** of the agile-flow → Gemba Flow rebrand (epic: `vibeacademy/agile-flow-meta#96`). Subsequent phases, in order:

- **Phase 1** — GitHub repo rename (operational, not a PR)
- **Phase 2a–2c** — URL rewrites in scripts, env var dual-read shim, package metadata
- **Phase 3** — `agile-flow-gcp` updates its `.agile-flow-version` upstream field to point at itself
- **Phase 4** — dotfile and sync-branch prefix renames
- **Phase 5** — GCP resource naming forward-only update

## [0.9.0] - 2025-12-07

Pre-upgrade baseline — the first tagged release of Agile Flow.

### Added

- Core agent definitions: Product Manager, Product Owner, Ticket Worker, PR Reviewer, Quality Engineer, System Architect, DevOps Engineer
- Structured agile workflow with progressive refinement (Product Definition → Technical Architecture → Agent Specialization → Workflow Activation)
- Trunk-based development workflow with feature branches and PR-based merges
- GitHub Project board integration with Icebox, Backlog, Ready, In Progress, Review, Done columns
- Slash commands for agent interactions (`/lock-scope`, `/work-ticket`, etc.)
- `bootstrap.sh` interactive wizard for project initialization
- CI pipeline with validation tests (`.github/workflows/ci.yml`)
- Bot permissions verification script (`scripts/verify-bot-permissions.sh`)
- Hardened agent policies with NON-NEGOTIABLE PROTOCOL and bot account identity
- Agent action logging and audit trail (`scripts/analyze-agent-actions.sh`)
- Weekly agent restriction verification workflow
- Agent instruction linter (`scripts/lint-agent-policies.sh`)
- Weekly audit workflows and maintenance documentation
- Comprehensive Agent Workflow Summary documentation
- Product documentation templates (PRD, Roadmap)
- Getting Started guide

[Unreleased]: https://github.com/vibeacademy/agile-flow/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/vibeacademy/agile-flow/compare/v1.0.11...v1.1.0
[0.9.0]: https://github.com/vibeacademy/agile-flow/releases/tag/v0.9.0
