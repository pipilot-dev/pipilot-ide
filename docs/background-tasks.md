# Background Mode & Power Management

PiPilot is designed to keep working when you stop watching. Three things make that reliable:

1. **Tray-resident mode** — closing the window doesn't quit the app
2. **Power-save blocker** — your machine stays awake while an agent is mid-turn
3. **Sleep resilience** — when the OS suspends and resumes, the agent picks back up gracefully

All three are on by default. Tweak in **Settings → Features**.

## Tray-resident mode

When **Run in background** is on (default), clicking the window's ✕ button **hides** the window instead of quitting. The app keeps running with a system-tray icon — green dot when an agent is active, grey when idle. Right-click the tray icon for:

- **Show PiPilot** — restore the window
- **Hide PiPilot** — collapse it back to the tray
- **Agent: <state>** — read-only indicator (active / idle)
- **Quit PiPilot** — actually exit

Quit via the menu or `File → Quit` (`Ctrl+Q`) when you really want to close.

This means [missions](missions.md), the [wiki auto-updater](wiki.md), and any chat turn the agent is in the middle of will all keep running with the window closed. Reopen any time to see the result.

## Power-save blocker

Operating systems aggressively sleep machines that look idle. That's a problem when an agent is in the middle of a 4-minute Opus turn — the machine sleeps, the network connection drops, the SDK errors out.

PiPilot holds an Electron `prevent-app-suspension` blocker for the **exact duration** of every agent run. Reference-counted across:

- The chat agent
- Each running mission
- The wiki auto-updater
- Inline chat (`Ctrl+I`) sessions

The blocker is released the moment the last active agent finishes. Your machine sleeps normally when you're idle and there's no work in flight — you don't pay a battery cost for having PiPilot open.

Toggle in **Settings → Features → Keep awake while agent active** if you specifically want this off (e.g. on a desktop where you don't care).

## Sleep resilience

When the OS suspends mid-run (laptop lid close, battery critical, manual sleep), Electron's `powerMonitor` fires `suspend` and `resume` events. PiPilot:

1. **On suspend** — writes a breadcrumb to `<userData>/sleep-breadcrumb.json` with the timestamp + active agent IDs
2. Broadcasts `power:suspend` to the renderer — the chat panel shows "Paused — system sleeping…"
3. **On resume** — broadcasts `power:resume`, the chat panel clears the warning, and the agent's existing stream attempts to reconnect

The breadcrumb file is mostly for debugging — if you ever wonder "did my mission get killed by sleep?", check the file's `mtime` against the mission's last-run timestamp.

Lock screen events (`power:lock` / `power:unlock`) are also broadcast but don't change behaviour — the agent keeps going while you're locked.

## Scheduled work

Time-based triggers ([missions](missions.md) cron / interval / one-shot) all rely on background mode. With background mode off, closing the window quits the timer. With it on, your scheduled missions fire on cadence even if you haven't touched the machine in days (assuming the machine itself is awake or sleep-then-resume cycle is short).

For 24/7 reliability, you'd want to:

1. Have **Run in background** on
2. Have **Keep awake while agent active** on (to survive long-running missions)
3. Disable OS sleep entirely (Windows: Settings → System → Power; macOS: caffeinate; Linux: systemd-inhibit) — only if you really want a desktop-style always-on workstation

For most laptop users, the defaults are right: PiPilot stays alive between agent runs in the tray, sleeps with the laptop, and resumes cleanly.

## Settings

| Setting | Default | What it does |
|---|---|---|
| **Run in background** | on | Close button → hide instead of quit + tray icon stays |
| **Keep awake while agent active** | on | Hold a power-save blocker during agent runs |
| **Show tray icon** | on | Even with background mode off, can show the icon for quick access |
| **Notifications: agent done** | on | Desktop toast when an unattended agent run finishes |
| **Notifications: mission failed** | on | Desktop toast when a mission errors |

All in **Settings → Features**.

## Status surfaces

Multiple places show what's running:

- **Title bar pill** — counts of active chat / missions / wiki turns
- **Tray icon** — green dot = at least one agent active
- **Status bar** — bottom-right shows the most recently active agent ID
- **Chat panel header** — "Agent paused — system sleeping…" / "Resuming…" during sleep cycles

## Concurrency limits

There's no hard cap, but every active agent counts against:

- Your sign-in's per-day usage (currently unlimited; will become a quota when paid plans launch)
- Your machine's CPU + RAM (each turn streams from the proxy, decodes JSON, applies file diffs)

Realistic upper bound on a normal laptop: ~4 concurrent agents (chat + 2 missions + wiki). More than that and you'll feel the renderer thread bog down.

## Tips

- **Check what's keeping the machine awake** — open the tray icon → "Active agents" shows each tag. If you see something you don't recognise, it's a bug — file an issue.
- **Verify mission runs survive sleep** — schedule a 1-minute interval mission, sleep the laptop for 5 minutes, wake it. Check the mission log; should show runs spaced ~6 minutes apart (one missed during sleep).
- **Combine with [missions](missions.md)** — the killer combo. Set up a "build a docs PR every Monday morning" mission and forget about it.
- For server-style use, `background-mode.js` is small + well-commented; you could fork PiPilot to make it a true daemon by stripping the BrowserWindow entirely.
