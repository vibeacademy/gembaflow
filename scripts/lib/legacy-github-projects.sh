#!/bin/bash
# scripts/lib/legacy-github-projects.sh — single reader for the DEPRECATED
# GitHub-Projects compatibility flag.
#
# Beads (bd) is the framework's tracker; GitHub Projects support is kept
# reachable for exactly ONE release behind this flag, default OFF, and is
# then removed (removal ticket vibeacademy/gembaflow#587, filed at flag
# introduction — see CHANGELOG.md [Unreleased] and docs/BEADS.md
# § "GitHub-Projects compatibility flag").
#
# The flag has two surfaces because `.gembaflow-config.json` is fork-local
# (gitignored) and therefore invisible to GitHub Actions:
#   - Local tooling (bootstrap.sh, /bootstrap, /bootstrap-workflow) reads
#     `.gembaflow-config.json` -> `legacy.githubProjects` (boolean,
#     default false) via this helper.
#   - Workflows (.github/workflows/auto-board-status.yml) read the repo
#     Actions variable GEMBAFLOW_LEGACY_GITHUB_PROJECTS ("true" to enable).
# Enabling the legacy path means setting BOTH where both apply.
#
# Usage (sourced):
#   source scripts/lib/legacy-github-projects.sh
#   if gembaflow_legacy_github_projects_enabled; then ... legacy path ...; fi
#
# Every read of an ENABLED flag prints the deprecation warning to stderr —
# forks still on the legacy path should see it at every touchpoint.

# shellcheck disable=SC2034  # consumed by sourcing scripts

GEMBAFLOW_LEGACY_PROJECTS_CONFIG="${GEMBAFLOW_LEGACY_PROJECTS_CONFIG:-.gembaflow-config.json}"

gembaflow_legacy_github_projects_enabled() {
    local enabled="false"
    if [ -f "$GEMBAFLOW_LEGACY_PROJECTS_CONFIG" ] && command -v jq >/dev/null 2>&1; then
        enabled="$(jq -r '.legacy.githubProjects // false' "$GEMBAFLOW_LEGACY_PROJECTS_CONFIG" 2>/dev/null || echo false)"
    fi
    if [ "$enabled" = "true" ]; then
        {
            echo "DEPRECATION: legacy.githubProjects is enabled in ${GEMBAFLOW_LEGACY_PROJECTS_CONFIG}."
            echo "  The GitHub-Projects workflow path is deprecated and will be REMOVED in the"
            echo "  next release (vibeacademy/gembaflow#587) — beads (bd) is the framework"
            echo "  tracker. Migrate with scripts/migrate-issues-to-beads.sh (see docs/BEADS.md)."
        } >&2
        return 0
    fi
    return 1
}
