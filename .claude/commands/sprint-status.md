---
description: Get current sprint status and board health overview
---

Launch the agile-backlog-prioritizer agent to provide a quick status overview of the current sprint from beads (`bd`) state.

## What This Command Does

### 1. Board Status Snapshot

Compute the count per board concept from bd, following the canonical mapping
in CLAUDE.md § "Work-Item Tracking (Beads)":

- **Backlog** — `bd list --status=open --json -n 0`, minus the ids returned by `bd ready --json`
- **Ready** — `bd ready --json`. This is mechanical (open + unblocked), not editorial: the count includes epics and ungroomed items. Report the raw number; when judging claimable work, filter `--type=task`.
- **In Progress** — `bd list --status=in_progress --json -n 0`
- **In Review** — beads carrying the `in-review` label, joined with `gh pr list --json number,title,createdAt` via their `pr:<N>` label. An open PR is the operative signal — flag any `in-review` bead whose PR is no longer open.
- **Done** — `bd list --status=closed --all --json -n 0`
- **Icebox** — `bd list --status=deferred --json -n 0`

Then:

- Identify any bottlenecks (e.g., too many items In Review)
- Check if Ready needs replenishment (few or no `--type=task` beads unblocked)
- Point the human at the rendered board: `.gembaflow-boards/kanban.html` (regenerates automatically; `/board-refresh` to force)

### 2. In Progress Work
- List all beads currently `in_progress`
- Check for stale items (no activity in X days)
- Identify any blockers (`bd dep tree <id>` on suspicious items)

### 3. Pending Reviews
- List all in-review beads and their open PRs
- How long have they been waiting?
- Who needs to take action?

### 4. Recent Completions
- Beads closed this week (`bd list --status=closed --all --json`, filter on `closed_at`)
- Velocity trend

### 5. Immediate Actions Needed
- No unblocked task beads? → Need grooming
- Items blocked? → Need unblocking
- PRs waiting too long? → Need review
- Stale In Progress? → Need attention

## Output Format

```markdown
## Sprint Status: [Date]

### Board Overview
| Board concept | Count | Health |
|---------------|-------|--------|
| Backlog | X | - |
| Ready | X | OK (>=2 task beads) / Low (1) / Empty (0) |
| In Progress | X | OK (1-3) / High (>3) |
| In Review | X | OK (1-2) / Bottleneck (>2) |
| Done | X | - |
| Icebox | X | - |

Rendered board: `.gembaflow-boards/kanban.html`

### In Progress (X items)
| Bead | Assignee | Days | Status |
|------|----------|------|--------|
| va-1ab Title | @user | 2 | Active |
| va-2cd Title | @user | 5 | Stale |

### Awaiting Review (X items)
| PR | Bead | Days Waiting |
|----|------|--------------|
| #234 | va-1ab | 1 |
| #235 | va-2cd | 3 |

### Completed This Week
- va-3ef: Feature description
- va-4gh: Feature description
- Velocity: X beads/week

### Action Items
1. [Priority] Action needed
2. [Priority] Action needed

### Blockers
- va-5ij blocked by: [reason]
```

## Usage

```
/sprint-status
```

## When to Use

- Daily standup preparation
- Quick health check on project progress
- Before starting new work
- When planning capacity

## Related Commands

- `/groom-backlog` - Detailed backlog grooming session
- `/check-milestone` - Progress toward specific milestone
- `/work-ticket` - Claim the next ready bead
- `/review-pr` - Review pending pull requests
- `/board-refresh` - Force-regenerate the HTML board projections

### Output Format

End your output with a Result Block:

```
---

**Result:** Sprint status — On Track
Ready: 3 | In Progress: 2 | In Review: 1 | Done: 8
Blockers: 0
Action items: 2
```
