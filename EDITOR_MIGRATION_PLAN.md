# Ace Editor Migration Plan

## Overview
Replace Monaco with Ace Editor in the fiddle-pipilot-ide project.
Reference: `pipilot_god_prototype_v1.html` (903 lines, all features working)

## Files to create/modify

### New files:
- `renderer/ace-editor.js` — Main editor module (replaces editor.js)
  - Ace setup with Midnight theme
  - Tab management
  - File open/close/save
  - Breadcrumb updates
  - Virtual tab support (binary files, diffs, commit details)
  - Ghost text inline completion (Codestral FIM API)
  - Diagnostics engine (squiggly markers)
  - Hover peek (Monaco-style tooltip)
  - Quick fix menu
  - Inline chat widget (Ctrl+I, line widget)
  - Context menu (right-click)
  - Go to Definition (Ctrl+Click)
  - Keybindings

- `renderer/ace-ai.js` — AI integrations (replaces editor-ai.js)
  - Ghost text via Codestral FIM (same API as current editor-ai.js)
  - Inline chat widget with diff preview
  - "Fix with AI" action
  - "Explain" action
  - Add to Chat action

### Modified files:
- `index.html` — Remove Monaco bundle/CSS, add Ace CDN scripts
- `styles/tokens.css` — Keep same design tokens
- `renderer/chat.js` — Update bus event names if needed

### Removed files:
- `renderer/editor.js` (replaced by ace-editor.js)
- `renderer/editor-ai.js` (replaced by ace-ai.js)
- `renderer/monaco-entry.js`
- `renderer/monaco-bundle.*`
- `renderer/monaco-workers/`
- `scripts/build-monaco.mjs`

## Design tokens to preserve:
- --bg: #16161a (editor background)
- --surface: #1c1c21
- --accent: #FF6B35 (cursor, selection highlight)
- --font-mono: Geist Mono
- Font size: 13px
- Line height: 1.55
- Tab size: 2

## Ace theme (Midnight):
Map current Monaco "midnight" theme to Ace:
- Background: #16161a
- Foreground: #b0b0b8
- Comment: #6b6b76 italic
- Keyword: #FF8C61
- String: #56d364
- Number: #6cb6ff
- Function: #e5a639
- Cursor: #FF6B35
- Selection: rgba(255,107,53,0.25)
- Line highlight: #1c1c21
- Gutter: #16161a, line numbers #42424a

## API compatibility:
The following `window.PiPilot.editor` methods must be preserved:
- openFile(path, opts)
- closeFile(path)
- saveFile(path)
- saveAllFiles()
- getActiveFile()
- getDirtyFiles()
- openVirtualTab({ id, name, mount })
- openDiffTab({ name, original, modified, ... })
- isVirtualTab(id)

## Bus events to preserve:
- editor:position { line, col }
- editor:language { language }
- editor:active-changed { path }
- editor:dirty-changed { path, dirty }
- file:open { path, line, col }
- file:saved { path }
- problems:count { errors, warnings, total }
