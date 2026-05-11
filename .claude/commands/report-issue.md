---
description: "Report a bug or issue from this fork back to the upstream Agile Flow repo"
---

# /report-issue — Report an Issue to Upstream

File a structured bug report or feedback item against the upstream Agile Flow repo
from this downstream fork. The report is delivered as a GitHub issue with a
`downstream-report` label so upstream maintainers can triage it automatically.

## When to use this command

Use `/report-issue` when you have found:
- A bug in a framework script, workflow, or slash command
- A workflow that does not work as documented
- Missing or incorrect documentation
- A pattern or architectural suggestion

Do **not** use this for issues specific to your fork's customisations (those are local
issues you own). Use it for problems that exist in the upstream framework files.

## Instructions

1. **Verify `.agile-flow-meta/upstream` exists**. If the file is missing, run `/upgrade`
   first to initialise the metadata directory.

2. **Gather context before running the script**. Before invoking, note:
   - What went wrong (be specific)
   - Severity: p1 (critical, blocks everyone), p2 (significant, workaround exists),
     p3 (minor or improvement)
   - Component: provisioning, ci, claude-commands, patterns, docs, or other

3. **Run the report script**:

   ```bash
   bash scripts/report-issue.sh
   ```

   The script will:
   - Read .agile-flow-meta/upstream to identify the target repo
   - Capture fork_commit (current HEAD) and upstream_version automatically
   - Prompt for severity, component, and title
   - Open your $EDITOR (or use inline input) for the description
   - Submit via gh issue create with label downstream-report
   - Fall back to clipboard copy + pre-filled browser URL if gh access is denied

4. **Fill in the description**. Provide:
   - Description: what is happening and why it is a problem
   - Steps to Reproduce: numbered list, minimal and specific
   - Expected Behaviour: what should happen
   - Actual Behaviour: what actually happens
   - Error Output: paste relevant terminal output
   - Context: workshop date, participant count, track (Founder/GCP/AWS)

5. **Handle the exit code**:

   | Code | Meaning | Action |
   |------|---------|--------|
   | 0 | Success - issue filed or fallback URL provided | Report the issue URL to the user |
   | 1 | Error - missing config or invalid input | Show the error message and fix the root cause |

6. **If gh access is denied** (fallback path):

   The script will save the report to .agile-flow-meta/reports/report-<timestamp>.md,
   copy the body to clipboard if available, and print a pre-filled GitHub issue URL.

   Tell the user:
   > The report was saved locally and a pre-filled GitHub issue URL was generated.
   > Open the URL in your browser to submit it manually.

## Non-interactive mode (CI / automation)

```bash
bash scripts/report-issue.sh \
  --non-interactive \
  --severity p2 \
  --component provisioning \
  --title "Provision script fails when roster has special characters"
```

## Report format reference

The script generates a YAML front-matter Markdown file in .agile-flow-meta/reports/:

```
---
agile_flow_report: true
upstream: https://github.com/vibeacademy/agile-flow
fork_commit: abc123def456...
upstream_version: v2.1.0 @ def789abc012
severity: p2
component: provisioning
title: "Provision script fails when roster has special characters"
---
```

The upstream field is written automatically from .agile-flow-meta/upstream.

## Output Format

End your response with a Result Block:

```
---

**Result:** Issue filed
URL: https://github.com/vibeacademy/agile-flow/issues/42
Severity: p2
Component: provisioning
Report: .agile-flow-meta/reports/report-20260508-143022.md
```

Or if fallback was used:

```
---

**Result:** Report saved (manual submission required)
Report: .agile-flow-meta/reports/report-20260508-143022.md
Browser URL: https://github.com/vibeacademy/agile-flow/issues/new?...
```

Or on error:

```
---

**Result:** Error
Reason: .agile-flow-meta/upstream not found - run /upgrade first
```
