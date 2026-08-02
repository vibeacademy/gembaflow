# DRAFT — `bd ready` silently caps results at 100

> **Status: DRAFT — NOT FILED.** Filing this on the upstream beads tracker
> (gastownhall/beads) is an **operator decision**; no agent files it
> autonomously. Home artifact: vibeacademy/gembaflow#594 (gotcha 10,
> `docs/BEADS.md`).

## Title

`bd ready` (and `bd list`) default limit truncates `--json` output at 100
rows with only a stderr advisory

## Environment

- bd version: **1.1.0** (`bd version --json`)
- Tracker with more than 100 open, unblocked beads (observed live with 113)

## Minimal repro

```bash
# 1. Populate a tracker with >100 open, unblocked beads:
for i in $(seq 1 113); do bd create "bead $i" --type=task; done

# 2. Enumerate the ready queue:
bd ready --json 2>/dev/null | jq length
```

## Expected

Either all 113 ready beads, or a truncation signal *inside* the JSON
contract (e.g. a wrapper object with `truncated: true`), so machine
consumers can detect the cap.

## Actual

`jq length` reports `100`. The only truncation signal is a human-readable
advisory on **stderr** — which JSON consumers must redirect away precisely
because mixing it into the stream corrupts the JSON. With stderr
separated, truncation is completely invisible to a machine consumer.

## Impact

- Any automation that snapshots the ready queue (`bd ready --json | jq`)
  silently operates on a truncated view once the queue passes 100. In our
  acceptance run, 13 of 113 ready beads were invisible to every bare
  `bd ready --json` pipeline — no error, no in-band signal.
- Because 100 is a plausible queue size, the truncation is easy to mistake
  for real data.

## Workaround

Always pass an explicit unlimited limit when enumerating:

```bash
bd ready --json --limit 0
bd list --json -n 0
```

Suggested fix: when `--json` is requested, either default to unlimited or
carry the truncation flag in the JSON payload itself (stderr advisories
are not part of the machine contract).
