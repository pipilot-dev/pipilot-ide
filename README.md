# PiPilot IDE

**A free AI-powered desktop IDE. Sign in with GitHub, get unlimited AI. No card, no plans, no usage caps.**

PiPilot is the AI coding environment Cursor and Copilot would be if they didn't need to make money on every keystroke. Same agent loop, same inline completions, same chat panel — powered by frontier models — but the only thing it asks of you is your GitHub identity.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/pipilot-dev/pipilot-ide/releases)
[![Built on Electron](https://img.shields.io/badge/built%20on-Electron%2032-47848F)](https://www.electronjs.org/)

---

## Why this exists

Every other AI IDE wants $20/month per seat. The actual model cost for normal usage is closer to $0.50. The rest is margin and venture capital. PiPilot gates AI features behind a free GitHub login (which gives us per-user metering and abuse protection), routes all calls through an edge proxy that holds a single shared upstream key, and ships everything else open source.

If you're a developer who codes a few hours a day, this should always be free for you. If we ever need to introduce paid plans for power users, we'll add tiers — we will not break the free baseline.

## Compared to the alternatives

|                        | PiPilot       | Cursor      | GitHub Copilot | Codeium    |
| ---------------------- | ------------- | ----------- | -------------- | ---------- |
| Price                  | **$0**        | $20/mo      | $10/mo         | $0–15/mo   |
| Open source client     | ✅ MIT        | ❌          | ❌             | ❌          |
| Frontier-model agent   | ✅            | ✅          | ⚠️ limited     | ⚠️ limited  |
| Inline completions     | ✅            | ✅          | ✅             | ✅          |
| Multi-agent / sub-agents | ✅           | ⚠️ partial  | ❌             | ❌          |
| Embedded browser the agent can drive | ✅ | ❌      | ❌             | ❌          |
| Built-in deploy hub    | ✅            | ❌          | ❌             | ❌          |
| Built-in extension marketplace | ✅    | ⚠️ VS Code  | ✅ VS Code     | ✅ VS Code  |

## Features

- **AI agent** — frontier-class model with a rich built-in tool surface (file ops, git, terminal, browser, deploy). Two modes (Agent / Plan), 5 reasoning effort levels, 8 specialised sub-agents.
- **Inline AI** — fast fill-in-the-middle ghost-text completions, `Ctrl+I` inline chat widget, right-click selection actions (Explain, Refactor, Fix, Add Docs).
- **Real Ace editor** — 120+ language modes, multi-cursor, find/replace, snippets, themes, fonts, customisable keybindings.
- **Embedded browser** — full Chromium tab; the agent can navigate, click, type, screenshot, and run JS in any page. Real DevTools attached.
- **Source control** — file-tree git decorations, inline blame, diff view, branches, stash, push/pull, GitHub PR creation.
- **Debugger** — Node debugging with breakpoints, conditional breakpoints, logpoints, exception breakpoints, launch.json with VS Code variable substitution.
- **Deploy hub** — one-click deploy to Vercel, Netlify, Cloudflare Pages, Cloudflare Workers, Railway, Render. Push to GitHub or GitLab. Env vars + custom domains + rollback per provider.
- **Terminal** — xterm.js + node-pty. Auto-detected shells. Mouse, hyperlinks, ANSI theme matching the IDE.
- **Project wiki** — auto-generates `.pipilot/wikis/` from your code; refreshes after meaningful agent turns.
- **Extensions** — bundled marketplace + 5 starter themes + 3 starter fonts. Build your own with a single `.js` file. Themes, fonts, and regular extensions all install from a public registry repo.
- **In-IDE Help** — full docs ship with the app; sidebar TOC + search.

[Full feature docs →](docs/README.md)

## Install

### Download a release

Grab the latest from [Releases](https://github.com/pipilot-dev/pipilot-ide/releases):

| OS      | Download |
| ------- | -------- |
| Windows | `PiPilot-Setup-x.y.z.exe` (Squirrel installer) |
| macOS   | `PiPilot-x.y.z-arm64.zip` (Apple Silicon — runs on Intel via Rosetta 2 too) |
| Linux   | `pipilot-ide_x.y.z_amd64.deb`, `pipilot-ide-x.y.z.x86_64.rpm`, or the portable `.zip` |

> ⚠️ **v0.1 binaries are unsigned.** Windows SmartScreen will warn ("More info → Run anyway"). macOS Gatekeeper will refuse the first launch — right-click → Open. Code signing is on the v0.2 roadmap.

### Or run from source

```bash
git clone https://github.com/pipilot-dev/pipilot-ide
cd pipilot-ide
npm install        # rebuilds node-pty for Electron's ABI
npm start
```

Requires Node.js 20+.

## First run

1. Open the IDE — the editor, file tree, terminal, git, and deploy hub all work immediately.
2. Click **Sign in** in the chat panel (or open Settings → Account).
3. Authorise PiPilot via GitHub Device Flow — takes 10 seconds.
4. Chat away. The agent has full read/write access to whatever folder you opened.

## Architecture (the short version)

```
Desktop client (Electron)              pipilot-proxy (edge)
┌──────────────────────────┐           ┌──────────────────────────────┐
│  Renderer (vanilla JS)   │           │  /auth/device/start          │
│  Main process (Node)     │ ───JWT──▶ │  /auth/device/poll           │
│  Agent runtime           │           │  /v1/messages   (gated)      │
│    proxy URL + JWT       │ ◀──SSE─── │     ↓ (managed credentials)  │
│                          │           │  Upstream model API          │
│                          │           │  Server-side metering        │
└──────────────────────────┘           └──────────────────────────────┘
```

- The desktop bundle holds **no** model-provider credentials. The proxy holds them as encrypted secrets.
- Auth is GitHub OAuth Device Flow — no client secret to leak, no callback URL to register.
- A per-turn usage record is written server-side so the free tier can stay generous and abuse can be cut off without affecting other users.

Self-hosting the proxy is supported — you can point your own PiPilot install at your own model provider if you want full control.

## Privacy

Short version: we collect your GitHub login, email, and per-turn token counts. We don't read your code or prompts. Sign-out wipes the local token. Full policy in [PRIVACY.md](PRIVACY.md).

## Contributing

Issues + PRs welcome. The codebase is intentionally low-magic — vanilla JS in the renderer, no bundler, no framework. Read [`docs/extension-api.md`](docs/extension-api.md) for the extension surface, or just open files and grep.

Big areas where help is most useful right now:
- TypeScript LSP integration (we use Ace; a real language server would be huge)
- Code signing automation (we'll happily accept the certs as a sponsorship)
- More themes + fonts in the marketplace

## License

MIT. See [LICENSE](LICENSE).

---

> Built with the Ace editor, node-pty, simple-git, and a lot of late nights.
