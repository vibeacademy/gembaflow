#!/usr/bin/env bash
# template-sync.sh -- Sync framework files from vibeacademy/agile-flow releases.
# Called by .github/workflows/template-sync.yml (workflow_dispatch only).
# Guardrails:
#   - Only syncs directories/files listed in syncDirectories (.agile-flow-version)
#   - Respects .agile-flow-overrides — fork-local paths/globs are never touched
#   - Does NOT auto-merge; PR requires human review
#   - Uses unauthenticated GitHub API to fetch release metadata

# If invoked via `sh scripts/template-sync.sh`, re-exec with bash so bash-only
# features below (arrays/process substitution) do not crash at runtime.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

main() {
set -euo pipefail

UPSTREAM_REPO="vibeacademy/agile-flow"
VERSION_FILE=".agile-flow-version"
OVERRIDES_FILE=".agile-flow-overrides"
RUNNING_SCRIPT_REL=$(python3 -c "import os,sys; print(os.path.relpath(os.path.realpath(sys.argv[1]), os.getcwd()))" "$0")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/overrides.sh
source "$SCRIPT_DIR/lib/overrides.sh"

# Runtime-critical files must never be overwritten while this script is running.
# The overrides file is user-configurable, so we enforce these guards in code.
RUNTIME_PROTECTED_PATHS=(
  "scripts/template-sync.sh"
  "scripts/lib/overrides.sh"
)

normalize_rel_path() {
  local path="$1"
  while [[ "$path" == ./* ]]; do
    path="${path#./}"
  done
  while [[ "$path" == *"//"* ]]; do
    path="${path//\/\//\/}"
  done
  path="${path%/}"
  printf '%s\n' "$path"
}

is_runtime_protected() {
  local path="$1"
  local normalized_path
  normalized_path="$(normalize_rel_path "$path")"
  local protected
  for protected in "${RUNTIME_PROTECTED_PATHS[@]}"; do
    if [ "$normalized_path" = "$(normalize_rel_path "$protected")" ]; then
      return 0
    fi
  done
  return 1
}

path_allowed_for_bootstrap_reentry() {
  local path="$1"
  local normalized_path
  local protected
  local sync_path

  normalized_path="$(normalize_rel_path "$path")"

  if [ "$normalized_path" = "$(normalize_rel_path "$VERSION_FILE")" ]; then
    return 0
  fi

  for protected in "${RUNTIME_PROTECTED_PATHS[@]}"; do
    if [ "$normalized_path" = "$(normalize_rel_path "$protected")" ] || [[ "$normalized_path" == "$(normalize_rel_path "$protected")/"* ]]; then
      return 0
    fi
  done

  while IFS= read -r sync_path; do
    [ -z "$sync_path" ] && continue
    sync_path="$(normalize_rel_path "$sync_path")"
    if [ "$normalized_path" = "$sync_path" ] || [[ "$normalized_path" == "$sync_path/"* ]]; then
      return 0
    fi
  done <<< "$SYNC_DIRS"

  return 1
}

bootstrap_reentry_dirty_tree_is_safe() {
  local status_line
  local changed_path

  while IFS= read -r status_line; do
    [ -z "$status_line" ] && continue
    changed_path="${status_line:3}"
    if [[ "$changed_path" == *" -> "* ]]; then
      changed_path="${changed_path##* -> }"
    fi
    if ! path_allowed_for_bootstrap_reentry "$changed_path"; then
      return 1
    fi
  done < <(git status --porcelain)

  return 0
}

###############################################################################
# 1. Read local version and syncDirectories
###############################################################################
if [ ! -f "$VERSION_FILE" ]; then
  echo "ERROR: $VERSION_FILE not found."
  exit 1
fi

LOCAL_VERSION=$(python3 -c "import json,sys; print(json.load(open('$VERSION_FILE'))['version'])")
SYNC_DIRS=$(python3 -c "
import json, sys
dirs = json.load(open('$VERSION_FILE')).get('syncDirectories', [])
print('\n'.join(dirs))
")

echo "Local version : $LOCAL_VERSION"
echo "Sync targets  : $SYNC_DIRS"

load_override_patterns "$OVERRIDES_FILE"
echo "Protected overrides: ${#OVERRIDE_PATTERNS[@]} pattern(s)"

###############################################################################
# 2. Fetch latest release from GitHub (unauthenticated)
###############################################################################
RELEASE_JSON=$(curl -sf "https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest") || {
  echo "ERROR: Could not fetch latest release from ${UPSTREAM_REPO}."
  exit 1
}

LATEST_VERSION=$(echo "$RELEASE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'].lstrip('v'))")
RELEASE_URL=$(echo "$RELEASE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['html_url'])")
TARBALL_URL=$(echo "$RELEASE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['tarball_url'])")

echo "Latest version: $LATEST_VERSION"

###############################################################################
# 3. Compare versions
###############################################################################
if [ "$LOCAL_VERSION" = "$LATEST_VERSION" ]; then
  echo "No updates available. Local version ($LOCAL_VERSION) matches latest release."
  exit 0
fi

echo "Update available: $LOCAL_VERSION -> $LATEST_VERSION"

###############################################################################
# 3a. Skip cleanly if the sync branch is already pushed (idempotent re-run)
###############################################################################
SYNC_BRANCH="agile-flow-sync/v${LATEST_VERSION}"

if git ls-remote --exit-code --heads origin "$SYNC_BRANCH" >/dev/null 2>&1; then
  echo "Sync branch '$SYNC_BRANCH' already exists on remote — nothing to do."
  if command -v gh >/dev/null 2>&1; then
    EXISTING_PR_URL=$(gh pr list --head "$SYNC_BRANCH" --state open --json url --jq '.[0].url // empty' 2>/dev/null || true)
    if [ -n "${EXISTING_PR_URL:-}" ]; then
      echo "Existing PR: $EXISTING_PR_URL"
    fi
  fi
  exit 0
fi

###############################################################################
# 4. Download and extract release tarball
###############################################################################
WORK_DIR=$(mktemp -d)
TARBALL="$WORK_DIR/release.tar.gz"

echo "Downloading release tarball..."
curl -sfL "$TARBALL_URL" -o "$TARBALL"
tar -xzf "$TARBALL" -C "$WORK_DIR"

# GitHub tarballs extract into a directory like owner-repo-hash/
EXTRACTED_DIR=$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)

if [ -z "$EXTRACTED_DIR" ]; then
  echo "ERROR: Could not find extracted release directory."
  rm -rf "$WORK_DIR"
  exit 1
fi

###############################################################################
# 5. Create pre-upgrade rollback tag (local-only safety net)
###############################################################################
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: not inside a git repository — cannot create rollback tag."
  rm -rf "$WORK_DIR"
  exit 1
fi

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  if bootstrap_reentry_dirty_tree_is_safe; then
    echo "WARNING: detected bootstrap re-entry with staged sync-target files; continuing upgrade."
  else
    echo "ERROR: working tree has uncommitted changes — refusing to upgrade without a clean rollback point."
    echo "Commit or stash your changes, then retry."
    rm -rf "$WORK_DIR"
    exit 1
  fi
fi

if ! git symbolic-ref -q HEAD >/dev/null; then
  echo "ERROR: HEAD is detached — refusing to upgrade without a branch to roll back to."
  rm -rf "$WORK_DIR"
  exit 1
fi

ROLLBACK_TAG="pre-upgrade-$(date +%Y%m%d-%H%M%S)"
if ! git tag "$ROLLBACK_TAG" 2>/dev/null; then
  echo "ERROR: failed to create rollback tag '$ROLLBACK_TAG'. Aborting."
  rm -rf "$WORK_DIR"
  exit 1
fi
echo "Created rollback tag: $ROLLBACK_TAG (local-only)"

###############################################################################
# 6. Sync each directory/file from syncDirectories
###############################################################################
FILES_CHANGED=()
FILES_SKIPPED_OVERRIDE=()
FILES_SKIPPED_RUNTIME=()

while IFS= read -r sync_path; do
  [ -z "$sync_path" ] && continue

  upstream_path="$EXTRACTED_DIR/$sync_path"

  if [ ! -e "$upstream_path" ]; then
    echo "SKIP: $sync_path not found in upstream release."
    continue
  fi

  if [ -d "$upstream_path" ]; then
    # Directory sync: iterate over each file in the upstream directory
    while IFS= read -r file; do
      rel_file="${file#"$upstream_path"/}"
      local_file="$sync_path/$rel_file"
      normalized_local_file="$(normalize_rel_path "$local_file")"
      upstream_file="$file"

      if is_runtime_protected "$normalized_local_file"; then
        echo "SKIP (runtime-protected): $normalized_local_file"
        FILES_SKIPPED_RUNTIME+=("$normalized_local_file")
        continue
      fi

      if is_override "$local_file"; then
        echo "SKIP (override): $local_file"
        FILES_SKIPPED_OVERRIDE+=("$local_file")
        continue
      fi
      if [ "$local_file" = "$RUNNING_SCRIPT_REL" ]; then
        echo "SKIP: $local_file is the currently running script."
        continue
      fi

      # Create parent directory if needed
      mkdir -p "$(dirname "$local_file")"

      if [ -f "$local_file" ]; then
        if ! diff -q "$upstream_file" "$local_file" >/dev/null 2>&1; then
          cp "$upstream_file" "$local_file"
          git add "$local_file"
          FILES_CHANGED+=("$local_file")
          echo "UPDATED: $local_file"
        fi
      else
        cp "$upstream_file" "$local_file"
        git add "$local_file"
        FILES_CHANGED+=("$local_file")
        echo "ADDED: $local_file"
      fi
    done < <(find "$upstream_path" -type f)
  else
    # Single file sync
    normalized_sync_path="$(normalize_rel_path "$sync_path")"
    if is_runtime_protected "$normalized_sync_path"; then
      echo "SKIP (runtime-protected): $normalized_sync_path"
      FILES_SKIPPED_RUNTIME+=("$normalized_sync_path")
      continue
    fi

    if is_override "$sync_path"; then
      echo "SKIP (override): $sync_path"
      FILES_SKIPPED_OVERRIDE+=("$sync_path")
      continue
    fi
    if [ "$sync_path" = "$RUNNING_SCRIPT_REL" ]; then
      echo "SKIP: $sync_path is the currently running script."
      continue
    fi

    if [ -f "$sync_path" ]; then
      if ! diff -q "$upstream_path" "$sync_path" >/dev/null 2>&1; then
        cp "$upstream_path" "$sync_path"
        git add "$sync_path"
        FILES_CHANGED+=("$sync_path")
        echo "UPDATED: $sync_path"
      fi
    else
      mkdir -p "$(dirname "$sync_path")"
      cp "$upstream_path" "$sync_path"
      git add "$sync_path"
      FILES_CHANGED+=("$sync_path")
      echo "ADDED: $sync_path"
    fi
  fi
done <<< "$SYNC_DIRS"

if [ "${#FILES_SKIPPED_OVERRIDE[@]}" -gt 0 ]; then
  echo "Skipped ${#FILES_SKIPPED_OVERRIDE[@]} override(s) — kept local versions."
fi

if [ "${#FILES_SKIPPED_RUNTIME[@]}" -gt 0 ]; then
  echo "Skipped ${#FILES_SKIPPED_RUNTIME[@]} runtime-protected file(s)."
fi

###############################################################################
# 7. Clean up
###############################################################################
rm -rf "$WORK_DIR"

###############################################################################
# 8. If no files changed, exit
###############################################################################
if [ ${#FILES_CHANGED[@]} -eq 0 ]; then
  echo "Already up to date. All synced files match the latest release."
  exit 0
fi

###############################################################################
# 9. Create branch, commit, and open PR
###############################################################################
# SYNC_BRANCH was computed and verified absent on remote in step 3a above.

git checkout -b "$SYNC_BRANCH"

# Update .agile-flow-version with the new version
python3 -c "
import json
with open('$VERSION_FILE', 'r') as f:
    data = json.load(f)
data['version'] = '$LATEST_VERSION'
with open('$VERSION_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"
git add "$VERSION_FILE"

COMMIT_MSG="chore(sync): update Agile Flow framework to v${LATEST_VERSION}"
# Scope the bot identity to this single commit using -c so running locally
# does NOT overwrite the user's per-repo git author config.
git -c user.name="github-actions[bot]" \
    -c user.email="github-actions[bot]@users.noreply.github.com" \
    commit -m "$COMMIT_MSG"
git push origin "$SYNC_BRANCH"

# Build file list for PR body
FILE_LIST=""
for f in "${FILES_CHANGED[@]}"; do
  FILE_LIST="${FILE_LIST}- \`${f}\`
"
done

PR_BODY="## Agile Flow Framework Update

Updates framework files from \`v${LOCAL_VERSION}\` to \`v${LATEST_VERSION}\`.

### Updated files

${FILE_LIST}
### Release notes

See the full release notes: ${RELEASE_URL}

---
> This PR was created automatically by the template-sync workflow.
> **Please review the changes before merging.**"

gh pr create \
  --title "chore(sync): update Agile Flow framework to v${LATEST_VERSION}" \
  --body "$PR_BODY" \
  --base main \
  --head "$SYNC_BRANCH"

echo ""
echo "===================== Summary ====================="
echo "PR created successfully for v${LATEST_VERSION}."
echo "Rollback: git reset --hard $ROLLBACK_TAG"
echo "==================================================="
}

main "$@"
