// Load .env first — all Agent SDK config comes from environment variables
import "dotenv/config";

import express from "express";
import cors from "cors";
import { query, unstable_v2_createSession, unstable_v2_resumeSession, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import chokidar from "chokidar";
import { startDevServer, stopDevServer, getDevServerStatus, stopAllDevServers, subscribeToLogs } from "./dev-server";
import * as pty from "node-pty";
import * as gitOps from "./git";
import { runAllChecks, runTypeScriptCheck } from "./diagnostics";
import { seedMissingConfigs, detectFramework } from "./seed-config";
import {
  initWorkspaces, resolveWorkspaceDir, linkFolder, unlinkFolder,
  listLinked, touchLinked, isLinked, getLinked,
} from "./workspaces";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3001;
// Workspaces live in the project root, not in temp
const WORKSPACE_BASE = path.join(process.cwd(), "workspaces");

// Initialize the linked-workspaces registry (Open Folder feature)
initWorkspaces({ workspaceBase: WORKSPACE_BASE });

/**
 * Resolve a projectId to its absolute working directory.
 * If the project is a linked folder, returns the linked path; otherwise
 * returns WORKSPACE_BASE/projectId. Use this everywhere instead of
 * getWorkDir(projectId).
 */
function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

// ── Persistent V2 sessions — one per project, reused across messages ──
const activeSessions = new Map<string, { session: any; sessionId: string }>();

// ── Pending user input requests (for canUseTool → AskUserQuestion flow) ──
const pendingInputRequests = new Map<string, {
  resolve: (answer: any) => void;
  question: any;
}>();

// ── Message queue — queue messages when agent is busy ──
const messageQueues = new Map<string, string[]>();
const activeRequests = new Set<string>(); // projects with running agent

// ── SSE event buffer per project — for replay on reconnect ──
interface BufferedStream {
  events: any[];
  isActive: boolean;
  lastActivity: number;
}
const streamBuffers = new Map<string, BufferedStream>();

// Ensure workspace base exists
if (!fs.existsSync(WORKSPACE_BASE)) {
  fs.mkdirSync(WORKSPACE_BASE, { recursive: true });
}

// Helper: create workspace from files
function createWorkspace(sessionId: string, files: { path: string; content: string }[]): string {
  const workDir = path.join(WORKSPACE_BASE, sessionId);

  // Clean up if exists
  if (fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  fs.mkdirSync(workDir, { recursive: true });

  // Write all files
  for (const file of files) {
    const filePath = path.join(workDir, file.path);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, file.content, "utf8");
  }

  return workDir;
}

// Helper: read all files from workspace
function readWorkspaceFiles(workDir: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];

  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip node_modules, .git, etc.
      // Skip node_modules and dot folders (except dist, build, .env files)
      if (entry.name === "node_modules") continue;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue; // .git, .next, .cache, .claude, etc.
      if (entry.name === ".claude_history.json" || entry.name === "CLAUDE.md") continue;

      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          results.push({ path: relativePath, content });
        } catch {
          // Skip binary files
        }
      }
    }
  }

  walk(workDir, "");
  return results;
}

// SSE helper
// Track which project is currently streaming for buffering
let currentStreamProjectId: string | null = null;

function sendSSE(res: express.Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
  // Buffer the event for replay on reconnect
  if (currentStreamProjectId) {
    const buf = streamBuffers.get(currentStreamProjectId);
    if (buf) {
      buf.events.push(data);
      buf.lastActivity = Date.now();
      // Cap buffer at 500 events to prevent memory bloat
      if (buf.events.length > 500) buf.events.shift();
    }
  }
}

// GET /api/agent/replay — replay buffered events (MUST be before /api/agent POST)
app.get("/api/agent/replay", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const buf = streamBuffers.get(projectId);
  if (!buf || buf.events.length === 0) {
    return res.json({ events: [], isActive: false, shouldContinue: false });
  }
  const timeSinceLastActivity = Date.now() - buf.lastActivity;
  const shouldContinue = !buf.isActive && timeSinceLastActivity < 300000;
  res.json({ events: buf.events, isActive: buf.isActive, shouldContinue });
});

// ── Active abort controllers per project ──
const activeAbortControllers = new Map<string, AbortController>();

// POST /api/agent/queue — queue a message when agent is busy
app.post("/api/agent/queue", (req, res) => {
  const { projectId, prompt } = req.body;
  if (!projectId || !prompt) return res.status(400).json({ error: "projectId and prompt required" });

  if (!messageQueues.has(projectId)) messageQueues.set(projectId, []);
  messageQueues.get(projectId)!.push(prompt);

  res.json({ queued: true, position: messageQueues.get(projectId)!.length });
});

// GET /api/agent/queue — check queue status
app.get("/api/agent/queue", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const queue = messageQueues.get(projectId) || [];
  const isBusy = activeRequests.has(projectId);
  res.json({ queue, isBusy, length: queue.length });
});

// POST /api/agent/stop — kill the running agent
app.post("/api/agent/stop", (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const controller = activeAbortControllers.get(projectId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(projectId);
    // Mark stream as inactive
    const buf = streamBuffers.get(projectId);
    if (buf) buf.isActive = false;
    res.json({ success: true, message: "Agent stopped" });
  } else {
    res.json({ success: false, message: "No active agent for this project" });
  }
});

// POST /api/agent — Run Claude Agent SDK
app.post("/api/agent", async (req, res) => {
  const { prompt, systemPrompt, files = [], sessionId: existingSessionId, projectId: requestProjectId } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  // Set SSE headers — disable all buffering
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Content-Encoding", "none");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const projectWorkspaceId = requestProjectId || existingSessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = existingSessionId || projectWorkspaceId;

  // Use persistent project workspace
  let workDir = getWorkDir(projectWorkspaceId);

  try {
    // If workspace doesn't exist yet, seed it from the provided files
    if (!fs.existsSync(workDir) || fs.readdirSync(workDir).filter(f => !f.startsWith('.')).length === 0) {
      fs.mkdirSync(workDir, { recursive: true });
      if (files.length > 0) {
        for (const file of files) {
          try {
            const filePath = path.join(workDir, file.path);
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, file.content || "", "utf8");
          } catch {}
        }
      }
      sendSSE(res, { type: "status", message: `Workspace created: ${files.length} files`, sessionId });
    } else {
      sendSSE(res, { type: "status", message: `Using existing workspace`, sessionId });
    }
  // Write CLAUDE.md — Claude Code reads this automatically as project instructions
  try {
    // Detect project type from existing files in workspace
    const hasNextConfig = fs.existsSync(path.join(workDir, "next.config.mjs")) || fs.existsSync(path.join(workDir, "next.config.js")) || fs.existsSync(path.join(workDir, "next.config.ts"));
    const hasViteConfig = fs.existsSync(path.join(workDir, "vite.config.js")) || fs.existsSync(path.join(workDir, "vite.config.ts")) || fs.existsSync(path.join(workDir, "vite.config.mjs"));
    const hasPkgJson = fs.existsSync(path.join(workDir, "package.json"));
    let pkgDeps = "";
    try { if (hasPkgJson) pkgDeps = fs.readFileSync(path.join(workDir, "package.json"), "utf8"); } catch {}
    const isNextJs = hasNextConfig || pkgDeps.includes('"next"');
    const isViteReact = hasViteConfig || pkgDeps.includes('"vite"') || pkgDeps.includes('"@vitejs/');
    const isExpress = pkgDeps.includes('"express"');
    const isFramework = isNextJs || isViteReact || isExpress;

    // Build framework-specific instructions
    let frameworkSection = "";
    if (isNextJs) {
      frameworkSection = `
## Framework: Next.js (App Router)

This is a FULL-STACK Next.js project. Use it properly:
- **Pages**: app/page.jsx, app/about/page.jsx — file-based routing (NOT hash routing)
- **Layouts**: app/layout.jsx — shared layout wrapping all pages
- **Server Components**: Default. Use \`'use client'\` only when needed (useState, useEffect, onClick)
- **API Routes**: app/api/route.js — build real API endpoints
- **SSR/SSG**: Use getServerSideProps or generateStaticParams for data fetching
- **Server Actions**: Use \`'use server'\` for form handling and mutations
- **DO NOT** use hash-based routing, vanilla JS routers, or treat this as a static site
- **DO NOT** put everything in one page — use the file-based router

**Dev Server Config:**
\`\`\`js
// next.config.mjs
export default { allowedDevOrigins: ['https://*.e2b.app', 'https://*.e2b.dev'] }
\`\`\`
package.json: \`"dev": "next dev -H 0.0.0.0 -p 3000"\`
`;
    } else if (isViteReact) {
      frameworkSection = `
## Framework: Vite + React

This is a React project with Vite. Build with modern React patterns:
- **Components**: src/components/ — reusable React components with JSX
- **Pages**: src/pages/ — page-level components
- **Routing**: Use react-router-dom for client-side routing (NOT hash routing or vanilla JS)
- **State**: useState, useEffect, useContext, useReducer — React hooks
- **Styling**: CSS modules, Tailwind CSS, or styled-components
- **DO NOT** use vanilla JS DOM manipulation, innerHTML, or document.querySelector
- **DO NOT** use hash-based routing — use react-router-dom with BrowserRouter

**Dev Server Config:**
\`\`\`js
// vite.config.ts
server: {
  host: '0.0.0.0', port: 3000, cors: true,
  allowedHosts: ['.e2b.app', '.e2b.dev'],
}
\`\`\`
package.json: \`"dev": "vite --host 0.0.0.0"\`
`;
    } else if (isExpress) {
      frameworkSection = `
## Framework: Express.js

This is a Node.js server project:
- **Server**: server.js — Express server with routes
- **API**: Define REST endpoints with app.get(), app.post(), etc.
- **Static files**: Serve from public/ directory
- **ALWAYS** bind to 0.0.0.0: \`app.listen(3000, '0.0.0.0')\`
`;
    } else {
      // Static HTML/CSS/JS project
      frameworkSection = `
## Multi-Page Architecture (Static HTML/CSS/JS)

Build real multi-page apps using hash-based routing — not single static pages.

**Structure**: index.html (Tailwind CDN + Google Fonts + Lucide icons), styles.css (CSS variables, animations), app.js (router + interactivity)

**Hash Router Pattern** (app.js):
\`\`\`
const routes = { '/': renderHome, '/about': renderAbout, '/contact': renderContact, '/product/:slug': renderProduct };
function router() {
  const hash = window.location.hash.slice(1) || '/';
  for (const [pattern, handler] of Object.entries(routes)) {
    if (pattern.includes(':')) {
      const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, '([^/]+)') + '$');
      const match = hash.match(regex);
      if (match) { handler(...match.slice(1)); return; }
    }
    if (hash === pattern) { handler(); return; }
  }
}
window.addEventListener('hashchange', router);
router();
\`\`\`

**Navigation**: Always use hash links: \`<a href="#/">Home</a>\`, \`<a href="#/about">About</a>\`
**Reusable Components**: renderNavbar(), renderFooter(), renderCard(item), renderHero(title, subtitle)
**Detail Pages**: Every listing needs detail pages with #/product/{slug} routes.

NEVER build a single-page static site. ALWAYS build multi-page apps with routing.
`;
    }

    const claudeMd = `# Project Instructions

This is the project root. ALL files belong here.

## CRITICAL
- NEVER create a subfolder for the project (no "my-app/", "weather-app/", etc.)
- Create files DIRECTLY here: index.html, package.json, src/, etc.
- If starting fresh, delete old files first then create new ones in root
- You are already in the correct directory

## Frontend Design Skill

Create distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics.

Before coding, commit to a BOLD aesthetic direction — brutally minimal, maximalist, retro-futuristic, luxury/refined, playful, editorial, brutalist, art deco, soft/pastel, industrial. Execute with precision.

**Typography**: NEVER use Inter, Roboto, Arial. Pick distinctive, characterful fonts. Pair display + body.
**Color**: Cohesive palette with CSS variables. Dominant colors + sharp accents.
**Motion**: Staggered reveals on load (animation-delay), hover surprises, scroll-triggered animations.
**Layout**: Asymmetry, overlap, grid-breaking, generous negative space OR controlled density.
**Depth**: Gradient meshes, noise textures, geometric patterns, dramatic shadows, grain overlays.
**Images**: \`https://api.a0.dev/assets/image?text={url-encoded}&aspect={16:9|1:1|9:16}\` — use on every page.
**Icons**: Lucide CDN for UI, Simple Icons for brands. No emojis.
**Content**: Real names, prices, dates. No lorem ipsum. Complete all pages.

NEVER use generic AI aesthetics. Every project should look unique and distinctive.
${frameworkSection}
## Starting Dev Servers (CRITICAL)

When you need to run a dev server (npm run dev, node server.js, etc.):

1. **NEVER use a hardcoded port.** Always use a random available port to avoid conflicts:
   - Vite: \`vite --host 0.0.0.0 --port 0\` (port 0 = auto-assign)
   - Next.js: \`next dev -H 0.0.0.0 -p 0\`
   - Express: \`app.listen(0, '0.0.0.0')\` then log the assigned port
   - Or use a random port: \`const port = 30000 + Math.floor(Math.random() * 20000)\`

2. **ALWAYS bind to 0.0.0.0** — never localhost or 127.0.0.1

3. **After starting the server, print the URL clearly** so the system can detect it:
   \`console.log(\`Server running at http://localhost:\${port}\`)\`

4. **Don't install dependencies manually** — the system handles npm install automatically before starting

5. **If a port is in use**, pick a different random port. Never force-kill other processes.

${systemPrompt ? "\n## Additional Context\n" + systemPrompt : ""}
`;
    fs.writeFileSync(path.join(workDir, "CLAUDE.md"), claudeMd, "utf8");
  } catch {}

  } catch (err: any) {
    sendSSE(res, { type: "error", message: `Failed to create workspace: ${err.message}` });
    res.end();
    return;
  }

  const HISTORY_FILE = path.join(workDir, ".claude_history.json");

  console.log(`[agent] Session ${sessionId}: prompt="${prompt.slice(0, 100)}", files=${files.length}, cwd=${workDir}`);
  console.log(`[agent] systemPrompt received: ${systemPrompt ? systemPrompt.length + " chars" : "NONE"}`);
  console.log(`[agent] systemPrompt starts with: "${(systemPrompt || "").slice(0, 80)}..."`);

  // Initialize event buffer for this project
  streamBuffers.set(projectWorkspaceId, { events: [], isActive: true, lastActivity: Date.now() });
  currentStreamProjectId = projectWorkspaceId;

  // If agent is already busy for this project, queue the message
  if (activeRequests.has(projectWorkspaceId)) {
    if (!messageQueues.has(projectWorkspaceId)) messageQueues.set(projectWorkspaceId, []);
    messageQueues.get(projectWorkspaceId)!.push(prompt);
    sendSSE(res, { type: "queued", position: messageQueues.get(projectWorkspaceId)!.length, sessionId });
    res.end();
    return;
  }

  activeRequests.add(projectWorkspaceId);
  sendSSE(res, { type: "start", sessionId, timestamp: Date.now() });

  // ── Build prompt ──
  // CLAUDE.md is on disk — Agent SDK reads it automatically.
  // Only inject minimal context into the prompt to keep it lean.
  let fullPrompt = prompt;
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      const MAX_PAIRS = 3;
      const MAX_MSG_LENGTH = 400;
      const recent = history.slice(-(MAX_PAIRS * 2));
      if (recent.length > 0) {
        const context = recent
          .map((m: any) => {
            const content = m.content.length > MAX_MSG_LENGTH
              ? m.content.slice(0, MAX_MSG_LENGTH) + "...[truncated]"
              : m.content;
            return `${m.role === "user" ? "Human" : "Assistant"}: ${content}`;
          })
          .join("\n\n");
        fullPrompt = `Previous conversation:\n${context}\n\nCurrent request: ${prompt}`;
      }
    }
  } catch {}

  // Save user message to history
  try {
    const history = fs.existsSync(HISTORY_FILE)
      ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"))
      : [];
    history.push({ role: "user", content: prompt, timestamp: new Date().toISOString() });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch {}

  // ── Build system prompt with project directory instructions ──
  // Keep system prompt minimal — CLAUDE.md has the full instructions
  const agentSystemPrompt = `You are building a project in ${workDir}. Read CLAUDE.md for design rules. Never create subfolders. Just build.`;

  // Track if we've streamed text to avoid duplication from assistant messages
  let hasStreamedText = false;
  let assistantText = "";

  // Reference to current SSE response for canUseTool to send questions
  let sseRes = res;

  // Create abort controller for this run
  const abortController = new AbortController();
  activeAbortControllers.set(projectWorkspaceId, abortController);

  try {
    // Use continue: true to auto-resume the most recent session in this workspace.
    // Sessions persist in ~/.claude/projects/<encoded-cwd>/*.jsonl
    // On first message: creates new session. On subsequent: continues it.
    const isFirstMessage = !activeSessions.has(projectWorkspaceId);
    console.log(`[agent] ${isFirstMessage ? "New" : "Continuing"} session for ${projectWorkspaceId}`);

    for await (const message of query({
      prompt: fullPrompt,
      options: {
        systemPrompt: agentSystemPrompt,
        cwd: workDir,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        continue: !isFirstMessage,
        abortController,
        canUseTool: async (toolName: string, input: any) => {
          if (toolName === "AskUserQuestion") {
            // Send question to frontend via SSE
            const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            sendSSE(sseRes, {
              type: "ask_user",
              requestId,
              questions: input.questions,
            });

            // Wait for the frontend to POST the answer
            const answer = await new Promise<any>((resolve) => {
              pendingInputRequests.set(requestId, { resolve, question: input });
              // Timeout after 5 minutes
              setTimeout(() => {
                if (pendingInputRequests.has(requestId)) {
                  pendingInputRequests.delete(requestId);
                  // Auto-select first option for each question
                  const autoAnswers: Record<string, string> = {};
                  for (const q of input.questions || []) {
                    autoAnswers[q.question] = q.options?.[0]?.label || "yes";
                  }
                  resolve({ questions: input.questions, answers: autoAnswers });
                }
              }, 300000);
            });

            return { behavior: "allow", updatedInput: answer };
          }

          if (toolName === "EnterPlanMode" || toolName === "ExitPlanMode") {
            // Auto-approve plan mode transitions
            sendSSE(sseRes, { type: "tool_use", name: toolName, id: `plan-${Date.now()}`, input });
            return { behavior: "allow", updatedInput: input };
          }

          // Auto-approve all other tools
          return { behavior: "allow", updatedInput: input };
        },
      },
    })) {
      const msg = message as any;

      // Track that this project has an active session (for continue: true)
      if (msg.session_id && !activeSessions.has(projectWorkspaceId)) {
        activeSessions.set(projectWorkspaceId, { session: null, sessionId: msg.session_id });
      }

      // Stream events — real-time text deltas from the LLM
      if (msg.type === "stream_event") {
        const event = msg.event;
        if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
          hasStreamedText = true;
          assistantText += event.delta.text;
          sendSSE(res, { type: "text", data: event.delta.text });
        }
        if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
          sendSSE(res, { type: "tool_use", name: event.content_block.name, id: event.content_block.id });
        }
      }

      // Partial assistant — streamed text chunks
      else if (msg.type === "partial_assistant") {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              hasStreamedText = true;
              sendSSE(res, { type: "text", data: block.text });
            }
          }
        }
      }

      // Complete assistant message
      else if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            // Only send text if NOT already streamed (prevents duplication)
            if (block.type === "text" && block.text && !hasStreamedText) {
              sendSSE(res, { type: "text", data: block.text });
            }
            // ALWAYS send tool_use — this is where the input data lives
            if (block.type === "tool_use") {
              sendSSE(res, { type: "tool_use", name: block.name, id: block.id, input: block.input });
            }
          }
          // Reset for next turn
          hasStreamedText = false;
        }
      }

      // User messages — tool results from agent's tool execution
      else if (msg.type === "user") {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              const resultText = typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => c.type === "text" ? c.text : `[${c.type}]`).join("\n")
                  : JSON.stringify(block.content);
              sendSSE(res, { type: "tool_result", tool_use_id: block.tool_use_id, result: (resultText || "").substring(0, 3000) });
            }
          }
        }
      }

      // Final result — completion with cost
      else if (msg.type === "result") {
        if (msg.result && !assistantText) assistantText = msg.result;
        sendSSE(res, { type: "result", subtype: msg.subtype, result: msg.result, cost: msg.total_cost_usd, sessionId });
      }
    }

    // Save assistant response to conversation history
    try {
      const history = fs.existsSync(HISTORY_FILE)
        ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"))
        : [];
      history.push({
        role: "assistant",
        content: assistantText || "(tool use only)",
        timestamp: new Date().toISOString(),
      });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch {}

    sendSSE(res, { type: "complete", sessionId });
  } catch (err: any) {
    console.error(`[agent] Session ${sessionId} error:`, err.message);
    sendSSE(res, { type: "error", message: err.message || "Agent error" });
  }

  // Cleanup
  const buf = streamBuffers.get(projectWorkspaceId);
  if (buf) buf.isActive = false;
  currentStreamProjectId = null;
  activeAbortControllers.delete(projectWorkspaceId);
  activeRequests.delete(projectWorkspaceId);

  // Check for queued messages — notify client to send next
  const queue = messageQueues.get(projectWorkspaceId);
  if (queue && queue.length > 0) {
    const nextPrompt = queue.shift();
    sendSSE(res, { type: "queued_next", prompt: nextPrompt, remaining: queue.length });
  }

  res.end();
});

// GET /api/agent/health — health check
app.get("/api/agent/health", (req, res) => {
  res.json({ status: "ok", workspaceBase: WORKSPACE_BASE });
});

// POST /api/agent/answer — user answers a question from the agent
app.post("/api/agent/answer", (req, res) => {
  const { requestId, answer } = req.body;
  if (!requestId) return res.status(400).json({ error: "requestId required" });

  const pending = pendingInputRequests.get(requestId);
  if (!pending) return res.status(404).json({ error: "No pending request found" });

  pending.resolve(answer);
  pendingInputRequests.delete(requestId);
  res.json({ success: true });
});

// GET /api/agent/sessions — list active sessions (for resume on refresh)
app.get("/api/agent/sessions", (req, res) => {
  const sessions: Record<string, string> = {};
  for (const [projectId, { sessionId }] of activeSessions) {
    sessions[projectId] = sessionId;
  }
  res.json({ sessions });
});

// ── Helper: resolve workspace path with traversal protection ──
function resolveWorkspacePath(projectId: string, relativePath?: string): string {
  const base = getWorkDir(projectId);
  if (!relativePath) return base;
  const resolved = path.resolve(base, relativePath);
  // Prevent path traversal
  if (!resolved.startsWith(base)) throw new Error("Invalid path");
  return resolved;
}

// ── Helper: build FileNode tree from disk (recursive) ──
function buildFileTree(dir: string, basePath: string = ""): any[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: any[] = [];

  for (const entry of entries) {
    // Skip system files
    // Skip node_modules and dot folders (except dist, build)
    if (entry.name === "node_modules") continue;
    // Skip dot files/folders EXCEPT .env* files
    if (entry.name.startsWith(".") && !entry.name.startsWith(".env")) continue;
    if (entry.name === "CLAUDE.md") continue;

    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      nodes.push({
        id: relativePath,
        name: entry.name,
        type: "folder",
        parentPath: basePath,
        children: buildFileTree(fullPath, relativePath),
      });
    } else {
      let content = "";
      let language = "plaintext";
      try {
        content = fs.readFileSync(fullPath, "utf8");
        const ext = entry.name.split(".").pop()?.toLowerCase() || "";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          json: "json", html: "html", css: "css", md: "markdown", py: "python",
          svg: "xml", xml: "xml", yml: "yaml", yaml: "yaml", txt: "plaintext",
          sh: "shell", bash: "shell", mjs: "javascript", cjs: "javascript",
        };
        language = langMap[ext] || "plaintext";
      } catch {}

      nodes.push({
        id: relativePath,
        name: entry.name,
        type: "file",
        parentPath: basePath,
        language,
        content,
      });
    }
  }

  // Sort: folders first, then alphabetical
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

// ── File CRUD endpoints ──

// GET /api/files/tree — list project file tree
app.get("/api/files/tree", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  try {
    const dir = resolveWorkspacePath(projectId);
    const tree = buildFileTree(dir);
    res.json({ files: tree });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/read — read a single file
app.get("/api/files/read", (req, res) => {
  const projectId = req.query.projectId as string;
  const filePath = req.query.path as string;
  if (!projectId || !filePath) return res.status(400).json({ error: "projectId and path required" });

  try {
    const fullPath = resolveWorkspacePath(projectId, filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File not found" });
    const content = fs.readFileSync(fullPath, "utf8");
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/write — write/create a file
app.post("/api/files/write", (req, res) => {
  const { projectId, path: filePath, content } = req.body;
  if (!projectId || !filePath) return res.status(400).json({ error: "projectId and path required" });

  try {
    const fullPath = resolveWorkspacePath(projectId, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content || "", "utf8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/mkdir — create a directory
app.post("/api/files/mkdir", (req, res) => {
  const { projectId, path: dirPath } = req.body;
  if (!projectId || !dirPath) return res.status(400).json({ error: "projectId and path required" });

  try {
    const fullPath = resolveWorkspacePath(projectId, dirPath);
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/files — delete a file or directory
app.delete("/api/files", (req, res) => {
  const projectId = req.query.projectId as string;
  const filePath = req.query.path as string;
  if (!projectId || !filePath) return res.status(400).json({ error: "projectId and path required" });

  try {
    const fullPath = resolveWorkspacePath(projectId, filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Not found" });
    fs.rmSync(fullPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/rename — rename/move a file or directory
app.post("/api/files/rename", (req, res) => {
  const { projectId, oldPath, newPath } = req.body;
  if (!projectId || !oldPath || !newPath) return res.status(400).json({ error: "projectId, oldPath, and newPath required" });

  try {
    const from = resolveWorkspacePath(projectId, oldPath);
    const to = resolveWorkspacePath(projectId, newPath);
    if (!fs.existsSync(from)) return res.status(404).json({ error: "Source not found" });
    const toDir = path.dirname(to);
    if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
    fs.renameSync(from, to);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/seed — seed a workspace with initial files (won't overwrite existing)
app.post("/api/files/seed", (req, res) => {
  const { projectId, files } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const dir = resolveWorkspacePath(projectId);

  // If workspace already has files, don't overwrite
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    return res.json({ seeded: false, message: "Workspace already exists" });
  }

  // Create workspace and write files
  fs.mkdirSync(dir, { recursive: true });

  if (Array.isArray(files)) {
    for (const file of files) {
      try {
        const fullPath = resolveWorkspacePath(projectId, file.path);
        const fileDir = path.dirname(fullPath);
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(fullPath, file.content || "", "utf8");
      } catch {}
    }
  }

  res.json({ seeded: true, fileCount: files?.length || 0 });
});

// DELETE /api/files/workspace — delete entire workspace
app.delete("/api/files/workspace", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  try {
    const dir = getWorkDir(projectId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SSE file watcher — streams file changes in real-time
const activeWatchers = new Map<string, chokidar.FSWatcher>();

app.get("/api/files/watch", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const dir = getWorkDir(projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Send initial tree
  const tree = buildFileTree(dir);
  res.write(`data: ${JSON.stringify({ type: "tree", files: tree })}\n\n`);

  // Watch for changes
  const watcher = chokidar.watch(dir, {
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.next/**",
      "**/.cache/**",
      "**/.claude/**",
      "**/.claude_history.json",
      "**/CLAUDE.md",
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const sendUpdate = () => {
    try {
      const tree = buildFileTree(dir);
      res.write(`data: ${JSON.stringify({ type: "tree", files: tree })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    } catch {}
  };

  // Debounce rapid changes
  let debounceTimer: NodeJS.Timeout | null = null;
  const debouncedUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendUpdate, 300);
  };

  watcher.on("add", debouncedUpdate);
  watcher.on("change", debouncedUpdate);
  watcher.on("unlink", debouncedUpdate);
  watcher.on("addDir", debouncedUpdate);
  watcher.on("unlinkDir", debouncedUpdate);

  // Heartbeat every 15s
  const heartbeat = setInterval(() => {
    try { res.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`); } catch {}
  }, 15000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  });
});

// Static file server for workspace preview
// Use query params instead of path params to avoid Express v5 path-to-regexp issues
app.get("/api/preview", (req, res) => {
  const projectId = req.query.projectId as string;
  const filePath = (req.query.path as string) || "index.html";

  try {
    const fullPath = resolveWorkspacePath(projectId, filePath);
    if (!fs.existsSync(fullPath)) {
      // Try index.html for directory requests
      const indexPath = path.join(fullPath, "index.html");
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      return res.status(404).send("Not found");
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const indexPath = path.join(fullPath, "index.html");
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      return res.status(404).send("Not found");
    }

    // Set correct MIME type
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
      ".mjs": "application/javascript", ".json": "application/json",
      ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif",
      ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff",
      ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain",
      ".xml": "application/xml", ".webp": "image/webp",
    };
    const mime = mimeTypes[ext] || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.sendFile(fullPath);
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// GET /api/files/types — serve type definitions from node_modules for Monaco
app.get("/api/files/types", (req, res) => {
  const projectId = req.query.projectId as string;
  const pkg = req.query.package as string; // e.g. "react", "@types/react", "next"
  if (!projectId || !pkg) return res.status(400).json({ error: "projectId and package required" });

  const workDir = getWorkDir(projectId);
  const nodeModules = path.join(workDir, "node_modules");

  if (!fs.existsSync(nodeModules)) return res.json({ files: {} });

  // Collect all .d.ts files for this package
  const typesMap: Record<string, string> = {};

  // Check @types/{pkg} first, then pkg itself
  const candidates = [
    path.join(nodeModules, "@types", pkg.replace("@", "").replace("/", "__")),
    path.join(nodeModules, pkg),
  ];

  for (const pkgDir of candidates) {
    if (!fs.existsSync(pkgDir)) continue;

    function walkTypes(dir: string, base: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          const rel = base ? `${base}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            walkTypes(full, rel);
          } else if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".d.mts") || entry.name === "package.json") {
            try {
              typesMap[rel] = fs.readFileSync(full, "utf8");
            } catch {}
          }
        }
      } catch {}
    }

    walkTypes(pkgDir, "");
    if (Object.keys(typesMap).length > 0) break; // Found types, stop searching
  }

  res.json({ files: typesMap, package: pkg });
});

// ── Dev Server Management ──

// POST /api/dev-server/start — start a dev server for a project
app.post("/api/dev-server/start", async (req, res) => {
  const { projectId, force } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });

  // Reuse existing dev server if already running (unless force restart requested)
  const existing = getDevServerStatus(projectId);
  if (!force && (existing.status === "running" || existing.status === "starting" || existing.status === "installing")) {
    console.log(`[dev-server] Reusing ${existing.status} server for ${projectId}${existing.port ? ` on port ${existing.port}` : ""}`);
    return res.json({
      success: true,
      status: existing.status,
      projectId,
      port: existing.port,
      url: existing.url,
      reused: true,
    });
  }

  // Start async — don't await, respond immediately
  startDevServer(projectId, workDir, (status, port, url) => {
    console.log(`[dev-server] ${projectId}: ${status}${port ? ` on port ${port}` : ""}`);
  });

  res.json({ success: true, status: "starting", projectId, reused: false });
});

// POST /api/dev-server/stop — stop a dev server
app.post("/api/dev-server/stop", (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const stopped = stopDevServer(projectId);
  res.json({ success: stopped });
});

// GET /api/dev-server/status — get dev server status
app.get("/api/dev-server/status", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  res.json(getDevServerStatus(projectId));
});

// Proxy preview requests to the running dev server
app.get("/api/dev-preview", async (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const status = getDevServerStatus(projectId);
  if (!status.running || !status.port) {
    return res.status(503).json({ error: "Dev server not running", status: status.status });
  }

  // Redirect to the actual dev server
  const targetUrl = `http://localhost:${status.port}${req.query.path || "/"}`;
  res.redirect(targetUrl);
});

// ── SSE: Stream dev server logs in real-time ─────────────────────────
app.get("/api/dev-server/logs", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send existing logs as initial batch
  const status = getDevServerStatus(projectId);
  if (status.logs.length > 0) {
    for (const log of status.logs) {
      res.write(`data: ${JSON.stringify({ text: log, source: "stdout", level: "info" })}\n\n`);
    }
  }

  const unsub = subscribeToLogs(projectId, (entry) => {
    try {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch {}
  });

  req.on("close", unsub);
});

// ── PTY Terminal ─────────────────────────────────────────────────────
const activePtys = new Map<string, pty.IPty>();
// Per-session scrollback buffer (raw bytes, capped to ~512KB per session)
const ptyBuffers = new Map<string, string>();
const PTY_BUFFER_MAX = 512 * 1024;

function createPtyForProject(projectId: string): pty.IPty {
  const workDir = getWorkDir(projectId);
  const shell = process.platform === "win32" ? "cmd.exe" : (process.env.SHELL || "/bin/bash");
  const cwd = fs.existsSync(workDir) ? workDir : WORKSPACE_BASE;

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });

  return ptyProcess;
}

// POST /api/terminal/create — create a PTY session
app.post("/api/terminal/create", (req, res) => {
  const { projectId, sessionId } = req.body;
  if (!projectId || !sessionId) return res.status(400).json({ error: "projectId and sessionId required" });

  if (activePtys.has(sessionId)) {
    return res.json({ success: true, sessionId, existing: true });
  }

  const ptyProc = createPtyForProject(projectId);
  activePtys.set(sessionId, ptyProc);
  ptyBuffers.set(sessionId, "");

  // Always-on listener that captures every byte to the scrollback buffer.
  // This runs independently of any SSE client being connected.
  ptyProc.onData((data: string) => {
    let buf = ptyBuffers.get(sessionId) || "";
    buf += data;
    if (buf.length > PTY_BUFFER_MAX) {
      buf = buf.slice(buf.length - PTY_BUFFER_MAX);
    }
    ptyBuffers.set(sessionId, buf);
  });

  ptyProc.onExit(() => {
    activePtys.delete(sessionId);
    ptyBuffers.delete(sessionId);
    console.log(`[terminal] PTY ${sessionId} exited`);
  });

  console.log(`[terminal] Created PTY ${sessionId} for ${projectId}`);
  res.json({ success: true, sessionId });
});

// POST /api/terminal/write — send input to PTY
app.post("/api/terminal/write", (req, res) => {
  const { sessionId, data } = req.body;
  const ptyProc = activePtys.get(sessionId);
  if (!ptyProc) return res.status(404).json({ error: "PTY not found" });
  ptyProc.write(data);
  res.json({ success: true });
});

// POST /api/terminal/resize — resize PTY
app.post("/api/terminal/resize", (req, res) => {
  const { sessionId, cols, rows } = req.body;
  const ptyProc = activePtys.get(sessionId);
  if (!ptyProc) return res.status(404).json({ error: "PTY not found" });
  try { ptyProc.resize(cols, rows); } catch {}
  res.json({ success: true });
});

// GET /api/terminal/stream — SSE output from PTY
app.get("/api/terminal/stream", (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });

  const ptyProc = activePtys.get(sessionId);
  if (!ptyProc) return res.status(404).json({ error: "PTY not found" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Replay scrollback buffer first so reconnecting clients see history
  const buffer = ptyBuffers.get(sessionId) || "";
  if (buffer.length > 0) {
    try {
      res.write(`data: ${JSON.stringify({ output: buffer, replay: true })}\n\n`);
    } catch {}
  }

  const disposable = ptyProc.onData((data: string) => {
    try {
      res.write(`data: ${JSON.stringify({ output: data })}\n\n`);
    } catch {}
  });

  const exitDisposable = ptyProc.onExit(() => {
    try { res.write(`data: ${JSON.stringify({ exit: true })}\n\n`); } catch {}
    try { res.end(); } catch {}
  });

  req.on("close", () => {
    disposable.dispose();
    exitDisposable.dispose();
  });
});

// POST /api/terminal/destroy — kill a PTY session
app.post("/api/terminal/destroy", (req, res) => {
  const { sessionId } = req.body;
  const ptyProc = activePtys.get(sessionId);
  if (ptyProc) {
    ptyProc.kill();
    activePtys.delete(sessionId);
  }
  res.json({ success: true });
});

// ── Git Endpoints ────────────────────────────────────────────────────
function getGitWorkDir(projectId: string): string | null {
  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return null;
  return workDir;
}

// GET /api/git/check — check if git is installed
app.get("/api/git/check", async (_req, res) => {
  const result = await gitOps.isGitInstalled();
  res.json(result);
});

// POST /api/git/install — attempt to install git
app.post("/api/git/install", async (_req, res) => {
  const result = await gitOps.installGit();
  res.json(result);
});

// GET /api/git/repo-status — check if project is a git repo
app.get("/api/git/repo-status", async (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const isRepo = await gitOps.isGitRepo(workDir);
  res.json({ isRepo });
});

// POST /api/git/init
app.post("/api/git/init", async (req, res) => {
  const { projectId } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitInit(workDir);
  res.json(result);
});

// GET /api/git/config — read git author name + email from global config
app.get("/api/git/config", async (_req, res) => {
  try {
    const [name, email] = await Promise.all([
      gitOps.gitConfigGet("user.name"),
      gitOps.gitConfigGet("user.email"),
    ]);
    res.json({ name, email });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/git/config — set git author name + email in global config
app.post("/api/git/config", async (req, res) => {
  const { name, email } = req.body;
  try {
    if (typeof name === "string") await gitOps.gitConfigSet("user.name", name);
    if (typeof email === "string") await gitOps.gitConfigSet("user.email", email);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/git/clone — clone a remote repo into the workspace base dir
app.post("/api/git/clone", async (req, res) => {
  const { url, parentDir } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, message: "url required" });
  }
  // Check git is installed
  const installed = await gitOps.isGitInstalled();
  if (!installed.installed) {
    return res.status(400).json({
      success: false,
      message: "Git is not installed. Install it from https://git-scm.com",
    });
  }
  const target = (parentDir && typeof parentDir === "string") ? parentDir : WORKSPACE_BASE;
  try {
    const result = await gitOps.gitClone(url, target);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/git/status
app.get("/api/git/status", async (req, res) => {
  const projectId = req.query.projectId as string;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  try {
    const [files, branch, branches, remotes] = await Promise.all([
      gitOps.gitStatus(workDir),
      gitOps.gitCurrentBranch(workDir),
      gitOps.gitBranches(workDir),
      gitOps.gitRemotes(workDir),
    ]);
    res.json({ files, branch, branches, remotes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/git/log
app.get("/api/git/log", async (req, res) => {
  const projectId = req.query.projectId as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const log = await gitOps.gitLog(workDir, limit);
  res.json({ log });
});

// GET /api/git/diff?projectId=&path=&staged=
app.get("/api/git/diff", async (req, res) => {
  const projectId = req.query.projectId as string;
  const filePath = req.query.path as string;
  const staged = req.query.staged === "true";
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const diff = await gitOps.gitDiff(workDir, filePath, staged);
  // Also fetch the original (HEAD) and current contents for inline diff view
  let oldContent = "";
  let newContent = "";
  try {
    oldContent = await gitOps.gitShowFile(workDir, filePath);
  } catch {}
  try {
    const fullPath = path.join(workDir, filePath);
    if (fs.existsSync(fullPath)) {
      newContent = fs.readFileSync(fullPath, "utf8");
    }
  } catch {}
  res.json({ diff, oldContent, newContent });
});

// POST /api/git/add
app.post("/api/git/add", async (req, res) => {
  const { projectId, files, all } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = all ? await gitOps.gitAddAll(workDir) : await gitOps.gitAdd(workDir, files || []);
  res.json(result);
});

// POST /api/git/unstage
app.post("/api/git/unstage", async (req, res) => {
  const { projectId, files } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitUnstage(workDir, files || []);
  res.json(result);
});

// POST /api/git/commit
app.post("/api/git/commit", async (req, res) => {
  const { projectId, message } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitCommit(workDir, message);
  res.json(result);
});

// POST /api/git/push
app.post("/api/git/push", async (req, res) => {
  const { projectId, remote, branch } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitPush(workDir, remote, branch);
  res.json(result);
});

// POST /api/git/pull
app.post("/api/git/pull", async (req, res) => {
  const { projectId, remote, branch } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitPull(workDir, remote, branch);
  res.json(result);
});

// POST /api/git/branch — create
app.post("/api/git/branch", async (req, res) => {
  const { projectId, name } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitCreateBranch(workDir, name);
  res.json(result);
});

// POST /api/git/checkout
app.post("/api/git/checkout", async (req, res) => {
  const { projectId, branch } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitCheckout(workDir, branch);
  res.json(result);
});

// POST /api/git/discard
app.post("/api/git/discard", async (req, res) => {
  const { projectId, files } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const result = await gitOps.gitDiscard(workDir, files || []);
  res.json(result);
});

// GET /api/git/commit-detail?projectId=&oid=
app.get("/api/git/commit-detail", async (req, res) => {
  const projectId = req.query.projectId as string;
  const oid = req.query.oid as string;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  if (!oid) return res.status(400).json({ error: "oid required" });
  try {
    const detail = await gitOps.gitCommitDetail(workDir, oid);
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/git/fetch
app.post("/api/git/fetch", async (req, res) => {
  const { projectId, remote } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitFetch(workDir, remote || "origin"));
});

// POST /api/git/stash
app.post("/api/git/stash", async (req, res) => {
  const { projectId, message } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitStash(workDir, message));
});

// GET /api/git/stash-list
app.get("/api/git/stash-list", async (req, res) => {
  const projectId = req.query.projectId as string;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  const stashes = await gitOps.gitStashList(workDir);
  res.json({ stashes });
});

// POST /api/git/stash-pop
app.post("/api/git/stash-pop", async (req, res) => {
  const { projectId } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitStashPop(workDir));
});

// POST /api/git/stash-apply
app.post("/api/git/stash-apply", async (req, res) => {
  const { projectId, ref } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitStashApply(workDir, ref));
});

// POST /api/git/stash-drop
app.post("/api/git/stash-drop", async (req, res) => {
  const { projectId, ref } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitStashDrop(workDir, ref));
});

// POST /api/git/pull-rebase
app.post("/api/git/pull-rebase", async (req, res) => {
  const { projectId, remote, branch } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitPullRebase(workDir, remote || "origin", branch));
});

// POST /api/git/merge
app.post("/api/git/merge", async (req, res) => {
  const { projectId, branch } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitMerge(workDir, branch));
});

// POST /api/git/cherry-pick
app.post("/api/git/cherry-pick", async (req, res) => {
  const { projectId, oid } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitCherryPick(workDir, oid));
});

// POST /api/git/reset
app.post("/api/git/reset", async (req, res) => {
  const { projectId, mode, target } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  if (!["soft", "mixed", "hard"].includes(mode)) {
    return res.status(400).json({ error: "mode must be soft|mixed|hard" });
  }
  res.json(await gitOps.gitReset(workDir, mode, target));
});

// POST /api/git/add-remote
app.post("/api/git/add-remote", async (req, res) => {
  const { projectId, name, url } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitAddRemote(workDir, name, url));
});

// POST /api/git/remove-remote
app.post("/api/git/remove-remote", async (req, res) => {
  const { projectId, name } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitRemoveRemote(workDir, name));
});

// POST /api/git/delete-branch
app.post("/api/git/delete-branch", async (req, res) => {
  const { projectId, name, force } = req.body;
  const workDir = getGitWorkDir(projectId);
  if (!workDir) return res.status(404).json({ error: "Workspace not found" });
  res.json(await gitOps.gitDeleteBranch(workDir, name, force));
});

// ── Project file search (real disk, used by Search panel) ──────────
// POST /api/project/search
app.post("/api/project/search", async (req, res) => {
  const { projectId, query, mode, caseSensitive, useRegex, exclude, maxResults } = req.body;
  if (!projectId || !query) return res.status(400).json({ error: "projectId and query required" });

  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });

  const excludeSet = new Set(["node_modules", ".git", "dist", "build", ".next", "out", ".cache", ".vite"]);
  if (Array.isArray(exclude)) {
    for (const e of exclude) excludeSet.add(e);
  }

  const limit = Math.min(maxResults || 200, 1000);
  const results: { fileId: string; fileName: string; filePath: string; matches: { lineNumber: number; lineText: string; matchStart: number; matchEnd: number }[] }[] = [];

  let pattern: RegExp;
  try {
    const flags = caseSensitive ? "g" : "gi";
    if (useRegex) pattern = new RegExp(query, flags);
    else pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch {
    return res.status(400).json({ error: "Invalid regex" });
  }

  // Recursive walk
  function walk(dir: string, relBase: string) {
    if (results.length >= limit) return;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (excludeSet.has(entry)) continue;
      const full = path.join(dir, entry);
      const relPath = relBase ? `${relBase}/${entry}` : entry;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        walk(full, relPath);
      } else if (stat.isFile()) {
        // Skip very large files (> 1MB)
        if (stat.size > 1_000_000) continue;

        if (mode === "filename") {
          pattern.lastIndex = 0;
          if (pattern.test(entry)) {
            results.push({ fileId: relPath, fileName: entry, filePath: relPath, matches: [] });
          }
        } else {
          // Content search
          let content: string;
          try { content = fs.readFileSync(full, "utf8"); } catch { continue; }
          // Skip binary-ish files (heuristic: contains null byte in first 8KB)
          if (content.slice(0, 8192).includes("\0")) continue;

          const lines = content.split("\n");
          const matches: { lineNumber: number; lineText: string; matchStart: number; matchEnd: number }[] = [];
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= 20) break;
            const line = lines[i];
            pattern.lastIndex = 0;
            const m = pattern.exec(line);
            if (m) {
              matches.push({
                lineNumber: i + 1,
                lineText: line.slice(0, 500),  // cap line length
                matchStart: m.index,
                matchEnd: m.index + m[0].length,
              });
            }
          }
          if (matches.length > 0) {
            results.push({ fileId: relPath, fileName: entry, filePath: relPath, matches });
          }
        }
      }
    }
  }

  walk(workDir, "");
  res.json({ results, truncated: results.length >= limit });
});

// ── Diagnostics (Problems panel) ────────────────────────────────────
// GET /api/diagnostics/check?projectId=...&source=all|typescript
app.get("/api/diagnostics/check", async (req, res) => {
  const projectId = req.query.projectId as string;
  const source = (req.query.source as string) || "all";
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });

  try {
    if (source === "typescript") {
      const diagnostics = await runTypeScriptCheck(workDir);
      res.json({ diagnostics, ran: { typescript: true } });
    } else {
      const result = await runAllChecks(workDir);
      res.json(result);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Filesystem browser (for the Open Folder dialog) ─────────────────

// GET /api/fs/home — return useful starting points (home, drives, etc.)
app.get("/api/fs/home", (_req, res) => {
  const home = os.homedir();
  const candidates: { name: string; path: string }[] = [];

  // Always include home
  candidates.push({ name: "Home", path: home });
  candidates.push({ name: "Documents", path: path.join(home, "Documents") });
  candidates.push({ name: "Desktop", path: path.join(home, "Desktop") });
  candidates.push({ name: "Downloads", path: path.join(home, "Downloads") });

  // On Windows, also list drives
  if (process.platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drive = `${letter}:\\`;
      try { if (fs.existsSync(drive)) candidates.push({ name: `${letter}: drive`, path: drive }); }
      catch {}
    }
  } else {
    candidates.push({ name: "Root", path: "/" });
  }

  // Filter to existing paths
  const existing = candidates.filter((c) => {
    try { return fs.existsSync(c.path); } catch { return false; }
  });

  res.json({ home, separator: path.sep, entries: existing });
});

// GET /api/fs/list?path=... — list immediate subdirectories (and a few file
// hints) at the given path. Used by the folder picker UI.
app.get("/api/fs/list", (req, res) => {
  const targetPath = req.query.path as string;
  if (!targetPath) return res.status(400).json({ error: "path required" });

  let resolved: string;
  try {
    resolved = path.resolve(targetPath);
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "path does not exist" });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch (err: any) {
    return res.status(403).json({ error: err.message });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: "path is not a directory" });
  }

  const folders: { name: string; path: string; hasPackageJson?: boolean }[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(resolved);
  } catch (err: any) {
    return res.status(403).json({ error: err.message });
  }

  for (const entry of entries) {
    // Skip hidden entries on Unix; show .git etc only if user wants them
    if (entry.startsWith(".") && entry !== ".github") continue;
    const full = path.join(resolved, entry);
    let s: fs.Stats;
    try { s = fs.statSync(full); } catch { continue; }
    if (!s.isDirectory()) continue;
    let hasPackageJson = false;
    try { hasPackageJson = fs.existsSync(path.join(full, "package.json")); } catch {}
    folders.push({ name: entry, path: full, hasPackageJson });
  }

  // Sort: folders with package.json first, then alphabetical
  folders.sort((a, b) => {
    if (a.hasPackageJson !== b.hasPackageJson) return a.hasPackageJson ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Compute parent path
  const parent = path.dirname(resolved);
  const hasParent = parent !== resolved;

  res.json({
    path: resolved,
    parent: hasParent ? parent : null,
    folders,
    separator: path.sep,
  });
});

// ── Linked Workspaces (Open Folder feature) ─────────────────────────

// POST /api/workspaces/link — register an external folder as a workspace
app.post("/api/workspaces/link", (req, res) => {
  const { absolutePath, name } = req.body;
  if (!absolutePath || typeof absolutePath !== "string") {
    return res.status(400).json({ error: "absolutePath required" });
  }
  try {
    const ws = linkFolder(absolutePath, name);
    res.json({ success: true, workspace: ws });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/workspaces/list — return all linked workspaces
app.get("/api/workspaces/list", (_req, res) => {
  res.json({ workspaces: listLinked() });
});

// POST /api/workspaces/unlink — remove a linked workspace (does NOT delete files)
app.post("/api/workspaces/unlink", (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const removed = unlinkFolder(projectId);
  res.json({ success: removed });
});

// POST /api/workspaces/touch — bump the lastOpened timestamp
app.post("/api/workspaces/touch", (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  touchLinked(projectId);
  res.json({ success: true });
});

// GET /api/workspaces/info?projectId=... — info about a single workspace
app.get("/api/workspaces/info", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const linked = getLinked(projectId);
  if (linked) {
    res.json({ ...linked, isLinked: true });
  } else {
    const dir = getWorkDir(projectId);
    res.json({
      id: projectId,
      name: path.basename(dir),
      absolutePath: dir,
      isLinked: false,
      exists: fs.existsSync(dir),
    });
  }
});

// POST /api/project/seed-config — write missing config files into a project
app.post("/api/project/seed-config", (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });

  try {
    const report = seedMissingConfigs(workDir);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/project/detect-framework — return the detected framework type
app.get("/api/project/detect-framework", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });

  const framework = detectFramework(workDir);
  res.json({ framework });
});

// ── Project Scripts (for Run/Debug panel) ───────────────────────────
// GET /api/project/scripts — read package.json scripts
app.get("/api/project/scripts", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getWorkDir(projectId);
  const pkgPath = path.join(workDir, "package.json");
  if (!fs.existsSync(pkgPath)) return res.json({ scripts: {}, hasPackageJson: false });
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    res.json({
      scripts: pkg.scripts || {},
      hasPackageJson: true,
      name: pkg.name,
      version: pkg.version,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cleanup on shutdown
process.on("SIGTERM", () => { stopAllDevServers(); activePtys.forEach(p => p.kill()); process.exit(0); });
process.on("SIGINT", () => { stopAllDevServers(); activePtys.forEach(p => p.kill()); process.exit(0); });

app.listen(PORT, () => {
  console.log(`[agent-server] Running on http://localhost:${PORT}`);
  console.log(`[agent-server] Workspace base: ${WORKSPACE_BASE}`);
  console.log(`[agent-server] ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL || "(not set)"}`);
  console.log(`[agent-server] ANTHROPIC_AUTH_TOKEN: ${process.env.ANTHROPIC_AUTH_TOKEN ? "set" : "(NOT SET)"}`);
  console.log(`[agent-server] ANTHROPIC_API_KEY: "${process.env.ANTHROPIC_API_KEY || ""}"`);
  console.log(`[agent-server] ANTHROPIC_DEFAULT_SONNET_MODEL: ${process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "(not set)"}`);
  console.log(`[agent-server] ANTHROPIC_DEFAULT_OPUS_MODEL: ${process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || "(not set)"}`);
  console.log(`[agent-server] ANTHROPIC_DEFAULT_HAIKU_MODEL: ${process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "(not set)"}`);
});
