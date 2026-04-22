# PiPilot IDE — Electron Desktop App Plan

## Overview
Build PiPilot IDE as a native Electron desktop app using pure HTML/CSS/JS (no React, no Vite, no bundler). All server logic runs directly in the Electron main process via IPC. The frontend communicates exclusively through `window.electronAPI`.

## Design System — "Midnight Studio"
```
Colors:
  bg:          #16161a    (page background — near-black with warmth)
  surface:     #1c1c21    (panels — sidebar, chat, modals)
  surfaceAlt:  #232329    (sub-surfaces — input bg, hover wells, cards)
  border:      #2e2e35    (hairline dividers)
  borderHover: #44444d    (hovered/focused border)
  text:        #b0b0b8    (primary — muted, easy on the eyes)
  textMid:     #8a8a94    (secondary)
  textDim:     #6b6b76    (tertiary — labels, timestamps)
  textFaint:   #42424a    (separators, disabled)
  accent:      #FF6B35    (primary orange)
  accentHover: #FF5722    (hover state)
  accentLight: #FF8C61    (light variant)
  warn:        #e5a639    (amber)
  error:       #e5534b    (soft red)
  ok:          #56d364    (green)
  info:        #6cb6ff    (calm blue)

Fonts:
  display/sans: "DM Sans", -apple-system, sans-serif
  mono:         "Geist Mono", "Cascadia Code", "JetBrains Mono", monospace
```

## Architecture
```
fiddle-pipilot-ide/
├── main.js              # Electron main process — IPC handlers, app lifecycle
├── preload.js           # Context bridge — expose IPC to renderer
├── index.html           # Single HTML page — the entire IDE UI
├── styles/
│   ├── tokens.css       # CSS custom properties from design tokens
│   ├── layout.css       # IDE layout grid (sidebar, editor, panels)
│   ├── components.css   # Buttons, inputs, tabs, modals, context menus
│   └── editor.css       # Monaco/code editor specific styles
├── renderer/
│   ├── app.js           # App initialization, state management
│   ├── sidebar.js       # File explorer, search, git, extensions panels
│   ├── editor.js        # Monaco editor integration (loaded from CDN/npm)
│   ├── terminal.js      # xterm.js terminal (IPC to node-pty in main)
│   ├── chat.js          # AI chat panel — agent streaming via IPC
│   ├── statusbar.js     # Bottom status bar
│   ├── titlebar.js      # Top title bar with project switcher
│   ├── modals.js        # Folder picker, clone repo, settings
│   └── ipc.js           # IPC API wrapper (apiGet, apiPost, apiStream)
├── package.json
└── forge.config.js      # Electron Forge packaging config
```

## Pages & Screens

### 1. Welcome Screen (no project open)
- PiPilot logo + title
- "Open Folder" button → native dialog OR folder picker
- "Clone Repo" button → git clone modal
- "Generate with AI" button → opens AI chat with generate prompt
- Recent projects list (from localStorage/IPC)
- "Get Started" / "AI Power User" tutorial cards

### 2. Main IDE Layout (project open)
```
┌─────────────────────────────────────────────────────────┐
│  Title Bar: [logo] [project name ▼] [File Edit View ...] │
├────┬────────────────────────────┬───────────────────────┤
│    │                            │                       │
│ A  │       Editor Area          │    Chat Panel          │
│ c  │  ┌─────────────────────┐  │  ┌───────────────┐    │
│ t  │  │   Monaco Editor     │  │  │ Agent messages│    │
│ i  │  │   (tabs at top)     │  │  │               │    │
│ v  │  │                     │  │  │               │    │
│ i  │  │                     │  │  ├───────────────┤    │
│ t  │  └─────────────────────┘  │  │ Compose box   │    │
│ y  │  ┌─────────────────────┐  │  └───────────────┘    │
│    │  │ Terminal / Problems  │  │                       │
│ B  │  │ Preview / Deploy     │  │                       │
│ a  │  └─────────────────────┘  │                       │
│ r  │                            │                       │
├────┴────────────────────────────┴───────────────────────┤
│  Status Bar: [git branch] [problems] [terminal] [online] │
└─────────────────────────────────────────────────────────┘
```

### 3. Activity Bar (left edge, 36px wide)
Icons (top to bottom):
- Explorer (files tree)
- Search (project-wide search)
- Git (source control)
- Extensions (MCP servers, connectors)
- Checkpoints (AI snapshots)
- Deploy (deployment panel)
- Chat (toggle chat panel)
- Settings (gear icon, bottom)

### 4. File Explorer Panel
- Project name + LINKED badge
- "filter files..." search box
- File tree with expand/collapse
- File/folder icons by extension
- Right-click context menu (rename, delete, new file/folder)
- Drag & drop reorder

### 5. Editor Area
- Tab bar with open files (closeable, draggable)
- Monaco Editor (loaded via npm/CDN)
- Breadcrumb path above editor
- Inline AI chat (Ctrl+I)
- Split view support

### 6. Chat Panel (right side)
- Conversation selector (dropdown)
- Agent mode badge (Agent / Plan)
- Message list:
  - User messages (right-aligned)
  - Agent messages (left, with markdown rendering)
  - Tool call cards (collapsible)
  - Sub-agent cards (grouped)
  - Error messages (red)
- Compose box:
  - Text input with @ mentions
  - Attach files button
  - Upload button
  - Send button (orange)

### 7. Terminal Panel (bottom)
- Tab bar: Terminal | Problems | Preview | Deploy
- xterm.js terminal with node-pty via IPC
- Multiple terminal sessions
- Shell profile selector

### 8. Modals
- Folder Picker (browse filesystem)
- Clone Repo (git URL input + progress)
- Settings (font size, theme, cursor style)
- Onboarding walkthrough

## Features & IPC Endpoints

### File System (IPC)
- `GET /api/files/tree` — recursive file tree
- `GET /api/files/read` — read file content
- `POST /api/files/write` — save file
- `POST /api/files/mkdir` — create folder
- `DELETE /api/files` — delete file/folder
- `POST /api/files/rename` — rename/move
- `STREAM /api/files/watch` — live file tree updates
- `GET /api/fs/home` — home dirs for folder picker
- `GET /api/fs/list` — list subdirectories

### Terminal (IPC → node-pty in main process)
- `POST /api/terminal/create` — spawn PTY
- `POST /api/terminal/write` — send input
- `POST /api/terminal/resize` — resize
- `POST /api/terminal/destroy` — kill
- `STREAM /api/terminal/stream` — output stream
- `GET /api/terminal/profiles` — available shells

### AI Agent (IPC → Claude Agent SDK in main process)
- `POST /api/agent` (stream) — send message, stream response
- `POST /api/agent/stop` — abort running agent
- `POST /api/agent/answer` — human-in-the-loop response
- `GET /api/agent/replay` — reconnect to active session

### Git (IPC)
- Full git operations: status, diff, add, commit, push, pull, branch, clone, stash, etc.

### Cloud (IPC)
- GitHub, Vercel, Netlify, Cloudflare, Supabase, npm integrations

### Checkpoints (IPC)
- Create/restore/list zip-based snapshots

### Dev Server (IPC)
- Start/stop/status + log streaming

## Implementation Phases

### Phase 1: Shell & Layout
- index.html with CSS grid layout
- Title bar, activity bar, status bar
- Panel switching (explorer, search, git, etc.)
- Resizable panels (drag dividers)

### Phase 2: File Explorer + Editor
- File tree rendering from IPC data
- Monaco editor integration
- Tab management (open/close/switch)
- File read/write via IPC

### Phase 3: Terminal
- xterm.js + IPC to node-pty
- Multiple sessions, shell profiles
- Scrollback, theming

### Phase 4: AI Chat
- Message rendering (markdown, code blocks)
- Agent streaming via IPC
- Tool call display
- Compose box with attachments

### Phase 5: Git + Extensions
- Git status panel
- Commit/push/pull UI
- MCP server management
- Connector token management

### Phase 6: Polish
- Keyboard shortcuts
- Context menus
- Onboarding flow
- Auto-updater
- Packaging & distribution
