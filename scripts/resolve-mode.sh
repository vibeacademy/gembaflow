#!/usr/bin/env bash
# resolve-mode.sh -- Resolve the active assistant mode for the main session.
#
# This script is the heart of the mode system (gembaflow#406, variant c). It is
# called from two places:
#
#   1. The SessionStart hook block in .claude/settings.json. The hook emits this
#      script's stdout as additional context, so the resolved mode fragment is
#      injected into Claude's system context at session start.
#   2. The /mode slash command (.claude/commands/mode.md), when it needs to
#      report the currently-resolved mode. The slash command and the hook share
#      this resolver by construction — they cannot disagree.
#
# Resolution precedence (first match wins):
#
#   1. .claude/settings.json "assistantMode" field (team-shared, committed).
#   2. .claude/mode.local (operator-local, gitignored).
#   3. Falls back to "default".
#
# Output modes:
#
#   --emit-fragment   (default) Print the resolved mode fragment to stdout.
#                     Used by the SessionStart hook.
#   --print-name      Print just the resolved mode name to stdout.
#   --print-source    Print "settings.json | mode.local | default fallback".
#   --list            List available modes (one per line: <name>\t<positioning>).
#
# All modes also write a brief diagnostic line to stderr so a hook caller can
# log it without it polluting the injected context.

set -euo pipefail

# Locate the repo root from this script's location. This script lives at
# <repo>/scripts/resolve-mode.sh; the modes dir is <repo>/.claude/modes/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODES_DIR="${REPO_ROOT}/.claude/modes"
SETTINGS_FILE="${REPO_ROOT}/.claude/settings.json"
LOCAL_FILE="${REPO_ROOT}/.claude/mode.local"

action="${1:-emit-fragment}"
case "$action" in
  --emit-fragment|emit-fragment) action="emit-fragment" ;;
  --print-name|print-name)       action="print-name" ;;
  --print-source|print-source)   action="print-source" ;;
  --list|list)                   action="list" ;;
  -h|--help|help)
    cat <<'USAGE'
Usage: resolve-mode.sh [--emit-fragment|--print-name|--print-source|--list]

  --emit-fragment   Print the resolved mode fragment to stdout (default).
  --print-name      Print just the resolved mode name.
  --print-source    Print which precedence layer resolved the mode.
  --list            List available modes with one-line positioning each.
USAGE
    exit 0
    ;;
  *)
    echo "ERROR: unknown action '$action'. Use --help for options." >&2
    exit 2
    ;;
esac

###############################################################################
# read_settings_mode — extract "assistantMode" from .claude/settings.json.
# Prints the value to stdout (empty string if not set or file missing).
###############################################################################
read_settings_mode() {
  if [ ! -f "$SETTINGS_FILE" ]; then
    return 0
  fi
  # Prefer jq when available; fall back to python3 so this works in bare
  # environments. Both tolerate the field being absent.
  if command -v jq >/dev/null 2>&1; then
    jq -r '.assistantMode // ""' "$SETTINGS_FILE" 2>/dev/null || true
  else
    python3 - "$SETTINGS_FILE" <<'PY' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    print(data.get("assistantMode") or "")
except Exception:
    print("")
PY
  fi
}

###############################################################################
# read_local_mode — read the single line in .claude/mode.local.
# Prints the trimmed value (empty string if file missing or empty).
###############################################################################
read_local_mode() {
  if [ ! -f "$LOCAL_FILE" ]; then
    return 0
  fi
  # Trim whitespace, ignore comment lines, take the first non-empty line.
  awk '
    /^[[:space:]]*#/ { next }
    {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0)
      if ($0 != "") { print $0; exit }
    }
  ' "$LOCAL_FILE"
}

###############################################################################
# mode_exists — check that a fragment file exists for the named mode.
###############################################################################
mode_exists() {
  local name="$1"
  [ -n "$name" ] && [ -f "${MODES_DIR}/${name}.md" ]
}

###############################################################################
# resolve — walk the precedence chain. Sets RESOLVED_NAME and RESOLVED_SOURCE.
###############################################################################
resolve() {
  RESOLVED_NAME=""
  RESOLVED_SOURCE=""

  local candidate
  candidate="$(read_settings_mode)"
  if [ -n "$candidate" ] && mode_exists "$candidate"; then
    RESOLVED_NAME="$candidate"
    RESOLVED_SOURCE="settings.json"
    return 0
  fi

  candidate="$(read_local_mode)"
  if [ -n "$candidate" ] && mode_exists "$candidate"; then
    RESOLVED_NAME="$candidate"
    RESOLVED_SOURCE="mode.local"
    return 0
  fi

  RESOLVED_NAME="default"
  RESOLVED_SOURCE="default fallback"
}

###############################################################################
# list_modes — print "<name>\t<positioning>" for each .md in the modes dir.
# Positioning is the first non-empty paragraph after the `# <name>` heading.
###############################################################################
list_modes() {
  if [ ! -d "$MODES_DIR" ]; then
    echo "ERROR: modes directory not found: $MODES_DIR" >&2
    exit 1
  fi
  local file name positioning
  for file in "$MODES_DIR"/*.md; do
    [ -f "$file" ] || continue
    name="$(basename "$file" .md)"
    # README.md is documentation, not a mode.
    [ "$name" = "README" ] && continue
    # Pull the first non-empty line that comes after the `# <name>` heading.
    positioning="$(awk '
      /^# / { seen_heading = 1; next }
      seen_heading && NF > 0 && !/^#/ {
        print
        exit
      }
    ' "$file")"
    printf '%s\t%s\n' "$name" "$positioning"
  done
}

###############################################################################
# emit_fragment — print the resolved mode fragment with a small framing header
# so it lands cleanly in Claude's injected context.
###############################################################################
emit_fragment() {
  resolve
  local fragment="${MODES_DIR}/${RESOLVED_NAME}.md"
  if [ ! -f "$fragment" ]; then
    # Defensive: if even default.md is missing, emit nothing and warn on stderr.
    echo "WARNING: mode fragment not found: $fragment" >&2
    return 0
  fi
  # Diagnostic to stderr — the hook may log it; it does not enter context.
  echo "INFO: resolved assistant mode '${RESOLVED_NAME}' from ${RESOLVED_SOURCE}" >&2
  # Framed output. The framing is just a context cue; the body is the fragment.
  cat <<EOF
<!-- assistant-mode: ${RESOLVED_NAME} (source: ${RESOLVED_SOURCE}) -->
# Active assistant mode

The following fragment was selected by \`scripts/resolve-mode.sh\` for the main
session. It shapes tone and presentation only — framework safety rules,
sub-agent personas, and protocol invariants in \`CLAUDE.md\` are unchanged.

EOF
  cat "$fragment"
}

case "$action" in
  emit-fragment) emit_fragment ;;
  print-name)
    resolve
    echo "$RESOLVED_NAME"
    ;;
  print-source)
    resolve
    echo "$RESOLVED_SOURCE"
    ;;
  list) list_modes ;;
esac
