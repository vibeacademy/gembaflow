# Upgrading Gemba Flow

This guide explains how to update your project to a newer version of the
Gemba Flow framework. Upgrades only touch framework-controlled files (agents,
commands, hooks, skills, scripts). Your application code, product docs, and
configuration customizations are never modified.

For the full list of what is and is not touched during an upgrade, see
[DISTRIBUTION.md](DISTRIBUTION.md).

> **On a pre-rebrand fork (v1.0.x)?** The first `/upgrade` will crash with
> `KeyError: 'tag_name'` because the v1.0.x copy of `scripts/template-sync.sh`
> does not follow HTTP redirects, and the `agile-flow → gembaflow` rename
> returned `301 Moved Permanently`. Apply the
> [one-line patch](#upgrading-from-v10x-pre-rebrand) below before running
> `/upgrade`.

---

## Check Your Current Version

```bash
jq .version .gembaflow-version
```

The `/doctor` command also checks for updates automatically and warns you if
a newer version is available. It also runs an early "clone is current with
origin" check — if your local repo is behind `origin/main`, `/doctor` prints
the count and the most-recent upstream commit subject so you can decide
whether to `git pull` before running `/upgrade`. This catches the "planning
from a stale clone" failure mode that surfaces as silently obsolete tickets.

To see all available releases, visit the
[Gemba Flow releases page](https://github.com/vibeacademy/gembaflow/releases).

---

## Upgrade Methods

### Option 1: `/upgrade` Command (Recommended)

From Claude Code, run:

```
/upgrade
```

This checks for a newer release, syncs framework files, and opens a pull
request for you to review. You must commit or stash any uncommitted changes
before running the command.

### Option 2: GitHub Actions

1. Go to your repository on GitHub.
2. Click the **Actions** tab.
3. Select the **Template Sync** workflow in the left sidebar.
4. Click **Run workflow** and confirm.

The workflow runs the same sync script and opens a pull request.

---

## What Happens During an Upgrade

1. The sync script fetches the latest release from `vibeacademy/gembaflow`.
2. It compares your local version (from `.gembaflow-version`) to the latest.
3. If an update is available, it downloads the release and copies only the
   directories listed in `syncDirectories` (inside `.gembaflow-version`):
   - `.claude/agents`
   - `.claude/commands`
   - `.claude/hooks`
   - `.claude/skills`
   - `features`
   - `scripts`
   - `starters`
4. It creates a branch (`gembaflow-sync/v{VERSION}`), commits the changes,
   and opens a pull request.
5. Your `.gembaflow-version` file is updated with the new version number.

**Your code is safe.** Application code (`app/`, `__tests__/`), product docs
(`PRODUCT-REQUIREMENTS.md`, `PRODUCT-ROADMAP.md`), deployment config
(`render.yaml`), and other user-content files are never touched.

### One-time effect on forks bootstrapped before `features/` was synced

The `features/` directory holds the BDD test suite and is framework-owned. It
was added to `syncDirectories` after the v1.2.0 rebrand (#362). Forks that
were bootstrapped before that change still carry their original copy of
`features/` from initial fork time and have never received upstream updates
to it. On the next `/upgrade` after #362 lands, `template-sync.sh` will
compare each file under `features/` and replace any that differ from the
upstream release — pulling in renames such as `.agile-flow-version` →
`.gembaflow-version` inside the BDD step files.

If your fork has intentionally customized a specific feature test, add the
path to `.gembaflow-overrides` (e.g. `features/steps/report_issue_steps.py`)
before running `/upgrade` to keep your local version.

---

## Reviewing and Merging the Sync PR

1. Open the pull request on GitHub (or run `gh pr view --web`).
2. Review the changed files. The PR body lists every file that was added or
   updated.
3. If everything looks good, click **Squash and merge**.
4. After merging, your project is running the new version.

---

## Upgrading from v1.0.x (Pre-Rebrand)

In June 2026 the framework was renamed from `agile-flow` to `gembaflow`
and moved to `vibeacademy/gembaflow`. Forks bootstrapped on v1.0.x ship
a copy of `scripts/template-sync.sh` whose `curl` call does **not**
follow HTTP redirects:

```bash
curl -sf "https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest"
```

After the rename, GitHub returns `301 Moved Permanently` for the old
URL. Without `-L`, `curl` returns the redirect JSON body — which has
no `tag_name` field — and the script crashes with
`KeyError: 'tag_name'`. The fix shipped in v1.4.0 (`curl -sfL ...`),
but a v1.0.x fork cannot reach v1.4.0 without first patching its local
copy. This section is the one-time escape hatch.

### The one-line patch

Run this from your fork's repo root. It works on both macOS (BSD sed)
and Linux (GNU sed):

```bash
sed -i.bak 's|curl -sf "https://api.github.com|curl -sfL "https://api.github.com|' scripts/template-sync.sh
```

The `.bak` suffix is required by BSD sed and accepted by GNU sed, so
the same command is portable. A `scripts/template-sync.sh.bak` file is
left behind for safety — delete it once `/upgrade` has run successfully.

Verify the patch took effect:

```bash
grep "releases/latest" scripts/template-sync.sh
# Expected: curl -sfL "https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest"
```

The `L` after `-sf` is the load-bearing change.

### Belt and braces: pin UPSTREAM_REPO

The redirect is the root cause — eliminate it by pointing
`UPSTREAM_REPO` at the new path directly. Add this to your shell
before running `/upgrade`:

```bash
export UPSTREAM_REPO=vibeacademy/gembaflow
```

With both the `curl -L` patch and the `UPSTREAM_REPO` pin in place,
neither the redirect nor the missing `tag_name` field can crash the
upgrade.

### After the patch

1. Confirm `scripts/template-sync.sh` now contains `curl -sfL ...` on
   the `releases/latest` line.
2. Run `/upgrade` in a Claude Code session.
3. Review the resulting PR for the framework-owned file changes.
4. Merge the upgrade PR.

The fork is now on the latest version. Subsequent upgrades use the
modern path above — this workaround is one-time only.

> **Long-term fix:** the structural propagation gap for
> runtime-protected scripts (`scripts/template-sync.sh`,
> `scripts/lib/overrides.sh`) is tracked in
> [`gembaflow#371`](https://github.com/vibeacademy/gembaflow/issues/371).
> Once that lands, future framework changes to these scripts reach
> existing forks automatically without manual hand-patching.

---

## Pre-Upgrade Audit (`audit-local-customizations.sh`)

Before each `/upgrade`, the framework runs
`scripts/audit-local-customizations.sh`. The audit surfaces every
framework-controlled file (a path under `syncDirectories` in
`.gembaflow-version`) that has been modified locally since the fork was
bootstrapped (`installedAt`) and is NOT already protected by
`.gembaflow-overrides`. These are the files at silent-clobber risk when
the sync runs.

The audit is **read-only**:

- It never modifies `.gembaflow-overrides` automatically.
- It always exits 0 (informational; never blocks).
- The `/upgrade` skill spec wraps the audit with an operator confirmation
  step — if the audit lists unprotected paths, the operator is prompted
  before the sync proceeds.

Operator response options:

| Answer | Result |
|---|---|
| `y` / `yes` | Continue to sync; accept the clobber risk. |
| `N` / no / anything else | Stop. Operator adds the surfaced paths to `.gembaflow-overrides`, commits, and re-runs `/upgrade`. |

Automated re-runs (e.g. CI) that cannot answer the prompt should pass
`--skip-audit` to bypass the audit step:

```bash
/upgrade --skip-audit
```

This was added to close the silent-clobber failure mode where a fork
that had hand-customized a framework-controlled file (a tightened
validator, an agent prompt) would lose the customization on the next
sync and only notice via CI failure — or worse, not notice at all if
the customization wasn't CI-tested.

### What the audit cannot catch

- Files outside `syncDirectories` (sync never touches them; no risk).
- Files in `syncDirectories` that were modified BEFORE `installedAt`
  (these belong to the initial fork bootstrap, not local customization).
- Customizations made by editing the upstream file in a way that
  preserves its byte signature (rare; not a real failure mode).

---

## Version Parity Policy

By default, `scripts/validation/validate-version-parity.sh` runs in
**lenient mode**: it compares the version field in `.gembaflow-version`
(the framework manifest) against `package.json` (the app manifest), and
if they diverge, it emits a `WARN` line and exits 0 instead of failing
the CI job.

Forks that ship a product on a separate version cadence will see their
framework and app versions diverge as a normal lifecycle event — the
strict-parity policy that v1.0.x – v1.3.x shipped punished this
common case. The new default lets framework upgrades and app releases
move independently.

### Opting into strict mode

If your fork vendors the framework into a re-published package and the
two versions MUST move together, opt back in by adding a single key to
your fork's `.gembaflow-version`:

```json
{
  "version": "1.2.3",
  "enforceVersionParity": true,
  "syncDirectories": ["…"]
}
```

With `enforceVersionParity: true`, the validator behaves as it did in
prior versions: any divergence between `.gembaflow-version` and
`package.json` fails CI with exit 1.

### Behavior summary

| Opt-in flag | Versions match | Versions diverge |
|---|---|---|
| absent or `false` (default) | PASS (exit 0) | WARN, PASS (exit 0) |
| `true` (strict) | PASS (exit 0) | FAIL (exit 1) |

The validator continues to skip cleanly when either manifest is
absent (non-Node projects, pre-bootstrap state) — those exit codes
are unchanged.

---

## Troubleshooting

### `KeyError: 'tag_name'` (pre-rebrand forks)

You're on v1.0.x and `/upgrade` hit the `agile-flow → gembaflow`
rename redirect. Apply the
[one-line patch](#the-one-line-patch) above, then re-run `/upgrade`.

### "Your working tree has uncommitted changes"

Commit or stash your changes before running `/upgrade`:

```bash
git stash
/upgrade
# After the upgrade PR is merged:
git stash pop
```

### "GitHub CLI is not authenticated"

Log in to the GitHub CLI:

```bash
gh auth login
```

### "Could not fetch latest release"

The sync script uses the public GitHub API. This can fail if:

- You have no internet connection.
- The GitHub API is temporarily unavailable.
- You have hit the unauthenticated API rate limit (60 requests/hour).

Wait a few minutes and try again.

### "Branch already exists on remote"

A sync PR for this version was already created. Check your open pull requests:

```bash
gh pr list
```

If the PR is still open, review and merge it. If it was closed without
merging and you want to retry, delete the remote branch first:

```bash
git push origin --delete gembaflow-sync/v{VERSION}
```

### Merge Conflicts

If the sync PR has merge conflicts, it usually means a framework file was
edited locally. To resolve:

1. Check out the sync branch locally:

   ```bash
   gh pr checkout <PR_NUMBER>
   ```

2. Merge main into it and resolve conflicts:

   ```bash
   git merge main
   # Resolve conflicts, keeping the upstream version for framework files
   git add .
   git commit -m "fix: resolve sync merge conflicts"
   git push
   ```

3. Review the PR again and merge.

---

## Manual Upgrade

If the automated sync does not work for your setup, you can upgrade manually:

1. Download the latest release from the
   [releases page](https://github.com/vibeacademy/gembaflow/releases).
2. Extract the archive.
3. Copy the framework directories (`.claude/agents`, `.claude/commands`,
   `.claude/hooks`, `.claude/skills`, `features`, `scripts`, `starters`)
   into your project, overwriting existing files.
4. Update the `version` field in `.gembaflow-version` to match the release
   tag.
5. Commit the changes and open a pull request for review.
