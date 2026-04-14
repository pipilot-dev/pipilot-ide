/**
 * Dev Server bridge — abstracts dev server operations between:
 *   - Web mode: HTTP fetch to Express endpoints
 *   - Tauri mode: IPC invoke to Rust backend
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface DevServerBridge {
  start(projectId: string, opts?: { force?: boolean }): Promise<any>;
  stop(projectId: string): Promise<any>;
  status(projectId: string): Promise<any>;
  logs(projectId: string): Promise<string[]>;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): DevServerBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async start(projectId, opts) {
      await init();
      return invoke("devServerStart", { projectId, force: opts?.force ?? false });
    },

    async stop(projectId) {
      await init();
      return invoke("devServerStop", { projectId });
    },

    async status(projectId) {
      await init();
      return invoke("devServerStatus", { projectId });
    },

    async logs(projectId) {
      await init();
      return invoke("devServerLogs", { projectId });
    },
  };
}

// ── HTTP bridge (existing web mode) ──

function createWebBridge(): DevServerBridge {
  return {
    async start(projectId, opts) {
      const res = await fetch("/api/dev-server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, force: opts?.force ?? false }),
      });
      if (!res.ok) throw new Error("Failed to start dev server");
      return res.json();
    },

    async stop(projectId) {
      const res = await fetch("/api/dev-server/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Failed to stop dev server");
      return res.json();
    },

    async status(projectId) {
      const res = await fetch(`/api/dev-server/status?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to get dev server status");
      return res.json();
    },

    async logs(projectId) {
      const res = await fetch(`/api/dev-server/logs?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to get dev server logs");
      return res.json();
    },
  };
}

// ── Export the appropriate bridge ──

export const devServerBridge: DevServerBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
