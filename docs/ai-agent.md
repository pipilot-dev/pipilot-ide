# AI Agent

The chat panel on the right is a full agent loop powered by the Anthropic Claude SDK. It can read files, write code, run commands, browse the web, automate the embedded browser, debug, and deploy — anything the IDE itself can do.

## Two modes

Pick from the dropdown above the chat input:

- **Agent** — full autonomy. Runs commands, edits files, deploys. Use when you want the agent to do the work.
- **Plan** — read-only. Produces a step-by-step plan you can review, then flip the dropdown to Agent and the same conversation continues with execution.

Default mode is `Agent`. Change it in **Settings → AI → Default Agent Mode** so new chats start in your preferred mode.

## Reasoning effort

Next to the mode dropdown is a `none / low / medium / high / x-high` picker:

| Level   | When the agent reasons before acting | Use for |
|---------|---------------------------------------|---------|
| `none`  | Never — straight execution            | One-shot edits, "rename this var" |
| `low`   | On hard choices only                  | Most everyday tasks |
| `medium`| On complex problems (default)         | Multi-step tasks |
| `high`  | Before most non-trivial actions       | Architecture changes, debugging hard bugs |
| `x-high`| Deep structured reasoning every task  | Big refactors, security review |

Higher = more deliberate but slower + more expensive. Persisted to `localStorage` and to `settings.reasoningEffort` so it stays consistent.

## Sub-agents

Activity bar → **Extensions & MCP → Agents** lists 8 specialised sub-agents the main agent can delegate to:

- 🏗️ Fullstack Developer — DB + API + frontend
- 🤖 AI Engineer — LLM apps, RAG, prompt engineering
- 🔌 API Designer — REST/GraphQL, OpenAPI, auth
- 🛡️ Security Engineer — OWASP, DevSecOps
- 🎨 Frontend Designer — distinctive UI with persistent design system
- 📖 Wiki Generator — scans the codebase, writes docs
- 📥 Agent Installer — browse + install from VoltAgent registry
- 🧩 MCP Installer — search + install MCP servers

Click "Use" on any card to seed your input with `Use the <name> sub-agent to ` — finish the sentence and send.

## MCP tools (`mcp__pipilot__*`)

The agent has ~50 PiPilot-namespaced tools that drive the IDE itself. Categories:

- **IDE basics** — `get_working_directory`, `search_codebase`, `get_diagnostics`, `project_memory`, `project_context`.
- **Frontend design** — `frontend_design_guide` (scan/load/write design system), `generate_image` (AI image generation, never placeholders).
- **Code execution** — `run_code` (60+ languages via OneCompiler), `edit_file_patch`, `fetch_url`.
- **Reasoning** — `reason` for structured private thinking phases.
- **Embedded browser** — `browser_open`, `browser_navigate`, `browser_observe` (screenshot + DOM snapshot), `browser_click_ref`, `browser_type`, `browser_press_key`, `browser_eval`, `browser_get_text`, `browser_get_html`, etc. Full list in [Embedded Browser](embedded-browser.md).

Tools are loaded on-demand via Anthropic's ToolSearch mechanism (`ENABLE_TOOL_SEARCH: 'auto'`) so the context window doesn't bloat with definitions you're not using.

## Custom MCP servers

Activity bar → **Extensions & MCP → MCP Servers** has a list of built-in servers (PiPilot, Context7, AppDeploy, DeepWiki, Sequential Thinking, Chrome DevTools, Playwright) and a **+ Add MCP Server** button for your own:

- **Stdio** — local CLI binary (`mcp-server-foo --port 9999` style).
- **HTTP** — remote MCP server URL with optional auth headers.

Tokens are encrypted via Electron's `safeStorage` (OS keychain on macOS/Windows, base64 fallback elsewhere).

## Background mode

Agent runs continue when you minimise the IDE — Electron's `powerSaveBlocker` is held while a stream is active so your laptop doesn't sleep mid-deploy. On suspend / lock, the agent pauses gracefully and resumes on wake.

## Sessions + history

Every conversation is a session, stored in IndexedDB (`chatdb.js`). Switch between sessions via the dropdown above the input ("New Chat ▾"). Sessions persist forever — clear individually or all at once.

The `.pipilot/_pipilot_history.json` file at the project root mirrors the most recent activity so the agent can refer back to "what we worked on yesterday" without scrolling chat history.

## Attribution

When the agent produces text for a **GitHub surface** — commit message, PR description, PR review, issue body, PR comment — it appends:

```
Co-Authored-By: PiPilot <agent@pipilot.dev>
```

Never on chat replies, code, or docs — only on text destined for github.com. This is enforced by the system prompt's branding rule.

## API keys

By default the IDE ships with bundled Anthropic credentials so it works out of the box. To use your own key, set `ANTHROPIC_API_KEY` in the project's `.env` file (or globally). The agent reads from `process.env` — same pattern as anthropic-sdk-py.

## Stopping a runaway agent

- Click **Stop** in the chat input area.
- Or press `Esc` while the input is focused.
- Hard stop: kill the IDE; the agent has no persistence outside the in-flight request.

The chat session itself isn't destroyed — your prompt + the partial response stay in the history.
