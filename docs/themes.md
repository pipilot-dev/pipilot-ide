# Themes

PiPilot ships 6 built-in color themes and supports installing more from the extension marketplace. Theme switching reskins the **entire IDE** in one repaint — workbench (sidebar / tabs / chat / debug / settings), syntax highlighting (Ace editor theme), terminal palette (xterm), and the welcome tab. Plus the chosen theme persists across reloads with no flash of the wrong theme thanks to a `localStorage` CSS cache.

## Built-in themes

| Theme | Style | Editor pair |
|-------|-------|-------------|
| **Midnight Studio** (default) | Dark, orange accent     | `midnight` (custom) |
| **Carbon**                    | Pure dark, cyan accent  | `tomorrow_night_eighties` |
| **Dracula**                   | Dark, pink/purple       | `dracula` |
| **GitHub Dark**               | Dark, blue accent       | `github_dark` |
| **Solarized Dark**            | Dark, yellow/blue base  | `solarized_dark` |
| **Solarized Light**           | Light, full polarity flip | `solarized_light` |

Switch via **Settings → General → Color Theme**. Each option in the picker previews the theme name in its own font; the dropdown is live and applies as you change selection.

## Extension themes

Activity bar → **Extensions & MCP** → search box → type `themes`. Five starter themes are pre-listed in the bundled marketplace:

- 🌃 **Tokyo Night** — cool blue/purple
- ❄ **Nord** — arctic palette
- ◐ **One Dark Pro** — Atom's classic
- ☕ **Catppuccin Mocha** — pastel dark
- ✦ **Monokai Pro** — refined Monokai

Click **Install** → the theme installs, registers, and shows up in the Settings picker immediately. No restart.

## Building your own theme

A theme extension is a self-contained `.js` file that calls `PiPilot.theme.register({...})`. Minimal example:

```js
(() => {
  const reg = window.PiPilot?.theme?.register;
  if (typeof reg !== 'function') return;
  reg({
    id: 'cyberpunk',
    label: 'Cyberpunk',
    dark: true,
    aceTheme: 'tomorrow_night_eighties',
    cssVars: {
      '--bg': '#0a0a14',
      '--surface': '#13132a',
      '--text': '#e0e0ff',
      '--accent': '#ff007f',
      // ... full list below
    },
  });
})();
```

### Required CSS variables

Every theme overrides these — see `extensions/themes/theme-tokyo-night.js` for a full reference.

```
--bg, --surface, --surface-alt, --surface-raised
--border, --border-hover, --scrollbar-track-bg
--text, --text-strong, --text-mid, --text-dim, --text-faint
--accent, --accent-hover, --accent-light, --accent-dim
--warn, --error, --ok, --info
```

Optional (light themes especially benefit from setting these explicitly):

```
--overlay-1, --overlay-2, --overlay-3, --overlay-4
```

These are translucent tints used for hover states and dividers across the IDE. Dark themes use white overlays (default); light themes should use black overlays so the surfaces stay visible.

### Recommended Ace pairings

Pick the closest Ace built-in syntax theme; it lazy-loads from the Ace CDN on first apply.

```
midnight (custom), monokai, dracula, github_dark, solarized_dark,
solarized_light, tomorrow_night, tomorrow_night_eighties,
nord_dark, one_dark, pastel_on_dark
```

### Publishing

1. Push your theme `.js` file to a public GitHub repo.
2. Submit a PR to [`pipilot-dev/pipilot-extensions`](https://github.com/pipilot-dev/pipilot-extensions) adding an entry to `registry.json`:

```json
{
  "id": "theme-cyberpunk",
  "name": "Cyberpunk",
  "description": "Neon pink + electric blue.",
  "icon": "⚡",
  "categories": ["themes"],
  "version": "1.0.0",
  "author": "you",
  "url": "https://raw.githubusercontent.com/<you>/<repo>/main/theme-cyberpunk.js"
}
```

3. After merge, anyone with PiPilot can search and install it from the Extensions sidebar.

For local-only testing during development, use `pipilot://builtin/theme-<id>` as the URL — the install handler reads from your app's bundled `extensions/themes/` directory instead of fetching.

## Public theme API

```js
PiPilot.theme.list()          // → [{id, label, dark, source}]
PiPilot.theme.current()       // → 'midnight' (or whatever's active)
PiPilot.theme.apply(id)       // switch + persist
PiPilot.theme.register({...}) // add a theme (extension entry point)
PiPilot.theme.unregister(id)  // remove a theme
```

`source` is one of `'builtin'`, `'extension'`, or `'cache'` (the latter for themes whose JS hasn't loaded yet but were rehydrated from the persistence cache so the IDE looks right at boot).

## How the cache works

When an extension calls `register()`, the resulting `[data-theme="<id>"] { … }` CSS block is also written to `localStorage` under `pipilot.theme.cache`. On the next IDE boot, **before** any extension code runs, theme.js rehydrates the cache by injecting cached CSS blocks as `<style data-cached="1">` elements. This means:

- The IDE renders in the user's chosen theme **immediately** on launch — no flash of Midnight before the extension loads.
- When the extension finally registers, it overwrites the cached entry with the live values, so any updates take effect on next boot.
- Uninstalling an extension removes its cache entry; if the active theme was the uninstalled one, you fall back to Midnight.

## Tab color hint

When a theme is applied, theme.js fires `bus.emit('theme:applied', { id, dark, aceTheme })`. Listeners (terminal, future titlebar tinting, etc.) can react. Today the terminal uses this to swap its xterm palette to a theme-authentic ANSI 16 — Dracula gets pink magenta, GitHub Dark gets the GitHub palette, etc.
