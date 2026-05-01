# Settings Reference

Every setting key, its default, where it's used, and what it does. Storage: `<userData>/settings.json`.

> The Settings UI (cog icon, or `Ctrl+,`) covers everything in this list — no need to edit JSON by hand. This reference is for documenting + scripting.

## General

| Key | Default | Live? | Effect |
|-----|---------|:--:|--------|
| `theme`                  | `"midnight"` | ✓ | Active color theme. See [Themes](themes.md). |
| `fontSize`               | `13`         | ✓ | Editor font size in pixels. |
| `fontFamily`             | `"jetbrains-mono"` | ✓ | Editor font id (built-in slug or custom CSS stack). |
| `fontLigatures`          | `false`      | ✓ | Toggle `font-feature-settings: 'calt' 'liga'` on the editor. |
| `cursorStyle`            | `"line"`     | ✓ | `"line"` or `"block"`. |

## Editor

| Key | Default | Live? | Effect |
|-----|---------|:--:|--------|
| `tabSize`                | `2`     | ✓ | Spaces per indent. Pushed to every open Ace session. |
| `wordWrap`               | `"on"`  | ✓ | `"on"` or `"off"`. Toggled on every session. |
| `minimap`                | `true`  | ✓ | Show the minimap on the right edge. |
| `lineNumbers`            | `true`  | ✓ | Gutter line numbers. |

## Terminal

| Key | Default | Live? | Effect |
|-----|---------|:--:|--------|
| `terminalProfile`        | `null`  | new terminals only | ID of the default shell (looked up from `api.terminal.profiles()`). When null, falls back to OS default. |
| `terminalFontSize`       | `13`    | ✓ | xterm font size; refits all open terminals on change. |

## AI

| Key | Default | Live? | Effect |
|-----|---------|:--:|--------|
| `agentDefaultMode`       | `"agent"` | new chats only | `"agent"` or `"plan"`. |
| `reasoningEffort`        | `"medium"` | ✓ | `"none" | "low" | "medium" | "high" | "xhigh"`. Synced with the chat input dropdown. Also persisted to `localStorage.pipilot:reasoning-effort` for cross-window consistency. |

## Wiki (auto-update)

| Key | Default | Live? | Effect |
|-----|---------|:--:|--------|
| `autoUpdateWiki`         | `true`             | ✓ | Refresh `.pipilot/wikis/` after meaningful agent turns. |
| `autoUpdateWikiCooldownMs` | `300000` (5 min) | ✓ | Min gap between auto-updates. |

## Built-in extensions

These flags gate the bundled extensions (`extensions/<id>.js`). Default `true` for each; setting to `false` skips loading on next launch.

| Key | Extension |
|-----|-----------|
| `builtinWordCount`           | Word Count status-bar widget |
| `builtinJsdoc`               | JSDoc generator (`Mod+Shift+D`) |
| `builtinColorPreview`        | Hex/rgb/hsl color swatches in gutter |
| `builtinFileSizeIndicator`   | File-size + line/char count in status bar |
| `builtinAutoCloseTag`        | Auto-close HTML/JSX/Vue/Svelte tags |
| `builtinApiPlayground`       | REST playground sidebar tool |
| `builtinDependencyGraph`     | Activity-bar dependency-graph viewer |

## Internal / migrations

| Key | What it is |
|-----|------------|
| `__migrations`           | Object recording one-shot setting migrations the IDE has run (e.g. `wordWrapDefaultOn`). Don't edit. |

## Live-update mechanism

When any setting changes:

1. The Settings tab calls `api.settings.set(key, value)` (or you set programmatically via the same IPC).
2. Main writes to `settings.json` and broadcasts `settings:changed` over the bus.
3. `renderer/ipc.js` mirrors `state.settings[key] = value` so all consumers see the new value immediately.
4. Each consumer re-applies as needed: ace-editor reapplies font size / cursor style / wrap / line numbers / tab size; terminal recolors; chat updates default mode; wiki updater reads new cooldown; etc.

This is how live-toggling everything works without a reload — the bus event is the single source of truth.

## Reading settings programmatically

From the renderer:

```js
const r = await window.electronAPI.settings.all();
console.log(r.settings.theme);

await window.electronAPI.settings.set('fontSize', 14);
window.PiPilot.bus.emit('settings:changed', { key: 'fontSize', value: 14 });
```

The bus event is what triggers downstream consumers, so emit it after `set`. (The Settings tab does this automatically.)

## Defaults file

Defaults live in `main/ipc-settings.js` under `DEFAULTS`. On first read, the IDE merges your `settings.json` on top of `DEFAULTS`, runs any pending one-shot migrations (recorded under `__migrations`), then writes the merged result back if anything changed.

To restore a key to default: delete it from `settings.json` and reload.

## Where settings.json lives

| OS | Path |
|----|------|
| Windows | `%APPDATA%\PiPilot\settings.json` |
| macOS   | `~/Library/Application Support/PiPilot/settings.json` |
| Linux   | `~/.config/PiPilot/settings.json` |

The exact path is `<app.getPath('userData')>/settings.json`.
