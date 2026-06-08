#!/bin/bash

# Gemba Flow Bootstrap Wizard
# Guides users through progressive refinement of project context

set -e

# Ensure this script runs under bash even if invoked as `zsh bootstrap.sh`
if [ -z "$BASH_VERSION" ]; then
    exec bash "$0" "$@"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Status file to track progress
STATUS_FILE=".claude/.bootstrap-status"

# Dual-read shim for the agile-flow → Gemba Flow env-var rebrand.
# Prefers GEMBAFLOW_*, falls back to the deprecated AGILE_FLOW_*.
# See scripts/lib/env-compat.sh for the migration policy.
BOOTSTRAP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/env-compat.sh
source "${BOOTSTRAP_DIR}/scripts/lib/env-compat.sh"

# Resolved values from the dual-read shim (prefer GEMBAFLOW_*, fall back
# to deprecated AGILE_FLOW_*). Stored in plain bash vars so the rest of
# this script (and code paths that reassign via `unset`) stays readable.
BOOTSTRAP_WORKER_ACCOUNT="$(gf_env GEMBAFLOW_WORKER_ACCOUNT AGILE_FLOW_WORKER_ACCOUNT)"
BOOTSTRAP_REVIEWER_ACCOUNT="$(gf_env GEMBAFLOW_REVIEWER_ACCOUNT AGILE_FLOW_REVIEWER_ACCOUNT)"

print_header() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}              ${BLUE}Gemba Flow Bootstrap Wizard${NC}                   ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_phase() {
    local phase=$1
    local title=$2
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Phase $phase: $title${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_step() {
    local step=$1
    local total=$2
    local desc=$3
    echo ""
    echo -e "${CYAN}--- Step $step/$total: $desc ---${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}! $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}→ $1${NC}"
}

check_phase_complete() {
    local phase=$1
    if [ -f "$STATUS_FILE" ]; then
        grep -q "^$phase:complete$" "$STATUS_FILE" 2>/dev/null && return 0
    fi
    return 1
}

mark_phase_complete() {
    local phase=$1
    mkdir -p "$(dirname "$STATUS_FILE")"
    echo "$phase:complete" >> "$STATUS_FILE"
}

get_current_phase() {
    if ! check_phase_complete "phase0"; then
        echo "0"
    elif ! check_phase_complete "phase1"; then
        echo "1"
    elif ! check_phase_complete "phase2"; then
        echo "2"
    elif ! check_phase_complete "phase3"; then
        echo "3"
    elif ! check_phase_complete "phase4"; then
        echo "4"
    else
        echo "complete"
    fi
}

show_progress() {
    echo ""
    echo -e "${CYAN}Progress:${NC}"

    if check_phase_complete "phase0"; then
        echo -e "  ${GREEN}[✓] Phase 0: Environment Setup${NC}"
    else
        echo -e "  ${YELLOW}[ ] Phase 0: Environment Setup${NC}"
    fi

    if check_phase_complete "phase1"; then
        echo -e "  ${GREEN}[✓] Phase 1: Product Definition${NC}"
    else
        echo -e "  ${YELLOW}[ ] Phase 1: Product Definition${NC}"
    fi

    if check_phase_complete "phase2"; then
        echo -e "  ${GREEN}[✓] Phase 2: Technical Architecture${NC}"
    else
        echo -e "  ${YELLOW}[ ] Phase 2: Technical Architecture${NC}"
    fi

    if check_phase_complete "phase3"; then
        echo -e "  ${GREEN}[✓] Phase 3: Agent Specialization${NC}"
    else
        echo -e "  ${YELLOW}[ ] Phase 3: Agent Specialization${NC}"
    fi

    if check_phase_complete "phase4"; then
        echo -e "  ${GREEN}[✓] Phase 4: Workflow Activation${NC}"
    else
        echo -e "  ${YELLOW}[ ] Phase 4: Workflow Activation${NC}"
    fi
    echo ""
}

# ---------------------------------------------------------------------------
#  Detect the user's shell profile file (~/.zshrc, ~/.bashrc, etc.)
# ---------------------------------------------------------------------------
detect_shell_profile() {
    if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ] || [ "$SHELL" = "/usr/bin/zsh" ]; then
        echo "$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ] || [ "$SHELL" = "/usr/bin/bash" ]; then
        if [ -f "$HOME/.bash_profile" ]; then
            echo "$HOME/.bash_profile"
        else
            echo "$HOME/.bashrc"
        fi
    else
        # Fallback: try zshrc, then bashrc
        if [ -f "$HOME/.zshrc" ]; then
            echo "$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            echo "$HOME/.bashrc"
        else
            echo "$HOME/.profile"
        fi
    fi
}

# ---------------------------------------------------------------------------
#  Persist an environment variable to the user's shell profile (idempotent)
# ---------------------------------------------------------------------------
persist_env_var() {
    local var_name=$1
    local var_value=$2
    local profile
    profile=$(detect_shell_profile)

    # Export in the current session immediately
    export "$var_name=$var_value"

    # Check whether the export line already exists in the profile
    if grep -q "^export ${var_name}=" "$profile" 2>/dev/null; then
        # Update the existing line in-place
        if [[ "$OSTYPE" == darwin* ]]; then
            sed -i '' "s|^export ${var_name}=.*|export ${var_name}=\"${var_value}\"|" "$profile"
        else
            sed -i "s|^export ${var_name}=.*|export ${var_name}=\"${var_value}\"|" "$profile"
        fi
        print_info "Updated ${var_name} in ${profile}"
    else
        {
            echo ""
            echo "# Added by Gemba Flow bootstrap"
            echo "export ${var_name}=\"${var_value}\""
        } >> "$profile"
        print_info "Added ${var_name} to ${profile}"
    fi
}

# ===========================================================================
#  Phase 0 — Environment Setup
# ===========================================================================
phase0_environment() {
    print_phase "0" "Environment Setup"

    echo ""
    echo "This phase ensures your local environment has everything Gemba Flow"
    echo "needs before we start defining your product. It covers:"
    echo "  - Required CLI tools (gh, claude)"
    echo "  - GitHub account authentication (human + bot accounts)"
    echo "  - Git identity configuration"
    echo "  - Git hooks for policy enforcement"
    echo "  - MCP server configuration for Claude Code"
    echo ""
    echo "Every step is idempotent — you can re-run this phase safely."
    echo ""

    local total_steps=9
    local failed=0

    # -----------------------------------------------------------------------
    #  Step 1: Verify gh CLI is installed
    # -----------------------------------------------------------------------
    print_step 1 $total_steps "Verify GitHub CLI (gh) is installed"

    if command -v gh &>/dev/null; then
        print_success "gh CLI found at $(command -v gh) ($(gh --version | head -1))"
    else
        print_error "gh CLI is not installed."
        echo ""
        echo "  The GitHub CLI is required to interact with issues, pull requests,"
        echo "  and project boards from the command line."
        echo ""
        echo "  Install it with one of these methods:"
        echo "    macOS:   brew install gh"
        echo "    Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
        echo "    Windows: winget install --id GitHub.cli"
        echo ""
        echo "  After installing, re-run this script."
        return 1
    fi

    # -----------------------------------------------------------------------
    #  Step 2: Verify Claude Code CLI is installed
    # -----------------------------------------------------------------------
    print_step 2 $total_steps "Verify Claude Code CLI (claude) is installed"

    if command -v claude &>/dev/null; then
        print_success "Claude Code CLI found at $(command -v claude)"
    elif [ -x "$HOME/.claude/local/claude" ]; then
        print_success "Claude Code CLI found at ~/.claude/local/claude"
        print_info "Tip: Add ~/.claude/local to your PATH for easier access."
    else
        print_error "Claude Code CLI is not installed."
        echo ""
        echo "  Claude Code is the AI coding agent that powers Gemba Flow."
        echo ""
        echo "  Install it with:"
        echo "    npm install -g @anthropic-ai/claude-code"
        echo ""
        echo "  For full instructions see:"
        echo "    https://docs.anthropic.com/en/docs/claude-code"
        echo ""
        echo "  After installing, re-run this script."
        return 1
    fi

    # -----------------------------------------------------------------------
    #  Step 3: Authenticate human GitHub account
    # -----------------------------------------------------------------------
    print_step 3 $total_steps "Authenticate your personal GitHub account"

    echo "  Your personal GitHub account is used for human actions like"
    echo "  merging pull requests and approving releases."
    echo ""

    if gh auth status &>/dev/null 2>&1; then
        local current_user
        current_user=$(gh api user --jq '.login' 2>/dev/null || echo "unknown")
        print_success "Already authenticated as: ${current_user}"
    else
        print_warning "Not currently logged in to GitHub."
        echo ""
        echo "  We will now open the GitHub login flow."
        echo "  This uses the secure device-code flow — no token pasting required."
        echo ""
        read -p "  Press Enter to start login (or 's' to skip): " login_choice
        if [[ "$login_choice" =~ ^[Ss]$ ]]; then
            print_warning "Skipped human account login. You can run 'gh auth login' later."
        else
            gh auth login --web --git-protocol https || {
                print_error "Login failed. You can retry with: gh auth login"
                return 1
            }
            print_success "Human account authenticated."
        fi
    fi

    # -----------------------------------------------------------------------
    #  Step 4: Authenticate worker bot account
    # -----------------------------------------------------------------------
    print_step 4 $total_steps "Authenticate worker bot account"

    echo "  Gemba Flow uses a separate GitHub bot account for automated work"
    echo "  (creating branches, opening PRs, pushing code). This keeps the"
    echo "  human commit history clean and makes bot actions easy to audit."
    echo ""

    if [ -n "$BOOTSTRAP_WORKER_ACCOUNT" ]; then
        print_success "Worker account already configured: ${BOOTSTRAP_WORKER_ACCOUNT}"
        echo ""
        read -p "  Keep this account? (Y/n): " keep_worker
        if [[ "$keep_worker" =~ ^[Nn]$ ]]; then
            BOOTSTRAP_WORKER_ACCOUNT=""
            unset GEMBAFLOW_WORKER_ACCOUNT AGILE_FLOW_WORKER_ACCOUNT
        fi
    fi

    if [ -z "$BOOTSTRAP_WORKER_ACCOUNT" ]; then
        echo "  The worker bot account should follow the naming convention:"
        echo "    {org}-worker   (e.g. acme-worker)"
        echo ""
        read -p "  Enter your org prefix (the part before -worker): " org_prefix
        if [ -z "$org_prefix" ]; then
            print_error "Org prefix cannot be empty."
            return 1
        fi

        local worker_account="${org_prefix}-worker"
        echo ""
        echo "  Worker account will be: ${worker_account}"
        echo ""
        echo "  You now need to authenticate as ${worker_account}."
        echo "  If you have a Personal Access Token (PAT) for this account,"
        echo "  choose 'Paste an authentication token' when prompted."
        echo ""
        read -p "  Press Enter to authenticate ${worker_account} (or 's' to skip): " worker_login
        if [[ "$worker_login" =~ ^[Ss]$ ]]; then
            print_warning "Skipped worker account login."
            print_info "Set it manually later: export GEMBAFLOW_WORKER_ACCOUNT=${worker_account}"
        else
            echo ""
            print_info "Logging in as ${worker_account}..."
            echo "  When prompted, select 'Paste an authentication token' and use"
            echo "  the PAT for the ${worker_account} account."
            echo ""
            gh auth login --git-protocol https || {
                print_error "Worker account login failed."
                echo "  You can retry later with: gh auth login"
                return 1
            }
            persist_env_var "GEMBAFLOW_WORKER_ACCOUNT" "$worker_account"
            BOOTSTRAP_WORKER_ACCOUNT="$worker_account"
            print_success "Worker account set: ${worker_account}"

            # Verify project scope on worker account
            print_info "Verifying PAT scopes for ${worker_account}..."
            if gh project list --limit 1 &>/dev/null 2>&1; then
                print_success "Worker PAT has 'project' scope."
            else
                print_warning "Worker PAT may be missing the 'project' scope."
                echo "  Board operations (moving tickets between columns) require"
                echo "  the 'project' scope on a classic PAT, or the 'Projects'"
                echo "  permission on a fine-grained PAT."
                echo "  Re-create the PAT at https://github.com/settings/tokens"
                echo "  and check 'repo', 'project', and 'workflow'."
            fi
        fi
    fi

    # -----------------------------------------------------------------------
    #  Step 5: Authenticate reviewer bot account
    # -----------------------------------------------------------------------
    print_step 5 $total_steps "Authenticate reviewer bot account"

    echo "  The reviewer bot account is used for automated code reviews."
    echo "  Keeping it separate from the worker prevents an agent from"
    echo "  approving its own pull requests."
    echo ""

    if [ -n "$BOOTSTRAP_REVIEWER_ACCOUNT" ]; then
        print_success "Reviewer account already configured: ${BOOTSTRAP_REVIEWER_ACCOUNT}"
        echo ""
        read -p "  Keep this account? (Y/n): " keep_reviewer
        if [[ "$keep_reviewer" =~ ^[Nn]$ ]]; then
            BOOTSTRAP_REVIEWER_ACCOUNT=""
            unset GEMBAFLOW_REVIEWER_ACCOUNT AGILE_FLOW_REVIEWER_ACCOUNT
        fi
    fi

    if [ -z "$BOOTSTRAP_REVIEWER_ACCOUNT" ]; then
        # Derive from worker account if available
        local reviewer_account=""
        if [ -n "$BOOTSTRAP_WORKER_ACCOUNT" ]; then
            local org_from_worker="${BOOTSTRAP_WORKER_ACCOUNT%-worker}"
            reviewer_account="${org_from_worker}-reviewer"
            echo "  Based on your worker account, the reviewer account would be:"
            echo "    ${reviewer_account}"
            echo ""
            read -p "  Use ${reviewer_account}? (Y/n): " use_derived
            if [[ "$use_derived" =~ ^[Nn]$ ]]; then
                reviewer_account=""
            fi
        fi

        if [ -z "$reviewer_account" ]; then
            echo "  The reviewer bot account follows the naming convention:"
            echo "    {org}-reviewer   (e.g. acme-reviewer)"
            echo ""
            read -p "  Enter the full reviewer account name: " reviewer_account
            if [ -z "$reviewer_account" ]; then
                print_error "Reviewer account name cannot be empty."
                return 1
            fi
        fi

        echo ""
        echo "  You now need to authenticate as ${reviewer_account}."
        echo ""
        read -p "  Press Enter to authenticate ${reviewer_account} (or 's' to skip): " reviewer_login
        if [[ "$reviewer_login" =~ ^[Ss]$ ]]; then
            print_warning "Skipped reviewer account login."
            print_info "Set it manually later: export GEMBAFLOW_REVIEWER_ACCOUNT=${reviewer_account}"
        else
            echo ""
            print_info "Logging in as ${reviewer_account}..."
            echo "  When prompted, select 'Paste an authentication token' and use"
            echo "  the PAT for the ${reviewer_account} account."
            echo ""
            gh auth login --git-protocol https || {
                print_error "Reviewer account login failed."
                echo "  You can retry later with: gh auth login"
                return 1
            }
            persist_env_var "GEMBAFLOW_REVIEWER_ACCOUNT" "$reviewer_account"
            BOOTSTRAP_REVIEWER_ACCOUNT="$reviewer_account"
            print_success "Reviewer account set: ${reviewer_account}"

            # Verify project scope on reviewer account
            print_info "Verifying PAT scopes for ${reviewer_account}..."
            if gh project list --limit 1 &>/dev/null 2>&1; then
                print_success "Reviewer PAT has 'project' scope."
            else
                print_warning "Reviewer PAT may be missing the 'project' scope."
                echo "  Board operations require the 'project' scope on a classic"
                echo "  PAT, or the 'Projects' permission on a fine-grained PAT."
                echo "  Re-create the PAT at https://github.com/settings/tokens"
                echo "  and check 'repo', 'project', and 'workflow'."
            fi
        fi
    fi

    # -----------------------------------------------------------------------
    #  Step 6: Verify all three accounts with gh auth status
    # -----------------------------------------------------------------------
    print_step 6 $total_steps "Verify GitHub authentication"

    echo "  Checking that gh can reach GitHub..."
    echo ""
    if gh auth status &>/dev/null 2>&1; then
        gh auth status 2>&1 | while IFS= read -r line; do echo "    $line"; done
        echo ""
        print_success "GitHub authentication verified."
    else
        print_warning "gh auth status reported issues. This is not fatal if you"
        print_warning "skipped some account logins above — you can fix it later."
    fi

    # Re-read after persist_env_var (which exports in the current shell)
    # so the summary reflects what was just configured. Use the shim
    # so an existing AGILE_FLOW_* still surfaces (with the deprecation
    # warning already printed at script start).
    local worker_now reviewer_now worker_src reviewer_src
    worker_now="$(gf_env GEMBAFLOW_WORKER_ACCOUNT AGILE_FLOW_WORKER_ACCOUNT)"
    reviewer_now="$(gf_env GEMBAFLOW_REVIEWER_ACCOUNT AGILE_FLOW_REVIEWER_ACCOUNT)"
    worker_src="$(gf_env_source_label GEMBAFLOW_WORKER_ACCOUNT AGILE_FLOW_WORKER_ACCOUNT)"
    reviewer_src="$(gf_env_source_label GEMBAFLOW_REVIEWER_ACCOUNT AGILE_FLOW_REVIEWER_ACCOUNT)"

    if [ -n "$worker_now" ]; then
        print_success "Worker account = ${worker_now} (from ${worker_src})"
    else
        print_warning "GEMBAFLOW_WORKER_ACCOUNT is not set."
    fi

    if [ -n "$reviewer_now" ]; then
        print_success "Reviewer account = ${reviewer_now} (from ${reviewer_src})"
    else
        print_warning "GEMBAFLOW_REVIEWER_ACCOUNT is not set."
    fi

    # -----------------------------------------------------------------------
    #  Step 7: Configure git identity
    # -----------------------------------------------------------------------
    print_step 7 $total_steps "Configure git identity"

    echo "  Git needs a name and email for commits. We will set them globally"
    echo "  if they are not already configured."
    echo ""

    local git_name
    local git_email
    git_name=$(git config --global user.name 2>/dev/null || true)
    git_email=$(git config --global user.email 2>/dev/null || true)

    if [ -n "$git_name" ]; then
        print_success "git user.name already set: ${git_name}"
    else
        read -p "  Enter your full name for git commits: " input_name
        if [ -z "$input_name" ]; then
            print_error "Name cannot be empty."
            return 1
        fi
        git config --global user.name "$input_name"
        print_success "git user.name set to: ${input_name}"
    fi

    if [ -n "$git_email" ]; then
        print_success "git user.email already set: ${git_email}"
    else
        read -p "  Enter your email for git commits: " input_email
        if [ -z "$input_email" ]; then
            print_error "Email cannot be empty."
            return 1
        fi
        git config --global user.email "$input_email"
        print_success "git user.email set to: ${input_email}"
    fi

    # -----------------------------------------------------------------------
    #  Step 8: Set up pre-push hook
    # -----------------------------------------------------------------------
    print_step 8 $total_steps "Set up pre-push git hook"

    echo "  Gemba Flow ships a pre-push hook in scripts/hooks/ that enforces"
    echo "  agent policies before code reaches the remote. We point git at"
    echo "  that directory so the hook runs automatically."
    echo ""

    local current_hooks_path
    current_hooks_path=$(git config --local core.hooksPath 2>/dev/null || true)

    if [ "$current_hooks_path" = "scripts/hooks" ]; then
        print_success "core.hooksPath already set to scripts/hooks"
    else
        if [ -n "$current_hooks_path" ]; then
            print_warning "core.hooksPath is currently: ${current_hooks_path}"
            read -p "  Overwrite with scripts/hooks? (Y/n): " overwrite_hooks
            if [[ "$overwrite_hooks" =~ ^[Nn]$ ]]; then
                print_info "Keeping existing hooksPath."
            else
                git config --local core.hooksPath scripts/hooks
                print_success "core.hooksPath updated to scripts/hooks"
            fi
        else
            git config --local core.hooksPath scripts/hooks
            print_success "core.hooksPath set to scripts/hooks"
        fi
    fi

    # Verify the hook file exists
    if [ -f "scripts/hooks/pre-push" ]; then
        print_success "pre-push hook file exists"
        if [ -x "scripts/hooks/pre-push" ]; then
            print_success "pre-push hook is executable"
        else
            chmod +x scripts/hooks/pre-push
            print_success "Made pre-push hook executable"
        fi
    else
        print_warning "scripts/hooks/pre-push not found."
        print_info "The hook will be created during Phase 3 (Agent Specialization)."
    fi

    # -----------------------------------------------------------------------
    #  Step 9: Smoke test
    # -----------------------------------------------------------------------
    print_step 9 $total_steps "Smoke test"

    echo "  Running a quick check to make sure everything hangs together."
    echo ""

    local smoke_pass=true

    # 9a: Is this a git repo?
    if git rev-parse --is-inside-work-tree &>/dev/null; then
        print_success "This directory is a git repository."
    else
        print_error "This directory is NOT a git repository."
        echo "  Run 'git init' and then re-run this script."
        smoke_pass=false
    fi

    # 9b: Does the hook exist?
    local effective_hooks
    effective_hooks=$(git config --local core.hooksPath 2>/dev/null || echo ".git/hooks")
    if [ -f "${effective_hooks}/pre-push" ]; then
        print_success "Pre-push hook found at ${effective_hooks}/pre-push"
    else
        print_warning "Pre-push hook not found at ${effective_hooks}/pre-push"
        print_info "This is OK if you have not created it yet."
    fi

    # 9c: Can gh access the repo?
    local remote_url
    remote_url=$(git remote get-url origin 2>/dev/null || true)
    if [ -n "$remote_url" ]; then
        # Try to extract owner/repo from the remote URL
        local repo_slug
        repo_slug=$(echo "$remote_url" | sed -E 's#(https://github\.com/|git@github\.com:)##' | sed 's/\.git$//')
        if [ -n "$repo_slug" ]; then
            if gh repo view "$repo_slug" &>/dev/null 2>&1; then
                print_success "gh can access the remote repository: ${repo_slug}"
            else
                print_warning "gh could not access ${repo_slug}."
                print_info "This may be fine if the repo is private and you skipped login."
            fi
        else
            print_warning "Could not parse repo slug from remote URL: ${remote_url}"
        fi
    else
        print_warning "No git remote 'origin' configured."
        print_info "Add one with: git remote add origin <url>"
    fi

    # -----------------------------------------------------------------------
    #  Create or validate .mcp.json
    # -----------------------------------------------------------------------
    echo ""
    print_info "Checking MCP server configuration..."

    local mcp_needs_create=false

    if [ -f ".mcp.json" ]; then
        # Validate that required servers are present
        local mcp_valid=true
        if ! grep -q '"memory"' .mcp.json 2>/dev/null; then
            print_warning ".mcp.json is missing the 'memory' server (required)."
            mcp_valid=false
        fi

        if [ "$mcp_valid" = true ]; then
            print_success ".mcp.json exists with required servers (memory)."
        else
            echo ""
            echo "  Your .mcp.json appears to be stale or incomplete."
            read -p "  Reset to defaults? A backup will be saved to .mcp.json.bak (Y/n): " reset_mcp
            if [[ ! "$reset_mcp" =~ ^[Nn]$ ]]; then
                cp .mcp.json .mcp.json.bak
                print_info "Backed up existing .mcp.json to .mcp.json.bak"
                mcp_needs_create=true
            else
                print_warning "Keeping existing .mcp.json. Add missing servers manually."
            fi
        fi
    else
        mcp_needs_create=true
    fi

    if [ "$mcp_needs_create" = true ]; then
        if [ -f ".claude/settings.template.json" ]; then
            print_warning ".mcp.json not found or being reset."
            echo ""
            echo "  Gemba Flow uses MCP (Model Context Protocol) servers to give"
            echo "  Claude Code access to GitHub, memory, and other integrations."
            echo ""
            print_info "Creating .mcp.json with default MCP servers..."

            cat > .mcp.json << 'MCPEOF'
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
MCPEOF
            print_success "Created .mcp.json with default MCP servers."
        else
            print_warning ".claude/settings.template.json not found — skipping .mcp.json creation."
            print_info "You can create .mcp.json manually. See Claude Code docs for format."
        fi
    fi

    # -----------------------------------------------------------------------
    #  MCP token and server guidance
    # -----------------------------------------------------------------------
    echo ""
    echo "  MCP Server Reference:"
    echo ""
    echo "  Server                Required?   Token Needed"
    echo "  ────────────────────  ─────────   ────────────────────────────────"
    echo "  memory                REQUIRED    none"
    echo "  sequential-thinking   optional    none"
    echo ""
    echo "  GitHub operations use the gh CLI (authenticated in Steps 3-5 above)."
    echo ""

    # -----------------------------------------------------------------------
    #  Summary
    # -----------------------------------------------------------------------
    echo ""
    if [ "$smoke_pass" = true ]; then
        print_success "Environment setup complete."
        mark_phase_complete "phase0"
    else
        print_error "Some smoke tests failed. Please fix the issues above and re-run."
        return 1
    fi
}

# ===========================================================================
#  Phase 1 — Product Definition
# ===========================================================================
phase1_product() {
    print_phase "1" "Product Definition"

    if ! check_phase_complete "phase0"; then
        print_error "Phase 0 (Environment Setup) must be completed first"
        return 1
    fi

    echo ""
    echo "This phase creates your Product Requirements Document (PRD)."
    echo "The Product Manager agent will help you define:"
    echo "  - Product vision and goals"
    echo "  - Target audience"
    echo "  - Core features and priorities"
    echo "  - Success metrics"
    echo "  - Initial roadmap"
    echo ""

    if [ -f "docs/PRODUCT-REQUIREMENTS.md" ]; then
        print_warning "docs/PRODUCT-REQUIREMENTS.md already exists"
        read -p "Overwrite? (y/N): " overwrite
        if [[ ! $overwrite =~ ^[Yy]$ ]]; then
            print_info "Keeping existing PRD"
            mark_phase_complete "phase1"
            return 0
        fi
    fi

    echo ""
    print_info "Starting Claude Code with /bootstrap-product command..."
    echo ""
    echo -e "${CYAN}In Claude Code, run:${NC}"
    echo -e "${GREEN}  /bootstrap-product${NC}"
    echo ""
    echo "Follow the prompts to define your product."
    echo ""

    read -p "Press Enter when Phase 1 is complete..."

    if [ -f "docs/PRODUCT-REQUIREMENTS.md" ] && [ -f "docs/PRODUCT-ROADMAP.md" ]; then
        mark_phase_complete "phase1"
        print_success "Phase 1 complete! PRD and Roadmap created."
    else
        print_error "PRD or Roadmap not found. Please complete Phase 1."
        return 1
    fi
}

# ===========================================================================
#  Phase 2 — Technical Architecture
# ===========================================================================
phase2_architecture() {
    print_phase "2" "Technical Architecture"

    if ! check_phase_complete "phase1"; then
        print_error "Phase 1 (Product Definition) must be completed first"
        return 1
    fi

    echo ""
    echo "This phase defines your technical architecture."
    echo "The System Architect agent will help you define:"
    echo "  - Technology stack"
    echo "  - System design and components"
    echo "  - Data models"
    echo "  - API contracts"
    echo "  - Infrastructure approach"
    echo ""
    echo "The architect will reference your PRD to ensure alignment."
    echo ""

    if [ -f "docs/TECHNICAL-ARCHITECTURE.md" ]; then
        print_warning "docs/TECHNICAL-ARCHITECTURE.md already exists"
        read -p "Overwrite? (y/N): " overwrite
        if [[ ! $overwrite =~ ^[Yy]$ ]]; then
            print_info "Keeping existing architecture"
            mark_phase_complete "phase2"
            return 0
        fi
    fi

    echo ""
    print_info "Starting Claude Code with /bootstrap-architecture command..."
    echo ""
    echo -e "${CYAN}In Claude Code, run:${NC}"
    echo -e "${GREEN}  /bootstrap-architecture${NC}"
    echo ""
    echo "Follow the prompts to define your architecture."
    echo ""

    read -p "Press Enter when Phase 2 is complete..."

    if [ -f "docs/TECHNICAL-ARCHITECTURE.md" ]; then
        mark_phase_complete "phase2"
        print_success "Phase 2 complete! Technical architecture defined."
    else
        print_error "Architecture document not found. Please complete Phase 2."
        return 1
    fi
}

# ===========================================================================
#  Phase 3 — Agent Specialization
# ===========================================================================
phase3_agents() {
    print_phase "3" "Agent Specialization"

    if ! check_phase_complete "phase2"; then
        print_error "Phase 2 (Technical Architecture) must be completed first"
        return 1
    fi

    echo ""
    echo "This phase specializes agents with your project context."
    echo "Based on your PRD and architecture, agents will be updated with:"
    echo "  - Project-specific tech stack"
    echo "  - Coding standards and conventions"
    echo "  - Testing requirements"
    echo "  - Architecture patterns to follow"
    echo ""
    echo "This makes agents give project-specific guidance instead of generic advice."
    echo ""

    print_info "Starting Claude Code with /bootstrap-agents command..."
    echo ""
    echo -e "${CYAN}In Claude Code, run:${NC}"
    echo -e "${GREEN}  /bootstrap-agents${NC}"
    echo ""
    echo "The agents will be updated with your project context."
    echo ""

    read -p "Press Enter when Phase 3 is complete..."

    mark_phase_complete "phase3"
    print_success "Phase 3 complete! Agents specialized for your project."
}

# ===========================================================================
#  Phase 4 — Workflow Activation
# ===========================================================================
phase4_workflow() {
    print_phase "4" "Workflow Activation"

    if ! check_phase_complete "phase3"; then
        print_error "Phase 3 (Agent Specialization) must be completed first"
        return 1
    fi

    echo ""
    echo "This phase activates the development workflow."
    echo "This includes:"
    echo "  - Verifying GitHub project board setup"
    echo "  - Checking branch protection configuration"
    echo "  - Creating initial backlog from PRD features"
    echo "  - Populating Ready column with first tickets"
    echo ""

    print_info "Starting Claude Code with /bootstrap-workflow command..."
    echo ""
    echo -e "${CYAN}In Claude Code, run:${NC}"
    echo -e "${GREEN}  /bootstrap-workflow${NC}"
    echo ""
    echo "Follow the prompts to activate your workflow."
    echo ""

    read -p "Press Enter when Phase 4 is complete..."

    # -------------------------------------------------------------------
    #  Ensure branch protection exists on main (idempotent)
    # -------------------------------------------------------------------
    echo ""
    print_info "Checking branch protection on main..."

    local remote_url
    remote_url=$(git remote get-url origin 2>/dev/null || true)
    if [ -n "$remote_url" ]; then
        local repo_slug
        repo_slug=$(echo "$remote_url" | sed -E 's#(https://github\.com/|git@github\.com:)##' | sed 's/\.git$//')

        if [ -n "$repo_slug" ]; then
            # Check for existing rulesets that protect main
            local existing_rulesets
            existing_rulesets=$(gh api "repos/${repo_slug}/rulesets" --jq 'length' 2>/dev/null || echo "0")

            if [ "$existing_rulesets" -gt 0 ] 2>/dev/null; then
                print_success "Repository has ${existing_rulesets} ruleset(s) — branch protection likely configured."
            else
                print_info "No rulesets found. Creating branch protection ruleset for main..."
                if gh api "repos/${repo_slug}/rulesets" \
                    --method POST \
                    --field name="Protect main" \
                    --field target="branch" \
                    --field enforcement="active" \
                    --field 'conditions[ref_name][include][]=refs/heads/main' \
                    --field 'conditions[ref_name][exclude][]=' \
                    --field 'rules[][type]=pull_request' \
                    --field 'rules[][type]=required_status_checks' \
                    &>/dev/null 2>&1; then
                    print_success "Branch protection ruleset created for main."
                else
                    print_warning "Could not create ruleset automatically."
                    echo "  You may not have admin permissions, or the repo may be on"
                    echo "  a plan that does not support rulesets via API."
                    echo ""
                    echo "  Manual fallback — go to your repo on GitHub:"
                    echo "    Settings > Rules > Rulesets > New ruleset"
                    echo "    - Name: Protect main"
                    echo "    - Target: main branch"
                    echo "    - Rules: Require pull request, Require status checks"
                fi
            fi
        fi
    else
        print_warning "No git remote — skipping branch protection check."
    fi

    mark_phase_complete "phase4"
    print_success "Phase 4 complete! Workflow activated."

    # Stamp installedAt AND set version to the latest upstream release tag on
    # first install. Without this, every fresh fork starts at the placeholder
    # "version": "0.1.0" and the first /upgrade generates a no-op sync PR (#381).
    local af_manifest=".gembaflow-version"
    if [ -f "$af_manifest" ]; then
        local current_val
        current_val=$(jq -r '.installedAt // "null"' "$af_manifest" 2>/dev/null)
        if [ "$current_val" = "null" ]; then
            local timestamp
            timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

            # Look up the latest release tag from the upstream repo. The
            # `upstream` field accepts either a bare "owner/repo" or a full
            # GitHub URL (https or git@); normalize both forms.
            local upstream
            upstream=$(jq -r '.upstream // empty' "$af_manifest" 2>/dev/null \
                | sed -e 's|^https://github.com/||' \
                      -e 's|^http://github.com/||' \
                      -e 's|^git@github.com:||' \
                      -e 's|\.git$||' \
                      -e 's|/$||')
            [ -z "$upstream" ] && upstream="vibeacademy/gembaflow"

            local latest_version=""
            if command -v gh >/dev/null 2>&1; then
                latest_version=$(gh release view --repo "$upstream" --json tagName --jq '.tagName | sub("^v"; "")' 2>/dev/null || echo "")
            fi

            if [ -n "$latest_version" ]; then
                jq --arg ts "$timestamp" --arg ver "$latest_version" \
                    '.installedAt = $ts | .version = $ver' "$af_manifest" > "$af_manifest.tmp" \
                    && mv "$af_manifest.tmp" "$af_manifest"
                print_success "Stamped install time: $timestamp; version: $latest_version"
            else
                # Fallback: stamp installedAt only. Template-sync.sh's
                # placeholder short-circuit will fix version on next /upgrade.
                jq --arg ts "$timestamp" '.installedAt = $ts' "$af_manifest" > "$af_manifest.tmp" \
                    && mv "$af_manifest.tmp" "$af_manifest"
                print_warning "Could not look up latest release from $upstream; version field unchanged. Run /upgrade to sync."
            fi
        fi
    fi

    # -------------------------------------------------------------------
    #  Assistant mode selection (#406)
    #  Idempotent: if a mode is already set in either settings.json or
    #  mode.local, skip without overwriting.
    # -------------------------------------------------------------------
    echo ""
    print_info "Assistant mode selection..."
    local settings_file=".claude/settings.json"
    local mode_local=".claude/mode.local"
    local existing_settings_mode=""
    local existing_local_mode=""
    if [ -f "$settings_file" ] && command -v jq >/dev/null 2>&1; then
        existing_settings_mode=$(jq -r '.assistantMode // empty' "$settings_file" 2>/dev/null)
    fi
    if [ -f "$mode_local" ]; then
        existing_local_mode=$(tr -d '[:space:]' < "$mode_local")
    fi

    if [ -n "$existing_settings_mode" ] || [ -n "$existing_local_mode" ]; then
        if [ -n "$existing_settings_mode" ]; then
            print_success "Mode already set in settings.json: ${existing_settings_mode} — leaving as-is."
        fi
        if [ -n "$existing_local_mode" ]; then
            print_success "Local mode override already set: ${existing_local_mode} — leaving as-is."
        fi
    else
        echo ""
        echo "The main Claude session can run in one of several modes that bias"
        echo "its tone and verbosity. Sub-agents are unaffected. Available modes:"
        echo ""
        if [ -d ".claude/modes" ]; then
            for mode_file in .claude/modes/*.md; do
                [ -f "$mode_file" ] || continue
                local mode_name="${mode_file##*/}"
                mode_name="${mode_name%.md}"
                [ "$mode_name" = "README" ] && continue
                local headline
                headline=$(awk '/^## Headline behavior/{getline; while(/^$/)getline; print; exit}' "$mode_file")
                printf "  - %-16s %s\n" "$mode_name" "$headline"
            done
        fi
        echo ""
        echo "You can set the mode for the whole team (committed to"
        echo ".claude/settings.json) or just for yourself on this machine"
        echo "(written to .claude/mode.local, which is gitignored)."
        echo ""
        read -p "Mode name (or press Enter to skip and use 'default'): " selected_mode
        if [ -n "$selected_mode" ]; then
            if [ ! -f ".claude/modes/${selected_mode}.md" ]; then
                print_warning "Unknown mode: ${selected_mode}. Skipping. Run /mode list later to see options."
            else
                read -p "Set this for [t]eam (settings.json) or just [p]ersonal (mode.local)? [t/p]: " mode_scope
                case "$mode_scope" in
                    t|T)
                        if [ -f "$settings_file" ] && command -v jq >/dev/null 2>&1; then
                            jq --arg m "$selected_mode" '.assistantMode = $m' "$settings_file" \
                                > "$settings_file.tmp" && mv "$settings_file.tmp" "$settings_file"
                            print_success "Set assistantMode='${selected_mode}' in $settings_file (team-shared)."
                        else
                            print_warning "$settings_file not found or jq unavailable; falling back to mode.local."
                            echo "$selected_mode" > "$mode_local"
                            print_success "Wrote mode '${selected_mode}' to $mode_local."
                        fi
                        ;;
                    p|P|*)
                        echo "$selected_mode" > "$mode_local"
                        print_success "Wrote mode '${selected_mode}' to $mode_local (personal, gitignored)."
                        ;;
                esac
            fi
        else
            print_info "No mode selected; main session will use 'default' behavior."
        fi
    fi
}

# ===========================================================================
#  Completion screen
# ===========================================================================
show_completion() {
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}            ${GREEN}Bootstrap Complete!${NC}                              ${GREEN}║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Your Gemba Flow project is ready for development!"
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo "  1. Start Claude Code: ${GREEN}claude${NC}"
    echo "  2. Check board status: ${GREEN}/sprint-status${NC}"
    echo "  3. Pick up first ticket: ${GREEN}/work-ticket${NC}"
    echo ""
    echo -e "${CYAN}Available commands:${NC}"
    echo "  /groom-backlog     - Manage and prioritize backlog"
    echo "  /work-ticket       - Implement next ticket"
    echo "  /review-pr         - Review pull requests"
    echo "  /check-milestone   - Track milestone progress"
    echo "  /evaluate-feature  - Assess feature requests"
    echo "  /release-decision  - Go/no-go for releases"
    echo "  /mode              - Select main-session assistant mode"
    echo ""
    echo -e "${CYAN}Documentation:${NC}"
    echo "  - CLAUDE.md - Project configuration"
    echo "  - docs/PRODUCT-REQUIREMENTS.md - Your PRD"
    echo "  - docs/PRODUCT-ROADMAP.md - Your roadmap"
    echo "  - docs/TECHNICAL-ARCHITECTURE.md - Your architecture"
    echo ""
    local af_version="unknown"
    local af_manifest=".gembaflow-version"
    if [ -f "$af_manifest" ]; then
        af_version=$(jq -r '.version // "unknown"' "$af_manifest" 2>/dev/null)
    fi
    echo -e "Powered by ${CYAN}Gemba Flow${NC} v${af_version} — https://github.com/vibeacademy/gembaflow"
    echo ""
}

# ===========================================================================
#  Phase dispatcher
# ===========================================================================
run_phase() {
    local phase=$1
    case $phase in
        0) phase0_environment ;;
        1) phase1_product ;;
        2) phase2_architecture ;;
        3) phase3_agents ;;
        4) phase4_workflow ;;
        *) print_error "Unknown phase: $phase" ;;
    esac
}

# ===========================================================================
#  Main entry point
# ===========================================================================
main() {
    print_header

    # Check if running in a git repo
    if [ ! -d ".git" ]; then
        print_warning "Not a git repository. Initialize with 'git init' first."
        read -p "Initialize git now? (Y/n): " init_git
        if [[ ! $init_git =~ ^[Nn]$ ]]; then
            git init
            print_success "Git repository initialized"
        fi
    fi

    # Create docs directory if it doesn't exist
    mkdir -p docs

    show_progress

    current=$(get_current_phase)

    if [ "$current" == "complete" ]; then
        show_completion
        exit 0
    fi

    echo -e "${CYAN}Current phase: $current${NC}"
    echo ""

    # Option to skip to specific phase or continue
    echo "Options:"
    echo "  [Enter] Continue with Phase $current"
    echo "  [0-4]   Jump to specific phase"
    echo "  [r]     Reset and start over"
    echo "  [q]     Quit"
    echo ""
    read -p "Choice: " choice

    case $choice in
        ""|" ")
            run_phase $current
            ;;
        [0-4])
            run_phase $choice
            ;;
        r|R)
            rm -f "$STATUS_FILE"
            print_info "Progress reset. Starting from Phase 0."
            run_phase 0
            ;;
        q|Q)
            print_info "Exiting. Run 'bash bootstrap.sh' to continue later."
            exit 0
            ;;
        *)
            print_error "Invalid choice"
            exit 1
            ;;
    esac

    # Continue to next phases
    while true; do
        current=$(get_current_phase)
        if [ "$current" == "complete" ]; then
            show_completion
            exit 0
        fi

        echo ""
        read -p "Continue to Phase $current? (Y/n): " cont
        if [[ $cont =~ ^[Nn]$ ]]; then
            print_info "Pausing. Run 'bash bootstrap.sh' to continue later."
            exit 0
        fi

        run_phase $current
    done
}

# Run main function
main "$@"
