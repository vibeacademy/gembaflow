#!/usr/bin/env bash
# setup-safety-labels.sh — Idempotently create the four safety:* labels on the
# current fork's repo.
#
# Drain (`/drain`) requires these labels to exist before any Ready ticket can
# be classified (per docs/safety-classes.md and the drain pre-flight step 4c).
# Workflow files and these labels are both manual-install per
# docs/drain-customization.md — this script handles the labels side.
#
# Idempotent: re-running after creation is a no-op (each label gets a single
# existence check before any create call).
#
# Usage:
#   bash scripts/setup-safety-labels.sh           # create labels (skip existing)
#   bash scripts/setup-safety-labels.sh --check   # report only; exit 1 if any missing
#   bash scripts/setup-safety-labels.sh --help
#
# Exit codes:
#   0  — all four labels exist (after create or already-present), OR --check found zero missing
#   1  — error (no gh, no repo, no auth), OR --check found at least one missing label

set -euo pipefail

CHECK_ONLY=false

show_help() {
  cat <<'HELP'
setup-safety-labels.sh — Idempotently create the four safety:* labels for /drain.

Usage:
  bash scripts/setup-safety-labels.sh           # create labels (skip existing)
  bash scripts/setup-safety-labels.sh --check   # report only; exit 1 if any missing
  bash scripts/setup-safety-labels.sh --help

The four labels per docs/safety-classes.md:
  safety:internal     #0E8A16  Drain-eligible: standard work
  safety:reversible   #D93F0B  Small change; revertable in 15min
  safety:hot          #B60205  Auth/payment/data-loss/schema; drain REFUSES
  safety:flagged      #FBCA04  Feature-flag default-false

Exit codes:
  0  — all four exist (after create or already-present), or --check found zero missing
  1  — error or --check found at least one missing label

See docs/drain-customization.md § "Customization summary checklist".
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=true; shift ;;
    --help|-h) show_help; exit 0 ;;
    *) echo "ERROR: Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required but not installed." >&2
  exit 1
fi

if ! gh repo view --json nameWithOwner >/dev/null 2>&1; then
  echo "ERROR: gh CLI cannot resolve the current repo. Run 'gh auth status' to check." >&2
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

# Four canonical labels per docs/safety-classes.md.
# Format: name|color|description (| is the delimiter; none of these values contain |)
LABELS=(
  "safety:internal|0E8A16|Drain-eligible: standard work, no fork-distribution risk"
  "safety:reversible|D93F0B|Small change; revertable in 15min by git revert + redeploy"
  "safety:hot|B60205|Auth/payment/data-loss/schema; drain REFUSES"
  "safety:flagged|FBCA04|Feature-flag default-false; validation via override"
)

missing=0
created=0
existing=0

for entry in "${LABELS[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  color="${rest%%|*}"
  desc="${rest#*|}"

  # GitHub label-existence probe: `gh api` returns 0 on found, non-zero on 404.
  # Suppress output on both paths; we only care about the exit code.
  if gh api "repos/$REPO/labels/$name" --silent >/dev/null 2>&1; then
    if $CHECK_ONLY; then
      echo "  exists:  $name"
    else
      echo "  skip (exists): $name"
    fi
    existing=$((existing + 1))
  else
    if $CHECK_ONLY; then
      echo "  MISSING: $name"
      missing=$((missing + 1))
    else
      if gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" >/dev/null 2>&1; then
        echo "  created: $name (#$color)"
        created=$((created + 1))
      else
        echo "  ERROR creating $name — check gh auth + write permissions on $REPO" >&2
        exit 1
      fi
    fi
  fi
done

echo ""
if $CHECK_ONLY; then
  if [ "$missing" -gt 0 ]; then
    echo "FOUND: $missing safety:* label(s) missing on $REPO — run 'bash scripts/setup-safety-labels.sh' (no --check) to create them."
    exit 1
  fi
  echo "All four safety:* labels exist on $REPO."
  exit 0
fi

echo "Done. Created: $created, existed: $existing on $REPO."
