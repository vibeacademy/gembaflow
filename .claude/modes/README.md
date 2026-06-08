# Assistant modes

This directory holds prompt fragments that bias the **main Claude Code session**
(the default chat before any slash command) toward a chosen interaction style.

Modes shape tone, verbosity, and explanation depth only. They do not override
safety protocols, GitHub auth rules, or any framework invariant. Sub-agents
(`pr-reviewer`, `github-ticket-worker`, etc.) ignore modes — they keep their
calibrated personas.

## Shipped modes

| Mode | One-line positioning |
|------|----------------------|
| `default` | Baseline gembaflow behavior; no fragment applied. |
| `scaffolded` | Surface the workflow; verbose, step-by-step, checkpoint-first. |
| `socratic` | Teach by asking; refuse to spoil the answer the operator can find. |
| `terse-expert` | Assume expert reader; cut everything that is not signal. |
| `shipping-coach` | Enforce smallest-shippable cut; defer everything that does not ship today. |

## How to add a fork-local mode

Fork-local modes survive `/upgrade`: `scripts/template-sync.sh` only syncs files
that exist in the upstream `.claude/modes/` directory. Any file you add here
that upstream does not name is untouched on every sync.

Three steps:

1. Create the file. Pick a short, lowercase name. Example: `.claude/modes/gentle-ofelia.md`.
2. Follow the imperative-instructions template below.
3. Activate it. Run `/mode gentle-ofelia` from inside Claude Code. The slash command writes the name to `.claude/mode.local`.

### Template

Copy this skeleton into your new mode file and replace the placeholders:

```markdown
<!-- positioning: <one-sentence headline of the angle this mode takes>. -->

## Headline behavior

<One sentence summarizing what changes about Claude's responses in this mode.>

## Instructions

- <Second-person imperative #1.>
- <Second-person imperative #2.>
- <Add as many as you need; keep the whole file under 80 lines.>
```

Conventions:

- Second-person imperatives only ("You walk through each step", "Skip preambles"). No third-person framing ("The assistant is...").
- No canonical example interactions inside the file. The fragment is read as instructions, not as training data.
- Keep the file under 80 lines. If a mode needs more, it is doing too much.
- Do not modify safety, GitHub auth, or framework workflow rules from inside a mode. Modes bias style, not behavior.

## Resolution order

When the main session starts, `CLAUDE.md` resolves the active mode in this
order:

1. `.claude/settings.json` `"assistantMode"` — team-shared, committed to the repo.
2. `.claude/mode.local` — operator-local, gitignored, one mode name per line.
3. `default` — applied when neither of the above is set.

The resolved fragment is read from `.claude/modes/<resolved>.md` and its
`## Instructions` block is treated as if prepended to `CLAUDE.md` for that
session.
