# Changelog

All notable changes to Gemba Flow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Selectable assistant modes for the main Claude session (`/mode`)** — the default chat surface in Claude Code (before any slash command runs) now reads a per-operator mode fragment from `.claude/modes/<name>.md` and applies it as an additive prompt bias on top of `CLAUDE.md`. Five shipped modes: `default` (no-op, current behavior), `scaffolded` (verbose, step-by-step narration), `socratic` (asks before answering, tracks mastery), `terse-expert` (no preambles, code first), `shipping-coach` (push to smallest shippable, name the cut line). Mode files are written as second-person imperative instructions; sub-agents (`pr-reviewer`, `github-ticket-worker`, etc.) ignore the mode and keep their calibrated personas. Resolution order: `.claude/settings.json` `"assistantMode"` → `.claude/mode.local` (gitignored) → `default`. Activation surface is the new `/mode` slash command: `/mode` prints the resolved mode and its source, `/mode list` enumerates all available modes, `/mode <name>` writes `.claude/mode.local`, `/mode <unknown>` errors with the valid list. `bootstrap.sh` Phase 4 ends with a one-time mode-selection prompt (idempotent — re-running asks before overwriting an existing `.claude/mode.local`). `.claude/modes/` is a flat, fork-extensible directory: `scripts/template-sync.sh` enumerates files in the upstream directory only, so fork-local modes (e.g. `.claude/modes/gentle-ofelia.md`) survive every sync. See `.claude/modes/README.md` for the shipped catalog and the fork-extension template. (#406)
- **`/review-to-tickets` slash command** — closes the loop between `/review-pr` and the backlog by converting non-blocking Suggestions on a posted review into filed Backlog tickets. The command is the manual escape hatch (retroactive backfill, re-runs, cross-repo invocations); in steady state, `pr-reviewer` auto-hands off to `agile-backlog-prioritizer` immediately after posting a review with Suggestions. The prioritizer is the per-finding decider (file / dedupe / drop), files chosen tickets to Backlog (never Ready — promotion stays a `/groom-backlog` decision), and posts a structured summary comment on the source PR with a mandatory scope-impact verdict (unchanged / expanded / none). Idempotent re-runs via HTML marker. Required Changes on a NO-GO review are review blockers, not future work, and stay out of this flow. (#344)
- **Worker auto-hands off to `pr-reviewer` on green CI** — `github-ticket-worker` now launches `pr-reviewer` via the Task tool the moment CI is green and the ticket is in In Review, with no intervening human prompt. Closes the other half of the chain-gap that `/review-to-tickets` addressed: `pr-reviewer` already auto-hands off to `agile-backlog-prioritizer` on review-with-Suggestions; now the worker hands off to the reviewer on green CI. If CI is still red after 3 fix attempts the handoff is skipped and the worker leaves the escalation comment per protocol. Swarm mode is exempt — the `/swarm` orchestrator owns review timing across variants. Ported from the equivalent invariant in the meta harness. (#396)
- **`DEPRECATED_CHECK_ALIASES` mechanism in `scripts/verify-bot-permissions.sh`** — when a future release renames a CI check that the script reads (the way `typecheck` → `version-parity` was renamed in v1.2.1), the rename PR can add a one-line alias entry to the script. The script then accepts EITHER the new canonical name OR the old deprecated name for one release cycle, so forks have a graceful window to rename their own `.github/workflows/ci.yml` job to match. A follow-up PR one release later removes the alias entry. Active aliases are discoverable via `grep -n "DEPRECATED_AT:" scripts/verify-bot-permissions.sh`. No active aliases ship in this release — the mechanism is in place for the next rename. The release-process docs (`docs/SDLC.md`) document the rename-with-alias convention. (#375)

### Changed

- **Root `.gitignore` now covers framework-generated artifacts** — `.gembaflow-reports/` (the directory `/report-issue` writes into), the legacy `.agile-flow-reports/` (pre-rebrand name, still present on some forks), and the legacy `.agile-flow-version` dotfile (transitional safety net — the current canonical `.gembaflow-version` is intentionally NOT ignored) are now recognized as ignorable. Removes the recurring `/upgrade` clean-tree precheck failure on every fork that has ever run `/report-issue`. The clean-tree check itself is unchanged — this only adds the ignore patterns the check is supposed to honor. (#372)
- **Release notes now require a "Fork-maintained files you must update" section** — `docs/SDLC.md`'s release process gains a step 4 obligating maintainers to add this section to every release's GitHub Release body. The section calls out concrete edits a fork maintainer must apply by hand after `/upgrade` (removed shims, renamed CI checks, branch-protection rule expectations, workflow file deltas). If a release introduces no fork-required edits, the section reads "None required" — never omitted, so the absence is meaningful information. `VERSIONING.md` cross-links the convention. `.claude/commands/release-decision.md` adds the section to its Communication Readiness checklist. Retroactive backfill applied to the published v1.2.0 and v1.2.1 GitHub Releases. (#373)

### Documentation

- **Nested-subagent limitation documented in auto-handoff invariants** — both `github-ticket-worker.md` (worker → reviewer handoff) and `pr-reviewer.md` (reviewer → prioritizer handoff) now carry a "Known limitation: nested subagent contexts" subsection. The auto-handoffs silently no-op when the agent is itself a nested subagent (the Task tool is unavailable below the orchestrator in this Claude Code setup), which bites `/swarm` runs and orchestrator-driven multi-ticket batches. The new note names the fallback: include an explicit handoff-recommendation line in the Result Block so the orchestrator one level up can spawn the next link manually. Documentation-only; no behavioral change. Paired with the meta-side note in `gembaflow-meta#127`. (gembaflow-meta#126)
- **`docs/TICKET-FORMAT.md` example uses `###` headers instead of dash-banners** — the Concrete Example section's four Power-Section markers were `--- A. Environment Context ---` style. That style is harmless inside the surrounding code fence but renders as horizontal rules if anyone copies the example out as a template, and is inconsistent with the `###` (or `##`) headers real ticket bodies actually use. Switched to `### A. Environment Context` etc. so the example is copy-paste-safe and matches the conventions tickets in the wild follow. Content unchanged. (#235)

## [1.4.0] - 2026-05-31

**Minor release adding `/swarm` — run N parallel implementations of one ticket and pick the winner.**

### Added

- **`/swarm` slash command** (#390). Runs N parallel implementations of one Ready-column ticket, opens one PR per variant, leaves variant selection to the human. See `.claude/commands/swarm.md`.
- **`swarm-planner` agent** (#389). Produces N differentiated implementation briefs from a single ticket so each `/swarm` variant explores a meaningfully different approach (not N identical attempts).
- **Swarm mode for `github-ticket-worker`** (#392). The existing ticket worker now accepts a swarm-brief input and runs in isolated-worktree mode so concurrent variants don't trample each other.

### Migration notes

No migration required. `/swarm` is a new opt-in command; existing `/work-ticket` flows are unchanged.

### Fork-maintained files you must update

_None this release._

### Propagation note

This release touches only `.claude/agents/` and `.claude/commands/` — no runtime-protected scripts (`scripts/template-sync.sh`, `scripts/lib/overrides.sh`) were modified. Existing forks (`gembaflow-gcp`, `gembaflow-site`) pick up `/swarm` and `swarm-planner` automatically on next `/upgrade`. No fresh-fork-only caveat applies.

## [1.3.1] - 2026-05-29

**Patch release fixing the fresh-fork version stamp gap that produced no-op `/upgrade` PRs on every new fork.**

### Fixed

- **Fresh forks no longer stage a no-op first `/upgrade`** (#381). `bootstrap.sh` now looks up the latest upstream release tag via `gh release view` and sets `.gembaflow-version`'s `version` field alongside `installedAt` on first install. If the lookup fails (no network, no `gh` auth), bootstrap falls back to the previous behavior and prints a warning recommending `/upgrade`. As a safety net, `scripts/template-sync.sh` now detects the fresh-fork placeholder case (`version == "0.1.0"` with `installedAt` already stamped) and short-circuits: it writes the latest tag into the manifest locally and exits 0 without generating a sync PR. Legitimately-behind forks (e.g. `version: 1.2.0`) still sync normally. (#382)

### Fork-maintained files you must update

None required for this release. v1.3.1 introduces no synced behavior change that's gated on fork-side counterparts being updated:

- No CI check names renamed.
- No backward-compat shims removed.
- No dotfile renames.
- No env var renames.

The fresh-fork fix lives entirely in `bootstrap.sh` (a one-time script run on initial install) and `scripts/template-sync.sh` (which has its own propagation behavior — see below).

### Propagation note (read this if you maintain a fork)

The `template-sync.sh` portion of this fix lives in a **runtime-protected** file (a script can't safely overwrite itself mid-run). Existing forks will NOT pick up the placeholder short-circuit via `/upgrade` until [`#371`](https://github.com/vibeacademy/gembaflow/issues/371) (self-upgrade gap for runtime-protected scripts) is fixed.

**Concretely:**

- **Fresh forks** created from this release onward: get the fix immediately via the `bootstrap.sh` path. No no-op `/upgrade` PR.
- **Existing forks** (already past initial bootstrap): keep behaving as before — first `/upgrade` after this release still generates a sync PR that bumps `version` plus any other framework deltas. Once `#371` ships, runtime-protected scripts will refresh out-of-band and existing forks pick up the short-circuit.

If you want existing forks to benefit immediately, manually refresh `scripts/template-sync.sh` from this release's tarball (the workaround we documented for `#371`).

### How the pilot went (operator note)

This is the first release cut via `/cut-release` (`vibeacademy/gembaflow-meta` PR #109, Phase B.2 of the platform-shape calibration). The pilot exercised the canonical sequence: clean-tree check, commit survey since v1.3.0, H3-subsection release notes, `gh release create`, CHANGELOG backfill PR, downstream-report comments. Gaps observed in the pilot will be filed as follow-ups to refine the slash command before it becomes the routine entry point for future releases.

## [1.3.0] - 2026-05-28

**Adds the `/eli5` slash command to the framework.** Minor version bump because this is a user-visible new operator capability.

### Added

- **`/eli5` slash command** — posts a plain-language comment on a target issue or PR translating dense Agentic-PRD-Lite ticket bodies for **non-engineer operators** (founders, workshop attendees, stakeholders). Every technical term encountered (JWT, RLS, feature flag, CI gate, webhook, etc.) is treated as a teaching opportunity with an inline definition on first use, rather than assumed-known. Marker-based idempotency: re-running on the same target replaces the prior ELI5 comment, never appends. Optional Mermaid diagram with built-in render-check. Comment-only — never edits the canonical issue/PR body. (#330)

### Migration notes

- **Operators with the prior `/eli5` prototype in their own forks** (notably `vibeacademy/cubrox`, where the prototype lived in `.claude/commands/eli5.md` at commit `3ba35cb`) can run `/pull-upstream` to receive the upstream version. The upstream port intentionally diverges from the cubrox prototype in audience model: cubrox assumed "tech-adjacent operator who knows what an API is," while upstream assumes **the operator is NOT an engineer**. The "Keep as-is" column from cubrox's translation table is deliberately removed — there is no such column upstream; every term gets a definition.

### Audience-model design

The command spec includes worked examples for `JWT`, `RLS`, `feature flag`, `CI gate`, and `webhook` showing the expected `<term> (<plain-language definition>)` pattern. Word-budget guideline: soft 600-word ceiling, with a "Glossary section" escape valve when explanations need more room. The deliberate counter to `/review-pr` and `/work-ticket`, which assume an engineer audience.

### No breaking changes

- All existing slash commands behave identically to v1.2.1.
- No file rename, no env var change, no protocol change.
- `/eli5` is purely additive.

## [1.2.1] - 2026-05-28

**Patch release fixing three real bugs hit on first downstream consumption of v1.2.0.** All three were filed as `[downstream-report]` issues on the same day v1.2.0 shipped.

### Fixed

- **`template-sync.sh` now bumps `package.json` version** alongside `.gembaflow-version` (#361). Previously, every sync PR landed with red CI because `validate-version-parity.sh` found the two version sources disagreeing. The fix uses `jq` (with a `python3` fallback) to update `package.json` only if its `version` differs from the new release. Idempotent; skipped on non-Node forks. (#365)
- **`features/` directory added to `syncDirectories`** (#362). Downstream forks bootstrapped before the rebrand had stale `features/*` files referencing `.agile-flow-version` that `/upgrade` never touched, causing the BDD suite to fail post-sync. Future `/upgrade` runs now refresh these files. (#364)
- **`.claude/agents/*.md` now classified as `hybrid` with FRAMEWORK markers** (#363). Previously `bootstrap-agents` and `template-sync.sh` silently contradicted each other — every sync wiped out project-specific agent specialization. Now `template-sync.sh` only updates content between `<!-- FRAMEWORK:START -->` and `<!-- FRAMEWORK:END -->` markers; user-supplied specialization outside markers is preserved. (#366)

### Changed

- **CI job renamed `typecheck` → `version-parity`** (#361). The job had been misleadingly named `typecheck` — it never ran `tsc`, only the version-parity check. The real TypeScript `tsc --noEmit` lives in the `node` job and is unchanged.

  **⚠ Branch protection action required for consumers**: if you have a fork with branch protection that mirrors upstream, the required-status-check named `typecheck` now needs to be renamed to `version-parity` in your ruleset. Otherwise sync PRs against your fork will block on a check that no longer exists.

### Added

- **`bootstrap-agents` skill updated** with one-shot migration logic: when run on a legacy agent file (no markers), wraps the framework persona content in markers and appends project specialization after. Forks that ran `bootstrap-agents` before this release should re-run it once to gain marker protection. (#366)

### Migration notes

After `/upgrade` against this release:

- **Existing `.claude/agents/*.md` files without `<!-- FRAMEWORK:* -->` markers are preserved entirely** (preserve-and-warn behavior). The sync PR includes a `[!WARNING]` callout listing those files and recommending `/bootstrap-agents` to gain marker protection.
- **`features/*.{py,feature}` files** with `.agile-flow-version` literals (a leftover from pre-rebrand bootstrap) will be replaced by the clean upstream versions. Forks that have customized their own feature tests should add `features/<file>` to `.gembaflow-overrides` to protect them before the sync.
- **Sync PRs land green on CI**. The `version-parity` job verifies `.gembaflow-version` and `package.json` agree; `template-sync.sh` writes both, so they always do.

### Downstream-report status

`#352` (the original consolidated downstream-report against v1.1.0) was resolved by v1.2.0. This release picks up the three separate reports filed against v1.2.0 itself by the same consumer (`vibeacademy/gembaflow-site`): #361, #362, #363.

## [1.2.0] - 2026-05-27

**The Gemba Flow rebrand release.** v1.1.0 was the redirect-safety enabler that let the GitHub repo rename happen transparently; v1.2.0 ships the rest of the rebrand — package names, env vars, dotfile names, all URLs, agent footers, workshop docs.

## Migration on first `/upgrade`

When you run `/upgrade` against this release, `scripts/template-sync.sh` will:

1. **Auto-rename your dotfiles** (one-time, idempotent):
   - `.agile-flow-version` → `.gembaflow-version`
   - `.agile-flow-meta/` → `.gembaflow-meta/`
   - `.agile-flow-overrides` → `.gembaflow-overrides`
2. Sync the new framework files (which now reference `.gembaflow-*` natively — no dual-read fallback as of v1.2.0).

The migration step prints `INFO: migrating <old> -> <new>` for each rename. No-ops if you're already on the new names.

### If you set `AGILE_FLOW_*` env vars

`AGILE_FLOW_WORKER_ACCOUNT`, `AGILE_FLOW_REVIEWER_ACCOUNT`, `AGILE_FLOW_SOLO_MODE` still work via the dual-read shim in `scripts/lib/env-compat.sh` — you'll see a one-line stderr deprecation warning when they're the only thing set. Rename them to `GEMBAFLOW_*` in your shell rc / Codespaces secrets / devcontainer at your convenience.

## Changed

- **Package metadata:** `package.json` `name`: `agile-flow-starter` → `gembaflow-starter`. `pyproject.toml` `name`: `agile-flow` → `gembaflow`. `description`: "Gemba Flow Framework". (#347)
- **Dotfiles renamed** (with auto-migration step on first `/upgrade`): `.agile-flow-version` → `.gembaflow-version`, `.agile-flow-meta/` → `.gembaflow-meta/`, `.agile-flow-overrides` → `.gembaflow-overrides`. Sync branch prefix `agile-flow-sync/v…` → `gembaflow-sync/v…`. (#348)
- **Env vars** now read `GEMBAFLOW_*` first, fall back to `AGILE_FLOW_*` with deprecation warning. Helper at `scripts/lib/env-compat.sh`. (#346)
- **URL references and agent source footers** now natively reference `vibeacademy/gembaflow`. Old URLs continue to work via GitHub's 301 redirect for legacy clones. (#345)
- **`scripts/template-sync.sh`**: `UPSTREAM_REPO="vibeacademy/gembaflow"` (was `vibeacademy/agile-flow`); `FALLBACK_REPO="vibeacademy/agile-flow"` defensive belt-and-suspenders. (#345)
- **Workflow guards** in `deploy.yml`, `preview-deploy.yml`, `preview-cleanup.yml`: `if: github.repository != 'vibeacademy/gembaflow'` (was `agile-flow`) — without this, the template repo would have started running preview/deploy CI on its own PRs after the rename. (#345)

## Added

- **`upstream` field auto-normalized** in `.gembaflow-version` from full URL or bare `owner/repo` (Phase 0.5 capability, formalized in v1.2.0 docs).
- **Migration step** in `template-sync.sh` that `git mv`s legacy dotfiles to new names on first sync after upgrade. Kept indefinitely for dormant forks. (#348)

## Removed

- **Phase 4 dual-read fallback** removed across 6 scripts (`template-sync.sh`, `report-issue.sh`, `doctor.sh`, `lib/overrides.sh`, `validation/validate-version-parity.sh`, `bootstrap.sh`). Net -60 LOC. Forks on `.agile-flow-*` paths must run `/upgrade` once to trigger the migration step before scripts will function. (#359)

## Fixed

- **Pre-push hook**: `scripts/hooks/pre-push` now runs `uv run --extra dev pytest` and `uv run --extra dev ruff check`. Without `--extra dev`, fresh contributors' first push failed with `Failed to spawn: pytest`. (#350, closes #341)
- **`template-cleanliness` CI check**: removed `vibeacademy/agile-flow-gcp` test fixture references that tripped `gcp` rule; replaced with generic `vibeacademy/example-variant`. (#348)
- **BDD tests**: reports-dir assertions updated to `.gembaflow-reports/` so the test suite passes against the renamed dotfiles. (#348, #359)
- **`#352` downstream-report** — three v1.1.0 bugs (`scripts/report-issue.sh` hardcoded paths, template-cleanliness violations, BDD assertion mismatch) all resolved on this release.

## Upgrade notes

After running `/upgrade` against this release:

- **First-time migration**: expect `INFO: migrating .agile-flow-version -> .gembaflow-version` (and similar lines) in the sync output. The renames go into the sync PR alongside the framework file updates.
- **If your `.agile-flow-version` had an `upstream` field**, it's preserved (the rename is a `git mv`, not a recreate). Downstream variant forks (e.g. `gembaflow-gcp`) that point at their own upstream continue working.
- **`AGILE_FLOW_*` env vars**: still work, but rename at your convenience to silence the deprecation warning. Future minor release will drop the shim.
- **Reviewer bot PAT**: if you provisioned one before v1.0.11, it may be missing the `project` scope. Remediate with `gh auth refresh --user {org}-reviewer --scopes repo,workflow,project,gist,read:org`. (See `.claude/README.md` "Remediation" section.)

## Rebrand epic

The agile-flow → Gemba Flow rebrand is now structurally complete: [gembaflow-meta#96](https://github.com/vibeacademy/gembaflow-meta/issues/96) (closed). v1.2.0 is the shipping artifact for that work.

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

[Unreleased]: https://github.com/vibeacademy/gembaflow/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/vibeacademy/gembaflow/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/vibeacademy/gembaflow/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/vibeacademy/gembaflow/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/vibeacademy/gembaflow/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/vibeacademy/gembaflow/compare/v1.0.11...v1.1.0
[0.9.0]: https://github.com/vibeacademy/agile-flow/releases/tag/v0.9.0
