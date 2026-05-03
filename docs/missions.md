# Missions

A **Mission** is a saved unit of agent work that runs unattended. Think of it as a recurring job that PiPilot executes for you — every hour, on every commit, when you're idle, or just on demand. Missions can target your local repo or a remote GitHub repository (cloned into a scratch workspace).

Activity bar → 🚀 **Missions**. Or look for the rocket pill in the title bar.

## What you can build with missions

- "Sweep stale TODOs and open issues for them every Monday morning."
- "Whenever I push to `main`, run the test suite and post a Slack summary."
- "After 30 minutes idle, regenerate the README from the latest code."
- "Open this GitHub issue's repo, fix the bug described, and open a draft PR."
- "Run the wiki updater every 4 hours."

Anything the chat agent can do — file edits, git operations, terminal commands, web browsing, deploys — a mission can do unattended.

## Anatomy of a mission

| Field | Meaning |
|---|---|
| **Name**         | Display label (e.g. "Nightly TODO sweep") |
| **Prompt**       | Exactly what the agent receives, identical to typing it in chat |
| **Target**       | `Local: <path>` or `Cloud: github.com/<owner>/<repo>@<branch>` |
| **Trigger**      | `manual` / `once at <time>` / `every <interval>` / `cron <expr>` / `on-idle <after Xm>` / `on-commit` / `on-push` |
| **Permission preset** | `Read-only`, `Edit code`, `Edit + run`, `Full agent` (controls the agent's allowed-tools list) |
| **Notify**       | Toast on success / failure / both / never |
| **Log to**       | `<projectPath>/.pipilot/missions/<id>.log` (always) plus optional webhook URL |

## Triggers in detail

| Trigger | Fires when |
|---|---|
| **Manual**        | Only when you click "Run now" in the panel |
| **Once at**       | One-shot at a specific date/time, then disables itself |
| **Every N**       | Repeating timer (`every 30m`, `every 4h`, `every 1d`) |
| **Cron**          | Standard cron expression (`0 2 * * *` = nightly 2 AM) |
| **On-idle**       | Fires when the IDE has had no input for the specified window |
| **On-commit**     | Fires after any local `git commit` to the target repo (uses git hooks) |
| **On-push**       | Fires after any successful `git push` |

Time-based triggers continue running while PiPilot is open — including in [background mode](background-tasks.md) when the window is closed but the tray icon is alive.

## Permission presets

Same surface as the chat agent's allowed-tools, but locked down so an unattended mission can't go rogue:

| Preset | What's allowed |
|---|---|
| **Read-only** | `Read`, `Glob`, `Grep`, browser observe, no file mutations |
| **Edit code** | Above + `Write`, `Edit`, `MultiEdit`, no `Bash` |
| **Edit + run** | Above + `Bash` (terminal commands, package install) |
| **Full agent** | Everything the chat agent has — git push, deploy, browser interaction |

The permission preset is the safety net. If the prompt asks for something outside the preset, the agent refuses and the mission logs a permission-denied event.

## Cloud missions

When the target is a GitHub repo, PiPilot:

1. Creates a scratch clone under `<userData>/missions/<id>/<repo>/` using `git clone --depth 50` with HTTP/1.1 forced (avoids the Windows Schannel HTTP/2 reset bug)
2. Writes a workspace-scoped `.pipilot/auth.cfg` curl config containing the access token. Used as a fallback when shell var expansion is unreliable cross-shell. Auto-`.gitignore`'d so a stray `git add -A` can't commit it.
3. Sets `GITHUB_TOKEN` and `GH_TOKEN` env vars so `gh`, octokit, and other tools that read them work.
4. Runs the mission agent with `cwd` set to the scratch clone.
5. After the run, the clone stays for 24 h (so subsequent runs reuse it) then is garbage-collected.

The agent **never runs `gh auth login`** — that would leak credentials into your global config. Auth is workspace-scoped and disappears with the clone.

## The panel

Activity bar → 🚀 **Missions** opens a side panel listing every mission with:

- Name, target, trigger summary
- Last run time (relative — "12m ago")
- Last result (✅ success / ⚠️ partial / ❌ failed)
- Run count + average duration
- **▶ Run now** • **✏️ Edit** • **🗑 Delete** buttons

Clicking a mission's name or the **Edit** button opens the editor modal. Clicking the result icon opens the run log in a new editor tab.

## Storage

Missions live in two places:

```
<userData>/missions.json              ← global, follows you across projects
<projectPath>/.pipilot/missions.json  ← per-project, version-controllable
```

Per-project missions override global ones on id collision. Committing `.pipilot/missions.json` to git is fine and a great way to share team-wide automations.

Per-mission run logs and lock files:

```
<userData>/missions/<id>/log.jsonl        ← append-only, one JSON line per event
<userData>/missions/<id>/state.json       ← last run summary + run count
<userData>/missions/<id>/<clone-dir>/     ← cloud-mission scratch clone (cloud only)
```

## Creating your first mission

1. Activity bar → 🚀 → **+ New Mission**
2. Fill in:
   - Name: `Sweep stale TODOs`
   - Target: pick **Local** and select your project
   - Prompt: `Find all TODO and FIXME comments in src/. For any older than 30 days according to git blame, open a GitHub issue with the file:line as the title and the surrounding 5 lines as the body.`
   - Trigger: `Cron` → `0 9 * * MON` (every Monday at 9 AM)
   - Permission preset: `Edit + run` (needs git + gh)
   - Notify: `On failure only`
3. **Save**
4. **Run now** to test it once before relying on the schedule

## Status indicators

A mission run shows up as activity in:

- **Title bar pill** — shows "1 mission running" while in flight
- **Tray icon** — switches to active state if the window is hidden
- **Status bar** — bottom-right "🚀 sweep-todos" while active
- **Notifications** — desktop notification if you opted in

## Concurrency and queueing

Multiple missions can run in parallel. The chat agent and the wiki updater also count — PiPilot tracks each one independently, holds the power-save blocker while any are active, and only releases it when all are done.

A mission that's already running when its trigger fires again is **skipped**, not queued (avoids runaway execution if a long-running mission overlaps its own schedule). The skip is logged.

## Sign-in requirement

Mission runs use the same auth as the chat agent. If you're not signed in, mission triggers fire but the run immediately errors with `Sign in with GitHub to run missions`. Sign in once via [Account](ai-agent.md#sign-in) and missions resume normally.

## Tips

- Use the **wiki updater** ([Wiki](wiki.md)) as a recurring mission — it's just a prompt to the agent under the hood.
- Cloud missions are great for "open a PR for this Linear ticket" workflows when paired with a webhook trigger (planned for v0.2).
- The log file is plain JSONL — easy to grep, easy to import into a metrics pipeline.
- Pair missions with [background mode](background-tasks.md) so they keep running when you close the window.
