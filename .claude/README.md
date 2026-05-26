# Claude Code Configuration

This directory contains agent policies, slash commands, and settings for Claude Code projects using the Gemba Flow template.

## Directory Structure

```
.claude/
├── agents/                    # Agent policy definitions
│   ├── github-ticket-worker.md
│   ├── pr-reviewer.md
│   ├── agile-backlog-prioritizer.md
│   └── ...
├── commands/                  # Slash command definitions
│   ├── work-ticket.md
│   ├── review-pr.md
│   ├── groom-backlog.md
│   └── ...
├── settings.local.json        # Local permissions (gitignored)
├── settings.template.json     # Template for permissions setup
└── README.md                  # This file
```

## Settings Configuration

The `settings.local.json` file controls what tools and permissions agents have access to. This file should be gitignored to allow for local customization.

### Creating Your Local Settings

If you don't have a `settings.local.json` file, copy the template:

```bash
cp .claude/settings.template.json .claude/settings.local.json
```

### IMPORTANT: Security Restrictions

The template intentionally **DENIES** `Bash(gh pr merge:*)`. This enforces the trunk-based development workflow where:

- Agents can **create** PRs via `gh pr create` (github-ticket-worker)
- Agents can **review** PRs via `gh pr review` (pr-reviewer)
- Only **humans** can **merge** PRs

This separation ensures quality control and prevents accidental merges.

### Allowed Agent Capabilities

Agents CAN:
- Create and update issues
- Move issues between project board columns
- Create pull requests
- Review pull requests (comment and provide recommendations)
- Run tests and builds
- Read repository files
- Use git for branching and committing

Agents CANNOT:
- Merge pull requests (human-only)
- Push directly to main branch (protected)
- Move tickets to Done column (human-only)
- Read secret files (.env, *.key, etc.)

## Bot Accounts (Optional — for Teams)

Dedicated bot accounts provide separation of concerns and a clear audit
trail. Solo developers can use their personal GitHub account for all
operations and skip this section.

### Recommended Setup

Create two bot accounts for your organization:

### Canonical PAT Scope Set

Both bot accounts MUST be provisioned with the same classic-PAT scope set:

```
repo, workflow, project, gist, read:org
```

Rationale for each scope:

- `repo` — branches, PRs, issues
- `workflow` — required to push commits that touch `.github/workflows/*`
- `project` — board column moves and follow-up-ticket placement via `gh project item-*` / GraphQL `updateProjectV2ItemFieldValue`
- `gist` — used by some doctor/diagnostic scripts when capturing transcripts
- `read:org` — required for `gh auth status` to display org membership and for `gh api orgs/...` calls used by `verify-bot-permissions.sh`

The reviewer bot needs `project` even though it does not author PRs, because
when `/review-pr` files a follow-up issue, it also adds the issue to the
project board. Without `project` scope the `gh project item-add` call
returns 403 and the reviewer must hand off the board move to the worker.

#### Worker Bot (e.g., `{org}-worker`)

**Purpose:** Creates code changes, branches, and pull requests

**Recommended Permissions (Classic PAT):**
- `repo` — full repository access (branches, PRs, issues)
- `workflow` — push commits that touch `.github/workflows/*`
- `project` — project board access (moving tickets between columns)
- `gist` — diagnostic transcript capture
- `read:org` — org membership lookups

**Recommended Permissions (Fine-Grained PAT):**
- Contents: Read and write (for branches)
- Issues: Read and write
- Pull requests: Read and write
- Metadata: Read-only
- Projects: Read and write

**What the worker bot CAN do:**
- Create feature branches
- Push commits to feature branches
- Create pull requests
- Create and update issues
- Move issues to In Progress and In Review

**What the worker bot CANNOT do:**
- Push directly to main branch (blocked by branch protection)
- Merge pull requests (blocked by branch protection)
- Move issues to Done column (agent policy restriction)

#### Reviewer Bot (e.g., `{org}-reviewer`)

**Purpose:** Reviews pull requests and provides GO/NO-GO recommendations

**Recommended Permissions (Classic PAT):**
- `repo` — full repository access (PR reviews, approvals)
- `workflow` — symmetry with worker for review comments on workflow files
- `project` — required to file follow-up tickets to the board after a review (`gh project item-add`); without this the call returns 403
- `gist` — diagnostic transcript capture
- `read:org` — org membership lookups

**Recommended Permissions (Fine-Grained PAT):**
- Contents: Read-only
- Issues: Read and write
- Pull requests: Read and write
- Metadata: Read-only
- Projects: Read and write (required for approvals to count)

**What the reviewer bot CAN do:**
- Review pull requests
- Approve or request changes on PRs
- Comment on PRs and issues
- Read repository code

**What the reviewer bot CANNOT do:**
- Merge pull requests (agent policy restriction)
- Push to any branch
- Move issues to Done column (agent policy restriction)

### Human Workflow

The complete three-stage workflow:

```
1. Worker Bot creates feature branch and PR
         │
         ▼
2. Reviewer Bot reviews PR and provides GO/NO-GO recommendation
         │
         ▼
3. Human makes final approval decision and merges
```

This ensures:
- Bots can propose and review changes
- Humans maintain final control over merges
- Branch protection requirements are satisfied
- Clear audit trail of who did what

### PAT Storage

Bot PATs should be stored securely:

**Local Development:**
```bash
# Configure gh CLI with multiple accounts
gh auth login  # Login with your personal account
gh auth login  # Login with worker bot account
gh auth login  # Login with reviewer bot account

# Switch between accounts
gh auth switch --user {bot-username}

# Verify current account
gh auth status
```

**IMPORTANT Security Notes:**
- NEVER commit PATs to git
- NEVER log PATs in console output
- Set PAT expiration and rotate regularly
- If compromised, revoke immediately at https://github.com/settings/tokens

### Remediation: Existing reviewer PATs missing `project` scope

Reviewer PATs provisioned before this change were issued with
`gist, read:org, repo, workflow` (no `project`). Symptom: after `/review-pr`,
`gh project item-add` returns 403 and the operator has to manually
`gh auth switch --user {org}-worker` before every board-move.

To upgrade an existing reviewer PAT in-place without re-issuing:

```bash
gh auth refresh --user {org}-reviewer --scopes repo,workflow,project,gist,read:org
```

This re-runs the OAuth device flow for the existing token and adds the
missing scope. Verify with:

```bash
gh auth status --user {org}-reviewer
# Token scopes line should list: gist, project, read:org, repo, workflow
```

After remediation, the account-switch hook
(`.claude/hooks/ensure-github-account.sh`) auto-routes `gh pr review` and
`gh pr comment` to the reviewer account. Other commands — including
`gh issue create`, `gh issue comment`, and `gh project item-*` — are
intentionally NOT auto-routed, because command patterns can't reliably
distinguish worker-context ticket creation (e.g. `/create-ticket`,
`/report-issue`) from reviewer-context follow-ups. Slash commands that
need a specific account are responsible for calling
`gh auth switch --user {org}-reviewer` explicitly before filing follow-up
tickets or moving items on the board.

## Agent Policies

### github-ticket-worker

Implements tickets from the Ready column. Creates feature branches and PRs.

**Key Restrictions:**
- Can only work on tickets in Ready column
- Must create feature branches (no direct main commits)
- Cannot merge PRs
- Cannot move tickets to Done

### pr-reviewer

Reviews PRs and provides decision support for human reviewers.

**Key Restrictions:**
- Cannot review its own code
- Cannot merge PRs (provides recommendations only)
- Cannot move tickets to Done

### agile-backlog-prioritizer

Manages the product backlog and populates the Ready column.

**Key Restrictions:**
- Cannot implement tickets (only prioritizes)
- Cannot merge PRs

## Troubleshooting

**Q: Why can't agents merge PRs?**
A: This is intentional. The workflow requires human review and approval before code reaches the main branch. This is a safety feature, not a bug.

**Q: My settings.local.json is missing**
A: Copy from template: `cp .claude/settings.template.json .claude/settings.local.json`

**Q: Agent says it can't access the repository**
A: Verify the bot account is properly configured:
```bash
gh auth status
gh auth switch --user {bot-username}
gh repo view {owner}/{repo}
```

**Q: PRs aren't being attributed to the bot account**
A: Make sure to switch accounts before agent operations:
```bash
gh auth switch --user {bot-username}
```

**Q: Branch protection is blocking bot pushes**
A: Ensure the bot account has Write access to the repository and branch protection allows the bot to push to feature branches (not main).

## Related Documentation

- Main project configuration: `../CLAUDE.md`
- Getting started guide: `../docs/GETTING-STARTED.md`
