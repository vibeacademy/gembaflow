# Codespaces secrets — multi-bot opt-in

Default Codespaces experience runs in **solo mode** — one personal GitHub
account plays all roles, no secrets needed. This doc is for operators
who want to opt in to **multi-bot mode**, where a dedicated worker bot
opens PRs and a dedicated reviewer bot posts review verdicts.

Multi-bot mode preserves the same adversarial-review property the
framework's default `va-worker` / `va-reviewer` pattern provides, but
runs entirely inside a Codespace instead of requiring local-machine
account switching.

---

## When to use multi-bot mode

| Scenario | Mode |
|---|---|
| First-time fork, workshop, getting started | **Solo** (default — skip this doc) |
| Forks with >1 active contributor | **Solo** is still fine — each contributor uses their own Codespace |
| Forks that need adversarial worker↔reviewer separation in CI runs | **Multi-bot** (read on) |
| Forks running `/drain` autonomously where author≠reviewer attribution matters | **Multi-bot** (read on) |

Multi-bot is opt-in for a reason: it costs ~5 minutes of one-time
setup (two PATs + two secret entries) and adds a small ongoing
rotation discipline. Solo mode skips both. Don't pick multi-bot to
"feel more professional" — pick it when the adversarial-review
attribution is load-bearing for what you're doing.

---

## Setup — the 4 steps

### 1. Create two fine-grained PATs

For each of `{org}-worker` and `{org}-reviewer` GitHub accounts you
control, go to `https://github.com/settings/personal-access-tokens/new`
and create a fine-grained PAT with these scopes:

| Permission | Access | Why |
|---|---|---|
| Contents | Read and Write | Branch + push commits |
| Issues | Read and Write | Comment on tickets, file `/report-issue` |
| Pull requests | Read and Write | Open PRs, post review verdicts |
| Metadata | Read | Required baseline for fine-grained PATs |
| Administration | Read and Write | `/bootstrap` Phase 4 ruleset POST (worker token only — reviewer doesn't need it) |
| Workflows | Read and Write | Edit workflow files when needed |

**Resource access:** scope to the **single fork repo** you'll be
working in, not "All repositories" — narrower blast radius if the
token leaks.

**Expiration:** 90 days is a reasonable default. Calendar a rotation
reminder; see the **Blast radius and rotation** section below for the
revoke-recreate procedure.

**Do NOT grant:**

- `delete_repo` — never needed for normal work; massively expands blast
  radius
- `admin:org` — only needed for org-scoped secrets (see "Where to set"
  below); skip for repo-scoped secrets

### 2. Where to set the secrets — pick one of three scopes

| Scope | Path | Use when |
|---|---|---|
| **User-scope** | `https://github.com/settings/codespaces` → New secret | One operator, multiple forks of the same framework |
| **Repo-scope** | `https://github.com/<org>/<repo>/settings/secrets/codespaces` → New secret | One fork, possibly multiple operators |
| **Org-scope** | `https://github.com/organizations/<org>/settings/codespaces` → New secret | Multiple forks under one org; centralizes rotation |

Both secrets are named the same regardless of scope:

- `GEMBAFLOW_WORKER_TOKEN`
- `GEMBAFLOW_REVIEWER_TOKEN`

### 3. Flip `.gembaflow-config.json` to multi-bot

In your fork's repo root:

```json
{
  "org": "<your-org>",
  "repo": "<your-repo>",
  "solo_mode": false
}
```

(For solo mode, `solo_mode` stays `true` — which is the default
`scripts/codespace-postcreate.sh` writes on first boot.)

### 4. Wait 1-2 minutes, then create or restart the Codespace

**Propagation lag:** GitHub takes 1-2 minutes to make new Codespaces
secrets available to running Codespaces. If you set the secrets and
immediately create a Codespace, the secrets may not be injected. Two
ways to handle it:

- **New Codespace:** wait ~2 minutes between setting the secrets and
  clicking "Create Codespace."
- **Existing Codespace:** restart via the Codespaces menu (Cmd/Ctrl-Shift-P
  → "Codespaces: Restart Container") — the restart re-pulls the secrets.

Then run `/bootstrap` in Claude Code. The preflight detects multi-bot
mode + both secrets present and proceeds.

---

## Verifying multi-bot is wired up

After the Codespace restart, in a terminal:

```bash
[ -n "$GEMBAFLOW_WORKER_TOKEN" ] && echo "worker token: present" || echo "worker token: MISSING"
[ -n "$GEMBAFLOW_REVIEWER_TOKEN" ] && echo "reviewer token: present" || echo "reviewer token: MISSING"
```

If either prints MISSING, re-check secret scope, the secret name
spelling, and the propagation-lag window above.

---

## Blast radius and rotation

A leaked PAT is the operator's primary risk surface. Knowing where the
token can appear matters more than the convenience cost of rotating it.

### Where the token can leak

- **`gh auth status` output** — printed plainly in the terminal by
  default. The `/bootstrap` orchestrator's preflight already pipes
  `gh auth status` through a redactor (`sed` masks `gh[oprsu]_*` token
  prefixes), but ad-hoc `gh auth status` invocations from the terminal
  do not. If you screen-share a workshop demo, run the redacted form
  manually: `gh auth status 2>&1 | sed -E 's/gh[oprsu]_[A-Za-z0-9_]+/[redacted token]/g'`.
- **Codespaces creation log** — the postCreate command line is visible
  in the Codespaces UI's setup log. The `scripts/codespace-postcreate.sh`
  script never echoes secret values, but a workshop facilitator who
  shares the log file with attendees should redact it first.
- **Browser dev tools network tab** — any `gh api` call from a script
  that you have open in dev tools shows the bearer token in request
  headers. Close dev tools before screen-sharing.
- **Shell history** — never paste a token into a `gh auth login --with-token`
  prompt that gets logged to `~/.bash_history` / `~/.zsh_history`.
  Use the Codespaces secret form exclusively; never paste tokens in
  the terminal.
- **`git log`** — if a token accidentally ends up committed (e.g. in a
  test script), it's in `git log` forever even after revocation. Use
  `git rev-list --all | xargs git grep "gh[oprsu]_"` to scan before
  publishing the repo.

### How to rotate

When you need to rotate (scheduled, suspected leak, account compromise):

1. **Revoke the old token first:** go to `https://github.com/settings/tokens`
   → find the PAT → click Delete. This immediately invalidates the
   token — any in-flight request using it will 401.
2. **Delete the Codespace** that was using the old token. The
   container's process env carries the old value; the only way to
   guarantee it's gone is to recreate.
3. **Create a new PAT** with the same scopes (see Step 1 above).
4. **Update the Codespaces secret** with the new value (same name,
   `GEMBAFLOW_WORKER_TOKEN` or `GEMBAFLOW_REVIEWER_TOKEN`).
5. **Wait 1-2 minutes** for propagation, then create a fresh Codespace.

Rotation cadence: every 90 days at minimum; immediately if there's any
signal the token may have been seen by someone other than you.

### Explicit "don'ts"

- **Do not paste this token anywhere except the Codespaces secret form.**
  Not in a terminal, not in a script, not in a CI config file, not in
  Slack, not in a bug report.
- Do not commit a script that hardcodes the token, even temporarily
  "while testing." Use env-var indirection from day one.
- Do not grant `delete_repo` or `admin:org` to either bot's PAT unless
  you specifically need them and have documented why.

---

## Failure modes — what `/bootstrap` does when something's wrong

| Situation | `/bootstrap` behavior |
|---|---|
| `solo_mode: true`, no secrets set | Proceed with solo mode (the documented default). |
| `solo_mode: true`, secrets set anyway | Proceed with solo mode (ignore the secrets — they're not used in solo flows). |
| `solo_mode: false`, both secrets present | Proceed with multi-bot mode. |
| `solo_mode: false`, either secret missing | **STOP with actionable error** pointing at `https://github.com/settings/codespaces`, naming both secret variables, linking back to this doc, and including the propagation-lag hint. Does NOT silently downgrade to solo mode (because the operator explicitly set `solo_mode: false`). |
| `solo_mode` field absent from `.gembaflow-config.json` | Treat as `solo_mode: true` (defensive default — matches what `codespace-postcreate.sh` writes on first boot). |

The "STOP with actionable error" path is the correct behavior even
though it's a wall — silently downgrading to solo when the operator
asked for multi-bot would produce wrong-author attribution on every
PR and review for the rest of the session. Better to halt and ask.

---

## Related

- [`scripts/codespace-postcreate.sh`](../scripts/codespace-postcreate.sh)
  — writes `.gembaflow-config.json` `solo_mode: true` on first boot
- [`.claude/commands/bootstrap.md`](../.claude/commands/bootstrap.md)
  — preflight reads `solo_mode`; multi-bot branch implements the
  failure-mode table above
- [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json)
  — deliberately declares NO Codespaces permissions block (SEC-02): the
  installation token keeps GitHub's default, fork-scoped access. PAT
  secrets (this doc) are the only way to widen what agents can do — an
  explicit, revocable grant rather than an ambient one
- [`scripts/lib/env-compat.sh`](../scripts/lib/env-compat.sh) — the
  `GEMBAFLOW_*` env-var convention these secret names match
