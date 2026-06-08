# Assistant Modes

A mode is a small set of demonstrations of how Claude should sound in the main session. The framework ships five modes; forks can add more.

## What a mode is

A mode is a single Markdown fragment under `.claude/modes/<name>.md`. The fragment is *injected at session start* by the `SessionStart` hook configured in `.claude/settings.json`, which calls `scripts/resolve-mode.sh` to do the precedence walk and emit the resolved fragment on stdout. Claude reads it as additional context alongside `CLAUDE.md`.

Modes shape the main agent's voice only. Sub-agents (`pr-reviewer`, `github-ticket-worker`, etc.) keep their own calibrated personas regardless of which mode is active.

## How calibration works in this variant

This variant calibrates by **demonstration**, not by rules. Each mode fragment has:

1. A positioning header comment (one line, machine-readable hint).
2. A `# <name>` heading and a one-line positioning paragraph.
3. A `## Headline behavior` one-liner.
4. A `## Examples` section with 2–3 short transcripts of the form:

   ```
   > Operator: <prompt>

   <assistant response in this mode's voice>
   ```

5. A `## Notes` paragraph — a curator's note pointing at what to notice in the examples. *Not* a rule list.

The LLM infers the calibration from the examples plus the curator's note. There are no second-person imperatives ("you must…") and no third-person persona assertions ("the assistant is…") in the mode bodies. Show, don't tell.

## Shipped modes

| Mode | Positioning |
|------|-------------|
| `default` | Baseline — no calibration applied. |
| `scaffolded` | Restate, narrate, show the work. For operators who want to see the workflow, not just the output. |
| `socratic` | Ask first, answer second. For operators who learn by being asked. |
| `terse-expert` | Code first, words second. Shortest answer that fully resolves the question. |
| `shipping-coach` | Name the cut line. Defer the rest. For operators who tend to over-scope. |

## Resolution precedence

The hook script `scripts/resolve-mode.sh` walks the chain in this order and emits the first resolved mode it finds:

1. `.claude/settings.json` `assistantMode` field (team-shared, committed).
2. `.claude/mode.local` (individual operator, gitignored).
3. Falls back to `default`.

Run `/mode` with no argument to see which layer resolved.

## Activation

- `/mode list` — print available modes.
- `/mode <name>` — set the active mode (writes `.claude/mode.local`).
- `/mode` — report the currently resolved mode and its source.
- `bash bootstrap.sh` — first-run mode prompt; idempotent on re-run.

## Adding a fork-local mode

A mode is a small set of demonstrations of how Claude should sound in this mode. Add a file `.claude/modes/<your-name>.md` with 2–3 example interactions. The hook will pick it up; no other registration is needed.

The recommended structure is the same one the shipped modes use (see above). Keep the file under 80 lines — if a mode needs more than that, it is doing too much. Avoid imperative voice; let the demonstrations carry the calibration.

`scripts/template-sync.sh` only overwrites mode files that exist upstream, so fork-local modes survive every `/upgrade`.

## What modes do NOT change

- Framework safety protocols (no PRs to `main`, no `--no-verify`, etc.).
- Sub-agent personas — `/work-ticket`, `/review-pr`, etc. keep their own calibration.
- GitHub auth protocol, branch-naming conventions, commit format.

Modes shape tone and presentation, not protocol.
