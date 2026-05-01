# PiPilot IDE

An AI-native development environment that thinks alongside you. Built on Electron, designed around real workflows: write code with an embedded AI agent, push to GitHub in one click, deploy to Vercel/Netlify/Cloudflare/Railway/Render without leaving the editor, debug Node and embedded-browser code with breakpoints, and ship.

## What's inside

- **AI Agent** — chat panel with sub-agents, MCP tools, structured reasoning. Agent and Plan modes.
- **Code editor** — Ace-based, 6 built-in themes, 10 bundled coding fonts, ligature support, font picker that previews each option in its own font.
- **Source control** — full git integration with VS Code-style decorations, inline blame, GitHub-style commit cards.
- **Embedded Chromium browser** — open any site, screenshot, automate with the agent, debug pages.
- **Debugger** — Node-CDP based. Breakpoints, conditional, logpoints, exception pause, `.vscode/launch.json` reader.
- **Deploy Hub** — push to GitHub/GitLab in one click; deploy to Vercel/Netlify/Cloudflare Pages/Cloudflare Workers/Railway/Render with rollback, env vars, custom domains, build hooks, history.
- **Extensions** — themes, fonts, regular extensions; install from the bundled marketplace, persists across reloads via `localStorage` cache.
- **Wiki** — auto-generated project docs that update after the agent finishes meaningful changes.
- **Settings** — theme, fonts (with ligatures), tab size, word wrap, terminal profile, agent defaults, all live-reactive.

## Quick links

- New here? Read [Getting Started](getting-started.md).
- Looking for a shortcut? [Keyboard Shortcuts](keyboard-shortcuts.md).
- Picking a theme or font? [Themes](themes.md) · [Fonts](fonts.md).
- Shipping code? [Deploy Hub](deploy-hub.md) is end-to-end.
- Building an extension? [Extensions](extensions.md) · [Extension API](extension-api.md).
- Need every config knob? [Settings Reference](settings-reference.md).

## Where the docs live

Inside the app: **Help → Docs** (or any `📚` link in the welcome tab) opens this same set of pages in a virtual editor tab with sidebar navigation + search.

On GitHub: every `.md` file under [`docs/`](https://github.com/pipilot-dev/pipilot-ide/tree/main/docs) is the canonical source — edits there flow into both surfaces.
