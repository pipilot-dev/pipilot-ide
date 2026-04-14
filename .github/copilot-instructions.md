# PiPilot IDE Project Guidelines

## Build and Test
- Install dependencies with `pnpm install` (lockfile is `pnpm-lock.yaml`).
- Start full local dev (client + server): `pnpm dev`.
- Start only client: `pnpm dev:client`.
- Start only server: `pnpm dev:server`.
- Build production client bundle: `pnpm build`.
- Run TypeScript checks before finishing significant edits: `pnpm typecheck`.
- E2E tests use Playwright in `tests/` (see `playwright.config.ts` for settings).

## Architecture
- Frontend is React + Vite in `src/`; backend is Express in `server/`.
- Core frontend boundaries:
  - `src/components/ide/` for IDE shell panels and editors.
  - `src/components/chat/` for chat UI and tool-call rendering.
  - `src/contexts/` for global app state providers.
  - `src/hooks/` for feature behavior and side effects.
  - `src/lib/` for shared runtime utilities (DB, git, preview, tokens).
- Backend boundaries:
  - `server/index.ts` is the main API/SSE entry.
  - `server/diagnostics.ts`, `server/git.ts`, `server/dev-server.ts`, `server/checkpoints.ts`, and `server/workspaces.ts` own their domains.

## Conventions
- Keep changes scoped to the existing module boundaries above; avoid cross-cutting refactors unless requested.
- Prefer path aliases already configured in TS/Vite (`@/*`, `@assets/*`) over deep relative imports.
- Preserve ESM style (`"type": "module"`) and existing TypeScript strictness.
- For UI work, follow tokens and typography from `src/lib/design-tokens.ts` and guidance in `DESIGN_SYSTEM.md`; avoid ad-hoc colors/fonts.
- For agent/tooling flows, preserve SSE tool-call loop behavior documented in `ARCHITECTURE.md`.
- Avoid editing generated/runtime artifact areas unless task explicitly targets them: `test-results/`, `.pipilot-data/`, and nested project content under `workspaces/`.

## Pitfalls
- Dev requires both ports `5173` (Vite) and `3001` (Express); check conflicts first.
- This project uses both browser-side storage and server APIs; when changing file/chat flows, verify both frontend state and server route behavior.
- Linked workspaces and checkpoint state are project-sensitive; do not assume globally shared session context.

## Reference Docs (Link, Don’t Embed)
- Architecture and tool execution flow: `ARCHITECTURE.md`
- File/tool API expectations: `SPEC.md`
- UI visual language and motion rules: `DESIGN_SYSTEM.md`
- Additional UI behavior guidelines: `SKILL.md`
- Build/proxy settings: `vite.config.ts`
- Test setup and base URL: `playwright.config.ts`
