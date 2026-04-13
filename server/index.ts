// Load .env first — all Agent SDK config comes from environment variables
import "dotenv/config";

// ── Prevent EPIPE crashes ──
// When the client disconnects mid-stream (page refresh), the SSE response
// socket is destroyed. Any subsequent write to it emits an unhandled
// 'error' event with code EPIPE, which crashes the process. Catch it here.
process.on("uncaughtException", (err: any) => {
  if (err?.code === "EPIPE" || err?.code === "ERR_STREAM_DESTROYED" || err?.code === "ERR_STREAM_WRITE_AFTER_END") {
    // Expected on client disconnect — ignore silently
    return;
  }
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

import express from "express";
import cors from "cors";
import { query, unstable_v2_createSession, unstable_v2_resumeSession, tool, createSdkMcpServer, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import chokidar from "chokidar";
import { startDevServer, stopDevServer, getDevServerStatus, stopAllDevServers, subscribeToLogs } from "./dev-server";
import * as pty from "node-pty";
import * as gitOps from "./git";
import {
  runAllChecks, runTypeScriptCheck, ensureNodeModules,
  runPythonCheck, runGoCheck, runRustCheck, runPhpCheck, runRubyCheck,
} from "./diagnostics";
import { seedMissingConfigs, detectFramework } from "./seed-config";
import {
  initWorkspaces, resolveWorkspaceDir, linkFolder, unlinkFolder,
  listLinked, touchLinked, isLinked, getLinked,
} from "./workspaces";
import {
  initCheckpoints, createCheckpoint, listCheckpoints, getCheckpoint,
  findCheckpointBeforeMessage as findCheckpointBeforeMessageFn,
  restoreCheckpoint, deleteCheckpoint, clearProjectCheckpoints,
} from "./checkpoints";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
app.use(cors());
// Bumped to 1gb so drag-and-drop binary uploads (images, fonts, archives,
// even small video clips) inflated by base64 (~33% overhead) fit comfortably.
app.use(express.json({ limit: "1gb" }));

const PORT = process.env.PORT || 3001;
// Workspaces live in the project root, not in temp
const WORKSPACE_BASE = path.join(process.cwd(), "workspaces");

// Initialize the linked-workspaces registry (Open Folder feature)
initWorkspaces({ workspaceBase: WORKSPACE_BASE });

// Initialize the checkpoints data dir (separate from workspace files)
initCheckpoints({ dataDir: path.join(process.cwd(), ".pipilot-data", "checkpoints") });

/**
 * Resolve a projectId to its absolute working directory.
 * If the project is a linked folder, returns the linked path; otherwise
 * returns WORKSPACE_BASE/projectId. Use this everywhere instead of
 * getWorkDir(projectId).
 */
function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

// ── Custom MCP tools for the PiPilot Agent ──────────────────────────
// These give the agent capabilities beyond the built-in Claude Code tools
// by tapping into the IDE's own infrastructure (diagnostics engine,
// dev server manager, npm registry).

/** Build a per-project MCP server with custom IDE tools. */
function createIdeToolServer(projectId: string) {
  const workDir = getWorkDir(projectId);

  // ── get_diagnostics ──
  // Runs the IDE's real diagnostics engine (TypeScript, Python, Go, Rust,
  // PHP, Ruby) and returns structured errors/warnings. The agent can see
  // problems without the user pasting anything.
  const getDiagnostics = tool(
    "get_diagnostics",
    "Run the IDE diagnostics engine on the current project and return all errors, warnings, and info messages. " +
    "Supports TypeScript, Python, Go, Rust, PHP, and Ruby. Use this to find bugs, check for type errors, " +
    "or verify your changes compile correctly. You can filter by source (e.g. 'typescript') or run all checks.",
    {
      source: z
        .enum(["all", "typescript", "python", "go", "rust", "php", "ruby"])
        .default("all")
        .describe("Which checker to run. 'all' runs every available checker."),
    },
    async (args) => {
      try {
        if (args.source === "all") {
          const result = await runAllChecks(workDir);
          const diags = result.diagnostics || [];
          if (diags.length === 0) {
            return { content: [{ type: "text" as const, text: "No problems found. All checks passed." }] };
          }
          const summary = diags.map((d: any) =>
            `[${(d.severity || d.type || "error").toUpperCase()}] ${d.file || ""}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""} — ${d.message} (${d.source || "unknown"})`
          ).join("\n");
          return {
            content: [{
              type: "text" as const,
              text: `Found ${diags.length} problem${diags.length === 1 ? "" : "s"}:\n\n${summary}`,
            }],
          };
        } else {
          const checkers: Record<string, (w: string) => Promise<any[]>> = {
            typescript: runTypeScriptCheck,
            python: runPythonCheck,
            go: runGoCheck,
            rust: runRustCheck,
            php: runPhpCheck,
            ruby: runRubyCheck,
          };
          const checker = checkers[args.source];
          if (!checker) {
            return { content: [{ type: "text" as const, text: `Unknown source: ${args.source}` }], isError: true };
          }
          const diags = await checker(workDir);
          if (diags.length === 0) {
            return { content: [{ type: "text" as const, text: `No ${args.source} problems found.` }] };
          }
          const summary = diags.map((d: any) =>
            `[${(d.severity || d.type || "error").toUpperCase()}] ${d.file || ""}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""} — ${d.message}`
          ).join("\n");
          return {
            content: [{
              type: "text" as const,
              text: `Found ${diags.length} ${args.source} problem${diags.length === 1 ? "" : "s"}:\n\n${summary}`,
            }],
          };
        }
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Diagnostics failed: ${err.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── manage_dev_server ──
  // Start, stop, restart the project's dev server and check its status.
  const manageDevServer = tool(
    "manage_dev_server",
    "Manage the project's dev server (Vite, Next.js, Express, etc). " +
    "Actions: 'start' launches the dev server, 'stop' kills it, 'restart' stops then starts, " +
    "'status' checks if it's running and returns the URL and port. " +
    "Use this after modifying config files or when the user asks to preview the project.",
    {
      action: z.enum(["start", "stop", "restart", "status"]).describe("What to do with the dev server"),
    },
    async (args) => {
      try {
        switch (args.action) {
          case "status": {
            const status = getDevServerStatus(projectId);
            if (!status) {
              return { content: [{ type: "text" as const, text: "Dev server is not running." }] };
            }
            return {
              content: [{
                type: "text" as const,
                text: `Dev server is running.\n  URL: ${status.url || "unknown"}\n  Port: ${status.port || "unknown"}\n  PID: ${status.pid || "unknown"}\n  Started: ${status.startedAt ? new Date(status.startedAt).toLocaleString() : "unknown"}`,
              }],
            };
          }
          case "stop": {
            const stopped = stopDevServer(projectId);
            return {
              content: [{ type: "text" as const, text: stopped ? "Dev server stopped." : "Dev server was not running." }],
            };
          }
          case "start":
          case "restart": {
            if (args.action === "restart") {
              stopDevServer(projectId);
            }
            const result = await startDevServer(projectId, workDir);
            if (!result) {
              return {
                content: [{ type: "text" as const, text: "Dev server failed to start: no dev command found (missing package.json scripts.dev or scripts.start)." }],
                isError: true,
              };
            }
            if (result.status === "error") {
              return {
                content: [{ type: "text" as const, text: `Dev server failed to start: check logs with get_dev_server_logs.` }],
                isError: true,
              };
            }
            // Server is starting/running — wait briefly for port detection
            if (!result.port) {
              await new Promise((r) => setTimeout(r, 3000));
              const updated = getDevServerStatus(projectId);
              if (updated?.port) {
                result.port = updated.port;
                result.url = updated.url;
              }
            }
            return {
              content: [{
                type: "text" as const,
                text: result.port
                  ? `Dev server started.\n  URL: ${result.url || `http://localhost:${result.port}`}\n  Port: ${result.port}`
                  : `Dev server is starting (port not yet detected). Use manage_dev_server(action:"status") to check when ready.`,
              }],
            };
          }
        }
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Dev server error: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  // ── search_npm ──
  // Search the npm registry by keyword. Agent picks the right package
  // before running `npm install`.
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
        if (!res.ok) {
          return {
            content: [{ type: "text" as const, text: `npm registry returned ${res.status}: ${res.statusText}` }],
            isError: true,
          };
        }
        const data = await res.json() as any;
        const results = (data.objects || []).map((obj: any) => {
          const pkg = obj.package;
          const dl = obj.score?.detail?.popularity
            ? `popularity: ${(obj.score.detail.popularity * 100).toFixed(0)}%`
            : "";
          return `${pkg.name}@${pkg.version} — ${pkg.description || "(no description)"}${dl ? `  [${dl}]` : ""}\n  npm: https://www.npmjs.com/package/${pkg.name}`;
        });
        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: `No packages found for "${args.query}".` }] };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Found ${results.length} package${results.length === 1 ? "" : "s"} for "${args.query}":\n\n${results.join("\n\n")}`,
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `npm search failed: ${err.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── get_dev_server_logs ──
  // Read the most recent output from the running dev server.
  const getDevServerLogs = tool(
    "get_dev_server_logs",
    "Get recent output logs from the project's dev server. Use this to see build errors, " +
    "compilation warnings, or startup messages. Returns the last N lines of combined stdout/stderr.",
    {
      lines: z.number().int().min(5).max(200).default(50).describe("Number of recent log lines to return"),
    },
    async (args) => {
      try {
        const status = getDevServerStatus(projectId);
        if (!status) {
          return { content: [{ type: "text" as const, text: "Dev server is not running. Start it first with manage_dev_server." }] };
        }

        // Collect logs via a short-lived subscriber
        const logLines: string[] = [];
        const unsub = subscribeToLogs(projectId, (line) => {
          logLines.push(line);
        });
        // Give a tiny window for buffered logs
        await new Promise((r) => setTimeout(r, 100));
        unsub();

        // If no lines collected from the live subscriber, try reading from
        // the server's internal buffer if available
        if (logLines.length === 0) {
          return { content: [{ type: "text" as const, text: "Dev server is running but no recent log output was captured." }] };
        }

        const tail = logLines.slice(-args.lines);
        return {
          content: [{
            type: "text" as const,
            text: `Dev server logs (last ${tail.length} line${tail.length === 1 ? "" : "s"}):\n\n${tail.join("\n")}`,
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to read dev server logs: ${err.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── update_project_context ──
  // Scans the project files and returns a rich context summary: framework,
  // file tree, dependencies, entry points, config files, etc.
  const PIPILOT_DIR = path.join(workDir, ".pipilot");
  const PROJECT_MD = path.join(PIPILOT_DIR, "project.md");
  const DESIGN_MD = path.join(PIPILOT_DIR, "design.md");

  // Helper: build a file tree string
  function buildFileTree(baseDir: string): string {
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
          const lc = stat.size < 500000
            ? (() => { try { return fs.readFileSync(full, "utf8").split("\n").length; } catch { return 0; } })()
            : 0;
          result += `${prefix}${connector}${entry}${lc > 0 ? ` (${lc} lines)` : ""}\n`;
        }
      }
      return result;
    }
    return walk(baseDir, "", 0).trimEnd();
  }

  // Helper: scan CSS files for design tokens
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
        for (const m of content.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g))
          cssVars.push(`--${m[1]}: ${m[2].trim()}`);
        for (const m of content.matchAll(/@import\s+url\(["']([^"']+)["']\)/g))
          fontImports.push(m[1]);
        for (const m of content.matchAll(/font-family\s*:\s*["']?([^"';,}]+)/g)) {
          const fam = m[1].trim();
          if (!["inherit", "initial", "unset", "sans-serif", "serif", "monospace"].includes(fam))
            fontImports.push(`font-family: ${fam}`);
        }
        for (const m of content.matchAll(/(#[0-9a-fA-F]{3,8}|hsl\([^)]+\)|rgb\([^)]+\))/g))
          colorValues.add(m[1]);
      }
    }
    scanDir(workDir, 0);
    return {
      cssVars: [...new Set(cssVars)],
      fonts: [...new Set(fontImports)],
      colors: [...colorValues],
    };
  }

  // ── update_project_context ──
  // Supports 3 modes: "read" (return existing), "scan" (re-scan + overwrite),
  // "write" (write caller-provided content).
  const updateProjectContext = tool(
    "update_project_context",
    "Manage the project context file at .pipilot/project.md.\n" +
    "Modes:\n" +
    "  'read'  — Return the existing .pipilot/project.md content (fast, no scan).\n" +
    "  'scan'  — Re-scan the workspace (framework, deps, tree, key files) and overwrite .pipilot/project.md.\n" +
    "  'write' — Write the provided `content` string to .pipilot/project.md (for manual edits/updates).\n\n" +
    "The file persists across sessions so the agent remembers the project without re-scanning.\n" +
    "Use 'read' first to check existing context. Use 'scan' on first run or after big changes. " +
    "Use 'write' to add custom sections (summary, features, roadmap, key files table).",
    {
      action: z.enum(["read", "scan", "write"]).default("scan")
        .describe("'read' returns existing file, 'scan' re-generates from workspace, 'write' saves provided content"),
      content: z.string().default("")
        .describe("Content to write (only used with action='write')"),
    },
    async (args) => {
      try {
        // ── READ ──
        if (args.action === "read") {
          if (fs.existsSync(PROJECT_MD)) {
            const existing = fs.readFileSync(PROJECT_MD, "utf8");
            return { content: [{ type: "text" as const, text: existing }] };
          }
          return { content: [{ type: "text" as const, text: ".pipilot/project.md does not exist yet. Use action='scan' to generate it." }] };
        }

        // ── WRITE ──
        if (args.action === "write") {
          if (!args.content.trim()) {
            return { content: [{ type: "text" as const, text: "No content provided for write." }], isError: true };
          }
          if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
          fs.writeFileSync(PROJECT_MD, args.content, "utf8");
          return { content: [{ type: "text" as const, text: `Written to .pipilot/project.md (${args.content.length} chars)` }] };
        }

        // ── SCAN ──
        if (!fs.existsSync(workDir)) {
          return { content: [{ type: "text" as const, text: "Workspace not found." }], isError: true };
        }
        const framework = detectFramework(workDir);
        const lines: string[] = [];

        // Header
        let projectName = path.basename(workDir);
        const pkgPath = path.join(workDir, "package.json");
        let pkg: any = {};
        if (fs.existsSync(pkgPath)) {
          try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch {}
          if (pkg.name) projectName = pkg.name;
        }
        lines.push(`# ${projectName}`);
        lines.push("");
        lines.push("## Summary");
        lines.push(`${projectName} is a ${framework} project.`);
        lines.push("");

        // Tech stack
        const techs: string[] = [framework];
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (allDeps["react"]) techs.push("React");
        if (allDeps["next"]) techs.push("Next.js");
        if (allDeps["vue"]) techs.push("Vue");
        if (allDeps["angular"]) techs.push("Angular");
        if (allDeps["tailwindcss"] || allDeps["@tailwindcss/vite"]) techs.push("Tailwind CSS");
        if (allDeps["typescript"]) techs.push("TypeScript");
        if (allDeps["express"]) techs.push("Express");
        if (allDeps["prisma"] || allDeps["@prisma/client"]) techs.push("Prisma");
        if (allDeps["drizzle-orm"]) techs.push("Drizzle");
        if (allDeps["zustand"]) techs.push("Zustand");
        if (allDeps["@tanstack/react-query"]) techs.push("React Query");
        lines.push("## Tech Stack");
        for (const t of techs) lines.push(`- ${t}`);
        lines.push("");

        // Features — placeholder for AI to fill in
        lines.push("## Features");
        lines.push("_Run with action='write' to add project-specific features._");
        lines.push("");

        // Scripts
        if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
          lines.push("## Scripts");
          for (const [name, cmd] of Object.entries(pkg.scripts)) {
            lines.push(`- \`${name}\`: \`${cmd}\``);
          }
          lines.push("");
        }

        // Dependencies
        const deps = Object.entries(pkg.dependencies || {});
        const devDeps = Object.entries(pkg.devDependencies || {});
        if (deps.length > 0) {
          lines.push(`## Dependencies (${deps.length})`);
          for (const [name, ver] of deps) lines.push(`- ${name}: ${ver}`);
          lines.push("");
        }
        if (devDeps.length > 0) {
          lines.push(`## Dev Dependencies (${devDeps.length})`);
          for (const [name, ver] of devDeps) lines.push(`- ${name}: ${ver}`);
          lines.push("");
        }

        // Key files — auto-detect important ones
        const keyFiles: { file: string; purpose: string }[] = [];
        const keyFileCandidates: [string, string][] = [
          ["src/App.tsx", "Main application component"],
          ["src/App.jsx", "Main application component"],
          ["app/layout.tsx", "Root layout (Next.js App Router)"],
          ["app/page.tsx", "Home page (Next.js App Router)"],
          ["pages/index.tsx", "Home page (Next.js Pages Router)"],
          ["src/main.tsx", "Application entry point"],
          ["src/main.jsx", "Application entry point"],
          ["index.html", "HTML entry point"],
          ["package.json", "Dependencies and scripts"],
          ["vite.config.ts", "Vite configuration"],
          ["next.config.mjs", "Next.js configuration"],
          ["tailwind.config.js", "Tailwind CSS configuration"],
          ["tailwind.config.ts", "Tailwind CSS configuration"],
          ["tsconfig.json", "TypeScript configuration"],
          ["src/index.css", "Global stylesheet"],
          ["app/globals.css", "Global stylesheet"],
        ];
        for (const [file, purpose] of keyFileCandidates) {
          const fp = path.join(workDir, file);
          if (fs.existsSync(fp)) {
            const stat = fs.statSync(fp);
            const lc = stat.size < 500000
              ? (() => { try { return fs.readFileSync(fp, "utf8").split("\n").length; } catch { return 0; } })()
              : 0;
            keyFiles.push({ file: `\`${file}\`${lc > 0 ? ` (${lc} lines)` : ""}`, purpose });
          }
        }
        if (keyFiles.length > 0) {
          lines.push("## Key Files");
          lines.push("| File | Purpose |");
          lines.push("|------|---------|");
          for (const kf of keyFiles) lines.push(`| ${kf.file} | ${kf.purpose} |`);
          lines.push("");
        }

        // Config files
        const configFiles = [
          "tsconfig.json", "vite.config.ts", "vite.config.js",
          "next.config.mjs", "next.config.js", "tailwind.config.js",
          "tailwind.config.ts", "postcss.config.js", "eslint.config.js",
          ".gitignore", ".env", ".env.local", "angular.json",
        ];
        const found = configFiles.filter((f) => fs.existsSync(path.join(workDir, f)));
        if (found.length > 0) {
          lines.push("## Config Files");
          for (const f of found) lines.push(`- ${f}`);
          lines.push("");
        }

        // File tree
        lines.push("## File Tree");
        lines.push("```");
        lines.push(buildFileTree(workDir));
        lines.push("```");
        lines.push("");
        lines.push("---");
        lines.push(`*Last Updated: ${new Date().toISOString()}*`);

        const output = lines.join("\n");
        if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
        fs.writeFileSync(PROJECT_MD, output, "utf8");
        return { content: [{ type: "text" as const, text: `Written to .pipilot/project.md\n\n${output}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Context scan failed: ${err.message}` }], isError: true };
      }
    },
  );

  // ── frontend_design_guide ──
  // Supports 3 modes: "read" (return existing design.md), "scan" (extract
  // from CSS/Tailwind + overwrite), "write" (write caller-provided theme).
  const frontendDesignGuide = tool(
    "frontend_design_guide",
    "Manage the project's design system file at .pipilot/design.md.\n" +
    "Modes:\n" +
    "  'read'  — Return the existing .pipilot/design.md (fast, no scan).\n" +
    "  'scan'  — Re-extract the design system from CSS/Tailwind files and overwrite .pipilot/design.md.\n" +
    "  'write' — Write the provided `content` to .pipilot/design.md (for setting a new theme, " +
    "updating the design direction, or switching aesthetics).\n\n" +
    "Use 'read' first to see the current design system. Use 'scan' after CSS changes. " +
    "Use 'write' to define a new design theme from scratch or switch the entire aesthetic direction " +
    "(e.g. from minimalist to brutalist). The agent reads this file before writing UI code.",
    {
      action: z.enum(["read", "scan", "write"]).default("scan")
        .describe("'read' returns existing file, 'scan' re-extracts from CSS, 'write' saves provided content"),
      content: z.string().default("")
        .describe("Content to write (only used with action='write'). Can be a full design system spec, " +
          "color palette, typography rules, or aesthetic direction."),
    },
    async (args) => {
      try {
        // ── READ ──
        if (args.action === "read") {
          if (fs.existsSync(DESIGN_MD)) {
            const existing = fs.readFileSync(DESIGN_MD, "utf8");
            return { content: [{ type: "text" as const, text: existing }] };
          }
          return { content: [{ type: "text" as const, text: ".pipilot/design.md does not exist yet. Use action='scan' to generate it, or action='write' to define a new theme." }] };
        }

        // ── WRITE ──
        if (args.action === "write") {
          if (!args.content.trim()) {
            return { content: [{ type: "text" as const, text: "No content provided for write." }], isError: true };
          }
          if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
          fs.writeFileSync(DESIGN_MD, args.content, "utf8");
          return { content: [{ type: "text" as const, text: `Written to .pipilot/design.md (${args.content.length} chars).\nThe agent will follow this design system for all future UI work.` }] };
        }

        // ── SCAN ──
        const projectName = (() => {
          try {
            const p = path.join(workDir, "package.json");
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")).name || path.basename(workDir);
          } catch {}
          return path.basename(workDir);
        })();

        const tokens = extractDesignTokens();
        const lines: string[] = [];

        // ── Header + philosophy ──
        lines.push(`# ${projectName} — Design System`);
        lines.push("");
        lines.push("> Auto-extracted from project CSS/config files.");
        lines.push("> This is the source of truth for visual design. Read this before writing or modifying any UI.");
        lines.push("");
        lines.push("---");
        lines.push("");

        // ── 1. Philosophy (placeholder for the agent to fill) ──
        lines.push("## 1. Philosophy");
        lines.push("");
        lines.push("_Not yet defined. Use `frontend_design_guide(action:\"write\")` to set the aesthetic direction,_");
        lines.push("_describe the visual tone, and establish design principles._");
        lines.push("");
        lines.push("---");
        lines.push("");

        // ── 2. Color tokens ──
        lines.push("## 2. Color Tokens");
        lines.push("");
        if (tokens.cssVars.length > 0) {
          lines.push("```css");
          lines.push(tokens.cssVars.slice(0, 80).join("\n"));
          lines.push("```");
          lines.push("");
        }
        if (tokens.colors.length > 0) {
          lines.push(`**Palette** (${tokens.colors.length} unique values):`);
          lines.push(tokens.colors.slice(0, 50).join(", "));
          lines.push("");
        }
        if (tokens.cssVars.length === 0 && tokens.colors.length === 0) {
          lines.push("_No color tokens found in CSS files._");
          lines.push("");
        }
        lines.push("---");
        lines.push("");

        // ── 3. Typography ──
        lines.push("## 3. Typography");
        lines.push("");
        if (tokens.fonts.length > 0) {
          for (const f of tokens.fonts) lines.push(`- ${f}`);
          lines.push("");
        } else {
          lines.push("_No font declarations found._");
          lines.push("");
        }
        lines.push("---");
        lines.push("");

        // ── 4. Tailwind config ──
        const twConfigs = ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs"];
        let hasTailwind = false;
        for (const twFile of twConfigs) {
          const twPath = path.join(workDir, twFile);
          if (fs.existsSync(twPath)) {
            hasTailwind = true;
            lines.push(`## 4. Tailwind Config (\`${twFile}\`)`);
            lines.push("");
            lines.push("```js");
            lines.push(fs.readFileSync(twPath, "utf8").slice(0, 3000));
            lines.push("```");
            lines.push("");
            break;
          }
        }
        if (!hasTailwind) {
          lines.push("## 4. Tailwind Config");
          lines.push("");
          lines.push("_No Tailwind config found._");
          lines.push("");
        }
        lines.push("---");
        lines.push("");

        // ── 5. Main stylesheet ──
        const mainCssCandidates = [
          "src/index.css", "src/globals.css", "app/globals.css",
          "styles/globals.css", "src/App.css", "src/styles.css",
        ];
        let hasMainCss = false;
        for (const cssEntry of mainCssCandidates) {
          const cssPath = path.join(workDir, cssEntry);
          if (fs.existsSync(cssPath)) {
            hasMainCss = true;
            const cssContent = fs.readFileSync(cssPath, "utf8");
            lines.push(`## 5. Main Stylesheet (\`${cssEntry}\`)`);
            lines.push("");
            lines.push("```css");
            lines.push(cssContent.slice(0, 3000));
            lines.push("```");
            lines.push("");
            break;
          }
        }
        if (!hasMainCss) {
          lines.push("## 5. Main Stylesheet");
          lines.push("");
          lines.push("_No main stylesheet found._");
          lines.push("");
        }
        lines.push("---");
        lines.push("");

        // ── 6. Component files ──
        const uiComponents: string[] = [];
        function findUiFiles(dir: string, depth: number) {
          if (depth > 3) return;
          let entries: string[];
          try { entries = fs.readdirSync(dir); } catch { return; }
          for (const e of entries) {
            if (["node_modules", ".git", "dist", ".next", "out", ".pipilot"].includes(e)) continue;
            const full = path.join(dir, e);
            try {
              const stat = fs.statSync(full);
              if (stat.isDirectory()) findUiFiles(full, depth + 1);
              else if (/\.(tsx|jsx|vue)$/.test(e)) {
                uiComponents.push(path.relative(workDir, full).replace(/\\/g, "/"));
              }
            } catch {}
          }
        }
        findUiFiles(workDir, 0);
        if (uiComponents.length > 0) {
          lines.push("## 6. UI Component Files");
          lines.push("");
          lines.push("| File |");
          lines.push("|------|");
          for (const f of uiComponents.slice(0, 30)) lines.push(`| \`${f}\` |`);
          if (uiComponents.length > 30) lines.push(`| _...and ${uiComponents.length - 30} more_ |`);
          lines.push("");
        }

        // ── Footer ──
        lines.push("---");
        lines.push(`*Last Updated: ${new Date().toISOString()}*`);

        const output = lines.join("\n").slice(0, 12000);
        if (!fs.existsSync(PIPILOT_DIR)) fs.mkdirSync(PIPILOT_DIR, { recursive: true });
        fs.writeFileSync(DESIGN_MD, output, "utf8");
        return { content: [{ type: "text" as const, text: `Written to .pipilot/design.md\n\n${output}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Design guide failed: ${err.message}` }], isError: true };
      }
    },
  );

  // ── analyze_ui ──
  // Static HTML/CSS analyzer for non-vision models. Reads project files
  // from disk and generates a rich text report of the UI structure, styles,
  // colors, fonts, and layout — giving the agent "eyes" without rendering.
  // Works for static HTML AND framework projects (Vite/Next/Angular) by
  // scanning component files for JSX/HTML structure + CSS classes.
  const analyzeUi = tool(
    "analyze_ui",
    "Deep-analyze a UI component or page to generate a detailed visual description " +
    "that lets non-vision models 'see' the interface. Reports: visual hierarchy (what " +
    "the user sees top-to-bottom), layout structure (flex/grid nesting), every color " +
    "and font used with context, spacing patterns, interactive elements, images, " +
    "accessibility issues, and potential style bugs. " +
    "Works with HTML, React JSX/TSX, Vue, Angular. " +
    "Use this to debug visual issues, verify design consistency, or understand a " +
    "page's appearance before modifying it.",
    {
      file: z.string().default("").describe(
        "File to analyze (e.g. 'src/App.tsx'). Leave empty to auto-detect the main entry."
      ),
    },
    async (args) => {
      try {
        // ── Resolve target files ──
        const targetFiles: { path: string; content: string }[] = [];
        if (args.file) {
          const fp = path.join(workDir, args.file);
          if (!fs.existsSync(fp))
            return { content: [{ type: "text" as const, text: `File not found: ${args.file}` }], isError: true };
          targetFiles.push({ path: args.file, content: fs.readFileSync(fp, "utf8") });
        } else {
          const candidates = [
            "index.html", "src/App.tsx", "src/App.jsx", "src/App.vue",
            "app/page.tsx", "app/page.jsx", "pages/index.tsx", "pages/index.jsx",
            "src/main.tsx", "app/layout.tsx", "app/layout.jsx",
          ];
          for (const c of candidates) {
            const fp = path.join(workDir, c);
            if (fs.existsSync(fp)) {
              targetFiles.push({ path: c, content: fs.readFileSync(fp, "utf8") });
              if (targetFiles.length >= 3) break;
            }
          }
        }
        if (targetFiles.length === 0)
          return { content: [{ type: "text" as const, text: "No HTML/JSX/TSX files found." }], isError: true };

        // ── Collect all CSS in the project for cross-referencing ──
        const allCssContent: { file: string; content: string }[] = [];
        function collectCss(dir: string, depth: number) {
          if (depth > 4) return;
          let entries: string[];
          try { entries = fs.readdirSync(dir); } catch { return; }
          for (const e of entries) {
            if (["node_modules", ".git", "dist", ".next", "out", ".pipilot"].includes(e)) continue;
            const full = path.join(dir, e);
            try {
              const stat = fs.statSync(full);
              if (stat.isDirectory()) collectCss(full, depth + 1);
              else if (/\.(css|scss)$/.test(e)) {
                allCssContent.push({
                  file: path.relative(workDir, full).replace(/\\/g, "/"),
                  content: fs.readFileSync(full, "utf8"),
                });
              }
            } catch {}
          }
        }
        collectCss(workDir, 0);

        // Merge all CSS for class lookups
        const fullCss = allCssContent.map((c) => c.content).join("\n");

        const lines: string[] = ["# UI VISUAL ANALYSIS", ""];

        for (const tf of targetFiles) {
          const content = tf.content;
          lines.push(`## File: \`${tf.path}\``, "");

          // ── 1. Visual hierarchy — what the user sees top to bottom ──
          lines.push("### Visual Hierarchy (top → bottom)");
          // Extract JSX/HTML elements in document order with their text
          const visualElements: string[] = [];
          // Match opening tags with their immediate text content
          const tagTextRe = /<(h[1-6]|p|span|div|button|a|label|input|img|nav|header|footer|main|section|article|aside|form|ul|ol|li|td|th|textarea|select)\b([^>]*)>([^<]*)/gi;
          let match;
          while ((match = tagTextRe.exec(content)) !== null) {
            const tag = match[1].toLowerCase();
            const attrs = match[2];
            const text = match[3].trim().slice(0, 80);
            // Extract useful attrs
            const classMatch = attrs.match(/class(?:Name)?=["'{]([^"'}]+)/);
            const styleMatch = attrs.match(/style=\{?\{([^}]+)\}?\}/);
            const srcMatch = attrs.match(/src=["']([^"']+)["']/);
            const hrefMatch = attrs.match(/href=["']([^"']+)["']/);
            const placeholderMatch = attrs.match(/placeholder=["']([^"']+)["']/);

            let desc = `<${tag}>`;
            if (text) desc += ` "${text}"`;
            if (placeholderMatch) desc += ` placeholder="${placeholderMatch[1]}"`;
            if (srcMatch) desc += ` src="${srcMatch[1].slice(0, 60)}"`;
            if (hrefMatch) desc += ` href="${hrefMatch[1].slice(0, 60)}"`;

            // Extract visual properties from classes
            if (classMatch) {
              const cls = classMatch[1];
              const visualBits: string[] = [];
              // Colors
              const bgColors = cls.match(/bg-[a-z]+-\d+|bg-\[#[^\]]+\]|bg-black|bg-white/g);
              const textColors = cls.match(/text-[a-z]+-\d+|text-\[#[^\]]+\]|text-black|text-white/g);
              if (bgColors) visualBits.push(`bg:${bgColors.join(",")}`);
              if (textColors) visualBits.push(`text:${textColors.join(",")}`);
              // Sizing
              const sizing = cls.match(/(?:w|h|max-w|min-h|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|gap)-(?:\d+|auto|\[.+?\]|full|screen)/g);
              if (sizing) visualBits.push(`size:${sizing.slice(0, 5).join(",")}`);
              // Layout
              if (/\bflex\b/.test(cls)) visualBits.push("flex");
              if (/\bgrid\b/.test(cls)) visualBits.push("grid");
              if (/\bhidden\b/.test(cls)) visualBits.push("HIDDEN");
              if (/\bfixed\b/.test(cls)) visualBits.push("fixed");
              if (/\babsolute\b/.test(cls)) visualBits.push("absolute");
              if (/\bsticky\b/.test(cls)) visualBits.push("sticky");
              // Typography
              const fontSz = cls.match(/text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)/g);
              const fontWt = cls.match(/font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)/g);
              if (fontSz) visualBits.push(fontSz.join(","));
              if (fontWt) visualBits.push(fontWt.join(","));
              // Borders & rounded
              const rounded = cls.match(/rounded(?:-[a-z]+)?/g);
              const borders = cls.match(/border(?:-[a-z]+-\d+)?/g);
              if (rounded) visualBits.push(rounded[0]);
              if (borders) visualBits.push(borders[0]);
              // Responsive
              const responsive = cls.match(/(?:sm|md|lg|xl|2xl):[a-z-]+/g);
              if (responsive) visualBits.push(`responsive:${responsive.slice(0, 3).join(",")}`);

              if (visualBits.length > 0) desc += ` [${visualBits.join(" | ")}]`;
            }

            // Inline style properties
            if (styleMatch) {
              const style = styleMatch[1];
              const styleBits: string[] = [];
              const bgMatch = style.match(/background(?:Color)?:\s*["']?([^"',}]+)/);
              const colorMatch = style.match(/(?:^|,\s*)color:\s*["']?([^"',}]+)/);
              const fontMatch = style.match(/fontFamily:\s*["']?([^"',}]+)/);
              const sizeMatch = style.match(/fontSize:\s*["']?([^"',}]+)/);
              const widthMatch = style.match(/width:\s*["']?([^"',}]+)/);
              const heightMatch = style.match(/height:\s*["']?([^"',}]+)/);
              if (bgMatch) styleBits.push(`bg:${bgMatch[1].trim()}`);
              if (colorMatch) styleBits.push(`color:${colorMatch[1].trim()}`);
              if (fontMatch) styleBits.push(`font:${fontMatch[1].trim().slice(0, 30)}`);
              if (sizeMatch) styleBits.push(`size:${sizeMatch[1].trim()}`);
              if (widthMatch) styleBits.push(`w:${widthMatch[1].trim()}`);
              if (heightMatch) styleBits.push(`h:${heightMatch[1].trim()}`);
              if (/display:\s*["']?flex/i.test(style)) styleBits.push("flex");
              if (/display:\s*["']?grid/i.test(style)) styleBits.push("grid");
              if (/position:\s*["']?(?:fixed|absolute|sticky)/i.test(style)) {
                const pos = style.match(/position:\s*["']?(\w+)/i);
                if (pos) styleBits.push(pos[1]);
              }
              if (styleBits.length > 0) desc += ` {${styleBits.join(", ")}}`;
            }

            if (desc.length > 8) visualElements.push(desc);
          }
          if (visualElements.length > 0) {
            for (const el of visualElements.slice(0, 60)) lines.push(`  ${el}`);
          } else {
            lines.push("  (No visual elements extracted — file may use JSX expressions)");
          }
          lines.push("");

          // ── 2. Layout structure ──
          lines.push("### Layout Structure");
          const flexCount = (content.match(/\bflex\b|display:\s*["']?flex/gi) || []).length;
          const gridCount = (content.match(/\bgrid\b|display:\s*["']?grid/gi) || []).length;
          const absoluteCount = (content.match(/\babsolute\b|position:\s*["']?absolute/gi) || []).length;
          const fixedCount = (content.match(/\bfixed\b|position:\s*["']?fixed/gi) || []).length;
          const stickyCount = (content.match(/\bsticky\b|position:\s*["']?sticky/gi) || []).length;
          const overflowHidden = (content.match(/overflow-hidden|overflow:\s*["']?hidden/gi) || []).length;
          lines.push(`  Flex containers: ${flexCount} | Grid containers: ${gridCount}`);
          lines.push(`  Positioned: ${absoluteCount} absolute, ${fixedCount} fixed, ${stickyCount} sticky`);
          if (overflowHidden > 0) lines.push(`  Overflow hidden: ${overflowHidden} elements (potential clipping)`);
          lines.push("");

          // ── 3. Color usage ──
          lines.push("### Colors Used");
          const allColors = new Set<string>();
          // From Tailwind classes
          for (const m of content.matchAll(/((?:bg|text|border|ring|from|to|via|shadow|outline|accent|fill|stroke)-(?:[a-z]+-\d+|black|white|\[#[^\]]+\]|\[hsl[^\]]+\]|\[rgb[^\]]+\]))/g))
            allColors.add(m[1]);
          // From inline styles
          for (const m of content.matchAll(/(#[0-9a-fA-F]{3,8}|hsl\([^)]+\)|rgb\([^)]+\))/g))
            allColors.add(m[1]);
          if (allColors.size > 0) {
            const byType = { bg: [] as string[], text: [] as string[], border: [] as string[], other: [] as string[] };
            for (const c of allColors) {
              if (c.startsWith("bg-")) byType.bg.push(c);
              else if (c.startsWith("text-")) byType.text.push(c);
              else if (c.startsWith("border-") || c.startsWith("ring-")) byType.border.push(c);
              else byType.other.push(c);
            }
            if (byType.bg.length > 0) lines.push(`  Backgrounds: ${byType.bg.join(", ")}`);
            if (byType.text.length > 0) lines.push(`  Text: ${byType.text.join(", ")}`);
            if (byType.border.length > 0) lines.push(`  Borders: ${byType.border.join(", ")}`);
            if (byType.other.length > 0) lines.push(`  Raw values: ${byType.other.slice(0, 15).join(", ")}`);
          } else {
            lines.push("  (No color values found — may use CSS variables or external stylesheet)");
          }
          lines.push("");

          // ── 4. Typography ──
          lines.push("### Typography");
          const fontSizes = new Set<string>();
          for (const m of content.matchAll(/text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)/g))
            fontSizes.add(m[0]);
          for (const m of content.matchAll(/fontSize:\s*["']?([^"',}]+)/g))
            fontSizes.add(`fontSize:${m[1].trim()}`);
          const fontWeights = new Set<string>();
          for (const m of content.matchAll(/font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)/g))
            fontWeights.add(m[0]);
          const fontFamilies = new Set<string>();
          for (const m of content.matchAll(/fontFamily:\s*["']?([^"',}]+)/g))
            fontFamilies.add(m[1].trim().split(",")[0].replace(/['"]/g, ""));
          for (const m of content.matchAll(/font-(?:sans|serif|mono)/g))
            fontFamilies.add(m[0]);
          if (fontFamilies.size > 0) lines.push(`  Fonts: ${[...fontFamilies].join(", ")}`);
          if (fontSizes.size > 0) lines.push(`  Sizes: ${[...fontSizes].join(", ")}`);
          if (fontWeights.size > 0) lines.push(`  Weights: ${[...fontWeights].join(", ")}`);
          // Headings
          const headings: string[] = [];
          for (const m of content.matchAll(/<(h[1-6])[^>]*>([^<]*)/gi)) {
            const t = m[2].trim();
            if (t) headings.push(`${m[1]}: "${t.slice(0, 60)}"`);
          }
          if (headings.length > 0) lines.push(`  Headings: ${headings.join(", ")}`);
          lines.push("");

          // ── 5. Interactive elements ──
          lines.push("### Interactive Elements");
          const buttons: string[] = [];
          for (const m of content.matchAll(/<button[^>]*>([^<]*)/gi))
            if (m[1].trim()) buttons.push(`"${m[1].trim().slice(0, 40)}"`);
          const inputs: string[] = [];
          for (const m of content.matchAll(/<input[^>]*(?:placeholder=["']([^"']+)["']|type=["']([^"']+)["'])/gi))
            inputs.push(m[1] ? `placeholder:"${m[1]}"` : `type:${m[2]}`);
          const links: string[] = [];
          for (const m of content.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)/gi))
            links.push(`"${m[2].trim().slice(0, 30)}" → ${m[1].slice(0, 50)}`);
          if (buttons.length > 0) lines.push(`  Buttons (${buttons.length}): ${buttons.slice(0, 10).join(", ")}`);
          if (inputs.length > 0) lines.push(`  Inputs (${inputs.length}): ${inputs.slice(0, 8).join(", ")}`);
          if (links.length > 0) lines.push(`  Links (${links.length}): ${links.slice(0, 8).join(", ")}`);
          const onClicks = (content.match(/onClick|onSubmit|onChange|onInput/g) || []).length;
          if (onClicks > 0) lines.push(`  Event handlers: ${onClicks} total`);
          lines.push("");

          // ── 6. Images & media ──
          const images: string[] = [];
          for (const m of content.matchAll(/(?:src|background(?:Image)?)\s*[=:]\s*["'{`]([^"'}`]+\.(png|jpg|jpeg|gif|svg|webp|avif|ico)[^"'}`]*)/gi))
            images.push(m[1].slice(0, 80));
          if (images.length > 0) {
            lines.push("### Images & Media");
            for (const img of images.slice(0, 10)) lines.push(`  - ${img}`);
            lines.push("");
          }

          // ── 7. Responsive behavior ──
          const breakpoints = new Set<string>();
          for (const m of content.matchAll(/\b(sm|md|lg|xl|2xl):/g)) breakpoints.add(m[1]);
          if (breakpoints.size > 0) {
            lines.push("### Responsive Breakpoints");
            lines.push(`  Active: ${[...breakpoints].join(", ")}`);
            // Count per breakpoint
            for (const bp of breakpoints) {
              const count = (content.match(new RegExp(`\\b${bp}:`, "g")) || []).length;
              lines.push(`  ${bp}: ${count} responsive rules`);
            }
            lines.push("");
          }

          // ── 8. Potential issues ──
          lines.push("### Potential Issues");
          const issues: string[] = [];
          // Missing alt text
          const imgWithoutAlt = (content.match(/<img(?![^>]*alt=)[^>]*>/gi) || []).length;
          if (imgWithoutAlt > 0) issues.push(`${imgWithoutAlt} images missing alt text (accessibility)`);
          // Hardcoded colors (not using design tokens)
          const hardcodedColors = content.match(/(?:color|background|border-color)\s*:\s*["']?#[0-9a-f]{3,8}/gi) || [];
          if (hardcodedColors.length > 5) issues.push(`${hardcodedColors.length} hardcoded hex colors (should use design tokens/variables)`);
          // Very large font sizes that might overflow
          if (content.match(/text-[6-9]xl|fontSize:\s*["']?\d{3}px/)) issues.push("Very large text (6xl+) — verify it doesn't overflow on mobile");
          // Z-index stacking
          const zIndexes = [...content.matchAll(/z-(?:\d+|\[(\d+)\])|zIndex:\s*["']?(\d+)/g)].map((m) => parseInt(m[1] || m[2] || "0"));
          if (zIndexes.length > 3) issues.push(`${zIndexes.length} z-index layers (max: ${Math.max(...zIndexes)}) — check stacking order`);
          // Overflow hidden that might clip content
          if (overflowHidden > 3) issues.push(`${overflowHidden} overflow-hidden containers — verify content isn't unintentionally clipped`);
          // No responsive classes at all
          if (breakpoints.size === 0 && content.length > 500) issues.push("No responsive breakpoints used — may not work well on mobile");
          // Inline styles overuse
          const inlineStyleCount = (content.match(/style=\{/g) || []).length;
          if (inlineStyleCount > 15) issues.push(`${inlineStyleCount} inline style objects — consider extracting to CSS/Tailwind for maintainability`);

          if (issues.length > 0) {
            for (const issue of issues) lines.push(`  ⚠ ${issue}`);
          } else {
            lines.push("  No obvious issues detected.");
          }
          lines.push("");
        }

        // ── CSS file list ──
        if (allCssContent.length > 0) {
          lines.push("### CSS Files");
          for (const c of allCssContent.slice(0, 15))
            lines.push(`  - ${c.file} (${c.content.split("\n").length} lines)`);
        }

        const report = lines.join("\n");
        return { content: [{ type: "text" as const, text: report.slice(0, 12000) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `UI analysis failed: ${err.message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  // ── screenshot_preview ──
  // For framework projects (Vite/Next/Angular), capture a screenshot by
  // hitting the running dev server. Returns both the image AND a structured
  // DOM/layout text report so non-vision models can still debug the UI.
  const screenshotPreview = tool(
    "screenshot_preview",
    "Capture a visual screenshot of the project's running dev server preview. " +
    "The dev server must be running (use manage_dev_server to start it first). " +
    "Returns a base64 PNG image AND a text-based DOM layout analysis. " +
    "Works with any framework (Vite, Next.js, Angular, Express) that serves on a port. " +
    "For non-vision models, the text layout analysis alone provides rich structure/style info.",
    {},
    async () => {
      try {
        const status = getDevServerStatus(projectId);
        if (!status || !status.running || !status.url) {
          return {
            content: [{ type: "text" as const, text: "Dev server is not running. Start it first with manage_dev_server action:'start'." }],
            isError: true,
          };
        }

        // Fetch the HTML from the dev server
        const url = status.url;
        let html: string;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          html = await res.text();
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `Could not fetch dev server at ${url}: ${err.message}` }],
            isError: true,
          };
        }

        // Generate a text-based layout analysis from the HTML
        const analysisLines: string[] = ["=== DEV SERVER UI ANALYSIS ===", `URL: ${url}`, ""];

        // Page title
        const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
        if (titleMatch) analysisLines.push(`Title: ${titleMatch[1]}`);

        // Meta viewport
        const viewportMatch = html.match(/meta[^>]*name=["']viewport["'][^>]*content=["']([^"']+)/i);
        if (viewportMatch) analysisLines.push(`Viewport: ${viewportMatch[1]}`);

        // Extract structure tags
        const structureTags: Record<string, number> = {};
        const tagMatches = html.matchAll(/<(header|nav|main|section|article|aside|footer|h[1-6]|form|button|input|img|a|ul|ol|table)\b/gi);
        for (const m of tagMatches) {
          const tag = m[1].toLowerCase();
          structureTags[tag] = (structureTags[tag] || 0) + 1;
        }
        if (Object.keys(structureTags).length > 0) {
          analysisLines.push(`Structure: ${Object.entries(structureTags).map(([t, c]) => `${t}(${c})`).join(", ")}`);
        }

        // Headings with text
        const headings: string[] = [];
        const hMatches = html.matchAll(/<(h[1-6])[^>]*>([^<]+)/gi);
        for (const m of hMatches) headings.push(`${m[1]}: "${m[2].trim().slice(0, 60)}"`);
        if (headings.length > 0) analysisLines.push(`Headings: ${headings.join(", ")}`);

        // Images
        const imgs: string[] = [];
        const imgMatches = html.matchAll(/<img[^>]*src=["']([^"']+)["']/gi);
        for (const m of imgMatches) imgs.push(m[1].slice(0, 80));
        if (imgs.length > 0) analysisLines.push(`Images (${imgs.length}): ${imgs.slice(0, 5).join(", ")}`);

        // Inline styles (color/bg snippets)
        const styleBlocks: string[] = [];
        const styleMatches = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
        for (const m of styleMatches) {
          const vars = m[1].matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g);
          for (const v of vars) styleBlocks.push(`--${v[1]}: ${v[2].trim()}`);
        }
        if (styleBlocks.length > 0) {
          analysisLines.push("");
          analysisLines.push(`CSS variables: ${styleBlocks.slice(0, 30).join(", ")}`);
        }

        // Full rendered HTML size
        analysisLines.push("");
        analysisLines.push(`HTML size: ${(html.length / 1024).toFixed(1)} KB`);
        analysisLines.push(`(Full source available at ${url})`);

        const report = analysisLines.join("\n");
        return { content: [{ type: "text" as const, text: report.slice(0, 6000) }] };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Screenshot failed: ${err.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  return createSdkMcpServer({
    name: "pipilot",
    version: "1.0.0",
    tools: [
      getDiagnostics, manageDevServer, searchNpm, getDevServerLogs,
      updateProjectContext, frontendDesignGuide, analyzeUi, screenshotPreview,
    ],
  });
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

// ── SSE event buffer per project — preserved after disconnect so the
// client can rebuild the interrupted assistant message on page refresh ──
interface ProjectStream {
  events: any[];
  isActive: boolean;
  lastActivity: number;
}
const streamBuffers = new Map<string, ProjectStream>();

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
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {}
  // Buffer for replay on reconnect
  if (currentStreamProjectId) {
    const buf = streamBuffers.get(currentStreamProjectId);
    if (buf) {
      buf.events.push(data);
      buf.lastActivity = Date.now();
      if (buf.events.length > 500) buf.events.shift();
    }
  }
}

// GET /api/agent/replay — JSON snapshot of buffered events (for initial state check)
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

// POST /api/agent/queue — DISABLED. The server-side queue caused duplicate
// messages to pile up; queueing is now handled entirely on the client via
// localStorage in useAgentChat. We accept the request and discard it for
// backward compatibility with older clients still calling this endpoint.
app.post("/api/agent/queue", (_req, res) => {
  res.json({ queued: false, disabled: true });
});

// GET /api/agent/queue — Always returns an empty queue. The real queue lives
// on the client now.
app.get("/api/agent/queue", (_req, res) => {
  res.json({ queue: [], isBusy: false, length: 0, disabled: true });
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
  const { prompt, systemPrompt, files = [], sessionId: existingSessionId, projectId: requestProjectId, mode } = req.body;
  // mode: "agent" (default — autonomous build) or "plan" (research + plan only, no edits)
  const agentMode: "agent" | "plan" = mode === "plan" ? "plan" : "agent";

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  // Set SSE headers — disable all buffering
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Content-Encoding", "none");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Suppress EPIPE errors on the underlying socket. When the client
  // disconnects mid-stream, any write to the dead socket emits 'error'
  // which would crash the server if unhandled.
  res.on("error", () => {});
  if (req.socket) req.socket.on("error", () => {});

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

  // Store history inside .pipilot/ to keep the workspace root clean.
  // JSON format — structured data that gets parsed/appended/replaced.
  const pipilotDataDir = path.join(workDir, ".pipilot");
  try { if (!fs.existsSync(pipilotDataDir)) fs.mkdirSync(pipilotDataDir, { recursive: true }); } catch {}
  const HISTORY_FILE = path.join(pipilotDataDir, "_pipilot_history.json");
  // Migrate: if old history file exists at the root, move it
  const oldHistoryFile = path.join(workDir, ".claude_history.json");
  if (fs.existsSync(oldHistoryFile) && !fs.existsSync(HISTORY_FILE)) {
    try { fs.renameSync(oldHistoryFile, HISTORY_FILE); } catch {}
  }

  console.log(`[agent] Session ${sessionId}: prompt="${prompt.slice(0, 100)}", files=${files.length}, cwd=${workDir}`);
  console.log(`[agent] systemPrompt received: ${systemPrompt ? systemPrompt.length + " chars" : "NONE"}`);
  console.log(`[agent] systemPrompt starts with: "${(systemPrompt || "").slice(0, 80)}..."`);

  // Initialize event buffer for this project
  streamBuffers.set(projectWorkspaceId, { events: [], isActive: true, lastActivity: Date.now() });
  currentStreamProjectId = projectWorkspaceId;

  // If agent is already busy for this project, REJECT the request rather
  // than queueing server-side. The client maintains its own queue and will
  // retry once streaming completes — see useAgentChat.
  if (activeRequests.has(projectWorkspaceId)) {
    sendSSE(res, { type: "busy", message: "Agent is already running. Client should queue and retry." });
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

  // ── Auto-compact long conversations ──
  // If the conversation has accumulated many turns, run the SDK's /compact
  // command first to compress the context. The compacted summary is written
  // to the history file so the agent sees it on future runs.
  const COMPACT_THRESHOLD = 30; // compact after this many history entries
  try {
    const historyLen = (() => {
      try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")).length;
      } catch { return 0; }
    })();
    if (historyLen >= COMPACT_THRESHOLD) {
      console.log(`[agent] History has ${historyLen} entries — auto-compacting`);
      sendSSE(res, { type: "status", message: "Optimizing conversation context..." });

      const compactAbort = new AbortController();
      let compactSucceeded = false;
      for await (const msg of query({
        prompt: "/compact",
        options: {
          systemPrompt: "",
          cwd: workDir,
          permissionMode: "bypassPermissions" as any,
          allowDangerouslySkipPermissions: true,
          maxTurns: 1,
          abortController: compactAbort,
        },
      })) {
        if ((msg as any).type === "system" && (msg as any).subtype === "compact_boundary") {
          const meta = (msg as any).compact_metadata;
          console.log(`[agent] Compacted: ${meta?.pre_tokens || "?"} tokens before`);
          sendSSE(res, { type: "compact_boundary", compact_metadata: meta });
          compactSucceeded = true;
        }
        if ((msg as any).type === "result") {
          console.log(`[agent] Compact result: ${(msg as any).result?.slice(0, 100) || "done"}`);
          // Mark success even if compact_boundary didn't fire
          compactSucceeded = true;
        }
      }

      // Replace history file with a clean slate after successful compact
      if (compactSucceeded) {
        try {
          fs.writeFileSync(HISTORY_FILE, JSON.stringify([
            {
              role: "system",
              content: "[Conversation compacted — previous context summarized by the agent]",
              timestamp: new Date().toISOString(),
              compacted: true,
            },
          ], null, 2));
          console.log(`[agent] History file reset after compact (was ${historyLen} entries)`);
        } catch (writeErr: any) {
          console.warn("[agent] Failed to reset history file:", writeErr.message);
        }
      }
    }
  } catch (compactErr: any) {
    console.warn("[agent] Auto-compact failed (non-fatal):", compactErr.message);
  }

  // ── Build system prompt with project directory instructions ──
  // Detect which .pipilot files exist so the prompt gives the agent
  // an unambiguous directive (scan vs read) rather than "check if exists".
  const pipilotDir = path.join(workDir, ".pipilot");
  const hasProjectMd = fs.existsSync(path.join(pipilotDir, "project.md"));
  const hasDesignMd = fs.existsSync(path.join(pipilotDir, "design.md"));

  // Build the context bootstrapping block based on what files exist
  let contextBootstrap: string;
  if (!hasProjectMd && !hasDesignMd) {
    contextBootstrap = `## FIRST PRIORITY — Bootstrap Project Context

Neither .pipilot/project.md nor .pipilot/design.md exist yet.
You MUST create both NOW, before doing anything else:

1. Run \`update_project_context(action:"scan")\` to generate .pipilot/project.md
   THEN immediately run \`update_project_context(action:"write")\` to add a proper
   Summary, Features list, and Roadmap based on what you see in the codebase.

2. Run \`frontend_design_guide(action:"scan")\` to generate .pipilot/design.md
   THEN immediately run \`frontend_design_guide(action:"write")\` to add a Philosophy
   section describing the project's aesthetic direction based on the colors, fonts,
   and component patterns you extracted.

Do this BEFORE addressing the user's request. These files persist across sessions
and are critical for maintaining design consistency and project awareness.`;
  } else if (!hasProjectMd) {
    contextBootstrap = `## FIRST PRIORITY — Generate Project Context

.pipilot/design.md exists (read it before UI work).
But .pipilot/project.md is MISSING. Run \`update_project_context(action:"scan")\` NOW,
then use \`update_project_context(action:"write")\` to add Summary, Features, and Roadmap.
Do this before addressing the user's request.`;
  } else if (!hasDesignMd) {
    contextBootstrap = `## FIRST PRIORITY — Generate Design System

.pipilot/project.md exists (read it for project context).
But .pipilot/design.md is MISSING. Run \`frontend_design_guide(action:"scan")\` NOW,
then use \`frontend_design_guide(action:"write")\` to add a Philosophy section.
Do this before addressing the user's request.`;
  } else {
    contextBootstrap = `## Project Context & Design System

Both .pipilot/project.md and .pipilot/design.md exist.
- Read \`.pipilot/project.md\` (or use \`update_project_context(action:"read")\`) for project structure, tech stack, features.
- Read \`.pipilot/design.md\` (or use \`frontend_design_guide(action:"read")\`) BEFORE writing any visual/UI code.
- After major changes, refresh with \`update_project_context(action:"scan")\`.
- To change the theme/aesthetic, use \`frontend_design_guide(action:"write")\` with the new design system.
- To add Features or Roadmap, use \`update_project_context(action:"write")\`.`;
  }

  const buildSystemPrompt = `You are PiPilot Agent building a project in ${workDir}.

${contextBootstrap}

## IDE Tools

You have custom tools beyond the standard Read/Write/Edit/Bash:
- \`update_project_context\` — Read/scan/write .pipilot/project.md (project structure, deps, features, roadmap).
- \`frontend_design_guide\` — Read/scan/write .pipilot/design.md (colors, fonts, tokens, aesthetic philosophy).
- \`get_diagnostics\` — Run TypeScript/Python/Go/Rust linters. Use after changes to verify correctness.
- \`manage_dev_server\` — Start/stop/restart the dev server. Use \`status\` to check if it's running.
- \`get_dev_server_logs\` — Read dev server output to debug build/runtime errors.
- \`search_npm\` — Search npm registry before installing packages.
- \`analyze_ui\` — Static HTML/CSS/JSX analysis for debugging layouts and styles without vision.
- \`screenshot_preview\` — Fetch dev server HTML and analyze its structure.

## Rules
- Never create subfolders for the project (no "my-app/", etc.). Files go in the project root.
- Read CLAUDE.md if it exists for additional project-specific instructions.
- ALWAYS maintain design consistency — read .pipilot/design.md before any UI work and follow it precisely.
- After completing a significant feature, update .pipilot/project.md with the new feature in the Features section.`;

  const planSystemPrompt = `You are PiPilot Agent in PLAN MODE inside ${workDir}.

${contextBootstrap}

## Your Job
RESEARCH and PLAN — do NOT write or modify any code.

What you should do:
- Read .pipilot/project.md and .pipilot/design.md first (generate them if missing — see above).
- Read existing files (Read, Glob, Grep) to understand the codebase.
- Use \`get_diagnostics\` to check for existing errors before planning fixes.
- Investigate the user's request thoroughly. Ask clarifying questions via AskUserQuestion if anything is ambiguous.
- Identify the files that will need to change, the new files that will need to be created, and any external dependencies.
- Think about edge cases, alternative approaches, and trade-offs.
- Produce a clear, ordered, step-by-step implementation plan with rationale.

What you must NOT do:
- Do NOT call Write, Edit, MultiEdit, NotebookEdit, or any tool that mutates files.
- Do NOT run shell commands that modify state (no installs, no builds, no git commits).
- Do NOT start implementing — wait for the user to approve the plan and switch out of plan mode.

End your response with a section titled "## Plan" containing the numbered steps.`;
  const connectorCtx = getConnectorContext(workDir);
  const agentSystemPrompt = (agentMode === "plan" ? planSystemPrompt : buildSystemPrompt) + connectorCtx;
  console.log(`[agent] mode=${agentMode}`);

  // Track if we've streamed text to avoid duplication from assistant messages
  let hasStreamedText = false;
  let assistantText = "";

  // Reference to current SSE response for canUseTool to send questions
  let sseRes = res;

  // Create abort controller for this run
  const abortController = new AbortController();
  activeAbortControllers.set(projectWorkspaceId, abortController);

  // ── Client disconnect cleanup ──
  // Use res.on("close"), NOT req.on("close"). req fires when the request
  // BODY is consumed (immediately for POST JSON). res fires when the
  // response STREAM is closed (page refresh, tab close, network drop).
  res.on("close", () => {
    if (activeRequests.has(projectWorkspaceId)) {
      console.log(`[agent] Client disconnected for ${projectWorkspaceId} — aborting agent, preserving buffer`);
      abortController.abort();
      activeRequests.delete(projectWorkspaceId);
      activeAbortControllers.delete(projectWorkspaceId);
      const buf = streamBuffers.get(projectWorkspaceId);
      if (buf) {
        buf.isActive = false;
      }
      if (currentStreamProjectId === projectWorkspaceId) currentStreamProjectId = null;
    }
  });

  try {
    // Use continue: true to auto-resume the most recent session in this workspace.
    // Sessions persist in ~/.claude/projects/<encoded-cwd>/*.jsonl
    // On first message: creates new session. On subsequent: continues it.
    const isFirstMessage = !activeSessions.has(projectWorkspaceId);
    console.log(`[agent] ${isFirstMessage ? "New" : "Continuing"} session for ${projectWorkspaceId}`);

    // Build per-project MCP server with IDE tools
    const ideTools = createIdeToolServer(projectWorkspaceId);

    for await (const message of query({
      prompt: fullPrompt,
      options: {
        systemPrompt: agentSystemPrompt,
        cwd: workDir,
        // In plan mode, use the SDK's built-in "plan" permission to actually
        // block mutating tools at the protocol level (in addition to the
        // system prompt instructions above).
        permissionMode: agentMode === "plan" ? "plan" : "bypassPermissions",
        allowDangerouslySkipPermissions: agentMode !== "plan",
        includePartialMessages: true,
        continue: !isFirstMessage,
        abortController,
        // Register custom IDE tools + default MCP servers
        mcpServers: {
          pipilot: ideTools,
          // Context7 — documentation search for any library/framework
          context7: {
            type: "http" as any,
            url: "https://mcp.context7.com/mcp",
          },
          // AppDeploy — deploy full-stack apps from chat
          appdeploy: {
            type: "http" as any,
            url: "https://api-v2.appdeploy.ai/mcp",
          },
          // Sequential Thinking — structured reasoning for complex tasks
          "sequential-thinking": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
          },
          // Load any user-configured MCP servers from .pipilot/mcp.json
          ...loadUserMcpServers(workDir),
        },
        allowedTools: [
          "mcp__pipilot__*",
          "mcp__context7__*",
          "mcp__appdeploy__*",
          "mcp__sequential-thinking__*",
          ...getUserMcpAllowedTools(workDir),
          "Agent",
        ],
        // Enable tool search so the agent discovers tools on-demand
        // instead of loading all definitions into context every turn.
        env: {
          ENABLE_TOOL_SEARCH: "auto",
          // Inject CLI connector tokens so tools like vercel, netlify, etc.
          // work via Bash without the user needing to `login` each time.
          ...loadConnectorEnvVars(workDir),
        },

        // ── Subagents ──
        // Specialized agents that the main agent can spawn for focused tasks.
        // Each runs in its own context with restricted tools.
        agents: {
          "fullstack-developer": {
            description: "Use this agent when you need to build complete features spanning database, API, and frontend layers together as a cohesive unit.",
            prompt: `You are a senior fullstack developer specializing in complete feature development with expertise across backend and frontend technologies. Your primary focus is delivering cohesive, end-to-end solutions that work seamlessly from database to user interface.

When building features:
- Design database schemas aligned with API contracts
- Implement type-safe APIs with shared types between frontend and backend
- Build frontend components matching backend capabilities
- Handle authentication flows spanning all layers
- Apply consistent error handling throughout the stack
- Write tests covering end-to-end user journeys
- Optimize performance at each layer (DB queries, API response times, bundle sizes)

Technology expertise: React, Next.js, Vue, Node.js, Express, PostgreSQL, MongoDB, Redis, TypeScript, REST, GraphQL, WebSockets, Docker.

Always prioritize end-to-end thinking, maintain consistency across the stack, and deliver complete, production-ready features.`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
            model: "sonnet" as const,
          },

          "ai-engineer": {
            description: "Use this agent when architecting, implementing, or optimizing AI systems — from model selection and LLM integration to prompt engineering, RAG pipelines, and AI-powered feature development.",
            prompt: `You are a senior AI engineer with expertise in designing and implementing comprehensive AI systems. Your focus spans LLM integration, prompt engineering, RAG architectures, AI feature development, and production deployment.

When building AI features:
- Select appropriate models and APIs for the use case
- Design effective prompts with proper system/user message structure
- Implement RAG pipelines with vector databases and embedding models
- Build streaming response handlers for real-time AI interactions
- Handle token management, rate limiting, and cost optimization
- Implement proper error handling for AI API failures
- Add observability (logging prompts, responses, latency, costs)
- Design fallback strategies and graceful degradation

Technology expertise: OpenAI API, Anthropic API, LangChain, LlamaIndex, Pinecone, Weaviate, ChromaDB, HuggingFace, TensorFlow, PyTorch, ONNX, vector databases, embedding models.

Always prioritize accuracy, efficiency, and ethical considerations while building AI systems that deliver real value.`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
            model: "sonnet" as const,
          },

          "api-designer": {
            description: "Use this agent when designing new APIs, creating API specifications, or refactoring existing API architecture for scalability and developer experience. Invoke for REST/GraphQL endpoint design, OpenAPI documentation, authentication patterns, or API versioning strategies.",
            prompt: `You are a senior API designer specializing in creating intuitive, scalable API architectures with expertise in REST and GraphQL design patterns. Your primary focus is delivering well-documented, consistent APIs that developers love to use.

When designing APIs:
- Apply RESTful principles with proper HTTP methods and status codes
- Write OpenAPI 3.1 specifications with comprehensive documentation
- Design consistent naming conventions and URI patterns
- Implement proper pagination (cursor-based preferred), filtering, and sorting
- Define authentication patterns (OAuth 2.0, JWT, API keys)
- Create comprehensive error response formats with actionable messages
- Plan API versioning and backward compatibility strategies
- Design webhook systems with delivery guarantees and retry mechanisms

Technology expertise: REST, GraphQL, gRPC, OpenAPI/Swagger, Postman, API gateways, OAuth 2.0, JWT, rate limiting, HATEOAS.

Always prioritize developer experience, maintain API consistency, and design for long-term evolution and scalability.`,
            tools: ["Read", "Write", "Edit", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
            model: "sonnet" as const,
          },

          "security-engineer": {
            description: "Use this agent when implementing security solutions, performing vulnerability assessments, establishing compliance controls, or reviewing code for security issues. Invoke for threat modeling, zero-trust architecture, security automation, and DevSecOps.",
            prompt: `You are a senior security engineer with deep expertise in application security, infrastructure security, and DevSecOps practices. Your focus spans vulnerability management, secure coding, compliance automation, and building security into every phase of development.

When securing applications:
- Perform threat modeling and attack surface analysis
- Review code for OWASP Top 10 vulnerabilities (XSS, SQLi, CSRF, etc.)
- Implement proper authentication and authorization (RBAC, ABAC)
- Configure secrets management and encryption (at rest and in transit)
- Set up security scanning in CI/CD (SAST, DAST, SCA)
- Design zero-trust network architectures
- Implement rate limiting, input validation, and output encoding
- Create security monitoring, alerting, and incident response procedures

Technology expertise: OWASP, CIS benchmarks, SOC2, ISO27001, HashiCorp Vault, AWS/Azure/GCP security, container security, Kubernetes security policies, WAF, IDS/IPS.

Always prioritize proactive security and automation while maintaining developer productivity.`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
            model: "sonnet" as const,
          },

          "deployment-engineer": {
            description: "Use this agent when designing CI/CD pipelines, configuring Docker/container deployments, setting up cloud infrastructure, or automating release processes.",
            prompt: `You are a senior deployment engineer with expertise in CI/CD pipelines, container orchestration, cloud infrastructure, and release automation. Your focus is on reliable, fast, and safe production deployments.

When building deployment pipelines:
- Design multi-stage CI/CD with build, test, scan, and deploy phases
- Write Dockerfiles with multi-stage builds and security best practices
- Configure Kubernetes deployments, services, and ingress
- Implement deployment strategies (blue-green, canary, rolling updates)
- Set up GitOps workflows with automated drift detection
- Configure monitoring, alerting, and rollback automation
- Manage secrets and environment-specific configuration
- Optimize build caching and parallel execution for speed

Technology expertise: Docker, Kubernetes, GitHub Actions, GitLab CI, Jenkins, Terraform, Helm, ArgoCD, AWS/Azure/GCP, Nginx, Caddy, PM2.

Always prioritize deployment safety and velocity while maintaining high reliability standards.`,
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
            model: "sonnet" as const,
          },

          "frontend-designer": {
            description: "Use this agent when the user asks to build web components, pages, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI. Creates distinctive, production-grade frontend interfaces with exceptional design quality that avoids generic AI aesthetics. Manages the project's design system for cross-session theme consistency.",
            prompt: `You are an elite frontend designer and developer who creates distinctive, production-grade interfaces with exceptional aesthetic quality. You NEVER produce generic "AI slop" — every design is intentional, memorable, and cohesive.

## Design System Persistence (.pipilot/design.md)

CRITICAL: Before building ANY UI, always check the project's design system first:

1. **First**: Call \`frontend_design_guide(action:"read")\` to check if .pipilot/design.md exists
2. **If it exists**: Follow it strictly — use the same fonts, colors, spacing, and aesthetic direction for ALL UI work so the project stays visually consistent across sessions
3. **If it doesn't exist**: Define the design system by calling \`frontend_design_guide(action:"write", content:"...")\` with the chosen aesthetic direction BEFORE writing any UI code
4. **After major design decisions**: Update .pipilot/design.md to capture new patterns, components, or theme refinements so future sessions inherit them

The design.md file is the single source of truth for the project's visual identity. It persists across chat sessions, so every UI built in this project will share the same cohesive theme.

### What to include in design.md:
- Aesthetic direction (e.g. "editorial terminal", "brutalist", "luxury minimal")
- Font stack (display, body, mono) with Google Fonts import URLs
- Color palette (CSS variables: --bg, --surface, --text, --accent, etc.)
- Spacing scale and border-radius conventions
- Motion/animation philosophy
- Component patterns (buttons, cards, inputs, etc.)
- Icon library choice

## Design Process

Before coding, commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick a clear extreme — brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian. Execute with precision.
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

## Aesthetics Rules

**Typography**: Choose fonts that are beautiful, unique, and interesting. NEVER use Inter, Roboto, Arial, or system fonts. Pick distinctive, characterful fonts. Pair a display font with a refined body font.

**Color & Theme**: Commit to a cohesive palette. Use CSS variables. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.

**Motion**: Focus on high-impact moments — one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Hover states that surprise. Scroll-triggered animations.

**Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.

**Backgrounds & Depth**: Create atmosphere — gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, grain overlays. Never flat solid color backgrounds alone.

**Images**: Use \`https://api.a0.dev/assets/image?text={url-encoded description}&aspect={16:9|1:1|9:16}\` for ALL images. Only 3 aspect ratios: 16:9, 1:1, 9:16. Description must be specific and vivid.

**Icons**: Lucide for UI icons. Simple Icons for brand/social icons. NEVER use emojis as icons.

**Content**: Real, specific content — actual names, prices, dates, descriptions. NEVER lorem ipsum.

NEVER use generic AI aesthetics. No design should be the same. Vary between light/dark, different fonts, different aesthetics. Match implementation complexity to the vision — maximalist designs need elaborate code, minimalist designs need precision and restraint.`,
            tools: ["Read", "Write", "Edit", "Glob", "Grep", "mcp__pipilot__frontend_design_guide"],
            model: "sonnet" as const,
          },

          "agent-installer": {
            description: "Use this agent when the user wants to discover, browse, or install Claude Code subagents from the awesome-claude-code-subagents repository on GitHub. Also use when users ask about available agents or want to add new specialized coding agents.",
            prompt: `You are an agent installer that helps users browse and install Claude Code agents from the awesome-claude-code-subagents repository on GitHub.

## Your Capabilities
1. List all available agent categories
2. List agents within a category
3. Search for agents by name or description
4. Install agents to the project's .claude/agents/ directory
5. Show details about a specific agent before installing
6. Uninstall agents

## GitHub API Endpoints
- Categories: https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/contents/categories
- Agents in category: https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/contents/categories/{category-name}
- Raw agent file: https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/main/categories/{category-name}/{agent-name}.md

## Workflow
When browsing: Fetch categories from GitHub API, present them, then list agents in selected category.
When installing: Download the .md file and save to .claude/agents/ in the project directory.
When searching: Fetch the README.md and search for the term in agent names and descriptions.
When uninstalling: Delete the .md file from .claude/agents/.

Always confirm before installing/uninstalling. Show the agent's description before installing. Use curl -s for silent downloads. Preserve exact file content.`,
            tools: ["Bash", "Read", "Write", "Glob", "WebFetch"],
            model: "sonnet" as const,
          },

          "mcp-installer": {
            description: "Use this agent when the user wants to search for, browse, install, configure, or uninstall MCP (Model Context Protocol) servers. Also use when users ask about available tools, integrations, or want to connect to external services like databases, APIs, or SaaS platforms.",
            prompt: `You are an MCP Server Installer agent. You help users discover, install, and configure MCP servers that extend the AI agent's capabilities.

## MCP Registry API

Search the official MCP server registry:
\`\`\`
GET https://registry.modelcontextprotocol.io/v0/servers?search={query}&limit=30&version=latest
\`\`\`

Response shape:
\`\`\`json
{
  "servers": [{
    "server": {
      "name": "ai.example/tool",
      "title": "Tool Name",
      "description": "What it does",
      "version": "1.0.0",
      "remotes": [{ "type": "streamable-http", "url": "https://..." }],
      "packages": [{ "registryType": "npm", "identifier": "@scope/pkg", "transport": { "type": "stdio" } }]
    },
    "_meta": { "io.modelcontextprotocol.registry/official": { "isLatest": true } }
  }],
  "metadata": { "nextCursor": "...", "count": 30 }
}
\`\`\`

## Installation

MCP servers are configured in \`.pipilot/mcp.json\` in the project workspace. The file format:
\`\`\`json
{
  "mcpServers": {
    "server-name": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    },
    "another-server": {
      "command": "npx",
      "args": ["-y", "@scope/mcp-server"],
      "env": { "API_KEY": "<key>" }
    }
  }
}
\`\`\`

### Server types:
- **HTTP/SSE remote servers**: Use \`type: "http"\` or \`type: "sse"\` with a \`url\` field. Add \`headers\` for auth.
- **stdio (local) servers**: Use \`command\` + \`args\`. Add \`env\` for environment variables.

## Workflow

1. **Search**: Use WebFetch to query the registry API. Present results in a table with name, description, and type.
2. **Install**: Read the current .pipilot/mcp.json (create if missing), add the server config, write back.
3. **Configure**: If the server needs API keys, ask the user. For secret values, add them to the config.
4. **Uninstall**: Read .pipilot/mcp.json, remove the server entry, write back.
5. **List installed**: Read and display .pipilot/mcp.json contents.

## Important
- Always create the .pipilot/ directory if it doesn't exist
- Preserve existing entries when adding new ones
- Show the user what will be installed before writing
- The agent will pick up new MCP servers on the next message (no restart needed)
- Use \`curl -s\` via Bash for API calls, or WebFetch if available`,
            tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch"],
            model: "sonnet" as const,
          },

          "wiki-generator": {
            description: "Use this agent when the user asks to generate, update, or maintain project documentation/wiki. Also use when users want to understand the project structure, generate architecture diagrams, or create documentation for their codebase.",
            prompt: `You are a Wiki Generator agent. You scan project codebases and generate structured documentation stored in .pipilot/wikis/ as Markdown files.

## Output Format

Create these wiki files in .pipilot/wikis/:
- **index.md** — Main wiki page with project overview, folder structure tree, and links to sub-pages
- **architecture.md** — Architecture overview with Mermaid diagrams showing component relationships
- **modules.md** — Key modules/components documentation
- **api.md** — API endpoints documentation (if applicable)
- **setup.md** — Setup and development guide

## For each file you document, include:
- Purpose and summary
- Key functions/classes with brief descriptions
- Dependencies (what it imports)
- Relationships (what imports this file)

## Mermaid Diagrams
Use Mermaid syntax for:
- Component dependency graphs: \`\`\`mermaid\\ngraph TD\\n  A[Component] --> B[Dependency]\\n\`\`\`
- Data flow diagrams
- Architecture overviews
- File relationship maps

## Workflow
1. Read the project structure (use Glob and Read)
2. Identify the key files (entry points, components, API routes, configs)
3. Read and analyze each key file
4. Generate structured Markdown documentation
5. Write each wiki page to .pipilot/wikis/{pageId}.md
6. Generate index.md linking all pages together

## Important
- Create the .pipilot/wikis/ directory if it doesn't exist
- Use relative links between wiki pages: [Architecture](architecture.md)
- Include a table of contents in index.md
- Skip node_modules, .git, dist, build folders
- For large projects, focus on the most important 20-30 files
- Use clean, readable Markdown formatting`,
            tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
            model: "sonnet" as const,
          },

          "connector-finder": {
            description: "Use this agent when the user wants to find, research, or add new CLI tool connectors (like Fly.io, Doppler, AWS, DigitalOcean, etc.) to extend the IDE's deployment and infrastructure capabilities. This agent researches CLI tools and adds them to .pipilot/connectors.json.",
            prompt: `You are a CLI Connector Finder agent. You help users discover and configure CLI tool connectors for the PiPilot IDE.

## What connectors are
Connectors store API tokens in .pipilot/connectors.json so that CLI tools work via Bash without the user needing to run login commands. The agent's environment gets the token injected automatically.

## How to add a connector
Write to .pipilot/connectors.json (create .pipilot/ if needed). The format:
\`\`\`json
{
  "connectors": {
    "tool-name": {
      "enabled": true,
      "token": "the-api-token",
      "envVar": "THE_ENV_VAR_NAME",
      "label": "Tool Name",
      "description": "What it does"
    }
  }
}
\`\`\`

## Research workflow
1. Read the existing .pipilot/connectors.json to see what's already configured
2. Research the CLI tool the user wants (check npm, docs, GitHub)
3. Identify: the CLI package name, the env var it reads for auth tokens, and where to get a token
4. Tell the user what env var name and token URL they need
5. Ask the user for their token (via AskUserQuestion if available, or just tell them)
6. Write the connector config to .pipilot/connectors.json (preserve existing entries!)

## Common CLI tools and their env vars
- fly (Fly.io): FLY_API_TOKEN — fly.io/dashboard/personal/access-tokens
- doppler: DOPPLER_TOKEN — doppler.com/dashboard
- aws: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY — console.aws.amazon.com/iam
- digitalocean: DIGITALOCEAN_ACCESS_TOKEN — cloud.digitalocean.com/account/api/tokens
- planetscale: PLANETSCALE_SERVICE_TOKEN — app.planetscale.com
- upstash: UPSTASH_API_KEY — console.upstash.com
- render: RENDER_API_KEY — dashboard.render.com/settings#api-keys
- firebase: FIREBASE_TOKEN (run firebase login:ci locally)
- heroku: HEROKU_API_KEY — dashboard.heroku.com/account
- deno: DENO_DEPLOY_TOKEN — dash.deno.com/account#tokens

Always preserve existing connectors when writing. Never overwrite the entire file.`,
            tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"],
            model: "sonnet" as const,
          },
        },
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
    // "aborted by user" is expected on page refresh — not a real error.
    if (/abort/i.test(err.message)) {
      console.log(`[agent] Session ${sessionId} aborted (client disconnected)`);
    } else {
      console.error(`[agent] Session ${sessionId} error:`, err.message);
    }
    sendSSE(res, { type: "error", message: err.message || "Agent error" });
  }

  // Cleanup
  const buf = streamBuffers.get(projectWorkspaceId);
  if (buf) buf.isActive = false;
  currentStreamProjectId = null;
  activeAbortControllers.delete(projectWorkspaceId);
  activeRequests.delete(projectWorkspaceId);

  // Drop any leftover server-side queue entries — the client owns the queue now.
  messageQueues.delete(projectWorkspaceId);

  // Notify client that streaming is fully complete so it can pop its own
  // local queue. The `done` event lets useAgentChat trigger the next send.
  sendSSE(res, { type: "done" });

  try { res.end(); } catch {}
});

// GET /api/agent/health — health check
app.get("/api/agent/health", (req, res) => {
  res.json({ status: "ok", workspaceBase: WORKSPACE_BASE });
});

// GET /api/agent/status?projectId=X — check if agent is running for a project
app.get("/api/agent/status", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const isRunning = activeRequests.has(projectId);
  const buf = streamBuffers.get(projectId);
  res.json({
    running: isRunning,
    bufferedEvents: buf ? buf.events.length : 0,
    lastActivity: buf ? buf.lastActivity : null,
    connectedClients: buf ? buf.clients.size : 0,
  });
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

// Folders that should appear in the tree but be lazy-loaded on first
// expansion (VSCode-style). These can be huge (10k+ files), so we DON'T
// recurse into them when building the initial tree.
const LAZY_DIRS = new Set([
  "node_modules",
  ".git",
  ".pipilot-data", // server-side checkpoint store
  ".next",
  ".nuxt",
  ".cache",
  ".vite",
  ".turbo",
  ".vercel",
  ".svelte-kit",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
]);

// Files that should NEVER appear (PiPilot internals).
const HIDDEN_NAMES = new Set([
  "CLAUDE.md",
  ".claude_history.json",
  ".pipilot-tsconfig.json",
]);

// ── Helper: build FileNode tree from disk (recursive) ──
function buildFileTree(dir: string, basePath: string = ""): any[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: any[] = [];

  for (const entry of entries) {
    // Skip only PiPilot internals — dot folders (.git, .github, .vscode,
    // .env, etc.) are now visible, like VSCode shows them.
    if (HIDDEN_NAMES.has(entry.name)) continue;

    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Lazy folders (node_modules, .git, dist, etc.) appear in the tree
      // but their children aren't loaded until the user expands them.
      if (LAZY_DIRS.has(entry.name)) {
        nodes.push({
          id: relativePath,
          name: entry.name,
          type: "folder",
          parentPath: basePath,
          lazy: true,
          children: [],
        });
        continue;
      }
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

// GET /api/files/zip?projectId= — stream the project as a downloadable zip.
// Excludes node_modules, .git, build artifacts, and other heavy dirs (same
// list used by checkpoints). Supports binary files via Node Buffer reads.
app.get("/api/files/zip", async (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });

  const SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", ".nuxt", "out",
    ".cache", ".vite", ".turbo", ".vercel", "coverage",
    "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache",
    "target", "vendor", ".pipilot-data",
  ]);
  const SKIP_FILES = new Set([
    "CLAUDE.md", ".claude_history.json", ".pipilot-tsconfig.json",
  ]);
  const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB cap per file
  const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500MB cap total

  try {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    let totalBytes = 0;
    let fileCount = 0;
    let skippedLargeFiles = 0;

    function walk(dir: string, prefix: string) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (totalBytes >= MAX_TOTAL_BYTES) return;
        if (SKIP_DIRS.has(entry.name)) continue;
        if (SKIP_FILES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(full, rel);
        } else if (entry.isFile()) {
          let stat: fs.Stats;
          try { stat = fs.statSync(full); } catch { continue; }
          if (stat.size > MAX_FILE_BYTES) { skippedLargeFiles++; continue; }
          if (totalBytes + stat.size > MAX_TOTAL_BYTES) return;
          try {
            const buf = fs.readFileSync(full); // raw Buffer — preserves binary
            zip.file(rel, buf);
            totalBytes += stat.size;
            fileCount++;
          } catch {}
        }
      }
    }
    walk(workDir, "");

    const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const safeName = (req.query.name as string)?.replace(/[^a-zA-Z0-9._-]/g, "_") || projectId;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);
    res.setHeader("X-File-Count", String(fileCount));
    res.setHeader("X-Skipped-Large", String(skippedLargeFiles));
    res.send(blob);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/zip-selection — zip a list of files (and folders) and stream
// the archive back. Used by the explorer's bulk "Download as ZIP" action.
// Body: { projectId, paths: string[], name? }
app.post("/api/files/zip-selection", express.json({ limit: "1mb" }), async (req, res) => {
  const { projectId, paths = [], name = "selection" } = req.body || {};
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: "paths required" });

  try {
    const baseDir = resolveWorkspacePath(projectId);
    if (!fs.existsSync(baseDir)) return res.status(404).json({ error: "Workspace not found" });

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
    const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
    let total = 0;

    function addFile(absPath: string, relPath: string) {
      try {
        const stat = fs.statSync(absPath);
        if (stat.size > 25 * 1024 * 1024) return; // skip files > 25MB
        if (total + stat.size > MAX_TOTAL_BYTES) return;
        const buf = fs.readFileSync(absPath);
        zip.file(relPath, buf);
        total += stat.size;
      } catch {}
    }

    function walk(absDir: string, relDir: string) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const absChild = path.join(absDir, e.name);
        const relChild = relDir ? `${relDir}/${e.name}` : e.name;
        if (e.isDirectory()) walk(absChild, relChild);
        else if (e.isFile()) addFile(absChild, relChild);
      }
    }

    for (const p of paths) {
      // Path traversal guard via resolveWorkspacePath
      let abs: string;
      try { abs = resolveWorkspacePath(projectId, p); } catch { continue; }
      if (!fs.existsSync(abs)) continue;
      const stat = fs.statSync(abs);
      const rel = p.replace(/^\/+/, "").replace(/\\/g, "/");
      if (stat.isDirectory()) {
        walk(abs, rel);
      } else if (stat.isFile()) {
        addFile(abs, rel);
      }
    }

    const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_") || "selection";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.zip"`);
    res.send(blob);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/files/upload — bulk upload files into a folder.
// Body: { projectId, targetFolder, files: [{ name, base64 }] }
// Used by the explorer's drag-and-drop upload from the OS.
app.post("/api/files/upload", express.json({ limit: "100mb" }), (req, res) => {
  const { projectId, targetFolder = "", files = [] } = req.body || {};
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ error: "files required" });

  try {
    const baseDir = resolveWorkspacePath(projectId);
    const targetDir = targetFolder
      ? resolveWorkspacePath(projectId, targetFolder)
      : baseDir;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const written: string[] = [];
    for (const f of files) {
      if (!f?.name || typeof f.base64 !== "string") continue;
      // Sanitize the file name — strip path components that could escape the target
      const safeName = path.basename(f.name);
      if (!safeName || safeName.startsWith(".")) continue;
      const fullPath = path.join(targetDir, safeName);
      // Path traversal guard (resolveWorkspacePath already checked the parent)
      if (!fullPath.startsWith(baseDir)) continue;
      try {
        const buf = Buffer.from(f.base64, "base64");
        fs.writeFileSync(fullPath, buf);
        const rel = targetFolder ? `${targetFolder}/${safeName}` : safeName;
        written.push(rel);
      } catch (err) {
        console.error(`[upload] failed to write ${safeName}:`, err);
      }
    }

    res.json({ success: true, written, count: written.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/raw?projectId=&path= — stream a file with proper Content-Type.
// Used by the rich FileViewer (images, video, pdf, audio, svg, etc.) so it
// can use real <img>/<video>/<iframe> src URLs without base64 round-tripping.
app.get("/api/files/raw", (req, res) => {
  const projectId = req.query.projectId as string;
  const filePath = req.query.path as string;
  if (!projectId || !filePath) return res.status(400).json({ error: "projectId and path required" });

  try {
    const fullPath = resolveWorkspacePath(projectId, filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File not found" });
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return res.status(400).json({ error: "Not a file" });

    const ext = path.extname(filePath).toLowerCase();
    const MIME: Record<string, string> = {
      // Images
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
      ".ico": "image/x-icon", ".avif": "image/avif",
      ".svg": "image/svg+xml",
      // Video
      ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg",
      ".mov": "video/quicktime", ".mkv": "video/x-matroska",
      // Audio
      ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
      ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac",
      // Documents
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".doc": "application/msword",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Fonts
      ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
      // Archives
      ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
    };
    const mime = MIME[ext] || "application/octet-stream";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "no-cache");
    // Range support for video/audio scrubbing
    const range = req.headers.range;
    if (range && (mime.startsWith("video/") || mime.startsWith("audio/"))) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        const chunk = end - start + 1;
        res.status(206);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        res.setHeader("Content-Length", String(chunk));
        fs.createReadStream(fullPath, { start, end }).pipe(res);
        return;
      }
    }
    fs.createReadStream(fullPath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/list-dir — list immediate children of a folder (one level).
// Used for lazy-loading heavy folders like node_modules. Files are returned
// without content (UI fetches on click). Subfolders are returned with
// `lazy: true` and empty children — every level is loaded on demand.
app.get("/api/files/list-dir", (req, res) => {
  const projectId = req.query.projectId as string;
  const relPath = (req.query.path as string) || "";
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  try {
    const fullPath = resolveWorkspacePath(projectId, relPath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Path not found" });
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: "Not a directory" });

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const nodes: any[] = [];

    for (const entry of entries) {
      // Same hidden list as the main tree — only PiPilot internals are skipped.
      if (HIDDEN_NAMES.has(entry.name)) continue;

      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Every nested folder is lazy too — keeps each request tiny.
        nodes.push({
          id: childRel,
          name: entry.name,
          type: "folder",
          parentPath: relPath,
          lazy: true,
          children: [],
        });
      } else {
        const ext = entry.name.split(".").pop()?.toLowerCase() || "";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          json: "json", html: "html", css: "css", md: "markdown", py: "python",
          svg: "xml", xml: "xml", yml: "yaml", yaml: "yaml", txt: "plaintext",
          sh: "shell", bash: "shell", mjs: "javascript", cjs: "javascript",
        };
        // No content — UI fetches via /api/files/read on click.
        nodes.push({
          id: childRel,
          name: entry.name,
          type: "file",
          parentPath: relPath,
          language: langMap[ext] || "plaintext",
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ children: nodes });
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

// DELETE /api/files/workspace — delete a project's workspace.
// CRITICAL: For LINKED workspaces (real on-disk folders the user opened from
// elsewhere) we MUST NOT delete the underlying directory — that would
// obliterate the user's actual project. We only unlink the mapping. For
// non-linked workspaces (those living under WORKSPACE_BASE) we delete them.
//
// Windows-specific gotcha: chokidar file watchers and any running dev server
// can hold file handles. We:
//   1. Stop the dev server for this project (releases bin/.cache/.next/etc)
//   2. Close ALL chokidar watchers tracked for this project
//   3. Wait one tick for the OS to release handles
//   4. Try fs.rm() (async) with retries
//   5. Fall back to a manual recursive walk on EBUSY/EPERM/ENOTEMPTY
app.delete("/api/files/workspace", async (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  try {
    const linked = isLinked(projectId);
    if (linked) {
      // Just remove the mapping — leave the user's disk folder alone.
      try { unlinkFolder(projectId); } catch {}
      try { clearProjectCheckpoints(projectId); } catch {}
      res.json({ success: true, unlinked: true });
      return;
    }

    const dir = getWorkDir(projectId);
    if (fs.existsSync(dir)) {
      // 1a. Stop the dev server (releases .next/.vite/dist/node_modules locks)
      try { await stopDevServer(projectId); } catch {}

      // 1b. Kill all PTY terminal sessions for this project (releases cmd.exe locks)
      const killedPtys = await killProjectPtys(projectId);
      if (killedPtys > 0) console.log(`[delete workspace] killed ${killedPtys} PTY session(s)`);

      // 1c. Last-resort: kill any stray processes whose CommandLine still
      // references this folder (handles crashed sessions, untracked workers).
      try {
        const stray = await killStrayProcessesInFolder(dir);
        if (stray > 0) console.log(`[delete workspace] killed ${stray} stray process(es)`);
      } catch {}

      // 2. Close ALL chokidar watchers for this project
      await closeAllWatchers(projectId);

      // 3. Give the OS a moment to release handles (Windows is slow)
      await new Promise((r) => setTimeout(r, 250));

      // 4. Try the modern async fs.rm with retries enabled
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.promises.rm(dir, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          if (err.code !== "EBUSY" && err.code !== "EPERM" && err.code !== "ENOTEMPTY") break;
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }

      // 5. Last-resort manual walk if rm still failed (e.g. some file truly stuck)
      if (lastErr && fs.existsSync(dir)) {
        console.warn(`[delete workspace] fs.rm failed (${lastErr.code}), falling back to manual walk`);
        const walk = (d: string) => {
          try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, entry.name);
              if (entry.isDirectory()) walk(p);
              else { try { fs.unlinkSync(p); } catch {} }
            }
            try { fs.rmdirSync(d); } catch {}
          } catch {}
        };
        walk(dir);
      }

      // 6. Final verification — if the directory still exists, something is
      // genuinely locked. We treat this as a PARTIAL success: the contents
      // were emptied (best-effort) but the directory itself is held open by
      // some external process. Report it so the UI can prompt the user to
      // delete the empty folder manually after restarting the IDE.
      if (fs.existsSync(dir)) {
        // Best-effort: empty out the directory contents even though we can't
        // remove the directory entry itself. Walk and unlink/rmdir everything
        // inside; the (now-empty) directory remains until the user removes it.
        const emptyDir = (d: string) => {
          try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, entry.name);
              try {
                if (entry.isDirectory()) {
                  emptyDir(p);
                  try { fs.rmdirSync(p); } catch {}
                } else {
                  fs.unlinkSync(p);
                }
              } catch {}
            }
          } catch {}
        };
        emptyDir(dir);

        // Count what's left so the UI can show how many files survived the lock
        let leftoverCount = 0;
        try {
          const walk = (d: string) => {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              if (entry.isDirectory()) walk(path.join(d, entry.name));
              else leftoverCount++;
            }
          };
          walk(dir);
        } catch {}

        // Still clean up server-side checkpoints since the project is gone
        try { clearProjectCheckpoints(projectId); } catch {}

        // Return 200 with `partial: true` so the client knows to show the
        // "manual removal needed" dialog rather than treating it as failure.
        res.json({
          success: true,
          partial: true,
          path: dir,
          leftoverCount,
          message: "The project folder couldn't be removed because it's held open by another process. The folder has been emptied — close PiPilot IDE and delete the empty folder manually.",
        });
        return;
      }
    }

    try { clearProjectCheckpoints(projectId); } catch {}
    res.json({ success: true });
  } catch (err: any) {
    console.error("[delete workspace] failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// SSE file watcher — streams file changes in real-time.
// Each project can have multiple concurrent watchers (one per SSE connection),
// so we track them in a Set per projectId. On workspace delete we close ALL
// of them to release Windows file handles before rmSync.
const activeWatchers = new Map<string, Set<chokidar.FSWatcher>>();

function registerWatcher(projectId: string, watcher: chokidar.FSWatcher) {
  let set = activeWatchers.get(projectId);
  if (!set) { set = new Set(); activeWatchers.set(projectId, set); }
  set.add(watcher);
}
function unregisterWatcher(projectId: string, watcher: chokidar.FSWatcher) {
  const set = activeWatchers.get(projectId);
  if (!set) return;
  set.delete(watcher);
  if (set.size === 0) activeWatchers.delete(projectId);
}
async function closeAllWatchers(projectId: string) {
  const set = activeWatchers.get(projectId);
  if (!set) return;
  for (const w of set) {
    try { await w.close(); } catch {}
  }
  activeWatchers.delete(projectId);
}

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
  registerWatcher(projectId, watcher);

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
    watcher.close().catch(() => {});
    unregisterWatcher(projectId, watcher);
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
// Reverse lookup: which project each pty session belongs to. Used by the
// workspace-delete handler to kill any PTYs holding the directory open.
const ptyProjectIds = new Map<string, string>();
// Per-session scrollback buffer (raw bytes, capped to ~512KB per session)
const ptyBuffers = new Map<string, string>();
const PTY_BUFFER_MAX = 512 * 1024;

/**
 * Find and kill ALL PTY processes whose cwd is the given project's workspace.
 * Returns the number of sessions killed. Used by the workspace-delete handler
 * before rmSync so Windows doesn't hold the folder open via cmd.exe.
 */
async function killProjectPtys(projectId: string): Promise<number> {
  const sessionIdsToKill: string[] = [];
  for (const [sid, pid] of ptyProjectIds.entries()) {
    if (pid === projectId) sessionIdsToKill.push(sid);
  }
  for (const sid of sessionIdsToKill) {
    const p = activePtys.get(sid);
    if (p) {
      try {
        if (process.platform === "win32") {
          // Kill the entire pty process tree (cmd.exe + any children)
          spawn("taskkill", ["/pid", String(p.pid), "/f", "/t"], { shell: true });
        } else {
          p.kill();
        }
      } catch {}
    }
    activePtys.delete(sid);
    ptyBuffers.delete(sid);
    ptyProjectIds.delete(sid);
  }
  // Give Windows a moment to release handles after taskkill
  if (sessionIdsToKill.length > 0 && process.platform === "win32") {
    await new Promise((r) => setTimeout(r, 250));
  }
  return sessionIdsToKill.length;
}

/**
 * Last-resort: scan all processes for any whose command line references
 * this folder and force-kill them. Catches stray cmd.exe/bash/node/npm
 * processes from agent tool invocations or previous server crashes.
 *
 * Uses `wmic process where "CommandLine like ..."` so the filtering happens
 * server-side and the output is just the matching PIDs (one per line).
 * Returns the number of PIDs killed.
 */
async function killStrayProcessesInFolder(absoluteFolder: string): Promise<number> {
  if (process.platform !== "win32") return 0;

  // The folder name (last segment) is more discriminating than the full path
  // because the full path contains backslashes which need careful escaping
  // for wmic's WHERE clause. The folder name alone catches everything we
  // care about because it's unique to this project.
  const folderName = path.basename(absoluteFolder);
  if (!folderName || folderName.length < 4) return 0; // safety: don't match short generic names

  const pids: number[] = await new Promise((resolve) => {
    let out = "";
    // wmic WHERE clause: CommandLine LIKE '%folderName%'
    const child = spawn(
      "wmic",
      [
        "process",
        "where",
        `(CommandLine like "%${folderName}%" OR ExecutablePath like "%${folderName}%")`,
        "get",
        "ProcessId",
      ],
      { shell: true },
    );
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("exit", () => {
      const list = out
        .split(/\r?\n/)
        .map((l) => parseInt(l.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      resolve(list);
    });
    child.on("error", () => resolve([]));
    setTimeout(() => { try { child.kill(); } catch {}; resolve([]); }, 8000);
  });

  const myPid = process.pid;
  const filtered = pids.filter((p) => p !== myPid);

  // Force-kill each (and its children via /T)
  for (const pid of filtered) {
    try {
      spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { shell: true });
    } catch {}
  }

  if (filtered.length > 0) {
    // Give Windows a moment to actually release the handles
    await new Promise((r) => setTimeout(r, 400));
  }

  return filtered.length;
}

// ── Terminal shell profiles ──
// Describes a selectable shell (name, executable, default args). The
// client fetches the list of AVAILABLE profiles for the current host
// OS via GET /api/terminal/profiles and presents them in the New menu.
interface ShellProfile {
  id: string;          // stable id (e.g. "powershell", "bash", "cmd")
  label: string;       // user-visible name
  command: string;     // executable path (ALWAYS absolute after resolveCommand)
  args?: string[];     // default args
  available: boolean;  // whether the executable was found on disk
}

/**
 * Resolve an executable name to an absolute path. node-pty on Windows
 * requires absolute paths — it does NOT walk PATH itself. We mimic
 * `where.exe` / `which` by checking candidate directories.
 */
function resolveCommand(command: string): string | null {
  // Already absolute and exists? Use it directly.
  if (command.includes("/") || command.includes("\\")) {
    try {
      if (fs.existsSync(command)) return command;
    } catch {}
    return null;
  }

  // Walk PATH. On Windows also try each PATHEXT suffix.
  const isWin = process.platform === "win32";
  const pathSep = isWin ? ";" : ":";
  const pathDirs = (process.env.PATH || "").split(pathSep).filter(Boolean);
  const pathExts = isWin
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").map((e) => e.toLowerCase())
    : [""];

  // If the command already has an extension, skip PATHEXT expansion
  const hasExt = /\.[a-z0-9]+$/i.test(command);

  for (const dir of pathDirs) {
    for (const ext of hasExt ? [""] : pathExts) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }
  }
  return null;
}

/** Cached profile list (rebuilt on first call per process lifetime). */
let cachedProfiles: ShellProfile[] | null = null;

/** All profiles known on this host, with `available` and resolved paths. */
function listShellProfiles(): ShellProfile[] {
  if (cachedProfiles) return cachedProfiles;

  const plat = process.platform;
  interface Candidate {
    id: string;
    label: string;
    commands: string[]; // ordered list — first resolved wins
    args?: string[];
  }
  const candidates: Candidate[] = [];

  if (plat === "win32") {
    const sysRoot = process.env.SystemRoot || "C:\\Windows";
    const system32 = path.join(sysRoot, "System32");
    candidates.push({
      id: "pwsh",
      label: "PowerShell 7",
      commands: [
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "pwsh.exe", // fall back to PATH lookup
      ],
      args: ["-NoLogo"],
    });
    candidates.push({
      id: "powershell",
      label: "Windows PowerShell",
      commands: [
        path.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"),
        "powershell.exe",
      ],
      args: ["-NoLogo"],
    });
    candidates.push({
      id: "cmd",
      label: "Command Prompt",
      commands: [
        path.join(system32, "cmd.exe"),
        "cmd.exe",
      ],
    });
    candidates.push({
      id: "git-bash",
      label: "Git Bash",
      commands: [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        "bash.exe",
      ],
      args: ["--login", "-i"],
    });
  } else if (plat === "darwin") {
    candidates.push({ id: "bash", label: "Bash", commands: ["/bin/bash", "bash"], args: ["-l"] });
    candidates.push({ id: "zsh", label: "Zsh", commands: ["/bin/zsh", "zsh"], args: ["-l"] });
    candidates.push({ id: "sh", label: "Sh", commands: ["/bin/sh", "sh"] });
    candidates.push({
      id: "fish",
      label: "Fish",
      commands: ["/opt/homebrew/bin/fish", "/usr/local/bin/fish", "fish"],
      args: ["-l"],
    });
  } else {
    // Linux & other Unix
    candidates.push({ id: "bash", label: "Bash", commands: ["/bin/bash", "/usr/bin/bash", "bash"], args: ["-l"] });
    candidates.push({ id: "zsh", label: "Zsh", commands: ["/usr/bin/zsh", "/bin/zsh", "zsh"], args: ["-l"] });
    candidates.push({ id: "sh", label: "Sh", commands: ["/bin/sh", "sh"] });
    candidates.push({ id: "fish", label: "Fish", commands: ["/usr/bin/fish", "/usr/local/bin/fish", "fish"], args: ["-l"] });
  }

  cachedProfiles = candidates.map((c) => {
    let resolved: string | null = null;
    for (const cmd of c.commands) {
      resolved = resolveCommand(cmd);
      if (resolved) break;
    }
    return {
      id: c.id,
      label: c.label,
      command: resolved || c.commands[0], // keep a display fallback even if unresolved
      args: c.args,
      available: resolved !== null,
    };
  });
  return cachedProfiles;
}

/** Look up a profile by id. Returns null if the id is unknown. */
function getShellProfile(profileId: string | undefined): ShellProfile | null {
  if (!profileId) return null;
  return listShellProfiles().find((p) => p.id === profileId) || null;
}

/** Default profile when the client doesn't specify one. */
function getDefaultShellProfile(): ShellProfile {
  const profiles = listShellProfiles();
  const plat = process.platform;

  if (plat === "win32") {
    // cmd.exe is ALWAYS present on Windows — bulletproof fallback.
    const cmd = profiles.find((p) => p.id === "cmd" && p.available);
    if (cmd) return cmd;
  } else {
    // macOS / Linux — default to bash (universally available).
    const bash = profiles.find((p) => p.id === "bash" && p.available);
    if (bash) return bash;
  }

  // Fallback: first available profile, or first entry if none resolve.
  return profiles.find((p) => p.available) || profiles[0];
}

function createPtyForProject(projectId: string, profileId?: string): pty.IPty {
  const workDir = getWorkDir(projectId);
  const cwd = fs.existsSync(workDir) ? workDir : WORKSPACE_BASE;

  // Pick the profile: explicit > env SHELL > OS default
  let profile = getShellProfile(profileId);

  // If caller asked for a specific profile but it's not available on
  // this host, fall back to the default rather than crashing.
  if (profile && !profile.available) {
    console.warn(`[terminal] requested profile "${profile.id}" unavailable, falling back to default`);
    profile = null;
  }

  if (!profile && process.platform !== "win32" && process.env.SHELL) {
    const envShell = process.env.SHELL;
    if (fs.existsSync(envShell)) {
      profile = {
        id: "env",
        label: "System default",
        command: envShell,
        args: [],
        available: true,
      };
    }
  }
  if (!profile) profile = getDefaultShellProfile();

  if (!profile.available) {
    throw new Error(
      `No shell executable could be resolved for "${profile.label}" (${profile.command}). ` +
      `Checked absolute paths and PATH.`,
    );
  }

  console.log(`[terminal] spawning ${profile.label} (${profile.command}) for ${projectId}`);

  const ptyProcess = pty.spawn(profile.command, profile.args || [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });

  return ptyProcess;
}

// GET /api/terminal/profiles — list available shell profiles for the host
app.get("/api/terminal/profiles", (_req, res) => {
  const profiles = listShellProfiles();
  const defaultProfile = getDefaultShellProfile();
  res.json({
    platform: process.platform,
    default: defaultProfile.id,
    profiles,
  });
});

// POST /api/terminal/create — create a PTY session
app.post("/api/terminal/create", (req, res) => {
  const { projectId, sessionId, profile } = req.body;
  if (!projectId || !sessionId) return res.status(400).json({ error: "projectId and sessionId required" });

  if (activePtys.has(sessionId)) {
    return res.json({ success: true, sessionId, existing: true });
  }

  let ptyProc: pty.IPty;
  try {
    ptyProc = createPtyForProject(projectId, profile);
  } catch (err: any) {
    console.error(`[terminal] failed to spawn shell for ${projectId}:`, err?.message || err);
    return res.status(500).json({
      error: "Failed to spawn shell",
      message: err?.message || String(err),
      profile,
    });
  }
  activePtys.set(sessionId, ptyProc);
  ptyProjectIds.set(sessionId, projectId);
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
    ptyProjectIds.delete(sessionId);
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
/**
 * Load user-configured MCP servers from .pipilot/mcp.json in the workspace.
 * Format: { "mcpServers": { "name": { type, url, headers?, command?, args?, env? } } }
 */
function loadUserMcpServers(workDir: string): Record<string, any> {
  try {
    const mcpPath = path.join(workDir, ".pipilot", "mcp.json");
    if (!fs.existsSync(mcpPath)) return {};
    const data = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    return data.mcpServers || {};
  } catch {
    return {};
  }
}

/**
 * CLI connectors — tokens stored in .pipilot/connectors.json.
 * Each connector maps to one or more env vars that CLI tools read.
 * Format: { "connectors": { "vercel": { "enabled": true, "token": "..." }, ... } }
 */
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
  try {
    const p = path.join(workDir, ".pipilot", "connectors.json");
    if (!fs.existsSync(p)) return {};
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const envs: Record<string, string> = {};
    for (const [id, cfg] of Object.entries(data.connectors || {})) {
      const c = cfg as any;
      if (!c.enabled || !c.token) continue;
      const mapper = CONNECTOR_ENV_MAP[id];
      if (mapper) {
        Object.assign(envs, mapper(c.token));
      } else if (c.envVar) {
        // Custom connector with a user-defined env var name
        envs[c.envVar] = c.token;
      }
    }
    return envs;
  } catch { return {}; }
}

/** Build a context string listing which CLI connectors are configured. */
function getConnectorContext(workDir: string): string {
  try {
    const p = path.join(workDir, ".pipilot", "connectors.json");
    if (!fs.existsSync(p)) return "";
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const lines: string[] = [];
    for (const [id, cfg] of Object.entries(data.connectors || {})) {
      const c = cfg as any;
      if (!c.enabled || !c.token) continue;
      const envName = CONNECTOR_ENV_MAP[id] ? Object.keys(CONNECTOR_ENV_MAP[id](c.token))[0] : c.envVar || "";
      const desc = c.description || "";
      lines.push(`- **${id}**${desc ? ` (${desc})` : ""}: use \`${id}\` CLI commands (token in \`${envName}\`, no login needed)`);
    }
    if (lines.length === 0) return "";
    return `\n## CLI Connectors (pre-authenticated)\nThe following CLI tools are configured with tokens — use them directly via Bash:\n${lines.join("\n")}\n`;
  } catch { return ""; }
}

function getUserMcpAllowedTools(workDir: string): string[] {
  const servers = loadUserMcpServers(workDir);
  return Object.keys(servers).map((k) => `mcp__${k}__*`);
}

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

// ── Workspace Checkpoints (revert support for disk-backed projects) ─

// POST /api/checkpoints/create — snapshot the current workspace
app.post("/api/checkpoints/create", (req, res) => {
  const { projectId, label, messageId } = req.body;
  if (!projectId || !label) {
    return res.status(400).json({ error: "projectId and label required" });
  }
  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });
  try {
    const meta = createCheckpoint({ projectId, workDir, label, messageId });
    res.json({ success: true, checkpoint: meta });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/checkpoints/list?projectId=...
app.get("/api/checkpoints/list", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  res.json({ checkpoints: listCheckpoints(projectId) });
});

// GET /api/checkpoints/find-before?projectId=&messageId=
app.get("/api/checkpoints/find-before", (req, res) => {
  const projectId = req.query.projectId as string;
  const messageId = req.query.messageId as string;
  if (!projectId || !messageId) return res.status(400).json({ error: "projectId and messageId required" });
  const meta = findCheckpointBeforeMessageFn(projectId, messageId);
  res.json({ checkpoint: meta });
});

// POST /api/checkpoints/restore — restore the workspace to a checkpoint
app.post("/api/checkpoints/restore", (req, res) => {
  const { projectId, checkpointId } = req.body;
  if (!projectId || !checkpointId) {
    return res.status(400).json({ error: "projectId and checkpointId required" });
  }
  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });
  try {
    const result = restoreCheckpoint({ projectId, workDir, checkpointId });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/checkpoints/delete
app.post("/api/checkpoints/delete", (req, res) => {
  const { projectId, checkpointId } = req.body;
  if (!projectId || !checkpointId) {
    return res.status(400).json({ error: "projectId and checkpointId required" });
  }
  const ok = deleteCheckpoint(projectId, checkpointId);
  res.json({ success: ok });
});

// POST /api/checkpoints/clear — wipe all checkpoints for a project
app.post("/api/checkpoints/clear", (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const count = clearProjectCheckpoints(projectId);
  res.json({ success: true, deleted: count });
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
    const singles: Record<string, (w: string) => Promise<any[]>> = {
      typescript: runTypeScriptCheck,
      python: runPythonCheck,
      go: runGoCheck,
      rust: runRustCheck,
      php: runPhpCheck,
      ruby: runRubyCheck,
    };
    if (source !== "all" && singles[source]) {
      const diagnostics = await singles[source](workDir);
      res.json({ diagnostics, ran: { [source]: true } });
    } else {
      const result = await runAllChecks(workDir);
      res.json(result);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/diagnostics/install-deps — explicitly install node_modules for a project.
// Diagnostics will also do this lazily, but the UI can call this to show install progress.
app.post("/api/diagnostics/install-deps", async (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getWorkDir(projectId);
  if (!fs.existsSync(workDir)) return res.status(404).json({ error: "Workspace not found" });
  try {
    const result = await ensureNodeModules(workDir);
    res.json(result);
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

// ── Codestral proxy (avoids CORS for browser → Mistral API calls) ──
const CODESTRAL_API_KEY = "DXfXAjwNIZcAv1ESKtoDwWZZF98lJxho";

app.post("/api/codestral/fim", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const upstream = await fetch("https://codestral.mistral.ai/v1/fim/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CODESTRAL_API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Codestral: ${upstream.status}` });
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/codestral/chat", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const body = req.body;
    const isStream = body.stream === true;

    const upstream = await fetch("https://codestral.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CODESTRAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Codestral: ${upstream.status}` });
    }

    if (isStream && upstream.body) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      // Pipe the SSE stream directly
      const reader = (upstream.body as any).getReader
        ? (upstream.body as any).getReader()
        : null;
      if (reader) {
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); return; }
            res.write(Buffer.from(value));
            if (typeof (res as any).flush === "function") (res as any).flush();
          }
        };
        pump().catch(() => res.end());
        req.on("close", () => { try { reader.cancel(); } catch {} });
      } else {
        const text = await upstream.text();
        res.write(text);
        res.end();
      }
    } else {
      const data = await upstream.json();
      res.json(data);
    }
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── MCP Registry & Config Management ──

// Search the official MCP registry
app.get("/api/mcp/search", async (req, res) => {
  const search = (req.query.search as string) || "";
  const limit = parseInt(req.query.limit as string) || 30;
  try {
    const url = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(search)}&limit=${limit}&version=latest`;
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Registry: ${upstream.status}` });
    }
    const data = await upstream.json();
    // Flatten to a simpler shape for the frontend.
    // Filter: only keep servers that support stdio (npm packages) or
    // simple token-based HTTP (Authorization: Bearer header). Exclude
    // servers that require OAuth2 flows (they break in browser context).
    const servers = (data.servers || [])
      .map((entry: any) => {
        const s = entry.server || {};
        const meta = entry._meta?.["io.modelcontextprotocol.registry/official"] || {};

        // Classify transports this server supports
        const hasStdio = (s.packages || []).some(
          (p: any) => p.transport?.type === "stdio",
        );
        // A remote is "safe" if it has no headers at all (public), or
        // all its required headers follow the Bearer token pattern
        // (simple secret, no OAuth redirect needed).
        const safeRemotes = (s.remotes || []).filter((r: any) => {
          if (!r.headers || r.headers.length === 0) return true; // public
          return r.headers.every((h: any) => {
            // Accept: Authorization headers with Bearer pattern (token-based)
            if (h.name === "Authorization" && h.isSecret) return true;
            // Accept: simple API key headers
            if (h.isSecret && !h.value?.includes("oauth") && !h.value?.includes("redirect")) return true;
            return false;
          });
        });

        // Skip servers that have ONLY OAuth-based remotes and no stdio
        if (!hasStdio && safeRemotes.length === 0) return null;

        return {
          name: s.name || "",
          title: s.title || s.name || "",
          description: s.description || "",
          version: s.version || "",
          websiteUrl: s.websiteUrl || "",
          repository: s.repository?.url || "",
          isLatest: meta.isLatest ?? true,
          remotes: safeRemotes.map((r: any) => ({ type: r.type, url: r.url })),
          packages: (s.packages || []).map((p: any) => ({
            registry: p.registryType,
            identifier: p.identifier,
            version: p.version,
            transport: p.transport?.type || "stdio",
            envVars: (p.environmentVariables || []).map((v: any) => ({
              name: v.name,
              description: v.description || "",
              required: v.isRequired ?? false,
              secret: v.isSecret ?? false,
            })),
          })),
          icons: (s.icons || []).map((i: any) => i.src).filter(Boolean),
        };
      })
      .filter(Boolean); // remove nulls (OAuth-only servers)
    res.json({ servers, total: servers.length });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Get user's MCP config for a project
app.get("/api/mcp/config", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getWorkDir(projectId);
  try {
    const mcpPath = path.join(workDir, ".pipilot", "mcp.json");
    if (!fs.existsSync(mcpPath)) {
      return res.json({ mcpServers: {} });
    }
    const data = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    res.json(data);
  } catch {
    res.json({ mcpServers: {} });
  }
});

// Save user's MCP config for a project
app.post("/api/mcp/config", express.json(), (req, res) => {
  const { projectId, mcpServers } = req.body;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getWorkDir(projectId);
  try {
    const pipilotDir = path.join(workDir, ".pipilot");
    if (!fs.existsSync(pipilotDir)) fs.mkdirSync(pipilotDir, { recursive: true });
    const mcpPath = path.join(pipilotDir, "mcp.json");
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: mcpServers || {} }, null, 2), "utf8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Install an MCP server (add to project config)
app.post("/api/mcp/install", express.json(), (req, res) => {
  const { projectId, name, config } = req.body;
  if (!projectId || !name || !config) return res.status(400).json({ error: "projectId, name, config required" });
  const workDir = getWorkDir(projectId);
  try {
    const pipilotDir = path.join(workDir, ".pipilot");
    if (!fs.existsSync(pipilotDir)) fs.mkdirSync(pipilotDir, { recursive: true });
    const mcpPath = path.join(pipilotDir, "mcp.json");
    let data: any = { mcpServers: {} };
    try { data = JSON.parse(fs.readFileSync(mcpPath, "utf8")); } catch {}
    data.mcpServers[name] = config;
    fs.writeFileSync(mcpPath, JSON.stringify(data, null, 2), "utf8");
    res.json({ success: true, installed: name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Uninstall an MCP server (remove from project config)
app.post("/api/mcp/uninstall", express.json(), (req, res) => {
  const { projectId, name } = req.body;
  if (!projectId || !name) return res.status(400).json({ error: "projectId, name required" });
  const workDir = getWorkDir(projectId);
  try {
    const mcpPath = path.join(workDir, ".pipilot", "mcp.json");
    if (!fs.existsSync(mcpPath)) return res.json({ success: true });
    const data = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    delete data.mcpServers?.[name];
    fs.writeFileSync(mcpPath, JSON.stringify(data, null, 2), "utf8");
    res.json({ success: true, uninstalled: name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List default (built-in) MCP servers
app.get("/api/mcp/defaults", (_req, res) => {
  res.json({
    defaults: [
      { name: "context7", description: "Documentation search for any library or framework", type: "http", url: "https://mcp.context7.com/mcp", builtin: true },
      { name: "appdeploy", description: "Deploy full-stack web apps from chat prompts", type: "http", url: "https://api-v2.appdeploy.ai/mcp", builtin: true },
      { name: "sequential-thinking", description: "Structured reasoning for complex multi-step tasks", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], builtin: true },
    ],
    configurable: [
      { name: "tavily", description: "Web search powered by Tavily AI", type: "http", urlTemplate: "https://mcp.tavily.com/mcp/?tavilyApiKey={TAVILY_API_KEY}", envVars: [{ name: "TAVILY_API_KEY", description: "Tavily API key (get at tavily.com)", required: true, secret: true }] },
      { name: "github", description: "GitHub repository operations (issues, PRs, code search)", type: "http", url: "https://api.githubcopilot.com/mcp", envVars: [{ name: "GITHUB_TOKEN", description: "GitHub personal access token", required: true, secret: true }] },
      { name: "supabase", description: "Supabase database & auth management", type: "http", urlTemplate: "https://mcp.supabase.com/mcp?project_ref={SUPABASE_PROJECT_REF}", envVars: [{ name: "SUPABASE_ACCESS_TOKEN", description: "Supabase access token", required: true, secret: true }, { name: "SUPABASE_PROJECT_REF", description: "Supabase project reference ID", required: true }] },
      { name: "playwright", description: "Browser automation for testing and scraping", type: "stdio", command: "npx", args: ["@playwright/mcp@latest"] },
      { name: "stripe", description: "Stripe payments, subscriptions, customers, and invoices", type: "http", urlTemplate: "https://mcp.stripe.com?token={STRIPE_SECRET_KEY}", envVars: [{ name: "STRIPE_SECRET_KEY", description: "Stripe secret key (get at dashboard.stripe.com/apikeys)", required: true, secret: true }] },
      { name: "sentry", description: "Error monitoring, issue tracking, and performance data", type: "http", urlTemplate: "https://mcp.sentry.dev/sse?token={SENTRY_AUTH_TOKEN}", envVars: [{ name: "SENTRY_AUTH_TOKEN", description: "Sentry auth token (get at sentry.io/settings/auth-tokens)", required: true, secret: true }] },
    ],
  });
});

// ── CLI Connectors CRUD ──

// Available connectors (mirrors the cloud version's connector list)
const CLI_CONNECTORS = [
  { id: "vercel", name: "Vercel", description: "Deploy and manage apps via Vercel CLI", tokenLabel: "Vercel Token", tokenUrl: "vercel.com/account/tokens", envVar: "VERCEL_TOKEN" },
  { id: "netlify", name: "Netlify", description: "Deploy static sites via Netlify CLI", tokenLabel: "Netlify Auth Token", tokenUrl: "app.netlify.com/user/applications#personal-access-tokens", envVar: "NETLIFY_AUTH_TOKEN" },
  { id: "cloudflare", name: "Cloudflare", description: "Deploy Workers and Pages via Wrangler CLI", tokenLabel: "Cloudflare API Token", tokenUrl: "dash.cloudflare.com/profile/api-tokens", envVar: "CLOUDFLARE_API_TOKEN" },
  { id: "railway", name: "Railway", description: "Deploy apps and services via Railway CLI", tokenLabel: "Railway Token", tokenUrl: "railway.com/account/tokens", envVar: "RAILWAY_TOKEN" },
  { id: "npm", name: "npm", description: "Publish and manage npm packages", tokenLabel: "npm Auth Token", tokenUrl: "npmjs.com/settings/tokens", envVar: "NPM_TOKEN" },
  { id: "neon", name: "Neon", description: "Serverless Postgres via Neon CLI", tokenLabel: "Neon API Key", tokenUrl: "console.neon.tech/app/settings/api-keys", envVar: "NEON_API_KEY" },
  { id: "turso", name: "Turso", description: "SQLite edge databases via Turso CLI", tokenLabel: "Turso Auth Token", tokenUrl: "turso.tech/dashboard", envVar: "TURSO_AUTH_TOKEN" },
];

// ── Wiki API ──

const WIKI_SKIP = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", ".cache",
  ".vite", "coverage", ".turbo", ".vercel", ".pipilot-data",
  "test-results", "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
]);

function scanProjectTree(dir: string, base = ""): { path: string; type: "file" | "dir"; size: number }[] {
  const results: { path: string; type: "file" | "dir"; size: number }[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (WIKI_SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        results.push({ path: rel, type: "dir", size: 0 });
        results.push(...scanProjectTree(path.join(dir, e.name), rel));
      } else if (e.isFile()) {
        try {
          const stat = fs.statSync(path.join(dir, e.name));
          if (stat.size < 500_000) { // skip files over 500KB
            results.push({ path: rel, type: "file", size: stat.size });
          }
        } catch {}
      }
    }
  } catch {}
  return results;
}

// Get wiki tree (list of generated wiki sections)
app.get("/api/wiki/tree", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getWorkDir(projectId);
  const wikiDir = path.join(workDir, ".pipilot", "wikis");

  if (!fs.existsSync(wikiDir)) {
    return res.json({ sections: [], exists: false });
  }

  // Read all .md files in the wikis directory
  const sections: { id: string; title: string; path: string; size: number }[] = [];
  try {
    const files = fs.readdirSync(wikiDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const fullPath = path.join(wikiDir, file);
      const content = fs.readFileSync(fullPath, "utf8");
      // Extract title from first # heading
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : file.replace(".md", "");
      const stat = fs.statSync(fullPath);
      sections.push({
        id: file.replace(".md", ""),
        title,
        path: `.pipilot/wikis/${file}`,
        size: stat.size,
      });
    }
  } catch {}

  // Sort: index first, then alphabetical
  sections.sort((a, b) => {
    if (a.id === "index") return -1;
    if (b.id === "index") return 1;
    return a.title.localeCompare(b.title);
  });

  res.json({ sections, exists: true });
});

// Get a specific wiki page content
app.get("/api/wiki/page", (req, res) => {
  const projectId = req.query.projectId as string;
  const pageId = req.query.pageId as string;
  if (!projectId || !pageId) return res.status(400).json({ error: "projectId, pageId required" });
  const workDir = getWorkDir(projectId);
  const filePath = path.join(workDir, ".pipilot", "wikis", `${pageId}.md`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Page not found" });
  }

  const content = fs.readFileSync(filePath, "utf8");
  res.json({ id: pageId, content });
});

// Scan the project and return its structure (for wiki generation)
app.get("/api/wiki/scan", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getWorkDir(projectId);
  const tree = scanProjectTree(workDir);
  res.json({ files: tree, total: tree.length });
});

// Save a wiki page (used by the wiki subagent)
app.post("/api/wiki/save", express.json({ limit: "5mb" }), (req, res) => {
  const { projectId, pageId, content } = req.body;
  if (!projectId || !pageId || content === undefined) {
    return res.status(400).json({ error: "projectId, pageId, content required" });
  }
  const workDir = getWorkDir(projectId);
  const wikiDir = path.join(workDir, ".pipilot", "wikis");
  try {
    if (!fs.existsSync(wikiDir)) fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, `${pageId}.md`), content, "utf8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agents API ──
app.get("/api/agents/list", (_req, res) => {
  res.json({
    agents: [
      { id: "fullstack-developer", name: "Fullstack Developer", description: "End-to-end feature development — DB, API, frontend", model: "sonnet", builtin: true },
      { id: "ai-engineer", name: "AI Engineer", description: "AI/ML integration — LLM apps, RAG, prompt engineering", model: "sonnet", builtin: true },
      { id: "api-designer", name: "API Designer", description: "REST/GraphQL API design, OpenAPI specs, auth patterns", model: "sonnet", builtin: true },
      { id: "security-engineer", name: "Security Engineer", description: "Vulnerability assessment, OWASP, DevSecOps", model: "sonnet", builtin: true },
      { id: "deployment-engineer", name: "Deployment Engineer", description: "CI/CD pipelines, Docker, Kubernetes, cloud infra", model: "sonnet", builtin: true },
      { id: "frontend-designer", name: "Frontend Designer", description: "Distinctive UI design with design system persistence", model: "sonnet", builtin: true },
      { id: "agent-installer", name: "Agent Installer", description: "Browse and install subagents from VoltAgent repository", model: "sonnet", builtin: true },
      { id: "mcp-installer", name: "MCP Installer", description: "Search and install MCP servers from the official registry", model: "sonnet", builtin: true },
      { id: "connector-finder", name: "Connector Finder", description: "Research and add CLI tool connectors", model: "sonnet", builtin: true },
    ],
  });
});

app.get("/api/connectors/list", (_req, res) => {
  res.json({ connectors: CLI_CONNECTORS });
});

app.get("/api/connectors/config", (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const workDir = getWorkDir(projectId);
  try {
    const p = path.join(workDir, ".pipilot", "connectors.json");
    if (!fs.existsSync(p)) return res.json({ connectors: {} });
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    // Strip actual token values for security — only return enabled state + metadata
    const safe: Record<string, { enabled: boolean; hasToken: boolean; envVar?: string; label?: string; description?: string; custom?: boolean }> = {};
    const builtinIds = new Set(CLI_CONNECTORS.map((c) => c.id));
    for (const [id, cfg] of Object.entries(data.connectors || {})) {
      const c = cfg as any;
      safe[id] = {
        enabled: !!c.enabled,
        hasToken: !!c.token,
        ...(c.envVar ? { envVar: c.envVar } : {}),
        ...(c.label ? { label: c.label } : {}),
        ...(c.description ? { description: c.description } : {}),
        ...(!builtinIds.has(id) ? { custom: true } : {}),
      };
    }
    res.json({ connectors: safe });
  } catch {
    res.json({ connectors: {} });
  }
});

app.post("/api/connectors/save", express.json(), (req, res) => {
  const { projectId, connectorId, token, enabled, envVar, label, description } = req.body;
  if (!projectId || !connectorId) return res.status(400).json({ error: "projectId, connectorId required" });
  const workDir = getWorkDir(projectId);
  try {
    const dir = path.join(workDir, ".pipilot");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "connectors.json");
    let data: any = { connectors: {} };
    try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    if (!data.connectors) data.connectors = {};
    const existing = data.connectors[connectorId] || {};
    data.connectors[connectorId] = {
      enabled: enabled !== false,
      token: token || existing.token || "",
      // Custom connectors store their env var name + metadata
      ...(envVar ? { envVar } : existing.envVar ? { envVar: existing.envVar } : {}),
      ...(label ? { label } : existing.label ? { label: existing.label } : {}),
      ...(description ? { description } : existing.description ? { description: existing.description } : {}),
    };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/connectors/remove", express.json(), (req, res) => {
  const { projectId, connectorId } = req.body;
  if (!projectId || !connectorId) return res.status(400).json({ error: "projectId, connectorId required" });
  const workDir = getWorkDir(projectId);
  try {
    const p = path.join(workDir, ".pipilot", "connectors.json");
    if (!fs.existsSync(p)) return res.json({ success: true });
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    delete data.connectors?.[connectorId];
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
