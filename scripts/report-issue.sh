#!/usr/bin/env bash
# report-issue.sh — Report a downstream issue to the upstream Agile Flow repo.
#
# Usage:
#   bash scripts/report-issue.sh
#   bash scripts/report-issue.sh --severity p2 --component provisioning --title "short title"
#   bash scripts/report-issue.sh --dry-run --severity p2 --component docs --title "preview test" --body "Sample body"
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
FORCE_CODESPACES_TOKEN=false
DRY_RUN=false

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
  --dry-run              Preview what would be created without submitting
  --force-codespaces-token  Continue despite Codespaces token limitations
  --help, -h             Show this help message

Examples:
  # Interactive mode (prompts for inputs)
  bash scripts/report-issue.sh
  
  # Preview mode (shows what would be created)
  bash scripts/report-issue.sh --dry-run --severity p2 --component docs --title "Fix typo" --body "Sample body"
  
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
    --dry-run)         DRY_RUN=true;        shift ;;
    --force-codespaces-token) FORCE_CODESPACES_TOKEN=true; shift ;;
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

# ── Check for Codespaces token limitations ────────────────────────────────────

check_codespaces_token() {
  local is_codespaces=false
  local has_ghu_token=false
  
  # Check if we're running in GitHub Codespaces
  if [ "${CODESPACES:-}" = "true" ]; then
    is_codespaces=true
  fi
  
  # Check for ghu_* token pattern in gh auth status or GH_TOKEN
  if command -v gh >/dev/null 2>&1; then
    local auth_status
    auth_status=$(gh auth status 2>&1 || true)
    if echo "$auth_status" | grep -q "ghu_"; then
      has_ghu_token=true
    fi
  fi
  
  # Also check GH_TOKEN environment variable for ghu_* pattern
  if [ -n "${GH_TOKEN:-}" ] && [[ "${GH_TOKEN:-}" =~ ^ghu_ ]]; then
    has_ghu_token=true
  fi
  
  # Warn if both conditions are met and user hasn't forced through (skip check in dry-run mode)
  if $is_codespaces && $has_ghu_token && ! $FORCE_CODESPACES_TOKEN && ! $DRY_RUN; then
    echo "⚠️  WARNING: Codespaces Token Limitation Detected" >&2
    echo "" >&2
    echo "You are running in GitHub Codespaces with a default ghu_* token." >&2
    echo "This token cannot create issues on upstream repositories." >&2
    echo "" >&2
    echo "To resolve this issue:" >&2
    echo "1. Create a Personal Access Token (PAT) at:" >&2
    echo "   https://github.com/settings/tokens/new" >&2
    echo "" >&2
    echo "2. Grant these scopes:" >&2
    echo "   • repo (Full control of private repositories)" >&2
    echo "   • write:org (Write org and team membership)" >&2
    echo "" >&2
    echo "3. Set the token in your Codespace:" >&2
    echo "   export GH_TOKEN=ghp_your_token_here" >&2
    echo "   gh auth login --with-token <<<\"\$GH_TOKEN\"" >&2
    echo "" >&2
    echo "4. Re-run this script" >&2
    echo "" >&2
    echo "To continue anyway (advanced users only):" >&2
    echo "   $0 --force-codespaces-token [other flags]" >&2
    echo "" >&2
    exit 1
  fi
}

check_codespaces_token

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
  
  # Two-tier component selection to handle AskUserQuestion 4-option limit
  while true; do
    echo ""
    echo "Component (select main components or see more):"
    echo "  provisioning    setup, roster, env provisioning scripts"
    echo "  ci              GitHub Actions, CI/CD workflows"
    echo "  claude-commands /slash commands"
    echo "  docs            documentation"
    echo "  more            see additional components"
    printf "> "
    read -r COMPONENT
    
    case "$COMPONENT" in
      provisioning|ci|claude-commands|docs)
        break
        ;;
      more)
        echo ""
        echo "Additional components:"
        echo "  patterns        architectural patterns and practices"
        echo "  other           anything else"
        echo "  back            return to main components"
        printf "> "
        read -r COMPONENT
        
        case "$COMPONENT" in
          patterns|other)
            break
            ;;
          back)
            continue  # Go back to main component selection
            ;;
          *)
            echo "ERROR: Please select 'patterns', 'other', or 'back'." >&2
            ;;
        esac
        ;;
      *)
        echo "ERROR: Please select a valid component or 'more' for additional options." >&2
        ;;
    esac
  done
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

# ── Check if downstream-report label exists ────────────────────────────────────

check_downstream_label() {
  if command -v gh >/dev/null 2>&1; then
    # Check if the downstream-report label exists in the target repo
    if gh label list --repo "$UPSTREAM_REPO" 2>/dev/null | grep -q "downstream-report"; then
      return 0  # Label exists
    else
      return 1  # Label does not exist
    fi
  else
    return 1  # gh CLI not available, assume label doesn't exist
  fi
}

# ── Dry-run preview ────────────────────────────────────────────────────────────

if $DRY_RUN; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "=== DRY RUN PREVIEW ==="
  echo "Issue would be created as:"
  echo ""
  echo "Repository: $UPSTREAM_REPO"
  echo "Title: [downstream-report] $TITLE"
  
  # Check if downstream-report label exists and show what labels would be applied
  if check_downstream_label; then
    echo "Labels: downstream-report"
  else
    echo "Labels: (none - downstream-report label not found in target repo)"
  fi
  
  echo ""
  echo "Body:"
  echo "────────────────────────────────────────────────────────"
  cat "$REPORT_FILE"
  echo "────────────────────────────────────────────────────────"
  echo ""
  echo "DRY RUN - No issue created"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

# ── Deliver via gh issue create ───────────────────────────────────────────────

ISSUE_TITLE="[downstream-report] $TITLE"

if command -v gh >/dev/null 2>&1; then
  echo "Submitting to $UPSTREAM_REPO..."
  
  # Check if downstream-report label exists and create issue accordingly
  if check_downstream_label; then
    # Create issue with label - capture stderr for better error reporting
    set +e  # Temporarily disable exit on error to capture output
    error_output=$(gh issue create \
        --repo "$UPSTREAM_REPO" \
        --title "$ISSUE_TITLE" \
        --label "downstream-report" \
        --body-file "$REPORT_FILE" 2>&1)
    gh_exit_code=$?
    set -e  # Re-enable exit on error
    if [ $gh_exit_code -eq 0 ]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "Issue filed successfully."
      echo "Report saved: $REPORT_FILE"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      exit 0
    else
      echo "" >&2
      if [ -n "$error_output" ]; then
        echo "WARNING: Issue creation failed: $error_output. Falling back to manual submission." >&2
      else
        echo "WARNING: Issue creation failed. Falling back to manual submission." >&2
      fi
    fi
  else
    # Create issue without label - capture stderr for better error reporting
    echo "Warning: 'downstream-report' label not found, creating issue without label" >&2
    set +e  # Temporarily disable exit on error to capture output
    error_output=$(gh issue create \
        --repo "$UPSTREAM_REPO" \
        --title "$ISSUE_TITLE" \
        --body-file "$REPORT_FILE" 2>&1)
    gh_exit_code=$?
    set -e  # Re-enable exit on error
    if [ $gh_exit_code -eq 0 ]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "Issue filed successfully."
      echo "Report saved: $REPORT_FILE"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      exit 0
    else
      echo "" >&2
      if [ -n "$error_output" ]; then
        echo "WARNING: Issue creation failed: $error_output. Falling back to manual submission." >&2
      else
        echo "WARNING: Issue creation failed. Falling back to manual submission." >&2
      fi
    fi
  fi
else
  echo "gh CLI not found. Falling back to manual submission." >&2
fi

# ── Fallback: clipboard + browser URL ────────────────────────────────────────

ENCODED_TITLE=""
ENCODED_BODY=""
if command -v python3 >/dev/null 2>&1; then
  ENCODED_TITLE=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ISSUE_TITLE" 2>/dev/null || echo "")
  ENCODED_BODY=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open(sys.argv[1]).read()))" "$REPORT_FILE" 2>/dev/null || echo "")
fi

# Build URL with conditional label parameter
BROWSER_URL="https://github.com/${UPSTREAM_REPO}/issues/new?title=${ENCODED_TITLE}&body=${ENCODED_BODY}"
if check_downstream_label; then
  BROWSER_URL="${BROWSER_URL}&labels=downstream-report"
fi

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
