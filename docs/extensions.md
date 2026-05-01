# Extensions

PiPilot has a real extension system. Built-in extensions ship with the IDE; third-party extensions install from a marketplace registry; theme + font extensions follow specialised flows.

## Three categories

| Category | What it adds | Entry point |
|----------|--------------|-------------|
| **Regular**       | Editor commands, sidebar widgets, status-bar items, anything | `extensions/<id>.js` |
| **Themes**        | Color theme contribution                                      | `extensions/themes/theme-<id>.js` |
| **Fonts**         | Font registration                                             | `extensions/fonts/font-<id>.js` |

All three follow the same install / uninstall / persist mechanics — they differ only in which `PiPilot.*.register()` API they call.

## Browsing the marketplace

Activity bar → **Extensions & MCP** → **Extensions** tab.

The list combines two sources:

- **Bundled** — ships with the IDE (in this repo's `extensions/registry.json`). Always available offline.
- **Remote** — fetched from `https://raw.githubusercontent.com/pipilot-dev/pipilot-extensions/main/registry.json`. Bundled wins on id conflict.

Filtering:

- **Search box** at the top — case-insensitive match across name / id / description / author / categories.
- **Category chips** under the search box — `All`, then `themes`, `fonts` pinned next, then everything else alphabetical.
- Each card shows: icon, name + version, description, author, install/uninstall + enable/disable toggle.

## Installing

Click **Install** on any card. The IDE:

1. Downloads the JS via `extensions:install` IPC.
2. For `pipilot://builtin/<id>` URLs (used by bundled themes/fonts), reads from `<appPath>/extensions/...` instead of HTTP — works fully offline.
3. Saves to `<userData>/extensions/<id>.js`.
4. Records in `<userData>/extensions/installed.json` with `enabled: true` and a timestamp.
5. Live-loads the extension immediately by `eval`-ing the JS in the renderer with the `PiPilot` / `bus` / `api` / `state` / `db` args (see [Extension API](extension-api.md)).

No restart. The extension is active in the next agent turn.

## Built-in extensions

These ship with the IDE and can be enabled/disabled per-user via **Settings → Features**:

- **Word Count** — words / lines / reading time in status bar.
- **JSDoc Generator** — `Mod+Shift+D` over a function.
- **Color Preview** — gutter swatches for hex / rgb / hsl.
- **File Size Indicator** — file size + char count in status bar.
- **Auto Close Tag** — HTML/JSX/Vue/Svelte tag completion.
- **API Playground** — sidebar HTTP client for testing REST APIs.
- **Dependency Graph** — activity-bar tool to visualize import/require relationships, exports as PNG/SVG.

Each has a `settingsKey` (e.g. `builtinWordCount`); toggling the feature in Settings sets the key and the extension loads/unloads on next launch.

## Disabling / uninstalling

- **Toggle** on any installed-card → flips `enabled` in `installed.json`. Takes effect on next launch.
- **Uninstall** → removes the JS file + the registry entry, plus tears down the extension's IndexedDB database via `window.PiPilot.extDB.destroy(id)`.

## Theme extensions

See [Themes](themes.md) for the full guide. TL;DR:

```js
PiPilot.theme.register({
  id: 'my-theme',
  label: 'My Theme',
  dark: true,
  aceTheme: 'monokai',
  cssVars: { '--bg': '#…', '--surface': '#…', /* … */ },
});
```

Five starter themes ship in the marketplace: Tokyo Night, Nord, One Dark Pro, Catppuccin Mocha, Monokai Pro.

## Font extensions

See [Fonts](fonts.md) for the full guide. TL;DR:

```js
PiPilot.fonts.register({
  id: 'my-font',
  label: 'My Font',
  family: '"My Font"',
  url: 'https://fonts.googleapis.com/css2?family=My+Font',
  ligatures: true,
});
```

Three starter fonts ship: Geist Mono, Comic Mono, Monaspace Neon.

## Building a regular extension

A minimal example — adds a status bar widget showing the current time:

```js
// my-clock.js
(() => {
  const PiPilot = window.PiPilot;
  if (!PiPilot?.statusbar) return;
  const item = PiPilot.statusbar.add({
    id: 'my-clock',
    align: 'right',
    text: '⏰ 12:00',
  });
  setInterval(() => {
    const now = new Date();
    item.setText('⏰ ' + now.toLocaleTimeString());
  }, 1000);
})();
```

Full API surface — `PiPilot.editor`, `PiPilot.chat`, `PiPilot.sidebar`, `PiPilot.panels`, `PiPilot.modal`, `PiPilot.shortcuts`, file system / git / terminal / diagnostics / dev server APIs — documented in [Extension API](extension-api.md).

## Publishing

1. Write your extension as a single self-contained `.js` file.
2. Push to a public GitHub repo at `extensions/<id>.js` (or `themes/`, `fonts/`).
3. Submit a PR to [`pipilot-dev/pipilot-extensions`](https://github.com/pipilot-dev/pipilot-extensions) adding to `registry.json`:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "What it does in one line.",
  "icon": "🔌",
  "categories": ["editor", "productivity"],
  "version": "1.0.0",
  "author": "you",
  "url": "https://raw.githubusercontent.com/<you>/<repo>/main/extensions/<id>.js"
}
```

4. After merge, anyone with PiPilot can search and install your extension.

For local-only testing, use the URL `pipilot://builtin/<id>` — the install handler reads from your app's bundled `extensions/` directory.

## Persistence guarantees

- **Built-in** — feature flags persist in `settings.json`.
- **Installed** — `installed.json` lists what's installed + enabled. Re-loaded on every IDE start.
- **Themes** — extra cache in `localStorage.pipilot.theme.cache` so the theme applies before the extension's JS loads (no flash of wrong theme).
- **Fonts** — same cache pattern at `localStorage.pipilot.fonts.cache`.
- **Extension data** — each extension gets a scoped IndexedDB database (the `db` arg passed to its entry function). Survives uninstall unless the user picked "wipe data" too.

## Tips

- Extensions can register chat commands the agent can call — useful for project-specific workflows.
- For sensitive credentials your extension needs, use `api.secrets.set/get` — encrypted in the OS keychain via Electron's `safeStorage`.
- The bundled `dependency-graph` extension is a great reference for "moderately ambitious" extension code: tree-walks the project, builds a graph, renders a custom SVG, exports as PNG.
- Extensions can listen to bus events (`project:opened`, `file:saved`, `agent:turn-complete`, etc.) — see [Extension API](extension-api.md) for the full catalog.
