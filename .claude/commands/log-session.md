---
description: Log a session journal capturing tickets delivered, challenges, mitigations, and insights
---

Write a session journal for today's development session and save it to `reports/session-journals/YYYY-MM-DD.md`.

If a journal already exists for today's date, append a session number suffix (e.g., `2026-02-15-2.md`).

## What to Capture

### 1. Session Summary (2-3 sentences)
High-level narrative of what the session accomplished and its strategic significance.

### 2. Tickets Delivered
For each ticket completed (merged to main) during this session:

| Field | Description |
|-------|-------------|
| Bead id and title | Bead id (e.g. va-142) and short description |
| PR # | Pull request number |
| What changed | 1-2 sentence summary of the implementation |
| Files touched | Key files modified (not exhaustive) |
| Tests added | Count and nature of new tests |

### 3. Tickets In Review
Same format as above, but for beads labeled `in-review` + `pr:<N>` — PRs created and reviewed but not yet merged.

### 4. Challenges and Mitigations
Document every significant obstacle encountered and how it was resolved:

| Field | Description |
|-------|-------------|
| Challenge | What went wrong or blocked progress |
| Root cause | Why it happened |
| Mitigation | How it was resolved |
| Prevention | What would prevent this in the future (if applicable) |

Examples: merge conflicts, CI failures, migration errors, test failures, architectural decisions that needed revision.

### 5. Insights and Learnings
Capture knowledge that will help in future sessions:
- **Technical insights** — patterns discovered, gotchas identified, architecture decisions
- **Process insights** — workflow improvements, efficiency gains, bottlenecks identified
- **Domain insights** — business logic clarifications, product understanding

These should be concrete and actionable, not generic observations.

### 6. Tickets Created
New tickets created during the session with brief context on why they were created.

### 7. Metrics
Quick quantitative summary:
- PRs created / merged / reviewed
- Beads closed / created
- Tests added
- Bead state changes (claims, labels, closes)

### 8. Next Up
Prioritized list of what should be tackled next, with context on dependencies and blockers.

## Format

Use the template structure from existing journals in `reports/session-journals/`. Keep the tone factual and concise — this is a working document for project continuity, not a blog post.

## After Writing

1. Read the journal back to verify completeness
2. Cross-reference against the git log and bd state (`bd list --status=closed --all --json`) to catch anything missed
3. **Validate memory writes** — check that completed tickets have corresponding
   `CompletedTicket` entities in Memory MCP:
   - For each bead listed in "Tickets Delivered", query Memory MCP:
     `mcp__memory__search_nodes({ "query": "CompletedTicket-{bead-id}" })`
   - If Memory MCP is not configured, skip validation:
     `→ Memory validation skipped — Memory MCP server not available`
   - Report results using standard vocabulary:
     `→ Memory OK: CompletedTicket-{bead-id} exists for {bead-id}`
     `✗ Missing memory: CompletedTicket-{bead-id} — no entity found for {bead-id}`
     `→ Run /validate-memory to create missing entities`
   - Summary: `→ Memory validation: {found}/{total} completed tickets have CompletedTicket entities`
4. Present a brief summary to the user
5. **Consolidate session knowledge** — extract insights missed during the
   session and propose Memory MCP entities. Skip this step with an info
   message if Memory MCP is not configured.

   **Step 5a: Gather signals**
   - Read PR diffs and commit messages for PRs merged this session
   - Review the "Challenges and Mitigations" and "Insights and Learnings"
     sections from the journal you just wrote

   **Step 5b: Structured reflection**
   Prompt yourself with these questions, using the gathered signals:
   - What was the root cause of any bugs or CI failures encountered?
   - What patterns were discovered, reused, or established?
   - What would you do differently next time?
   - Were there gotchas that would trip up a future agent on similar work?

   **Step 5c: Check for duplicates**
   For each potential insight, query Memory MCP (`search_nodes`) to verify
   no existing entity already captures it. Skip duplicates.

   **Step 5d: Propose entities**
   Based on reflection, propose up to 5 new Memory MCP entities:
   - `LessonLearned` — gotchas, workarounds, root cause discoveries
   - `PatternDiscovered` — reusable patterns established or confirmed

   Present each proposed entity to the user with a preview:
   ```
   Proposed: Lesson-{short-name}
   Type: LessonLearned
   Observations:
     - {observation 1}
     - {observation 2}
   Create? [present to user for confirmation]
   ```

   **Step 5e: Write confirmed entities**
   Create only the entities the user confirms. Report:
   `→ Created {N} memory entities from session consolidation`

   If no insights worth recording, report:
   `→ No new memory entities proposed — session knowledge already captured`

6. **Reflect for upstream-feedback opportunities** — surface session-shaped findings that would benefit future downstream forks running this framework, and offer (one at a time) to file each as an upstream `[downstream-report]` issue via `/report-issue`. **Voluntary, default does not phone home** — the reflection step runs, but no upstream issue is filed without explicit per-candidate operator confirmation.

   **Skip this step entirely if any of the following holds:**
   - Environment variable `GEMBAFLOW_SKIP_UPSTREAM_FEEDBACK=true` is set (fork-level disable)
   - `/report-issue` is not installed in this fork (check: file `.claude/commands/report-issue.md` absent OR `scripts/report-issue.sh` absent)
   - Step 5 identified zero candidate insights (nothing to reflect against)

   In any skip case, exit Step 6 silently — do NOT print a header or prompt the operator. Default-quiet matters; the goal is for the common case (most sessions have no upstream-worthy candidates) to add zero perceived overhead to `/log-session`.

   **Step 6a: Gather candidate signals**
   - The proposed memory entities from Step 5d (LessonLearned + PatternDiscovered) are the primary candidate pool — these are already-distilled framework-shaped findings.
   - The "Challenges and Mitigations" + "Insights and Learnings" sections of the journal you just wrote — re-read for any framework-attributable items not captured in Step 5.
   - Filter: a candidate is upstream-worthy if it would benefit a future downstream fork that does NOT have the operator's specific session context. Per-fork specialization (this fork's product domain, this fork's customer's voice) is NOT upstream-worthy. Framework mechanics, agent-spec patterns, sync/upgrade behavior, missing pre-flight checks, drain workflow gaps ARE upstream-worthy.

   **Step 6b: Cap and dedup**
   - Cap candidates at **5 per session.** If more than 5 surface, present the top-5 by significance and note the rest in the session journal's "Next Up" section instead.
   - For each candidate, run a dup-check: `gh search issues --repo <upstream-from-.gembaflow-version> "<candidate-title-keywords>" --json number,title,state --limit 5`. If a `[downstream-report]` issue with a matching title shape exists from the last 60 days, mark this candidate "already reported #N" and skip it from the prompt loop (don't ask the operator to re-file).

   **Step 6c: Per-candidate prompt loop**
   - Print a single header line so the operator knows the reflection step is running:
     `→ Step 6: Upstream-feedback reflection — N candidate(s) identified.`
   - For EACH candidate, print a structured payload:
     ```
     Candidate {i}/{N}: {one-line summary}
       Suggested title: [downstream-report] {title}
       Suggested labels: downstream-report, {area-label}
       Why this is upstream-worthy: {one-paragraph rationale referencing what would benefit future forks}
       Duplicate check: {none found in last 60 days | similar to #N — confirm before filing}
     ```
   - Prompt the operator: `[yes / no / edit-first / skip-all-remaining]`
     - **yes** — invoke `/report-issue` with the pre-populated body sketch (see Step 6d for the template) for THIS candidate. Continue to next candidate.
     - **no** — drop this candidate silently. Continue to next candidate.
     - **edit-first** — present the drafted body to the operator inline; operator revises; then invoke `/report-issue` with the revised body. Continue to next candidate.
     - **skip-all-remaining** — exit the per-candidate loop. The reflection step ends; remaining candidates are NOT re-prompted in this session.

   **Step 6d: Pre-populated body template for /report-issue**
   The body sketch follows the existing `[downstream-report]` shape (see `vibeacademy/gembaflow-site:reports/2026-06-28-content-kernel-lived-experience-handoff.md` for a worked example of high-quality phone-home content at extended length; the per-candidate body here is the compressed version):
   ```
   ## What surfaced

   {one-paragraph framing of the finding}

   ## Where this came from (this fork's session)

   - Session: {YYYY-MM-DD} ({reports/session-journals/...md})
   - Specific signal: {file path / ticket / PR / journal-section reference}
   - Memory entity (if applicable): {LessonLearned-name or PatternDiscovered-name}

   ## Why this is framework-shaped (not just fork-local)

   {one-paragraph rationale — what about this generalizes beyond this fork's specifics}

   ## Suggested upstream change shape

   {one-paragraph proposal — what file/skill/agent the upstream maintainer might modify; do NOT prescribe in detail; the upstream owner makes the call}

   ## Cross-links

   - Fork-side session: {URL}
   - Upstream issue this would address (if any): {gh search result}
   ```

   **Step 6e: Reporting and idempotency**
   - After the per-candidate loop completes, summarize: `→ Step 6 complete: {filed} candidate(s) filed upstream via /report-issue, {declined} declined, {skipped} skipped via 'skip-all-remaining', {dups} skipped as duplicates.`
   - The reflection step is NOT re-runnable within the same session — once an operator picks `skip-all-remaining` or completes the loop, `/log-session` exits cleanly. Idempotency across sessions is provided by Step 6b's 60-day dup-check.
   - If a candidate is filed but the upstream maintainer later closes it as wontfix, that closure does NOT prevent re-filing in a future session if the operator chooses — the dup-check looks at issue existence, not state. Operator can decline a re-prompt if they remember the prior wontfix.

   **Failure modes — Step 6 must never block `/log-session` completion:**
   - If `/report-issue` invocation fails on a single candidate (network, auth, etc.), report the failure inline and continue to the next candidate. The journal write + Step 5 entities are already persisted; Step 6 is additive, not blocking.
   - If the operator cancels mid-loop (e.g. ctrl-C), report the partial state (`{i-1}/{N} candidates processed before cancel`) and exit cleanly.

## Related Commands

- `/validate-memory` — Standalone memory validation and entity creation
- `/sprint-status` — Current bead/board health overview
- `/groom-backlog` — Groom beads: DoR, priorities, dependency wiring (`bd ready` is the outcome)
- `/work-ticket` — Claim the next ready bead and implement
- `/report-issue` — File an upstream `[downstream-report]` issue (invoked from Step 6 above on per-candidate yes/edit-first)
