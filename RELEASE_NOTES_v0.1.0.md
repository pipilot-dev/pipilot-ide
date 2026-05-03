# PiPilot IDE v0.1.0 — first public release 🚀

PiPilot is a free AI-powered desktop IDE. Sign in with GitHub, get unlimited AI. No card, no plans, no usage caps.

This is the v0.1 launch. Expect bugs, expect rough edges, expect surprises. The auth + chat + agent + editor + deploy flows all work end-to-end on Windows, macOS, and Linux today.

## Why a new IDE

Cursor is $20/month. Copilot is $10/month. The actual model cost for normal usage is closer to fifty cents. The rest is margin. PiPilot ships an open-source client, routes every AI call through an edge proxy that holds a single shared upstream key, and gates the proxy behind a free GitHub login. As long as your usage looks like a developer's, this is free for you forever.

## Highlights

- **Frontier-class agent** with two modes (Agent / Plan), 5 reasoning effort levels, 8 specialised sub-agents, and a rich built-in tool surface (file ops, git, terminal, browser automation, deploy hub).
- **Inline AI** — fast fill-in-the-middle ghost-text completions, `Ctrl+I` inline chat widget with preset chips, right-click selection actions (Explain, Refactor, Fix, Add Docs).
- **GitHub OAuth Device Flow login** — 10 seconds, no password, no callback URL.
- **Embedded browser** the agent can drive (open URLs, click, type, screenshot, run JS).
- **Deploy hub** — one-click to Vercel, Netlify, Cloudflare Pages, Cloudflare Workers, Railway, Render. Push to GitHub or GitLab. Env vars + custom domains + rollback per provider.
- **Source control** — git decorations on the file tree, inline blame, diff view, branches, stash, push/pull.
- **Built-in Node debugger** — regular / conditional / logpoint breakpoints, exception breakpoints, launch.json with VS Code variable substitution.
- **Terminal** via `node-pty` + xterm.js with auto-detected shells and ANSI theme matching the IDE.
- **Auto-generated project wiki** at `.pipilot/wikis/`.
- **Extension marketplace** — themes, fonts, and regular extensions, all installable from a public GitHub registry.
- **Full in-IDE docs** — sidebar TOC, search, all 16 reference pages.

## Privacy

We collect your GitHub login + email + per-turn token counts. We don't read your code or prompts. Sign-out wipes your local data. Full policy: [PRIVACY.md](https://github.com/pipilot-dev/pipilot-ide/blob/main/PRIVACY.md).

## Install

| OS | Download |
|----|----------|
| Windows | `PiPilot-Setup-0.1.0.exe` (Squirrel installer) |
| macOS Apple Silicon | `PiPilot-0.1.0-arm64.zip` |
| macOS Intel | `PiPilot-0.1.0-x64.zip` |
| Debian/Ubuntu | `pipilot-ide_0.1.0_amd64.deb` |
| Fedora/RHEL | `pipilot-ide-0.1.0.x86_64.rpm` |
| Other Linux | `pipilot-ide-0.1.0-linux-x64.zip` |

> ⚠️ **Binaries are unsigned in v0.1.** Windows SmartScreen will warn ("More info → Run anyway"). macOS Gatekeeper will refuse first launch — right-click the app → Open. Code signing is on the v0.2 roadmap.

## Known issues

- **A few auxiliary integrations still ship bundled provider keys** (inline completions, voice input, supplementary cloud AI, preview API). Inline completions are auth-gated at the IPC layer (no login → no completions). The others aren't gated yet. Migrating them through the proxy is the v0.2 priority.
- **No auto-update.** Watch the Releases tab for new versions.
- **No Microsoft Store / Mac App Store** — both require code signing, deferred to v0.2.
- **TypeScript LSP not integrated yet** — falls back to Ace's word-based autocomplete. The agent's built-in diagnostics tool covers most "type-check this" needs.

## What's next (v0.2 roadmap)

- Move all remaining auxiliary integrations behind the proxy
- Code signing for Windows + macOS
- Auto-update via Squirrel + electron-updater
- TypeScript Language Server integration via `monaco-languageclient`
- Stripe-backed paid tiers (free tier stays free)
- Linux .AppImage packaging

## Feedback

Open issues at [github.com/pipilot-dev/pipilot-ide/issues](https://github.com/pipilot-dev/pipilot-ide/issues). The pinned **v0.1.0 Feedback** issue is a good place for early-day reports — bugs, ideas, "this thing was confusing." We read everything.

Thanks for trying it. 🙏
