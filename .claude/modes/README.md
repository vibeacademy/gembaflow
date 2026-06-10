# `.claude/modes/` — Assistant Mode Registry

This directory is a **registry of selectable interaction styles** for the main Claude Code session (the default chat, before any slash command). A mode is a small prompt fragment that biases the assistant's tone, verbosity, and explanation depth. Modes do **not** override framework safety protocols, GitHub auth rules, or workflow guardrails — those still apply in every mode.

Modes shape only the main session. Sub-agents (`pr-reviewer`, `github-ticket-worker`, etc.) keep their own calibrated personas; mode selection does not bleed into sub-agent invocations.

## Shipped modes

| Mode | Shipped by | Calibration source | Positioning |
|------|------------|-------------------|-------------|
| `default` | framework | — | Framework baseline; no persona overlay. |
| `scaffolded` | framework | Organic fork-operator pattern (a non-technical operator who rewrote her own `CLAUDE.md` to bias toward verbose explanations) | A patient guide who narrates her plan and shows her work. |
| `socratic` | framework | Informed by Thariq Shihipar's learn-quiz gist (https://gist.github.com/ThariqS/1389dcdff9eba4789887a2211370f06b) | A Socratic tutor with an internal mastery model of the operator. |
| `terse-expert` | framework | — | A senior collaborator who skips preambles and leads with the answer. |
| `shipping-coach` | framework | — | A delivery-focused partner who measures every decision against "does this help ship today?". |

Fork-local modes are added to this table by the fork maintainer when they ship a new file in this directory.

## Resolving the active mode

The active mode is resolved at session start by `CLAUDE.md`, in this precedence order:

1. `.claude/settings.json` `"assistantMode"` — **canonical, version-controlled, team-shared**. The recommended way to set a team-wide mode.
2. `.claude/mode.local` — **gitignored personal override**. The single-line contents of this file override `settings.json` on the local machine only.
3. `default` — used when neither of the above is set.

Once resolved, the assistant reads `.claude/modes/<resolved-name>.md` and treats its `## Persona` and `## Heuristics` sections as additional context about how it should present itself in the current session.

## Selecting a mode

| Surface | Use when |
|---------|----------|
| Edit `.claude/settings.json` and add `"assistantMode": "<name>"` | You want the whole team to share the mode (committed, reviewable). |
| `/mode <name>` | You want a personal override on your machine (writes to `.claude/mode.local`, gitignored). |
| `/mode list` | You want to see all available modes. |
| `/mode` (no arg) | You want to see the resolved mode and each layer of the precedence chain. |
| `bootstrap.sh` | First-time setup: bootstrap asks whether to set the team mode or the personal override. |

## Adding a fork-local mode

Forks can add their own modes by dropping a file in this directory. `template-sync.sh` only syncs files that exist upstream, so fork-local additions survive every `/upgrade`.

### Authoring guidance

A mode file is a **persona assertion**, not a set of instructions. Describe *who the assistant is* in this mode, in the third person, in 3–5 sentences. Follow with 4–6 behavioral heuristics — short bullets a reader can use as a checklist for whether the persona is being honored.

### Authoring template

```markdown
<!-- Mode: <your-mode-name> -->
<!-- Positioning: <one-line description> -->

# Mode — <your-mode-name>

## Headline behavior

<One sentence describing what the operator will notice.>

## Persona

<Three to five sentences in the third person, describing who the assistant is in this mode.
Avoid second-person imperatives ("you should..."). Avoid canonical example exchanges.>

## Heuristics

- <4–6 short behavioral bullets a reader can use to spot whether the persona is being honored.>
```

Keep mode files under 80 lines. If a mode needs more than that, it is doing too much — it is probably trying to be a sub-agent.

## Non-goals

Modes are **additive prompt fragments**, not replacement personas. They do not:

- Override framework safety protocols, GitHub auth rules, or trunk-based workflow guardrails.
- Change sub-agent behavior. Sub-agents have their own calibrated personas.
- Support per-message switching, auto-detection of skill level, or mode blending in v1.
