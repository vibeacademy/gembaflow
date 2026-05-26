# Multi-Fork Distribution Strategy

**Status:** Research / pre-decision
**Date:** 2026-04-17
**Context:** Anticipating per-cloud forks (AWS, GCP, possibly Azure) for corporate workshops, driven by GCP workshop planning. Spike at `~/projects/vibeacademy/agile-flow-gcp-staging` already proved a Cloud Run + Neon fork; an AWS variant is plausible if corporate workshops continue.
**Question:** How do common changes (agent prompts, ticket format, skills, CI scaffolding) propagate from the base template to N cloud-specific variants without compounding divergence?

---

## Problem

The current spike (`agile-flow-gcp-staging`) uses `UPSTREAM.md` to track divergence and a manual cherry-pick procedure to pull framework changes from upstream `vibeacademy/agile-flow`. This works for one fork. It breaks down at N forks:

- Every upstream change must be evaluated and applied N times by hand.
- Divergence compounds — each fork drifts independently.
- Bug fixes to shared assets (agent prompts, skills) take N PRs to land everywhere.
- New variants take longer to bootstrap each time the framework evolves.

A durable answer is needed before a second fork (AWS) is created.

---

## Options Considered

### Option 1: Layered template — overlay model

Keep `vibeacademy/agile-flow` as the **base** containing only stack/cloud-agnostic content. Each variant is a thin **overlay repo** that injects platform/stack-specific files on top.

```
agile-flow/                       ← base (agents, skills, ticket format, ci.yml, docs/AGENT-*.md)
agile-flow-overlay-render/        ← Render + Next.js
agile-flow-overlay-gcp/           ← GCP + FastAPI
agile-flow-overlay-aws/           ← AWS + (whatever)
```

Participants run a one-liner that clones base + overlay and merges them into a starter repo:

```bash
curl -L https://flow.vibeacademy.dev/init.sh | bash -s -- --variant gcp
```

| Pro | Con |
|-----|-----|
| Common code lives in exactly one place. Bug fix in agent prompts → all variants get it on next sync. | Requires building the merge tool (a script that overlays files with conflict detection). ~1 day of work. |
| Variants are small (10-30 files vs 200). Easier to review and reason about. | Participants get a generated repo, not a forked repo. Loses git history from upstream. |
| New variants are fast to add. | Files that need to differ between base and overlay (e.g., CLAUDE.md) need explicit overlay declarations. |

Pattern reference: `create-react-app`, `degit`, old Yeoman generators. Battle-tested.

---

### Option 2: Monorepo with starters/

One repo with a `starters/` directory. Each variant is a subdirectory. The bootstrap script copies the chosen starter + the shared `framework/` directory into the participant's new repo.

```
agile-flow/
├── framework/          ← shared agents, skills, docs, ci.yml
├── starters/
│   ├── render-nextjs/
│   ├── gcp-fastapi/
│   └── aws-django/
└── bootstrap.sh        ← copies framework/ + starters/{variant}/ into new repo
```

| Pro | Con |
|-----|-----|
| Atomic commits across framework + variants. PR can update all variants in lockstep. | Single repo gets large. CI runs need to be variant-aware. |
| Already partially in place — `bootstrap.sh` and `starters/` exist in the spike. | Forks of variants live as subdirectories, awkward for users who want to fork "just the GCP one." |
| No upstream sync problem at all. | Issue tracking gets noisy (one repo, many variants). |

Closest fit to current code structure (the spike already has `bootstrap.sh` and `starters/`).

---

### Option 3: Cherry-pick automation (incremental)

Keep separate fork repos, but build a script that **automates** the `UPSTREAM.md` workflow. The script reads each upstream commit, classifies it (framework / platform-specific / ambiguous), auto-cherry-picks the safe ones, and opens a PR per fork.

| Pro | Con |
|-----|-----|
| No restructuring. Builds on what the spike already designed. | Classification is a heuristic — false negatives mean missed fixes, false positives mean broken cherry-picks. |
| Can ship in a day. | Doesn't scale past 3-4 forks. Compounding divergence eventually wins. |
| Fork repos retain real git history. | Every upstream PR triggers N maintenance PRs. |

Reasonable bridge if structural change isn't yet justified.

---

### Option 4: Plugin architecture inside one repo

Single template repo where the bootstrap wizard asks "which platform?" and writes the answer to `.claude/PROJECT.md`. Workflows, agents, and docs are conditionally activated based on that choice. **This is what the upstream `agile-flow` README already implies it does** — but the spike found that some changes (Dockerfile, `package.json` vs `pyproject.toml`, agent prompts) don't conditionalize cleanly.

| Pro | Con |
|-----|-----|
| Zero fork management. One repo to maintain. | Requires significant refactor of agent prompts to be stack/platform-aware. The spike's `UPSTREAM.md` lists ~15 files that diverge — most can't be cleanly conditionalized. |
| Best UX for participants (one repo to clone). | Bloats the template (every user gets every platform's docs/workflows). |

---

## Recommendation

**Option 2 (monorepo + starters) for the medium term, Option 3 for the next workshop.**

Reasoning:

- The spike already has a `starters/` directory and `bootstrap.sh` (~40KB). The architecture intent is already there — formalize it.
- Option 1 (overlay) is cleaner long-term but is a bigger lift, and current runway doesn't justify it.
- Option 4 is what the upstream template *claims* to be, but the spike provides evidence it doesn't work for the cases that diverge most (agent prompts, Dockerfile, dependency manifests).
- Option 3 (cherry-pick automation) is the bridge — the GCP fork already exists and needs *some* sync story to keep it from rotting before the workshop ships.

### Suggested path

1. **Now (workshop-driven):** ship the GCP fork as-is with a cherry-pick script (Option 3) for upstream sync.
2. **After the workshop:** evaluate consolidating into Option 2. The AWS fork is the second data point — building it inside `starters/aws-{equivalent}/` from day 1 tests whether the monorepo approach holds up under a second variant.
3. **Do not pursue Option 4.** The spike already has data showing it's the wrong fit.

This shapes near-term tickets toward **hardening the existing fork + workshop ops**, NOT a structural redesign. The redesign decision gets revisited *after* the workshop with real signal from running it.

---

## Open Questions

- Does the participant lose enough by getting a "generated" repo (Options 1, 2) vs a "forkable" repo (Options 3, 4) to matter? Workshop participants likely don't care; long-term self-serve users might.
- How are framework-level breaking changes versioned across variants? `.gembaflow-version` exists but its semantics across overlays/starters need definition.
- Where do **shared tests** live? Agent restriction tests are framework-level; smoke tests are stack-specific. The boundary needs to be drawn explicitly under any option.
- How are **agent prompts** authored when they have stack-specific guardrails? The spike rewrote `github-ticket-worker.md` for FastAPI/SQLModel — under Option 2, do all variants get a copy, or does the framework version reference a per-variant fragment?

---

## Related Artifacts

- Spike: `~/projects/vibeacademy/agile-flow-gcp-staging`
- Current sync procedure: `~/projects/vibeacademy/agile-flow-gcp-staging/UPSTREAM.md`
- Distribution boundary classification: `docs/DISTRIBUTION.md`
- Existing bootstrap: `bootstrap.sh`, `starters/`
