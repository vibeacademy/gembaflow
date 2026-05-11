# Workshop Facilitator Runbook

Operational procedures for facilitators running Agile Flow workshops on
the upstream `vibeacademy/agile-flow` template.

This runbook covers the framework-upgrade story for cohort participants
who have forked the template into their own GitHub accounts. The same
mechanism that powers individual `/upgrade` calls is what cohorts use to
stay in sync with the upstream release line during a workshop.

For full reference detail on the upgrade machinery, see
[UPGRADING.md](UPGRADING.md). For the participant-facing walkthrough that
you can hand to a fork owner, see [DOWNSTREAM-GUIDE.md](DOWNSTREAM-GUIDE.md).

---

## Mental Model

Each participant has their own fork of `vibeacademy/agile-flow`. When a
new release ships, every participant pulls it **independently** by running
`/upgrade` in their own fork. The script in their fork:

1. Reads their local `.agile-flow-version`.
2. Calls the public GitHub API to find the latest `vibeacademy/agile-flow`
   release tag.
3. Downloads the release tarball.
4. Copies files from each path listed in `syncDirectories` into their
   working tree, overwriting any local file that differs.
5. Creates a branch `agile-flow-sync/v{VERSION}`, commits, pushes, and
   opens a pull request on their fork.

The participant then reviews and merges the PR on their own. Nothing about
this flow requires the facilitator to push commits to the participants'
forks. The facilitator's job during an upgrade is shepherding, not
pushing.

---

## Mid-Workshop Upgrade Playbook

Use this when you need every participant on a newer framework version
during an active session.

### 1. Cut the upstream release

Releases are cut on `vibeacademy/agile-flow`. Until a release exists with
the desired tag, participants' `/upgrade` calls will return
`Already up to date` for the unreleased changes — `template-sync.sh` only
sees published releases, not `main`. Confirm the release exists:

```bash
gh api repos/vibeacademy/agile-flow/releases/latest --jq .tag_name
```

### 2. Announce the upgrade

Tell the cohort:

> Run `/upgrade` in your fork's Codespace. It will open a sync PR on your
> fork called `chore(sync): update Agile Flow framework to v{VERSION}`.
> Review the diff, merge it, and pull on your local clone.

### 3. Walk participants through the pre-flight checks

`/upgrade` will refuse to proceed if either check fails:

- **Clean working tree.** `git status --porcelain` must be empty. If a
  participant has uncommitted in-progress work, have them
  `git stash` first.
- **Authenticated `gh`.** `gh auth status` must show a logged-in account
  with permission to push branches and create PRs on the participant's
  fork. If it does not, have them run `gh auth login` and re-run.

### 4. Walk participants through the result

The script prints one of:

| Output | What the participant should do |
|--------|--------------------------------|
| `Already up to date` | Nothing. Their fork is on the latest release. |
| `Update available: X -> Y` followed by `ADDED` / `UPDATED` / `SKIP` lines and a PR URL | Open the PR, review the diff, squash-and-merge. Then `git pull` locally. |
| `ERROR: ...` | Read the message. Most failures are network or `gh auth`. |

### 5. Confirm the cohort has converged

After the cohort has merged their sync PRs:

```bash
# Spot-check a few participant forks
gh api repos/{user}/agile-flow/contents/.agile-flow-version --jq '.content' | base64 -d | jq .version
```

Every fork should now report the new release tag.

---

## Alternative Path: GitHub Actions

A participant who is not in a Claude Code session can run the same script
from the GitHub UI:

1. Their fork → **Actions → Template Sync → Run workflow → Run workflow**.
2. The workflow runs `bash scripts/template-sync.sh` with the
   workflow-scoped `GITHUB_TOKEN`.
3. The outcome is identical: a sync PR opened on the participant's fork.

The workflow is `workflow_dispatch` only — there is no schedule, no auto
trigger, no daily run. The participant always initiates.

---

## What Is and Is Not Touched

The sync script only reads and writes files inside paths listed in
`syncDirectories` of `.agile-flow-version`. For the shipped template,
that is:

- `.claude/agents`
- `.claude/commands`
- `.claude/hooks`
- `.claude/skills`
- `scripts`
- `starters`

Application code, product docs, deployment config, lint config, lockfiles
and migrations are never touched. The per-file classification is in
[DISTRIBUTION.md](DISTRIBUTION.md).

### Hand-Edited Framework Files

`template-sync.sh` does not consult a per-file override list. If a
participant hand-edits a file inside `syncDirectories`, the next sync PR
will overwrite their edit. Their protection is the PR review — the diff
will show the revert and they can choose not to merge.

If a participant wants permanent local customisations, coach them to add
**new** files outside `syncDirectories` rather than editing framework
files in place.

---

## Common Participant Issues

### "Working tree has uncommitted changes"

```bash
git stash
/upgrade
# After the sync PR is merged and pulled:
git stash pop
```

### "GitHub CLI is not authenticated"

```bash
gh auth login
```

Make sure the authenticated account is the one that owns the fork.

### "Could not fetch latest release"

The script hits the public GitHub API unauthenticated, which has a
60-requests-per-hour limit per IP. In a cohort sharing the same
Codespace egress IP, a busy session can hit the limit.

Workarounds:

- Wait for the rate-limit window to reset.
- Use the `Template Sync` workflow path (runs from GitHub-side
  infrastructure, separate rate limit).

### "Branch agile-flow-sync/v{VERSION} already exists on remote"

A previous sync attempt left the branch on the fork's `origin`. Two
options:

1. The PR is still open — review and merge that one.
2. The PR was closed without merging — delete the remote branch first,
   then re-run:

   ```bash
   git push origin --delete agile-flow-sync/v{VERSION}
   /upgrade
   ```

### "The PR opened but the changes look wrong"

Have the participant close the PR. The fork's `main` is unaffected — the
copy only lives on the sync branch. Then debug.

---

## What This Runbook Does **Not** Cover

- **Pushing framework changes from a facilitator-controlled repo into
  participant forks.** The upstream → fork direction is participant-driven
  (`/upgrade`), not facilitator-pushed. There is no facilitator-side
  "push update to all forks" command for the `vibeacademy/agile-flow`
  template.
- **GCP-track workshops.** The `agile-flow-gcp` edition adds a second
  hop and a separate maintainer tool (`/pull-upstream`). For that flow,
  see the runbook in the `agile-flow-gcp` repo.
- **Manual upgrades.** If the script genuinely cannot run (e.g., a
  participant has an air-gapped fork), see the "Manual Upgrade" section
  in [UPGRADING.md](UPGRADING.md).

---

## Reference

| Path | Role |
|------|------|
| `.agile-flow-version` | Local version + `syncDirectories` whitelist. |
| `scripts/template-sync.sh` | The sync script — release-tarball based, no flags. |
| `.claude/commands/upgrade.md` | The `/upgrade` Claude Code wrapper. |
| `.github/workflows/template-sync.yml` | The `workflow_dispatch` alternative. |
| `docs/UPGRADING.md` | Reference + troubleshooting. |
| `docs/DOWNSTREAM-GUIDE.md` | Participant-facing walkthrough. |
| `docs/DISTRIBUTION.md` | Framework/user-content classification. |
