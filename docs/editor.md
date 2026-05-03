# Code Editor

PiPilot uses [Ace](https://ace.c9.io/) as its code editor — fast, mature, and small enough to ship as part of a desktop app without a build step. This page covers everyday editing.

## Tabs

- Click any file in the tree to open it in a new tab.
- `Mod+Tab` cycles through open tabs (most-recently-used order). `Mod+1..9` jumps directly.
- Drag a tab to reorder. Drag onto a divider to split (planned, not yet wired).
- Middle-click closes a tab. `Mod+W` closes the active one.
- Modified tabs show a `●` instead of an `×` until saved.

Some tabs are **virtual** — they're not files on disk, they're IDE surfaces opened as editor tabs:

- 🏠 Welcome — `__welcome__`
- ⚙ Settings — `pipilot-settings://main`
- 🚀 Deploy Hub — `pipilot-deploy://main`
- 📚 Help — `pipilot-help://main`
- 🌐 Browser — `browser-tab://...`

Virtual tabs never auto-restore on launch and don't show a path breadcrumb.

## Multi-cursor

- `Mod+D` — add the next match of the selected text as a new cursor.
- `Mod+Shift+L` — add cursors at every match of the selection.
- `Mod+Click` — add a cursor at the click position.
- `Alt+Click+drag` — column / box selection.
- `Esc` — collapse to a single cursor.

## Find / Replace

- `Mod+F` — find in current file (overlay search bar).
- `Mod+H` — find + replace.
- `Mod+Shift+F` — search across the whole project (sidebar Search panel).
- Regex toggle, case toggle, whole-word toggle in every search surface.

## Code intelligence

Out of the box you get:

- **Syntax highlighting** for ~120 languages (Ace built-in modes).
- **Bracket matching** with rainbow colors via the bundled `bracket-colorizer` extension.
- **Auto-close brackets / quotes / tags** — HTML/JSX/Vue/Svelte tags handled by the bundled `auto-close-tag` extension.
- **Word-based autocomplete** — picks up identifiers from open files.
- **JSDoc generation** — `Mod+Shift+D` over a function (bundled `jsdoc-generator` extension).
- **Inline color preview** — gutter swatches for `#hex`, `rgb()`, `hsl()` (bundled `color-preview`).
- **File size / word count** in the status bar (bundled `file-size-indicator`, `word-count`).

For real LSP / type-checking, add a language extension (TypeScript LSP integration is on the roadmap). The chat agent can do "type-check this" with `mcp__pipilot__get_diagnostics` against the project.

## Inline AI

You don't have to leave the editor to talk to the agent.

- **Ghost-text completions** — as you type, a fast fill-in-the-middle model streams a greyed-out suggestion at the cursor. `Tab` accepts, `Esc` rejects. Toggle in **Settings → AI → Inline Completions** or via the editor right-click menu (Toggle Inline Completions). Requires sign-in.
- **Inline Chat (`Ctrl+I`)** — opens a floating widget over the editor with preset chips (*Fix bugs*, *Refactor*, *Explain*, *Add comments*, *Add docs*) plus a free-text prompt. Streams a rewrite of the current selection (or whole file), shows a side-by-side preview, accept replaces the text.
- **Selection actions** — right-click any selection for *Add to Chat*, *Explain*, *Review*, *Fix*, *Refactor*, *Add Comments*, *Add Docs*. Each opens the chat panel and starts a streamed turn with the selection as context.

See [AI Agent → Inline AI](ai-agent.md#inline-ai-in-the-editor) for the full surface.

## Tab + cursor restoration

Open tabs and the **cursor / scroll position** of every tab persist per-project. Close the IDE in the middle of a function, reopen the project, your cursor is back exactly where it was — including selection range and horizontal scroll. State lives in `localStorage.pipilot:editor-tabs:<projectPath>` and is rewritten on every tab switch and on shutdown.

## Settings that affect the editor

All live-applied — change them in **Settings → General / Editor** and you see the result immediately, no reload.

| Setting | Default | What it does |
|---------|---------|--------------|
| `theme`              | `midnight`        | Color theme (workbench + Ace syntax). See [Themes](themes.md). |
| `fontFamily`         | `jetbrains-mono`  | Editor font. See [Fonts](fonts.md). |
| `fontSize`           | `13`              | Pixels. Range slider 10–24. |
| `fontLigatures`      | `false`           | Enables `font-feature-settings: 'calt' 'liga'` on the editor. |
| `cursorStyle`        | `line`            | `line` or `block`. |
| `tabSize`            | `2`               | Spaces per indent. |
| `wordWrap`           | `on`              | `on` or `off`. Live-toggleable. |
| `lineNumbers`        | `true`            | Gutter line numbers. |
| `minimap`            | `true`            | Minimap on the right edge. |

Internal: `state.settings` is mirrored from `settings.json` on boot (ipc.js) and updated on every `settings:changed` bus event so consumers see fresh values without re-reading from disk.

## Snippets

Ace has built-in snippet support but no UI for managing user snippets yet — you can register them programmatically via the [Extension API](extension-api.md) (`PiPilot.editor.getAce().completers`).

## Wrap limit ruler

The bundled `wrap-limit` extension shows a vertical ruler at column 80 (configurable). Helpful for keeping commit messages and prose lines tidy.

## Image / video / PDF preview

Open any image, video, audio, or PDF file from the file tree — instead of trying to render it as text, the editor opens a virtual preview tab with native rendering. The same applies to git blame's "View at this commit" — large binary blobs are handled correctly.

## Editing virtual tabs

You can't. They're rendered HTML, not text buffers. If a virtual tab needs editing affordance (Settings, Help), it has its own controls.

## Tips

- Right-click in the editor → context menu with cut/copy/paste/find + AI actions ("Explain this", "Fix this", "Refactor").
- The breadcrumb under the tab strip shows your full file path; click any segment to navigate.
- Status bar bottom-right shows `Ln, Col` — click it to jump to a specific line (`Mod+G`).
- The minimap on the right is clickable for quick navigation; drag the viewport to scroll.
