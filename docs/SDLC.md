# Framework SDLC

How `gembaflow` is developed, tested, released, and propagated to its
downstream cloud variants. This document is written from the perspective of
a contributor to the framework itself — not a user building on it.

---

## Framework vs. Downstream — The Critical Distinction

`gembaflow` is a **framework product**. Its consumers are:

- `agile-flow-gcp` — the GCP Cloud Run + Neon variant
- `agile-flow-aws` — the AWS variant (same structural pattern)
- Workshop attendee forks provisioned from these variants

The framework owns: agent definitions, slash commands, validation scripts,
CI workflow structure, documentation templates, and starter projects.
Cloud variants own: platform-specific deployment, database layer, and any
agent prompts rewritten with platform guardrails.

**A PR against `gembaflow` is not a product change. It is a framework
change.** Every such change propagates — or can propagate — to all downstream
variants. This carries obligations that no other PR type does.

---

## What a PR Against `gembaflow` Means

### Downstream propagation

Merging to `gembaflow` main does not automatically update cloud variants.
Variants pull changes on their own schedule using two sync paths:

| Sync path | When used | Mechanism |
|-----------|-----------|-----------|
| `pull-upstream.sh` | Routine updates (new agents, updated docs, improved scripts) | File-level diff against `syncDirectories`; skips `.gembaflow-overrides` |
| `upgrade.sh` | Major version changes or restructuring | Three-way merge with conflict resolution modes |

This means a framework PR has a **latency window** before downstream variants
receive the change. The PR author must consider:

1. **Will this change conflict with known overrides?**
   Cloud variants protect platform-specific files in `.gembaflow-overrides`.
   If the framework changes a file that a variant also overrides, the sync
   will skip it — variants must be manually notified.

2. **Is this a breaking change?**
   Breaking changes (renamed agents, restructured directories, removed
   commands, changed CI trigger conditions) require a major semver bump and
   a migration guide. Downstream variants cannot adopt a major bump via
   `pull-upstream.sh` alone — they must use `upgrade.sh` and resolve
   conflicts.

3. **Does this affect `syncDirectories`?**
   Files outside `.gembaflow-version`'s `syncDirectories` list are never
   synced automatically, regardless of changes. Additions to `syncDirectories`
   are themselves a breaking change.

4. **Does this change the `template-cleanliness` contract?**
   The base framework must remain cloud-provider-neutral. Any PR that
   introduces GCP, AWS, Render, Neon, or Supabase-specific terms fails the
   `template-cleanliness` CI job and must be rejected.

### Protecting downstream customizations

Any downstream fork that diverges from the framework — to use a different
ticket tracker, a different agent platform, or entirely different workflow
tooling — must protect its customizations from being overwritten by
framework syncs.

**The mechanism: `.gembaflow-overrides`**

The downstream fork maintains `.gembaflow-overrides`, a text file with
one path per line. Both sync paths respect this file:

- `pull-upstream.sh` — skips any file whose path matches an entry in
  `.gembaflow-overrides`
- `upgrade.sh` — after a three-way merge, auto-restores any overridden
  file to the downstream's version, discarding the upstream content for
  that path

**Example: replacing GitHub with a different issue tracker**

A downstream fork that replaces GitHub tooling with another platform
would add the relevant agent and command files to `.gembaflow-overrides`:

```
.claude/agents/github-ticket-worker.md
.claude/agents/pr-reviewer.md
.claude/commands/work-ticket.md
.claude/commands/review-pr.md
```

After this, every `pull-upstream.sh` and `upgrade.sh` run skips these
files. The downstream's custom agents are preserved indefinitely, even
across framework releases.

**Where the override mechanism breaks — and why file identity is a
framework obligation**

The override mechanism works by exact file path. If the framework renames
or moves a file that a downstream fork has overridden:

- The `.gembaflow-overrides` entry (old path) no longer matches anything
- The renamed file from upstream is synced in as a new, unprotected file
- The downstream fork now has both its custom version (old path) and the
  upstream version (new path) — silently diverged

This is why **renaming or moving any file within `syncDirectories` is a
breaking change** and requires:

1. A major version bump
2. A migration guide with the old and new paths explicitly listed
3. A note to downstream forks to update their `.gembaflow-overrides`
   entries before running the upgrade

**What `.gembaflow-overrides` does not protect against**

- **New files in `syncDirectories`:** a file the downstream also wants to
  customize will be synced in on the first run. The downstream must add
  it to `.gembaflow-overrides` after initial sync to protect future
  updates.
- **Semantic drift:** if the framework improves a file the downstream has
  overridden, the downstream will not receive those improvements. The
  downstream is responsible for manually reviewing upstream changes to
  overridden files on each release and cherry-picking what is relevant.
- **Silent path mismatches:** a typo or stale path in
  `.gembaflow-overrides` silently fails to protect the target. There is
  no validation that listed paths actually exist.

**The downstream fork's responsibility**

The framework cannot know what a downstream fork has customized. The
downstream maintainer is responsible for:

1. Adding any customized file to `.gembaflow-overrides` before syncing
2. Reading release notes for each framework version to check whether any
   overridden files were renamed or removed
3. Updating `.gembaflow-overrides` entries when the framework reorganizes
   files (on major version upgrades)

### Version significance

| Change type | Version bump | CHANGELOG required |
|-------------|-------------|---------------------|
| Bug fix, doc correction | Patch | Yes |
| New agent, command, script, workflow | Minor | Yes |
| Renamed/removed agent or command; restructured directories; changed bootstrap flow; modified CI trigger conditions downstream depends on | Major | Yes + migration guide |

The project uses **conventional commit format** (`<type>(<scope>): <subject>`)
for structured Git history and readable diffs. It does **not** use the
`semantic-release` tool — version bumps and CHANGELOG entries are made
manually by the PR author before tagging.

---

## Per-PR Responsibilities

Every PR against `gembaflow` main must satisfy this checklist before merge.

### Always required

- All CI jobs pass (see [Quality Gates](#quality-gates) below)
- `CHANGELOG.md` `[Unreleased]` section updated
- Version bumped in both `package.json` and `.gembaflow-version` (validated
  by `validate-version-parity.sh` in CI)
- Commit messages follow `<type>(<scope>): <subject>` convention

### When agent definitions change (`.claude/agents/*.md`)

- `validate-agents.sh` passes (minimum length, required sections)
- `validate-agent-policies.sh` passes (merge prohibition, boundary constraints)
- `lint-agent-policies.sh` passes (prohibited instructions check)
- `verify-agent-restrictions.sh --test protocol` passes (NON-NEGOTIABLE
  PROTOCOL blocks present for workflow agents)
- `verify-agent-restrictions.sh --test docs` passes (docs consistency)
- If a cloud variant overrides the changed agent file: notify the variant
  maintainers — they must manually evaluate whether their override still
  applies

### When slash commands change (`.claude/commands/*.md`)

- `validate-commands.sh` passes (YAML frontmatter with non-empty `description`)
- New commands: manual walkthrough of the command scenario against a real
  session (see [Testing Slash Commands](#3-testing-slash-commands))
- Removed or renamed commands: major version bump required

### When scripts change (`scripts/**/*.sh`)

- `validate-scripts.sh` passes (shellcheck + bash -n)
- If the script is user-facing and has a companion `.test.sh`: that test
  must pass or be updated
- New scripts: a `.test.sh` companion is expected for any script with
  branching logic

### When CI workflows change (`.github/workflows/*.yml`)

- `actionlint` passes on the changed files (run locally:
  `actionlint .github/workflows/changed-file.yml`)
- If a workflow file's name or trigger conditions change: major version bump
  required (downstream variants reference these by name in their CI)

### When breaking changes are made

- Major version bump in `package.json` and `.gembaflow-version`
- Migration guide added to `CHANGELOG.md` under the new version heading
- Explicit note in the PR description about which downstream overrides may
  need review

---

## Testing

### What CI tests on every PR

| CI job | What it checks | Tool |
|--------|---------------|------|
| `lint` | Markdown files | markdownlint-cli2 |
| `version-parity` | JSON files; version parity between `package.json` and `.gembaflow-version` (renamed from `typecheck` in #361 — does not run `tsc`) | custom scripts |
| `build` | Shell script syntax and style | shellcheck + bash -n |
| `test` | Command file frontmatter; agent file structure and minimum length | validate-commands.sh, validate-agents.sh |
| `template-cleanliness` | Framework stays cloud-provider-neutral | check-template-cleanliness.sh |
| `lint-agent-policies` | Agent policies, merge prohibition, NON-NEGOTIABLE PROTOCOL blocks, docs consistency | validate-agent-policies.sh, lint-agent-policies.sh, verify-agent-restrictions.sh |
| `node` | ESLint, tsc, Vitest, Next.js build (runs when `package.json` exists) | eslint, tsc, vitest, next build |
| `python` | ruff, mypy, pytest ≥80% coverage (runs when `pyproject.toml` exists) | ruff, mypy, pytest-cov |

### 1. Testing the workshop provisioning flow

**What is tested automatically:**
Key provisioning scripts have companion `.test.sh` files that verify
branching logic, flag handling, and error paths using in-process shell
assertions. These run as part of the `build` job via `validate-scripts.sh`.

```bash
scripts/provision-workshop-roster.sh
scripts/provision-workshop-roster.test.sh   # runs in CI
```

**What is not tested automatically:**
The full end-to-end provisioning flow — actually creating GCP projects,
Neon databases, and GitHub repos — requires live cloud credentials and
cannot run in CI. This is tested manually before each workshop delivery
using `docs/FACILITATOR-RUNBOOK.md` as the checklist.

**Gap:** There is no automated smoke test that exercises the full
provisioning path against a real cloud environment. Defects in cloud
resource sequencing or IAM configuration are only caught during manual
dry-runs.

### 2. Testing the bootstrap process

**What exists:**
`scripts/doctor.sh` validates the state of a repository *after* bootstrapping
— it checks that expected files, environment variables, and services are
present. Running `doctor.sh` on a freshly bootstrapped repo is the primary
verification step.

**What is not tested automatically:**
The bootstrap script itself (the process of creating a new project from the
template) has no automated test. The bootstrap flow is verified manually
when creating a new reference deployment or onboarding a new workshop cohort.

**Gap:** There is no CI job that exercises the bootstrap path in a clean
environment and verifies `doctor.sh` passes at the end. This is the most
significant testing gap in the framework — a broken bootstrap means no new
projects can be started from the template.

### 3. Testing slash commands

**What is tested automatically:**
`validate-commands.sh` (in the `test` CI job) checks that every file in
`.claude/commands/*.md` has valid YAML frontmatter with a non-empty
`description` field. This catches structural defects and missing metadata.

**What is not tested automatically:**
Command behavior at runtime — whether a command actually does what its
description says — is not automatically tested. The Claude Code agent
interprets the command prompt at session time, and there is no test harness
that invokes a command and asserts the outcome.

**Manual test protocol for new commands:**
Before merging a new or changed slash command:
1. Run `/command-name` in a Claude Code session against a representative
   repo state.
2. Verify the command produces the expected artifacts or actions.
3. If the command has safety implications (e.g., any command that modifies
   files or calls external services), verify it refuses unsafe inputs.

**Gap:** Slash command behavior is validated structurally but not
functionally. A command that has valid frontmatter but broken logic will
pass CI.

### 4. Testing agent definitions

**Automated (CI):**
- Structure validation: minimum length (500 chars), required sections
- Policy validation: merge prohibition, boundary constraints
- Restriction verification: NON-NEGOTIABLE PROTOCOL blocks, docs consistency

**Manual (before major agent changes):**
The scenarios in `docs/testing/agent-restriction-tests.md` should be run
manually when agent protocol blocks are modified:
- Scenario 1: merge refusal test
- Scenario 2: done-column refusal test
- Scenario 3: contradictory-instructions test
- Scenarios 4-5: account identity and branch protection tests

These are defined as step-by-step procedures with expected outcomes.

**Gap:** Agent behavior at runtime is tested by human walkthroughs, not
automated assertions. The test framework for agents is currently
documentation-plus-manual-execution.

### 5. Testing framework application code

When framework code exists (the starter projects), it is tested in CI:

**Node.js starter (`starters/`):**
Vitest runs `__tests__/*.test.ts` on every PR. Current tests cover the
health endpoint and Sentry error-event parsing. Coverage is not gated for
the starters (only for user-created projects using the template).

**FastAPI starter (`starters/fastapi/`):**
pytest runs `tests/*.py` with 80% coverage minimum. Tests cover health
endpoint, the Sentry error receiver, rate limiting, and GitHub issue
creation.

---

## Quality Gates

A PR cannot merge unless all of the following pass:

- `lint` (markdownlint)
- `version-parity` (JSON validity, version parity) — renamed from `typecheck` in #361
- `build` (shellcheck)
- `test` (agent and command structure)
- `template-cleanliness` (no cloud-provider terms)
- `lint-agent-policies` (agent safety)
- `node` (ESLint, tsc, Vitest, build — when package.json exists)
- `python` (ruff, mypy informational, pytest 80% — when pyproject.toml exists)

Branch protection requires one approving review in addition to all checks
passing.

---

## Release and Downstream Propagation

### Release process

1. Changes accumulate on `main` via reviewed PRs.
2. When ready to release, the maintainer:
   - Updates `CHANGELOG.md`: moves items from `[Unreleased]` to the new
     version heading with today's date
   - Bumps `version` in `package.json` and `.gembaflow-version` (must match)
   - Commits: `chore(release): bump to vX.Y.Z`
   - Creates annotated tag: `git tag -a vX.Y.Z -m "release vX.Y.Z"`
   - Pushes tag: `git push origin vX.Y.Z`
3. The `release.yml` workflow fires on the tag, extracts the CHANGELOG
   section, and creates a GitHub Release.
4. The maintainer **edits the published GitHub Release** to add the
   "Fork-maintained files you must update" section (see template below).
   The workflow generates the release from the CHANGELOG section, which
   describes synced framework changes — fork-maintained file edits that
   downstream consumers must apply manually require a separate, explicit
   call-out so they aren't lost in the CHANGELOG bullets.

### "Fork-maintained files you must update" (required section in every release notes file)

When a release changes behavior that's only enforced through a *synced*
artifact while the *related* fork-maintained artifact stays behind, forks
silently drift. This section makes that drift visible at release time.

**The section is required on every release**, even if the answer is
"None required". The absence of fork-required edits is meaningful
information — it tells consumers they can run `/upgrade` without
preparation.

What belongs in the section:

- **Removed compatibility shims** — e.g. "`report-issue.sh` no longer
  reads `.agile-flow-version` — update your `features/` BDD tests if you
  have any that reference it."
- **Renamed CI check names** — e.g. "`typecheck` → `version-parity` in
  `.github/workflows/ci.yml`. Update your branch-protection ruleset to
  match, or sync PRs will block on a check that no longer reports."
  **When you rename a check that `scripts/verify-bot-permissions.sh`
  reads, also add a deprecation alias** in that script's
  `DEPRECATED_CHECK_ALIASES` map so forks have one release cycle to
  rename their workflow. Format:
  `[old-name]=new-name  # DEPRECATED_AT: vX.Y.Z; remove in vX.Y+1`.
  File a follow-up ticket for the next release to remove the alias.
  Grep convention: `grep -n "DEPRECATED_AT:" scripts/verify-bot-permissions.sh`
  lists active aliases.
- **Workflow file deltas** — `.github/workflows/` is fork-maintained, not
  synced. Any expectation the framework has of those workflows (job
  names, required outputs, secrets) belongs here.
- **Branch-protection rule expectations** — required-status-check name
  changes, force-push policy changes, anything the fork's ruleset would
  need to mirror.
- **Anything else where a synced framework file references a
  fork-maintained counterpart whose name or behavior must match.**

What does NOT belong:

- Migration steps the framework's own scripts handle automatically (e.g.
  dotfile renames done by `template-sync.sh`'s migration step). Those go
  in "Migration notes" / "Upgrade notes", not here.
- New features or fixes — those are CHANGELOG entries.

### Release notes template — Fork-maintained files section

```markdown
## Fork-maintained files you must update

> **What this section is:** edits a fork maintainer must apply by hand
> after `/upgrade` — file paths and rule names whose synced framework
> counterpart changed, but which themselves are not synced.

- **`<file or rule>`** — `<what changed in the synced counterpart>`. Edit
  required: `<concrete diff or instruction>`. Skip if `<condition>`.
- **`<file or rule>`** — ...

(If none: `**None required.** This release does not change any
fork-maintained file expectations.`)
```

**Authoritative source for what's synced vs not:** `.gembaflow-version`'s
`syncDirectories` list + `docs/DISTRIBUTION.md` classification (per path:
`framework`, `user-content`, or `hybrid`). Anything not in
`syncDirectories` or marked `user-content` is fork-maintained.

### Downstream obligations after a release

Cloud variants are **not** automatically updated. After each release:

| Release type | Downstream action |
|-------------|-------------------|
| Patch | Run `pull-upstream.sh` — safe, idempotent, skips overrides |
| Minor | Run `pull-upstream.sh` — review any new files in `syncDirectories` |
| Major | Run `upgrade.sh --interactive` — resolve conflicts, review all override files for relevance |

For each cloud variant, the variant maintainer should:
1. Check if any changed framework files are listed in `.gembaflow-overrides`.
   If so, manually evaluate whether the override still makes sense or whether
   the framework change should be adopted.
2. After syncing, run `scripts/doctor.sh` to verify the variant is healthy.
3. If the framework added new entries to `syncDirectories`, those paths
   will be synced going forward — verify no conflicts with platform-specific
   content.

---

## Known Gaps

| Gap | Risk | Priority |
|-----|------|----------|
| No automated bootstrap test | A broken bootstrap is silent until someone tries to create a new project from the template | High |
| No runtime testing of slash commands | A command can have valid structure but broken behavior and pass all CI | Medium |
| No automated end-to-end workshop provisioning test | Cloud resource sequencing bugs are only caught in manual dry-runs before workshops | Medium |
| No automated downstream sync test | A framework PR could break `pull-upstream.sh` compatibility without CI catching it | Medium |
| Agent runtime behavior is manually tested | Protocol compliance is verified statically; actual agent decision-making is not asserted | Low (partially by design) |
| mypy is non-blocking | Type errors in Python starters do not fail CI | Low |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `docs/BRANCHING-STRATEGY.md` | Branch naming, trunk-based dev, PR workflow |
| `docs/CONVENTIONAL-COMMITS.md` | Commit format guide |
| `docs/CI-CD-GUIDE.md` | Workflow details and troubleshooting |
| `docs/testing/agent-restriction-tests.md` | Manual and automated agent safety test scenarios |
| `VERSIONING.md` | Semver policy and compatibility promise |
| `UPSTREAM.md` (cloud variants) | Fork relationship, changed-file inventory, sync procedure |
