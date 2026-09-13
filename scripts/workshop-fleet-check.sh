#!/usr/bin/env bash
# scripts/workshop-fleet-check.sh — workshop fleet bootstrap observability (gh-gf-524).
#
# Reads a list of {owner}/{repo} slugs and reports each fork's `/bootstrap`
# state by fetching its committed `.gembaflow-bootstrap-complete` marker via
# raw.githubusercontent.com (public forks — no auth required):
#
#   GREEN  {slug} (<duration>s, mode=<mode>[, workshop=<cohort>][, marker on fallback branch])
#   YELLOW {slug} (marker missing — bootstrap in progress?)
#   RED    {slug} (fork not found)
#
# plus a stale bucket: with --since, a marker whose completed_at predates the
# session start reports YELLOW as stale (a leftover from a previous session,
# not this one).
#
# Fallback branch: the Phase-4 provisioning ruleset blocks direct pushes to
# main for all actors, so bootstrap pushes the marker commit to the
# well-known branch `gembaflow/bootstrap-marker` when the default-branch
# push is rejected (scripts/lib/bootstrap-marker.sh). On a default-branch
# marker 404 this script tries that branch before the repo-existence check;
# a hit classifies GREEN with a "marker on fallback branch" annotation.
#
# Input (explicit list only — deliberately NO org-API enumeration, the
# instructor controls the roster):
#   - stdin, one slug per line:      echo "vibeacademy/gembaflow" | scripts/workshop-fleet-check.sh
#   - a file:                        scripts/workshop-fleet-check.sh -f slugs.txt
#   - the workshop-provision roster CSV works as-is (auto-detected):
#     scripts/workshop-fleet-check.sh -f workshop-roster-2026-10-nashville.csv
#     (header row skipped; the repo_slug column is the only owner/repo-shaped
#     comma field, so it is extracted per row)
#
# Options:
#   -f FILE          read slugs (or roster CSV) from FILE instead of stdin
#   --since TS       session-start timestamp (ISO8601 UTC "...Z" or epoch);
#                    markers older than TS report YELLOW (stale)
#   --branch BRANCH  branch to fetch the marker from (default: main)
#   -h, --help       usage
#
# Repo-existence disambiguation: a 404 on the marker is followed by ONE
# per-repo GET to api.github.com/repos/{slug} (not enumeration) to split
# "fork not found" (RED) from "fork exists, marker missing" (YELLOW). Set
# GITHUB_TOKEN to raise the unauthenticated API rate limit for large fleets.
#
# Exit code: 0 whenever the roster was processed (colors carry the signal);
# 2 on usage/dependency errors.

set -u

usage() {
    sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
}

err() { echo "workshop-fleet-check: $*" >&2; }

INPUT_FILE=""
SINCE=""
BRANCH="main"
# Keep in sync with GEMBAFLOW_MARKER_FALLBACK_BRANCH in
# scripts/lib/bootstrap-marker.sh.
FALLBACK_BRANCH="gembaflow/bootstrap-marker"

while [ $# -gt 0 ]; do
    case "$1" in
        -f)
            [ $# -ge 2 ] || { err "-f requires a file argument"; exit 2; }
            INPUT_FILE=$2; shift 2 ;;
        --since)
            [ $# -ge 2 ] || { err "--since requires a timestamp argument"; exit 2; }
            SINCE=$2; shift 2 ;;
        --branch)
            [ $# -ge 2 ] || { err "--branch requires a branch argument"; exit 2; }
            BRANCH=$2; shift 2 ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            err "unknown argument: $1 (see --help)"; exit 2 ;;
    esac
done

for dep in curl jq; do
    command -v "$dep" >/dev/null 2>&1 || { err "required dependency not found: $dep"; exit 2; }
done

# to_epoch <ts> — accepts a bare epoch or ISO8601 UTC ("%Y-%m-%dT%H:%M:%SZ").
to_epoch() {
    case "$1" in
        ''|*[!0-9]*) jq -rn --arg t "$1" '$t | fromdateiso8601' 2>/dev/null ;;
        *) echo "$1" ;;
    esac
}

SINCE_EPOCH=""
if [ -n "$SINCE" ]; then
    SINCE_EPOCH=$(to_epoch "$SINCE")
    if [ -z "$SINCE_EPOCH" ]; then
        err "--since: could not parse '$SINCE' (use ISO8601 UTC like 2026-10-17T14:00:00Z, or an epoch)"
        exit 2
    fi
fi

SLUG_RE='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'

# extract_slug <line> — plain slug lines pass through; CSV rows (roster
# format: username,repo_slug,render_service_id,supabase_project_ref,status)
# yield the first owner/repo-shaped comma field; header rows yield nothing.
extract_slug() {
    local line=$1 field
    if [[ "$line" != *,* ]]; then
        [[ "$line" =~ $SLUG_RE ]] && echo "$line"
        return 0
    fi
    IFS=',' read -ra _fields <<< "$line"
    for field in "${_fields[@]}"; do
        # trim surrounding whitespace
        field="${field#"${field%%[![:space:]]*}"}"
        field="${field%"${field##*[![:space:]]}"}"
        if [[ "$field" =~ $SLUG_RE ]]; then
            echo "$field"
            return 0
        fi
    done
    return 0
}

if [ -n "$INPUT_FILE" ]; then
    [ -r "$INPUT_FILE" ] || { err "cannot read file: $INPUT_FILE"; exit 2; }
    exec < "$INPUT_FILE"
fi

green=0 yellow=0 red=0 total=0
tmp_body=$(mktemp)
trap 'rm -f "$tmp_body"' EXIT

api_auth=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
    api_auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

emit_green()  { echo "GREEN $1 ($2)";  green=$((green + 1)); }
emit_yellow() { echo "YELLOW $1 ($2)"; yellow=$((yellow + 1)); }
emit_red()    { echo "RED $1 ($2)";    red=$((red + 1)); }

# classify_marker_body <slug> [annotation] — classify a fetched marker (in
# $tmp_body) as GREEN, YELLOW-stale, or YELLOW-unreadable. Shared by the
# default-branch and fallback-branch fetch paths; a non-empty annotation is
# appended to the GREEN detail (e.g. "marker on fallback branch").
classify_marker_body() {
    local slug=$1 annotation=${2:-}
    local completed_at mode cohort duration completed_epoch detail

    if ! jq -e . "$tmp_body" >/dev/null 2>&1; then
        emit_yellow "$slug" "marker unreadable — invalid JSON"
        return 0
    fi
    completed_at=$(jq -r '.completed_at // empty' "$tmp_body")
    mode=$(jq -r '.mode // "?"' "$tmp_body")
    cohort=$(jq -r '.workshop // empty' "$tmp_body")
    duration=$(jq -r '.duration_seconds // "?"' "$tmp_body")

    if [ -n "$SINCE_EPOCH" ]; then
        completed_epoch=$(to_epoch "$completed_at")
        if [ -z "$completed_epoch" ] || [ "$completed_epoch" -lt "$SINCE_EPOCH" ]; then
            emit_yellow "$slug" "stale marker from ${completed_at:-unknown} — predates session start"
            return 0
        fi
    fi

    detail="${duration}s, mode=${mode}"
    [ -n "$cohort" ] && detail="${detail}, workshop=${cohort}"
    [ -n "$annotation" ] && detail="${detail}, ${annotation}"
    emit_green "$slug" "$detail"
}

while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    # strip CR (spreadsheet exports) and surrounding whitespace
    line="${raw_line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    [ "${line:0:1}" = "#" ] && continue

    slug=$(extract_slug "$line")
    if [ -z "$slug" ]; then
        # header rows and malformed lines: skip headers silently, warn otherwise
        case "$line" in
            *repo_slug*|username,*) continue ;;
            *) err "skipping unrecognized line: $line"; continue ;;
        esac
    fi

    total=$((total + 1))

    code=$(curl -s -o "$tmp_body" -w '%{http_code}' \
        "https://raw.githubusercontent.com/${slug}/${BRANCH}/.gembaflow-bootstrap-complete") || code="000"

    case "$code" in
        200)
            classify_marker_body "$slug"
            ;;
        404)
            # Marker absent on the default branch — the marker commit may
            # have landed on the fallback branch instead (branch protection
            # rejects direct pushes to main; see the header). Try it BEFORE
            # the repo-existence check.
            fb_code=$(curl -s -o "$tmp_body" -w '%{http_code}' \
                "https://raw.githubusercontent.com/${slug}/${FALLBACK_BRANCH}/.gembaflow-bootstrap-complete") || fb_code="000"
            if [ "$fb_code" = "200" ]; then
                classify_marker_body "$slug" "marker on fallback branch"
                continue
            fi
            # ${arr[@]+...} keeps bash 3.2 (macOS /bin/bash) happy under
            # set -u when the auth array is empty.
            repo_code=$(curl -s -o /dev/null -w '%{http_code}' ${api_auth[@]+"${api_auth[@]}"} \
                "https://api.github.com/repos/${slug}") || repo_code="000"
            if [ "$repo_code" = "404" ]; then
                emit_red "$slug" "fork not found"
            else
                emit_yellow "$slug" "marker missing — bootstrap in progress?"
            fi
            ;;
        *)
            emit_red "$slug" "fetch failed — HTTP ${code}"
            ;;
    esac
done

echo ""
echo "Summary: ${green} green / ${yellow} yellow / ${red} red (${total} forks)"
exit 0
