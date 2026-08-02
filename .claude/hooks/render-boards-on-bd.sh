#!/bin/bash
#
# Claude Code hook: regenerate the HTML board projections at turn boundaries.
#
# Wired in settings (see .claude/settings.template.json):
#   - Stop         — fires once per assistant turn, after all tools have
#     completed. Coalesces any number of bd mutations made during a turn
#     into a single render.
#     Invoke: render-boards-on-bd.sh
#
#   - SessionStart — unconditional regeneration, bounding drift from
#     mutations made outside a session (human merges, manual bd edits,
#     bd dolt pull).
#
# Manual invocation: run with no arguments (used by /board-refresh and the
# Stop/SessionStart hooks). Every invocation is an unconditional regen —
# there is no conditional path, so the hook takes no flags (arguments are
# ignored; the retired --refresh alias changed nothing). Earlier fork
# iterations carried a PostToolUse fallback here (verb-regex matching on
# tool_input.command plus a jsonl-mtime freshness check); both strategies are
# retired and deliberately NOT ported.
#
# Contract: this hook must NEVER fail or emit output. A rendering problem is
# logged by the renderer itself (.gembaflow-boards/render.log), never surfaced
# here. Stop and SessionStart stdout would be injected into the model's context,
# so we stay silent there too.

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HOOK_DIR}/../.." && pwd)"
RENDERER="${REPO_ROOT}/scripts/render-boards.mjs"

# Note: the Stop/SessionStart JSON payload on stdin is intentionally ignored —
# the refresh is unconditional, so there is nothing to parse.
if [ -f "$RENDERER" ] && command -v node >/dev/null 2>&1; then
  node "$RENDERER" >/dev/null 2>&1 || true
fi

exit 0
