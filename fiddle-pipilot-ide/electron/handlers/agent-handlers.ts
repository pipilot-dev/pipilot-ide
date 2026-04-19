/**
 * Agent IPC handlers — replaces POST /api/agent and all /api/agent/* endpoints.
 * This is the most critical handler: it drives the AI chat via the Claude Agent SDK.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, WORKSPACE_BASE, CONFIG_DIR } from "./shared";
import {
  runAllChecks, runTypeScriptCheck, ensureNodeModules,
  runPythonCheck, runGoCheck, runRustCheck, runPhpCheck, runRubyCheck,
} from "../../server/diagnostics";
import { seedMissingConfigs, detectFramework } from "../../server/seed-config";
import { CodeSearchIndex } from "../../server/search-index";
import { screenshot as chromeScreenshot, findChrome } from "../../server/screenshot";
import {
  startDevServer, stopDevServer, getDevServerStatus, subscribeToLogs,
} from "../../server/dev-server";

// ── Shared state ──
const activeSessions = new Map<string, { session: any; sessionId: string }>();
const searchIndexes = new Map<string, CodeSearchIndex>();
const pendingInputRequests = new Map<string, { resolve: (answer: any) => void; question: any }>();
const pendingScreenshots = new Map<string, { resolve: (data: { dataUrl: string; layoutReport: string } | null) => void }>();
const activeAbortControllers = new Map<string, AbortController>();
const toolSkipFlags = new Map<string, boolean>();
const activeRequests = new Set<string>();
const streamBuffers = new Map<string, { events: any[]; isActive: boolean; lastActivity: number }>();

// Active SSE send functions per project (for tools that push events)
const activeStreamSend = new Map<string, (data: any) => void>();

function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

function checkToolSkip(projectId: string): boolean {
  if (toolSkipFlags.get(projectId)) {
    toolSkipFlags.delete(projectId);
    return true;
  }
  return false;
}

async function skippableFetch(projectId: string, url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const check = setInterval(() => {
    if (toolSkipFlags.get(projectId)) {
      toolSkipFlags.delete(projectId);
      controller.abort();
    }
  }, 500);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new Error("__TOOL_SKIPPED__ User cancelled this tool. Continue with what you have — do NOT retry this tool unless the user asks.");
    }
    throw err;
  } finally {
    clearInterval(check);
  }
}

function loadJsonSafe(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return {}; }
}

function loadUserMcpServers(workDir: string): Record<string, any> {
  const globalServers = loadJsonSafe(path.join(CONFIG_DIR, "mcp.json")).mcpServers || {};
  const projectServers = loadJsonSafe(path.join(workDir, ".pipilot", "mcp.json")).mcpServers || {};
  return { ...globalServers, ...projectServers };
}

const CONNECTOR_ENV_MAP: Record<string, (token: string) => Record<string, string>> = {
  vercel:     (t) => ({ VERCEL_TOKEN: t }),
  netlify:    (t) => ({ NETLIFY_AUTH_TOKEN: t }),
  npm:        (t) => ({ NPM_TOKEN: t }),
  neon:       (t) => ({ NEON_API_KEY: t }),
  cloudflare: (t) => ({ CLOUDFLARE_API_TOKEN: t }),
  railway:    (t) => ({ RAILWAY_TOKEN: t }),
  turso:      (t) => ({ TURSO_AUTH_TOKEN: t }),
  stripe:     (t) => ({ STRIPE_SECRET_KEY: t }),
  sentry:     (t) => ({ SENTRY_AUTH_TOKEN: t }),
};

function loadConnectorEnvVars(workDir: string): Record<string, string> {
  const envs: Record<string, string> = {};
  const globalConnectors = loadJsonSafe(path.join(CONFIG_DIR, "connectors.json")).connectors || {};
  const projectConnectors = loadJsonSafe(path.join(workDir, ".pipilot", "connectors.json")).connectors || {};
  const merged = { ...globalConnectors, ...projectConnectors };
  for (const [id, cfg] of Object.entries(merged)) {
    const c = cfg as any;
    if (!c.enabled || !c.token) continue;
    const mapper = CONNECTOR_ENV_MAP[id];
    if (mapper) {
      Object.assign(envs, mapper(c.token));
    } else if (c.envVar) {
      envs[c.envVar] = c.token;
    }
  }
  return envs;
}

function getConnectorContext(workDir: string): string {
  try {
    const globalConnectors = loadJsonSafe(path.join(CONFIG_DIR, "connectors.json")).connectors || {};
    const projectConnectors = loadJsonSafe(path.join(workDir, ".pipilot", "connectors.json")).connectors || {};
    const merged = { ...globalConnectors, ...projectConnectors };
    const lines: string[] = [];
    for (const [id, cfg] of Object.entries(merged)) {
      const c = cfg as any;
      if (!c.enabled || !c.token) continue;
      const envName = CONNECTOR_ENV_MAP[id] ? Object.keys(CONNECTOR_ENV_MAP[id](c.token))[0] : c.envVar || "";
      const desc = c.description || "";
      const scope = projectConnectors[id] ? "project" : "global";
      lines.push(`- **${id}**${desc ? ` (${desc})` : ""} [${scope}]: use \`${id}\` CLI commands (token in \`${envName}\`, no login needed)`);
    }
    if (lines.length === 0) return "";
    return `\n## CLI Connectors (pre-authenticated)\nThe following CLI tools are configured with tokens — use them directly via Bash:\n${lines.join("\n")}\n`;
  } catch { return ""; }
}

function getUserMcpAllowedTools(workDir: string): string[] {
  const servers = loadUserMcpServers(workDir);
  return Object.keys(servers).map((k) => `mcp__${k}__*`);
}

// ── IDE Tool Server ──
function createIdeToolServer(projectId: string) {
  const workDir = getWorkDir(projectId);

  const getDiagnostics = tool(
    "get_diagnostics",
    "Run the IDE diagnostics engine on the current project and return all errors, warnings, and info messages. " +
    "Supports TypeScript, Python, Go, Rust, PHP, and Ruby. Use this to find bugs, check for type errors, " +
    "or verify your changes compile correctly. You can filter by source (e.g. 'typescript') or run all checks.",
    {
      source: z.enum(["all", "typescript", "python", "go", "rust", "php", "ruby"]).default("all")
        .describe("Which checker to run. 'all' runs every available checker."),
    },
    async (args) => {
      try {
        if (args.source === "all") {
          const result = await runAllChecks(workDir);
          const diags = result.diagnostics || [];
          if (diags.length === 0) return { content: [{ type: "text" as const, text: "No problems found. All checks passed." }] };
          const summary = diags.map((d: any) =>
            `[${(d.severity || d.type || "error").toUpperCase()}] ${d.file || ""}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""} — ${d.message} (${d.source || "unknown"})`
          ).join("\n");
          return { content: [{ type: "text" as const, text: `Found ${diags.length} problem${diags.length === 1 ? "" : "s"}:\n\n${summary}` }] };
        } else {
          const checkers: Record<string, (w: string) => Promise<any[]>> = {
            typescript: runTypeScriptCheck, python: runPythonCheck,
            go: runGoCheck, rust: runRustCheck, php: runPhpCheck, ruby: runRubyCheck,
          };
          const checker = checkers[args.source];
          if (!checker) return { content: [{ type: "text" as const, text: `Unknown source: ${args.source}` }], isError: true };
          const diags = await checker(workDir);
          if (diags.length === 0) return { content: [{ type: "text" as const, text: `No ${args.source} problems found.` }] };
          const summary = diags.map((d: any) =>
            `[${(d.severity || d.type || "error").toUpperCase()}] ${d.file || ""}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""} — ${d.message}`
          ).join("\n");
          return { content: [{ type: "text" as const, text: `Found ${diags.length} ${args.source} problem${diags.length === 1 ? "" : "s"}:\n\n${summary}` }] };
        }
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Diagnostics failed: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const manageDevServer = tool(
    "manage_dev_server",
    "Manage the project's dev server (Vite, Next.js, Express, etc). " +
    "Actions: 'start' launches the dev server, 'stop' kills it, 'restart' stops then starts, " +
    "'status' checks if it's running and returns the URL and port. " +
    "Use this after modifying config files or when the user asks to preview the project.",
    { action: z.enum(["start", "stop", "restart", "status"]).describe("What to do with the dev server") },
    async (args) => {
      try {
        switch (args.action) {
          case "status": {
            const status = getDevServerStatus(projectId);
            if (!status) return { content: [{ type: "text" as const, text: "Dev server is not running." }] };
            return { content: [{ type: "text" as const, text: `Dev server is running.\n  URL: ${status.url || "unknown"}\n  Port: ${status.port || "unknown"}\n  PID: ${status.pid || "unknown"}\n  Started: ${status.startedAt ? new Date(status.startedAt).toLocaleString() : "unknown"}` }] };
          }
          case "stop": {
            const stopped = stopDevServer(projectId);
            return { content: [{ type: "text" as const, text: stopped ? "Dev server stopped." : "Dev server was not running." }] };
          }
          case "start":
          case "restart": {
            if (args.action === "restart") {
              stopDevServer(projectId);
              await new Promise((r) => setTimeout(r, process.platform === "win32" ? 1500 : 500));
            }
            const result = await startDevServer(projectId, workDir);
            if (!result) return { content: [{ type: "text" as const, text: "Dev server failed to start: no dev command found (missing package.json scripts.dev or scripts.start)." }], isError: true };
            if (result.status === "error") return { content: [{ type: "text" as const, text: "Dev server failed to start: check logs with get_dev_server_logs." }], isError: true };
            if (!result.port) {
              await new Promise((r) => setTimeout(r, 3000));
              const updated = getDevServerStatus(projectId);
              if (updated?.port) { result.port = updated.port; result.url = updated.url; }
            }
            return { content: [{ type: "text" as const, text: result.port ? `Dev server started.\n  URL: ${result.url || `http://localhost:${result.port}`}\n  Port: ${result.port}` : `Dev server is starting (port not yet detected). Use manage_dev_server(action:"status") to check when ready.` }] };
          }
        }
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Dev server error: ${err.message}` }], isError: true };
      }
    },
  );

  const searchNpm = tool(
    "search_npm",
    "Search the npm registry for packages by keyword. Returns package names, descriptions, " +
    "version, weekly downloads, and links. Use this before installing a dependency to find " +
    "the right package name, check popularity, or compare alternatives.",
    {
      query: z.string().describe("Search query (e.g. 'react date picker', 'tailwind animation')"),
      limit: z.number().int().min(1).max(20).default(8).describe("Max results to return"),
    },
    async (args) => {
      try {
        const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(args.query)}&size=${args.limit}`;
        const res = await fetch(url);
        if (!res.ok) return { content: [{ type: "text" as const, text: `npm registry returned ${res.status}: ${res.statusText}` }], isError: true };
        const data = await res.json() as any;
        const results = (data.objects || []).map((obj: any) => {
          const pkg = obj.package;
          const dl = obj.score?.detail?.popularity ? `popularity: ${(obj.score.detail.popularity * 100).toFixed(0)}%` : "";
          return `${pkg.name}@${pkg.version} — ${pkg.description || "(no description)"}${dl ? `  [${dl}]` : ""}\n  npm: https://www.npmjs.com/package/${pkg.name}`;
        });
        if (results.length === 0) return { content: [{ type: "text" as const, text: `No packages found for "${args.query}".` }] };
        return { content: [{ type: "text" as const, text: `Found ${results.length} package${results.length === 1 ? "" : "s"} for "${args.query}":\n\n${results.join("\n\n")}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `npm search failed: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const getDevServerLogs = tool(
    "get_dev_server_logs",
    "Get recent output logs from the project's dev server. Use this to see build errors, " +
    "compilation warnings, or startup messages. Returns the last N lines of combined stdout/stderr.",
    { lines: z.number().int().min(5).max(200).default(50).describe("Number of recent log lines to return") },
    async (args) => {
      try {
        const status = getDevServerStatus(projectId);
        if (!status) return { content: [{ type: "text" as const, text: "Dev server is not running. Start it first with manage_dev_server." }] };
        const bufferedLogs = status.logs || [];
        if (bufferedLogs.length === 0) {
          const liveLines: string[] = [];
          const unsub = subscribeToLogs(projectId, (entry) => { liveLines.push(`[${entry.source}] ${entry.text}`); });
          await new Promise((r) => setTimeout(r, 300));
          unsub();
          if (liveLines.length === 0) return { content: [{ type: "text" as const, text: `Dev server is running (port ${status.port}, PID ${status.pid}) but no log output has been captured yet. Try again in a few seconds.` }] };
          const tail = liveLines.slice(-args.lines);
          return { content: [{ type: "text" as const, text: `Dev server logs (${tail.length} lines, live):\n\n${tail.join("\n")}` }] };
        }
        const tail = bufferedLogs.slice(-args.lines);
        return { content: [{ type: "text" as const, text: `Dev server logs (last ${tail.length} of ${bufferedLogs.length} lines):\n\n${tail.join("\n")}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Failed to read dev server logs: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── update_project_context ──
  const PIPILOT_DIR = path.join(workDir, ".pipilot");
  const PROJECT_MD = path.join(PIPILOT_DIR, "project.md");
  const DESIGN_MD = path.join(PIPILOT_DIR, "design.md");

  function buildFileTreeStr(baseDir: string): string {
    let count = 0;
    const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", ".cache", ".vite", ".pipilot"]);
    function walk(dir: string, prefix: string, depth: number): string {
      if (depth > 5 || count > 200) return "";
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return ""; }
      entries = entries.filter((e) => !SKIP.has(e)).sort();
      let result = "";
      for (let i = 0; i < entries.length && count < 200; i++) {
        const entry = entries[i];
        const full = path.join(dir, entry);
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.isDirectory()) {
          result += `${prefix}${connector}${entry}/\n`;
          result += walk(full, childPrefix, depth + 1);
        } else {
          count++;
          const lc = stat.size < 500000 ? (() => { try { return fs.readFileSync(full, "utf8").split("\n").length; } catch { return 0; } })() : 0;
          result += `${prefix}${connector}${entry}${lc > 0 ? ` (${lc} lines)` : ""}\n`;
        }
      }
      return result;
    }
    return walk(baseDir, "", 0).trimEnd();
  }

  function extractDesignTokens() {
    const cssVars: string[] = [];
    const fontImports: string[] = [];
    const colorValues = new Set<string>();
    function scanDir(dir: string, depth: number) {
      if (depth > 4) return;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        if (["node_modules", ".git", "dist", ".next", "out", ".pipilot"].includes(e)) continue;
        const full = path.join(dir, e);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.isDirectory()) { scanDir(full, depth + 1); continue; }
        if (!e.endsWith(".css") && !e.endsWith(".scss")) continue;
        let content: string;
        try { content = fs.readFileSync(full, "utf8"); } catch { continue; }
        for (const m of content.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) cssVars.push(`--${m[1]}: ${m[2].trim()}`);
        for (const m of content.matchAll(/@import\s+url\(["']([^"']+)["']\)/g)) fontImports.push(m[1]);
        for (const m of content.matchAll(/font-family\s*:\s*["']?([^"';,}]+)/g)) {
          const fam = m[1].trim();
          if (!["inherit", "initial", "unset", "sans-serif", "serif", "monospace"].includes(fam)) fontImports.push(`font-family: ${fam}`);
        }
        for (const m of content.matchAll(/(#[0-9a-fA-F]{3,8}|hsl\([^)]+\)|rgb\([^)]+\))/g)) colorValues.add(m[1]);
      }
    }
    scanDir(workDir, 0);
    return { cssVars: [...new Set(cssVars)], fonts: [...new Set(fontImports)], colors: [...colorValues] };
  }

  const updateProjectContext = tool(
    "update_project_context",
    "Manage the project context file at .pipilot/project.md.\n" +
    "Modes:\n  'read' — Return the existing .pipilot/project.md content.\n  'scan' — Re-scan and overwrite.\n  'write' — Write provided content.",
    {
      action: z.enum(["read", "scan", "write"]).default("scan").describe("'read' returns existing file, 'scan' re-generates, 'write' saves provided content"),
      content: z.string().default("").describe("Content to write (only used with action='write')"),
    },
    async (args) => {
      try {
        if (args.action === "read") {
          if (fs.existsSync(PROJECT_MD)) return { content: [{ type: "text" as const, text: fs.readFileSync(PROJECT_MD, "utf8") }] };
          return { content: [{ type: "text" as const, text: ".pipilot/project.md does not exist yet. Use action='scan' to generate it." }] };
        }
        if (args.action === "write") {
          if (!args.content.trim()) return { content: [{ type: "text" as const, text: "No content provided for write." }], isError: true };
          if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
          fs.writeFileSync(PROJECT_MD, args.content, "utf8");
          return { content: [{ type: "text" as const, text: `Written to .pipilot/project.md (${args.content.length} chars)` }] };
        }
        // SCAN
        if (!fs.existsSync(workDir)) return { content: [{ type: "text" as const, text: "Workspace not found." }], isError: true };
        const framework = detectFramework(workDir);
        const lines: string[] = [];
        let projectName = path.basename(workDir);
        const pkgPath = path.join(workDir, "package.json");
        let pkg: any = {};
        if (fs.existsSync(pkgPath)) {
          try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch {}
          if (pkg.name) projectName = pkg.name;
        }
        lines.push(`# ${projectName}`, "", "## Summary", `${projectName} is a ${framework} project.`, "");
        const techs: string[] = [framework];
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (allDeps["react"]) techs.push("React");
        if (allDeps["next"]) techs.push("Next.js");
        if (allDeps["vue"]) techs.push("Vue");
        if (allDeps["tailwindcss"] || allDeps["@tailwindcss/vite"]) techs.push("Tailwind CSS");
        if (allDeps["typescript"]) techs.push("TypeScript");
        if (allDeps["express"]) techs.push("Express");
        lines.push("## Tech Stack");
        for (const t of techs) lines.push(`- ${t}`);
        lines.push("");
        lines.push("## Features", "_Run with action='write' to add project-specific features._", "");
        if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
          lines.push("## Scripts");
          for (const [name, cmd] of Object.entries(pkg.scripts)) lines.push(`- \`${name}\`: \`${cmd}\``);
          lines.push("");
        }
        const deps = Object.entries(pkg.dependencies || {});
        if (deps.length > 0) {
          lines.push(`## Dependencies (${deps.length})`);
          for (const [name, ver] of deps) lines.push(`- ${name}: ${ver}`);
          lines.push("");
        }
        lines.push("## File Tree", "```", buildFileTreeStr(workDir), "```", "", "---", `*Last Updated: ${new Date().toISOString()}*`);
        const output = lines.join("\n");
        if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
        fs.writeFileSync(PROJECT_MD, output, "utf8");
        return { content: [{ type: "text" as const, text: `Written to .pipilot/project.md\n\n${output}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Context scan failed: ${err.message}` }], isError: true };
      }
    },
  );

  const frontendDesignGuide = tool(
    "frontend_design_guide",
    "Manage the project's design system file at .pipilot/design.md.\nModes:\n  'read' — Return existing.\n  'scan' — Re-extract from CSS.\n  'write' — Write provided content.",
    {
      action: z.enum(["read", "scan", "write"]).default("scan").describe("'read' returns existing, 'scan' re-extracts, 'write' saves provided content"),
      content: z.string().default("").describe("Content to write (only used with action='write')"),
    },
    async (args) => {
      try {
        if (args.action === "read") {
          if (fs.existsSync(DESIGN_MD)) return { content: [{ type: "text" as const, text: fs.readFileSync(DESIGN_MD, "utf8") }] };
          return { content: [{ type: "text" as const, text: ".pipilot/design.md does not exist yet. Use action='scan' to generate it, or action='write' to define a new theme." }] };
        }
        if (args.action === "write") {
          if (!args.content.trim()) return { content: [{ type: "text" as const, text: "No content provided for write." }], isError: true };
          if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
          fs.writeFileSync(DESIGN_MD, args.content, "utf8");
          return { content: [{ type: "text" as const, text: `Written to .pipilot/design.md (${args.content.length} chars).\nThe agent will follow this design system for all future UI work.` }] };
        }
        // SCAN
        const tokens = extractDesignTokens();
        const lines: string[] = [];
        const projectName = (() => { try { const p = path.join(workDir, "package.json"); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")).name || path.basename(workDir); } catch {} return path.basename(workDir); })();
        lines.push(`# ${projectName} — Design System`, "", "> Auto-extracted from project CSS/config files.", "", "---", "", "## 1. Philosophy", "", "_Not yet defined. Use `frontend_design_guide(action:\"write\")` to set the aesthetic direction._", "", "---", "", "## 2. Color Tokens", "");
        if (tokens.cssVars.length > 0) { lines.push("```css", tokens.cssVars.slice(0, 80).join("\n"), "```", ""); }
        if (tokens.colors.length > 0) { lines.push(`**Palette** (${tokens.colors.length} unique values):`, tokens.colors.slice(0, 50).join(", "), ""); }
        lines.push("---", "", "## 3. Typography", "");
        if (tokens.fonts.length > 0) { for (const f of tokens.fonts) lines.push(`- ${f}`); lines.push(""); }
        else { lines.push("_No font declarations found._", ""); }
        lines.push("---", "", `*Last Updated: ${new Date().toISOString()}*`);
        const output = lines.join("\n").slice(0, 12000);
        if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
        fs.writeFileSync(DESIGN_MD, output, "utf8");
        return { content: [{ type: "text" as const, text: `Written to .pipilot/design.md\n\n${output}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Design guide failed: ${err.message}` }], isError: true };
      }
    },
  );

  const analyzeUi = tool(
    "analyze_ui",
    "Deep-analyze a UI component or page to generate a detailed visual description for non-vision models.",
    { file: z.string().default("").describe("File to analyze (e.g. 'src/App.tsx'). Leave empty to auto-detect the main entry.") },
    async (args) => {
      try {
        const targetFiles: { path: string; content: string }[] = [];
        if (args.file) {
          const fp = path.join(workDir, args.file);
          if (!fs.existsSync(fp)) return { content: [{ type: "text" as const, text: `File not found: ${args.file}` }], isError: true };
          targetFiles.push({ path: args.file, content: fs.readFileSync(fp, "utf8") });
        } else {
          const candidates = ["index.html", "src/App.tsx", "src/App.jsx", "src/App.vue", "app/page.tsx", "app/page.jsx", "pages/index.tsx", "pages/index.jsx", "src/main.tsx", "app/layout.tsx"];
          for (const c of candidates) {
            const fp = path.join(workDir, c);
            if (fs.existsSync(fp)) { targetFiles.push({ path: c, content: fs.readFileSync(fp, "utf8") }); if (targetFiles.length >= 3) break; }
          }
        }
        if (targetFiles.length === 0) return { content: [{ type: "text" as const, text: "No HTML/JSX/TSX files found." }], isError: true };

        const lines: string[] = ["# UI VISUAL ANALYSIS", ""];
        for (const tf of targetFiles) {
          const content = tf.content;
          lines.push(`## File: \`${tf.path}\``, "");
          const flexCount = (content.match(/\bflex\b|display:\s*["']?flex/gi) || []).length;
          const gridCount = (content.match(/\bgrid\b|display:\s*["']?grid/gi) || []).length;
          lines.push("### Layout Structure");
          lines.push(`  Flex containers: ${flexCount} | Grid containers: ${gridCount}`);
          lines.push("");
          const allColors = new Set<string>();
          for (const m of content.matchAll(/((?:bg|text|border)-(?:[a-z]+-\d+|black|white|\[#[^\]]+\]))/g)) allColors.add(m[1]);
          for (const m of content.matchAll(/(#[0-9a-fA-F]{3,8}|hsl\([^)]+\)|rgb\([^)]+\))/g)) allColors.add(m[1]);
          if (allColors.size > 0) {
            lines.push("### Colors Used");
            lines.push(`  ${[...allColors].slice(0, 30).join(", ")}`);
            lines.push("");
          }
        }
        return { content: [{ type: "text" as const, text: lines.join("\n").slice(0, 12000) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `UI analysis failed: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const screenshotPreview = tool(
    "screenshot_preview",
    "Capture a visual screenshot of the project's running dev server preview.",
    {},
    async () => {
      try {
        const status = getDevServerStatus(projectId);
        const devUrl = status?.url;
        if (devUrl && findChrome()) {
          try {
            const tmpDir = path.join(os.tmpdir(), "pipilot-uploads");
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const fileName = `screenshot-${projectId}-${Date.now()}.png`;
            const filePath = path.join(tmpDir, fileName);
            const result = await chromeScreenshot(devUrl, filePath, { width: 1440, height: 900 });
            return {
              content: [
                { type: "image" as const, data: result.base64, mimeType: "image/png" },
                { type: "text" as const, text: `Screenshot captured (${result.sizeKB}KB) via headless Chrome.\nSaved: ${result.filePath}\nURL: ${devUrl}\n\nIMPORTANT: Use the Read tool on "${result.filePath}" to view the screenshot image.\n\n${result.analysis}` },
              ],
            };
          } catch {}
        }
        // Frontend capture fallback
        const sseFunc = activeStreamSend.get(projectId);
        if (sseFunc) {
          try {
            const requestId = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const captureResult = await new Promise<{ dataUrl: string; layoutReport: string } | null>((resolve) => {
              pendingScreenshots.set(requestId, { resolve });
              try { sseFunc({ type: "screenshot_request", requestId }); } catch { pendingScreenshots.delete(requestId); resolve(null); }
              setTimeout(() => { if (pendingScreenshots.has(requestId)) { pendingScreenshots.delete(requestId); resolve(null); } }, 15000);
            });
            if (captureResult?.dataUrl) {
              const base64 = captureResult.dataUrl.replace(/^data:image\/png;base64,/, "");
              const tmpDir = path.join(os.tmpdir(), "pipilot-uploads");
              if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
              const filePath = path.join(tmpDir, `screenshot-${projectId}-${Date.now()}.png`);
              fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
              return { content: [{ type: "image" as const, data: base64, mimeType: "image/png" }, { type: "text" as const, text: `Screenshot saved: ${filePath}\n\n${captureResult.layoutReport || ""}` }] };
            }
          } catch {}
        }
        if (devUrl) {
          try {
            const res = await fetch(devUrl, { signal: AbortSignal.timeout(5000) });
            const html = await res.text();
            return { content: [{ type: "text" as const, text: `Dev server HTML (${(html.length / 1024).toFixed(1)}KB) fetched from ${devUrl}\nChrome not available for screenshot.` }] };
          } catch {}
        }
        return { content: [{ type: "text" as const, text: "Dev server is not running. Start it first with manage_dev_server action:'start'." }], isError: true };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Screenshot failed: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const MEMORY_DIR = path.join(workDir, ".pipilot", "memory");
  const MEMORY_INDEX = path.join(MEMORY_DIR, "MEMORY.md");

  const memory = tool(
    "memory",
    "Manage persistent memory for this project. Memory survives across sessions.",
    {
      action: z.enum(["read_index", "read_topic", "write_topic", "append_index", "list_topics"]).describe("What to do"),
      topic: z.string().optional().describe("Topic filename without .md"),
      content: z.string().optional().describe("Content to write"),
    },
    async (args) => {
      try {
        if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
        switch (args.action) {
          case "read_index": {
            if (!fs.existsSync(MEMORY_INDEX)) return { content: [{ type: "text" as const, text: "No memory index exists yet." }] };
            const raw = fs.readFileSync(MEMORY_INDEX, "utf8");
            const lines = raw.split("\n");
            const truncated = lines.length > 200 ? lines.slice(0, 200).join("\n") + "\n\n...[truncated]" : raw;
            return { content: [{ type: "text" as const, text: truncated.slice(0, 25000) }] };
          }
          case "read_topic": {
            if (!args.topic) return { content: [{ type: "text" as const, text: "Error: topic is required" }], isError: true };
            const topicPath = path.join(MEMORY_DIR, `${args.topic}.md`);
            if (!fs.existsSync(topicPath)) return { content: [{ type: "text" as const, text: `Topic '${args.topic}' not found.` }] };
            return { content: [{ type: "text" as const, text: fs.readFileSync(topicPath, "utf8") }] };
          }
          case "write_topic": {
            if (!args.topic || !args.content) return { content: [{ type: "text" as const, text: "Error: topic and content required" }], isError: true };
            const safeTopic = args.topic.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
            fs.writeFileSync(path.join(MEMORY_DIR, `${safeTopic}.md`), args.content, "utf8");
            return { content: [{ type: "text" as const, text: `Memory topic '${safeTopic}' saved.` }] };
          }
          case "append_index": {
            if (!args.content) return { content: [{ type: "text" as const, text: "Error: content is required" }], isError: true };
            const existing = fs.existsSync(MEMORY_INDEX) ? fs.readFileSync(MEMORY_INDEX, "utf8") : "# Project Memory\n\n";
            fs.writeFileSync(MEMORY_INDEX, existing.trimEnd() + "\n" + args.content + "\n", "utf8");
            return { content: [{ type: "text" as const, text: `Appended to MEMORY.md: ${args.content.slice(0, 100)}` }] };
          }
          case "list_topics": {
            const files = fs.existsSync(MEMORY_DIR) ? fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith(".md") && f !== "MEMORY.md") : [];
            if (files.length === 0) return { content: [{ type: "text" as const, text: "No topic files yet." }] };
            const list = files.map((f) => {
              const stat = fs.statSync(path.join(MEMORY_DIR, f));
              return `- ${f.replace(".md", "")} (${(stat.size / 1024).toFixed(1)}KB, updated ${new Date(stat.mtime).toLocaleDateString()})`;
            }).join("\n");
            return { content: [{ type: "text" as const, text: `Memory topics:\n${list}` }] };
          }
        }
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Memory error: ${err.message}` }], isError: true };
      }
    },
  );

  const runInTerminal = tool(
    "run_in_terminal",
    "Send a command to the IDE's integrated terminal panel.",
    { command: z.string().describe("The shell command to run") },
    async (args) => {
      return { content: [{ type: "text" as const, text: `__TERMINAL_CMD__${args.command}__END_TERMINAL_CMD__\nCommand queued for terminal: \`${args.command}\`` }] };
    },
  );

  const searchCodebase = tool(
    "search_codebase",
    "Smart codebase search — combines regex grep, fuzzy file name matching, and symbol search in one tool call.",
    {
      query: z.string().describe("Search query"),
      mode: z.enum(["grep", "files", "symbols", "semantic", "all"]).default("all").describe("Search mode"),
      filePattern: z.string().optional().describe("Optional glob to filter files"),
      maxResults: z.number().optional().default(20).describe("Max results"),
      caseSensitive: z.boolean().optional().default(false).describe("Case-sensitive search"),
    },
    async (args) => {
      const results: { type: string; file: string; line?: number; match: string; context?: string; score: number }[] = [];
      const SKIP = new Set(["node_modules", ".git", ".next", ".cache", "dist", "build", ".pipilot", "__pycache__", ".vite"]);
      const MAX_SIZE = 500 * 1024;
      const listFiles = (dir: string, base = ""): string[] => {
        const out: string[] = [];
        try {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) {
              if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
              out.push(...listFiles(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name));
            } else if (e.isFile()) {
              const rel = base ? `${base}/${e.name}` : e.name;
              if (args.filePattern) {
                const pat = args.filePattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
                if (!new RegExp(pat, "i").test(rel)) continue;
              }
              out.push(rel);
            }
          }
        } catch {}
        return out;
      };
      if (args.mode === "grep" || args.mode === "all") {
        try {
          const flags = args.caseSensitive ? "g" : "gi";
          let re: RegExp;
          try { re = new RegExp(args.query, flags); } catch { re = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags); }
          const files = listFiles(workDir);
          let found = 0;
          for (const rel of files) {
            if (found >= args.maxResults!) break;
            const abs = path.join(workDir, rel);
            try {
              const stat = fs.statSync(abs);
              if (stat.size > MAX_SIZE) continue;
              const content = fs.readFileSync(abs, "utf8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length && found < args.maxResults!; i++) {
                if (re.test(lines[i])) { results.push({ type: "grep", file: rel, line: i + 1, match: lines[i].trim().slice(0, 200), score: 10 }); found++; }
                re.lastIndex = 0;
              }
            } catch {}
          }
        } catch {}
      }
      if (args.mode === "files" || args.mode === "all") {
        try {
          const allFiles = listFiles(workDir);
          const q = args.query.toLowerCase();
          const scored = allFiles.map((f) => {
            const name = path.basename(f).toLowerCase();
            const rel = f.toLowerCase();
            let score = 0;
            if (name === q) score = 100;
            else if (name.startsWith(q)) score = 80;
            else if (name.includes(q)) score = 60;
            else if (rel.includes(q)) score = 40;
            return { file: f, score };
          }).filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, args.maxResults!);
          for (const f of scored) results.push({ type: "file", file: f.file, match: path.basename(f.file), score: f.score });
        } catch {}
      }
      if (args.mode === "semantic" || args.mode === "all") {
        try {
          let index = searchIndexes.get(projectId);
          if (!index) { index = new CodeSearchIndex(workDir); searchIndexes.set(projectId, index); }
          if (!index.getStats().ready) await index.indexProject();
          const semanticResults = index.search(args.query, args.maxResults!);
          for (const sr of semanticResults) results.push({ type: "semantic", file: sr.file, line: sr.startLine, match: sr.snippet.split("\n")[0]?.trim().slice(0, 200) || "", context: `Lines ${sr.startLine}-${sr.endLine}\n${sr.snippet}`, score: sr.score });
        } catch {}
      }
      const seen = new Set<string>();
      const deduped = results.sort((a, b) => b.score - a.score).filter((r) => { const key = `${r.file}:${r.line || 0}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, args.maxResults!);
      if (deduped.length === 0) return { content: [{ type: "text" as const, text: `No results found for "${args.query}"` }] };
      const output = deduped.map((r) => { let line = `[${r.type}] ${r.file}`; if (r.line) line += `:${r.line}`; line += ` — ${r.match}`; if (r.context) line += `\n${r.context}`; return line; }).join("\n\n");
      return { content: [{ type: "text" as const, text: `Found ${deduped.length} results for "${args.query}":\n\n${output}` }] };
    },
  );

  const generateImage = tool(
    "generate_image",
    "Generate an image from a text description and save it to the project's assets/ folder.",
    {
      description: z.string().describe("Vivid, specific description of the image to generate"),
      aspect: z.enum(["16:9", "1:1", "9:16"]).default("16:9").describe("Aspect ratio"),
      fileName: z.string().optional().describe("Output file name without extension"),
    },
    async (args) => {
      try {
        const response = await fetch(`https://api.a0.dev/assets/image?text=${encodeURIComponent(args.description)}&aspect=${args.aspect}`);
        if (!response.ok) return { content: [{ type: "text" as const, text: `Image generation failed: HTTP ${response.status}` }] };
        const contentType = response.headers.get("content-type") || "image/png";
        const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
        const safeName = args.fileName ? args.fileName.replace(/[^a-zA-Z0-9_-]/g, "-") : args.description.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
        const assetsDir = path.join(workDir, "assets");
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
        const filePath = path.join(assetsDir, `${safeName}.${ext}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        return { content: [{ type: "text" as const, text: `Image saved: assets/${safeName}.${ext} (${Math.round(buffer.length / 1024)}KB)` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Image generation error: ${err.message}` }] };
      }
    },
  );

  const multiEdit = tool(
    "multi_edit",
    "Apply multiple edits to a single file atomically. All edits succeed or none do (rollback on failure).",
    {
      file_path: z.string().describe("Absolute path to the file to edit"),
      edits: z.array(z.object({
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional().default(false),
        description: z.string().optional(),
      })).min(1).max(50),
      dry_run: z.boolean().optional().default(false),
    },
    async (args) => {
      try {
        if (!fs.existsSync(args.file_path)) return { content: [{ type: "text" as const, text: `Error: File not found: ${args.file_path}` }], isError: true };
        const original = fs.readFileSync(args.file_path, "utf8");
        let content = original;
        const errors: string[] = [];
        for (let i = 0; i < args.edits.length; i++) {
          const edit = args.edits[i];
          const occurrences = content.split(edit.old_string).length - 1;
          if (occurrences === 0) errors.push(`Edit ${i + 1}: old_string not found in file.`);
          else if (occurrences > 1 && !edit.replace_all) errors.push(`Edit ${i + 1}: old_string found ${occurrences} times — must be unique.`);
        }
        if (errors.length > 0) return { content: [{ type: "text" as const, text: `Multi-edit validation failed:\n\n${errors.map((e) => `- ${e}`).join("\n")}` }], isError: true };
        const editPositions = args.edits.map((edit, i) => ({ ...edit, index: i, position: content.indexOf(edit.old_string) }));
        editPositions.sort((a, b) => b.position - a.position);
        const applied: number[] = [];
        for (const edit of editPositions) {
          if (edit.replace_all) {
            content = content.split(edit.old_string).join(edit.new_string);
          } else {
            const pos = content.indexOf(edit.old_string);
            if (pos === -1) return { content: [{ type: "text" as const, text: `Edit ${edit.index + 1} failed during apply. All edits rolled back.` }], isError: true };
            content = content.slice(0, pos) + edit.new_string + content.slice(pos + edit.old_string.length);
          }
          applied.push(edit.index + 1);
        }
        if (args.dry_run) return { content: [{ type: "text" as const, text: `DRY RUN — ${applied.length} edit(s) would be applied to ${args.file_path}. Set dry_run: false to apply.` }] };
        fs.writeFileSync(args.file_path, content, "utf8");
        return { content: [{ type: "text" as const, text: `Applied ${applied.length} edit(s) to ${args.file_path}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `multi_edit error: ${err.message}` }], isError: true };
      }
    },
  );

  // Deployment tools
  const deployToVercel = tool("deploy_to_vercel", "Deploy the current project to Vercel via direct file upload.",
    { projectName: z.string(), framework: z.string().optional() },
    async (args) => {
      try {
        const workDir2 = getWorkDir(projectId);
        const crypto = await import("crypto");
        const skip = new Set(["node_modules", ".git", ".next", ".cache", "dist", "build", ".vite", ".pipilot", "coverage", ".turbo"]);
        const files: { file: string; sha: string; size: number; data: Buffer }[] = [];
        const walkFiles = (dir: string, prefix: string) => {
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
              const full = path.join(dir, entry.name);
              const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
              if (entry.isDirectory()) { walkFiles(full, rel); } else {
                const stat = fs.statSync(full);
                if (stat.size > 50 * 1024 * 1024) continue;
                const data = fs.readFileSync(full);
                const sha = crypto.createHash("sha1").update(data).digest("hex");
                files.push({ file: rel, sha, size: data.length, data });
              }
            }
          } catch {}
        };
        walkFiles(workDir2, "");
        if (files.length === 0) return { content: [{ type: "text" as const, text: "No files found" }], isError: true };
        const connectorPath = path.join(workDir2, ".pipilot", "connectors.json");
        let token: string | null = null;
        try {
          const data = JSON.parse(fs.readFileSync(connectorPath, "utf8"));
          const c = data.connectors?.vercel;
          token = c?.enabled && c?.token ? c.token : null;
        } catch {}
        if (!token) {
          const globalData = loadJsonSafe(path.join(CONFIG_DIR, "connectors.json"));
          const c = globalData.connectors?.vercel;
          token = c?.enabled && c?.token ? c.token : null;
        }
        if (!token) return { content: [{ type: "text" as const, text: "Vercel not connected. Add your token in the Cloud panel." }], isError: true };
        for (const f of files) {
          await fetch("https://api.vercel.com/v2/files", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "x-vercel-digest": f.sha, "x-vercel-size": String(f.size) }, body: f.data });
        }
        const deployBody: any = { name: args.projectName, files: files.map((f) => ({ file: f.file, sha: f.sha, size: f.size })), projectSettings: {} };
        if (args.framework && args.framework !== "auto") deployBody.projectSettings.framework = args.framework;
        const r = await fetch("https://api.vercel.com/v13/deployments", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(deployBody) });
        const data = await r.json() as any;
        if (data.error) return { content: [{ type: "text" as const, text: `Vercel deploy failed: ${data.error.message || data.error.code}` }], isError: true };
        const url = data.url ? `https://${data.url}` : "";
        return { content: [{ type: "text" as const, text: `Deployed to Vercel!\nURL: ${url}\nStatus: ${data.readyState || "deploying"}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Vercel deploy error: ${err.message}` }], isError: true };
      }
    },
  );

  const checkConnectors = tool("check_connectors", "Check which deployment platform tokens are configured for this project.",
    {},
    async () => {
      try {
        const providers = ["github", "vercel", "supabase", "neon", "netlify", "cloudflare", "npm"];
        const getToken = (connectorId: string): boolean => {
          try {
            const workDir2 = getWorkDir(projectId);
            const p = path.join(workDir2, ".pipilot", "connectors.json");
            if (fs.existsSync(p)) {
              const data = JSON.parse(fs.readFileSync(p, "utf8"));
              const c = data.connectors?.[connectorId];
              if (c?.enabled && c?.token) return true;
            }
          } catch {}
          try {
            const globalData = loadJsonSafe(path.join(CONFIG_DIR, "connectors.json"));
            const c = globalData.connectors?.[connectorId];
            if (c?.enabled && c?.token) return true;
          } catch {}
          return false;
        };
        const lines = providers.map((name) => `${getToken(name) ? "✓" : "✗"} ${name}: ${getToken(name) ? "connected" : "not configured"}`);
        return { content: [{ type: "text" as const, text: `Connector status:\n${lines.join("\n")}\n\nTo add a token, tell the user to open the Cloud panel and configure the connector.` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Failed to check connectors: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } },
  );

  const listDeployments = tool("list_deployments", "List recent deployments for the current project.",
    {},
    async () => {
      try {
        const workDir2 = getWorkDir(projectId);
        const p = path.join(workDir2, ".pipilot", "deployments.json");
        const deployments = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
        if (deployments.length === 0) return { content: [{ type: "text" as const, text: "No deployments found for this project." }] };
        const lines = deployments.slice(0, 15).map((d: any) =>
          `[${d.platform}] ${d.projectName} — ${d.status} — ${d.url || "no URL"} — ${new Date(d.createdAt).toLocaleString()}`
        );
        return { content: [{ type: "text" as const, text: `Recent deployments (${deployments.length}):\n\n${lines.join("\n")}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Failed to list deployments: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } },
  );

  return createSdkMcpServer({
    name: "pipilot",
    version: "1.0.0",
    tools: [
      getDiagnostics, manageDevServer, searchNpm, getDevServerLogs,
      updateProjectContext, frontendDesignGuide, analyzeUi, screenshotPreview,
      memory, runInTerminal, searchCodebase, generateImage,
      multiEdit, deployToVercel, checkConnectors, listDeployments,
    ],
  });
}

export function registerAgentHandlers(ctx: IpcContext) {
  const { post, get, stream } = ctx;

  // POST /api/agent/stop
  post("/api/agent/stop", async ({ body }) => {
    const { projectId } = body || {};
    if (!projectId) throw new Error("projectId required");
    const controller = activeAbortControllers.get(projectId);
    if (controller) {
      controller.abort();
      activeAbortControllers.delete(projectId);
      const buf = streamBuffers.get(projectId);
      if (buf) buf.isActive = false;
      return { success: true, message: "Agent stopped" };
    }
    return { success: false, message: "No active agent for this project" };
  });

  // POST /api/agent/skip-tool
  post("/api/agent/skip-tool", async ({ body }) => {
    const { projectId } = body || {};
    if (!projectId) throw new Error("projectId required");
    toolSkipFlags.set(projectId, true);
    return { success: true };
  });

  // POST /api/agent/answer
  post("/api/agent/answer", async ({ body }) => {
    const { requestId, answer } = body || {};
    if (!requestId) throw new Error("requestId required");
    const pending = pendingInputRequests.get(requestId);
    if (!pending) throw new Error("No pending request found");
    pending.resolve(answer);
    pendingInputRequests.delete(requestId);
    return { success: true };
  });

  // POST /api/screenshot-result
  post("/api/screenshot-result", async ({ body }) => {
    const { requestId, dataUrl, layoutReport } = body || {};
    const pending = pendingScreenshots.get(requestId);
    if (pending) {
      pendingScreenshots.delete(requestId);
      pending.resolve({ dataUrl: dataUrl || "", layoutReport: layoutReport || "" });
      return { ok: true };
    }
    throw new Error("No pending screenshot request with this ID");
  });

  // GET /api/agent/status
  get("/api/agent/status", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");
    const isRunning = activeRequests.has(projectId);
    const buf = streamBuffers.get(projectId);
    return {
      running: isRunning,
      bufferedEvents: buf ? buf.events.length : 0,
      lastActivity: buf ? buf.lastActivity : null,
    };
  });

  // GET /api/agent/sessions
  get("/api/agent/sessions", async () => {
    const sessions: Record<string, string> = {};
    for (const [projectId, { sessionId }] of activeSessions) {
      sessions[projectId] = sessionId;
    }
    return { sessions };
  });

  // GET /api/agent/health
  get("/api/agent/health", async () => {
    return { status: "ok", workspaceBase: WORKSPACE_BASE };
  });

  // GET /api/agent/replay
  get("/api/agent/replay", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");
    const buf = streamBuffers.get(projectId);
    if (!buf || buf.events.length === 0) return { events: [], isActive: false, shouldContinue: false };
    const timeSinceLastActivity = Date.now() - buf.lastActivity;
    const shouldContinue = !buf.isActive && timeSinceLastActivity < 300000;
    return { events: buf.events, isActive: buf.isActive, shouldContinue };
  });

  // GET /api/agent/queue (disabled — client owns the queue)
  get("/api/agent/queue", async () => ({ queue: [], isBusy: false, length: 0, disabled: true }));

  // POST /api/agent/queue (disabled)
  post("/api/agent/queue", async () => ({ queued: false, disabled: true }));

  // ── Main agent streaming endpoint ──
  stream("POST", "/api/agent", async ({ body }, send, done) => {
    const {
      prompt, systemPrompt, files = [],
      sessionId: existingSessionId,
      projectId: requestProjectId,
      mode,
    } = body || {};
    const agentMode: "agent" | "plan" = mode === "plan" ? "plan" : "agent";

    if (!prompt) {
      send({ type: "error", message: "prompt is required" });
      done();
      return;
    }

    const projectWorkspaceId = requestProjectId || existingSessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = existingSessionId || projectWorkspaceId;
    let workDir = getWorkDir(projectWorkspaceId);

    // Initialize buffer
    streamBuffers.set(projectWorkspaceId, { events: [], isActive: true, lastActivity: Date.now() });

    const bufSend = (data: any) => {
      send(data);
      const buf = streamBuffers.get(projectWorkspaceId);
      if (buf) { buf.events.push(data); buf.lastActivity = Date.now(); if (buf.events.length > 500) buf.events.shift(); }
    };

    // Check if busy
    if (activeRequests.has(projectWorkspaceId)) {
      bufSend({ type: "busy", message: "Agent is already running. Client should queue and retry." });
      done();
      return;
    }

    try {
      // Seed workspace
      if (!fs.existsSync(workDir) || fs.readdirSync(workDir).filter((f) => !f.startsWith(".")).length === 0) {
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
        bufSend({ type: "status", message: `Workspace created: ${files.length} files`, sessionId });
      } else {
        bufSend({ type: "status", message: "Using existing workspace", sessionId });
      }

      // Write CLAUDE.md
      try {
        const hasPkgJson = fs.existsSync(path.join(workDir, "package.json"));
        let pkgDeps = "";
        try { if (hasPkgJson) pkgDeps = fs.readFileSync(path.join(workDir, "package.json"), "utf8"); } catch {}
        const isNextJs = pkgDeps.includes('"next"') || fs.existsSync(path.join(workDir, "next.config.mjs")) || fs.existsSync(path.join(workDir, "next.config.js"));
        const isViteReact = pkgDeps.includes('"vite"') || pkgDeps.includes('"@vitejs/') || fs.existsSync(path.join(workDir, "vite.config.ts"));
        const isExpress = pkgDeps.includes('"express"');

        let frameworkSection = "";
        if (isNextJs) {
          frameworkSection = `\n## Framework: Next.js (App Router)\nThis is a FULL-STACK Next.js project.\n- Pages: app/page.jsx, file-based routing\n- Server Components: Default, use 'use client' only when needed\n`;
        } else if (isViteReact) {
          frameworkSection = `\n## Framework: Vite + React\nUse react-router-dom for client-side routing. Components in src/components/.\n`;
        } else if (isExpress) {
          frameworkSection = `\n## Framework: Express.js\nBind to 0.0.0.0: app.listen(3000, '0.0.0.0')\n`;
        } else {
          frameworkSection = `\n## Multi-Page Architecture (Static HTML/CSS/JS)\nUse hash-based routing for multi-page apps.\n`;
        }

        const claudeMd = `# Project Instructions\n\nThis is the project root. ALL files belong here.\n\n## CRITICAL\n- NEVER create a subfolder for the project\n- Create files DIRECTLY here: index.html, package.json, src/, etc.\n\n## Frontend Design Skill\nCreate distinctive, production-grade frontend interfaces. NEVER use Inter/Roboto/Arial. Pick characterful fonts. Cohesive color palette.\n${frameworkSection}\n${systemPrompt ? "\n## Additional Context\n" + systemPrompt : ""}\n`;
        fs.writeFileSync(path.join(workDir, "CLAUDE.md"), claudeMd, "utf8");
      } catch {}
    } catch (err: any) {
      bufSend({ type: "error", message: `Failed to create workspace: ${err.message}` });
      done();
      return;
    }

    // History file
    const pipilotDataDir = path.join(workDir, ".pipilot");
    try { if (!fs.existsSync(pipilotDataDir)) fs.mkdirSync(pipilotDataDir, { recursive: true }); } catch {}
    const HISTORY_FILE = path.join(pipilotDataDir, "_pipilot_history.json");
    const oldHistoryFile = path.join(workDir, ".claude_history.json");
    if (fs.existsSync(oldHistoryFile) && !fs.existsSync(HISTORY_FILE)) {
      try { fs.renameSync(oldHistoryFile, HISTORY_FILE); } catch {}
    }

    activeRequests.add(projectWorkspaceId);
    bufSend({ type: "start", sessionId, timestamp: Date.now() });

    // Build prompt with history
    let fullPrompt = prompt;
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
        const MAX_PAIRS = 3;
        const MAX_MSG_LENGTH = 400;
        const recent = history.slice(-(MAX_PAIRS * 2));
        if (recent.length > 0) {
          const context = recent.map((m: any) => {
            const content = m.content.length > MAX_MSG_LENGTH ? m.content.slice(0, MAX_MSG_LENGTH) + "...[truncated]" : m.content;
            return `${m.role === "user" ? "Human" : "Assistant"}: ${content}`;
          }).join("\n\n");
          fullPrompt = `Previous conversation:\n${context}\n\nCurrent request: ${prompt}`;
        }
      }
    } catch {}

    try {
      const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
      history.push({ role: "user", content: prompt, timestamp: new Date().toISOString() });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch {}

    // Build system prompt
    const pipilotDir = path.join(workDir, ".pipilot");
    const hasProjectMd = fs.existsSync(path.join(pipilotDir, "project.md"));
    const hasDesignMd = fs.existsSync(path.join(pipilotDir, "design.md"));

    let contextBootstrap: string;
    if (!hasProjectMd && !hasDesignMd) {
      contextBootstrap = `## FIRST PRIORITY — Bootstrap Project Context\nRun update_project_context(action:"scan") then frontend_design_guide(action:"scan") BEFORE anything else.`;
    } else if (!hasProjectMd) {
      contextBootstrap = `## FIRST PRIORITY — Generate Project Context\nRun update_project_context(action:"scan") NOW before addressing the user's request.`;
    } else if (!hasDesignMd) {
      contextBootstrap = `## FIRST PRIORITY — Generate Design System\nRun frontend_design_guide(action:"scan") NOW before addressing the user's request.`;
    } else {
      contextBootstrap = `## Project Context & Design System\nBoth .pipilot/project.md and .pipilot/design.md exist.\n- Read .pipilot/project.md for project structure.\n- Read .pipilot/design.md BEFORE writing any UI code.`;
    }

    const buildSystemPrompt = `You are PiPilot Agent building a project in ${workDir}.\n\n${contextBootstrap}\n\n## IDE Tools\n- update_project_context — Read/scan/write .pipilot/project.md\n- frontend_design_guide — Read/scan/write .pipilot/design.md\n- get_diagnostics — Run TypeScript/Python/Go/Rust linters\n- manage_dev_server — Start/stop/restart the dev server\n- get_dev_server_logs — Read dev server output\n- search_npm — Search npm registry\n- analyze_ui — Static HTML/CSS/JSX analysis\n- screenshot_preview — Capture dev server screenshot\n\n## Rules\n- Never create subfolders for the project. Files go in the project root.\n- ALWAYS maintain design consistency — read .pipilot/design.md before any UI work.`;

    const planSystemPrompt = `You are PiPilot Agent in PLAN MODE inside ${workDir}.\n\n${contextBootstrap}\n\n## Your Job\nRESEARCH and PLAN — do NOT write or modify any code.\n- Read existing files to understand the codebase.\n- Produce a clear, ordered, step-by-step implementation plan.\n\nDo NOT call Write, Edit, or any tool that mutates files.\nEnd your response with a section titled "## Plan" containing the numbered steps.`;

    const connectorCtx = getConnectorContext(workDir);

    let memoryCtx = "";
    try {
      const memIdx = path.join(workDir, ".pipilot", "memory", "MEMORY.md");
      if (fs.existsSync(memIdx)) {
        const raw = fs.readFileSync(memIdx, "utf8");
        const lines = raw.split("\n").slice(0, 200).join("\n");
        const capped = lines.length > 25000 ? lines.slice(0, 25000) : lines;
        if (capped.trim()) memoryCtx = `\n## Project Memory\n${capped}\n\nUse the memory tool to read/write topic files.\n`;
      }
    } catch {}

    const agentSystemPrompt = (agentMode === "plan" ? planSystemPrompt : buildSystemPrompt) + connectorCtx + memoryCtx;

    let hasStreamedText = false;
    let assistantText = "";

    activeStreamSend.set(projectWorkspaceId, bufSend);

    const abortController = new AbortController();
    activeAbortControllers.set(projectWorkspaceId, abortController);

    try {
      const isFirstMessage = !activeSessions.has(projectWorkspaceId);
      const ideTools = createIdeToolServer(projectWorkspaceId);

      for await (const message of query({
        prompt: fullPrompt,
        options: {
          systemPrompt: agentSystemPrompt,
          cwd: workDir,
          permissionMode: agentMode === "plan" ? "plan" : "bypassPermissions",
          allowDangerouslySkipPermissions: agentMode !== "plan",
          includePartialMessages: true,
          continue: !isFirstMessage,
          abortController,
          mcpServers: {
            pipilot: ideTools,
            context7: { type: "http" as any, url: "https://mcp.context7.com/mcp" },
            appdeploy: { type: "http" as any, url: "https://api-v2.appdeploy.ai/mcp" },
            deepwiki: { type: "http" as any, url: "https://mcp.deepwiki.com/mcp" },
            "sequential-thinking": { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
            ...loadUserMcpServers(workDir),
          },
          allowedTools: [
            "mcp__pipilot__*", "mcp__context7__*", "mcp__appdeploy__*",
            "mcp__deepwiki__*", "mcp__sequential-thinking__*",
            ...getUserMcpAllowedTools(workDir),
            "Agent",
          ],
          env: {
            ENABLE_TOOL_SEARCH: "auto",
            ...loadConnectorEnvVars(workDir),
          },
          agents: {
            "fullstack-developer": {
              description: "Use this agent for end-to-end feature development spanning DB, API, and frontend.",
              prompt: `You are a senior fullstack developer. Build complete features from database to UI. Technology expertise: React, Next.js, Vue, Node.js, Express, PostgreSQL, TypeScript, REST, GraphQL.`,
              tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
              model: "sonnet" as const,
            },
            "ai-engineer": {
              description: "Use for AI/ML integration — LLM apps, RAG, prompt engineering.",
              prompt: `You are a senior AI engineer. Design LLM integrations, RAG pipelines, and AI features. Expertise: OpenAI API, Anthropic API, LangChain, vector databases.`,
              tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
              model: "sonnet" as const,
            },
            "deployment-engineer": {
              description: "Use when the user wants to deploy — GitHub, Vercel, Netlify, Cloudflare.",
              prompt: `You are a deployment specialist. Check connectors, deploy to appropriate platforms, report live URLs. Always start by calling check_connectors.`,
              tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "mcp__pipilot__deploy_to_vercel", "mcp__pipilot__check_connectors", "mcp__pipilot__list_deployments"],
              model: "sonnet" as const,
            },
            "frontend-designer": {
              description: "Use for building web components, pages, dashboards, or styling UI.",
              prompt: `You are an elite frontend designer. NEVER use Inter/Roboto/Arial. Always read .pipilot/design.md first. Create distinctive, production-grade interfaces.`,
              tools: ["Read", "Write", "Edit", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
              model: "sonnet" as const,
            },
            "wiki-generator": {
              description: "Use when the user asks to generate or update project documentation/wiki.",
              prompt: `You are a Wiki Generator. Scan project codebases and generate structured documentation in .pipilot/wikis/ as Markdown files. Create index.md, architecture.md, modules.md, api.md, setup.md.`,
              tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "mcp__context7__*"],
              mcpServers: ["context7"],
              model: "sonnet" as const,
            },
          },
          canUseTool: async (toolName: string, input: any) => {
            if (toolName === "AskUserQuestion") {
              const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              bufSend({ type: "ask_user", requestId, questions: input.questions });
              const answer = await new Promise<any>((resolve) => {
                pendingInputRequests.set(requestId, { resolve, question: input });
                setTimeout(() => {
                  if (pendingInputRequests.has(requestId)) {
                    pendingInputRequests.delete(requestId);
                    const autoAnswers: Record<string, string> = {};
                    for (const q of input.questions || []) autoAnswers[q.question] = q.options?.[0]?.label || "yes";
                    resolve({ questions: input.questions, answers: autoAnswers });
                  }
                }, 300000);
              });
              return { behavior: "allow", updatedInput: answer };
            }
            if (toolName === "EnterPlanMode" || toolName === "ExitPlanMode") {
              bufSend({ type: "tool_use", name: toolName, id: `plan-${Date.now()}`, input });
              return { behavior: "allow", updatedInput: input };
            }
            return { behavior: "allow", updatedInput: input };
          },
        },
      })) {
        const msg = message as any;

        if (msg.session_id && !activeSessions.has(projectWorkspaceId)) {
          activeSessions.set(projectWorkspaceId, { session: null, sessionId: msg.session_id });
        }

        if (msg.type === "stream_event") {
          const event = msg.event;
          if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
            hasStreamedText = true;
            assistantText += event.delta.text;
            bufSend({ type: "text", data: event.delta.text });
          }
          if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
            bufSend({ type: "tool_use", name: event.content_block.name, id: event.content_block.id });
          }
        } else if (msg.type === "partial_assistant") {
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text) { hasStreamedText = true; bufSend({ type: "text", data: block.text }); }
            }
          }
        } else if (msg.type === "assistant") {
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text && !hasStreamedText) bufSend({ type: "text", data: block.text });
              if (block.type === "tool_use") bufSend({ type: "tool_use", name: block.name, id: block.id, input: block.input });
            }
            hasStreamedText = false;
          }
        } else if (msg.type === "user") {
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_result") {
                const resultText = typeof block.content === "string" ? block.content : Array.isArray(block.content) ? block.content.map((c: any) => c.type === "text" ? c.text : `[${c.type}]`).join("\n") : JSON.stringify(block.content);
                bufSend({ type: "tool_result", tool_use_id: block.tool_use_id, result: (resultText || "").substring(0, 3000) });
              }
            }
          }
        } else if (msg.type === "result") {
          if (msg.result && !assistantText) assistantText = msg.result;
          bufSend({ type: "result", subtype: msg.subtype, result: msg.result, cost: msg.total_cost_usd, sessionId });
        }
      }

      try {
        const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
        history.push({ role: "assistant", content: assistantText || "(tool use only)", timestamp: new Date().toISOString() });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      } catch {}

      bufSend({ type: "complete", sessionId });
    } catch (err: any) {
      if (/abort/i.test(err.message)) {
        console.log(`[agent] Session ${sessionId} aborted`);
      } else {
        console.error(`[agent] Session ${sessionId} error:`, err.message);
      }
      bufSend({ type: "error", message: err.message || "Agent error" });
    }

    const buf = streamBuffers.get(projectWorkspaceId);
    if (buf) buf.isActive = false;
    activeAbortControllers.delete(projectWorkspaceId);
    activeRequests.delete(projectWorkspaceId);
    activeStreamSend.delete(projectWorkspaceId);

    bufSend({ type: "done" });
    done();
  });
}
