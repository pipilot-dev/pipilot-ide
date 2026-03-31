# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── ai-ide/             # AI-powered web IDE (React + Vite)
│   ├── api-server/         # Express API server
│   └── mockup-sandbox/     # Design sandbox
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Artifacts

### `artifacts/ai-ide` — AI IDE (React + Vite, served at `/`)

A full VSCode-inspired web IDE with:
- Activity bar (Explorer, Search, Source Control, Debug, Extensions icons)
- Resizable sidebar with file tree explorer
- Monaco Editor (same engine as VSCode) for code editing with syntax highlighting
- Resizable AI chat panel (right side) mimicking GitHub Copilot Chat
  - Chat mode: single-turn SSE streaming
  - Agent mode: multi-step `multistep: true` SSE streaming
  - Powered by `POST https://the3rdacademy.com/api/chat/completions`
- In-memory sample TypeScript/React project files
- VSCode dark theme
- Keyboard shortcut Ctrl+Shift+I to toggle chat panel
- Status bar with git branch, problems count, connectivity

Key files:
- `src/components/ide/IDELayout.tsx` — root layout
- `src/components/ide/ActivityBar.tsx` — left icon bar
- `src/components/ide/SidebarPanel.tsx` — explorer/search/etc panel
- `src/components/ide/EditorArea.tsx` — Monaco editor + tabs
- `src/components/chat/ChatPanel.tsx` — AI chat side panel
- `src/components/chat/ChatMessage.tsx` — markdown message renderer
- `src/hooks/useChat.ts` — streaming chat API hook
- `src/hooks/useResizable.ts` — drag-to-resize hooks
- `src/data/sampleFiles.ts` — in-memory file tree

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec + Orval codegen config. Run: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` / `lib/api-client-react`

Generated Zod schemas and React Query hooks from the OpenAPI spec.
