---
description: "Upgrade this fork to the latest changes from upstream Agile Flow"
---

# /upgrade — Pull Latest Upstream Changes

Fetch and merge the latest framework changes from this fork's upstream Agile Flow repo.
Local overrides (`.agile-flow-overrides`) are never stomped. A rollback tag is created
before every merge so you can recover if something goes wrong.

## Instructions

1. **Verify clean working tree** — run `git status --porcelain`. If there are
   uncommitted changes, STOP and report:

   ```
   Your working tree has uncommitted changes. Please commit or stash them first:
     git stash
   Then re-run /upgrade.
   ```

2. **Run the upgrade script**:

   ```bash
   bash scripts/upgrade.sh
   ```

   The script will:
   - Read `.agile-flow-meta/upstream` for the upstream URL (or fall back to the
     `upstream` git remote, or prompt the user if neither is configured)
   - Create a `pre-upgrade-<timestamp>` rollback tag
   - Fetch and merge upstream `main` with `--no-commit --no-ff`
   - Restore all `.agile-flow-overrides` paths to their local versions
   - Write the new version to `.agile-flow-meta/version` and commit

3. **Handle the exit code**:

   | Code | Meaning | Action |
   |------|---------|--------|
   | `0`  | Success — upgrade committed | Report what changed (see step 5) |
   | `1`  | Error — dirty tree, fetch failure, or abort-on-conflict | Report the error message |
   | `2`  | Conflicts in interactive mode | Proceed to step 4 |

4. **Resolve conflicts (exit code 2 only)**:

   The script printed the conflicting files. For each file:
   - Show the user the conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>> FETCH_HEAD`)
   - Explain what upstream changed vs. what we have locally
   - Ask the user which version to keep (or whether to hand-merge)
   - Apply the resolution with `git add <file>`

   Once all conflicts are resolved, complete the upgrade:
   ```bash
   bash scripts/upgrade.sh --continue
   ```

   If the user wants to abort instead:
   ```bash
   git merge --abort
   ```

5. **Report the result**. Parse the script output and summarise:

   - **Upgraded** — show the version written to `.agile-flow-meta/version` and list
     files that changed (from the diff stat the script printed)
   - **Already up to date** — tell the user no changes were needed
   - **Override warnings** — if the script printed `NOTE: These override-protected paths
     also changed upstream`, list them and suggest the user review them manually

## Conflict modes (advanced)

If the user wants non-interactive upgrade (e.g. in CI or for automated runs):

```bash
# Accept upstream version for all conflicts (non-override paths)
bash scripts/upgrade.sh --accept-upstream

# Abort and roll back if any conflict is found
bash scripts/upgrade.sh --abort-on-conflict
```

## Rollback

If the upgrade broke something, restore the pre-upgrade state:

```bash
git reset --hard pre-upgrade-<timestamp>
```

The rollback tag is shown in the script output and is always created before the merge.

## Output Format

End your response with a Result Block:

```
---

**Result:** Upgrade complete
Version: v2.1.0 @ abc123def456
Files changed: 4 updated, 1 added
Rollback tag: pre-upgrade-20260508-143022
```

Or if already up to date:

```
---

**Result:** Already up to date
```

Or if conflicts were found and resolved interactively:

```
---

**Result:** Upgrade complete (conflicts resolved interactively)
Version: abc123def456
Files changed: 6 updated
Conflicts resolved: scripts/doctor.sh
```
