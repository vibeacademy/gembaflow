#!/usr/bin/env bash
# report-issue.sh — Report a downstream issue to the upstream Agile Flow repo.
#
# Usage:
#   bash scripts/report-issue.sh
#   bash scripts/report-issue.sh --severity p2 --component provisioning --title "short title"
#   bash scripts/report-issue.sh --non-interactive --severity p3 --component docs --title "typo in guide"
#   bash scripts/report-issue.sh --non-interactive --severity p2 --component docs --title "bug fix" --body-file issue-body.txt
#   bash scripts/report-issue.sh --non-interactive --severity p1 --component ci --title "build failure" --body "The CI pipeline fails consistently."
#
# Exit codes:
#   0  — report filed successfully (or saved for manual submission via fallback)
#   1  — error (missing config, invalid inputs)

set -euo pipefail

VERSION_FILE=".agile-flow-version"
REPORTS_DIR=".agile-flow-reports"

# ── Parse flags ───────────────────────────────────────────────────────────────

SEVERITY=""
COMPONENT=""
TITLE=""
NON_INTERACTIVE=false
BODY_FILE=""
BODY=""

show_help() {
  cat <<'HELP'
report-issue.sh — Report a downstream issue to the upstream Agile Flow repo.

Usage:
  bash scripts/report-issue.sh [FLAGS]

Flags:
  --severity LEVEL       Issue severity: p1 (critical), p2 (high), p3 (low)
  --component COMP       Component: provisioning, ci, claude-commands, patterns, docs, other
  --title "TITLE"        Issue title (required)
  --non-interactive      Run without prompts (requires all flags)
  --body-file FILE       Read issue body from file (non-interactive only)
  --body "TEXT"          Provide issue body as text (non-interactive only)
  --help, -h             Show this help message

Examples:
  # Interactive mode (prompts for inputs)
  bash scripts/report-issue.sh
  
  # Non-interactive with inline body
  bash scripts/report-issue.sh --non-interactive \
    --severity p2 --component docs --title "Fix typo in README" \
    --body "The README file has a spelling error on line 42."
  
  # Non-interactive with body from file
  bash scripts/report-issue.sh --non-interactive \
    --severity p1 --component ci --title "Build pipeline broken" \
    --body-file issue-description.md

Exit codes:
  0  — Report filed successfully (or saved for manual submission via fallback)
  1  — Error (missing config, invalid inputs)
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --severity)        SEVERITY="$2";       shift 2 ;;
    --component)       COMPONENT="$2";      shift 2 ;;
    --title)           TITLE="$2";          shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --body-file)       BODY_FILE="$2";      shift 2 ;;
    --body)            BODY="$2";           shift 2 ;;
    --help|-h)         show_help; exit 0 ;;
    *) echo "ERROR: Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ── Verify .agile-flow-version exists ──────────────────────────────────────────

if [ ! -f "$VERSION_FILE" ]; then
  echo "ERROR: .agile-flow-version file not found." >&2
  echo "This fork does not have upstream metadata. Run /upgrade to initialise." >&2
  exit 1
fi

# ── Read upstream URL and version from .agile-flow-version ────────────────────

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to parse .agile-flow-version but is not installed." >&2
  exit 1
fi

UPSTREAM_URL=$(jq -r '.upstream' "$VERSION_FILE" 2>/dev/null || echo "null")
if [ "$UPSTREAM_URL" = "null" ] || [ -z "$UPSTREAM_URL" ]; then
  echo "ERROR: .agile-flow-version does not contain 'upstream' field." >&2
  echo "Run /upgrade to record this fork's upstream URL." >&2
  exit 1
fi

UPSTREAM_VERSION=$(jq -r '.version' "$VERSION_FILE" 2>/dev/null || echo "unknown")

# Handle empty, null, whitespace-only, or missing version field
if [ "$UPSTREAM_VERSION" = "null" ] || [ -z "$UPSTREAM_VERSION" ]; then
  UPSTREAM_VERSION="unknown"
else
  # Strip leading and trailing whitespace, then check if empty
  UPSTREAM_VERSION=$(echo "$UPSTREAM_VERSION" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -z "$UPSTREAM_VERSION" ]; then
    UPSTREAM_VERSION="unknown"
  fi
fi

# Extract org/repo from https or git@ GitHub URLs
# Strip .git suffix before matching (bash 3.2 doesn't support non-greedy regex)
UPSTREAM_URL_CLEAN="${UPSTREAM_URL%.git}"
UPSTREAM_REPO=""
if [[ "$UPSTREAM_URL_CLEAN" =~ github\.com[:/]([^/]+/[^/]+)$ ]]; then
  UPSTREAM_REPO="${BASH_REMATCH[1]}"
else
  echo "ERROR: Cannot parse GitHub repo from: $UPSTREAM_URL" >&2
  echo "Expected format: https://github.com/org/repo" >&2
  exit 1
fi

# ── Gather git metadata ───────────────────────────────────────────────────────

FORK_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Report Issue to Upstream"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Upstream : $UPSTREAM_URL"
echo "Fork     : ${FORK_COMMIT:0:12}"
echo "Version  : $UPSTREAM_VERSION"
echo ""

# ── Prompt: severity ─────────────────────────────────────────────────────────

if [ -z "$SEVERITY" ]; then
  if $NON_INTERACTIVE; then
    echo "ERROR: --severity required in non-interactive mode." >&2
    exit 1
  fi
  echo "Severity:"
  echo "  p1  Critical — broken for everyone, blocks workshops"
  echo "  p2  High — significant problem, workaround exists"
  echo "  p3  Low — minor issue or improvement suggestion"
  printf "> "
  read -r SEVERITY
fi

case "$SEVERITY" in
  p1|p2|p3) ;;
  *)
    echo "ERROR: --severity must be p1, p2, or p3. Got: '$SEVERITY'" >&2
    exit 1
    ;;
esac

# ── Prompt: component ─────────────────────────────────────────────────────────

if [ -z "$COMPONENT" ]; then
  if $NON_INTERACTIVE; then
    echo "ERROR: --component required in non-interactive mode." >&2
    exit 1
  fi
  echo ""
  echo "Component:"
  echo "  provisioning    setup, roster, env provisioning scripts"
  echo "  ci              GitHub Actions, CI/CD workflows"
  echo "  claude-commands /slash commands"
  echo "  patterns        architectural patterns and practices"
  echo "  docs            documentation"
  echo "  other           anything else"
  printf "> "
  read -r COMPONENT
fi

case "$COMPONENT" in
  provisioning|ci|claude-commands|patterns|docs|other) ;;
  *)
    echo "ERROR: --component must be one of: provisioning, ci, claude-commands, patterns, docs, other." >&2
    echo "Got: '$COMPONENT'" >&2
    exit 1
    ;;
esac

# ── Prompt: title ─────────────────────────────────────────────────────────────

if [ -z "$TITLE" ]; then
  if $NON_INTERACTIVE; then
    echo "ERROR: --title required in non-interactive mode." >&2
    exit 1
  fi
  echo ""
  echo "Short title (one line, describes the problem):"
  printf "> "
  read -r TITLE
fi

if [ -z "$TITLE" ]; then
  echo "ERROR: Title is required." >&2
  exit 1
fi

# Sanitise the title for safe interpolation into a YAML double-quoted scalar:
# backslashes first, then double quotes. YAML's double-quoted form allows
# \\\\ and \\\" as escapes, so this round-trips correctly for any title text.
SAFE_TITLE="${TITLE//\\/\\\\}"
SAFE_TITLE="${SAFE_TITLE//\"/\\\"}"

# ── Validate body input for non-interactive mode ─────────────────────────────

if $NON_INTERACTIVE; then
  # Check that exactly one body source is provided
  if [ -n "$BODY_FILE" ] && [ -n "$BODY" ]; then
    echo "ERROR: Cannot specify both --body-file and --body. Choose one." >&2
    exit 1
  fi
  
  if [ -z "$BODY_FILE" ] && [ -z "$BODY" ]; then
    echo "ERROR: --body-file or --body required in non-interactive mode." >&2
    exit 1
  fi
  
  # Validate body file if provided
  if [ -n "$BODY_FILE" ]; then
    if [ ! -f "$BODY_FILE" ]; then
      echo "ERROR: Body file not found: $BODY_FILE" >&2
      exit 1
    fi
    
    if [ ! -r "$BODY_FILE" ]; then
      echo "ERROR: Cannot read body file: $BODY_FILE" >&2
      exit 1
    fi
  fi
fi

# ── Build description ─────────────────────────────────────────────────────────

DESCRIPTION_FILE=$(mktemp /tmp/agile-flow-report-XXXXXX.md)
trap 'rm -f "$DESCRIPTION_FILE"' EXIT

# Handle body content based on flags or interactive mode
if [ -n "$BODY_FILE" ]; then
  # Use provided body file
  cp "$BODY_FILE" "$DESCRIPTION_FILE"
elif [ -n "$BODY" ]; then
  # Use provided body text
  printf '%s\n' "$BODY" > "$DESCRIPTION_FILE"
elif $NON_INTERACTIVE; then
  # This should not happen due to earlier validation, but fail-safe
  echo "ERROR: No body content provided in non-interactive mode." >&2
  exit 1
else
  # Interactive mode: create template and let user edit
  cat > "$DESCRIPTION_FILE" <<'TEMPLATE'
## Description

<!-- What is the problem? Be specific. -->

## Steps to Reproduce

1.
2.

## Expected Behaviour

<!-- What should happen? -->

## Actual Behaviour

<!-- What actually happens? -->

## Error Output

```
(paste error output here if applicable)
```

## Context

- Workshop date:
- Participants:
- Track:
TEMPLATE

  EDITOR="${EDITOR:-}"
  if [ -n "$EDITOR" ] && command -v "$EDITOR" >/dev/null 2>&1; then
    echo ""
    echo "Opening $EDITOR for description. Save and close when done."
    "$EDITOR" "$DESCRIPTION_FILE"
  else
    echo ""
    echo "Paste your description below."
    echo "Include: what happened, steps to reproduce, expected vs actual behaviour."
    echo "Enter a line with just '.' when done:"
    echo ""
    DESC_LINES=""
    while IFS= read -r line; do
      [ "$line" = "." ] && break
      DESC_LINES+="${line}"$'\n'
    done
    printf '%s' "$DESC_LINES" > "$DESCRIPTION_FILE"
  fi
fi

DESCRIPTION=$(cat "$DESCRIPTION_FILE")

# ── Write report file ─────────────────────────────────────────────────────────

mkdir -p "$REPORTS_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_FILE="$REPORTS_DIR/report-${TIMESTAMP}.md"

cat > "$REPORT_FILE" <<REPORT
---
agile_flow_report: true
upstream: $UPSTREAM_URL
fork_commit: $FORK_COMMIT
upstream_version: $UPSTREAM_VERSION
severity: $SEVERITY
component: $COMPONENT
title: "$SAFE_TITLE"
---

$DESCRIPTION
REPORT

echo "Report   : $REPORT_FILE"
echo ""

# ── Deliver via gh issue create ───────────────────────────────────────────────

ISSUE_TITLE="[downstream-report] $TITLE"
GH_FAILED=false

if command -v gh >/dev/null 2>&1; then
  echo "Submitting to $UPSTREAM_REPO..."
  if gh issue create \
      --repo "$UPSTREAM_REPO" \
      --title "$ISSUE_TITLE" \
      --label "downstream-report" \
      --body-file "$REPORT_FILE"; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Issue filed successfully."
    echo "Report saved: $REPORT_FILE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
  else
    GH_FAILED=true
    echo "" >&2
    echo "WARNING: gh issue create failed. Falling back to manual submission." >&2
  fi
else
  GH_FAILED=true
  echo "gh CLI not found. Falling back to manual submission." >&2
fi

# ── Fallback: clipboard + browser URL ────────────────────────────────────────

ENCODED_TITLE=""
ENCODED_BODY=""
if command -v python3 >/dev/null 2>&1; then
  ENCODED_TITLE=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ISSUE_TITLE" 2>/dev/null || echo "")
  ENCODED_BODY=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open(sys.argv[1]).read()))" "$REPORT_FILE" 2>/dev/null || echo "")
fi

BROWSER_URL="https://github.com/${UPSTREAM_REPO}/issues/new?title=${ENCODED_TITLE}&body=${ENCODED_BODY}&labels=downstream-report"

# Try clipboard
CLIPBOARD_CMD=""
if command -v pbcopy >/dev/null 2>&1; then
  CLIPBOARD_CMD="pbcopy"
elif command -v xclip >/dev/null 2>&1; then
  CLIPBOARD_CMD="xclip -selection clipboard"
elif command -v xsel >/dev/null 2>&1; then
  CLIPBOARD_CMD="xsel --clipboard --input"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "GitHub access unavailable — manual submission required."
echo ""
echo "Report saved: $REPORT_FILE"
echo ""

if [ -n "$CLIPBOARD_CMD" ]; then
  if $CLIPBOARD_CMD < "$REPORT_FILE" 2>/dev/null; then
    echo "Report body copied to clipboard."
    echo ""
  fi
fi

echo "Open this URL to file the issue in your browser:"
echo "$BROWSER_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
