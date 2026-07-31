# Beads (bd) Dependency Management

How the framework pins, installs, initializes, and upgrades the
[beads](https://github.com/gastownhall/beads) issue tracker (`bd`).

## Why a hard pin

beads is an active 1.x whose CLI surface moves between releases — prose
output changed during the reference fork's own two-day experiment, and a
clean migration failed its own gate. The framework therefore:

- pins `bd` to **one exact version**, never "latest", never a range;
- gates on that pin loudly (missing or mismatched `bd` fails fast);
- consumes `bd` output via `--json` only, never prose.

## The pin (single source of truth)

The pinned version lives in **`scripts/lib/bd-version.sh`** as
`GEMBAFLOW_BD_VERSION`. Every install path, the version gate, and the gate's
tests read this constant. Never hardcode a bd version anywhere else.

## The version gate

```bash
./scripts/check-bd.sh          # exits 0 + one OK line on match
./scripts/check-bd.sh --quiet  # same, no output on success
```

Fails with exit 1 and an actionable message when `bd` is missing, when
`bd version --json` yields no readable version (CLI drift or a pre-`--json`
bd), or when the installed version differs from the pin.

The gate runs in:

- `bootstrap.sh` Phase 0, step 9 (offers a pinned npm install on failure);
- `scripts/codespace-postcreate.sh` (non-interactive pinned install;
  failures surface as `WELCOME.md` warnings);
- `scripts/init-beads.sh` step 0 (never initialize against an unpinned bd).

## Install paths

Prefer the version-explicit npm install:

```bash
npm install -g @beads/bd@<pinned-version>
```

with the pinned version taken from `scripts/lib/bd-version.sh`. Homebrew
(`brew install beads`) tracks the latest formula and will drift from the pin
between releases — if you use it, expect the gate to tell you when it has.
Codespaces get the pinned install automatically via
`.devcontainer/devcontainer.json` → `scripts/codespace-postcreate.sh`.

## Init sequence

Run once per repo:

```bash
./scripts/init-beads.sh [-p <prefix>]
```

The script encodes the two costliest adoption gotchas (report §4, 1–2):

1. **Inert git hooks** — every gembaflow repo sets `core.hooksPath`, so bd's
   own git hooks are installed but never fire. Init uses `--skip-hooks`; the
   `.beads/issues.jsonl` mirror comes from `bd config set export.auto true`,
   not from a hook. Never rely on bd's git hooks.
2. **Framework-conflicting agent boilerplate** — bd's AGENTS.md and managed
   CLAUDE.md block tell agents to `bd close` on completion and to prefer
   `bd remember`, which conflicts with the framework memory architecture.
   Init uses `--skip-agents`, then verifies no boilerplate landed (and
   removes it if a future bd writes it anyway).

What the script does: version gate → `bd init --skip-hooks --skip-agents
--non-interactive` → `bd config set export.auto true` → boilerplate guard →
amends bd's auto-commit to `chore(beads): initialize bd tracker` → verifies
the SessionStart prime hook. Idempotent: re-runs re-assert `export.auto` and
stop.

The useful half of `bd setup claude` is adopted natively:
`.claude/settings.template.json` ships a SessionStart hook (no matcher, so
it also fires after compaction and `/clear`) that injects
`bd prime --hook-json` — roughly 1.2k tokens of tracker context that survive
compaction.

## `.beads/` git hygiene

Committed (durable, mergeable tracker state):

| File | Why |
| ---- | --- |
| `.beads/config.yaml` | Tracker configuration (incl. `export.auto`) |
| `.beads/issues.jsonl` | Passive greppable export — not the source of truth |
| `.beads/metadata.json` | Repository/clone identity |
| `.beads/interactions.jsonl` | Interaction log |

Ignored (machine-local Dolt runtime, locks, daemon files, credential key):
see the beads block inside the `FRAMEWORK:START`/`FRAMEWORK:END` markers in
`.gitignore` — `dolt/`, `embeddeddolt/`, `proxieddb/`, `backup/`,
`export-state/`, `daemon.*`, `dolt-server.*`, `ephemeral.sqlite3*`, lock
files, and `.beads-credential-key`. bd also writes its own committed
`.beads/.gitignore`; the root block mirrors the reference fork's as defense
in depth. Because the root block already contains the patterns `bd init`
checks for, init does not append to the user area of `.gitignore`.

## Sync stays gated

`bd dolt push` / `bd dolt pull` write against the git remote (a hidden ref)
and stay behind an `ask` permission in `.claude/settings.template.json`.
Agents never sync autonomously. Do not weaken this when upgrading settings.

## Upgrade procedure

Upgrading bd deliberately trips the version gate until the pin is moved.
On any `bd` upgrade:

1. Bump `GEMBAFLOW_BD_VERSION` in `scripts/lib/bd-version.sh` (the only
   place the version is written).
2. Install the new version: `npm install -g @beads/bd@<new-version>`.
3. Re-run the gate: `./scripts/check-bd.sh` — must pass.
4. Re-run the renderer shape check: `node scripts/render-boards.mjs --check`
   — validates bd's JSON output shape (normalized bead fields + known
   dependency types) and exits 1 loudly on CLI drift.
5. Re-verify JSON shapes consumed elsewhere: `npm test` (board renderer +
   gate tests) and spot-check any script that parses `bd ... --json` output.
6. If anything drifted, fix the consumers in the same change as the pin
   bump — never leave the pin and the code disagreeing.
7. Record the bump in `CHANGELOG.md` (fork-impact callout: forks re-run
   their own gate + renderer check when adopting the new pin).
