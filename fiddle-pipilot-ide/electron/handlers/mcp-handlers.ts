/**
 * MCP IPC handlers — registry search, config, install, uninstall, defaults.
 * Ported from server/index.ts.
 */

import fs from "fs";
import path from "path";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, CONFIG_DIR } from "./shared";

function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

export function registerMcpHandlers(ctx: IpcContext) {
  const { get, post } = ctx;

  // ── Search MCP registry ──

  get("/api/mcp/search", async ({ query }) => {
    const search = (query?.search as string) || "";
    const limit = parseInt(query?.limit as string) || 30;

    const url = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(search)}&limit=${limit}&version=latest`;
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    if (!upstream.ok) throw new Error(`Registry: ${upstream.status}`);

    const data = await upstream.json() as any;

    const servers = (data.servers || [])
      .map((entry: any) => {
        const s = entry.server || {};
        const meta = entry._meta?.["io.modelcontextprotocol.registry/official"] || {};

        const hasStdio = (s.packages || []).some(
          (p: any) => p.transport?.type === "stdio",
        );
        const safeRemotes = (s.remotes || []).filter((r: any) => {
          if (!r.headers || r.headers.length === 0) return true;
          return r.headers.every((h: any) => {
            if (h.name === "Authorization" && h.isSecret) return true;
            if (h.isSecret && !h.value?.includes("oauth") && !h.value?.includes("redirect")) return true;
            return false;
          });
        });

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
      .filter(Boolean);

    return { servers, total: servers.length };
  });

  // ── MCP config (project) ──

  get("/api/mcp/config", ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    try {
      const mcpPath = path.join(workDir, ".pipilot", "mcp.json");
      if (!fs.existsSync(mcpPath)) return { mcpServers: {} };
      return JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    } catch {
      return { mcpServers: {} };
    }
  });

  post("/api/mcp/config", ({ body }) => {
    const { projectId, mcpServers } = body;
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    const pipilotDir = path.join(workDir, ".pipilot");
    if (!fs.existsSync(pipilotDir)) fs.mkdirSync(pipilotDir, { recursive: true });
    const mcpPath = path.join(pipilotDir, "mcp.json");
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: mcpServers || {} }, null, 2), "utf8");
    return { success: true };
  });

  // ── Install MCP server ──

  post("/api/mcp/install", ({ body }) => {
    const { projectId, name, config, scope } = body;
    if (!name || !config) throw new Error("name, config required");
    const isGlobal = scope === "global";
    const pipilotDir = isGlobal ? CONFIG_DIR : path.join(getWorkDir(projectId || ""), ".pipilot");
    if (!fs.existsSync(pipilotDir)) fs.mkdirSync(pipilotDir, { recursive: true });
    const mcpPath = path.join(pipilotDir, "mcp.json");
    let data: any = { mcpServers: {} };
    try { data = JSON.parse(fs.readFileSync(mcpPath, "utf8")); } catch {}
    data.mcpServers[name] = config;
    fs.writeFileSync(mcpPath, JSON.stringify(data, null, 2), "utf8");
    return { success: true, installed: name };
  });

  // ── Uninstall MCP server ──

  post("/api/mcp/uninstall", ({ body }) => {
    const { projectId, name, scope } = body;
    if (!name) throw new Error("name required");
    const isGlobal = scope === "global";
    const mcpPath = isGlobal
      ? path.join(CONFIG_DIR, "mcp.json")
      : path.join(getWorkDir(projectId || ""), ".pipilot", "mcp.json");
    if (!fs.existsSync(mcpPath)) return { success: true };
    const data = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    delete data.mcpServers?.[name];
    fs.writeFileSync(mcpPath, JSON.stringify(data, null, 2), "utf8");
    return { success: true, uninstalled: name };
  });

  // ── Default MCP servers ──

  get("/api/mcp/defaults", () => {
    return {
      defaults: [
        { name: "context7", description: "Documentation search for any library or framework", type: "http", url: "https://mcp.context7.com/mcp", builtin: true },
        { name: "appdeploy", description: "Deploy full-stack web apps from chat prompts", type: "http", url: "https://api-v2.appdeploy.ai/mcp", builtin: true },
        { name: "deepwiki", description: "Read wiki docs and ask questions about any public GitHub repository", type: "http", url: "https://mcp.deepwiki.com/mcp", builtin: true },
        { name: "sequential-thinking", description: "Structured reasoning for complex multi-step tasks", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], builtin: true },
        { name: "chrome-devtools", description: "Chrome DevTools automation — inspect, debug, and interact with running pages", type: "stdio", command: "npx", args: ["chrome-devtools-mcp@latest", "--autoConnect"], builtin: true },
        { name: "playwright", description: "Browser automation — navigate, click, fill forms, take screenshots, test web apps", type: "stdio", command: "npx", args: ["-y", "@anthropic-ai/mcp-server-playwright@latest"], builtin: true },
      ],
      configurable: [
        { name: "tavily", description: "Web search powered by Tavily AI", type: "http", urlTemplate: "https://mcp.tavily.com/mcp/?tavilyApiKey={TAVILY_API_KEY}", envVars: [{ name: "TAVILY_API_KEY", description: "Tavily API key (get at tavily.com)", required: true, secret: true }] },
        { name: "github", description: "GitHub repository operations (issues, PRs, code search)", type: "http", url: "https://api.githubcopilot.com/mcp", envVars: [{ name: "GITHUB_TOKEN", description: "GitHub personal access token", required: true, secret: true }] },
        { name: "supabase", description: "Supabase database & auth management", type: "http", urlTemplate: "https://mcp.supabase.com/mcp?project_ref={SUPABASE_PROJECT_REF}", envVars: [{ name: "SUPABASE_ACCESS_TOKEN", description: "Supabase access token", required: true, secret: true }, { name: "SUPABASE_PROJECT_REF", description: "Supabase project reference ID", required: true }] },
        { name: "playwright", description: "Browser automation for testing and scraping", type: "stdio", command: "npx", args: ["@playwright/mcp@latest"] },
        { name: "stripe", description: "Stripe payments, subscriptions, customers, and invoices", type: "http", urlTemplate: "https://mcp.stripe.com?token={STRIPE_SECRET_KEY}", envVars: [{ name: "STRIPE_SECRET_KEY", description: "Stripe secret key (get at dashboard.stripe.com/apikeys)", required: true, secret: true }] },
        { name: "sentry", description: "Error monitoring, issue tracking, and performance data", type: "http", urlTemplate: "https://mcp.sentry.dev/sse?token={SENTRY_AUTH_TOKEN}", envVars: [{ name: "SENTRY_AUTH_TOKEN", description: "Sentry auth token (get at sentry.io/settings/auth-tokens)", required: true, secret: true }] },
      ],
    };
  });
}
