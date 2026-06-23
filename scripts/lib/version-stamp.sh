# shellcheck shell=bash
# scripts/lib/version-stamp.sh — shared version-stamp helper.
#
# Sourced by both `bootstrap.sh` (Phase 4, terminal install) and
# `scripts/codespace-postcreate.sh` (Codespaces install). Stamps
# `.gembaflow-version`'s `installedAt` (and `version` from the upstream's
# latest release tag, when reachable). Idempotent — only stamps when
# `installedAt` is unset, so re-runs (e.g. Codespace rebuilds) are no-ops.
#
# Without a stamped version, every fresh fork starts at the placeholder
# "0.1.0" and the first `/upgrade` generates a no-op sync PR (#381).
#
# Function: gembaflow_version_stamp
# Exit codes:
#   0 — stamped fully (installedAt + version set from upstream)
#   1 — stamped installedAt only; version lookup failed (caller should
#       surface a "run /upgrade to sync" note to the operator)
#   2 — nothing to do (manifest absent OR installedAt already set)

gembaflow_version_stamp() {
    local manifest=".gembaflow-version"
    [ -f "$manifest" ] || return 2

    local current_val
    current_val=$(jq -r '.installedAt // "null"' "$manifest" 2>/dev/null)
    [ "$current_val" != "null" ] && return 2

    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Normalize upstream field — accepts bare "owner/repo" or full URL
    # (https/http/git@), with optional .git suffix and trailing slash.
    local upstream
    upstream=$(jq -r '.upstream // empty' "$manifest" 2>/dev/null \
        | sed -e 's|^https://github.com/||' \
              -e 's|^http://github.com/||' \
              -e 's|^git@github.com:||' \
              -e 's|\.git$||' \
              -e 's|/$||')
    [ -z "$upstream" ] && upstream="vibeacademy/gembaflow"

    local latest_version=""
    if command -v gh >/dev/null 2>&1; then
        latest_version=$(gh release view --repo "$upstream" --json tagName \
            --jq '.tagName | sub("^v"; "")' 2>/dev/null || echo "")
    fi

    if [ -n "$latest_version" ]; then
        jq --arg ts "$timestamp" --arg ver "$latest_version" \
            '.installedAt = $ts | .version = $ver' "$manifest" \
            > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
        return 0
    else
        jq --arg ts "$timestamp" '.installedAt = $ts' "$manifest" \
            > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
        return 1
    fi
}
