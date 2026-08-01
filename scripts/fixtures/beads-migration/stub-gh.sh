#!/usr/bin/env bash
# stub-gh.sh — offline stand-in for `gh` used by the migrator tests and the
# scratch double-run demo. Serves the pinned issue fixture for
# `gh issue list` and no-ops (while recording) every write so
# --close-github can be exercised without a network.
#
#   GH_STUB_FIXTURE — path to the export-shaped JSON to serve (required)
#   GH_STUB_LOG     — file receiving one line per gh invocation (optional)
#
# Only used from tests/demos; never sourced by framework scripts.

set -euo pipefail

FIXTURE="${GH_STUB_FIXTURE:?GH_STUB_FIXTURE must point at an issues JSON fixture}"

if [ -n "${GH_STUB_LOG:-}" ]; then
  printf 'gh %s\n' "$*" >> "$GH_STUB_LOG"
fi

# Swallow -R <repo> so both routed and unrouted invocations resolve.
if [ "${1:-}" = "-R" ]; then
  shift 2
fi

case "${1:-}:${2:-}" in
  issue:list)
    cat "$FIXTURE"
    ;;
  issue:create)
    echo "https://github.example/stub/issues/999"
    ;;
  *)
    # label create / issue comment / issue edit / issue close / issue pin
    exit 0
    ;;
esac
