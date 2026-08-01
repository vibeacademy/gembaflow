#!/usr/bin/env bash
# stub-bd.sh — offline stand-in for the pinned bd CLI, used by
# scripts/__tests__/migrate-issues-to-beads.test.mjs to exercise the
# migrator's full flow (including idempotent double-runs and mid-run
# death) without bd installed and without a network.
#
# State lives under $BD_STUB_STATE (a directory):
#   beads.tsv   — one line per created bead: <external_ref>\t<id>\t<type>\t<priority>\t<labels>
#   deps.tsv    — one line per dep edge:     <blocked>\t<blocker>
#   parents.tsv — one line per parenting:    <child>\t<parent>
#
# Crash injection: when BD_STUB_DIE_AFTER_CREATES=N is set, the Nth
# `create` records the bead, prints its id, then exits nonzero — i.e. the
# bead exists in "bd state" but the caller dies before indexing it. This
# reproduces the worst-case mid-run death the migrator must converge from.
#
# Only used from tests; never sourced by framework scripts.

set -euo pipefail

STATE="${BD_STUB_STATE:?BD_STUB_STATE must point at a writable directory}"
mkdir -p "$STATE"
touch "$STATE/beads.tsv" "$STATE/deps.tsv" "$STATE/parents.tsv"

# Any `--help` invocation advertises every flag the migrator probes for.
for arg in "$@"; do
  if [ "$arg" = "--help" ]; then
    echo "stub-bd flags: --external-ref --type --labels --parent --blocked-by --reason --all --json -n --silent --body-file"
    exit 0
  fi
done

cmd="${1:-}"
case "$cmd" in
  version)
    echo '{"version":"1.1.0","stub":true}'
    ;;
  create)
    shift
    title="${1:-}"
    ref="" type="task" prio="2" labels=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --external-ref) ref="$2"; shift 2 ;;
        --type=*) type="${1#--type=}"; shift ;;
        -p) prio="$2"; shift 2 ;;
        --labels) labels="$2"; shift 2 ;;
        --body-file) cat >/dev/null; shift 2 ;;  # consume stdin body
        *) shift ;;
      esac
    done
    count=$(wc -l < "$STATE/beads.tsv" | tr -d ' ')
    id="tb-$((count + 1))"
    printf '%s\t%s\t%s\t%s\t%s\n' "$ref" "$id" "$type" "$prio" "$labels" >> "$STATE/beads.tsv"
    echo "$id"
    if [ -n "${BD_STUB_DIE_AFTER_CREATES:-}" ] \
      && [ "$((count + 1))" -ge "$BD_STUB_DIE_AFTER_CREATES" ]; then
      echo "stub-bd: injected crash after create #$((count + 1))" >&2
      exit 70
    fi
    ;;
  update)
    # `bd update <id> --parent <pid>` — idempotent in real bd; record it.
    if [ "${3:-}" = "--parent" ]; then
      printf '%s\t%s\n' "$2" "$4" >> "$STATE/parents.tsv"
    fi
    ;;
  dep)
    sub="${2:-}"
    if [ "$sub" = "add" ]; then
      # `bd dep add <blocked> --blocked-by <blocker>` — idempotent in real bd.
      printf '%s\t%s\n' "$3" "$5" >> "$STATE/deps.tsv"
    elif [ "$sub" = "cycles" ]; then
      echo "[]"
    fi
    ;;
  list)
    # `bd list --json --all -n 0` — the reconciliation read.
    awk -F'\t' 'BEGIN { printf "[" }
      { if (NR > 1) printf ","
        printf "{\"id\":\"%s\",\"external_ref\":\"%s\",\"status\":\"open\"}", $2, $1 }
      END { print "]" }' "$STATE/beads.tsv"
    ;;
  ready)
    echo "stub-bd ready: $(wc -l < "$STATE/beads.tsv" | tr -d ' ') beads in state"
    ;;
  *)
    # close / config / anything else the migrator touches only incidentally.
    exit 0
    ;;
esac
