---
description: "Phase 4: Activate the development workflow"
---

Set up the beads (`bd`) work tracker, branch protection, and create the initial backlog from PRD features.

## Bootstrap Phase 4: Workflow Activation

**Prerequisites**:
- Phase 1 (Product Definition) complete
- Phase 2 (Technical Architecture) complete
- Phase 3 (Agent Specialization) complete

This is the final bootstrap phase. It activates the full agent workflow.

> **Reference**: CLAUDE.md § "Work-Item Tracking (Beads)" is the canonical
> board-model mapping; docs/BEADS-CONVENTIONS.md is the canonical label
> vocabulary (`safety:*`, `effort:*`, `verdict:*`, `campaign:*`,
> `track:*`, `human-ops`, `in-review` + `pr:<N>`) and branch/PR
> conventions. docs/BEADS.md holds the pin/init/upgrade conventions.
> Reference them — never restate them.

**Migrating an existing fork off GitHub Projects?** This phase is for
standing up a NEW workflow. An existing fork with open GitHub issues runs
`scripts/migrate-issues-to-beads.sh` instead (idempotent, safe to re-run;
see docs/BEADS.md § "Migrating an existing fork").

## Ticket Format Requirement

Before creating any beads, read `docs/TICKET-FORMAT.md` in full. Every bead
created in this phase — epics and tasks alike — MUST follow the Agentic PRD
Lite format. Tickets without the 4 Power Sections (A. Environment Context,
B. Guardrails, C. Happy Path, D. Definition of Done) will not pass grooming
and will have to be rewritten.

## What This Phase Does

### 1. Beads Tracker Init

Run the framework init sequence (it gates on the pinned bd version, skips
bd's inert git hooks and conflicting agent boilerplate, and enables the
JSONL mirror — rationale in docs/BEADS.md § "Init sequence"):

```bash
./scripts/init-beads.sh -p <prefix>
```

- `-p <prefix>` — the bead-ID prefix (2-4 lowercase chars, e.g. `va` →
  `va-1a2b`), derived from the project name.
- `bd init` auto-commits its scaffolding; the script amends that commit to
  conventional form (`chore(beads): initialize bd tracker`). On a feature
  branch, pass `--no-commit` instead to keep the scaffolding as uncommitted
  changes and commit it deliberately.
- If bd is missing or unpinned the script stops with install instructions
  (`scripts/check-bd.sh` is the gate).

Then verify the render hook: after the first real `bd` mutation,
`.gembaflow-boards/{kanban,techtree}.html` regenerate. If not, force with
`/board-refresh` and check the hook registration in `.claude/settings`.

### 2. Label Vocabulary + GitHub-Side Safety Registry

The full label vocabulary lives in docs/BEADS-CONVENTIONS.md:
`safety:<class>`, `effort:<S/M/L/XL>`, `verdict:go|no-go|fixed`,
`campaign:<slug>`, `track:<name>`, `human-ops`, `in-review` + `pr:<N>`.
Bead labels are free-form strings — nothing to seed on the bd side.

The one GitHub-side registry that MUST exist is the `safety:*` PR-label set
(the agent-merge gate reads it; the worker copies the bead's `safety:*`
label onto every PR):

```bash
bash scripts/setup-safety-labels.sh
```

Idempotent; `--check` reports without creating.

### 3. Branch Protection Configuration

Verify or configure branch protection on `main`.

> **Token-capability probe (implementer's choice — mirrors bootstrap.sh):**
> The same probe-first logic from `bootstrap.sh` Phase 4 applies here.
> Before attempting `gh api repos/{slug}/rulesets POST`, issue a read probe:
>
> ```bash
> gh api "repos/${repo_slug}/rulesets" >/dev/null 2>&1
> probe_exit=$?
> ```
>
> - Exit 0 → token has `administration:read` (same scope family as the write)
>   → proceed to POST.
> - Non-zero → distinguish three branches:
>   1. Check `gh api repos/{slug}/collaborators/{user}/permission --jq .permission`.
>      If not `admin`/`maintain` → "Your role is X; ask the owner to run
>      `/bootstrap-workflow` from their admin account."
>   2. Else if `$CODESPACES = true` → Codespaces token-scope wall (see below).
>      *This is the default path once gfm-2mh/SEC-02 removes the devcontainer
>      permissions block — treat it as first-class UX.*
>   3. Else → generic 403 manual-fallback.
>
> **Branch 2 message (Codespaces — calm and actionable):**
> > Ruleset creation skipped — your Codespace token does not include the
> > `administration` scope. To enable auto-rulesets, either:
> > (a) Run `bash bootstrap.sh` locally after `gh auth login --scopes repo,workflow`
> > (add `admin:org` for org-owned forks); or
> > (b) Configure a PAT with `repo,workflow` scopes as a Codespaces secret and
> > re-run `/bootstrap-workflow` — see `docs/codespaces-secrets.md`.
>
> **DO NOT** dump the raw 403 body to the user. **DO NOT** retry or elevate.
> The `scripts/lib/ruleset-probe.sh` helper is the canonical implementation
> (sourced by `bootstrap.sh`); replicate the same three-branch logic here
> without re-importing the shell function.

Checklist:
- [ ] Require pull request reviews before merging
- [ ] Require status checks to pass (if CI configured)
- [ ] Do not allow bypassing the above settings

### 4. Initial Backlog Creation

Convert PRD features into beads following `docs/TICKET-FORMAT.md`:

- Create epics for major feature areas (epics use Problem Statement +
  high-level scope):

  ```bash
  bd create "<epic title>" --type=epic -p <0-3> --body-file <path>
  ```

- Create task beads with ALL required fields:

  ```bash
  bd create "<title>" --type=task -p <0-3> --parent <epic-id> \
    --labels effort:<S/M/L/XL> --body-file <path>
  ```

  The body file carries the Problem Statement plus the 4 Power Sections:
  - A. Environment Context (from `docs/TECHNICAL-ARCHITECTURE.md`)
  - B. Guardrails (from `docs/AGENTIC-CONTROLS.md` + PRD constraints)
  - C. Happy Path (numbered steps: Input → Logic → Output)
  - D. Definition of Done (specific test assertions, lint commands, reviewer checks)

- Epic membership via `--parent <epic-id>` (grouping, never blocking)
- Priorities with `-p <0-3>`; effort as `effort:<S/M/L/XL>` labels (beads has
  no effort field)
- Wire dependencies with explicit direction:
  `bd dep add <blocked> --blocked-by <blocker>` — **never bare `bd link`**
- After ALL wiring: `bd dep cycles --json` must return `[]`, then eyeball
  `bd ready --json --limit 0` to confirm the intended beads surfaced

### 5. Verify Readiness

Readiness is computed, never curated — there is no "move to Ready" action.
`bd ready` mechanically surfaces every open, unblocked bead. Confirm it
surfaces the intended 2-5 MVP tasks:

- Run `bd ready --json --limit 0` — the MVP tasks selected above appear
- If an intended bead is missing: a dependency is unresolved or it was
  deferred — grooming completes DoR, priorities, and dependencies
- If too much surfaces: wire the missing dependencies, or defer out-of-scope
  beads (`bd update <id> --status=deferred`)

### 6. CLAUDE.md Finalization

Update CLAUDE.md with:
- Repository URL and beads prefix
- Team/org information
- Any final configuration

## Pre-Flight Checklist

Before running this phase, ensure you have:

- [ ] GitHub repository created
- [ ] GitHub personal access token with `repo` and `workflow` permissions
      (no `project` scope — beads needs none)
- [ ] Permission to configure branch protection
- [ ] `bd` CLI installed at the framework pin (`./scripts/check-bd.sh`)

## Pre-Flight Verification (REQUIRED)

Before any tracker or ticket operations, verify the following. STOP and report
to the user if any check fails — do not continue with partial tooling.

1. **`gh` CLI is authenticated and the repository is accessible** — Run
   `gh auth status` and `gh repo view --json nameWithOwner`. If either fails,
   STOP and instruct the user to fix the issue.
2. **GitHub account is correct** — Run `gh auth status` and confirm the active
   account matches the expected worker/bot account. If only a personal account
   is active, STOP and instruct the user to fix the account setup.
3. **Claude Code settings and hooks are active** — First check whether a live
   settings file exists (`.claude/settings.json` or `.claude/settings.local.json`).
   If neither exists, STOP and instruct the operator:
   > No live Claude Code settings file found. bd permission gates, board-render
   > hooks, and the bd prime context hook are all inactive.
   > Run: `cp .claude/settings.template.json .claude/settings.local.json`
   > then re-run `/bootstrap-workflow`.

   If a live settings file exists, check that hook files it references are
   present and executable. WARN (do not STOP) if any hook file is missing
   or not executable.
4. **Beads tracker works** — `./scripts/check-bd.sh` passes; after init,
   `bd ready --json --limit 0` parses as valid JSON (an empty `[]` is fine).
   If either
   fails, STOP and report.

## Configuration Required

You'll be asked to provide:

```
GitHub Organization: [your-org]
Repository Name: [your-repo]
Bead-ID Prefix: [2-4 lowercase chars, e.g. "va"]
```

## Process

The workflow activation agent will:

1. **Verify GitHub Access**
   - Test token permissions
   - Confirm org/repo access

2. **Initialize Beads Tracker**
   - Run `./scripts/init-beads.sh -p <prefix>` (add `--no-commit` on a
     feature branch)
   - Verify the board render hook regenerates `.gembaflow-boards/`
   - Seed the GitHub-side `safety:*` label registry
     (`bash scripts/setup-safety-labels.sh`)

3. **Configure Branch Protection**
   - Check current settings
   - Apply protection rules
   - Verify configuration

4. **Generate Backlog**
   - Read `docs/TICKET-FORMAT.md` for the canonical ticket format
   - Read PRD features from `docs/PRODUCT-REQUIREMENTS.md`
   - Read `docs/TECHNICAL-ARCHITECTURE.md` for Environment Context content
   - Read `docs/AGENTIC-CONTROLS.md` for Guardrails content
   - Create epic beads (`--type=epic`; Problem Statement + scope description)
   - Create task beads with all 4 Power Sections populated (via `--body-file`)
   - Set priorities (`-p <0-3>`) and `effort:*` labels
   - Wire dependencies (`bd dep add <blocked> --blocked-by <blocker>`), then
     verify `bd dep cycles --json` returns `[]`
   - Self-check: before each `bd create`, verify the body contains sections
     A through D

5. **Verify Readiness**
   - Run `bd ready --json --limit 0` and confirm the intended 2-5 MVP tasks surface
   - Fix gaps by completing DoR, priorities, or dependency wiring — there is
     no move action

6. **Update Configuration**
   - Add repository URL and beads prefix to CLAUDE.md

7. **Persist bootstrap config + substitute templated placeholders**

   Some shipped skill specs reference fork-specific values through three
   placeholders documented in
   [`docs/PLATFORM-GUIDE.md`](../../docs/PLATFORM-GUIDE.md) §
   "Bootstrap-time templated values" — see that section for the full table.
   The framework ships one spec; every fork bends it to its own setup.
   After the operator has supplied (and you have validated) all three values
   during the steps above, persist them and run the substitution pass.

   - Copy `.gembaflow-config.example.json` to `.gembaflow-config.json` (the
     example is the schema; the actual file is gitignored so a fork's
     substituted values never propagate upstream).
   - Fill in the three substituted values:

     ```json
     {
       "org": "<your-github-org>",
       "bot": {
         "worker": "<your-worker-bot-account>",
         "reviewer": "<your-reviewer-bot-account>"
       }
     }
     ```

   - Run the substitution script:

     ```bash
     bash scripts/substitute-config-placeholders.sh
     ```

     This is idempotent — re-running after substitution completes is a no-op.
     Pass `--check` to dry-run and report any remaining unsubstituted
     placeholders without modifying files (useful as a CI smoke test for
     forks that customize `.claude/commands/`).

   - If you edit `.gembaflow-config.json` later (e.g. rotate bot accounts),
     re-run the script to apply the new values. The placeholders are gone
     from the substituted files after the first run, so the re-run only
     touches files that have been re-introduced — for example after a
     framework `/upgrade` that ships updated spec files containing fresh
     placeholders.

   - Behavior on missing config: if `.gembaflow-config.json` doesn't exist
     when the script runs, it stops with a pointer back to this section.
     Behavior on empty fields: same — fill all three before substituting.

   See [`docs/PLATFORM-GUIDE.md`](../../docs/PLATFORM-GUIDE.md) §
   "Bootstrap-time templated values" for the full convention.

## Example Backlog Generation

> Every bead MUST follow `docs/TICKET-FORMAT.md`. The example below shows the
> expected structure. Do NOT create bare-title beads without Power Sections.

From a PRD feature like:
```markdown
### MVP Features
- User authentication (email/password)
```

Create an epic:

```bash
bd create "Epic: User Authentication" --type=epic -p 0 --body-file epic-auth.md
# → created va-1a2b
```

with `epic-auth.md` containing:

```
Problem Statement:
The application has no way to identify users. All routes are public.
We need email/password authentication to gate access to user-specific data.

Scope: signup, login, password reset, session management.
```

Then create task beads with full Power Sections:

```bash
bd create "Implement email/password signup" --type=task -p 0 \
  --parent va-1a2b --labels effort:M --body-file signup.md
```

with `signup.md` containing:

```
Problem Statement:
New users cannot create accounts. We need a signup endpoint that accepts
email + password, validates input, and creates a user record.

--- A. Environment Context ---
- Stack: (from TECHNICAL-ARCHITECTURE.md)
- Existing pattern: (reference a similar route in the codebase)
- Files to create/modify: (list explicitly)

--- B. Guardrails ---
- (from AGENTIC-CONTROLS.md + PRD constraints)
- Do NOT store plaintext passwords
- Do NOT modify existing auth middleware

--- C. Happy Path ---
1. Client sends POST /auth/signup with {email, password}
2. Server validates email format and password strength
3. Server hashes password, creates user record
4. Server returns 201 with {id, email}

--- D. Definition of Done ---
- Test asserts POST /auth/signup with valid data returns 201
- Test asserts duplicate email returns 409
- Test asserts weak password returns 422
- Lint and type checks pass with zero errors
- PR reviewer can run the signup flow manually
```

(Parent epic, priority, and effort ride the `bd create` flags — `--parent`,
`-p`, `--labels effort:*` — not the body text.)

## What Gets Unlocked

After Phase 4, the full workflow is active:

```
/groom-backlog  →  Grooms beads toward readiness (bd ready is the outcome)
/work-ticket    →  Claims the next bead from bd ready
/review-pr      →  Reviews PRs for beads labeled in-review
/sprint-status  →  Board health overview from bd state
/board-refresh  →  Regenerates .gembaflow-boards/{kanban,techtree}.html
```

The boards at `.gembaflow-boards/` are read-only HTML projections of bd
state — there is no board URL to visit and nothing to configure on GitHub.

## Verification

After this phase, verify the workflow:

1. **Check the Tracker**
   - `bd list --json --limit 0` shows the created epics and tasks
   - `bd ready --json --limit 0` surfaces the intended MVP tasks
   - Open `.gembaflow-boards/kanban.html` — the beads render

2. **Check Branch Protection**
   - Go to repo Settings → Branches
   - Verify `main` is protected

3. **Test Workflow**
   ```bash
   claude
   > /sprint-status
   ```
   Should show your tracker status

## Post-Bootstrap

Your project is now ready for development!

**Daily workflow:**
```bash
/sprint-status    # Morning check
/work-ticket      # Pick up work
/review-pr        # Review PRs
```

**Weekly planning:**
```bash
/check-milestone  # Track progress
/groom-backlog    # Maintain backlog
```

## Troubleshooting

**"GitHub token not authorized"**
- Ensure token has `repo` and `workflow` scopes
- Check token isn't expired

**"Branch protection failed"**
- Verify you have admin access to repo
- Configure manually in GitHub settings

**"bd version gate FAILED"**
- The framework pins bd to one exact version (docs/BEADS.md)
- Install it: `npm install -g @beads/bd@<pin>` (the gate's error message
  prints the exact command)

**"bd init created an unexpected commit"**
- Expected: `bd init` auto-commits its scaffolding;
  `scripts/init-beads.sh` amends it to conventional form
- On a feature branch, re-run with `--no-commit` semantics in mind: the
  flag undoes the auto-commit and leaves the scaffolding uncommitted

**"Boards not regenerating"**
- The board render hook regenerates `.gembaflow-boards/` on mutating `bd`
  commands
- Force a render with `/board-refresh`; if that works but the hook doesn't
  fire, check the hook registration in `.claude/settings`

## Running This Command

1. Ensure Phases 1-3 are complete
2. Have GitHub credentials ready
3. Type `/bootstrap-workflow`
4. Provide org/repo information and the bead-ID prefix
5. Review proposed changes
6. Confirm to apply

When complete, your Gemba Flow project is fully operational!

## Next Steps

After bootstrap:

1. **Review the backlog** - `/groom-backlog`
2. **Start first ticket** - `/work-ticket`
3. **Invite team members** - Share repo access
4. **Set up CI/CD** - Configure GitHub Actions
5. **Schedule standups** - Daily `/sprint-status`

### Output Format

Report each phase with a Progress Line, then end with a Result Block:

```
→ Initialized beads tracker (prefix: va)
→ Seeded safety:* PR-label registry
→ Set up branch protection rules
→ Generated backlog from PRD (12 beads: 3 epics, 9 tasks)
→ Verified readiness (bd ready surfaces 4 tasks)

---

**Result:** Workflow setup complete
Tracker: beads (bd), prefix va
Beads created: 12 (3 epics, 9 tasks)
Ready: 4 tasks (bd ready)
Dependency check: bd dep cycles --json → []
Status: ready for development
```
