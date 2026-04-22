# PiPilot IDE Fiddle — Conversation Summary

> **Date**: April 20–21, 2026
> **Purpose**: Building the Electron desktop version of PiPilot IDE (fiddle), migrating from the Vite web app version.
> **Location**: `C:\Users\big\Documents\Projects\pipilot-ide\fiddle-pipilot-ide\`
> **Vite reference**: `C:\Users\big\Documents\Projects\pipilot-ide\` (src/, server/)

---

## Architecture Overview

The fiddle is a **vanilla JS Electron app** (no React, no Vite bundler). All renderer code is plain `.js` files loaded via `<script>` tags in `index.html`.

### Key Directories
- `main/` — Electron main process IPC handlers
- `renderer/` — Frontend JS modules (each is an IIFE)
- `styles/` — CSS files (layout.css, editor.css, components.css, theme.css)
- `public/` — Static assets (icon.png, logo.png, favicon.png)

### Main Process Files (`main/`)
| File | Purpose |
|------|---------|
| `ipc-files.js` | File system operations, tree walker, static file server, ZIP export |
| `ipc-git.js` | Git operations via simple-git |
| `ipc-terminal.js` | PTY terminal sessions via node-pty |
| `ipc-agent.js` | Claude Agent SDK integration, session management, custom MCP tools |
| `ipc-diagnostics.js` | TypeScript Compiler API diagnostics + chokidar file watcher |
| `ipc-devserver.js` | Dev server spawner + static HTTP server for preview |
| `ipc-wiki.js` | Wiki CRUD (`.pipilot/wikis/*.md`) |
| `ipc-codestral.js` | Codestral FIM API for inline completions |
| `ipc-checkpoints.js` | Workspace snapshots |
| `ipc-cloud.js` | Cloud provider integrations |
| `ipc-settings.js` | User settings persistence |
| `mcp-ide-tools.js` | Custom MCP tool implementations (diagnostics, search, screenshot, etc.) |
| `search-index.js` | BM25/TF-IDF semantic code search engine (ported from Vite) |

### Renderer Files (`renderer/`)
| File | Purpose |
|------|---------|
| `ipc.js` | Bus event system, global `$`/`$$`/`h` helpers, shared state |
| `app.js` | Main app orchestrator (project open/close, layout, shortcuts) |
| `ace-editor.js` | Ace editor setup, tabs, breadcrumbs, diagnostics markers, virtual tabs, diff tabs |
| `ace-ai.js` | Ghost text (FIM), hover peek, symbol hover, quick fix, inline chat, selection actions, outline |
| `chat.js` | Chat panel UI, tool pills, markdown rendering, session management, deep links |
| `chatdb.js` | IndexedDB for chat session storage |
| `sidebar.js` | File explorer, search panel, multi-select, lazy-load folders |
| `panels.js` | Git panel, outline panel, wiki panel, extensions, checkpoints, deploy |
| `titlebar.js` | Custom titlebar menus (File, Edit, View, Go, Run, Help), window controls, chat toggle |
| `statusbar.js` | Status bar (branch, problems, Ln/Col, encoding, language, terminal, preview) |
| `terminal.js` | xterm.js terminal with PTY, web links addon, localhost detection banner |
| `preview.js` | Preview panel (editor tab), dev server + static server, responsive modes, console |
| `dual-mode.js` | Split code+preview for HTML/MD/SVG files with resizable divider |
| `diagnostics.js` | Client-side diagnostics bridge (Ace worker → problems panel) |
| `problems.js` | Problems panel UI with search, filters, AI Fix button |
| `welcome.js` | Welcome screen logic (recent projects, generate dialog, walkthrough routing) |
| `welcome-tab.js` | Editor tab versions: Welcome, Getting Started, AI Power User, Docs, Shortcuts, About |
| `toast.js` | Toast notifications |
| `modals.js` | Modal dialogs (settings, clone repo, connectors) |
| `contextmenu.js` | Global right-click context menu system |
| `shortcuts.js` | Keyboard shortcut handler |

---

## What Was Built (Chronological)

### Editor Migration: Monaco → Ace
- Replaced Monaco editor with Ace Editor 1.32.7 (CDN)
- Custom `ace/theme/midnight` matching the IDE's dark design system
- `ace-editor.js` (900+ lines): tabs, breadcrumbs, file ops, virtual tabs, diff tabs
- `ace-ai.js` (1000+ lines): ghost text, hover peek, symbol hover, inline chat, context menu

### Chat Panel
- Full tool pill system matching Vite's ToolCallCard design
- Tool icons, labels, accent colors for all built-in + MCP tools
- Path sanitization and deep linking (clickable file paths in tool pills and markdown)
- Mermaid diagram rendering in markdown responses
- Table/image overflow handling (scroll containers, max 1024px)
- History reload with proper tool pill grouping and status resolution
- Message action buttons (copy, edit, revert, delete) on both live and history messages
- Session dropdown with rename/delete (show on hover)
- Right-click copy image in chat

### Agent SDK Integration
- Full Claude Agent SDK setup with `sdk.query()`
- **7 custom MCP tools** via `createSdkMcpServer` with Zod schemas:
  - `get_diagnostics` — TypeScript/JSON error checking
  - `project_context` — Framework, deps, entry points, file tree scan
  - `update_project_context` — Write `.pipilot/project.md`
  - `frontend_design_guide` — Read/scan/write `.pipilot/design.md`
  - `search_codebase` — Multi-mode: grep, files, symbols, semantic (BM25)
  - `screenshot_preview` — Headless Chrome screenshots with DOM analysis
  - `generate_image` — AI image generation via a0.dev API
- Sub-agents: fullstack-developer, ai-engineer, security-engineer, wiki-generator
- MCP servers: context7, deepwiki, sequential-thinking, user-configured
- Tool search enabled (`ENABLE_TOOL_SEARCH: 'auto'`)

### File Explorer
- Lazy-loaded heavy directories (node_modules, .git, dist, etc.)
- Multi-select: Ctrl+Click, Shift+Click, Ctrl+A
- Right-click context menu with multi-select actions
- ZIP export via archiver (with save dialog)
- Auto-reveal active file's parent folders

### Source Control (Git Panel)
- Full rewrite matching Vite's SourceControlPanel
- Branch dropdown, pull/push, more actions menu (18 items)
- Staged/Changes/History collapsible sections
- AI commit message generation via a0 LLM
- Unstage via `git reset HEAD`

### Preview Panel
- Opens as editor tab (not bottom panel)
- Dev server detection (`dev-server` vs `static` vs `none`)
- Built-in static HTTP server for HTML-only projects
- Responsive modes: Desktop, Tablet, Mobile (realistic iPhone frame with Dynamic Island)
- Console bar with server + runtime log capture
- URL bar for browsing any URL
- "Open HTML File" button
- Terminal localhost detection → "Open in Preview" banner

### Diagnostics & Problems
- TypeScript Compiler API (not tsc spawn) — matches Vite
- Ace built-in workers for JS/JSON/CSS (disabled for TS/HTML to avoid false positives)
- Client-side regex linting fallback
- Chokidar file watcher (replaced polling)
- Problems panel with search, severity filters, AI Fix button
- Hover peek on diagnostic squiggles (VSCode-style with action bar)

### Breadcrumbs
- VSCode-style `/ PATH` label + clickable segments
- Dropdown showing sibling files/folders at each depth
- Inline folder expansion with chevrons (recursive)
- Dot folders included

### Dual Mode Editor
- Split code + preview for HTML/MD/SVG files
- 3-mode toggle: Code Only, Split View, Preview Only (floating button group)
- Resizable divider (drag handle)
- Mermaid diagram rendering in markdown preview
- Ctrl+Shift+V keyboard shortcut

### Wiki System
- IPC handlers: tree, page, save, delete, scan
- Activity bar button + sidebar panel
- Wiki viewer as editor tab with dark theme + Mermaid rendering
- Wiki-generator sub-agent with detailed prompt
- "Generate Wiki" button sends to AI agent

### Welcome Screen
- Redesigned with ambient glow effects, two-column layout
- Titlebar with File/Help menus
- Start section: New File, Open Folder, Clone Repo, Generate with AI
- Recent projects with remove button (hover)
- Walkthrough cards: Getting Started, AI Power User, Documentation
- Editor tab versions of all walkthroughs + Docs + Shortcuts + About
- Generate with AI dialog: suggestion chips, file attach, a0 LLM folder naming

### Titlebar & Window Controls
- Frameless window on all platforms
- Custom minimize/maximize/close buttons
- Chat toggle in titlebar (left of window controls)
- All File/Edit/View/Go/Run/Help menus functional
- Auto Save toggle in File menu

### Other Features
- External links open in default browser (global interceptor + terminal WebLinksAddon)
- Tab right-click context menu (Close, Close Others, Close All, Close to Right, Copy Path)
- Word wrap enabled by default
- Ghost text accept/reject buttons (Tab/Esc badges)
- Faster ghost text on Enter/Space (50ms vs 180ms)
- Selection floating action bar (Add to Chat, Inline Chat, Enhance)
- Symbol outline panel in activity bar

---

## Known Issues / TODO
- The `focusChat` / `pipilot:focus-chat-input` event sometimes doesn't prefill the chat input (race condition with chat panel rendering)
- Dual-mode preview panel doesn't auto-update on Ace `change` event (only on `dirty-changed`)
- Wiki viewer's "Edit" button path resolution may fail on some OS path formats
- The preview mobile frame height might not perfectly fill the panel on all screen sizes
- `search_codebase` semantic mode needs the index to build first (cold start ~2-5s on large projects)
- Mermaid rendering requires CDN load — fails offline
- No undo/redo for chat message deletion

## Design System (CSS Variables)
```css
--bg: #16161a
--surface: #1c1c21
--surface-alt: #232329
--border: #2e2e35
--accent: #FF6B35
--text: #b0b0b8
--text-strong: #e7e7ea
--text-mid: #8a8a94
--text-dim: #6b6b76
--error: #e5484d
--warn: #e5a639
--ok: #56d364
--info: #58a6ff
--font-mono: 'Geist Mono', 'Cascadia Code', monospace
--font-sans: 'Segoe UI', system-ui, sans-serif
```

## How to Run
```bash
cd fiddle-pipilot-ide
npm start        # Production
npm run dev      # Dev mode (opens DevTools)
```

## Key Dependencies
- `electron` — Desktop shell
- `@anthropic-ai/claude-agent-sdk` — AI agent
- `node-pty` — Terminal PTY
- `simple-git` — Git operations
- `chokidar` — File watching
- `archiver` — ZIP creation
- `puppeteer-core` — Browser screenshots
- `zod` — Schema validation for MCP tools
- `ace` (CDN) — Code editor
- `marked` (CDN) — Markdown rendering
- `mermaid` (CDN) — Diagram rendering
- `xterm` (CDN) — Terminal UI
