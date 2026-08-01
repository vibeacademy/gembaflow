#!/usr/bin/env bash
# scripts/migrate-issues-to-beads.sh — migrate open GitHub issues into the
# beads (bd) tracker.
#
# Generalized from the reference fork's proven one-time cutover tool (33
# issues migrated, idempotent, keyed by --external-ref). Nothing in this
# script is fork-specific: the repo is parameterized, the external-ref
# prefix is an option, and every framework convention it encodes lives in
# CLAUDE.md § "Work-Item Tracking (Beads)" and docs/BEADS.md.
#
# Usage:
#   scripts/migrate-issues-to-beads.sh [options]                # dry-run (default)
#   scripts/migrate-issues-to-beads.sh --execute [options]      # create beads + wire deps
#   scripts/migrate-issues-to-beads.sh --close-github [options] # ALSO close migrated gh
#                                                               # issues (implies --execute;
#                                                               # separate opt-in because it
#                                                               # is outward-facing and hard
#                                                               # to reverse)
# Options:
#   --repo <owner/repo>     GitHub repo to export from (default: the repo gh
#                           resolves from the current directory)
#   --ref-prefix <prefix>   external-ref prefix for the idempotency key
#                           (default: gh-). Repo-qualify it when several
#                           repos migrate into ONE beads tracker — e.g.
#                           --ref-prefix gh-myrepo- — because bare gh-N
#                           collides across repos.
#   --limit <n>             max issues to export (default: 200)
#   --export-file <path>    reuse an existing export JSON instead of calling
#                           `gh issue list` (offline re-runs / fixtures)
#
# What it does:
#   0. Version gate (scripts/check-bd.sh) + capability probe: assert the
#      pinned bd supports every flag this script uses.
#   1. Export open issues to reports/beads-migration/export-<date>.json.
#   2. Pass 1 — epics (label "epic") -> bd create --type=epic.
#   3. Pass 2 — everything else     -> bd create --type=task|bug.
#      Body preserved VERBATIM (the 4 Power Sections are the DoR payload).
#      Priority: P<k> line -> -p k; Effort Estimate: X -> label effort:X;
#      GitHub labels carried 1:1.
#   4. Dependency wiring: "Parent Epic: #N" -> bd update --parent;
#      "Depends on: #X" / "Blocks: #Y" -> bd dep add with EXPLICIT direction
#      (never bare bd link). Epic membership is parent-child, never blocking.
#   5. Verification gate (fails loudly): counts match, bd dep cycles empty,
#      bd ready printed for the operator to eyeball.
#   6. (--close-github only) Close each migrated issue with a pointer comment
#      and file + pin a signpost issue.
#
# Idempotency (migration scripts WILL die mid-run — this one is safe to
# re-run until it converges):
#   - Every migrated bead carries --external-ref <prefix><N>; the id-map at
#     reports/beads-migration/id-map.tsv is the working index of that key.
#   - On every run the id-map is FIRST reconciled against bd's own state
#     (`bd list --json --all`): a bead created moments before a crash — even
#     one that never reached the id-map — is re-discovered by its
#     external-ref, never duplicated.
#   - Creates skip already-migrated issues; `bd update --parent` and
#     `bd dep add` are idempotent in the pinned bd (re-adding is a no-op).
#   - A second run after success is a provable no-op: the run summary
#     prints "created 0" and the id-map is unchanged.
#
# After a successful run, the operator syncs deliberately: bd dolt push.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --- globals (finalized in main) ---------------------------------------------
MODE="dry-run"
CLOSE_GITHUB=0
REPO=""
REF_PREFIX="gh-"
LIMIT=200
EXPORT_FILE=""
OUT_DIR="reports/beads-migration"
STAMP=""
EXPORT=""
ID_MAP=""
LOG=""
CREATED=0
SKIPPED=0

log() { echo "$*" | tee -a "$LOG"; }

# gh repo routing: -R <repo> only when --repo was given (bash-3.2 empty-array
# guard applies at every expansion site).
gh_repo_args=()

# --- parsing helpers (pure; unit-tested via `source` + direct calls) ---------

# parse_priority BODY -> "0".."4" (default 2 when no Priority: P<k> line)
parse_priority() {
  local prio
  prio=$(printf '%s\n' "$1" | sed -n 's/^Priority:[[:space:]]*P\([0-4]\).*/\1/p' | head -1)
  printf '%s' "${prio:-2}"
}

# parse_effort BODY -> "S"/"M"/"L"/"XL"/... or empty when absent
parse_effort() {
  printf '%s\n' "$1" | sed -n 's/^Effort Estimate:[[:space:]]*\([A-Za-z]*\).*/\1/p' | head -1
}

# parse_parent_epic BODY -> issue number or empty
parse_parent_epic() {
  printf '%s\n' "$1" | sed -n 's/^Parent Epic:[[:space:]]*#\([0-9]*\).*/\1/p' | head -1
}

# parse_depends_on BODY -> issue numbers, one per line
parse_depends_on() {
  printf '%s\n' "$1" | sed -n 's/^Depends on:[[:space:]]*#\([0-9]*\).*/\1/p'
}

# parse_blocks BODY -> issue numbers, one per line
parse_blocks() {
  printf '%s\n' "$1" | sed -n 's/^Blocks:[[:space:]]*#\([0-9]*\).*/\1/p'
}

# issue_type LABELS_CSV IS_EPIC -> epic|bug|task
issue_type() {
  if [ "$2" = "1" ]; then printf 'epic'
  elif printf '%s' "$1" | grep -q '\bbug\b'; then printf 'bug'
  else printf 'task'; fi
}

# external_ref N -> the idempotency key for issue N under the active prefix
external_ref() { printf '%s%s' "$REF_PREFIX" "$1"; }

# bead_for N -> bead id from the id-map (empty when not yet migrated)
bead_for() {
  awk -F'\t' -v ref="$(external_ref "$1")" '$1 == ref { print $2 }' "$ID_MAP"
}

# --- id-map reconciliation (the mid-run-death recovery path) -----------------
# bd state is ground truth: any bead whose external_ref carries our prefix
# but is missing from the id-map (crash between `bd create` and the id-map
# append, or a deleted id-map) is re-indexed here instead of re-created.
reconcile_id_map() {
  local line ref id
  while IFS=$'\t' read -r ref id; do
    [ -n "$ref" ] || continue
    if ! awk -F'\t' -v r="$ref" '$1 == r { found=1 } END { exit !found }' "$ID_MAP"; then
      printf '%s\t%s\t%s\n' "$ref" "$id" "(recovered from bd state)" >> "$ID_MAP"
      log "reconciled: $ref -> $id (bead existed in bd but not in id-map)"
    fi
  done < <(bd list --json --all -n 0 2>/dev/null \
    | jq -r --arg p "$REF_PREFIX" \
        '.[] | select((.external_ref // "") | startswith($p)) | [.external_ref, .id] | @tsv')
}

# --- steps 2+3: create beads -------------------------------------------------
create_bead() {
  local number="$1" is_epic="$2"
  local ghref
  ghref="$(external_ref "$number")"
  if [ -n "$(bead_for "$number")" ]; then
    log "skip #$number — already migrated as $(bead_for "$number")"
    SKIPPED=$((SKIPPED + 1))
    return
  fi
  local title body prio effort type labels
  title=$(jq -r ".[] | select(.number == $number) | .title" "$EXPORT")
  body=$(jq -r ".[] | select(.number == $number) | .body // \"\"" "$EXPORT")
  prio=$(parse_priority "$body")
  effort=$(parse_effort "$body")
  labels=$(jq -r ".[] | select(.number == $number) | [.labels[].name | select(. != \"epic\")] | join(\",\")" "$EXPORT")
  [ -n "$effort" ] && labels="${labels:+$labels,}effort:$effort"
  type=$(issue_type "$labels" "$is_epic")

  if [ "$MODE" = "dry-run" ]; then
    log "would create: #$number \"$title\" type=$type p=$prio labels=[$labels] external-ref=$ghref"
    return
  fi
  local bead
  # Array form so label names containing spaces (GitHub allows them) reach
  # bd create as one argument. The ${arr[@]+...} guard is required on macOS
  # bash 3.2, where expanding an empty array under set -u errors.
  local -a label_args=()
  [ -n "$labels" ] && label_args=(--labels "$labels")
  bead=$(printf '%s' "$body" | bd create "$title" --type="$type" -p "$prio" \
    --external-ref "$ghref" ${label_args[@]+"${label_args[@]}"} --body-file - --silent)
  printf '%s\t%s\t%s\n' "$ghref" "$bead" "$title" >> "$ID_MAP"
  CREATED=$((CREATED + 1))
  log "created $bead <- #$number \"$title\" (type=$type p=$prio)"
}

# --- step 4: dependency wiring ----------------------------------------------
wire_deps() {
  local number body bead parent_gh parent_bead dep_gh dep_bead blocked_gh blocked_bead
  while read -r number; do
    body=$(jq -r ".[] | select(.number == $number) | .body // \"\"" "$EXPORT")
    bead=$(bead_for "$number")
    [ -n "$bead" ] || [ "$MODE" = "dry-run" ] || continue

    parent_gh=$(parse_parent_epic "$body")
    if [ -n "$parent_gh" ]; then
      parent_bead=$(bead_for "$parent_gh")
      if [ "$MODE" = "dry-run" ]; then
        log "would parent: #$number under epic #$parent_gh (parent-child, never blocking)"
      elif [ -n "$parent_bead" ]; then
        bd update "$bead" --parent "$parent_bead" >/dev/null
        log "parented $bead under $parent_bead (gh #$number -> epic #$parent_gh)"
      else
        log "WARN: #$number names Parent Epic #$parent_gh which was not migrated"
      fi
    fi

    # "Depends on: #X" — X blocks this bead.
    for dep_gh in $(parse_depends_on "$body"); do
      dep_bead=$(bead_for "$dep_gh")
      if [ "$MODE" = "dry-run" ]; then
        log "would wire: #$dep_gh BLOCKS #$number"
      elif [ -n "$dep_bead" ]; then
        bd dep add "$bead" --blocked-by "$dep_bead" >/dev/null
        log "wired: $dep_bead BLOCKS $bead (direction: #$dep_gh blocks #$number)"
      else
        log "WARN: #$number depends on #$dep_gh which was not migrated"
      fi
    done

    # "Blocks: #Y" — this bead blocks Y.
    for blocked_gh in $(parse_blocks "$body"); do
      blocked_bead=$(bead_for "$blocked_gh")
      if [ "$MODE" = "dry-run" ]; then
        log "would wire: #$number BLOCKS #$blocked_gh"
      elif [ -n "$blocked_bead" ]; then
        bd dep add "$blocked_bead" --blocked-by "$bead" >/dev/null
        log "wired: $bead BLOCKS $blocked_bead (direction: #$number blocks #$blocked_gh)"
      else
        log "WARN: #$number blocks #$blocked_gh which was not migrated"
      fi
    done
  done < <(jq -r '.[].number' "$EXPORT")
}

# --- step 6: GitHub issue disposition (opt-in) -------------------------------
close_github_issues() {
  local ghref bead _title n signpost
  log "== Step 6: closing migrated GitHub issues (labels + pointer comments)"
  gh ${gh_repo_args[@]+"${gh_repo_args[@]}"} label create migrated-to-beads --color BFD4F2 \
    --description "Tracked in beads now; see CLAUDE.md" 2>/dev/null || true
  while IFS=$'\t' read -r ghref bead _title; do
    case "$ghref" in "$REF_PREFIX"*) : ;; *) continue ;; esac
    n="${ghref#"$REF_PREFIX"}"
    gh ${gh_repo_args[@]+"${gh_repo_args[@]}"} issue comment "$n" --body "Migrated to beads as \`$bead\` (\`bd show $bead\`; boards: \`.gembaflow-boards/kanban.html\`). GitHub Issues are no longer this repo's tracker — see CLAUDE.md." >/dev/null
    gh ${gh_repo_args[@]+"${gh_repo_args[@]}"} issue edit "$n" --add-label migrated-to-beads >/dev/null
    gh ${gh_repo_args[@]+"${gh_repo_args[@]}"} issue close "$n" --reason "not planned" >/dev/null
    log "closed #$n -> $bead"
  done < "$ID_MAP"
  signpost=$(gh ${gh_repo_args[@]+"${gh_repo_args[@]}"} issue create \
    --title "Issue tracker moved to beads (bd) — do not file issues here" \
    --body "This repo's tracker is beads (\`bd\`), a local-first tracker synced via a hidden git ref. GitHub Issues are closed and no longer groomed. See CLAUDE.md § \"Work-Item Tracking (Beads)\" and docs/BEADS.md. Boards: \`.gembaflow-boards/\` (generated locally).")
  gh ${gh_repo_args[@]+"${gh_repo_args[@]}"} issue pin "$signpost" 2>/dev/null \
    || log "WARN: could not pin signpost $signpost (needs maintainer perms)"
  log "signpost issue: $signpost"
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --execute) MODE="execute"; shift ;;
      --close-github) MODE="execute"; CLOSE_GITHUB=1; shift ;;
      --repo) REPO="${2:?--repo needs <owner/repo>}"; shift 2 ;;
      --ref-prefix) REF_PREFIX="${2:?--ref-prefix needs a value (e.g. gh-myrepo-)}"; shift 2 ;;
      --limit) LIMIT="${2:?--limit needs a number}"; shift 2 ;;
      --export-file) EXPORT_FILE="${2:?--export-file needs a path}"; shift 2 ;;
      -h|--help) sed -n '2,62p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) echo "unknown flag: $1 (see --help)" >&2; exit 2 ;;
    esac
  done

  [ -n "$REPO" ] && gh_repo_args=(-R "$REPO")

  # The script migrates the repo it lives in: outputs land in that repo's
  # reports/, and the bd tracker is that repo's .beads/. Resolve a relative
  # --export-file against the invocation directory before moving.
  if [ -n "$EXPORT_FILE" ] && [ "${EXPORT_FILE#/}" = "$EXPORT_FILE" ]; then
    EXPORT_FILE="$PWD/$EXPORT_FILE"
  fi
  cd "$REPO_ROOT"

  STAMP="$(date +%Y-%m-%d)"
  EXPORT="$OUT_DIR/export-$STAMP.json"
  ID_MAP="$OUT_DIR/id-map.tsv"
  LOG="$OUT_DIR/migration-$STAMP.log"
  mkdir -p "$OUT_DIR"

  # --- Step 0: version gate + capability probe -------------------------------
  "${SCRIPT_DIR}/check-bd.sh" --quiet
  log "== Step 0: capability probe (pinned bd; repo=${REPO:-<current>}; ref-prefix=$REF_PREFIX)"
  [ -d .beads ] || { log "FATAL: .beads/ missing — run scripts/init-beads.sh first"; exit 1; }
  local probe cmd flag
  for probe in "create:--external-ref" "create:--type" "create:--labels" \
               "update:--parent" "dep add:--blocked-by" "close:--reason" \
               "list:--all"; do
    cmd="${probe%%:*}"; flag="${probe##*:}"
    # shellcheck disable=SC2086
    bd $cmd --help 2>&1 | grep -q -- "$flag" \
      || { log "FATAL: bd $cmd lacks $flag — bd version drift; re-verify script"; exit 1; }
  done
  log "probe OK: all required flags present"

  # --- Step 1: export --------------------------------------------------------
  log "== Step 1: export open GitHub issues"
  if [ -n "$EXPORT_FILE" ]; then
    [ -f "$EXPORT_FILE" ] || { log "FATAL: --export-file $EXPORT_FILE not found"; exit 1; }
    cp "$EXPORT_FILE" "$EXPORT"
    log "using provided export file: $EXPORT_FILE"
  else
    gh ${gh_repo_args[@]+"${gh_repo_args[@]}"} issue list --state open --limit "$LIMIT" \
      --json number,title,body,labels > "$EXPORT"
  fi
  local total epics
  total=$(jq 'length' "$EXPORT")
  epics=$(jq '[.[] | select([.labels[].name] | index("epic"))] | length' "$EXPORT")
  log "exported $total open issues ($epics epics) -> $EXPORT"
  touch "$ID_MAP"

  if [ "$MODE" = "execute" ]; then
    reconcile_id_map
  fi

  # --- Steps 2+3: create -----------------------------------------------------
  local n
  log "== Step 2: epics"
  for n in $(jq -r '.[] | select([.labels[].name] | index("epic")) | .number' "$EXPORT"); do
    create_bead "$n" 1
  done
  log "== Step 3: tasks"
  for n in $(jq -r '.[] | select([.labels[].name] | index("epic") | not) | .number' "$EXPORT"); do
    create_bead "$n" 0
  done

  # --- Step 4: wiring --------------------------------------------------------
  log "== Step 4: dependency wiring (explicit direction only; never bare bd link)"
  wire_deps

  if [ "$MODE" = "dry-run" ]; then
    log "== dry-run complete. Re-run with --execute to apply."
    exit 0
  fi

  # --- Step 5: verification gate (fails loudly) ------------------------------
  log "== Step 5: verification gate"
  local migrated cycles
  migrated=$(awk -F'\t' -v p="$REF_PREFIX" 'index($1, p) == 1 { c++ } END { print c+0 }' "$ID_MAP")
  if [ "$migrated" -lt "$total" ]; then
    log "FATAL: migrated $migrated of $total issues — inspect $LOG"
    exit 1
  fi
  log "count OK: $migrated beads for $total issues (prefix $REF_PREFIX)"
  cycles=$(bd dep cycles --json 2>/dev/null || echo "unavailable")
  if [ "$cycles" != "[]" ]; then
    log "FATAL: bd dep cycles reports: $cycles — fix wiring before proceeding"
    exit 1
  fi
  log "cycles OK: bd dep cycles is empty"
  log "-- bd ready (EYEBALL THIS: unblocked P0s present? nothing falsely ready? epics noted?)"
  bd ready | tee -a "$LOG"
  log "-- spot-check 3 beads for body fidelity: bd show <id> vs gh issue view <N>"
  head -3 "$ID_MAP" | tee -a "$LOG"
  log "run summary: created $CREATED, skipped $SKIPPED (already migrated) — a converged re-run reports created 0"

  # --- Step 6: GitHub issue disposition (opt-in) -----------------------------
  if [ "$CLOSE_GITHUB" = "1" ]; then
    close_github_issues
  fi

  log "== DONE. Next: operator runs 'bd dolt push' (deliberate sync step)."
}

# Sourcing exposes the parsing helpers for unit tests; direct invocation runs
# the migration.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
