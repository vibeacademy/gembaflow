#!/usr/bin/env bash
# upgrade.sh — Upgrade Agile Flow framework from upstream.
#
# Usage:
#   bash scripts/upgrade.sh [--interactive|--accept-upstream|--abort-on-conflict]
#   bash scripts/upgrade.sh --continue   (after manually resolving conflicts)
#
# Exit codes:
#   0  — success (up to date or changes applied)
#   1  — error (dirty tree, fetch failure, abort-on-conflict with conflicts)
#   2  — conflicts found in interactive mode; resolve and re-run with --continue

set -euo pipefail

META_DIR=".agile-flow-meta"
OVERRIDES_FILE=".agile-flow-overrides"
PENDING_SHA_FILE="$META_DIR/.upgrade-pending-sha"

# ── Parse flags ───────────────────────────────────────────────────────────────

MODE="interactive"
CONTINUE=false

for arg in "$@"; do
  case "$arg" in
    --interactive)       MODE="interactive" ;;
    --accept-upstream)   MODE="accept-upstream" ;;
    --abort-on-conflict) MODE="abort-on-conflict" ;;
    --continue)          CONTINUE=true ;;
    *) echo "ERROR: Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────

list_conflicts() {
  git ls-files --unmerged 2>/dev/null | awk '{print $4}' | sort -u
}

# ── Continue path (after manual conflict resolution) ─────────────────────────

if $CONTINUE; then
  CONFLICT_FILES=$(list_conflicts)
  if [ -n "$CONFLICT_FILES" ]; then
    echo "ERROR: Unresolved conflicts remain:" >&2
    echo "$CONFLICT_FILES" | while read -r f; do echo "  - $f" >&2; done
    echo "" >&2
    echo "Resolve all conflicts, then run: bash scripts/upgrade.sh --continue" >&2
    exit 1
  fi

  UPSTREAM_SHA=""
  if [ -f "$PENDING_SHA_FILE" ]; then
    UPSTREAM_SHA=$(cat "$PENDING_SHA_FILE")
  elif git rev-parse MERGE_HEAD >/dev/null 2>&1; then
    UPSTREAM_SHA=$(git rev-parse MERGE_HEAD)
  else
    echo "ERROR: No pending upgrade found. Was git merge --abort run?" >&2
    exit 1
  fi

  UPSTREAM_REF=$(git describe --tags "$UPSTREAM_SHA" 2>/dev/null || echo "${UPSTREAM_SHA:0:12}")
  echo "$UPSTREAM_REF @ $UPSTREAM_SHA" > "$META_DIR/version"
  git add "$META_DIR/version"

  git -c user.name="upgrade" -c user.email="noreply@github.com" \
    commit -m "chore(upgrade): sync from upstream @ ${UPSTREAM_SHA:0:7}"

  rm -f "$PENDING_SHA_FILE"
  echo ""
  echo "Upgrade complete!"
  echo "Version: $(cat "$META_DIR/version")"
  exit 0
fi

# ── Pre-flight: clean working tree ────────────────────────────────────────────

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: Working tree has uncommitted changes." >&2
  echo "Commit or stash before upgrading:" >&2
  echo "  git stash" >&2
  echo "  bash scripts/upgrade.sh" >&2
  exit 1
fi

# ── Discover upstream URL ────────────────────────────────────────────────────

UPSTREAM_URL=""
if [ -f "$META_DIR/upstream" ]; then
  UPSTREAM_URL=$(cat "$META_DIR/upstream")
elif git remote get-url upstream >/dev/null 2>&1; then
  UPSTREAM_URL=$(git remote get-url upstream)
else
  printf "What upstream does this fork track?\n(e.g., https://github.com/vibeacademy/agile-flow)\n> "
  read -r UPSTREAM_URL
  if [ -z "$UPSTREAM_URL" ]; then
    echo "ERROR: No upstream URL provided." >&2
    exit 1
  fi
  mkdir -p "$META_DIR"
  echo "$UPSTREAM_URL" > "$META_DIR/upstream"
  git add "$META_DIR/upstream"
  git -c user.name="upgrade" -c user.email="noreply@github.com" \
    commit -m "chore: record upstream URL in .agile-flow-meta/upstream"
  echo "Upstream URL saved to $META_DIR/upstream."
fi

echo "Upstream : $UPSTREAM_URL"

# ── Create rollback tag ───────────────────────────────────────────────────────

ROLLBACK_TAG="pre-upgrade-$(date +%Y%m%d-%H%M%S)"
git tag -f "$ROLLBACK_TAG"
echo "Rollback : $ROLLBACK_TAG"

# ── Fetch upstream ────────────────────────────────────────────────────────────

echo "Fetching..."
if ! git fetch "$UPSTREAM_URL" main 2>&1; then
  echo "" >&2
  echo "ERROR: Could not fetch from $UPSTREAM_URL" >&2
  echo "Check your network connection or upstream URL and try again." >&2
  exit 1
fi

UPSTREAM_SHA=$(git rev-parse FETCH_HEAD)
echo "Upstream : ${UPSTREAM_SHA:0:12}"

# Save SHA for --continue path
echo "$UPSTREAM_SHA" > "$PENDING_SHA_FILE"

# ── Show diff summary ─────────────────────────────────────────────────────────

DIFF_STAT=$(git diff --stat HEAD FETCH_HEAD 2>/dev/null || true)
if [ -z "$DIFF_STAT" ]; then
  echo ""
  echo "Already up to date with upstream."
  rm -f "$PENDING_SHA_FILE"
  exit 0
fi

echo ""
echo "Changes incoming from upstream:"
echo "$DIFF_STAT"
echo ""

# ── Attempt merge ─────────────────────────────────────────────────────────────

echo "Merging (no-commit)..."
MERGE_EXIT=0
git merge --no-commit --no-ff FETCH_HEAD 2>&1 || MERGE_EXIT=$?

# ── Apply overrides — restore our version for each protected path ─────────────

OVERRIDES_APPLIED=()
OVERRIDES_UPSTREAM_CHANGED=()

if [ -f "$OVERRIDES_FILE" ]; then
  while IFS= read -r pattern; do
    [[ "$pattern" =~ ^#.*$ || -z "$pattern" ]] && continue

    # Warn if this path changed upstream
    if ! git diff --quiet HEAD FETCH_HEAD -- "$pattern" 2>/dev/null; then
      OVERRIDES_UPSTREAM_CHANGED+=("$pattern")
    fi

    # Restore our version (resolves conflicts in override paths to ours)
    if git checkout HEAD -- "$pattern" 2>/dev/null; then
      git add "$pattern" 2>/dev/null || true
      OVERRIDES_APPLIED+=("$pattern")
    fi
  done < "$OVERRIDES_FILE"
fi

if [ ${#OVERRIDES_APPLIED[@]} -gt 0 ]; then
  echo "Override-protected (kept local version):"
  for p in "${OVERRIDES_APPLIED[@]}"; do echo "  - $p"; done
fi

if [ ${#OVERRIDES_UPSTREAM_CHANGED[@]} -gt 0 ]; then
  echo ""
  echo "NOTE: These override-protected paths also changed upstream."
  echo "      Review manually if you want to adopt the upstream changes:"
  for p in "${OVERRIDES_UPSTREAM_CHANGED[@]}"; do echo "  ! $p"; done
fi

# ── Handle remaining conflicts (non-override paths) ───────────────────────────

CONFLICT_FILES=$(list_conflicts)

if [ -n "$CONFLICT_FILES" ]; then
  echo ""
  echo "Conflicts in:"
  echo "$CONFLICT_FILES" | while read -r f; do echo "  - $f"; done

  case "$MODE" in
    abort-on-conflict)
      echo ""
      echo "Mode: abort-on-conflict — rolling back."
      git merge --abort
      rm -f "$PENDING_SHA_FILE"
      echo "Rolled back. Rollback tag: $ROLLBACK_TAG"
      exit 1
      ;;
    accept-upstream)
      echo ""
      echo "Mode: accept-upstream — taking upstream version for conflicted files."
      echo "$CONFLICT_FILES" | while read -r f; do
        git checkout --theirs "$f"
        git add "$f"
      done
      ;;
    interactive)
      echo ""
      echo "Mode: interactive — resolve conflicts, then run:"
      echo "  bash scripts/upgrade.sh --continue"
      echo ""
      echo "To abort and roll back:"
      echo "  git merge --abort"
      echo "  git tag -d $ROLLBACK_TAG"
      exit 2
      ;;
  esac
fi

# ── Write version and commit ──────────────────────────────────────────────────

UPSTREAM_REF=$(git describe --tags FETCH_HEAD 2>/dev/null || echo "${UPSTREAM_SHA:0:12}")
echo "$UPSTREAM_REF @ $UPSTREAM_SHA" > "$META_DIR/version"
git add "$META_DIR/version"

git -c user.name="upgrade" -c user.email="noreply@github.com" \
  commit -m "chore(upgrade): sync from upstream @ ${UPSTREAM_SHA:0:7}"

rm -f "$PENDING_SHA_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Upgrade complete!"
echo "Version : $(cat "$META_DIR/version")"
echo "Rollback: git checkout $ROLLBACK_TAG  (if needed)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
