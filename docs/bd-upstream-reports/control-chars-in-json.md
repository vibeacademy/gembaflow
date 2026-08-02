# DRAFT — raw control characters in `--json` output

> **Status: DRAFT — NOT FILED.** Filing this on the upstream beads tracker
> (gastownhall/beads) is an **operator decision**; no agent files it
> autonomously. Home artifact: vibeacademy/gembaflow#594 (gotcha 9,
> `docs/BEADS.md`).
>
> **Duplicate check (PR #595 review):** gastownhall/beads#599 ("Beads CLI
> outputs invalid JSON with unescaped control characters", closed/triaged
> 2025-12) appears to cover this bug — recommend a "still reproduces in
> 1.1.0" comment on that issue instead of a new filing; operator decides.

## Title

`--json` output can contain raw (unescaped) control characters, producing
invalid JSON

## Environment

- bd version: **1.1.0** (`bd version --json`)
- Observed on macOS (darwin, arm64); issue bodies imported from GitHub via
  `bd create --external-ref`

## Minimal repro

```bash
# 1. Create an issue whose description contains a literal tab character
#    (0x09) — e.g. pasted from a GitHub issue body or a heredoc:
printf 'line with a literal\ttab' | pbcopy   # or any source of a raw tab
bd create "repro control chars" -d "$(printf 'line with a literal\ttab')"

# 2. Read it back as JSON and parse:
bd show <id> --json | jq .
```

## Expected

Per RFC 8259 §7, control characters U+0000–U+001F inside JSON strings must
be escaped (`\t`, `\u0009`, ...). `bd ... --json` output should always be
parseable by a conforming parser.

## Actual

The control character is emitted raw inside the JSON string. Conforming
parsers reject the document:

```text
jq: error (at <stdin>:0): Invalid string: control characters
from U+0000 through U+001F must be escaped
```

`JSON.parse` in Node.js fails the same way.

## Impact

- Any pipeline consuming `bd ... --json` hard-fails intermittently — the
  failure depends on issue *content*, so it appears nondeterministic and
  passes in clean test databases.
- The worst failure mode is silent: a pipeline ending in an absence check
  (`... | jq 'length == 0'` shapes) treats the failed parse as "no
  results", so gates that should fail loudly instead pass. This broke a
  live migration-verification gate for us (a tab carried over from a
  GitHub issue body).

## Workaround

Sanitize before parsing (control chars other than `\n`/`\r` become
spaces — safe both inside strings and between tokens):

```bash
bd show <id> --json > out.json 2>err.log
perl -pe 's/[\x00-\x09\x0b\x0c\x0e-\x1f]/ /g' out.json | jq .
```

Suggested fix: escape control characters in the JSON encoder (or reject
them at write time).
