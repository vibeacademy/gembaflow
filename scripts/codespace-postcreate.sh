#!/bin/bash
# scripts/codespace-postcreate.sh — Codespaces postCreate orchestrator.
#
# Replaces the silent `[ -f scripts/setup-solo-mode.sh ] && bash …; uv sync …`
# compound that previously lived in `.devcontainer/devcontainer.json`. Runs
# on every Codespace create AND rebuild — must be idempotent and
# non-interactive. Fail-tolerant on non-blocking warnings; surfaces those
# via WELCOME.md so the operator sees them on first VS Code load.

# Intentionally not using `set -e` — we want to continue past non-fatal
# failures and accumulate warnings into WELCOME.md.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/version-stamp.sh
source "${SCRIPT_DIR}/lib/version-stamp.sh"

WELCOME="WELCOME.md"
WARNINGS=""

note_warning() {
    WARNINGS+="- $1"$'\n'
}

GITHUB_USER="${GITHUB_USER:-}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"

# ---------------------------------------------------------------------------
# git identity — name from $GITHUB_USER; email via post-2017 noreply form
# (`{id}+{login}@users.noreply.github.com`) so commits link back to the
# operator's GitHub profile.
# ---------------------------------------------------------------------------
if [ -n "$GITHUB_USER" ] && [ -z "$(git config --global user.name 2>/dev/null)" ]; then
    git config --global user.name "$GITHUB_USER" 2>/dev/null || true
fi

if [ -z "$(git config --global user.email 2>/dev/null)" ]; then
    if command -v gh >/dev/null 2>&1; then
        noreply=$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"' 2>/dev/null || echo "")
        if [ -n "$noreply" ]; then
            git config --global user.email "$noreply" 2>/dev/null || true
        elif [ -n "$GITHUB_USER" ]; then
            git config --global user.email "${GITHUB_USER}@users.noreply.github.com" 2>/dev/null || true
            note_warning "git user.email set with pre-2017 noreply form (gh api user did not return id); commits may not link back to your GitHub profile."
        fi
    fi
fi

# ---------------------------------------------------------------------------
# local git hooks — point at .githooks/ if present
# ---------------------------------------------------------------------------
if [ -d ".githooks" ]; then
    git config --local core.hooksPath .githooks 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# .mcp.json — copy from .mcp.example.json if missing
# ---------------------------------------------------------------------------
if [ ! -f ".mcp.json" ]; then
    if [ -f ".mcp.example.json" ]; then
        cp ".mcp.example.json" ".mcp.json"
    else
        note_warning ".mcp.example.json not found in template; .mcp.json not created. Run /bootstrap to set it up."
    fi
fi

# ---------------------------------------------------------------------------
# .gembaflow-version installedAt + version stamp (idempotent; only on first boot)
# ---------------------------------------------------------------------------
gembaflow_version_stamp
case $? in
    1)
        note_warning "version stamp deferred — \`gh release view\` could not reach upstream. Run \`/upgrade\` after \`/bootstrap\` to sync."
        ;;
esac

# ---------------------------------------------------------------------------
# .gembaflow-config.json — infer org/repo from $GITHUB_REPOSITORY; solo_mode default
# ---------------------------------------------------------------------------
if [ ! -f ".gembaflow-config.json" ] && [ -n "$GITHUB_REPOSITORY" ]; then
    org="${GITHUB_REPOSITORY%/*}"
    repo="${GITHUB_REPOSITORY#*/}"
    cat > .gembaflow-config.json <<EOF
{
  "org": "${org}",
  "repo": "${repo}",
  "solo_mode": true
}
EOF
fi

# ---------------------------------------------------------------------------
# Python dev deps — fail-tolerant (per SC5 of the quickstart plan)
# ---------------------------------------------------------------------------
if [ -f "pyproject.toml" ] && command -v uv >/dev/null 2>&1; then
    uv sync --extra dev 2>/dev/null || note_warning "\`uv sync --extra dev\` did not complete cleanly; run manually if Python dev deps are required."
fi

# ---------------------------------------------------------------------------
# WELCOME.md — re-written on every boot so warnings stay current. Gitignored
# (see .gitignore) so it never lands in the repo.
# ---------------------------------------------------------------------------
{
    echo "# Welcome to Gemba Flow"
    echo ""
    echo "Your Codespace is ready. **Next step:**"
    echo ""
    echo "1. Open the Claude Code sidebar (left edge of VS Code)."
    echo "2. Type \`/bootstrap\` to walk through product → architecture → agent specialization → workflow activation."
    echo ""
    echo "After \`/bootstrap\`, you'll have a populated PRD, roadmap, technical architecture, specialized agents, and a Ready column."
    echo ""
    echo "---"
    echo ""
    echo "## Codespace setup notes"
    echo ""
    if [ -n "$WARNINGS" ]; then
        echo "The following non-blocking issues were detected during postCreate:"
        echo ""
        printf "%s" "$WARNINGS"
    else
        echo "_Setup completed cleanly — no warnings to surface._"
    fi
} > "$WELCOME"

exit 0
