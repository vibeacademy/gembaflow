#!/usr/bin/env bash
# scripts/check-merge-gate.sh — condition logic for the agent-merge gate
#
# Evaluates conditions 1-6 of the agent-merge gate against a PR-state JSON
# file (the output of `gh pr view <N> --json
# number,state,baseRefName,labels,body,statusCheckRollup,mergeStateStatus,reviews,headRefOid`).
# The workflow (.github/workflows/agent-merge.yml) fetches the JSON and
# calls this script; keeping the logic here makes it unit-testable
# (scripts/__tests__/check-merge-gate.test.mjs) without dispatching a
# workflow run.
#
# The conditions (see docs/agent-merge-gate.md for the full contract):
#   1. The PR body cites a bead: a line matching `Bead: <id>`. Work items
#      live in the local bd (beads) tracker, which Actions runners cannot
#      query — the citation is the PR's link back to its work item.
#   2. The PR carries exactly one `safety:*` label, and it is not
#      `safety:hot`. The worker copies the bead's safety label onto the
#      PR at creation (label authority: the bead is the source of truth).
#   3. Every status check in the rollup — excluding names listed in the
#      IGNORED_CHECKS env var — is SUCCESS/NEUTRAL/SKIPPED. An INCOMPLETE
#      rollup (any check still PENDING/IN_PROGRESS/QUEUED or without a
#      conclusion) fails loudly, naming the unfinished check: the fork's
#      first autonomous dispatch was denied racing an informational check
#      that lagged CI by ~10 minutes, and "not finished" must read as
#      "not mergeable", never as "probably fine".
#   4. The PR is OPEN and its base is EXPECTED_BASE (default: main).
#   5. The PR has no `do-not-merge` label.
#   6. Second-identity approval, CONFIG-GATED via REVIEWER_APPROVAL_LOGIN
#      (escalation resolution on #578, Option A — operator 2026-08-01).
#      Non-empty: the latest review authored by exactly that login must
#      be APPROVED and bound to the PR's CURRENT head commit (a stale
#      approval on an earlier commit fails, naming both commits — a
#      post-approval push must be re-approved). Empty: the condition is
#      SKIPPED with a loud notice — the deliberate choice of
#      never-approve forks, whose GO/NO-GO verdict lives in review
#      comments and the bead's `verdict:*` label instead. The stance is
#      configurable, not doctrinal: upstream's own workflow copy sets
#      `va-reviewer`, preserving the two-identity merge path (a
#      compromised or prompt-injected worker identity cannot self-merge).
#      The value comes from the workflow env (repo-controlled), NEVER
#      from PR content — attacker-controlled body/labels cannot toggle
#      or satisfy it.
#
# All conditions are evaluated (no early exit) so a denial names every
# failing condition in one pass.
#
# Usage:
#   bash scripts/check-merge-gate.sh <pr-json-file>
#
# Environment:
#   IGNORED_CHECKS           JSON array of status-check names condition 3
#                            treats as informational (default '[]' —
#                            strict mode). See docs/agent-merge-gate.md
#                            § "Informational checks" for the 3-criteria
#                            bar before adding an entry.
#   EXPECTED_BASE            Base branch condition 4 requires (default
#                            'main').
#   REVIEWER_APPROVAL_LOGIN  Reviewer bot login for condition 6 (default
#                            empty = condition skipped with a notice).
#                            Set in the workflow env like IGNORED_CHECKS.
#
# Exit codes:
#   0 — all conditions pass
#   1 — one or more conditions failed (::error:: lines name each)
#   2 — usage / unreadable or unparseable input
set -euo pipefail

IGNORED_CHECKS="${IGNORED_CHECKS:-[]}"
EXPECTED_BASE="${EXPECTED_BASE:-main}"
REVIEWER_APPROVAL_LOGIN="${REVIEWER_APPROVAL_LOGIN:-}"

if [ $# -ne 1 ]; then
  echo "Usage: bash scripts/check-merge-gate.sh <pr-json-file>" >&2
  exit 2
fi

PR_JSON="$1"

if [ ! -r "$PR_JSON" ]; then
  echo "::error::Cannot read PR state file: ${PR_JSON}" >&2
  exit 2
fi

if ! jq -e 'type == "object"' "$PR_JSON" > /dev/null 2>&1; then
  echo "::error::PR state file is not a JSON object: ${PR_JSON}" >&2
  exit 2
fi

if ! echo "$IGNORED_CHECKS" | jq -e 'type == "array" and all(.[]; type == "string")' > /dev/null 2>&1; then
  echo "::error::IGNORED_CHECKS must be a JSON array of strings (got: ${IGNORED_CHECKS})" >&2
  exit 2
fi

PR=$(jq -r '.number // "?"' "$PR_JSON")
FAILED=0

fail() {
  echo "::error::$1"
  FAILED=1
}

# --- Condition 1 — PR body cites a bead -------------------------------------
BEAD=$(jq -r '.body // ""' "$PR_JSON" \
  | grep -oE '^Bead:[[:space:]]*[a-z]+-[a-z0-9]+[[:space:]]*$' \
  | head -1 | sed -E 's/^Bead:[[:space:]]*//; s/[[:space:]]*$//' || true)
if [ -z "$BEAD" ]; then
  fail "Condition 1: PR #${PR} does not cite a bead (need a 'Bead: <id>' line in the body, e.g. 'Bead: va-1a2')"
else
  echo "OK: condition 1 — cites bead ${BEAD}"
fi

# --- Condition 2 — exactly one safety:* label, not :hot ---------------------
SAFETY_LABELS=$(jq -c '[.labels // [] | .[].name | select(startswith("safety:"))]' "$PR_JSON")
SAFETY_COUNT=$(echo "$SAFETY_LABELS" | jq 'length')
if [ "$SAFETY_COUNT" -ne 1 ]; then
  fail "Condition 2: PR #${PR} has ${SAFETY_COUNT} safety:* labels (expected exactly 1; the worker copies the bead's safety label onto the PR at creation). Labels: ${SAFETY_LABELS}"
else
  SAFETY_CLASS=$(echo "$SAFETY_LABELS" | jq -r '.[0]')
  if [ "$SAFETY_CLASS" = "safety:hot" ]; then
    fail "Condition 2: PR #${PR} is classified safety:hot — drain refuses to merge"
  else
    echo "OK: condition 2 — safety class = ${SAFETY_CLASS}"
  fi
fi

# --- Condition 3 — rollup complete AND all relevant checks SUCCESS ----------
TOTAL=$(jq '[.statusCheckRollup // [] | .[]] | length' "$PR_JSON")
RELEVANT=$(jq -c --argjson ignored "$IGNORED_CHECKS" \
  '[.statusCheckRollup // [] | .[] | select(.name as $n | $ignored | index($n) | not)]' "$PR_JSON")
RELEVANT_COUNT=$(echo "$RELEVANT" | jq 'length')
IGNORED_COUNT=$((TOTAL - RELEVANT_COUNT))
if [ "$IGNORED_COUNT" -gt 0 ]; then
  IGNORED_NAMES=$(jq -r --argjson ignored "$IGNORED_CHECKS" \
    '[.statusCheckRollup // [] | .[] | select(.name as $n | $ignored | index($n)) | "\(.name) (\(.conclusion // "PENDING"))"] | join(", ")' "$PR_JSON")
  echo "::notice::Condition 3: ignored ${IGNORED_COUNT} informational check(s) per IGNORED_CHECKS env: ${IGNORED_NAMES}"
fi

# Incomplete first (finding: racing a lagging check must fail with a
# "still running" message, not a generic failure).
INCOMPLETE=$(echo "$RELEVANT" | jq -r '[.[] | select((.conclusion // "") == "" or .conclusion == "PENDING" or .conclusion == "IN_PROGRESS" or .conclusion == "QUEUED") | .name // .context // "(unnamed)"] | join(", ")')
NOT_SUCCESS=$(echo "$RELEVANT" | jq -r '[.[] | select((.conclusion // "") != "" and .conclusion != "PENDING" and .conclusion != "IN_PROGRESS" and .conclusion != "QUEUED" and .conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | "\(.name // .context // "(unnamed)") (\(.conclusion))"] | join(", ")')

if [ -n "$INCOMPLETE" ]; then
  fail "Condition 3: PR #${PR} check rollup is INCOMPLETE — still running: ${INCOMPLETE}. Wait for the full rollup (or add a genuinely informational check to IGNORED_CHECKS per the 3-criteria bar in docs/agent-merge-gate.md)."
fi
if [ -n "$NOT_SUCCESS" ]; then
  fail "Condition 3: PR #${PR} has non-SUCCESS relevant checks: ${NOT_SUCCESS}"
fi
if [ -z "$INCOMPLETE" ] && [ -z "$NOT_SUCCESS" ]; then
  echo "OK: condition 3 — all ${RELEVANT_COUNT} relevant check(s) SUCCESS/NEUTRAL/SKIPPED (${IGNORED_COUNT} informational ignored of ${TOTAL} total)"
fi

# --- Condition 4 — PR is open and base is EXPECTED_BASE ---------------------
STATE=$(jq -r '.state // "UNKNOWN"' "$PR_JSON")
BASE=$(jq -r '.baseRefName // "UNKNOWN"' "$PR_JSON")
if [ "$STATE" != "OPEN" ]; then
  fail "Condition 4: PR #${PR} is not open (state=${STATE})"
elif [ "$BASE" != "$EXPECTED_BASE" ]; then
  fail "Condition 4: PR #${PR} base is '${BASE}', expected '${EXPECTED_BASE}'"
else
  echo "OK: condition 4 — open, base=${EXPECTED_BASE}"
fi

# --- Condition 5 — no do-not-merge label ------------------------------------
if jq -e '.labels // [] | .[] | select(.name == "do-not-merge")' "$PR_JSON" > /dev/null; then
  fail "Condition 5: PR #${PR} has the do-not-merge label"
else
  echo "OK: condition 5 — no do-not-merge label"
fi

# --- Condition 6 — second-identity approval (config-gated) ------------------
if [ -z "$REVIEWER_APPROVAL_LOGIN" ]; then
  echo "::warning::Condition 6: second-identity approval check DISABLED by config — merge path relies on citation+label+rollup only. REVIEWER_APPROVAL_LOGIN is empty (the deliberate never-approve-fork choice; see docs/agent-merge-gate.md § 'The reviewer-approval condition is configurable, not doctrinal')."
else
  HEAD_OID=$(jq -r '.headRefOid // ""' "$PR_JSON")
  LATEST_REVIEW=$(jq -c --arg login "$REVIEWER_APPROVAL_LOGIN" \
    '[.reviews // [] | .[] | select(.author.login == $login)] | sort_by(.submittedAt) | last // "none"' "$PR_JSON")
  if [ "$LATEST_REVIEW" = '"none"' ]; then
    fail "Condition 6: PR #${PR} has no review authored by '${REVIEWER_APPROVAL_LOGIN}' (an APPROVED review from that login is required while REVIEWER_APPROVAL_LOGIN is set)"
  else
    REVIEW_STATE=$(echo "$LATEST_REVIEW" | jq -r '.state // "NONE"')
    REVIEW_OID=$(echo "$LATEST_REVIEW" | jq -r '.commit.oid // ""')
    if [ "$REVIEW_STATE" != "APPROVED" ]; then
      fail "Condition 6: PR #${PR} latest review by '${REVIEWER_APPROVAL_LOGIN}' is '${REVIEW_STATE}' (expected APPROVED)"
    elif [ -z "$HEAD_OID" ]; then
      fail "Condition 6: PR #${PR} state is missing headRefOid — cannot bind the approval to the current head commit (refusing rather than trusting a possibly-stale approval)"
    elif [ "$REVIEW_OID" != "$HEAD_OID" ]; then
      fail "Condition 6: PR #${PR} approval by '${REVIEWER_APPROVAL_LOGIN}' is STALE — approved commit ${REVIEW_OID:-(unknown)}, current head is ${HEAD_OID}. A push after approval must be re-approved."
    else
      echo "OK: condition 6 — '${REVIEWER_APPROVAL_LOGIN}' APPROVED at current head ${HEAD_OID}"
    fi
  fi
fi

# ----------------------------------------------------------------------------
if [ "$FAILED" -ne 0 ]; then
  echo "::error::Merge gate DENIED for PR #${PR} — see condition failures above"
  exit 1
fi
echo "OK: all gate conditions (1-6) passed for PR #${PR}"
