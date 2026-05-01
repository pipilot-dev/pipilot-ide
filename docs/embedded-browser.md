# Embedded Browser

PiPilot ships a real Chromium browser as an editor tab. Open any URL — including sites that block iframe embedding — and the agent can drive it: navigate, click, type, screenshot, evaluate JS, run game-bots in-page.

## Opening a tab

- **`Ctrl+Shift+B`** — new browser tab.
- File menu → **New Browser Tab**.
- Right-click any URL in the editor → **Open in browser**.
- Or ask the agent: "open google.com" → it picks `mcp__pipilot__browser_open`.

The tab acts like a real browser: address bar, back / forward / reload, bookmarks (planned), incognito mode toggle.

## What's different from a regular browser

- **Embedded** — runs inside the IDE window, no context switch.
- **Auto-captures popups** — `target="_blank"` and `window.open()` open as new browser tabs in the IDE, not external windows.
- **Auto-injects PiPilot helpers** — every page gets a `window.PiPilot.browser` helper (`pp` for short) that the agent uses for synthetic clicks, snapshot extraction, etc. Invisible to your code.
- **View source toggle** — view-source-of-page button (and back-to-rendered toggle).
- **Chrome extensions** — limited support; most extensions don't work because we don't run the full extension API.

## Agent-driven automation

The agent has ~25 tools under `mcp__pipilot__browser_*`:

### Navigation
- `browser_open({ url })` → opens a new tab, returns `tabId`
- `browser_navigate({ tabId, url })` → navigate existing tab
- `browser_back / forward / reload`
- `browser_close_tab / list_tabs`
- `browser_url / browser_title`

### Observation (the agent's eyes)
- `browser_observe({ tabId })` → returns a screenshot path + DOM snapshot YAML + console log path. The agent reads the screenshot with the `Read` tool to see the page visually, and the snapshot YAML to find clickable refs.
- `browser_snapshot` — DOM snapshot only (faster).
- `browser_console_log` — recent console messages.

### Interaction (selector + ref-based)
- `browser_click({ selector })` / `browser_click_ref({ ref })` — refs come from the snapshot YAML
- `browser_type({ selector, text })` / `browser_fill_ref({ ref, value })`
- `browser_press_key({ key })` — supports chords like `Ctrl+Enter`
- `browser_hover / drag / scroll / scroll_to / wait_for / wait_load`

### Data extraction
- `browser_get_text({ selector })` / `browser_get_html({ selector })`
- `browser_eval({ expression })` — full JS evaluation, smart wrapper handles single-expression / multi-line statements
- `browser_summary` — page title + first 5 paragraphs
- `browser_poll_until({ expression, intervalMs })` — wait for any condition
- `browser_sample({ durationMs, intervalMs })` — sample DOM state over a time window

### Other
- `browser_upload({ selector, files })` — file inputs
- `browser_set_viewport / reset_viewport` — resize the rendering area
- `browser_cookies_get` — get cookies for the current page
- `browser_pdf({ name })` — save the current page as PDF

## A typical flow

The agent opens a site, screenshots it, finds the right element from the snapshot, clicks it:

```
mcp__pipilot__browser_open({ url: 'https://example.com' })
  → { tabId: 'browser-tab://std/3/1714400000', title: 'Example' }

mcp__pipilot__browser_observe({ tabId: '...' })
  → {
      screenshot: '/tmp/screenshot-xyz.png',
      snapshotPath: '/tmp/snapshot-xyz.yaml',
      consoleLogPath: '/tmp/console-xyz.log'
    }

Read('/tmp/screenshot-xyz.png')   # agent sees the page visually
Read('/tmp/snapshot-xyz.yaml')    # agent finds 'Login' button as ref e3

mcp__pipilot__browser_click_ref({ tabId: '...', ref: 'e3' })
  → ok

mcp__pipilot__browser_type({ tabId: '...', selector: '#username', text: 'me@example.com' })
mcp__pipilot__browser_press_key({ tabId: '...', key: 'Enter' })
```

## Real-time bots / game-playing

Three tools build a long-lived JS bot that runs in-page:

- `browser_run_script({ tabId, name, script, useRaf, intervalMs })` — installs a script that runs every animation frame (`useRaf`) or every N ms.
- `browser_update_script_state({ tabId, name, patch })` — merge new state into a running bot from your vision loop.
- `browser_stop_script({ tabId, name })`.
- `browser_script_status({ tabId, name })` — running / stopped / error count.

Use case: ask the agent to play Aviator — it opens the game, screenshots the canvas, runs a bot that monitors the multiplier, and tells the bot when to cash out from outside.

> **Note:** these `browser_run_script` family of tools are not enabled in the default build today (they were exploratory and are commented out pending more validation work). The other browser tools are all live.

## Per-tab + global state

Each browser tab has its own webview, separate cookies, separate history. Incognito tabs use an in-memory partition (cleared on close).

- Address bar + URL navigation persists across IDE restarts (tab restoration is on the roadmap).
- `pp.scripts` (the bot registry) lives per-tab and is cleared on navigate.
- The `pp` helper is re-injected on every navigation via the preload script.

## Tips

- **Open external instead** — sometimes you want the URL in your real browser. Right-click the address bar → **Open in default browser**.
- **DevTools** — `Ctrl+Shift+I` opens Chrome DevTools attached to the embedded browser tab. Useful for debugging what the agent's tools see.
- **Console output** — the agent's `browser_console_log` tool returns the same console messages you'd see in DevTools. The IDE's main console (Help → Toggle DevTools) is separate.
- The agent often combines browser tools with file ops: read a HTML file, open it in the browser, screenshot the result, iterate. Asking "make this look better" is a real loop.
