---
description: "Set or inspect the active assistant mode for the main session"
---

# /mode — Assistant Mode

Switch the main Claude session's interaction style. Modes shape tone and
presentation only — sub-agents (`pr-reviewer`, `github-ticket-worker`, etc.)
keep their own personas regardless of the active mode.

The slash command is intentionally thin. The heavy lifting — the precedence
walk through `.claude/settings.json` → `.claude/mode.local` → `default` — lives
in `scripts/resolve-mode.sh`. The same resolver is invoked by the
`SessionStart` hook in `.claude/settings.json`, so the slash command and the
hook can never disagree about which mode is active.

## Argument forms

- `/mode list` — list every available mode in `.claude/modes/` with one-line
  positioning each.
- `/mode <name>` — write `<name>` to `.claude/mode.local` so it becomes the
  active mode on the next session start (or until overridden by the
  `assistantMode` field in `.claude/settings.json`).
- `/mode` (no argument) — print the currently-resolved mode and the precedence
  layer that resolved it.

## Instructions

Parse the argument the operator passed.

### `/mode list`

Shell out:

```bash
bash scripts/resolve-mode.sh --list
```

The output is tab-separated `<name>\t<positioning>` per line. Render it as a
Markdown table or a clean two-column list. End with a Result Block.

### `/mode <name>`

1. Validate `<name>` against the list:

   ```bash
   bash scripts/resolve-mode.sh --list | cut -f1
   ```

   If `<name>` is not in the list, print an error naming the valid options
   and stop. Do not write `.claude/mode.local`.

2. Write the name:

   ```bash
   mkdir -p .claude
   printf '%s\n' "<name>" > .claude/mode.local
   ```

3. Confirm with a single line: `Mode set: <name>. Active on next session.`

Do not layer explanations into the confirmation. The mode fragments themselves
carry the calibration; the slash command just flips the switch.

### `/mode` (no argument)

Shell out to the resolver for both the name and the source:

```bash
bash scripts/resolve-mode.sh --print-name
bash scripts/resolve-mode.sh --print-source
```

Print one line: `Active mode: <name> (resolved via <source>).`

The `<source>` value will be one of `settings.json`, `mode.local`, or
`default fallback`.

## Important

- The slash command MUST shell out to `scripts/resolve-mode.sh` for resolution
  — do not re-implement the precedence walk inline. The whole point of variant
  c is that the slash command and the `SessionStart` hook share one resolver.
- The mode applies on the **next** session start (the hook only fires at
  session start). The current session's voice does not change mid-conversation;
  this is intentional. To see the new mode immediately, exit and re-open the
  Claude Code session.
- `/mode default` is a real selection — it explicitly opts back into baseline
  behavior. Removing `.claude/mode.local` achieves the same thing.

## Output Format

End every invocation with a Result Block:

```
---

**Result:** <one-line outcome>
Mode: <name>
Source: <settings.json | mode.local | default fallback>
```
