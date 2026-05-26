# Sync Rules: Upstream ↔ Downstream

This document tracks intentional differences between the upstream Gemba Flow
framework and its downstream forks. See `DISTRIBUTION.md` for the master file
classification.

## Principles

1. **Scripts must be identical** — Shell scripts in `scripts/` should match
   exactly between upstream and downstream unless there's a documented,
   fork-specific reason (e.g., GCP vs AWS provider differences).

2. **Commands may have minor customizations** — Files in `.claude/commands/`
   are framework-owned but may contain fork-appropriate examples or context.
   These should be documented here.

3. **Sync direction** — Upstream is authoritative. Downstream forks pull
   changes from upstream. When upstream fixes a bug, downstream should sync.

---

## Intentional Differences

### `.claude/commands/report-issue.md`

| Section | Upstream | Downstream (GCP) | Rationale |
|---------|----------|------------------|-----------|
| Context → Track examples | (none) | `(Founder/GCP/AWS)` | Fork-specific context helps users identify which track they're on |

This difference is acceptable because:
- It doesn't change behavior, only provides helpful examples
- Each fork should list its relevant track options
- The core command logic remains identical

### `scripts/report-issue.sh`

**Status:** Must be identical across all forks.

The script contains a bash 3.2 compatibility fix for parsing GitHub URLs
with `.git` suffixes. This fix must be present in all downstream forks.

---

## Sync Checklist

When syncing `/report-issue` files:

1. ✅ `scripts/report-issue.sh` — Sync exactly from upstream
2. ✅ `.claude/commands/report-issue.md` — Sync, but preserve fork-specific
   track examples in the Context section

---

## Adding New Differences

If a downstream fork needs to diverge from upstream:

1. Document the difference in this file (upstream) with rationale
2. Add a comment in the downstream file explaining why it differs
3. Ensure the divergence is minimal and doesn't break framework behavior
