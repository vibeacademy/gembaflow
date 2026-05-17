# Plan: Memory Architecture Documentation

## Goal

Create `docs/MEMORY-ARCHITECTURE.md` — a document that explains how agile-flow
implements agent memory, using the operating system / cognitive science mental
model from the "Architecting Agentic Memory" framework. A reader who has seen
those slides should immediately recognize how each concept maps to agile-flow's
concrete implementation, and where the deliberate gaps are.

## Audience

- Developers evaluating or adopting the agile-flow template
- Anyone who has read or watched content on agentic memory architecture
- Future contributors who need to understand *why* the system persists state
  the way it does, not just *how*

## Document Structure

### Section 1: The Mental Model (1 page)

Establish the OS analogy upfront so the rest of the doc has a shared vocabulary.

| Concept | Definition | Agile Flow |
|---------|-----------|------------|
| CPU | LLM reasoning engine | Claude Code (per-agent session) |
| RAM | Context window | CLAUDE.md + agent policy + ticket/PR |
| DISK | External persistence | GitHub board, Memory MCP, git, docs/ |
| Memory Controller | Paging logic | Slash commands + agent protocols |

Brief paragraph: why this analogy matters, why "just use a bigger context
window" doesn't work (link to CONTEXT-OPTIMIZATIONS.md for details).

### Section 2: The Four Memory Types (2 pages)

Map each cognitive memory type to concrete agile-flow components. For each type:
- What it stores
- Where it lives
- Who reads/writes it
- Lifespan and eviction rules

**Working Memory** (Context Window)
- CLAUDE.md (always loaded, ~240 lines)
- Agent policy file (role-specific, loaded per invocation)
- Current ticket description or PR diff
- Conversation history (auto-compressed by Claude Code)
- Design principle: keep base context small, page in task-specific data

**Episodic Memory** (What Happened)
- Session journals (`reports/session-journals/`)
- Memory MCP: CompletedTicket, ReviewObservation entities
- Git log / PR history
- Design principle: record enough to resume, not enough to drown

**Semantic Memory** (What We Know)
- Memory MCP: PatternDiscovered, LessonLearned, FeatureDecision entities
- docs/ directory: PRD, architecture, agentic controls
- Design principle: persistent facts, deduplicated, canonical location

**Procedural Memory** (How We Work)
- GitHub Project Board columns (workflow state machine)
- Ticket format (4 Power Sections = structured handoff interface)
- Hooks and pre-push gates (automated enforcement)
- Agent protocols (NON-NEGOTIABLE blocks)
- Design principle: automate what agents forget, enforce via architecture

### Section 3: How Data Flows (1 page)

A lifecycle diagram showing a single ticket's journey through the memory system:

1. **Session start** — Working memory loaded (CLAUDE.md + agent policy).
   Agent queries Memory MCP for relevant episodic/semantic context.
2. **During session** — Agent reads procedural state (board column, ticket
   description). Implements work. Explicit writes to Memory MCP (hot-path).
3. **Session end** — `/log-session` captures consolidated insights.
   CompletedTicket entity recorded. Session journal written.
4. **Next session** — New agent loads working memory, queries Memory MCP,
   reads session journal. Picks up where the last session left off.

Include a simple text-based diagram (no mermaid — keep it renderable everywhere).

### Section 4: Retrieval and Write Mechanics (1 page)

**Retrieval:**
- Keyword search via Memory MCP `search_nodes` (current implementation)
- GitHub API queries for board state, PR comments, issue timeline
- File reads for docs/ and session journals
- Note: no vector/embedding search — keyword search is sufficient at current
  scale, entity naming conventions compensate

**Write paths:**
- Explicit (hot-path): agent calls Memory MCP mid-session (CompletedTicket,
  ReviewObservation, LessonLearned). Blocks conversation until write completes.
- Manual (session-end): `/log-session` captures consolidated session insights.
  Human-triggered, not automatic.

### Section 5: Known Gaps and Design Decisions (1 page)

For each gap, explain: what the "textbook" architecture recommends, why
agile-flow doesn't implement it (yet), the practical impact, and the
recommended mitigation when it starts to matter.

| Gap | Textbook | Agile Flow Today | When It Matters | Mitigation |
|-----|----------|-----------------|-----------------|------------|
| No time-decay | Exponential decay on episodic memory | All entities equal weight | After ~6 months | Add `last_verified` field, periodic pruning |
| No consolidation loop | Async background reflector | Manual `/log-session` | Knowledge loss on skipped sessions | Enhance log-session to read transcripts |
| No vector search | Embedding-based retrieval | Keyword search | At 500+ entities | Consistent naming conventions; swap MCP server later |
| No auto context paging | Memory controller selects relevant context | Static base context per agent | Agent misses relevant past lessons | Add ticket-aware Memory MCP query to `/work-ticket` |
| No procedural versioning | State history with rollback | Board shows current state only | Tickets bouncing between columns | Require issue comments on backward moves |
| Unenforced memory writes | Architecturally guaranteed writes | Agent protocol (soft enforcement) | Silent knowledge loss | Post-session validation hook |

Frame these as *deliberate simplicity* — the template optimizes for
approachability over completeness. Each gap has a clear upgrade path.

### Section 6: Extending the Memory System (0.5 page)

Brief guidance for teams that outgrow the defaults:
- Swapping Memory MCP backend for a vector-enabled server
- Adding a consolidation cron job
- Building a pruning command
- Enforcing memory writes via hooks

Link to the relevant slide concepts so readers can map extensions back to
the architecture.

## What Changes in Existing Docs

- **CLAUDE.md**: Add `docs/MEMORY-ARCHITECTURE.md` to the Reference table
  (one line addition)
- **docs/CONTEXT-OPTIMIZATIONS.md**: Add a cross-reference to the new doc
  in the opening paragraph ("For the full memory architecture, see
  MEMORY-ARCHITECTURE.md. This document focuses on context window optimization.")
- No other docs need changes — the memory doc references them, not the
  other way around

## What This Plan Does NOT Include

- Code changes (no new commands, hooks, or memory write enforcement)
- Changes to agent policy files
- Implementation of any gap mitigations
- Changes to Memory MCP configuration

Those would be separate tickets. This plan is documentation only.

## Estimated Effort

- Writing the doc: M (0.5-2 days)
- Updating cross-references: S (< 1 hour)

## Open Questions for Review

1. Should the doc include the full gap analysis with priority ordering, or
   keep it to the table and link to a separate roadmap ticket?
2. Should Section 3 (data flow) use a visual diagram, or is a numbered
   walkthrough sufficient?
3. Do we want to name-drop the "Architecting Agentic Memory" source
   material directly, or keep the concepts generic?
