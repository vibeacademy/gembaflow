---
description: View, list, or set the assistant mode for the main Claude session
---

<!-- FRAMEWORK:START -->

# /mode — Select the main-session assistant mode

Modes are prompt fragments that bias the main Claude Code session toward a
chosen interaction style (verbose vs. terse, Socratic vs. directive, etc.).
Mode files live in `.claude/modes/`. See `.claude/modes/README.md` for the
shipped catalog and the resolution order.

This command is the **primary surface** for switching modes. It writes the
selected mode to `.claude/mode.local` (a gitignored, one-line file). Teams
that want a shared mode set it via `.claude/settings.json`'s `"assistantMode"`
field instead — that takes precedence over `mode.local`.

## Subcommands

| Invocation | Behavior |
|------------|----------|
| `/mode` | Print the currently resolved mode and the source it came from. |
| `/mode list` | Print all available modes in `.claude/modes/` with one-line positioning each. |
| `/mode <name>` | Write `<name>` to `.claude/mode.local`. Confirm in one line. |
| `/mode <unknown>` | Error with the list of valid mode names. |

## Behavior — `/mode` (no argument)

Resolve the active mode by checking, in order:

1. `.claude/settings.json` `"assistantMode"` field — if present and non-empty.
2. `.claude/mode.local` — first non-empty line, trimmed.
3. Fallback to `default`.

Print exactly one line:

```
Mode: <resolved> (source: <settings.json|.claude/mode.local|default fallback>)
```

## Behavior — `/mode list`

Enumerate `.claude/modes/*.md` (excluding `README.md`). For each file, read
the first HTML comment that starts with `positioning:` and print one row:

```
<name>          <positioning headline>
```

Sort alphabetically. Include both framework-shipped modes and any fork-local
modes — they live in the same flat directory.

## Behavior — `/mode <name>`

1. Validate `<name>` corresponds to an existing `.claude/modes/<name>.md` file.
   If not, fall through to the unknown-mode error path below.
2. Write a single line to `.claude/mode.local`:

   ```
   <name>
   ```

   followed by a trailing newline. Overwrite any prior content.
3. Print one line:

   ```
   Mode set to <name>. Restart the session or send a new message to apply.
   ```

Do not move the file, do not log to history, do not touch `.claude/settings.json`.

## Behavior — `/mode <unknown>`

Print exactly:

```
Unknown mode '<x>'. Valid: default, scaffolded, socratic, terse-expert, shipping-coach
```

If fork-local modes exist (any `.claude/modes/*.md` not in the canonical five),
append their names to the list, sorted alphabetically.

## Constraints

- Do not edit `.claude/settings.json`. That is the team-shared surface; this
  command only writes the local override.
- Do not validate or alter the mode file itself. If a file exists in
  `.claude/modes/`, it is a valid mode name as far as this command is concerned.
- Do not move the ticket board, post comments, or take any side effect other
  than writing `.claude/mode.local` and printing the confirmation line.

<!-- FRAMEWORK:END -->
