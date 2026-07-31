#!/usr/bin/env bash
# scripts/init-beads.sh — framework-compatible bd (beads) tracker init sequence.
#
# Encodes the two costliest beads-adoption gotchas from the reference fork's
# experiment (report §4, gotchas 1–2):
#
#   1. Inert git hooks — every gembaflow repo sets `core.hooksPath`, so bd's
#      own git hooks would be installed but NEVER fire. We init with
#      --skip-hooks and rely on `export.auto` (not a hook) to keep the
#      .beads/issues.jsonl mirror fresh.
#   2. Framework-conflicting agent boilerplate — bd's AGENTS.md / CLAUDE.md
#      block tells agents to `bd close` on completion and to prefer
#      `bd remember` over the framework memory architecture. We init with
#      --skip-agents and verify none of that boilerplate lands (removing it
#      if a future bd writes it anyway).
#
# Usage:
#   ./scripts/init-beads.sh [-p <prefix>]
#
#   -p <prefix>   bead-ID prefix (2-4 lowercase chars, e.g. `va` → va-1a2b).
#                 Omit to let bd auto-detect from the directory name.
#
# Idempotent: exits cleanly (after re-asserting config) if .beads/ already
# holds an initialized tracker. The SessionStart `bd prime --hook-json` hook
# ships in .claude/settings.template.json — this script only verifies it.
#
# Sync note: `bd dolt push` / `bd dolt pull` are writes against the git
# remote and stay behind an `ask` permission in settings — this script never
# syncs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

PREFIX=""
while [ $# -gt 0 ]; do
    case "$1" in
        -p|--prefix)
            PREFIX="${2:?usage: $0 [-p <prefix>]}"
            shift 2
            ;;
        -h|--help)
            sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown argument: $1 (usage: $0 [-p <prefix>])" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# 0. Version gate — never initialize against an unpinned bd.
# ---------------------------------------------------------------------------
"${SCRIPT_DIR}/check-bd.sh"

# ---------------------------------------------------------------------------
# 1. Idempotency — re-runs re-assert config and stop.
# ---------------------------------------------------------------------------
if [ -f .beads/metadata.json ]; then
    echo "beads tracker already initialized (.beads/metadata.json exists)."
    bd config set export.auto true >/dev/null
    echo "OK: export.auto re-asserted; nothing else to do."
    exit 0
fi

# ---------------------------------------------------------------------------
# 2. Record pre-init state for the boilerplate guard in step 5.
# ---------------------------------------------------------------------------
agents_preexisting=false
[ -f AGENTS.md ] && agents_preexisting=true

# ---------------------------------------------------------------------------
# 3. Initialize. The flags matter (see header): --skip-hooks because
#    core.hooksPath makes bd's git hooks inert; --skip-agents because the
#    framework owns agent instructions. Note: bd init auto-commits its
#    scaffolding (amended to conventional-commit form in step 6).
# ---------------------------------------------------------------------------
if [ -n "$PREFIX" ]; then
    bd init -p "$PREFIX" --skip-hooks --skip-agents --non-interactive
else
    bd init --skip-hooks --skip-agents --non-interactive
fi

# ---------------------------------------------------------------------------
# 4. JSONL mirror comes from export.auto, NOT from a git hook — the hook
#    would never fire (gotcha 1). This keeps .beads/issues.jsonl fresh as a
#    passive, greppable export.
# ---------------------------------------------------------------------------
bd config set export.auto true

# ---------------------------------------------------------------------------
# 5. Boilerplate guard — bd must not own agent instructions (gotcha 2).
#    --skip-agents should prevent all of this; guard anyway so a future bd
#    behavior change fails visibly instead of silently landing boilerplate.
# ---------------------------------------------------------------------------
if [ -f AGENTS.md ] && grep -q 'bd (beads)\|\*\*bd\*\* (beads)' AGENTS.md 2>/dev/null; then
    if [ "$agents_preexisting" = false ]; then
        rm AGENTS.md
        echo "Removed bd-generated AGENTS.md boilerplate (framework owns agent instructions)."
    else
        echo "WARNING: pre-existing AGENTS.md now contains bd boilerplate — remove the bd section manually." >&2
    fi
fi

if [ -f CLAUDE.md ] && grep -q '<!-- BEGIN BEADS INTEGRATION' CLAUDE.md 2>/dev/null; then
    sed -i.bak '/<!-- BEGIN BEADS INTEGRATION/,/<!-- END BEADS INTEGRATION -->/d' CLAUDE.md
    rm -f CLAUDE.md.bak
    echo "Stripped bd's managed CLAUDE.md block (conflicts with the framework memory architecture)."
fi

# bd init appends a root .gitignore block only when its patterns are absent;
# the framework .gitignore ships them (see the beads block inside the
# FRAMEWORK markers), so no append — and no dedupe — is expected here.

# ---------------------------------------------------------------------------
# 6. Amend bd's auto-commit to conventional-commit form (only if HEAD is
#    exactly bd's init commit — never rewrite anything else).
# ---------------------------------------------------------------------------
if [ "$(git log -1 --pretty=%s 2>/dev/null)" = "bd init: initialize beads issue tracking" ]; then
    for f in AGENTS.md CLAUDE.md .gitignore .beads; do
        git add -A -- "$f" 2>/dev/null || true
    done
    git commit --amend --no-edit -m "chore(beads): initialize bd tracker" --quiet
    echo "Amended bd's auto-commit to: chore(beads): initialize bd tracker"
fi

# ---------------------------------------------------------------------------
# 7. Verify the SessionStart prime hook is wired. The framework template
#    ships it; forks maintaining their own settings merge it themselves.
# ---------------------------------------------------------------------------
if grep -q 'bd prime --hook-json' .claude/settings.template.json 2>/dev/null; then
    echo "OK: SessionStart \`bd prime --hook-json\` hook present in .claude/settings.template.json."
else
    echo "WARNING: .claude/settings.template.json lacks the SessionStart \`bd prime --hook-json\` hook — see docs/BEADS.md." >&2
fi

echo ""
echo "beads tracker initialized:"
echo "  - hooks skipped (core.hooksPath makes them inert; JSONL mirror via export.auto)"
echo "  - agent boilerplate skipped/verified absent (framework owns agent instructions)"
echo "  - export.auto = true (.beads/issues.jsonl stays fresh)"
echo "  - sync (bd dolt push/pull) stays behind the ask permission — never automatic"
