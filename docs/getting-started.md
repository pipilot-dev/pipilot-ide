# Getting Started

Five minutes from clone to your first AI-assisted commit.

## Install

PiPilot is an Electron desktop app. Two paths:

**Pre-built release** (recommended):
1. Download the installer for your OS from the [Releases](https://github.com/pipilot-dev/pipilot-ide/releases) page.
2. Run it. On macOS you may need to right-click → Open the first time (unsigned dev build).

**From source** (for contributors):
```bash
git clone https://github.com/pipilot-dev/pipilot-ide.git
cd pipilot-ide
npm install            # postinstall also bundles the 9 starter fonts
npm start
```

> **Note:** This project uses **npm**, not pnpm — the Electron build scripts (`electron-rebuild`, `electron-forge`) are wired against npm.

## First launch — the welcome tab

You'll land on a Welcome tab with three columns:

- **Start** — New File / Open Folder / Clone Git Repository / **Generate New Project with AI**.
- **Recent** — past projects, click to reopen.
- **Walkthroughs** — interactive tours for Getting Started and AI Power Features.

Pick **Open Folder** and point at any project directory. The IDE remembers it and restores your tabs / cursor position next time.

## The layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Title bar                                              ─  □  ×    │
├──┬──────────┬─────────────────────────────────────┬──────────────┤
│  │          │                                     │              │
│  │ Sidebar  │  Editor (tabs above, breadcrumb     │  Chat panel  │
│ A│ (file    │   below, status in gutter)          │  (AI agent)  │
│ c│  tree,   │                                     │              │
│ t│  search, │                                     │              │
│ i│  source  │                                     │              │
│ v│  control,│                                     │              │
│ i│  outline,│                                     │              │
│ t│  ext.,   │                                     │              │
│ y│  deploy, │                                     │              │
│  │  wiki,   │                                     │              │
│  │  agents) │                                     │              │
│  ├──────────┴─────────────────────────────────────┤              │
│  │ Bottom panel (Terminal · Problems · Preview ·  │              │
│  │  Deploy · Debug)                               │              │
├──┴────────────────────────────────────────────────┴──────────────┤
│ Status bar                                                       │
└──────────────────────────────────────────────────────────────────┘
```

The activity bar (left edge) switches the sidebar contents. Drag any divider to resize. `Ctrl+B` collapses the sidebar; `Ctrl+J` collapses the bottom panel.

## Your first AI prompt

1. Type a prompt into the chat panel on the right.
2. Hit Enter. The agent picks up tools as needed: reading files, running searches, writing code, opening the embedded browser.
3. Watch the chain-of-thought stream above each tool call. Stop at any point with `Esc` or the Stop button.

Two modes via the dropdown above the input:
- **Agent** — full autonomy: reads, writes, runs commands, deploys.
- **Plan** — read-only: produces a step-by-step plan you can review before flipping to Agent.

Reasoning effort (next to mode): `none / low / medium / high / x-high`. Higher = more deliberate thinking before acting. Defaults to `medium`.

## First commit, first push

1. Make a change in any file. The status bar shows `1 unstaged`.
2. Activity bar → **Source Control** (the branch icon). You'll see your changes with VS Code-style decorations (`M` modified, `A` added, `D` deleted) in the file tree too.
3. Stage with the `+` next to a file, type a commit message, hit `Ctrl+Enter` to commit.
4. To get this on GitHub: activity bar → **Deploy** → **🚀 Open Deploy Hub** → Connect GitHub (paste a token from `github.com/settings/tokens`) → **↗ Push project**. One dialog handles repo creation + remote + push.

Full source-control walkthrough: [Source Control](source-control.md).
Full deploy walkthrough: [Deploy Hub](deploy-hub.md).

## Pick a theme + font

Settings (cog icon in activity bar, or `Ctrl+,`) opens as a virtual tab. Under **General**:

- **Color Theme** — 6 built-ins (Midnight, Carbon, Dracula, GitHub Dark, Solarized Dark/Light) + any installed via the marketplace. Live-applies the entire IDE in one repaint.
- **Font Family** — 10 bundled fonts (JetBrains Mono, Fira Code, Cascadia Code, IBM Plex Mono, Source Code Pro, Roboto Mono, Inconsolata, Space Mono, Ubuntu Mono, DM Mono). Each option previews in its own font.
- **Programming Ligatures** — toggle for `=>` `!=` `===` ligatures in compatible fonts.

More themes / fonts: activity bar → **Extensions & MCP** → search "themes" or "fonts".

## Where to go next

- [AI Agent](ai-agent.md) — modes, tools, sub-agents, MCP servers.
- [Editor](editor.md) — settings reference, multi-cursor, find/replace, snippets.
- [Debugging](debugging.md) — breakpoints, launch.json, conditional + logpoints.
- [Embedded Browser](embedded-browser.md) — automate any site with the agent.
- [Keyboard Shortcuts](keyboard-shortcuts.md) — full list.
