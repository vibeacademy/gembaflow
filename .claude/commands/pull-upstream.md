---
description: "Pull framework updates from the upstream agile-flow repo into this fork"
---

# /pull-upstream — Sync from Upstream

Pull the latest framework changes from
[vibeacademy/agile-flow](https://github.com/vibeacademy/agile-flow) into this
downstream fork. Only touches files listed in syncDirectories in
.agile-flow-version; excludes stack-specific customizations automatically.

## Instructions

1. **Verify the environment** -- confirm the working tree is clean and gh is
   authenticated. If either check fails, STOP and tell the user what to fix.

   git status --porcelain
   gh auth status

2. **Run the sync script**:

   bash scripts/pull-upstream.sh

3. **Parse the output** between === PULL_UPSTREAM_SUMMARY === and
   === END_SUMMARY === to extract STATUS, UPSTREAM_HEAD, APPLIED,
   SKIPPED, and PR_URL (if present).

4. **Report results** to the facilitator based on status:

   - already_up_to_date: nothing to do; report the current upstream SHA
   - pr_created: surface the PR URL; remind them to review before merging
   - applied: direct apply; remind them to run the test suite

5. **If errors occur** -- surface the full error output. Common issues:

   - Uncommitted changes: git stash, then re-run
   - gh not authenticated: gh auth login
   - Network failure: check connectivity and retry

## Mid-Workshop Fast Path

When running during a live workshop and you need an upstream fix applied
immediately without waiting for a PR review:

   bash scripts/pull-upstream.sh --direct

This applies changes to the current branch directly. Confirm the test suite
still passes after:

   uv sync --extra dev && uv run pytest

## Dry Run

To preview what would change without touching anything:

   bash scripts/pull-upstream.sh --dry-run

## Output Format

End your response with a Result Block:

If a PR was created:

  **Result:** Sync PR created
  Upstream: abc1234 -> def5678 (N new commits)
  Applied: 3 files
  Skipped: 2 files (excluded)
  PR: #47 -- chore(upstream): sync framework from agile-flow@def5678
  Action: Review and merge the PR to finalize the sync

If already up to date:

  **Result:** Already up to date
  Upstream HEAD: abc1234

If applied directly:

  **Result:** Applied directly to current branch
  Upstream: abc1234 -> def5678
  Applied: 3 files
  Skipped: 2 files (excluded)
  Action: Run uv sync --extra dev && uv run pytest to verify
