---
description: "List the slash commands available in this Gemba Flow project"
---

# /help — Gemba Flow Command Reference

Print a quick reference of the slash commands available in this project.
This is the discoverability surface for operators who don't yet have the
command list memorized.

## Instructions

Render the table below as-is. Group by purpose so an operator scanning the
list can find the command that matches what they're trying to do.

### Main session calibration

| Command | Description |
|---------|-------------|
| `/mode` | Set or inspect the active assistant mode for the main session. See `.claude/modes/README.md`. |
| `/mode list` | List shipped and fork-local modes with one-line positioning each. |
| `/mode <name>` | Activate a mode (writes `.claude/mode.local`). |

### Backlog and ticket flow

| Command | Description |
|---------|-------------|
| `/groom-backlog` | Prioritize tickets and populate the Ready column. |
| `/work-ticket` | Pick up the next Ready ticket and implement it. |
| `/review-pr` | Review PRs in the In Review column. |
| `/review-to-tickets` | Convert non-blocking Suggestions from a review into Backlog tickets. |
| `/sprint-status` | Board health overview. |
| `/check-milestone` | Check milestone progress. |
| `/swarm` | Run N parallel implementations of one ticket. |

### Product strategy

| Command | Description |
|---------|-------------|
| `/research` | Market research with web search. |
| `/jtbd` | Jobs-to-be-Done user analysis. |
| `/positioning` | Product positioning analysis. |
| `/evaluate-feature` | Evaluate a feature for strategic fit. |
| `/release-decision` | Go/no-go release decision. |
| `/lock-scope` | Lock MVP scope. |

### Quality and architecture

| Command | Description |
|---------|-------------|
| `/test-feature` | Create test plan and validate. |
| `/architect-review` | Architectural guidance. |
| `/doctor` | Environment health check (local + remote). |

### Platform maintenance

| Command | Description |
|---------|-------------|
| `/upgrade` | Upgrade framework files to latest release. |
| `/report-issue` | Report an issue back to upstream. |

## Important

- This command is **read-only**. Print the table and stop; do not invoke any
  other tooling.
- If the operator asks for detail on one command, point them at the matching
  file in `.claude/commands/<name>.md`.

## Output Format

End with a Result Block:

```
---

**Result:** Command reference printed.
Commands shown: <n>
```
