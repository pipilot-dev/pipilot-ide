/**
 * Workspace bridge — abstracts workspace and filesystem operations between:
 *   - Web mode: HTTP fetch to Express endpoints
 *   - Tauri mode: IPC invoke to Rust backend
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface WorkspaceBridge {
  link(absolutePath: string): Promise<any>;
  unlink(projectId: string): Promise<void>;
  list(): Promise<any[]>;
  info(projectId: string): Promise<any>;
  touch(projectId: string): Promise<void>;
  fsHome(): Promise<{ home: string }>;
  fsList(dirPath: string): Promise<any[]>;
  detectFramework(projectId: string): Promise<any>;
  scripts(projectId: string): Promise<any>;
  search(projectId: string, query: string): Promise<any>;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): WorkspaceBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async link(absolutePath) {
      await init();
      return invoke("workspaceLink", { absolutePath });
    },

    async unlink(projectId) {
      await init();
      return invoke("workspaceUnlink", { projectId });
    },

    async list() {
      await init();
      return invoke("workspaceList");
    },

    async info(projectId) {
      await init();
      return invoke("workspaceInfo", { projectId });
    },

    async touch(projectId) {
      await init();
      return invoke("workspaceTouch", { projectId });
    },

    async fsHome() {
      await init();
      return invoke("fsHome");
    },

    async fsList(dirPath) {
      await init();
      return invoke("fsList", { dirPath });
    },

    async detectFramework(projectId) {
      await init();
      return invoke("projectDetectFramework", { projectId });
    },

    async scripts(projectId) {
      await init();
      return invoke("projectScripts", { projectId });
    },

    async search(projectId, query) {
      await init();
      return invoke("projectSearch", { projectId, query });
    },
  };
}

// ── HTTP bridge (existing web mode) ──

function createWebBridge(): WorkspaceBridge {
  return {
    async link(absolutePath) {
      const res = await fetch("/api/workspaces/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath }),
      });
      if (!res.ok) throw new Error("Failed to link workspace");
      return res.json();
    },

    async unlink(projectId) {
      const res = await fetch("/api/workspaces/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Failed to unlink workspace");
    },

    async list() {
      const res = await fetch("/api/workspaces/list");
      if (!res.ok) throw new Error("Failed to list workspaces");
      return res.json();
    },

    async info(projectId) {
      const res = await fetch(`/api/workspaces/info?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to get workspace info");
      return res.json();
    },

    async touch(projectId) {
      const res = await fetch("/api/workspaces/touch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Failed to touch workspace");
    },

    async fsHome() {
      const res = await fetch("/api/fs/home");
      if (!res.ok) throw new Error("Failed to get home directory");
      return res.json();
    },

    async fsList(dirPath) {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`);
      if (!res.ok) throw new Error("Failed to list directory");
      return res.json();
    },

    async detectFramework(projectId) {
      const res = await fetch(`/api/project/detect-framework?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to detect framework");
      return res.json();
    },

    async scripts(projectId) {
      const res = await fetch(`/api/project/scripts?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to get project scripts");
      return res.json();
    },

    async search(projectId, query) {
      const res = await fetch("/api/project/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query }),
      });
      if (!res.ok) throw new Error("Failed to search project");
      return res.json();
    },
  };
}

// ── Export the appropriate bridge ──

export const workspaceBridge: WorkspaceBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
