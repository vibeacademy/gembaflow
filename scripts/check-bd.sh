#!/usr/bin/env bash
# scripts/check-bd.sh — version gate for the bd (beads) CLI.
#
# Fails LOUDLY (exit 1, actionable stderr) when bd is missing, when its
# version cannot be read, or when the installed version does not match the
# framework pin in scripts/lib/bd-version.sh. Prints a single OK line and
# exits 0 when the installed bd matches the pin.
#
# Usage:
#   ./scripts/check-bd.sh            # human / CI / bootstrap gate
#   ./scripts/check-bd.sh --quiet    # suppress the success line (orchestrators)
#
# Why a hard pin: beads is an active 1.x whose CLI surface moves between
# releases. Framework scripts consume bd output via --json only (never
# prose) per the framework guardrails — the version read below uses
# `bd version --json` for the same reason.
#
# Upgrading bd deliberately trips this gate until the pin is moved — see
# docs/BEADS.md § "Upgrade procedure".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/bd-version.sh
source "${SCRIPT_DIR}/lib/bd-version.sh"

QUIET=false
if [ "${1:-}" = "--quiet" ]; then
    QUIET=true
fi

fail() {
    {
        echo ""
        echo "ERROR: bd version gate FAILED — $1"
        echo ""
        echo "  The framework pins bd to version ${GEMBAFLOW_BD_VERSION}"
        echo "  (constant: scripts/lib/bd-version.sh)."
        echo ""
        echo "  To install the pinned version:"
        echo "    npm install -g @beads/bd@${GEMBAFLOW_BD_VERSION}"
        echo ""
        echo "  If you intend to move the framework to a newer bd, do NOT just"
        echo "  upgrade in place — follow docs/BEADS.md § \"Upgrade procedure\""
        echo "  (bump the pin, re-run this gate, re-run"
        echo "  \`node scripts/render-boards.mjs --check\`, re-verify JSON shapes)."
        echo ""
    } >&2
    exit 1
}

if ! command -v bd >/dev/null 2>&1; then
    fail "bd (beads) is not installed or not on PATH"
fi

# Read the version via --json (never parse prose output; it drifts between
# releases). An old bd without `version --json` support lands in the
# unreadable-version branch below — which is itself a pin violation.
raw_json="$(bd version --json 2>/dev/null || true)"
installed="$(printf '%s' "$raw_json" \
    | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -1)"

if [ -z "$installed" ]; then
    fail "could not read a version from \`bd version --json\` (bd too old, or output shape drifted)"
fi

if [ "$installed" != "$GEMBAFLOW_BD_VERSION" ]; then
    fail "installed bd is ${installed}, but the framework pin is ${GEMBAFLOW_BD_VERSION}"
fi

if [ "$QUIET" = false ]; then
    echo "OK: bd ${installed} matches the pinned version ${GEMBAFLOW_BD_VERSION} (scripts/lib/bd-version.sh)"
fi
