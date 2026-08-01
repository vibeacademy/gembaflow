---
description: Check progress toward a roadmap milestone
---

Launch the agile-backlog-prioritizer agent to assess progress toward a specific milestone.

**Usage**: `/check-milestone <milestone-name>`

**Example**: `/check-milestone "MVP Release"`

## What This Command Does

### 1. Milestone Overview
- Read milestone definition from `docs/PRODUCT-ROADMAP.md`
- Identify target completion date
- Resolve the milestone's epic bead (`--type=epic`) and list its children — `bd list --json -n 0` filtered on `parent == <epic-id>`, or `bd dep tree <epic-id>` for the full graph view
- Review exit criteria and success metrics

### 2. Progress Analysis
- Count the epic's children by status per the CLAUDE.md § "Work-Item Tracking (Beads)" mapping (Done = closed, In Review = `in-review` label with open PR, In Progress = in_progress, Ready = in `bd ready`, Backlog = remaining open)
- Calculate completion percentage
- Identify completed vs. remaining work

### 3. Blocker & Risk Assessment
- Identify blocked beads (`bd list --status=blocked --json -n 0`, or unmet dependencies in `bd dep tree <epic-id>`)
- Flag beads with no assignee or stale activity
- Review dependency chains and critical path items
- Assess risk factors (scope creep, technical debt, unclear specs)

### 4. Velocity & Forecasting
- Calculate team velocity (beads completed per week) — `bd list --status=closed --all --json` and bucket by `closed_at`
- Estimate remaining effort based on incomplete beads (`effort:*` labels)
- Project completion date based on current velocity
- Compare projected vs. target completion date

### 5. Recommendations
- **If on track**: Continue current pace, monitor risks
- **If behind schedule**:
  - Identify tasks that can be deferred
  - Recommend parallelization opportunities
  - Suggest scope reduction if necessary
  - Flag beads needing urgent attention
- **If ahead**: Consider pulling in work from next milestone

## Output Format

```markdown
## Milestone: <Name>
**Target Date**: <Date from roadmap>
**Projected Date**: <Based on velocity>
**Status**: On Track | At Risk | Blocked

### Progress Summary
- Completed: X tasks (Y%)
- In Progress: X tasks
- Ready: X tasks
- Backlog: X tasks
- **Total**: X tasks

### Critical Path Items
1. [va-1ab] Item name - Status - Blockers
2. [va-2cd] Item name - Status - Blockers

### Blockers & Risks
- Blocker: Description
- Risk: Description

### Velocity Analysis
- Avg velocity: X tasks/week
- Remaining effort: Y tasks
- Estimated completion: <Date>
- Delta from target: +/- X days

### Recommendations
1. Action item
2. Action item
```

## Configuration

Define milestones in `docs/PRODUCT-ROADMAP.md`:
```markdown
## Milestones

### MVP Release
- **Target Date**: March 15, 2025
- **Exit Criteria**:
  - Core features complete
  - All P0 bugs resolved
  - Documentation complete
```

Each milestone maps to an epic bead; work items attach via
`--parent <epic-id>` (grouping, never blocking). Beads migrated from GitHub
carry `external-ref gh-<N>` for old cross-references.

## Best Practices

- Run weekly to monitor milestone health
- Update PRODUCT-ROADMAP.md if dates need adjustment
- File new beads (`bd create --parent <epic-id>`) if gaps are identified
- Defer scope to next milestone rather than compromise quality

### Output Format

End your output with a Result Block:

```
---

**Result:** Milestone check — On Track
Milestone: MVP Release (target: March 15)
Progress: 12/18 tasks (67%)
Blockers: 1 (va-3ef — API dependency)
Projected: March 13 (-2 days)
```
