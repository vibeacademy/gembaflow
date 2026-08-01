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
- Create and update beads (`bd create`, `bd update`)
- Change bead state via `bd` (claim, label `in-review` + `pr:<N>`)
- Create pull requests
- Review pull requests (comment and provide recommendations)
- Run tests and builds
- Read repository files
- Use git for branching and committing

Agents CANNOT:
- Merge pull requests (human-only)
- Push directly to main branch (protected)
- Close beads (`bd close` is human/orchestrator-only, after merge confirmation)
- Sync beads to the remote (`bd dolt push/pull` is operator-authorized)
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
repo, workflow, gist, read:org
```

Rationale for each scope:

- `repo` — branches, PRs, issues
- `workflow` — required to push commits that touch `.github/workflows/*`
- `gist` — used by some doctor/diagnostic scripts when capturing transcripts
- `read:org` — required for `gh auth status` to display org membership and for `gh api orgs/...` calls used by `verify-bot-permissions.sh`

No `project` scope is needed: work-item tracking is beads (`bd`), which is
local and requires no GitHub auth. The only bead operation that touches the
remote is `bd dolt push/pull`, which rides the git origin using git
credentials — not a PAT scope.

#### Worker Bot (e.g., `{org}-worker`)

**Purpose:** Creates code changes, branches, and pull requests

**Recommended Permissions (Classic PAT):**
- `repo` — full repository access (branches, PRs, issues)
- `workflow` — push commits that touch `.github/workflows/*`
- `gist` — diagnostic transcript capture
- `read:org` — org membership lookups

**Recommended Permissions (Fine-Grained PAT):**
- Contents: Read and write (for branches)
- Issues: Read and write
- Pull requests: Read and write
- Metadata: Read-only

**What the worker bot CAN do:**
- Create feature branches
- Push commits to feature branches
- Create pull requests
- Claim beads and label them `in-review` + `pr:<N>` (`bd update` — local, no GitHub auth)

**What the worker bot CANNOT do:**
- Push directly to main branch (blocked by branch protection)
- Merge pull requests (blocked by branch protection)
- Close beads (`bd close` is human/orchestrator-only — agent policy restriction)

#### Reviewer Bot (e.g., `{org}-reviewer`)

**Purpose:** Reviews pull requests and provides GO/NO-GO recommendations

**Recommended Permissions (Classic PAT):**
- `repo` — full repository access (PR reviews, approvals)
- `workflow` — symmetry with worker for review comments on workflow files
- `gist` — diagnostic transcript capture
- `read:org` — org membership lookups

**Recommended Permissions (Fine-Grained PAT):**
- Contents: Read-only
- Issues: Read and write
- Pull requests: Read and write
- Metadata: Read-only

**What the reviewer bot CAN do:**
- Review pull requests
- Approve or request changes on PRs
- Comment on PRs and issues
- Read repository code

**What the reviewer bot CANNOT do:**
- Merge pull requests (agent policy restriction)
- Push to any branch
- Close beads (`bd close` is human/orchestrator-only — agent policy restriction)

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

### Remediation: reviewer PATs and the `project` scope (RESOLVED — historical)

This remediation is retired. It existed because `/review-pr` used to file
follow-up issues onto the GitHub project board (`gh project item-add`),
which required the `project` scope. The board is retired in favor of beads
(`bd`), which is local and needs no GitHub scope at all — the only bead
operation that touches the remote is `bd dolt push/pull`, which rides the
git origin using git credentials. PATs carrying a legacy `project` scope
are harmless but unnecessary; new PATs should use the canonical scope set
(`repo, workflow, gist, read:org`).

The account-switch hook (`.claude/hooks/ensure-github-account.sh`)
auto-routes `gh pr review` and `gh pr comment` to the reviewer account.
Other commands — including `gh issue create` and `gh issue comment` — are
intentionally NOT auto-routed, because command patterns can't reliably
distinguish worker-context operations (e.g. `/report-issue`) from
reviewer-context follow-ups. Slash commands that need a specific account
are responsible for calling `gh auth switch --user {org}-reviewer`
explicitly.

## Agent Policies

### github-ticket-worker

Claims ready beads (`bd ready`) and implements them. Creates feature branches and PRs.

**Key Restrictions:**
- Can only claim beads surfaced by `bd ready`
- Must create feature branches (no direct main commits)
- Cannot merge PRs
- Cannot close beads

### pr-reviewer

Reviews PRs and provides decision support for human reviewers.

**Key Restrictions:**
- Cannot review its own code
- Cannot merge PRs (provides recommendations only)
- Cannot close beads

### agile-backlog-prioritizer

Grooms the backlog to readiness (`bd ready` is the outcome).

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
