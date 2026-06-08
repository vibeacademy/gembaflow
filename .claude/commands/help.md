---
description: List the shipped Gemba Flow slash commands and what they do
---

<!-- FRAMEWORK:START -->

# /help — Slash command catalog

Print the table below. Do not invoke any of the commands — `/help` is purely
descriptive. Fork-local commands (any `.claude/commands/*.md` not in the
canonical list) should also be listed if present, sorted alphabetically after
the framework set.

## Commands

| Command | Description |
|---------|-------------|
| `/architect-review` | Architectural guidance from the system-architect agent. |
| `/bootstrap-agents` | Specialize sub-agent personas with project context. |
| `/bootstrap-architecture` | Capture architecture into `docs/TECHNICAL-ARCHITECTURE.md`. |
| `/bootstrap-product` | Capture product vision into `docs/PRODUCT-REQUIREMENTS.md`. |
| `/bootstrap-workflow` | Activate the GitHub project board workflow. |
| `/check-milestone` | Check milestone progress against shipped tickets. |
| `/create-ticket` | File a new Agentic-PRD-Lite ticket on the backlog. |
| `/doctor` | Environment health check (local tooling, gh auth, hooks). |
| `/eli5` | Post a plain-language explanation on a ticket or PR. |
| `/evaluate-feature` | Strategic-fit evaluation for a proposed feature. |
| `/groom-backlog` | Prioritize the backlog and populate Ready. |
| `/jtbd` | Jobs-to-be-Done user analysis. |
| `/lock-scope` | Lock MVP scope. |
| `/log-session` | Capture a session journal: tickets delivered, insights, mitigations. |
| `/mode` | View, list, or set the main-session assistant mode. |
| `/positioning` | Product positioning analysis. |
| `/prune-memory` | Trim stale or low-value entries from agent memory. |
| `/quick-fix` | Lightweight fix workflow without ticket ceremony. |
| `/release-decision` | Go / no-go decision for a release cut. |
| `/report-issue` | File a bug or feature report back to upstream gembaflow. |
| `/research` | Market research with web search. |
| `/review-pr` | Review pull requests in the In Review column. |
| `/review-to-tickets` | Convert non-blocking review Suggestions into Backlog tickets. |
| `/sprint-status` | Board health overview. |
| `/swarm` | Run N parallel implementations of one ticket and pick the winner. |
| `/test-feature` | Create test plan and validate. |
| `/upgrade` | Sync framework files to the latest upstream release. |
| `/validate-memory` | Audit agent memory for staleness, dupes, drift. |
| `/work-ticket` | Pick up and implement the next ticket from Ready. |

## Assistant mode

Most commands invoke a sub-agent with its own calibrated persona. `/mode` is
the one exception — it shapes the **main chat session** (the default surface
when no slash command is running). See `.claude/modes/README.md` for the
shipped catalog and the resolution order.

<!-- FRAMEWORK:END -->
