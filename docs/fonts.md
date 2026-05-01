# Fonts

PiPilot bundles **9 monospace fonts** as woff2 files (~685 KB total) so they work fully offline — no Google Fonts CDN call, no privacy leak, instant apply with no flash. Plus extension fonts (`fonts` category) for anything else.

## Built-in fonts

| Font | Ligatures | Default weights bundled |
|------|:--:|---|
| **JetBrains Mono** (default) | ✓ | 400, 700 |
| **Fira Code**       | ✓ | 400, 700 |
| **Cascadia Code**   | ✓ | (system; Windows-only — not redistributable through @fontsource) |
| **IBM Plex Mono**   | — | 400, 700 |
| **Source Code Pro** | — | 400, 700 |
| **Roboto Mono**     | — | 400, 700 |
| **Inconsolata**     | — | 400, 700 |
| **Space Mono**      | — | 400, 700 |
| **Ubuntu Mono**     | — | 400, 700 |
| **DM Mono**         | — | 400 |

All shipped from the [`@fontsource`](https://fontsource.org) packages — bundled into `public/fonts/<id>/` at install time by `scripts/copy-fonts.js`. The script strips italic, weights outside 400/700, non-Latin scripts, and the `.woff` fallback (modern browsers all support woff2). Manual rebuild: `npm run fonts`.

Cascadia Code stays as a system-only entry — Microsoft ships it with Windows but doesn't distribute it through @fontsource, so we don't bundle it. It will work if your machine has it installed.

## Picking a font

**Settings → General → Font Family** — dropdown of every registered font (built-in + extension). Each option in the dropdown previews in its own font:

```
JetBrains Mono       ← rendered in JetBrains Mono
Fira Code            ← rendered in Fira Code
Catppuccin Mocha     ← rendered in Catppuccin Mocha
…
Custom (CSS stack)…  ← reveals a freeform input
```

Pick a built-in to apply immediately. Pick **Custom** to paste your own CSS `font-family` stack, e.g. `"Berkeley Mono", "JetBrains Mono", monospace` — useful if you have a paid font installed.

## Programming ligatures

**Settings → General → Programming Ligatures** toggles `font-feature-settings: 'calt' 1, 'liga' 1, 'clig' 1` on the Ace editor. With Fira Code, JetBrains Mono, Cascadia Code, or Monaspace Neon installed, glyphs like `=>`, `!=`, `===`, `>=`, `&&`, `||`, `<=`, `>>=`, `=>` render as combined characters.

The toggle is global to the editor — terminal and chat code blocks aren't affected.

## How the apply flow works

When you switch a font:

1. The picker writes `settings.fontFamily = '<id>'` and emits `settings:changed`.
2. `fonts.js`'s listener calls `apply('<id>')` → finds the font in the registry → injects `<link rel="stylesheet" href="public/fonts/<id>/index.css">` into `<head>` (only the first time per font; cached after).
3. Updates `--font-mono` CSS variable on `<html>` so all monospace surfaces (chat code blocks, file paths in breadcrumbs, etc.) reskin via cascade.
4. Awaits `document.fonts.load(family)` — guarantees the woff2 has actually downloaded before pushing to Ace, so you don't see a fallback render.
5. Calls `editor.setOption('fontFamily', resolvedCss)` then `editor.renderer.updateFontSize()` to invalidate Ace's cached character metrics so cursor position re-measures correctly.

This sequence is what fixed the original "font picker doesn't apply until I refresh" bug.

## Extension fonts

Activity bar → **Extensions & MCP** → search "fonts". Three starter font extensions ship with the bundled marketplace:

- **Geist Mono** (Vercel) — modern technical monospace
- **Comic Mono** — monospaced Comic Sans, surprisingly readable
- **Monaspace Neon** (GitHub) — texture healing + ligatures

Each lazy-loads from a CDN the first time it's applied (Google Fonts / jsDelivr) and persists via the same localStorage cache pattern as themes — survives a relaunch even before the extension code itself runs.

## Building your own font extension

```js
(() => {
  const reg = window.PiPilot?.fonts?.register;
  if (typeof reg !== 'function') return;
  reg({
    id: 'mononoki',
    label: 'Mononoki',
    family: '"mononoki"',
    url: 'https://cdn.jsdelivr.net/npm/typeface-mononoki@0.0.71/index.css',
    ligatures: false,
  });
})();
```

Then add a registry entry under `categories: ["fonts"]` (see [Themes](themes.md) for the publishing flow — same shape).

## Public font API

```js
PiPilot.fonts.list()              // → [{id, label, family, url, ligatures, source}]
PiPilot.fonts.current()           // → 'jetbrains-mono'
PiPilot.fonts.apply(id)           // switch + persist
PiPilot.fonts.register({...})     // add a font (extension entry)
PiPilot.fonts.unregister(id)      // remove a font
PiPilot.fonts.DEFAULT_ID          // 'jetbrains-mono'
```

Source field on each list entry is `'builtin'`, `'extension'`, or `'cache'`.

## Tips

- Want a specific weight? `fontFamily = "Fira Code"` will use 400 by default; if you have variable axis support (some installed fonts do), the editor uses your OS-level weight pref.
- The chat panel and the terminal both use `--font-mono` so they stay in sync with whatever you pick.
- Setting font size: **Settings → General → Editor Font Size**, range slider 10–24px. Live-applies.
- For `npm run fonts` to find the source files, the `@fontsource/<id>` packages must be installed. They're listed under `dependencies` in `package.json`.
