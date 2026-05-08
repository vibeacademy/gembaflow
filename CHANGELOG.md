# Changelog

All notable changes to Agile Flow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-08

First stable public release. This batch solidifies the framework's versioning story, expands the slash-command surface, introduces the Agent Output Format standard, and cleans up public-facing documentation.

### Added

- `/upgrade` command with `UPGRADING.md` migration guide for downstream fork upgrades
- `/prune-memory` command with time-decay scoring for agent memory hygiene
- `/research`, `/jtbd`, and `/positioning` slash commands for strategic discovery
- Transcript-based insight extraction added to `/log-session`
- Memory validation added to `/log-session` and `/validate-memory`
- Ticket-aware context paging added to `/work-ticket`
- Optional URI input added to `/research` command
- Agent Output Format standard (Result Block + Progress Lines) to `CLAUDE.md`
- Result Block templates across all 6 agent definitions
- Result Block and Progress Lines across high-traffic slash commands
- `MEMORY-ARCHITECTURE.md` documenting the full agent memory system
- Entity naming conventions for keyword search documented
- Pattern library and deployment bug fixes
- `.agile-flow-version` manifest file for downstream version tracking
- Version awareness in `/doctor` command
- Version parity CI check between `.agile-flow-version` and `package.json`
- Template-sync GitHub Action (`template-sync.yml`) for downstream forks to pull upstream updates
- BSL 1.1 license with Apache 2.0 change date (2029)
- Attribution badges and branding to README
- YouTube video embed in README

### Fixed

- Multiple Sentry/telemetry transport fixes (custom transport, envelope coercion, preview detection, `onRequestError` hook, `withSentryConfig`)
- Static asset copy for Next.js standalone on Render
- Preview workflows correctly skipped on template repo
- `doctor.sh` false positives in restricted PATH environments
- Agent commands hardened against protocol violations
- Quick fix protocol and linked-ticket board guard added

### Changed

- Removed GitHub MCP server dependency
- Workshop curriculum replaced with stubs; framework/user-content boundary documented
- Public-facing documentation reduced redundancy and improved quality for external audience

### Security

- BSL 1.1 license enforces non-production-service use; Apache 2.0 grant triggers 2029-01-01

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

[Unreleased]: https://github.com/vibeacademy/agile-flow/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/vibeacademy/agile-flow/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/vibeacademy/agile-flow/releases/tag/v0.9.0
