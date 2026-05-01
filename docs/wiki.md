# Wiki

Auto-generated project documentation that updates whenever the agent finishes a meaningful change. Activity bar → 📖 **Wiki**.

## What it is

A per-project markdown wiki stored under `.pipilot/wikis/<page-id>.md`. The Wiki Generator sub-agent (in **Extensions → Agents**) populates it on demand, and the auto-update system keeps it fresh:

- After every agent turn that wrote source files (not lockfiles, not config, not the wiki itself), a debounced job kicks off the wiki updater.
- The updater scans changed files, picks the wiki pages that should be touched (overview / architecture / per-feature pages), and rewrites them.
- Cooldown defaults to 5 minutes — same project gets at most one wiki refresh per cooldown window.

## Settings

**Settings → AI**:

- **Auto-Update Wiki** — toggle the auto-refresh entirely. Default on.
- **Wiki Cooldown (minutes)** — how often to refresh at most. Default 5. Range 1–240.

When off, you can still trigger updates manually via the wiki sidebar's ↻ Refresh button or by asking the agent: "update the wiki".

## Sidebar layout

- **Tree** at the top — wiki pages, nested by directory.
- **Search** — fuzzy match across page titles + content.
- **+** — create a blank page.
- **↻** — manually trigger a wiki refresh.

Click any page → opens it in a virtual editor tab. Tab is read-only by default; click the pencil icon to edit, save with `Ctrl+S`.

## Page structure

Pages are plain Markdown with optional frontmatter:

```markdown
---
id: architecture
title: Architecture Overview
generated: 2026-05-01T16:00:00Z
generator: wiki-generator
---

# Architecture Overview

The IDE follows the standard Electron three-process model…
```

The frontmatter is informational — it's used by the auto-updater to track what was generated when, and to merge updates without losing your manual edits. Edits between `<!-- pipilot:keep -->` markers are preserved across regenerations.

## Storage on disk

Everything under `.pipilot/wikis/` in your project:

```
.pipilot/wikis/
├── README.md                    ← always exists; auto-generated overview
├── architecture.md              ← system design
├── features/
│   ├── deploy-hub.md
│   └── ai-agent.md
└── api/
    └── extension-api.md
```

The directory is auto-`.gitignore`'d if you don't want it in version control — but committing it is fine and gives you docs that travel with the repo. Toggle in **Settings → Features → Auto-Update Wiki** to opt out entirely.

## When auto-update runs

The auto-updater fires on `agent:turn-complete` events when:

1. Auto-Update Wiki is enabled (Settings).
2. The just-finished turn called any file-mutating tool (`Write`, `Edit`, `MultiEdit`, `edit_file_patch`).
3. The mutated files include source code (not `package-lock.json`, `.gitignore`, lockfiles, or `.pipilot/wikis/*` itself).
4. The cooldown window has elapsed since the last update.

## Internals

- `main/ipc-wiki.js` exposes `wiki:tree / page / save / delete / scan`.
- `renderer/wiki-auto-update.js` listens to bus events and runs the debounced updater.
- The Wiki Generator sub-agent uses the same `mcp__pipilot__*` tools the main agent has — searches the codebase, reads files, writes markdown.
- Pages are diffed before save so the file timestamp doesn't change if content is identical (avoids triggering watchers).

## Tips

- Run the **Wiki Generator** agent manually from **Extensions → Agents → Use** to seed a brand-new wiki.
- The wiki is a great target for the chat agent: "summarise the new deploy hub for the wiki" → it'll write `wikis/features/deploy-hub.md` directly.
- Wiki pages are searchable from the sidebar's search box; results show file path + matching line.
- For projects with sensitive secrets, double-check your wiki content before committing — the generator reads source code and could include API keys mentioned in comments. Use `<!-- pipilot:redact -->` markers to scrub specific blocks.
