#!/bin/bash
# scripts/lib/bd-version.sh — single source of truth for the pinned bd (beads)
# CLI version.
#
# beads is an active 1.x whose CLI surface moves between releases (prose
# output changed during the reference fork's own two-day experiment, and a
# clean migration failed its own gate). The framework therefore pins bd to
# one exact version and gates on it — never "latest", never a range.
#
# NEVER hardcode a bd version anywhere else. Consumers of this constant:
#   - scripts/check-bd.sh            (the version gate)
#   - scripts/init-beads.sh          (gates before initializing the tracker)
#   - scripts/codespace-postcreate.sh (pinned npm install in Codespaces)
#   - bootstrap.sh Phase 0           (pinned install step)
#   - scripts/__tests__/check-bd.test.mjs (keeps tests in sync with the pin)
#
# To upgrade bd: follow docs/BEADS.md § "Upgrade procedure" — bump the pin
# here, reinstall, re-run scripts/check-bd.sh and
# `node scripts/render-boards.mjs --check`, re-verify JSON output shapes,
# then record the bump in CHANGELOG.md.

# shellcheck disable=SC2034  # consumed by sourcing scripts
GEMBAFLOW_BD_VERSION="1.1.0"
