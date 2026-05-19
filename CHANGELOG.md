# Changelog

All notable changes to Agile Flow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.8] - 2026-05-19

### Fixed

- **fix(sync):** `template-sync.sh` now properly `git add`s `.agile-flow-meta/version` after writing, preventing dirty working tree after `/upgrade` (#298)
- **fix(report-issue):** Added browser fallback URL when gh CLI lacks permissions - generates pre-filled GitHub issue URL for manual submission (#290)
- **fix(doctor):** Remote checks now show confidence levels to distinguish "no resource" from "no token scope" (#288)
- **fix(upgrade):** Tolerates uncommitted user-content files during upgrade instead of blocking (#287)
- **fix(sync):** Write version to `.agile-flow-meta/version` after template sync so `report-issue.sh` can read upstream metadata (#285)
- **fix(doctor):** Detect IDE context for `claude` CLI availability in Codespaces (#284)

### Added

- **feat(bootstrap):** Skills now offer to commit outputs to a feature branch instead of leaving files uncommitted on main (#286)

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

[Unreleased]: https://github.com/vibeacademy/agile-flow/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/vibeacademy/agile-flow/releases/tag/v0.9.0
