# Quickstart: Launch Your Project in 15 Minutes

This guide takes you from zero to a running Gemba Flow project using GitHub
Codespaces. You do not need to install anything on your computer — every step
happens in your browser.

**What you will have at the end:**

- A private GitHub repository seeded from the Gemba Flow template.
- A cloud development environment with Claude Code pre-configured.
- A populated product requirements document, roadmap, technical architecture,
  and specialized AI agents.
- A Ready queue you can browse on the kanban board
  (`.gembaflow-boards/kanban.html`) in your repo.

**Estimated time:** 15 minutes (plus ~3 minutes waiting for the Codespace to
build).

**Works on:** Windows, macOS, iPad, or any device with a modern browser.

> **If you prefer a terminal setup,** see
> [docs/GETTING-STARTED.md](GETTING-STARTED.md) for the local-install path.

---

## Step 0 (Optional): Configure Multi-Bot Secrets

*Skip this step if you are working solo.* Gemba Flow can run two AI agents in
parallel — one for feature work and one for review — using separate GitHub
tokens. To enable that, set up two secrets before you create your repo.

1. Go to <https://github.com/settings/codespaces>.
2. Add two **Codespaces user secrets**:
   - `GEMBAFLOW_WORKER_TOKEN` — a personal access token with `repo`,
     `workflow`, `gist`, and `read:org` scopes.
   - `GEMBAFLOW_REVIEWER_TOKEN` — a second token with the same scopes,
     belonging to a different GitHub account.
3. For the full scope breakdown and token-creation walkthrough, see
   [docs/codespaces-secrets.md](codespaces-secrets.md).

You can always add these secrets later. Solo mode works without them.

---

## Step 1: Use This Template

1. Go to [vibeacademy/gembaflow](https://github.com/vibeacademy/gembaflow) on
   GitHub.
2. Click the green **"Use this template"** button, then choose
   **"Create a new repository"**.

<!-- SCREENSHOT: The "Use this template" button on the vibeacademy/gembaflow repo landing page. The green button is in the upper-right area, next to "Star". -->

<!-- markdownlint-disable-next-line MD029 -->
3. Fill in the repository details:
   - **Owner**: Choose your personal GitHub account (recommended for your first
     project — see the instructor note below for the org alternative).
   - **Repository name**: Pick a short name for your project, such as
     `my-startup` or `project-alpha`.
   - **Visibility**: Public or Private — your choice. Private keeps your
     early-stage product docs away from competitors.

<!-- markdownlint-disable-next-line MD029 -->
4. Click **"Create repository"**. GitHub will generate a fresh repo; this
   takes about 10 seconds.

<!-- SCREENSHOT: The "Create a new repository from template" form with the Owner, Repository name, and Visibility fields highlighted. -->

> **Why "Use this template" and not Fork?** A template repo creates a clean
> history with no upstream link. That means your issues, boards, and commits
> belong entirely to your project from day one.

### For workshop instructors: the org-account pattern

The recommended happy path above uses a personal account. As an alternative,
you can template into an organization so all attendees see the repo in one
place:

- Create the repo under an org account you control.
- Add each attendee as an **Admin** on the repo before the workshop (Settings
  → Collaborators and teams → Add people).
- Trade-off: this requires org-admin overhead before the session starts. For
  workshops with more than 10 participants, the org pattern reduces
  "I can not find the repo" support load significantly.

---

## Step 2: Open a Codespace

1. In your newly created repository, click the green **"Code"** button.
2. Select the **"Codespaces"** tab.
3. Click **"Create codespace on main"**.

<!-- SCREENSHOT: The Code dropdown open on the Codespaces tab, showing the "Create codespace on main" button. -->

**What happens next:**

- GitHub provisions a cloud machine and installs the development environment.
  This takes roughly 3 minutes on a cold build.
- You will see a VS Code-like editor open in your browser. A progress bar
  labeled "Setting up your codespace" is visible in the terminal panel while
  the build runs.

<!-- SCREENSHOT: The Codespace loading screen showing the VS Code interface with the "Setting up your codespace" progress notification. -->

**No extra permissions prompt:** the Codespace uses GitHub's default access —
scoped to your repository only. You will not see a special approval dialog,
and nothing the Codespace runs can touch your other repositories. (One
consequence: the optional branch-protection step during `/bootstrap` will
offer you a short set of manual instructions instead of running
automatically — that is expected, and the message explains the upgrade path
if you want it automated.)

**When the build finishes,** a file called `WELCOME.md` opens automatically.
It confirms the environment is ready and tells you the single next step: open
the Claude Code sidebar and type `/bootstrap`.

> Claude Code's permissions and hooks are already configured — no manual
> settings step is needed. The `WELCOME.md` file summarizes everything the
> setup script did.
>
> **Troubleshooting:** If the Codespace fails to build, click
> **"Retry postCreate command"** in the notification that appears. If it fails
> a second time, open the terminal (`` Ctrl+` ``) and run
> `bash scripts/codespace-postcreate.sh` manually, then check the output for
> error messages. As a last resort, use the terminal path in
> [docs/GETTING-STARTED.md](GETTING-STARTED.md).

---

## Step 3: Type `/bootstrap` in the Claude Code Sidebar

1. Look for the Claude Code icon in the left sidebar of the VS Code editor.
   It looks like a small stylized "C" or the Anthropic logo.
2. Click it to open the Claude Code chat panel.
3. Type `/bootstrap` and press Enter.

<!-- SCREENSHOT: The Claude Code sidebar open in the VS Code editor, with the chat input field visible at the bottom and the /bootstrap command typed in. -->

**What Claude Code will do:**

Claude Code walks through five phases automatically:

| Phase | What happens |
|-------|-------------|
| 0 — Env check | Verifies your GitHub authentication and Gemba Flow version. |
| 1 — Product | Asks you questions about your project and writes your PRD. |
| 2 — Architecture | Drafts a technical architecture document. |
| 3 — Agents | Specializes your AI agents for your project context. |
| 4 — Workflow | Initializes the beads tracker and seeds your Ready queue. |

Claude Code asks a series of questions — answer them in plain English. There
are no right or wrong answers; the outputs are working drafts you will refine
over time.

**Expected output at the end of `/bootstrap`:**

You will see a closing summary in the chat panel that looks like this:

```
✓ Bootstrap complete.

  Mode: solo
  Tracker: beads (bd), prefix my-app
  Ready (top 3 from bd ready):
    1. <bead-id> — <title>
    2. <bead-id> — <title>
    3. <bead-id> — <title>

  Next step: type /work-ticket to pick up the top ready bead.
```

Your repo now contains a populated PRD, roadmap, technical architecture,
specialized agents, and a Ready queue.

> **Troubleshooting:** If the Claude Code icon is missing from the sidebar,
> reload the browser tab (Ctrl+Shift+R or Cmd+Shift+R). If it is still absent
> after a reload, open the Extensions panel (the square icon in the left bar),
> search for "Claude Code", and click **Install**. This is rare; extension
> auto-install handles it on most builds.

---

## What's Next

Once `/bootstrap` completes, here are the most common next steps:

- **Pick up your first task:** Type `/work-ticket` in the Claude Code sidebar.
  Claude will claim the top-priority item from your Ready queue and start
  working on it.
- **Check your project status:** Type `/sprint-status` for a summary of what
  is in progress, what is ready, and what is blocked.
- **Browse the kanban board:** Open `.gembaflow-boards/kanban.html` in your
  repo (it renders in GitHub's file viewer) to see all work items by status.
- **Learn the platform:** Read [docs/PLATFORM-GUIDE.md](PLATFORM-GUIDE.md)
  for the full reference — agents, commands, board semantics, and more.

---

## Workshop Instructor Guide

This section covers setup steps that instructors handle before participants
arrive.

### Pre-workshop checklist

1. **Verify the template version.** Go to
   [vibeacademy/gembaflow](https://github.com/vibeacademy/gembaflow) and check
   that the `.gembaflow-version` file was updated within the last 7 days. If
   it is older, open an issue on the template repo or pin the last-known-good
   release.

2. **Pre-warm the Codespace (strongly recommended).** Cold Codespace builds
   take roughly 3 minutes. To avoid that wait during a live session, ask
   attendees to click **"Create codespace on main"** at least 10 minutes
   before the session starts. They can leave the tab open and idle until you
   are ready.

3. **Confirm attendee access.** If you templated into an org (see the org
   pattern in Step 1), verify each attendee has Admin access before the
   session.

### Enabling prebuilds (optional, advanced)

GitHub Codespaces prebuilds cache the container image and postCreate script
result so new Codespaces boot in seconds instead of minutes. This is a GitHub
organization feature you can enable today without waiting for a framework
update:

1. In your org, go to **Settings** → **Codespaces** → **Set up prebuild**.
2. Choose the repository you created from the template.
3. Select the branch (`main`) and the devcontainer configuration
   (`.devcontainer/devcontainer.json`).
4. Set the prebuild trigger to **"On push"** so the cache stays warm after
   each update.
5. Click **"Create"**. GitHub will run the first prebuild immediately; future
   Codespace creates from this repo will use the cached result.

> **Note:** A default prebuild configuration shipped with the framework is
> planned as a follow-up improvement. Until that ships, the steps above are
> the way to enable prebuilds for your workshop repo.

---

## Troubleshooting Reference

| Symptom | Resolution |
|---------|-----------|
| Codespace fails to build | Click "Retry postCreate command" in the notification. If it fails again, run `bash scripts/codespace-postcreate.sh` in the terminal. |
| Claude Code icon is missing | Reload the browser tab. If still missing, install the "Claude Code" extension from the Extensions panel. |
| `/bootstrap` says "not authenticated" | In the terminal, run `gh auth login` and follow the prompts, then type `/bootstrap` again. |
| Codespace environment issues | Use the terminal path in [docs/GETTING-STARTED.md](GETTING-STARTED.md) as a fallback. |
