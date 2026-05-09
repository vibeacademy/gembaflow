#!/usr/bin/env bash
# pull-upstream.sh — Pull framework updates from vibeacademy/agile-flow.
#
# Safe to run mid-workshop. Only updates files listed in syncDirectories
# in .agile-flow-version; respects the excludeFromSync exclusion list.
#
# Usage:
#   bash scripts/pull-upstream.sh [--dry-run] [--direct]
#
# Options:
#   --dry-run   Show what would change; make no modifications
#   --direct    Apply changes directly to the current branch (no PR)

set -euo pipefail

###############################################################################
# Config
###############################################################################

UPSTREAM_REMOTE="upstream"
UPSTREAM_URL="https://github.com/vibeacademy/agile-flow.git"
UPSTREAM_BRANCH="main"
VERSION_FILE=".agile-flow-version"

DRY_RUN=false
DIRECT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --direct)  DIRECT=true;  shift ;;
    *) echo "ERROR: Unknown option: $1"; exit 1 ;;
  esac
done

###############################################################################
# 1. Read config from .agile-flow-version
###############################################################################

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "ERROR: $VERSION_FILE not found. Is this an Agile Flow repo?"
  exit 1
fi

UPSTREAM_COMMIT=$(python3 -c "
import json
data = json.load(open('$VERSION_FILE'))
print(data.get('upstreamCommit', ''))
")

if [[ -z "$UPSTREAM_COMMIT" ]]; then
  echo "ERROR: 'upstreamCommit' not set in $VERSION_FILE."
  echo "Add the SHA of the upstream commit you forked from, e.g.:"
  echo '  { "upstreamCommit": "b9bd5e3830a9fd3d2cfd64fccbd82876695493c6", ... }'
  exit 1
fi

readarray -t SYNC_DIRS < <(python3 -c "
import json
data = json.load(open('$VERSION_FILE'))
print('\n'.join(data.get('syncDirectories', [])))
" | grep -v '^$')

readarray -t EXCLUDE_PATHS < <(python3 -c "
import json
data = json.load(open('$VERSION_FILE'))
print('\n'.join(data.get('excludeFromSync', [])))
" | grep -v '^$')

###############################################################################
# 2. Verify clean working tree
###############################################################################

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree has uncommitted changes."
  echo "Commit or stash before syncing:"
  echo "  git stash && bash scripts/pull-upstream.sh"
  exit 1
fi

###############################################################################
# 3. Add upstream remote if missing
###############################################################################

if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
  echo "Adding upstream remote: $UPSTREAM_URL"
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

###############################################################################
# 4. Fetch upstream
###############################################################################

echo "Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH..."
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --quiet

UPSTREAM_HEAD=$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")

if [[ "$UPSTREAM_HEAD" == "$UPSTREAM_COMMIT" ]]; then
  echo "Already up to date. (upstream head: ${UPSTREAM_COMMIT:0:8})"
  echo ""
  echo "=== PULL_UPSTREAM_SUMMARY ==="
  echo "STATUS=already_up_to_date"
  echo "UPSTREAM_HEAD=${UPSTREAM_HEAD:0:8}"
  echo "=== END_SUMMARY ==="
  exit 0
fi

###############################################################################
# 5. Show new upstream commits
###############################################################################

echo ""
echo "New upstream commits since ${UPSTREAM_COMMIT:0:8}:"
git log --oneline "$UPSTREAM_COMMIT..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
echo ""

###############################################################################
# 6. Classify changed files: APPLY vs SKIP
###############################################################################

CHANGED_FILES=$(git diff --name-only "$UPSTREAM_COMMIT" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")

APPLY_FILES=()
SKIP_FILES=()

while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  # Check if file falls under a sync directory
  in_sync_dir=false
  for dir in "${SYNC_DIRS[@]}"; do
    if [[ "$file" == "$dir/"* || "$file" == "$dir" ]]; then
      in_sync_dir=true
      break
    fi
  done

  if ! $in_sync_dir; then
    SKIP_FILES+=("$file  (not in syncDirectories)")
    continue
  fi

  # Check if file is explicitly excluded
  is_excluded=false
  for exc in "${EXCLUDE_PATHS[@]}"; do
    if [[ "$file" == "$exc" ]]; then
      is_excluded=true
      break
    fi
  done

  if $is_excluded; then
    SKIP_FILES+=("$file  (excluded — local customization preserved)")
    continue
  fi

  APPLY_FILES+=("$file")
done <<< "$CHANGED_FILES"

###############################################################################
# 7. Report plan
###############################################################################

echo "Files to apply  (${#APPLY_FILES[@]}):"
for f in "${APPLY_FILES[@]}"; do
  echo "  APPLY  $f"
done

if [[ ${#SKIP_FILES[@]} -gt 0 ]]; then
  echo ""
  echo "Files to skip   (${#SKIP_FILES[@]}):"
  for f in "${SKIP_FILES[@]}"; do
    echo "  SKIP   $f"
  done
fi

if [[ ${#APPLY_FILES[@]} -eq 0 ]]; then
  echo ""
  echo "No tracked files changed in upstream. Advancing upstreamCommit."
  if ! $DRY_RUN; then
    python3 - "$UPSTREAM_HEAD" "$VERSION_FILE" <<'PYEOF'
import json, sys
sha, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data['upstreamCommit'] = sha
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
PYEOF
    git add "$VERSION_FILE"
    git commit -m "chore(upstream): advance to agile-flow@${UPSTREAM_HEAD:0:8}

No tracked framework files changed between ${UPSTREAM_COMMIT:0:8} and ${UPSTREAM_HEAD:0:8}.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
  fi
  exit 0
fi

if $DRY_RUN; then
  echo ""
  echo "Dry run — no changes made."
  exit 0
fi

###############################################################################
# 8. Apply changes
###############################################################################

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SYNC_BRANCH="agile-flow-sync/upstream-${TIMESTAMP}"

if ! $DIRECT; then
  git checkout -b "$SYNC_BRANCH"
fi

APPLIED=()
REMOVED=()

for file in "${APPLY_FILES[@]}"; do
  # Check if file still exists in upstream (may have been deleted)
  if git ls-tree "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" -- "$file" | grep -q .; then
    mkdir -p "$(dirname "$file")"
    git checkout "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" -- "$file"
    APPLIED+=("$file")
    echo "APPLIED: $file"
  elif [[ -f "$file" ]]; then
    git rm "$file"
    REMOVED+=("$file")
    echo "REMOVED: $file"
  fi
done

# Advance upstreamCommit
python3 - "$UPSTREAM_HEAD" "$VERSION_FILE" <<'PYEOF'
import json, sys
sha, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data['upstreamCommit'] = sha
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
PYEOF
git add "$VERSION_FILE"

###############################################################################
# 9. Commit and (optionally) create PR
###############################################################################

COMMIT_MSG="chore(upstream): sync framework from agile-flow@${UPSTREAM_HEAD:0:8}

Applied ${#APPLIED[@]} file(s); skipped ${#SKIP_FILES[@]} stack-specific file(s).
Previous upstreamCommit: ${UPSTREAM_COMMIT:0:8}

Co-Authored-By: Paperclip <noreply@paperclip.ing>"

git commit -m "$COMMIT_MSG"

if $DIRECT; then
  echo ""
  echo "Applied directly to current branch."
  echo "Run your test suite to verify:"
  echo "  uv sync --extra dev && uv run pytest"
  echo ""
  echo "=== PULL_UPSTREAM_SUMMARY ==="
  echo "STATUS=applied"
  echo "UPSTREAM_HEAD=${UPSTREAM_HEAD:0:8}"
  echo "APPLIED=${#APPLIED[@]}"
  echo "SKIPPED=${#SKIP_FILES[@]}"
  echo "=== END_SUMMARY ==="
  exit 0
fi

# Push and open PR
git push origin "$SYNC_BRANCH"

# Build PR body
APPLIED_LIST=""
for f in "${APPLIED[@]}"; do APPLIED_LIST="${APPLIED_LIST}- \`${f}\`"$'\n'; done

SKIP_LIST_BODY=""
for f in "${SKIP_FILES[@]}"; do SKIP_LIST_BODY="${SKIP_LIST_BODY}- ${f}"$'\n'; done

PR_BODY="## Upstream Sync

Pulls framework updates from [vibeacademy/agile-flow](https://github.com/vibeacademy/agile-flow).

| Field | Value |
|---|---|
| Previous sync | \`${UPSTREAM_COMMIT:0:8}\` |
| Upstream HEAD | \`${UPSTREAM_HEAD:0:8}\` |

### Applied (${#APPLIED[@]} files)

${APPLIED_LIST}
$(if [[ ${#SKIP_FILES[@]} -gt 0 ]]; then echo "### Skipped — stack-specific or excluded (${#SKIP_FILES[@]} files)"; echo ""; echo "${SKIP_LIST_BODY}"; fi)
---
*Generated by \`scripts/pull-upstream.sh\`. Review changes before merging.*"

PR_URL=$(gh pr create \
  --title "chore(upstream): sync framework from agile-flow@${UPSTREAM_HEAD:0:8}" \
  --body "$PR_BODY" \
  --base main \
  --head "$SYNC_BRANCH")

echo ""
echo "PR created: $PR_URL"
echo "Review and merge when ready."
echo ""
echo "=== PULL_UPSTREAM_SUMMARY ==="
echo "STATUS=pr_created"
echo "UPSTREAM_HEAD=${UPSTREAM_HEAD:0:8}"
echo "APPLIED=${#APPLIED[@]}"
echo "SKIPPED=${#SKIP_FILES[@]}"
echo "PR_URL=$PR_URL"
echo "=== END_SUMMARY ==="
