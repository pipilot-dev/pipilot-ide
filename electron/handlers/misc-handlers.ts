/**
 * Miscellaneous IPC handlers — health, wiki, agents list,
 * connectors (list/config/save/remove), codestral (fim/chat), deployments.
 * Ported from server/index.ts.
 */

import fs from "fs";
import path from "path";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, CONFIG_DIR } from "./shared";

function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

function loadJsonSafe(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return {}; }
}

// ── Codestral ──
const CODESTRAL_API_KEY = "DXfXAjwNIZcAv1ESKtoDwWZZF98lJxho";

// ── Available CLI connectors ──
const CLI_CONNECTORS = [
  { id: "vercel", name: "Vercel", description: "Deploy and manage apps via Vercel CLI", tokenLabel: "Vercel Token", tokenUrl: "vercel.com/account/tokens", envVar: "VERCEL_TOKEN" },
  { id: "netlify", name: "Netlify", description: "Deploy static sites via Netlify CLI", tokenLabel: "Netlify Auth Token", tokenUrl: "app.netlify.com/user/applications#personal-access-tokens", envVar: "NETLIFY_AUTH_TOKEN" },
  { id: "cloudflare", name: "Cloudflare", description: "Deploy Workers and Pages via Wrangler CLI", tokenLabel: "Cloudflare API Token", tokenUrl: "dash.cloudflare.com/profile/api-tokens", envVar: "CLOUDFLARE_API_TOKEN" },
  { id: "railway", name: "Railway", description: "Deploy apps and services via Railway CLI", tokenLabel: "Railway Token", tokenUrl: "railway.com/account/tokens", envVar: "RAILWAY_TOKEN" },
  { id: "npm", name: "npm", description: "Publish and manage npm packages", tokenLabel: "npm Auth Token", tokenUrl: "npmjs.com/settings/tokens", envVar: "NPM_TOKEN" },
  { id: "neon", name: "Neon", description: "Serverless Postgres via Neon CLI", tokenLabel: "Neon API Key", tokenUrl: "console.neon.tech/app/settings/api-keys", envVar: "NEON_API_KEY" },
  { id: "turso", name: "Turso", description: "SQLite edge databases via Turso CLI", tokenLabel: "Turso Auth Token", tokenUrl: "turso.tech/dashboard", envVar: "TURSO_AUTH_TOKEN" },
];

// ── Wiki helpers ──
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
          if (stat.size < 500_000) {
            results.push({ path: rel, type: "file", size: stat.size });
          }
        } catch {}
      }
    }
  } catch {}
  return results;
}

export function registerMiscHandlers(ctx: IpcContext) {
  const { get, post, stream } = ctx;

  // ── Health ──

  get("/api/health", () => {
    return { ok: true, uptime: process.uptime(), memory: Math.round(process.memoryUsage().rss / 1024 / 1024) };
  });

  // ── Wiki ──

  get("/api/wiki/tree", ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    const wikiDir = path.join(workDir, ".pipilot", "wikis");

    if (!fs.existsSync(wikiDir)) {
      return { sections: [], exists: false };
    }

    const sections: { id: string; title: string; path: string; size: number }[] = [];
    try {
      const files = fs.readdirSync(wikiDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const fullPath = path.join(wikiDir, file);
        const content = fs.readFileSync(fullPath, "utf8");
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

    sections.sort((a, b) => {
      if (a.id === "index") return -1;
      if (b.id === "index") return 1;
      return a.title.localeCompare(b.title);
    });

    return { sections, exists: true };
  });

  get("/api/wiki/page", ({ query }) => {
    const projectId = query?.projectId as string;
    const pageId = query?.pageId as string;
    if (!projectId || !pageId) throw new Error("projectId, pageId required");
    const workDir = getWorkDir(projectId);
    const filePath = path.join(workDir, ".pipilot", "wikis", `${pageId}.md`);

    if (!fs.existsSync(filePath)) throw new Error("Page not found");

    const content = fs.readFileSync(filePath, "utf8");
    return { id: pageId, content };
  });

  get("/api/wiki/scan", ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    const tree = scanProjectTree(workDir);
    return { files: tree, total: tree.length };
  });

  post("/api/wiki/save", ({ body }) => {
    const { projectId, pageId, content } = body;
    if (!projectId || !pageId || content === undefined) {
      throw new Error("projectId, pageId, content required");
    }
    const workDir = getWorkDir(projectId);
    const wikiDir = path.join(workDir, ".pipilot", "wikis");
    if (!fs.existsSync(wikiDir)) fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, `${pageId}.md`), content, "utf8");
    return { success: true };
  });

  // ── Agents ──

  get("/api/agents/list", () => {
    return {
      agents: [
        { id: "fullstack-developer", name: "Fullstack Developer", description: "End-to-end feature development — DB, API, frontend", model: "sonnet", builtin: true },
        { id: "ai-engineer", name: "AI Engineer", description: "AI/ML integration — LLM apps, RAG, prompt engineering", model: "sonnet", builtin: true },
        { id: "api-designer", name: "API Designer", description: "REST/GraphQL API design, OpenAPI specs, auth patterns", model: "sonnet", builtin: true },
        { id: "security-engineer", name: "Security Engineer", description: "Vulnerability assessment, OWASP, DevSecOps", model: "sonnet", builtin: true },
        { id: "deployment-engineer", name: "Deployment Engineer", description: "Deploy to GitHub/Vercel/Netlify/Cloudflare + CI/CD pipelines", model: "sonnet", builtin: true },
        { id: "frontend-designer", name: "Frontend Designer", description: "Distinctive UI design with design system persistence", model: "sonnet", builtin: true },
        { id: "agent-installer", name: "Agent Installer", description: "Browse and install subagents from VoltAgent repository", model: "sonnet", builtin: true },
        { id: "mcp-installer", name: "MCP Installer", description: "Search and install MCP servers from the official registry", model: "sonnet", builtin: true },
        { id: "connector-finder", name: "Connector Finder", description: "Research and add CLI tool connectors", model: "sonnet", builtin: true },
      ],
    };
  });

  // ── Connectors ──

  get("/api/connectors/list", () => {
    return { connectors: CLI_CONNECTORS };
  });

  get("/api/connectors/config", ({ query }) => {
    const projectId = query?.projectId as string;
    try {
      const builtinIds = new Set(CLI_CONNECTORS.map((c) => c.id));
      const safe: Record<string, { enabled: boolean; hasToken: boolean; scope: "global" | "project"; envVar?: string; label?: string; description?: string; custom?: boolean }> = {};

      const globalData = loadJsonSafe(path.join(CONFIG_DIR, "connectors.json"));
      for (const [id, cfg] of Object.entries((globalData.connectors || {}) as Record<string, any>)) {
        safe[id] = {
          enabled: !!cfg.enabled, hasToken: !!cfg.token, scope: "global",
          ...(cfg.envVar ? { envVar: cfg.envVar } : {}),
          ...(cfg.label ? { label: cfg.label } : {}),
          ...(cfg.description ? { description: cfg.description } : {}),
          ...(!builtinIds.has(id) ? { custom: true } : {}),
        };
      }

      if (projectId) {
        const workDir = getWorkDir(projectId);
        const projectData = loadJsonSafe(path.join(workDir, ".pipilot", "connectors.json"));
        for (const [id, cfg] of Object.entries((projectData.connectors || {}) as Record<string, any>)) {
          safe[id] = {
            enabled: !!cfg.enabled, hasToken: !!cfg.token, scope: "project",
            ...(cfg.envVar ? { envVar: cfg.envVar } : {}),
            ...(cfg.label ? { label: cfg.label } : {}),
            ...(cfg.description ? { description: cfg.description } : {}),
            ...(!builtinIds.has(id) ? { custom: true } : {}),
          };
        }
      }

      return { connectors: safe };
    } catch {
      return { connectors: {} };
    }
  });

  post("/api/connectors/save", ({ body }) => {
    const { projectId, connectorId, token, enabled, envVar, label, description, scope } = body;
    if (!connectorId) throw new Error("connectorId required");
    const isGlobal = scope === "global";
    const dir = isGlobal ? CONFIG_DIR : path.join(getWorkDir(projectId || ""), ".pipilot");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "connectors.json");
    let data: any = { connectors: {} };
    try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    if (!data.connectors) data.connectors = {};
    const existing = data.connectors[connectorId] || {};
    data.connectors[connectorId] = {
      enabled: enabled !== false,
      token: token || existing.token || "",
      ...(envVar ? { envVar } : existing.envVar ? { envVar: existing.envVar } : {}),
      ...(label ? { label } : existing.label ? { label: existing.label } : {}),
      ...(description ? { description } : existing.description ? { description: existing.description } : {}),
    };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    return { success: true };
  });

  post("/api/connectors/remove", ({ body }) => {
    const { projectId, connectorId } = body;
    if (!projectId || !connectorId) throw new Error("projectId, connectorId required");
    const workDir = getWorkDir(projectId);
    const p = path.join(workDir, ".pipilot", "connectors.json");
    if (!fs.existsSync(p)) return { success: true };
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    delete data.connectors?.[connectorId];
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    return { success: true };
  });

  // ── Codestral FIM ──

  post("/api/codestral/fim", async ({ body }) => {
    const https = await import("https");
    const payload = JSON.stringify(body);
    const options = {
      hostname: "codestral.mistral.ai",
      path: "/v1/fim/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CODESTRAL_API_KEY}`,
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 30000,
    };
    const data = await new Promise<string>((resolve, reject) => {
      const req2 = https.request(options, (upstream) => {
        let responseBody = "";
        upstream.on("data", (chunk: Buffer) => { responseBody += chunk.toString(); });
        upstream.on("end", () => {
          if (upstream.statusCode && upstream.statusCode >= 400) {
            reject(new Error(`Codestral: ${upstream.statusCode}`));
          } else {
            resolve(responseBody);
          }
        });
      });
      req2.on("error", reject);
      req2.on("timeout", () => { req2.destroy(); reject(new Error("Codestral timeout")); });
      req2.write(payload);
      req2.end();
    });
    return JSON.parse(data);
  });

  // ── Codestral Chat (non-streaming) ──

  post("/api/codestral/chat", async ({ body }) => {
    const isStream = body?.stream === true;

    if (isStream) {
      // For streaming codestral chat, we return a special marker.
      // The actual streaming is handled via stream("POST", "/api/codestral/chat/stream")
      // For IPC context, we proxy the full response as a non-streaming call.
      const upstream = await fetch("https://codestral.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CODESTRAL_API_KEY}`,
        },
        body: JSON.stringify({ ...body, stream: false }),
      });
      if (!upstream.ok) throw new Error(`Codestral: ${upstream.status}`);
      return upstream.json();
    }

    const upstream = await fetch("https://codestral.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CODESTRAL_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) throw new Error(`Codestral: ${upstream.status}`);
    return upstream.json();
  });

  // ── Codestral Chat streaming ──

  stream("POST", "/api/codestral/chat/stream", async ({ body }, send, done) => {
    try {
      const upstream = await fetch("https://codestral.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CODESTRAL_API_KEY}`,
        },
        body: JSON.stringify({ ...body, stream: true }),
      });

      if (!upstream.ok || !upstream.body) {
        send({ error: `Codestral: ${upstream.status}` });
        done();
        return;
      }

      const reader = (upstream.body as any).getReader ? (upstream.body as any).getReader() : null;
      if (reader) {
        let buffer = "";
        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;
          buffer += Buffer.from(value).toString("utf8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (trimmed.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                send({ chunk: parsed });
              } catch {}
            }
          }
        }
      }
    } catch (err: any) {
      send({ error: err.message });
    }
    done();
  });
}
