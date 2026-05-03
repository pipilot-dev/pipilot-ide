# Changelog

All notable changes to PiPilot IDE. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [0.1.0] — 2026-05-03

First public release.

### AI

- Frontier-class agent runtime with a rich built-in tool surface (file ops, git, terminal, browser automation, deploy).
- Two modes (Agent / Plan), 5 reasoning effort levels (none → x-high), 8 specialised sub-agents.
- Fast fill-in-the-middle ghost-text inline completions.
- `Ctrl+I` inline chat widget with preset chips (Fix, Refactor, Explain, Add Comments, Add Docs).
- Right-click selection actions in the editor.
- Eight prompt-scaffold slash commands (`/build`, `/design`, `/fix`, `/refactor`, `/explain`, `/deploy`, `/search`, `/tree`).
- Six action slash commands (`/clear`, `/new`, `/help`, `/effort <level>`, `/mode <mode>`, `/file <path>`).

### Auth

- GitHub OAuth Device Flow login (no client secret needed for desktop apps).
- JWT issued by `pipilot-proxy`; encrypted via Electron `safeStorage` and persisted to `<userData>/auth-token.bin`.
- Editor, file tree, terminal, git, and deploy hub remain usable without login — only AI features are gated.
- Account section in Settings with GitHub avatar, login, email, plan badge, and Sign Out.

### Editor

- Ace 1.32.7 with ~120 language modes, multi-cursor, find/replace, snippets.
- Per-tab cursor + scroll restoration across project reopens.
- Six built-in themes + 5 marketplace starter themes.
- Nine bundled fonts (JetBrains Mono, Fira Code, Cascadia Code, etc.) + 3 marketplace fonts (Geist Mono, Comic Mono, Monaspace Neon).
- Programming-ligature toggle.
- Image / video / audio / PDF preview as virtual tabs.

### Workflow

- Source control panel (file-tree decorations, inline blame, diff view, branches, stash, push/pull).
- Built-in Node debugger (regular / conditional / logpoint breakpoints, exception breakpoints, launch.json with VS Code variable substitution).
- Deploy hub: GitHub + GitLab one-click push, plus 6 cloud providers (Vercel, Netlify, Cloudflare Pages, Cloudflare Workers, Railway, Render) with per-provider history, rollback, env vars, and custom domains.
- Embedded Chromium browser tab the agent can drive (navigate, click, type, screenshot, evaluate JS).
- Terminal via `node-pty` + xterm.js with auto-detected shell profiles, ANSI theme matching the IDE.
- Auto-generated project wiki at `.pipilot/wikis/`, refreshed after meaningful agent turns.

### Extensions

- Bundled marketplace pulling from `github.com/pipilot-dev/pipilot-extensions`.
- Three categories: Regular extensions, Themes, Fonts — same install / enable / uninstall mechanics.
- Public `PiPilot.editor` / `PiPilot.chat` / `PiPilot.sidebar` / etc. APIs documented in [`docs/extension-api.md`](docs/extension-api.md).
- Per-extension scoped IndexedDB storage.

### Documentation

- Full Tier-2 docs (16 markdown pages) under `docs/`.
- In-IDE Help tab with sidebar TOC + search; lazy-loads `marked` from CDN.
- GitHub-style heading anchors so `[x](page.md#section)` links scroll to the right place.
- External links route through the embedded browser instead of hijacking the renderer.

### Infrastructure

- GitHub Actions workflow (`.github/workflows/build-release.yml`) builds Windows + macOS arm64 + macOS x64 + Linux artifacts and drafts a release on `v*` tag push.
- electron-forge handles packaging (Squirrel installer, ZIP, .deb, .rpm).
- Native `node-pty` rebuilt per-platform via `electron-rebuild` postinstall.

### Known issues / not in this release

- Binaries are unsigned. Windows SmartScreen + macOS Gatekeeper will warn on first launch.
- No auto-update — users grab new releases from GitHub manually.
- A few auxiliary integrations (inline completions, voice input, supplementary cloud AI, preview API) still ship bundled provider keys. Inline completions are auth-gated at the IPC layer (no login → no completions). The others aren't gated yet. Migration to the proxy is on the v0.2 roadmap.
- No Microsoft Store / Mac App Store distribution (requires signing).
- TypeScript LSP integration not yet present — falls back to Ace's word-based autocomplete + the AI agent's built-in diagnostics tool.
