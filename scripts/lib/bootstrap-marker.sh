# shellcheck shell=bash
# scripts/lib/bootstrap-marker.sh — bootstrap completion-marker helper (gh-gf-524).
#
# Writes `.gembaflow-bootstrap-complete` at the repo root when Phase 4
# (Workflow Activation) finishes, then commits it so workshop instructors can
# observe fleet bootstrap state via raw.githubusercontent.com
# (scripts/workshop-fleet-check.sh). Shared by both bootstrap entrypoints:
# `bootstrap.sh` Phase 4 sources it, and the `/bootstrap` slash command runs
# it directly (`bash scripts/lib/bootstrap-marker.sh`).
#
# Marker schema (schema_version "1" — additive evolution only):
#   {
#     "schema_version":   "1",
#     "completed_at":     "<ISO8601 UTC>",
#     "version":          "<.gembaflow-version .version>",
#     "mode":             "solo" | "multi",
#     "workshop":         "<cohort slug>",        // OPTIONAL — only when
#                                                 // workshop.enabled is true
#     "duration_seconds": <int> | null
#   }
#
# duration_seconds derivation (best available signal, never fabricated):
#   1. `started:<ISO8601>` line in `.claude/.bootstrap-status` (appended when
#      phase0 is marked complete)
#   2. `.gembaflow-version` `installedAt` (stamped by codespace-postcreate.sh
#      at container create, or by bootstrap.sh Phase 4 version stamp)
#   3. neither → null
#
# Privacy: the marker carries NO operator-identifying data (no email, no
# username, no token material) — only what the fork's git history already
# exposes.
#
# Functions:
#   gembaflow_write_bootstrap_marker   — write the JSON file (exit 0 on write,
#                                        1 when jq is unavailable)
#   gembaflow_commit_bootstrap_marker  — commit the marker as its own commit
#                                        ("chore(bootstrap): mark complete"),
#                                        push to the default branch, and on
#                                        rejection (expected under the Phase-4
#                                        ruleset) push to the well-known
#                                        fallback branch; never fatal

GEMBAFLOW_BOOTSTRAP_MARKER=".gembaflow-bootstrap-complete"

# Well-known fallback branch for the marker push. The Phase-4 provisioning
# ruleset (pull_request + required_status_checks, enforcement active, no
# bypass actors) blocks direct pushes to refs/heads/main for ALL actors —
# including the bootstrap flow itself, which creates that ruleset earlier in
# the same phase. The ruleset's conditions cover only refs/heads/main, so
# pushing the marker commit to this branch succeeds, and
# scripts/workshop-fleet-check.sh reads it automatically when the
# default-branch marker is absent. Keep in sync with FALLBACK_BRANCH there.
GEMBAFLOW_MARKER_FALLBACK_BRANCH="gembaflow/bootstrap-marker"

# Prints the bootstrap start time as an epoch, or nothing when no reliable
# timing signal exists.
gembaflow_bootstrap_start_epoch() {
    local status_file=".claude/.bootstrap-status"
    local iso=""

    if [ -f "$status_file" ]; then
        # `cut -d: -f2-` keeps the colons inside the ISO8601 timestamp.
        iso=$(grep -m1 '^started:' "$status_file" 2>/dev/null | cut -d: -f2-)
    fi

    if [ -z "$iso" ] && [ -f ".gembaflow-version" ]; then
        iso=$(jq -r '.installedAt // empty' .gembaflow-version 2>/dev/null)
    fi

    [ -z "$iso" ] && return 1

    # fromdateiso8601 expects the exact "%Y-%m-%dT%H:%M:%SZ" shape both
    # writers use; anything else falls through to "no signal".
    jq -rn --arg t "$iso" '$t | fromdateiso8601' 2>/dev/null || return 1
}

gembaflow_write_bootstrap_marker() {
    if ! command -v jq >/dev/null 2>&1; then
        echo "bootstrap-marker: jq not found — cannot write ${GEMBAFLOW_BOOTSTRAP_MARKER}" >&2
        return 1
    fi

    local completed_at version mode cohort start_epoch now_epoch duration
    completed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    now_epoch=$(date -u +%s)

    version="unknown"
    if [ -f ".gembaflow-version" ]; then
        version=$(jq -r '.version // "unknown"' .gembaflow-version 2>/dev/null)
        [ -z "$version" ] && version="unknown"
    fi

    # solo_mode: true / absent / unreadable → solo; explicit false → multi
    # (mirrors /bootstrap preflight 1d).
    mode="solo"
    if [ -f ".gembaflow-config.json" ]; then
        if [ "$(jq -r '.solo_mode' .gembaflow-config.json 2>/dev/null)" = "false" ]; then
            mode="multi"
        fi
    fi

    # Optional workshop field — cohort slug, only when workshop.enabled is
    # true (shipped with the #737 workshop block). Additive; schema_version
    # stays "1".
    cohort=""
    if [ -f ".gembaflow-config.json" ]; then
        cohort=$(jq -r 'if .workshop.enabled == true then (.workshop.cohort // empty) else empty end' \
            .gembaflow-config.json 2>/dev/null)
    fi

    duration="null"
    if start_epoch=$(gembaflow_bootstrap_start_epoch); then
        if [ "$now_epoch" -ge "$start_epoch" ] 2>/dev/null; then
            duration=$((now_epoch - start_epoch))
        fi
    fi

    jq -n \
        --arg completed_at "$completed_at" \
        --arg version "$version" \
        --arg mode "$mode" \
        --arg cohort "$cohort" \
        --argjson duration "$duration" \
        '{
            schema_version: "1",
            completed_at: $completed_at,
            version: $version,
            mode: $mode
        }
        + (if $cohort != "" then { workshop: $cohort } else {} end)
        + { duration_seconds: $duration }' \
        > "$GEMBAFLOW_BOOTSTRAP_MARKER"
}

gembaflow_commit_bootstrap_marker() {
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "bootstrap-marker: not a git repository — marker written but not committed" >&2
        return 0
    fi

    # Pathspec commit: only the marker rides this commit, regardless of what
    # else is staged. Skip when the marker is unchanged (idempotent re-run).
    # Unborn-HEAD edge (no commits yet — pathspec commits need HEAD): stage
    # the marker and make a normal initial commit instead.
    local commit_args=(-m "chore(bootstrap): mark complete")
    git add -- "$GEMBAFLOW_BOOTSTRAP_MARKER" >/dev/null 2>&1
    if git rev-parse --verify -q HEAD >/dev/null 2>&1; then
        commit_args+=(-- "$GEMBAFLOW_BOOTSTRAP_MARKER")
    fi
    if git status --porcelain -- "$GEMBAFLOW_BOOTSTRAP_MARKER" 2>/dev/null | grep -q .; then
        if git commit "${commit_args[@]}" >/dev/null 2>&1; then
            echo "bootstrap-marker: committed ${GEMBAFLOW_BOOTSTRAP_MARKER} (chore(bootstrap): mark complete)"
        else
            echo "bootstrap-marker: commit failed — commit ${GEMBAFLOW_BOOTSTRAP_MARKER} manually" >&2
            return 0
        fi
    fi

    # Push so the marker reaches GitHub (the fleet-check fetch path). The
    # default-branch push is EXPECTED to be rejected once the Phase-4
    # provisioning ruleset exists (it blocks direct pushes to main for all
    # actors — GitHub rulesets have no implicit admin exemption), so on
    # rejection push the marker commit to the well-known fallback branch,
    # which the ruleset's conditions do not cover. --force keeps
    # re-bootstraps working when the fallback branch already exists with
    # older history. Never fail bootstrap.
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if git push origin "${branch:-HEAD}" >/dev/null 2>&1; then
        echo "bootstrap-marker: marker pushed to '${branch:-HEAD}' — fleet-check will report this fork GREEN"
    elif git push --force origin "HEAD:refs/heads/${GEMBAFLOW_MARKER_FALLBACK_BRANCH}" >/dev/null 2>&1; then
        echo "bootstrap-marker: default-branch push rejected (branch protection — expected under the Phase-4 ruleset); marker pushed to fallback branch '${GEMBAFLOW_MARKER_FALLBACK_BRANCH}'. The workshop fleet-check reads that branch automatically — no action needed."
    else
        echo "bootstrap-marker: push failed (default branch AND fallback branch '${GEMBAFLOW_MARKER_FALLBACK_BRANCH}') — the marker is committed locally and fleet-check will report YELLOW until a push succeeds. Check network/auth, then re-run: bash scripts/lib/bootstrap-marker.sh" >&2
    fi
    return 0
}

# Direct execution (the /bootstrap slash-command path):
#   bash scripts/lib/bootstrap-marker.sh
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    gembaflow_write_bootstrap_marker && gembaflow_commit_bootstrap_marker
fi
