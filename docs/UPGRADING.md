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
a newer version is available.

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
