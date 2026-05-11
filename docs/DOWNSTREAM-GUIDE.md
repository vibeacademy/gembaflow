# Downstream Fork Guide

You are running a fork of `vibeacademy/agile-flow`. This guide explains how
to pull updates to the framework files (agents, commands, hooks, skills,
scripts, starters) without disturbing your own application code, product
docs, or configuration.

For the framework/user-content classification of every file in the template,
see [DISTRIBUTION.md](DISTRIBUTION.md). For deeper troubleshooting, see
[UPGRADING.md](UPGRADING.md).

---

## How the Upgrade Works (One-Minute Version)

`/upgrade` is a thin Claude Code wrapper around `scripts/template-sync.sh`.
The script:

1. Reads the local version from `.agile-flow-version`.
2. Calls the public GitHub API (`api.github.com/repos/vibeacademy/agile-flow/releases/latest`)
   to find the latest release tag — no authentication required.
3. If the local version already matches the latest tag, it exits with
   `Already up to date`.
4. Otherwise, it downloads the release tarball, extracts it, and **copies**
   every file in each path listed under `syncDirectories` in
   `.agile-flow-version`. If a copied file differs from the local file, the
   local file is overwritten. If a file does not exist locally, it is added.
5. It bumps `version` inside `.agile-flow-version`, creates a branch
   named `agile-flow-sync/v{LATEST_VERSION}`, commits as
   `github-actions[bot]`, pushes the branch, and runs
   `gh pr create` to open a pull request against `main`.
6. The script exits. The upgrade is **not** applied to `main` at this point.
   A human still needs to review and merge the sync PR.

The script takes no flags and offers no interactive prompts. There is no
git merge step and no three-way conflict resolution. The whole interaction
with your repo is "copy files, commit, push, open PR."

---

## Pre-Flight Checks

`/upgrade` will stop and ask you to fix the environment before running the
sync script if either of these is wrong:

1. **Working tree must be clean.** `git status --porcelain` must produce no
   output. If you have uncommitted changes:

   ```bash
   git stash
   /upgrade
   # After the sync PR is merged:
   git stash pop
   ```

2. **GitHub CLI must be authenticated.** `gh auth status` must report a
   logged-in account that can push branches and open PRs on your fork:

   ```bash
   gh auth login
   ```

The script itself uses `gh pr create` at the end, so missing auth means no
PR.

---

## Running an Upgrade

### Option 1: `/upgrade` from Claude Code (recommended)

From your fork's checkout (Codespace or local), open Claude Code and run:

```
/upgrade
```

Claude verifies the pre-flight checks, runs `bash scripts/template-sync.sh`,
and reports the result. Possible outcomes:

| Output | Meaning |
|--------|---------|
| `Already up to date` | Local version matches the latest release. Nothing to do. |
| `Update available: X -> Y` followed by `ADDED` / `UPDATED` / `SKIP` lines and a PR URL | A sync PR was opened on your fork. Review and merge it to finish the upgrade. |
| `ERROR: ...` | The script aborted. Read the message and fix the underlying issue (e.g. network, auth, missing `.agile-flow-version`). |

When a PR is created, open it:

```bash
gh pr view <PR_NUMBER> --web
```

### Option 2: `Template Sync` workflow from the GitHub UI

If you cannot use Claude Code, the same script runs from a GitHub Actions
workflow:

1. Go to your fork on GitHub.
2. **Actions → Template Sync → Run workflow → Run workflow**.
3. The workflow checks out your repo and runs `bash scripts/template-sync.sh`
   with `GH_TOKEN=${{ secrets.GITHUB_TOKEN }}`. If an update is available,
   it opens the same sync PR you would get from `/upgrade`.

The workflow is triggered by `workflow_dispatch` only — it does not run on
a schedule, so you get an upgrade only when you ask for one.

---

## Reviewing and Merging the Sync PR

Each sync PR is named `chore(sync): update Agile Flow framework to v{VERSION}`
on a branch `agile-flow-sync/v{VERSION}`. The PR body lists every file the
script touched plus a link to the upstream release notes.

1. Open the PR (`gh pr view <PR_NUMBER> --web`).
2. Read the diff. Pay attention to any file you have hand-edited locally —
   the sync script copies the upstream version directly over it.
3. If anything looks wrong, close the PR. Your fork is unaffected because
   the changes only live on the sync branch.
4. If everything looks right, **Squash and merge**. After the merge, your
   fork is running the new version.

Your local `main` does not have the new version until you `git pull` after
the merge.

---

## What Gets Touched (and What Doesn't)

Only paths listed under `syncDirectories` in your `.agile-flow-version`
file are eligible to be modified. With the shipped template, that is:

- `.claude/agents`
- `.claude/commands`
- `.claude/hooks`
- `.claude/skills`
- `scripts`
- `starters`

Anything outside those paths is never read, never compared, and never
written. That includes `app/`, `__tests__/`, `docs/PRODUCT-REQUIREMENTS.md`,
`docs/PRODUCT-ROADMAP.md`, `render.yaml`, `eslint.config.mjs`,
`tsconfig.json`, `next.config.ts`, your migrations, and `.env*`.

The full file-by-file classification lives in
[DISTRIBUTION.md](DISTRIBUTION.md).

### Hand-Edited Framework Files

`template-sync.sh` does not consult a per-file override list. If you
hand-edit a file under one of the `syncDirectories` paths (for example,
you customise `.claude/agents/github-ticket-worker.md`), the next
`/upgrade` PR will contain a diff that overwrites your edit. The
protection model is:

- **Review the sync PR.** It will show your edit being reverted, so you
  can decide whether to merge.
- **Keep custom files outside `syncDirectories`** so they are never
  considered for sync. For example, add a new agent under a path the
  framework does not own, or split your customisation into a separate
  file.

If your sync PR diff looks wrong, close it. Your fork is unaffected
because the changes only live on the sync branch.

---

## Quick Reference

### Check your current version

```bash
jq .version .agile-flow-version
```

### Check the latest upstream version

```bash
gh api repos/vibeacademy/agile-flow/releases/latest --jq .tag_name
```

Or visit the
[releases page](https://github.com/vibeacademy/agile-flow/releases).

### Trigger an upgrade

| Method | Command |
|--------|---------|
| Claude Code | `/upgrade` |
| GitHub UI | Actions → Template Sync → Run workflow |
| Shell directly | `bash scripts/template-sync.sh` |

### Inspect or close the sync PR

```bash
gh pr list --head "agile-flow-sync/v*"
gh pr view <PR_NUMBER> --web
gh pr close <PR_NUMBER>
```

### Re-run after closing an unmerged sync PR

If you closed the sync PR without merging and want a fresh one for the
same version, delete the remote branch first — `template-sync.sh` skips
PR creation when the branch already exists on remote:

```bash
git push origin --delete agile-flow-sync/v{VERSION}
/upgrade
```

---

## Files That Drive the Upgrade

| Path | Role |
|------|------|
| `.agile-flow-version` | Local version + `syncDirectories` whitelist. Source of truth for "what version am I on?" |
| `scripts/template-sync.sh` | The actual sync script. Always invoked as-is; takes no flags. |
| `.claude/commands/upgrade.md` | The `/upgrade` Claude Code wrapper. Adds the pre-flight checks. |
| `.github/workflows/template-sync.yml` | The `workflow_dispatch` alternative path. |
| `docs/UPGRADING.md` | Reference guide with troubleshooting; same mechanism, more detail. |
| `docs/DISTRIBUTION.md` | Per-file classification of framework vs. user-content. |

---

## Troubleshooting

For environment errors (clean tree, `gh auth`, GitHub API rate limit,
existing sync branch, manual upgrade fallback) see the
**Troubleshooting** section of [UPGRADING.md](UPGRADING.md). The behaviour
is identical for downstream forks — there is nothing fork-specific to
configure.
