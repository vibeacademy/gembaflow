---
description: Create a well-structured ticket that meets Definition of Ready
---

Create a new bead in the beads (`bd`) tracker with guided workflow.

> **Reference**: CLAUDE.md § "Work-Item Tracking (Beads)" is the canonical
> board-model mapping; `docs/BEADS-CONVENTIONS.md` holds the canonical
> label vocabulary.

## Pre-Flight Verification (REQUIRED)

Before creating any ticket, verify the following. STOP and report to the user
if any check fails — do not continue with partial tooling.

1. **`gh` CLI is authenticated and the repository is accessible** — Run
   `gh auth status` and `gh repo view --json nameWithOwner`. If either fails,
   STOP and instruct the user to fix the issue.
2. **GitHub account is correct** — Run `gh auth status` and confirm the active
   account matches the expected worker/bot account. If only a personal account
   is active, STOP and instruct the user to run `scripts/ensure-github-account.sh`.
3. **Beads tracker is available** — Run `command -v bd` and confirm `.beads/`
   exists. If either fails, STOP and report.

## Critical Rules

1. **Every ticket must meet Definition of Ready** before it is created
2. **New beads start open and ungroomed — that IS the backlog.** There is no
   placement step; a bead becomes ready mechanically once it is unblocked and
   groomed (Ready is computed, never curated)
3. **Never create duplicate tickets** — search existing beads first
   (`bd list --json` + text match, or `bd search "<terms>"`)
4. **Assign appropriate priority** with `-p <0-3>` (0 = critical, 1 = important, 2 = nice to have, 3 = someday)

## Workflow

1. **Understand** — Ask clarifying questions about the feature/fix/task
2. **Gather Context** — Read `docs/TECHNICAL-ARCHITECTURE.md` and `docs/PRODUCT-REQUIREMENTS.md` to pre-populate Environment Context and Guardrails
3. **Research** — Search existing beads to avoid duplicates
   (`bd list --json` + text match, or `bd search "<terms>"`), check related code
4. **Draft** — Write the ticket following the template below
5. **Scope Check** — If effort estimate is XL or the happy path has multiple branch points, suggest decomposition before creating
6. **Review** — Present the draft to the user for approval
7. **Create** — `bd create "<title>" --type=<task|bug|epic|decision|spike> -p <0-3> --labels <comma-separated>`,
   passing the description via `--body-file <path>` (or `-d` for short bodies).
   The new bead starts open and ungroomed — that is the backlog; there is no
   placement step
8. **Categorize** — Add labels: `effort:<S/M/L/XL>` (beads has no effort
   field), plus `track:<name>` / `campaign:<slug>` where applicable. Flag
   human-gated work with the `human-ops` label and
   `bd note <id> "Operator: <exact manual action>"`. Wire dependencies known
   at creation with `--deps blocks:<id>`, or post-create with
   `bd dep add <blocked> --blocked-by <blocker>` (explicit direction — never
   bare `bd link`; after wiring, `bd dep cycles --json` must return `[]`)

## Ticket Format

**Do not use an inline template.** Read `docs/TICKET-FORMAT.md` before drafting
any ticket — it is the single source of truth and contains the full specification
with examples.

Every ticket MUST include these 5 components:

1. **Standard Fields** — Problem Statement, Parent Epic, Effort Estimate, Priority
2. **A. Environment Context** — Populate from `docs/TECHNICAL-ARCHITECTURE.md`
   and the existing codebase (stack, integration points, files to modify)
3. **B. Guardrails** — Populate from `docs/AGENTIC-CONTROLS.md` and PRD
   non-functional requirements (security rules, performance targets, prohibitions)
4. **C. Happy Path** — Numbered steps: Input → Logic → Output. One flow per ticket.
5. **D. Definition of Done** — Specific test assertions, lint/type commands,
   reviewer-verifiable outcomes. Not vague.

### Self-Check Before Presenting Draft

Before showing the draft to the user, verify:
- [ ] Problem Statement is 2-3 sentences, not a paragraph
- [ ] Sections A-D are all present and non-empty
- [ ] Environment Context references specific files, not generic descriptions
- [ ] Guardrails include at least one explicit prohibition
- [ ] Happy Path has numbered steps with data shapes
- [ ] Definition of Done has concrete assertions (not "tests pass")
- [ ] Effort estimate is provided; if XL, suggest decomposition

## Usage

```
/create-ticket
/create-ticket Add health check endpoint to the API
```

### Output Format

End your output with a Result Block:

```
---

**Result:** Ticket created
Bead: va-45 — feat: add health check endpoint
Type: task
Priority: p1
Effort: S
Status: open, ungroomed (backlog)
```
