---
description: "Run a comprehensive health check of the local environment and remote configuration"
---

# /doctor — Gemba Flow Health Check

Run a comprehensive diagnostic of the local environment and remote
configuration. Surfaces every issue that could block a workshop participant.

## Instructions

1. **Verify the clone is current with origin.** A stale clone is a silent
   failure mode — the architect-shaped session in `feature-x/jiujitsology`
   2026-06-10 began with a plan that spawned 14 obsolete tickets because the
   local repo was 3 commits behind `origin/main`. This early step prevents
   that pattern.

   Run these in order; do NOT mutate state — no `git pull`, no `git checkout`:

   ```bash
   git fetch --quiet 2>/dev/null || FETCH_FAILED=1
   BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
   ```

   - If `FETCH_FAILED` is set (likely offline or auth issue), print:

     ```text
     ℹ Could not verify against origin. If you're offline, this is fine.
       If not, check network / `gh auth status`.
     ```

     Continue to the next step — do NOT fail the doctor run.

   - If `git fetch` succeeded, count commits behind:

     ```bash
     BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo "?")
     ```

     - If `BEHIND` is `0`: print `✓ Clone is current with origin/$BRANCH.`
     - If `BEHIND` is `>0`: print a warning naming the count and the
       most-recent upstream commit subject so the operator can decide
       whether to pull:

       ```bash
       LAST=$(git log "HEAD..origin/$BRANCH" --pretty=format:'%s' -1 2>/dev/null)
       ```

       Then:

       ```text
       ⚠ Local is $BEHIND commits behind origin/$BRANCH.
         Most recent upstream commit: "$LAST"
         Run `git pull` before proceeding with anything that depends on
         the current code state (planning, architecture work, /upgrade).
       ```

     - If `BEHIND` is `?`: print `ℹ Could not count commits behind origin (unusual git state); skipping freshness check.`

   This step is informational — never block the rest of the doctor run on
   it. The point is to surface the gap, not to gate.

1. Run the local diagnostic script and capture the full output:

   ```bash
   bash scripts/doctor.sh
   ```

1. Parse the machine-readable summary block between `=== DOCTOR_SUMMARY ===`
   and `=== END_SUMMARY ===`. Extract PASS, WARN, FAIL, and SKIP counts.

1. Perform these **remote checks** that the shell script cannot do:

   a. **Branch protection rulesets** — run:

      ```text
      gh api repos/{owner}/{repo}/rulesets
      ```

      - PASS if at least one ruleset exists targeting `main`
      - WARN if no rulesets found

   b. **Repository secrets** — run:

      ```text
      gh secret list
      ```

      Check for presence (not values) of:
      - `RENDER_API_KEY` — WARN if missing
      - `RENDER_SERVICE_ID` — WARN if missing
      - `SUPABASE_ACCESS_TOKEN` — WARN if missing
      - `SUPABASE_PROJECT_REF` — WARN if missing

   c. **GitHub Project board** — run:

      ```text
      gh project list --owner {owner} --format json
      ```

      - PASS if at least one project exists
      - WARN if no projects found

1. Format a **health report table** combining local + remote results:

   ```text
   ## Gemba Flow Health Report

   ### Local Checks (from scripts/doctor.sh)
   PASS: {n}  WARN: {n}  FAIL: {n}  SKIP: {n}

   ### Remote Checks
   | Check | Status | Details |
   |-------|--------|---------|
   | Branch protection | PASS/WARN | ... |
   | Repo secrets | PASS/WARN | ... |
   | Project board | PASS/WARN | ... |

   ### Overall
   Ready for workshop: **YES** / **NO**
   ```

1. If there are any FAILs or WARNs, list **actionable fix instructions**
   for each one at the bottom of the report.

## Important

- This is a **read-only diagnostic**. Do not modify any files or settings.
- Do not launch sub-agents. Run all checks inline.
- Derive `{owner}` and `{repo}` from `git remote get-url origin`.
- **Non-admin users**: `gh api rulesets` and `gh secret list` may return
  404 or 403 for users without admin access. Map these responses to
  WARN or SKIP rather than FAIL — the checks are informational and do
  not indicate a broken setup.

### Output Format

End your output with a Result Block:

```
---

**Result:** Health check complete
Local: 8 pass, 1 warn, 0 fail
Remote: 3 pass, 1 warn, 0 fail
Ready for workshop: YES
```
