#!/bin/bash
# scripts/lib/ruleset-probe.sh — token capability probe for Phase-4 ruleset POST
#
# Extracted from bootstrap.sh so the probe logic is independently testable
# (scripts/__tests__/ruleset-probe.test.mjs stubs the gh binary and exercises
# each of the three error branches without touching GitHub).
#
# API: gembaflow_ruleset_probe <repo_slug>
#
# Returns 0 if the token can list rulesets (administration:read implies
# administration:write — proceed to POST).
# Returns 1 and prints a user-facing error message for each of three cases:
#   1. Token lacks administration scope AND user is not admin → role error.
#   2. Token lacks administration scope AND user is admin AND running inside
#      Codespaces → Codespaces token-scope wall (branch 2 — primary UX path
#      now that gfm-2mh/SEC-02 will strip the devcontainer permissions block).
#   3. Token lacks administration scope AND user is admin AND NOT Codespaces
#      → generic 403 manual fallback.
#
# Usage:
#   # shellcheck source=scripts/lib/ruleset-probe.sh
#   source "${BOOTSTRAP_DIR}/scripts/lib/ruleset-probe.sh"
#   if gembaflow_ruleset_probe "${repo_slug}"; then
#       # proceed with POST
#   fi
#   # on failure the function already printed the user-facing error

# Colours: sourced scripts may already have these; guard with ${VAR:-} to
# avoid unbound-variable errors when sourced in a bare shell.
_PROBE_RED="${RED:-\033[0;31m}"
_PROBE_YELLOW="${YELLOW:-\033[1;33m}"
_PROBE_CYAN="${CYAN:-\033[0;36m}"
_PROBE_NC="${NC:-\033[0m}"

gembaflow_ruleset_probe() {
    local repo_slug="$1"

    # -- Capability probe: does the token have administration:read? ----------
    # A 200 on GET /rulesets means yes (same scope family as administration:write).
    # Suppress all output (stdout + stderr) — we only need the exit code.
    gh api "repos/${repo_slug}/rulesets" >/dev/null 2>&1
    local probe_exit=$?

    if [ "$probe_exit" -eq 0 ]; then
        # Token has administration:read — safe to proceed with POST.
        return 0
    fi

    # -- Probe failed: distinguish the three branches -----------------------

    # Branch 1: check whether the user even has admin role.
    local current_user
    current_user=$(gh api user --jq .login 2>/dev/null || true)

    local user_permission
    user_permission=$(gh api "repos/${repo_slug}/collaborators/${current_user}/permission" \
        --jq .permission 2>/dev/null || true)

    if [ "$user_permission" != "admin" ] && [ "$user_permission" != "maintain" ]; then
        # Branch 1 — not an admin; the user's account can't create rulesets.
        echo -e "${_PROBE_RED}[✗] Branch protection: your role on this repo is '${user_permission:-unknown}'.${_PROBE_NC}"
        echo "    Rulesets require admin access. Options:"
        echo "    • Ask the repo owner to run  bash bootstrap.sh  from their admin account."
        echo "    • Or, if you are the owner, confirm you forked the repo under your own account."
        echo ""
        echo "    Manual fallback — configure branch protection via GitHub UI:"
        echo "      Settings > Rules > Rulesets > New ruleset"
        echo "        - Name: Protect main"
        echo "        - Target: main branch"
        echo "        - Rules: Require pull request, Require status checks"
        return 1
    fi

    # User IS admin — the token scope is the blocker.
    if [ "${CODESPACES:-}" = "true" ]; then
        # Branch 2 — Codespaces default installation token lacks administration scope.
        # NOTE: this branch is the DEFAULT path once gfm-2mh/SEC-02 removes the
        # devcontainer permissions block. Write it as first-class UX — calm and
        # actionable; do NOT dump the raw 403 response.
        echo -e "${_PROBE_YELLOW}[!] Branch protection skipped — Codespaces token scope wall.${_PROBE_NC}"
        echo ""
        echo "    Your Codespace uses a GitHub App installation token. Its scopes"
        echo "    come from devcontainer.json — not from your account permissions."
        echo "    The default Codespace token does not include the administration"
        echo "    scope needed to create rulesets via the API."
        echo ""
        echo "    To enable auto-ruleset creation, choose one of:"
        echo ""
        echo "    (a) Run bootstrap locally with a PAT that has the right scopes:"
        echo "          gh auth login --scopes repo,workflow"
        echo "          bash bootstrap.sh"
        echo "        (Add  admin:org  if your fork lives in an org, not a personal account.)"
        echo ""
        echo "    (b) Configure a user-scoped PAT as a Codespaces secret and re-run:"
        echo "          See docs/codespaces-secrets.md for step-by-step instructions."
        echo "          Required PAT scopes: repo,workflow"
        echo "          (Add  admin:org  for org-owned forks.)"
        echo ""
        echo "    Manual fallback (no PAT needed) — configure branch protection via GitHub UI:"
        echo "      Settings > Rules > Rulesets > New ruleset"
        echo "        - Name: Protect main"
        echo "        - Target: main branch"
        echo "        - Rules: Require pull request, Require status checks"
        return 1
    fi

    # Branch 3 — admin user, not Codespaces, but still got 403.
    # Keep the existing manual-fallback posture; do not retry or elevate.
    echo -e "${_PROBE_YELLOW}[!] Could not create ruleset automatically (403 from GitHub API).${_PROBE_NC}"
    echo "    You have admin role on this repo, but the current token was"
    echo "    rejected by the rulesets API. Possible causes:"
    echo "      • Fine-grained PAT with 'administration' permission set to Read-only"
    echo "      • Classic PAT missing the  admin:org  scope (org-owned repos)"
    echo "      • Repo plan does not support rulesets via API"
    echo ""
    echo "    Manual fallback — configure branch protection via GitHub UI:"
    echo "      Settings > Rules > Rulesets > New ruleset"
    echo "        - Name: Protect main"
    echo "        - Target: main branch"
    echo "        - Rules: Require pull request, Require status checks"
    return 1
}
