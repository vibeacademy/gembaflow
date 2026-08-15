# Beads (bd) Dependency Management

How the framework pins, installs, initializes, and upgrades the
[beads](https://github.com/gastownhall/beads) issue tracker (`bd`). For the
label vocabulary and agent/renderer conventions, see
`docs/BEADS-CONVENTIONS.md` (canonical); for the board-model mapping, see
CLAUDE.md § "Work-Item Tracking (Beads)".

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

**Branch switching vs the committed `issues.jsonl` (adoption gotcha, report
§4 item 7):** auto-export rewrites `.beads/issues.jsonl` on every bd
mutation, so the working tree is dirty most of the time and `git checkout`
will refuse to switch branches over it. This is expected, not a bug. Stash
the mirror across branch switches (`git stash push .beads/issues.jsonl`),
or commit it only at deliberate sync points — never `checkout -f` over it,
and never hand-edit it to make the diff go away.

## Sync stays gated

`bd dolt push` / `bd dolt pull` write against the git remote (a hidden ref)
and stay behind an `ask` permission in `.claude/settings.template.json`.
Agents never sync autonomously. Do not weaken this when upgrading settings.

## bd 1.1.0 JSON output quirks (gotchas 9–10)

Two live findings from the meta-tracker cutover and acceptance drain
(gembaflow#594), continuing the downstream-report §4 numbering. The
canonical countermeasure pattern lives in `docs/BEADS-CONVENTIONS.md`
§ "Script conventions" item 3 (bd JSON hygiene); drafted upstream bug
reports (filing is an operator decision) live in
`docs/bd-upstream-reports/`.

**9. Raw control characters in `--json` output.** bd 1.1.0 intermittently
emits raw (unescaped) control characters inside JSON strings — at the meta
cutover, a literal tab carried over from an issue body broke a `jq` gate
with "control characters must be escaped". Sanitize before parsing:
capture bd stdout to a file, then pipe the file through
`perl -pe 's/[\x00-\x09\x0b\x0c\x0e-\x1f]/ /g'` into `jq`. Files, not
shell variables — command substitution can mangle control bytes — and keep
stderr out of the captured stream so bd advisories never mix into the
JSON. The nastiest failure mode: a pipeline ending in an absence check
(any `jq 'length == 0'` shape) reads a *failed parse* as "nothing there" —
the parse error makes absence checks pass. Check jq's exit status and fail
loudly. (The board renderer tolerates this quirk natively: its bd-JSON
parser strips control characters before `JSON.parse`.)

**10. `bd ready` silently caps at 100.** The default limit truncates the
ready queue and announces it only as a stderr advisory — invisible
precisely when you separate stderr per gotcha 9. At the meta acceptance
drain, 113 ready beads meant 13 were silently missing from every bare
`bd ready --json` snapshot. Always pass `--limit 0` when enumerating
(`bd ready`, `bd list`); treat any bd result whose length equals a round
default (100) as suspect.

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

## Migrating an existing fork (GitHub Issues → beads)

`scripts/migrate-issues-to-beads.sh` is the opt-in cutover tool for forks
that predate the beads default. It is generalized from the reference fork's
proven migrator (33 issues, idempotent) and encodes the framework
conventions: epics first, verbatim bodies, `Priority: P<k>` → `-p k`,
`Effort Estimate: X` → `effort:X` label, GitHub labels 1:1, explicit-direction
dependency wiring from `Parent Epic:` / `Depends on:` / `Blocks:` body lines,
and a loud verification gate (count match + `bd dep cycles --json` empty +
`bd ready` printed for the operator to eyeball).

- **Dry-run by default.** `--execute` creates beads; `--close-github`
  additionally closes the migrated GitHub issues with pointer comments and
  files + pins a signpost issue (separate opt-in — it is outward-facing and
  hard to reverse).
- **Idempotent by `--external-ref`.** Migration scripts die mid-run; this
  one converges instead of duplicating. Every bead carries
  `--external-ref <prefix><N>`, the id-map at
  `reports/beads-migration/id-map.tsv` is reconciled against
  `bd list --json --all -n 0` on every run, and a converged re-run provably
  reports `created 0`.
- **Repo-qualified refs.** Default prefix is `gh-`. When several repos
  migrate into one beads tracker (e.g. a meta board spanning multiple
  repos), bare `gh-N` collides — pass `--ref-prefix gh-<repo>-` per source
  repo.
- **Outputs** land in `reports/beads-migration/`: the dated export JSON, the
  `id-map.tsv` GH→bead mapping, and the migration log.
- After a successful run the operator syncs deliberately: `bd dolt push`.
- **Migrated descriptions rot** (report §4, item 8): a body written against
  a months-old repo state will eventually contradict reality. The worker
  protocol already carries the countermeasure — when a bead's text
  contradicts the repo, the worker states its interpretation in the PR body
  and flags it for the reviewer to judge
  (`.claude/agents/github-ticket-worker.md`, NON-NEGOTIABLE rule 7). Do not
  "fix" rot by rewriting descriptions; use `bd note` (mechanical-hygiene
  rule 4, `docs/BEADS-CONVENTIONS.md`).

## GitHub-Projects compatibility flag (REMOVED — v1.7.0)

The one-release GitHub-Projects compatibility flag (`legacy.githubProjects` in
`.gembaflow-config.json` / `GEMBAFLOW_LEGACY_GITHUB_PROJECTS` Actions variable)
was removed in v1.7.0 (vibeacademy/gembaflow#587). The flag and everything
behind it — `scripts/lib/legacy-github-projects.sh`,
`.github/workflows/auto-board-status.yml`, and the `legacy` config block — are
gone entirely.

Forks that had `legacy.githubProjects: true` and relied on
`auto-board-status.yml` for board-column updates: that workflow file was never
synced (workflow files are deliberately outside `syncDirectories`), so your fork
copy already held its pre-removal form. Delete your fork's copy manually. The
flag value in `.gembaflow-config.json` is now silently ignored.

To migrate remaining GitHub issues to beads, use
`scripts/migrate-issues-to-beads.sh` (permanent opt-in path, unaffected by this
removal).
