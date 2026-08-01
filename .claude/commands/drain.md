---
description: Drain the ready queue (bd ready) autonomously by looping work-ticket → review-pr → agent-merge → validate for each safely-classified bead, using Claude Code's /goal primitive as the loop driver
---

Drain the ready queue autonomously. Use Claude Code's built-in `/goal` primitive
as the loop driver; this skill supplies the project-specific structure
(pre-flight production-baseline check, `bd ready` snapshot + safety filter,
per-iteration work-ticket + review-pr + agent-merge gate + production
validation, audit emit, rate limits, hard-stop conditions).

> **Reference**: ADR-006 in [`docs/TECHNICAL-ARCHITECTURE.md`](../../docs/TECHNICAL-ARCHITECTURE.md) — the architectural decision that v1 wraps `/goal` in this project-local skill, deferring "true unattended overnight" to a future API-bridge ticket. For the canonical board-model-to-beads mapping, see CLAUDE.md § "Work-Item Tracking (Beads)"; label vocabulary and bd mechanical hygiene: CLAUDE.md critical rules 9-10 + [`docs/BEADS.md`](../../docs/BEADS.md).

## Audience and pre-conditions

You are the operator (`tck517`). Before invoking this skill:

- **The ready queue has been groomed** — every drain-eligible bead carries
  exactly one `safety:*` label (per `docs/safety-classes.md`) and the 4 Power
  Sections (per `docs/TICKET-FORMAT.md`). Grooming applies the `safety:*`
  labels on the beads side; the repo-side PR label vocabulary is seeded once
  by `bash scripts/setup-safety-labels.sh` (pre-flight 4c verifies both).
- **You accept the v1 trade-off** that your machine + Claude Code session must
  stay active while the drain runs (laptop awake, session open). Remote
  unattended operation is a future ticket.
- **You will make the release decision in the morning** — drain only merges
  code to `main`, where it ships dark on production behind feature flags. The
  flag flip (visibility = on for real users) stays a human decision.

## Pre-Flight Verification (REQUIRED — fail closed)

Verify ALL of the following BEFORE setting the `/goal` condition. STOP and
report to the user if any check fails — do not begin the loop with partial
or unhealthy state.

**Step 0 — Resolve config placeholders (RUNS FIRST, before any other check).**

Step 1 below (and the worker/reviewer specs this skill invokes) references
the canonical placeholders documented in
[`docs/PLATFORM-GUIDE.md`](../../docs/PLATFORM-GUIDE.md) §
"Bootstrap-time templated values" (formerly four; `board.id` is retired now
that beads is the tracker). If substitution has not run on this fork, those
steps fail with opaque `account not found` errors that mask the real cause.
Run the substitution check FIRST so the rest of pre-flight can give honest
signals:

```bash
bash scripts/substitute-config-placeholders.sh --check
```

- **Exit 0 (zero unsubstituted placeholders).** Proceed to step 1.
- **Exit 1 (unsubstituted placeholders found) AND `.gembaflow-config.json`
  exists with all fields populated.** Run
  `bash scripts/substitute-config-placeholders.sh` (without `--check`) to
  apply substitution, then proceed to step 1.
- **Exit 1 AND `.gembaflow-config.json` missing or has empty fields.**
  STOP with this message:

  ```
  Drain cannot run: drain.md still has unsubstituted {{...}} placeholders
  and .gembaflow-config.json is missing or incomplete. Run /bootstrap-workflow
  step 7, OR copy .gembaflow-config.example.json to .gembaflow-config.json,
  fill in the values, and re-run /drain. See docs/PLATFORM-GUIDE.md
  § "Bootstrap-time templated values" for the convention.
  ```

  Do not start the drain loop until substitution succeeds. Per #493 (closes
  the opaque-failure cause-of-confusion surfaced in downstream-report #492).

1. **`gh` CLI is authenticated as `{{bot.worker}}`** — `gh auth status` shows
   `{{bot.worker}}` as the active account. If not, run `gh auth switch -u {{bot.worker}}`.
2. **Repository accessible** — `gh repo view --json nameWithOwner` succeeds.
3. **Beads tracker healthy** — `.beads/` exists, `bd ready --json` parses
   (valid JSON array), and `bd dep cycles --json` returns `[]`. A non-empty
   cycles result means the dependency graph has a cycle — STOP, hand the
   cycle list to the operator, and never drain on top of a cyclic graph
   (`bd ready` output is untrustworthy while a cycle exists).
4. **Manual-install drain artifacts** — these don't propagate via template-sync
   by design (workflow files aren't in `syncDirectories`, so forks can
   customize their own workflows without sync clobber). Each fork installs
   them once per `docs/drain-customization.md`. STOP with the relevant install
   pointer if any sub-check fails.

   - **4a. `agent-merge.yml` exists on `main`** — `gh api repos/{owner}/{repo}/contents/.github/workflows/agent-merge.yml --jq .name` returns the file name. If missing: see `docs/drain-customization.md` § "Bridge workflow installation" for the install command. Without this, `gh workflow run agent-merge.yml` returns HTTP 404 mid-cycle (see `Lesson-workflow-dispatch-default-branch`).
   - **4b. `drain-merge-bridge.yml` exists on `main`** — same probe shape, different file. If missing: same doc pointer. Without this, the per-iteration cycle step 7 fails to dispatch.
   - **4c. `safety:*` label vocabulary exists in BOTH places the drain stack reads it.**
     - *Repo PR labels:* `bash scripts/setup-safety-labels.sh --check` must
       report all four labels present (`safety:internal`, `safety:reversible`,
       `safety:hot`, `safety:flagged`) — confirm with `gh label list`. The
       worker copies the bead's `safety:*` label onto the PR at creation and
       the agent-merge gate reads the PR's own labels (gate conditions 1+2),
       so the repo-side vocabulary is load-bearing. If any missing: run
       `bash scripts/setup-safety-labels.sh` (no `--check`) to create them
       idempotently — single command, the helper is safe to re-run.
     - *Beads labels:* at least one bead carries a `safety:*` label —
       `bd list --json | jq '[.[] | select(((.labels // []) | map(select(startswith("safety:"))) | length) > 0)] | length'`
       must be > 0. Zero means grooming has never applied the bd-side safety
       vocabulary; classify (per `docs/safety-classes.md`) before draining.
5. **Every polled external signal points at THIS repo.** For each external
   signal the drain will trust during the run (deploy-status service, error-
   rate baseline project, any provider API the cycle polls), fetch the
   configured target's identity and require it to match
   `gh repo view --json nameWithOwner` before trusting a single reading.
   Concretely for a Render fork: fetch the service for `RENDER_SERVICE_ID`
   and require the service's linked repo to be this repo. Same shape for a
   Sentry project or any other provider. If no external signals are
   configured (the framework-repo default — no deploy plane), this step is
   a no-op: record "no external signals configured" and continue.

   <!-- Rationale (fork drain run va-17h, finding 2): the operator env's
        RENDER_SERVICE_ID pointed at a DIFFERENT repo's production service —
        deploy polling silently queried the wrong product all run, and the
        auto-trigger fallback rebuilt that unrelated service's already-live
        commit (benign, but confessed in the audit). A stale service ID is
        invisible until you assert target identity in pre-flight, so the
        assertion is generic and mandatory: verify ANY polled external
        signal points at this repo before trusting it. -->

6. **Production baseline is healthy** — run `node scripts/sentry-baseline.mjs`
   and compare the returned `baseline_errors_per_min` against the 24-hour
   median. If the current baseline is >2× the 24h median, **abort with a
   production-degraded notice** and report why to the operator. Do not begin
   a drain on top of an already-soft production.
7. **Safety classification — asserted on the drain-eligible snapshot, NOT
   the whole backlog.** Compute the drain-eligible snapshot first (the exact
   query in "Snapshot, sort, filter, plan" step 1: `bd ready --json`,
   `issue_type == "task"`, exactly one `safety:*` label, the run's class
   filter, capped by `--max-tickets` if passed). Then:

   - If the eligible snapshot is non-empty, pre-flight passes. Ready tasks
     excluded for carrying zero or multiple `safety:*` labels are reported
     to the operator as **classification gaps** (a grooming to-do, not a
     drain blocker) — never classify them mid-drain.
   - If the eligible snapshot is empty AND classification gaps exist, STOP
     naming the unclassified bead ids: there is nothing safe to drain, and
     the fix (classify per `docs/safety-classes.md`) belongs to grooming.

   <!-- Rationale (fork drain run va-17h, finding 3): the old pre-flight
        required EVERY ready task classified before ANY drain could start.
        Cheap when Ready was a curated 2-5-item column; with computed
        `bd ready` it forced classifying all 23 migrated product tasks
        before a 3-bead run. Class-filter first, then assert on what the
        run will actually touch. -->

## Snapshot, sort, filter, plan

After pre-flight clears:

1. **Snapshot the ready queue** — `bd ready --json`, filtered to work the
   drain may touch: `issue_type == "task"` AND exactly one `safety:*` label.
   (`bd ready` is blocker-aware but not editorial — it also surfaces epics
   and ungroomed beads; this filter is what makes the queue drain-eligible.)

   ```bash
   bd ready --json | jq '[.[]
     | select(.issue_type == "task")
     | select(((.labels // []) | map(select(startswith("safety:"))) | length) == 1)]'
   ```

2. **Order the snapshot.** Dependency ordering is computed by the tracker —
   `bd ready` is blocker-aware, so the queue cannot contain blocked beads.
   Sort by priority, then bead id.

   <!-- Findings-log note (beads adoption, epic #574): the hand-rolled
        "topo-sort by `Depends on:` body lines" section that lived here is
        DELETED, not moved — bd owns the dependency graph and bd ready
        already excludes blocked beads, so the body-line parser (and its
        known narrowness, see docs/drain-institutional-knowledge.md
        Pattern 5) is retired. Headline simplification of this rewrite.
        Do not reintroduce orchestrator-side dependency sorting. -->

3. **Filter by safety class.** Default filter: `safety:flagged` and
   `safety:internal` only. Include `safety:reversible` ONLY if the operator
   explicitly passed `--include-reversible` in the invocation. `safety:hot`
   is ALWAYS filtered out (per the taxonomy — drain refuses). **For each
   `safety:hot` bead filtered out, post an audit note on the bead itself**
   (`bd comment <id> "drain <run-id>: skipped — safety:hot; promoted to the
   morning manual queue"`) — so the bead carries its own breadcrumb, not just
   the wake-up summary's aggregate listing (per `#132` hardening sub-item 3).
4. **Create the drain-run bead and emit the plan summary.** The run's audit
   anchor is a bead, not a GitHub issue:

   ```bash
   bd create "Drain run $(date -u +%Y-%m-%dT%H:%MZ)" --type=chore -l drain-run
   ```

   Capture the returned bead id as `<drain-run-bead>` — every per-iteration
   audit line and the end-of-run close land on it. Post the plan summary via
   `bd comment <drain-run-bead>` using this structured shape (per `#132`
   hardening sub-item 2 — replaces the prior prose-only form):

   ```markdown
   ## Drain plan

   **Run identifier:** drain-<UTC timestamp>
   **Started:** <ISO timestamp>
   **Production baseline (pre-drain):** <baseline_errors_per_min> errors/min
   **Completion condition:** /goal evaluates (a)-(d) after each turn (see below)

   | Order | Bead | Class | Effort | Est wall-clock | Cumulative |
   |---|---|---|---|---|---|
   | 1 | va-xxx | safety:internal | S | 45min | 45min |
   | 2 | va-yyy | safety:reversible | M | 120min + 30min rate-limit pause | 195min |

   **Total estimate:** <N> hours
   **Rate-limit pauses:** <K>×<window>min for reversibles
   **Skipped at filter time:** <list of safety:hot bead ids, each carrying its own audit comment>
   ```

   Wall-clock heuristic by effort class (averages from past tickets,
   refine over time): XS≈15min, S≈45min, M≈120min, L≈240min. Rate-limit
   pause adds `DRAIN_REVERSIBLES_WINDOW_MIN` (default 30) between
   consecutive `:reversible` beads. Effort comes from the bead's
   `effort:*` label (beads has no effort field).

## Set the `/goal` condition

The loop driver. Set the condition as a single `/goal` invocation:

```text
/goal "Ready queue drained. The condition is met when one of these holds:
  (a) the bd-ready snapshot taken at run start has been fully processed
      (every snapshot bead is now either closed, labeled in-review + pr:<N>,
      or labeled drain-blocked / drain-stuck-on-deploy); OR
  (b) three consecutive beads have failed (any combination of red CI,
      NO-GO review, agent-merge gate denial, or post-merge validation
      failure); OR
  (c) the production baseline has degraded mid-run (Sentry rate > 2× the
      pre-drain baseline) and a single post-rollback re-baseline failed to
      restore health; OR
  (d) the operator passed `--until <ISO time>` and that time has passed.

After each turn, the Haiku evaluator confirms whether one of (a)–(d) holds.
If not, another turn fires automatically to advance one more bead
through the cycle below."
```

## The per-iteration cycle (one bead per turn)

Within each `/goal` turn, advance exactly ONE bead through these steps.
Stop the turn after the validation step (whether pass or fail); the next
turn picks up the next bead.

1. **Pick the top bead** from the sorted snapshot that hasn't been
   touched yet.
2. **Rate-limit check for `safety:reversible`** — if the picked bead is
   `:reversible` and a previous `:reversible` bead merged less than the
   configured window ago in this drain run, skip it for now (it'll be
   picked again on a later turn). Move to the next bead. **Window is
   configurable** via `DRAIN_REVERSIBLES_WINDOW_MIN` env var; default 30
   minutes (per `#132` hardening sub-item 1). All configuration knobs are
   listed in the "Configuration knobs" section below.
3. **Claim the bead** — `bd update <id> --claim` (atomic — two workers can
   never grab the same bead). If the claim fails, another worker already
   holds it: skip to the next bead in the snapshot and never wrestle the
   claim. The claim is the In-Progress signal; there is no board to move
   anything on.
4. **Invoke `/work-ticket <bead-id>` with `DRAIN_CONTEXT=true` set.** The
   drain-mode pre-flight in `work-ticket.md` will verify the safety class is
   present and drain-eligible before proceeding. The `/work-ticket` flow
   handles its own work + push + CI watch + chained `/review-pr`, and — per
   its own protocol — applies the `in-review` + `pr:<N>` labels once the PR
   opens and **copies the bead's `safety:*` label onto the PR at creation**
   (label authority: the bead is the source of truth; the PR carries the
   copy). The agent-merge gate reads the PR's own labels and its
   `Bead: <id>` citation (gate conditions 1+2), not a linked issue.
5. **If `/work-ticket` reports CI red after 3 fix attempts** — mark the
   bead blocked: `bd update <id> --add-label drain-blocked` plus a
   `bd comment <id>` explaining what failed and what was tried. Never close
   it. Increment the consecutive-failure counter, and end the turn.
6. **If `/review-pr` recorded NO-GO** (`verdict:no-go` on the bead — the
   verdict of record lives in the review comments and the bead's
   `verdict:*` label; on repos with the gate's `REVIEWER_APPROVAL_LOGIN`
   set, a GO additionally comes with the reviewer bot's `--approve` on
   the current head, which gate condition 6 will require) — same as
   above.
7. **If CI is green and the verdict is GO (`verdict:go`):**

   **7a. Wait for the FULL check rollup before dispatching the gate.**
   Poll `gh pr view <N> --json statusCheckRollup` until every check in the
   rollup has a terminal conclusion (nothing PENDING / IN_PROGRESS / QUEUED
   / conclusion-less). Time budget: 15 minutes; on timeout, treat as a gate
   denial (step 8). Only checks named in the gate's `IGNORED_CHECKS`
   allowlist may be skipped over — and a name goes on that list ONLY when
   it meets all three criteria in `docs/agent-merge-gate.md`
   § "Informational checks" (genuinely informational AND empirically
   flaky/laggy AND not the sole coverage of a code path).

   <!-- Rationale (fork drain run va-17h, finding 1): the fork's first
        autonomous dispatch was denied because an informational
        provider-side check lagged CI by ~10 minutes — the gate's
        strict-mode condition correctly refused the incomplete rollup.
        "CI is green" is not the same as "the rollup is complete";
        dispatching on the former races every slow informational check.
        Wait for the full rollup (this step), or allowlist the check per
        the documented 3-criteria bar — never widen the gate itself. -->

   **7b. Dispatch the drain-merge bridge** via `repository_dispatch`. The
   bridge (`.github/workflows/drain-merge-bridge.yml`) calls
   `agent-merge.yml` via `workflow_call` — the only path through which the
   gate permits real merges per its safety contract (see ADR-007).

   ```bash
   gh api -X POST /repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/dispatches \
     -f event_type=drain-merge \
     -F client_payload[pr_number]=<PR>
   ```

   Then wait for the bridge workflow run to complete (poll
   `gh run list --workflow=drain-merge-bridge.yml --limit 1 --json status`
   until `completed`); capture the bridge run ID AND the called gate run
   ID for the audit.
8. **If the gate denied the merge** — `bd update <id> --add-label drain-blocked`
   plus a `bd comment <id>` naming the gate's denial reason, increment the
   consecutive-failure counter, end the turn.
9. **Wait for the merge's deploy to land on production.** Poll the deploy
   plane for the deploy of the merge commit; require status `live` before
   proceeding. Time budget: 10 minutes; on timeout, treat as a failed
   validation and proceed to step 11. **Skip this step and step 10's deploy
   probes entirely when no deploy plane is configured** (the framework-repo
   default) — validation then rests on CI + the gate.

   ```bash
   # Poll every 30s for up to 10 minutes; --slack and --post-issue not used here.
   # The deploy-status check goes through scripts/deploy-status/interface.mjs
   # (per #420), which dispatches to the per-plane adapter selected by
   # DRAIN_DEPLOY_PLANE (default: render). Existing Render forks see zero
   # behavior change; Cloud Run / other-plane forks ship their own adapter
   # (see scripts/deploy-status/interface.mjs § "Adding a new adapter" and
   # the Cloud Run adapter tracked in #495).
   #
   # Per #194: after 5 consecutive pending results AND no deploy ever
   # started for our merge SHA, fall back to manually triggering the
   # deploy via Render API (Render's GH integration is empirically
   # unreliable; auto-deploy intermittently doesn't fire). Opt-out via
   # DRAIN_RENDER_AUTO_TRIGGER=false. The auto-trigger is Render-API-specific
   # and only fires when DRAIN_DEPLOY_PLANE is unset or "render"; other planes'
   # adapters should implement their own retry semantics internally.
   PENDING_COUNT=0
   AUTO_TRIGGERED=false
   for i in $(seq 1 20); do
     RESULT=$(node scripts/deploy-status/interface.mjs "$MERGE_SHA")
     LIVE=$(echo "$RESULT" | jq -r '.live')
     SOURCE=$(echo "$RESULT" | jq -r '.source')
     STATUS=$(echo "$RESULT" | jq -r '.status')
     if [ "$LIVE" = "true" ]; then break; fi
     if [ "$SOURCE" = "unavailable" ]; then
       # Token unconfigured OR adapter unreachable OR no adapter for this plane —
       # fall back to the v1 curl liveness probe
       # (per docs/testing/render-gating.md §Fallback).
       break
     fi
     if [ "$STATUS" = "pending" ]; then
       PENDING_COUNT=$((PENDING_COUNT + 1))
     else
       PENDING_COUNT=0
     fi
     if [ "${DRAIN_DEPLOY_PLANE:-render}" = "render" ] && [ "$PENDING_COUNT" -ge 5 ] && [ "$AUTO_TRIGGERED" = "false" ] && [ "${DRAIN_RENDER_AUTO_TRIGGER:-true}" != "false" ]; then
       # 5 consecutive pending (~2.5 minutes) with no deploy ever found
       # for this SHA — auto-deploy webhook didn't fire. Trigger manually.
       echo "[drain] step 9: auto-deploy didn't fire for ${MERGE_SHA:0:7}; triggering manually (per #194)"
       curl -s -X POST -H "Authorization: Bearer $RENDER_API_TOKEN" \
         -H "Content-Type: application/json" -d '{}' \
         "${RENDER_API_BASE:-https://api.render.com/v1}/services/$RENDER_SERVICE_ID/deploys" > /dev/null
       AUTO_TRIGGERED=true
       # Reset pending counter — the new deploy starts from scratch
       PENDING_COUNT=0
     fi
     sleep 30
   done
   ```

   When `RENDER_API_TOKEN` + `RENDER_SERVICE_ID` are configured (see
   "Configuration knobs" below + `docs/testing/render-gating.md`), this
   polls until the *specific* merge's deploy is `live` — meaning subsequent
   validation hits the new code, not the old one. When the env vars are
   unset (the v1 default before `#180` shipped, and the safe fallback for
   when Render's API is unreachable), the loop exits immediately on
   `source: "unavailable"` and the curl probe in step 10 alone gates
   liveness (the same v1 substitution used during the first real drain
   run on 2026-06-08).

   **Auto-trigger fallback (per `#194`):** if 5 consecutive `pending`
   results indicate no deploy was ever found for the merge SHA (Render's
   GH integration didn't fire), the loop triggers a manual deploy via
   `POST /v1/services/{id}/deploys` with empty body — Render then builds
   the latest commit on `main` (which IS our merge). Opt-out via
   `DRAIN_RENDER_AUTO_TRIGGER=false` env var. The fallback fires at most
   once per bead cycle (`AUTO_TRIGGERED` flag) so a failed manual deploy
   doesn't trigger an endless retry loop.

   ### Verification methods to AVOID (per `#217`)

   Two channels look like deploy-progress signals but lie:

   - **`gh api commits/<sha>/status`** — Render IS receiving GitHub
     webhooks, IS building, and IS deploying, but does not always
     post status back to GitHub. Empirically silent on healthy
     deploys; treating `state: pending, statuses: []` as "deploy
     didn't fire" reads the wrong channel. Do not use as a deploy-
     progress signal under any circumstance. See `docs/drain-verification.md`
     for the postmortem on two false-positive Merged-NotDeployed
     verdicts (#152 and #210) that traced to this channel.
   - **Raw-character content-marker greps against rendered HTML** —
     markdown's `&` renders as `&amp;` in HTML; `<` as `&lt;`; `"` as
     `&quot;`. A grep for a marker containing any of those characters
     misses content that's actually there.

   ### Approved verification methods

   - **`node scripts/render-deploy-status.mjs <SHA>`** is the
     authoritative deploy-state reader. If it returns `source:
     "unavailable"` with `hint: "env vars not visible..."`, the
     credentials are likely fish-universal-only and not inherited by
     Bash — retry via `fish -c "node scripts/render-deploy-status.mjs <SHA>"`
     to confirm before treating the deploy as failed. See saved lesson
     `claude-code-bash-does-not-inherit-fish-universal-vars`.
   - **Entity-encoding-aware content markers** when the curl fallback
     is the only verification path: prefer path segments
     (`/bootstrap-product`), heading slugs (`workshop-printing`), or
     alphanumeric prose. Avoid markers containing `&`, `<`, `>`, `"`,
     or `'`.

10. **Run post-merge validation** — the deploy URL is fork-specific; export it as
    `PUBLIC_BASE_URL` before invoking, e.g. `export PUBLIC_BASE_URL=https://<your-deploy>.<provider>.example`.
    `PLAYWRIGHT_BASE_URL="$PUBLIC_BASE_URL" npx playwright test --grep @smoke-production`.
    For `safety:internal` beads, the lightweight alternative is
    `curl -fsS "$PUBLIC_BASE_URL/api/health" && curl -fsS "$PUBLIC_BASE_URL/"`
    returning 200 from both (per the architecture report's lightweight-internal-validation rule).
    For `safety:internal` beads that ship content rather than infra,
    the curl probe SHOULD additionally grep for at least one entity-
    encoding-safe marker (path segment, heading slug, or alphanumeric
    prose) — NOT a marker containing `&`, `<`, `>`, `"`, or `'` (per
    `#217`; markdown's `&` renders as `&amp;` in HTML and raw-character
    greps silently miss it).
11. **Verify before close.** If validation passed, the bead may be closed —
    the drain IS the orchestrator path, so it (unlike workers) is allowed to
    `bd close` — but ONLY after independently confirming the merge landed:

    ```bash
    gh pr view <N> --json state,mergedAt   # require state == "MERGED" and a non-null mergedAt
    bd close <id> --reason "PR #N merged to main via agent-merge gate, deploy validated"
    ```

    Never close unverified — if `gh pr view` does not confirm the merge,
    treat the bead as blocked (`bd update <id> --add-label drain-blocked` +
    `bd comment <id>` explaining the merge-state mismatch) and increment the
    consecutive-failure counter instead. On a verified close: reset the
    consecutive-failure counter to 0 and post the audit comment
    (`bd comment <id>`) naming the merge commit, the deploy ID, and the
    validation result.
12. **If step 9 reported a terminal deploy failure** (`build_failed`, `update_failed`, `canceled`)
    **AND no rollback target is available** (the merge's deploy never landed —
    Render kept the previous successful deploy live; nothing to revert to at
    Render's level): the bead is **Merged-NotDeployed** (per `#189`). Apply
    `bd update <id> --add-label drain-stuck-on-deploy` and post a
    `bd comment <id>` explaining the merge-but-no-deploy state. Never close
    it — the merge is real but unverified in production. Increment the
    consecutive-failure counter. Skip step 13 (rollback) entirely — there's
    no deploy to roll back from. This outcome is **distinct from
    Blocked-Rolled-Back**: the rollback path fires only when a deploy
    successfully landed AND post-deploy validation failed; the
    Merged-NotDeployed path fires when the deploy itself never landed.
    Conflating them would mislead the morning operator (no rollback actually
    happened; nothing to investigate at the rollback layer).
13. **If validation fails after a successful deploy:** trigger `gh workflow run rollback-production.yml`
    with the previous good deploy ID. Wait for the rollback to complete.
    Mark the bead rolled back: `bd update <id> --add-label drain-blocked`
    plus a `bd comment <id>` naming the rollback workflow run ID. Never
    close it. Increment the consecutive-failure counter. Re-baseline
    production (steps in pre-flight #6); if the re-baseline FAILS,
    hard-stop the drain.
14. **End the turn.** `/goal`'s evaluator checks the completion condition;
    if not met, fires another turn.

## Audit emit (per bead)

After each turn, the drain MUST leave a `bd comment` on the worked bead
naming:

- The drain run identifier (and the `<drain-run-bead>` id).
- The outcome: Done / Blocked / Blocked-Rolled-Back / Merged-NotDeployed / Skipped.
- The PR number created (if any) and the merge commit (if merged).
- The workflow run IDs for `agent-merge.yml` and validation.
- The Sentry baseline before vs after (for Done outcomes).
- The reason (for Blocked / Rolled-back / Skipped).

Additionally, append a one-line audit entry to the drain-run bead
(`bd comment <drain-run-bead> "<bead-id>: <outcome> — PR #N, <short reason>"`)
so the run anchor carries the full sequence in one place.

The audit comments are the load-bearing artifact for the morning review —
the operator should be able to reconstruct what happened to every bead
from these comments alone.

## Wake-up summary (end of run)

When `/goal` reports the condition met (or when the drain hard-stops),
the per-bead outcomes are already in the state file (written through
`scripts/write-drain-state.mjs` at the 9 trigger points below); pipe the
state through `scripts/emit-drain-summary.mjs` to render the canonical
Markdown summary, then print it to the operator. The script also fires an
optional Slack ping when `DRAIN_SLACK_WEBHOOK_URL` is set in the
environment. Finally, close the drain-run bead with a summary reason:

```bash
# State JSON shape lives in scripts/emit-drain-summary.mjs (the
# top-of-file comment); every write goes through the schema-validated
# helper — see "State persistence & resumption" below.
node scripts/emit-drain-summary.mjs /tmp/drain-state-<drainId>.json --slack

bd close <drain-run-bead> --reason "drain-<UTC timestamp>: shipped <S>, blocked <B>, rolled back <R>, merged-not-deployed <M>, skipped <K>"
```

(The script's `--post-issue <N>` flag — which shells to
`gh issue comment <N> --body-file -` per `#178` and also accepts PR numbers —
still exists for forks that keep a GitHub surface for the summary; the
beads-native path here does not use it. The Markdown always prints to
stdout, so the operator can also pipe or save it locally if needed.)

The summary covers six sections (per `__tests__/emit-drain-summary.test.ts`):

| Section | Content |
|---|---|
| Tickets shipped (Done) | Bead ids + titles, with safety class, PR link, merge SHA, and audit links |
| Tickets blocked | Bead ids + titles + reason summary + PR link |
| Tickets rolled back | Bead ids + titles + the rollback workflow run ID |
| Tickets merged but not deployed (per `#189`) | Bead ids + titles + safety class + PR link + merge SHA + reason (e.g., Render `build_failed`) + audit link |
| Tickets skipped (`safety:hot` or rate-limited) | Bead ids + titles + reason |
| Production status at end of run | Sentry baseline before vs after + last health-check result + healthy/DEGRADED verdict |
| Recommended morning actions | Auto-synthesized: release flip for shipped `safety:flagged` beads; triage for blocked; investigation for rolled-back; manual-queue promotion for skipped `:hot`; abort-cause investigation if aborted |

The summary is emitted even when the drain aborts early (per
`#131` guardrail) — partial info beats silent failure. Runs that
ship >20 beads get a "large drain — flagged for daytime human
review" warning prepended.

## Critical Rules

1. **Never bypass the agent-merge gate.** Always dispatch via the drain-merge bridge (`repository_dispatch` → `workflow_call`); never invoke `gh pr merge` directly. The gate's 7-condition re-verification (bead citation + safety label on the PR + complete green rollup + open-against-main + no do-not-merge + config-gated second-identity approval + caller audit) is the load-bearing safety boundary. The second-identity condition is configurable, not doctrinal (`REVIEWER_APPROVAL_LOGIN` in the gate's env): upstream's copy requires a fresh head-bound `--approve` from the reviewer bot, so a single compromised worker identity cannot self-merge; never-approve forks empty the config knowingly — their GO verdict lives in the review comments and the bead's `verdict:*` label, and the drain only dispatches after GO (cycle step 7). See `docs/agent-merge-gate.md`.
2. **Never demote a `safety:hot` bead during the run.** Hot beads are explicitly out of scope for autonomous processing. If the operator wants a hot bead merged, they do it themselves.
3. **Never advance past production-baseline degradation OR mid-run Merged-NotDeployed accumulation.** Re-baseline after every rolled-back bead; if the re-baseline fails, hard-stop. If two or more beads accumulate the Merged-NotDeployed outcome in the same run, hard-stop — the deploy pipeline is unhealthy and continuing would stack more stuck merges on top of broken infrastructure (per `#189`).
4. **Never run more than one `safety:reversible` bead per `DRAIN_REVERSIBLES_WINDOW_MIN`-minute window** (default 30, configurable). The architecture report's rate-limit isn't optional — it exists because two reversibles back-to-back failing makes the rollback ambiguous. See the "Configuration knobs" section below for the env var.
5. **Never mutate bd state for a bead the drain didn't claim** (except the drain-run bead, which the drain creates, comments on, and closes itself). The snapshot is taken at run start; beads that become ready mid-run are processed in the NEXT drain, not this one.
6. **`safety:flagged` beads ship dark; the flag flip is a human decision.** The drain never lifts a flag; it only merges code behind one. The morning release decision belongs to the operator.
7. **Never close a bead the merge of which is unverified.** `bd close` happens only in step 11 ("Verify before close"), after `gh pr view <N> --json state,mergedAt` confirms. Blocked / rolled-back / merged-not-deployed outcomes get labels + comments, never closes.
8. **Sub-agents must not chain the prioritizer (or any grooming/backlog mutation) mid-run.** Review-spawned follow-ups are filed as ungroomed beads and groomed AFTER the run — the snapshot taken at run start is the run's whole world (rule 5).

   <!-- Rationale (fork drain run va-17h, finding 4): one drain reviewer
        chained the prioritizer mid-run despite the defer-to-post-run
        instruction — harmless only because rule 5 kept it off the
        snapshot. Long-prompt sub-agents drift; the snapshot rule is a
        protocol line, not advice. -->

> **Boards note:** `.gembaflow-boards/{kanban,techtree}.html` regenerate
> via the Stop + SessionStart hooks (`.claude/hooks/render-boards-on-bd.sh`)
> — the drain's claims, labels, and closes show up there on their own
> cadence, with `/board-refresh` as the manual escape hatch. The drain
> never edits the HTML.

## Invocation shape

```text
/drain                           # default: process flagged + internal; no end time
/drain --until 06:00             # stop at 6am if the queue isn't empty by then
/drain --include-reversible      # opt-in to processing reversibles (rate-limited)
/drain --max-tickets 5           # cap the number of beads processed
/drain --dry-run                 # emit the plan summary; do not execute
/drain --resume <drainId>        # resume an interrupted drain run (per #204)
/drain --resume                  # auto-detect most recent interrupted drain
```

`--dry-run` invokes everything through the snapshot + sort + filter +
plan-summary emit, then stops without setting the `/goal` condition. Useful
for verifying the plan before bed. (Dry-run still creates and closes a
drain-run bead so the plan has an audit anchor.)

`--resume` re-enters a drain that was interrupted (typically by an
Anthropic API error or operator session close). It reads the on-disk
state file from `/tmp/drain-state-<drainId>.json`, reconciles against
real-world state (PR / bridge / deploy plane / bd labels), and continues
from the appropriate cycle step. See [`docs/drain-resumption.md`](../../docs/drain-resumption.md)
for the mechanism, edge cases, and cleanup discipline.

## Configuration knobs

All drain tunables are env vars, listed here so they're reviewable in a
single block (per `#132` hardening guardrail):

| Env var | Default | Purpose |
|---|---|---|
| `DRAIN_REVERSIBLES_WINDOW_MIN` | `30` | Minimum minutes between consecutive `safety:reversible` merges in a single drain run (per-iteration cycle step 2 + Critical Rule #4). Lower values make drains run faster but make rollback ambiguity more likely when multiple reversibles fail back-to-back. |
| `DRAIN_SLACK_WEBHOOK_URL` | *(unset)* | Optional Slack webhook for the wake-up summary's short-form ping. Wake-up summary still prints to the operator and the drain-run bead close reason carries the totals regardless; this just adds an external channel. Unset → no Slack call (per `scripts/emit-drain-summary.mjs` env-gating contract). |
| `DRAIN_CONTEXT` | *(unset)* | Set to `true` by this skill before invoking `/work-ticket <bead-id>` so the work-ticket pre-flight applies drain-mode safety-class checks (per `work-ticket.md` "Drain Mode Pre-Flight"). |
| `DRAIN_RENDER_AUTO_TRIGGER` | `true` | When `true` (default), step 9 falls back to manually triggering a Render deploy via API after 5 consecutive `pending` polls indicate the auto-deploy webhook didn't fire (per `#194` — Render's GH integration is empirically unreliable). Set to `false` to opt out and let step 9 simply time out instead. Opt-out makes sense when the operator wants to investigate provider-side reliability issues rather than work around them. |

The Sentry-baseline pre-flight (#6) reads its own env vars
(`SENTRY_API_URL`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`)
per `docs/testing/sentry-gating.md` — those are independent of drain
configuration and live in the operator's shell config, not in this
table.

Similarly, the deploy-status step (#9 in the per-iteration cycle)
reads its own env vars (`RENDER_API_TOKEN`, `RENDER_SERVICE_ID`,
optional `RENDER_API_BASE`, `DRAIN_DEPLOY_PLANE`) per
`docs/testing/render-gating.md`. When those env vars are unset, step 9's
`scripts/deploy-status/interface.mjs` call returns `source: "unavailable"`
and the loop exits immediately; step 10's curl probe alone gates liveness
(the v1 fallback). Setting the env vars upgrades step 9 from "some
version is alive" to "this merge's deploy is live" — and pre-flight #5
asserts the configured target actually belongs to this repo before any
of it is trusted.

## State persistence & resumption (per `#204`)

Drain runs are operator-active per ADR-006 — the operator's machine
must stay on and the Claude Code session must stay open. Empirically
the Anthropic API errors mid-run from time to time (rate limit, 5xx,
transient outage), halting the session and forcing manual re-engagement.
Per `#204`, the skill writes its in-flight state to disk at 9 trigger
points so a `/drain --resume` can re-enter cleanly without re-doing
work the original run already shipped.

### State file location

`/tmp/drain-state-<drainId>.json` — one file per drain run. Written
atomically (`<file>.tmp` → `mv` to final path) so a partial write
can't corrupt the resume payload.

### Every write goes through the helper — never free-form

State is written EXCLUSIVELY via `scripts/write-drain-state.mjs`
(merge-patch on stdin, schema-validated, atomic tmp+rename,
`lastWriteTime` stamped automatically):

```bash
echo '{"currentCycle": 2, "currentCycleStep": "7-bridge-dispatch",
       "currentTicket": {"bead": "<id>", "prNumber": <N>}}' \
  | node scripts/write-drain-state.mjs /tmp/drain-state-<drainId>.json
```

The helper REJECTS unknown field names loudly, naming the off-schema
field and the allowed set. A schema rejection means the orchestrator is
drifting — fix the field name; never bypass the helper to "just write
the JSON".

<!-- Rationale (fork drain run va-17h, finding 4): the orchestrator
     hand-authored the state JSON with off-schema field names, which
     silently degraded the first wake-up-summary render — the renderer
     read `state.shipped ?? []` and produced an empty summary of a
     successful run. The helper turns that silent drift into a loud
     write-time failure. -->

### State JSON shape

The canonical shape lives in the top-of-file comment of
[`scripts/emit-drain-summary.mjs`](../../scripts/emit-drain-summary.mjs);
`scripts/write-drain-state.mjs` enforces it at write time.
Mid-run fields (`currentCycle`, `currentCycleStep`, `currentTicket`
— whose work-item key is the bead id — `snapshotOrder` (bead-id strings),
`lastWriteTime`, `drainBead`) are written by this skill and read
by the `--resume` reconciliation logic. End-of-run fields (the bucket
arrays + `productionStatus`) are read by the renderer for the wake-up
summary.

### The 9 state-write trigger points

State is written immediately after each:

1. Pre-flight verification clears
2. Snapshot + sort + filter + plan-summary emit completes (including
   the drain-run bead creation)
3. A bead is claimed (per-cycle step 3)
4. A PR is created and pushed (per-cycle step 4)
5. The drain-merge bridge dispatch fires (per-cycle step 7b)
6. The deploy plane reports the merge's deploy is `live` (per-cycle step 9 exits success)
7. Post-deploy validation passes and the bead is verified-closed (per-cycle step 11)
8. A bead lands in Blocked / Rolled-Back / Merged-NotDeployed
   (per-cycle step 12 or 13)
9. The drain hard-stops (any of the four termination conditions)

State writes are **best-effort** for I/O failures: a disk-write failure
logs a warning to stderr but does not halt the drain — the worst case is
"runs without resumability," not "runs are corrupted." A SCHEMA failure
from the helper is different: it means the orchestrator produced an
off-contract field and must correct it before continuing.

### `--resume` invocation contract

When invoked, `--resume` does the following in order:

1. **Locate the state file.** If `<drainId>` was passed, read
   `/tmp/drain-state-<drainId>.json`. If no arg was passed, find the
   most recent `/tmp/drain-state-*.json` whose drain-run bead is
   still open; refuse with a diagnostic if zero or more than one
   candidate matches.
2. **Verify the drain is in-flight.** Confirm the drain-run bead
   (`state.drainBead`) is still open — `bd show <id> --json` (returns an
   array; read the first element's status). If it's closed, refuse with a
   diagnostic — the previous run was wrapped up, the saved state is
   stale, and resuming would mutate already-final state.
3. **Reconcile `currentTicket` with real-world state.** Between
   interruption and resume, the world may have moved:
   - **(a) PR not yet created** — re-enter at per-cycle step 4
     (`/work-ticket <bead-id>`)
   - **(b) PR open, CI red/pending** — re-enter at the CI-watch loop
     in `/work-ticket`'s step 9
   - **(c) PR open, CI green, no review yet** — re-enter at
     `/work-ticket`'s step 10 (chained `/review-pr`)
   - **(d) GO verdict recorded (`verdict:go` on the bead), bridge not
     yet dispatched** — re-enter at per-cycle step 7 (full-rollup wait,
     then bridge dispatch)
   - **(e) Bridge dispatched, run not yet complete** — re-enter at the
     bridge-completion poll in step 7b
   - **(f) Bridge succeeded, deploy plane not yet polled** — re-enter at
     per-cycle step 9 (deploy poll)
   - **(g) Deploy reports live, validation not run** — re-enter at
     per-cycle step 10 (validation)
   - **(h) Validation already ran, bead outcome not recorded** —
     re-enter at step 11/12/13 (verify-before-close or label + audit comment)
4. **Mark the run as resumed.** Set `state.resumedFromInterruption = true`,
   `state.originalStartTime = state.startTime` (preserved),
   `state.resumedAt = <now>`, `state.startTime = state.resumedAt` — via
   the state helper, like every other write. The wake-up summary's
   renderer reads these to prepend the resumption banner.
5. **Process the remaining beads** in `state.snapshotOrder` (the
   sorted initial array of bead ids) starting from the position after
   `currentTicket`, applying the standard per-iteration cycle.

### When NOT to use `--resume`

- The operator already manually completed the in-flight cycle outside
  the skill (e.g., merged the PR, ran validation by hand). The saved
  state is stale; delete it (`rm /tmp/drain-state-<drainId>.json`) and
  start a fresh drain on the remaining beads.
- The interruption was longer than a few hours and the production
  baseline has shifted significantly. Re-baseline manually before
  deciding whether `--resume` is safer than a fresh run.
- The drain-run bead has been closed (the previous wake-up summary
  was already emitted). `--resume` refuses; this is intentional.

### State file cleanup

Files older than 24 hours can be safely removed:

```bash
find /tmp -maxdepth 1 -name 'drain-state-*.json' -mtime +1 -delete
```

The skill does not auto-cleanup — the operator's discipline. A stale
file on disk doesn't cause harm; it just consumes space. `--resume`
without an arg auto-filters to drains whose drain-run bead is open, so
old state files don't accidentally route a resume to the wrong drain.

## Output format

End the drain with a single result block for the operator:

```text
**Result:** Drain complete
Beads processed: <N>
Shipped: <S>  Blocked: <B>  Rolled back: <R>  Skipped: <K>
Production status: healthy | degraded
Drain-run bead: <id> (closed with summary reason)
```

If the drain hard-stopped, the result line names the reason:

```text
**Result:** Drain halted
Reason: <consecutive-failure threshold | re-baseline failure | rollback failure | operator cancelled>
Last action: <bead id and outcome>
Drain-run bead: <id> (closed with partial summary reason)
```

## Related commands

- [`/work-ticket`](work-ticket.md) — the per-bead workhorse. Drain invokes it with `DRAIN_CONTEXT=true`.
- [`/review-pr`](review-pr.md) — auto-chained from `/work-ticket` on green CI per project policy; records the verdict as a `verdict:*` label + bd comment (plus the gate-qualifying `--approve` on repos where the gate's `REVIEWER_APPROVAL_LOGIN` is set).
- [`agent-merge.yml`](../../.github/workflows/agent-merge.yml) — the conditional merge gate. Drain dispatches it per bead; condition logic in `scripts/check-merge-gate.sh`.
- [`/groom-backlog`](groom-backlog.md) — the daytime work that makes beads ready (`bd ready` is the outcome) before invoking `/drain`.
- [`/board-refresh`](board-refresh.md) — manual board-projection refresh if the operator wants boards current mid-run.

## Reference reading

- ADR-006 in `docs/TECHNICAL-ARCHITECTURE.md` — the architectural decision behind this skill.
- CLAUDE.md § "Work-Item Tracking (Beads)" — the canonical board-model-to-beads mapping (referenced, never copied) + label vocabulary.
- `docs/BEADS.md` — bd version pin, upgrade procedure, mechanical hygiene.
- `docs/safety-classes.md` — the taxonomy `/drain` filters on.
- `docs/agent-merge-gate.md` — the gate `/drain` dispatches per bead (conditions, IGNORED_CHECKS 3-criteria bar, revert procedure).
- `docs/feature-flags.md` — the convention behind `safety:flagged` (dark deploy, morning flip).
- `reports/autonomous-drain-2026-06-03.md` — the architecture report that motivated this work (§5 taxonomy, §6 workflow shape, §11 bot model, §13 devops review items).
