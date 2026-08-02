---
description: "Orchestrate the 5-phase bootstrap (env → product → architecture → agents → workflow) end-to-end without terminal context-switching"
---

## Bootstrap Orchestrator

Run the per-phase `/bootstrap-product`, `/bootstrap-architecture`,
`/bootstrap-agents`, and `/bootstrap-workflow` slash commands in sequence,
skipping phases that are already complete. Replaces the `bootstrap.sh`
"press Enter when Phase N is complete" terminal+Claude-Code two-pane dance
for the Codespace happy path; the terminal entrypoint remains available
for operators who prefer it.

## Audience and trigger model

The reader is a brand-new fork operator (often a workshop participant) who
has just opened a Codespace on a fresh fork. The Codespace's
`scripts/codespace-postcreate.sh` has already handled phase 0 (env setup):
git identity is set, `.gembaflow-version` is stamped, `.mcp.json` is
written, `.gembaflow-config.json` carries `solo_mode: true`. The operator
opens the Claude Code sidebar and types `/bootstrap`.

## Idempotency contract

**Primary signal:** the `.claude/.bootstrap-status` file (`bootstrap.sh:22`
writes phase markers like `phase1:complete` here; the slash command reads
and writes the same file so the two entrypoints interoperate).

**Fallback signal:** artifact existence (`docs/PRODUCT-REQUIREMENTS.md`,
`docs/TECHNICAL-ARCHITECTURE.md`, etc.). Used only when the status file is
missing or partial.

**Write contract:** after each successful per-phase invocation, append
`phaseN:complete` to `.claude/.bootstrap-status` (one line per marker; no
deduplication needed — `grep -q "^phaseN:complete$"` is the only consumer).

## Instructions for the Agent

### Step 1 — Preflight

#### 1a. Status-file check (already-bootstrapped gate)

Read `.claude/.bootstrap-status` if it exists. Count the `^phase[0-4]:complete$`
markers present.

- If **all 5 markers** are present (phases 0 through 4): print
  `→ Already bootstrapped on <installedAt from .gembaflow-version>; re-run with --force to redo.`
  and exit cleanly. Do not run any phase.
- If markers 1-4 are all present but `phase0:complete` is missing
  (Codespaces case — the postCreate script doesn't write phase0): append
  `phase0:complete` to the status file, then print the "already
  bootstrapped" message above and exit.
- Otherwise, continue to step 1b.

#### 1b. `gh auth status` with token redaction

Run `gh auth status` and pipe output through:

```bash
gh auth status 2>&1 | sed -E 's/gh[oprsu]_[A-Za-z0-9_]+/[redacted token]/g'
```

Display the redacted output. The redactor masks any `gho_*`, `ghp_*`,
`ghs_*`, `ghu_*`, or `ghr_*` token prefix in case the operator screen-shares
during a workshop demo.

If `gh auth status` exits non-zero (no authenticated account), STOP with:
`→ gh is not authenticated. Run 'gh auth login' first, then re-invoke /bootstrap.`

#### 1c. Verify `.gembaflow-version` exists

If `.gembaflow-version` is missing, STOP with:
`→ .gembaflow-version not found — this directory is not a Gemba Flow fork. Re-template from vibeacademy/gembaflow.`

#### 1d. Read `.gembaflow-config.json` + multi-bot secrets check

Read `solo_mode` from `.gembaflow-config.json` (default `true` in Codespaces
— `scripts/codespace-postcreate.sh` writes this). Apply this table:

| `solo_mode` value | Secrets present? | Action |
|---|---|---|
| `true` (or field absent) | n/a | Proceed in **solo mode**. Note in closing summary. |
| `false` | both `GEMBAFLOW_WORKER_TOKEN` and `GEMBAFLOW_REVIEWER_TOKEN` present | Proceed in **multi-bot mode**. Note in closing summary. |
| `false` | either secret missing | **STOP** with the actionable error below. Do NOT silently downgrade to solo mode — the operator explicitly set `solo_mode: false`. |

The actionable error on the missing-secrets path:

```
→ Multi-bot mode is configured (.gembaflow-config.json: solo_mode: false)
  but one or both Codespaces secrets are missing:

    GEMBAFLOW_WORKER_TOKEN  : <present|MISSING>
    GEMBAFLOW_REVIEWER_TOKEN: <present|MISSING>

  Set the missing secret(s) at:
    https://github.com/settings/codespaces

  Then wait 1-2 minutes for propagation, restart this Codespace via
  the Codespaces menu, and re-invoke /bootstrap.

  See docs/codespaces-secrets.md for fine-grained PAT scopes, rotation
  discipline, and blast-radius guidance.
```

Substitute the actual `<present|MISSING>` values from the env check so
the operator sees which specific secret needs setting.

#### 1e. Mark phase0 complete

Append `phase0:complete` to `.claude/.bootstrap-status` if not already present.
Create the file (with `mkdir -p .claude` first) if it doesn't exist.

### Step 2 — Phase 1 (Product Definition)

Check both signals:

- Status: `grep -q "^phase1:complete$" .claude/.bootstrap-status` exits 0
- Artifact: `docs/PRODUCT-REQUIREMENTS.md` exists

If **both** are present, skip with `→ Phase 1 already complete; skipping /bootstrap-product.`

Otherwise, invoke `/bootstrap-product` (the existing per-phase command). On
successful completion (the command's own DoD is met — `docs/PRODUCT-REQUIREMENTS.md`
and `docs/PRODUCT-ROADMAP.md` both present), append `phase1:complete` to
`.claude/.bootstrap-status`.

On per-phase failure, STOP with a single summary message:
- Failing phase: 1 (Product Definition)
- Error: `<the failure surface from /bootstrap-product>`
- Recommended fix: `<actionable next step>`
Do not silently continue to phase 2.

### Step 3 — Phase 2 (Technical Architecture)

Same pattern as Step 2:

- Skip-check: `phase2:complete` marker AND `docs/TECHNICAL-ARCHITECTURE.md` present
- On miss, invoke `/bootstrap-architecture`. On success, mark `phase2:complete`.
- On failure, STOP with the summary shape above (failing phase 2).

### Step 4 — Phase 3 (Agent Specialization)

- Skip-check: `phase3:complete` marker present (the per-phase command does its
  own internal idempotency; no artifact-existence fallback needed)
- On miss, invoke `/bootstrap-agents`. On success, mark `phase3:complete`.
- On failure, STOP with the summary shape above (failing phase 3).

### Step 5 — Phase 4 (Workflow Activation)

Check both signals:

- Status: `phase4:complete` marker
- Artifact: initialized beads tracker present (`.beads/metadata.json`
  exists). Legacy alternative — only when the deprecated
  `legacy.githubProjects` flag is `true` in `.gembaflow-config.json`
  (removal: vibeacademy/gembaflow#587) — a project-board reference
  (`board.id`) populated in `.gembaflow-config.json`.

If both present, skip with `→ Phase 4 already complete; skipping /bootstrap-workflow.`

Otherwise, invoke `/bootstrap-workflow`. On success, mark `phase4:complete`.
On failure, STOP with the summary shape above (failing phase 4).

### Step 6 — Closing summary

Print a single closing block:

```
✓ Bootstrap complete.

  Mode: <solo|multi-bot>
  Tracker: beads (bd), prefix <prefix from bd config / init-beads>
  Ready (top 3 from bd ready --json --limit 0):
    1. <bead-id> — <title>
    2. <bead-id> — <title>
    3. <bead-id> — <title>

  Next step: type /work-ticket to pick up the top ready bead.
```

If `bd ready` surfaces fewer than 3 beads, list however many exist (or
"_Nothing is ready — run /groom-backlog to complete DoR and unblock work._").

## Critical Rules

1. **Never bypass `.claude/.bootstrap-status`.** It is the load-bearing
   interop signal between this skill and `bootstrap.sh`. Both entrypoints
   read and write the same file; bypassing means desync.
2. **Never silently continue past a per-phase failure.** STOP with the
   summary message so the operator knows exactly what failed and how to
   recover.
3. **Never invoke a per-phase command if its skip-check already passed.**
   `/bootstrap-product` and friends are operator-callable directly; running
   them redundantly inside `/bootstrap` would re-prompt the operator for
   answers they already gave.
4. **Always redact tokens in `gh auth status` output.** The redactor is
   one `sed` line; the cost of forgetting it is a workshop-demo token leak.

## Output format

Progress lines while running:

```
→ Preflight ok (mode: solo, account: jdoe)
→ Phase 1 already complete; skipping /bootstrap-product
→ Phase 2 running /bootstrap-architecture …
→ Phase 2 complete; marked
→ Phase 3 running /bootstrap-agents …
→ Phase 3 complete; marked
→ Phase 4 running /bootstrap-workflow …
→ Phase 4 complete; marked
```

End with the closing summary from Step 6.

## Invocation shape

```text
/bootstrap          # default — skip phases already marked complete
/bootstrap --force  # ignore status markers, re-run every phase (operator
                    #   confirms overwrite on each per-phase artifact)
```

## Related commands

- [`/bootstrap-product`](bootstrap-product.md) — phase 1, invoked from step 2
- [`/bootstrap-architecture`](bootstrap-architecture.md) — phase 2, step 3
- [`/bootstrap-agents`](bootstrap-agents.md) — phase 3, step 4
- [`/bootstrap-workflow`](bootstrap-workflow.md) — phase 4, step 5
- [`/groom-backlog`](groom-backlog.md) — populate Ready after `/bootstrap`
- [`/work-ticket`](work-ticket.md) — pick up the top Ready ticket after grooming
