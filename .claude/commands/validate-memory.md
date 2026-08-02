---
description: Validate that completed tickets have corresponding Memory MCP entities
---

Check whether completed tickets from the current session have corresponding
`CompletedTicket` entities in the Memory MCP knowledge graph. Optionally
create missing entities.

## Workflow

### Step 1: Check Memory MCP Availability

Attempt a `mcp__memory__search_nodes` call with a simple query (e.g.,
`"CompletedTicket"`). If the Memory MCP server is not configured or
unreachable:

```
→ Memory validation skipped — Memory MCP server not available
```

Stop here. Do not treat this as an error.

### Step 2: Identify Completed Tickets

Query beads for work completed during the current session:
`bd list --status=closed --all --json --limit 0` — the `close_reason`
carries the
PR number (e.g. "PR #N merged to main after GO review"). Cross-check
against recent `git log --merges` on main for PR merge commits.

Collect: bead id, bead title, PR number (from close_reason), key files
changed.

### Step 3: Check for Existing Entities

For each completed bead, query Memory MCP:

```
mcp__memory__search_nodes({ "query": "CompletedTicket-{bead-id}" })
```

**Grandfather clause:** entities created before the beads cutover are
keyed `CompletedTicket-{issue-number}` (a bare GitHub issue number).
They remain valid history — do NOT flag them as violations or attempt to
rename them. Only new work (closed beads) is validated against the
`CompletedTicket-{bead-id}` key.

### Step 4: Report Results

For each bead, report one of:

```
→ Memory OK: CompletedTicket-{bead-id} exists for {bead-id} — {title}
✗ Missing memory: CompletedTicket-{bead-id} — no entity found for {bead-id} ({title})
  → Create this entity? Reading PR diff to generate observations...
```

Summary line:

```
→ Memory validation: {found}/{total} completed tickets have CompletedTicket entities
```

### Step 5: Create Missing Entities (Interactive)

For each missing entity, read the PR diff and generate a `CompletedTicket`
entity with observations:

- Bead id and title
- PR number and branch name
- Summary of what was implemented
- Key files changed
- Patterns or conventions established (if any)
- Gotchas encountered (if any)

Use `mcp__memory__create_entities` to create the entity:

```json
{
  "entities": [
    {
      "name": "CompletedTicket-{bead-id}",
      "entityType": "CompletedTicket",
      "observations": [
        "Bead {bead-id}: {title}",
        "PR #{pr} merged to main",
        "{summary of implementation}",
        "Key files: {files}",
        "{patterns or gotchas, if any}"
      ]
    }
  ]
}
```

After creating each entity, confirm:

```
→ Created CompletedTicket-{bead-id} with {N} observations
```

## Output Format

End with a Result Block:

```
---

**Result:** Memory validation complete
Checked: {total} completed tickets
Found: {found} existing entities
Created: {created} new entities
Missing: {still-missing} (if any were skipped)
```

## Related Commands

- `/log-session` — Session journal (includes memory validation)
- `/work-ticket` — Claim the next ready bead and implement
