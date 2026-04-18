/**
 * Tauri fetch interceptor — patches window.fetch so that ALL existing
 * fetch("/api/...") calls automatically route through Tauri IPC when
 * running in desktop mode. Zero component code changes needed.
 *
 * In web mode: does nothing (native fetch works as-is).
 * In Tauri mode: intercepts /api/* requests and routes them to the
 * appropriate invoke() command or to the Express sidecar for agent streaming.
 *
 * This is imported once in main.tsx before the app renders.
 */

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

if (isTauri) {
  const originalFetch = window.fetch.bind(window);

  // Lazy-load invoke
  let invokePromise: Promise<any> | null = null;
  const getInvoke = () => {
    if (!invokePromise) {
      invokePromise = import("@tauri-apps/api/core").then((m) => m.invoke);
    }
    return invokePromise;
  };

  // Routes that MUST stay as HTTP (agent streaming uses SSE)
  const HTTP_ONLY_ROUTES = [
    "/api/agent",        // Agent SDK SSE streaming
    "/api/agent/",       // Agent sub-routes
    "/api/mcp/",         // MCP server management
    "/api/agents/",      // Agent listing
  ];

  // Routes that go through Express sidecar (still HTTP but to localhost)
  // These are the ones not yet implemented in Rust or need SSE
  const SIDECAR_ROUTES = [
    "/api/files/watch",     // SSE file watcher
    "/api/files/tree",      // Complex recursive tree
    "/api/files/zip",       // Zip generation
    "/api/files/zip-selection",
    "/api/files/upload",    // Multipart upload
    "/api/files/raw",       // Raw file serving
    "/api/files/types",     // File type detection
    "/api/preview",         // HTML preview rendering
    "/api/dev-preview",     // Dev server proxy
    "/api/terminal/stream", // SSE terminal output
    "/api/terminal/profiles",
    "/api/dev-server/logs", // SSE log streaming
    "/api/connectors/",     // Token management (security)
    "/api/agents/",         // Agent model listing
  ];

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

    // Only intercept /api/* calls
    if (!url.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    // HTTP-only routes always go to Express sidecar
    if (HTTP_ONLY_ROUTES.some((r) => url.startsWith(r))) {
      return originalFetch(input, init);
    }

    // Sidecar routes go to Express on the agent port
    if (SIDECAR_ROUTES.some((r) => url.startsWith(r))) {
      // Rewrite URL to point to the sidecar server
      const sidecarUrl = `http://localhost:51731${url}`;
      return originalFetch(sidecarUrl, init);
    }

    // Everything else: try Tauri IPC, fall back to sidecar HTTP
    try {
      const invoke = await getInvoke();
      const method = init?.method?.toUpperCase() || "GET";
      const body = init?.body ? JSON.parse(init.body as string) : {};

      // Parse URL query params for GET requests
      const urlObj = new URL(url, "http://localhost");
      const params: Record<string, string> = {};
      urlObj.searchParams.forEach((v, k) => { params[k] = v; });

      // Map URL path + method to Tauri command
      const command = mapUrlToCommand(urlObj.pathname, method, { ...params, ...body });
      if (command) {
        const result = await invoke(command.name, command.args);
        // Wrap in a Response-like object
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {
      // IPC failed — fall through to sidecar HTTP
    }

    // Fallback: route to Express sidecar
    const sidecarUrl = `http://localhost:51731${url}`;
    return originalFetch(sidecarUrl, init);
  };
}

// ── URL → Tauri command mapping ──

interface CommandMapping {
  name: string;
  args: Record<string, unknown>;
}

function mapUrlToCommand(
  path: string,
  method: string,
  params: Record<string, any>,
): CommandMapping | null {
  const p = path.replace(/^\/api\//, "");

  // ── Git ──
  if (p === "git/check" && method === "GET") return { name: "git_check", args: {} };
  if (p === "git/status" && method === "GET") return { name: "git_status", args: { cwd: params.workDir || params.cwd || "" } };
  if (p === "git/init" && method === "POST") return { name: "git_init", args: { cwd: params.workDir || "" } };
  if (p === "git/add" && method === "POST") return { name: "git_add", args: { cwd: params.workDir || "", paths: params.files || params.paths || ["."] } };
  if (p === "git/commit" && method === "POST") return { name: "git_commit", args: { cwd: params.workDir || "", message: params.message || "" } };
  if (p === "git/log" && method === "GET") return { name: "git_log", args: { cwd: params.workDir || "", count: parseInt(params.count || "20") } };
  if (p === "git/diff" && method === "GET") return { name: "git_diff", args: { cwd: params.workDir || "", path: params.path || null } };
  if (p === "git/push" && method === "POST") return { name: "git_push", args: { cwd: params.workDir || "", remote: params.remote || "origin", branch: params.branch || "main" } };
  if (p === "git/pull" && method === "POST") return { name: "git_pull", args: { cwd: params.workDir || "", remote: params.remote || "origin", branch: params.branch || "main" } };
  if (p === "git/branch" && method === "POST") return { name: "git_branch_create", args: { cwd: params.workDir || "", name: params.name || "" } };
  if (p === "git/checkout" && method === "POST") return { name: "git_checkout", args: { cwd: params.workDir || "", refName: params.branch || params.ref || "" } };
  if (p.startsWith("git/branch") && method === "GET") return { name: "git_branch_list", args: { cwd: params.workDir || "" } };

  // ── File System ──
  if (p === "files/read" && method === "GET") return { name: "fs_read_file", args: { path: params.path || "" } };
  if (p === "files/write" && method === "POST") return { name: "fs_write_file", args: { path: params.path || "", content: params.content || "" } };
  if (p === "files/mkdir" && method === "POST") return { name: "fs_create_dir", args: { path: params.path || "" } };
  if (p === "files" && method === "DELETE") return { name: "fs_delete", args: { path: params.path || "" } };
  if (p === "files/rename" && method === "POST") return { name: "fs_rename", args: { oldPath: params.oldPath || "", newPath: params.newPath || "" } };
  if (p === "files/list-dir" && method === "GET") return { name: "fs_list_dir", args: { path: params.path || "" } };
  if (p === "fs/home" && method === "GET") return { name: "fs_home", args: {} };
  if (p === "fs/list" && method === "GET") return { name: "fs_list_directory", args: { dirPath: params.path || params.dir || "" } };

  // ── Checkpoints ──
  if (p === "checkpoints/create" && method === "POST") return { name: "checkpoint_create", args: { cwd: params.workDir || "", label: params.label || "", messageId: params.messageId || null } };
  if (p === "checkpoints/list" && method === "GET") return { name: "checkpoint_list", args: { dataDir: "", projectId: params.projectId || "" } };
  if (p === "checkpoints/restore" && method === "POST") return { name: "checkpoint_restore", args: { cwd: params.workDir || "", sha: params.checkpointId || "" } };
  if (p === "checkpoints/git-available" && method === "GET") return { name: "checkpoint_git_available", args: {} };

  // ── Workspace ──
  if (p === "workspaces/link" && method === "POST") return { name: "workspace_link", args: { workspaceBase: "", absolutePath: params.absolutePath || params.path || "" } };
  if (p === "workspaces/unlink" && method === "POST") return { name: "workspace_unlink", args: { workspaceBase: "", projectId: params.projectId || "" } };
  if (p === "workspaces/list" && method === "GET") return { name: "workspace_list", args: { workspaceBase: "" } };
  if (p === "workspaces/info" && method === "GET") return { name: "workspace_info", args: { workspaceBase: "", projectId: params.projectId || "" } };
  if (p === "workspaces/touch" && method === "POST") return { name: "workspace_touch", args: { workspaceBase: "", projectId: params.projectId || "" } };

  // ── Dev Server ──
  if (p === "dev-server/start" && method === "POST") return { name: "dev_server_start", args: { cwd: params.workDir || "", command: params.command || "" } };
  if (p === "dev-server/stop" && method === "POST") return { name: "dev_server_stop", args: { pid: params.pid || "" } };
  if (p === "dev-server/status" && method === "GET") return { name: "dev_server_status", args: { pid: params.pid || "" } };

  // ── Wiki ──
  if (p === "wiki/tree" && method === "GET") return { name: "wiki_tree", args: { cwd: params.workDir || "" } };
  if (p === "wiki/page" && method === "GET") return { name: "wiki_page", args: { cwd: params.workDir || "", pagePath: params.path || "" } };
  if (p === "wiki/scan" && method === "GET") return { name: "wiki_scan", args: { cwd: params.workDir || "" } };
  if (p === "wiki/save" && method === "POST") return { name: "wiki_save", args: { cwd: params.workDir || "", pagePath: params.path || "", content: params.content || "" } };

  // ── Diagnostics ──
  if (p === "diagnostics/check" && method === "GET") return { name: "diagnostics_check", args: { cwd: params.workDir || params.projectId || "" } };
  if (p === "diagnostics/install-deps" && method === "POST") return { name: "diagnostics_install_deps", args: { cwd: params.workDir || "", packageManager: params.packageManager || "npm" } };

  // ── Project ──
  if (p === "project/detect-framework" && method === "GET") return { name: "project_detect_framework", args: { cwd: params.workDir || "" } };
  if (p === "project/scripts" && method === "GET") return { name: "project_scripts", args: { cwd: params.workDir || "" } };
  if (p === "project/search" && method === "POST") return { name: "project_search", args: { cwd: params.workDir || "", query: params.query || "" } };

  // ── Codestral ──
  if (p === "codestral/fim" && method === "POST") return { name: "codestral_fim", args: { apiKey: params.apiKey || "", prefix: params.prefix || "", suffix: params.suffix || "", language: params.language || "" } };
  if (p === "codestral/chat" && method === "POST") return { name: "codestral_chat", args: { apiKey: params.apiKey || "", messages: params.messages || [] } };

  // No mapping found — will fall through to HTTP
  return null;
}

export {};
