/**
 * Checkpoint bridge — abstracts checkpoint operations between:
 *   - Web mode: HTTP fetch to Express endpoints
 *   - Tauri mode: IPC invoke to Rust backend
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface CheckpointBridge {
  create(projectId: string, label: string, messageId?: string): Promise<any>;
  list(projectId: string): Promise<any[]>;
  restore(projectId: string, checkpointId: string): Promise<any>;
  findBefore(projectId: string, messageId: string): Promise<any>;
  delete(projectId: string, checkpointId: string): Promise<void>;
  clear(projectId: string): Promise<void>;
  gitAvailable(): Promise<boolean>;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): CheckpointBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async create(projectId, label, messageId) {
      await init();
      return invoke("checkpointCreate", { projectId, label, messageId: messageId ?? null });
    },

    async list(projectId) {
      await init();
      return invoke("checkpointList", { projectId });
    },

    async restore(projectId, checkpointId) {
      await init();
      return invoke("checkpointRestore", { projectId, checkpointId });
    },

    async findBefore(projectId, messageId) {
      await init();
      return invoke("checkpointFindBefore", { projectId, messageId });
    },

    async delete(projectId, checkpointId) {
      await init();
      return invoke("checkpointDelete", { projectId, checkpointId });
    },

    async clear(projectId) {
      await init();
      return invoke("checkpointClear", { projectId });
    },

    async gitAvailable() {
      await init();
      return invoke("checkpointGitAvailable");
    },
  };
}

// ── HTTP bridge (existing web mode) ──

function createWebBridge(): CheckpointBridge {
  return {
    async create(projectId, label, messageId) {
      const res = await fetch("/api/checkpoints/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, label, messageId }),
      });
      if (!res.ok) throw new Error("Failed to create checkpoint");
      return res.json();
    },

    async list(projectId) {
      const res = await fetch(`/api/checkpoints/list?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to list checkpoints");
      return res.json();
    },

    async restore(projectId, checkpointId) {
      const res = await fetch("/api/checkpoints/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, checkpointId }),
      });
      if (!res.ok) throw new Error("Failed to restore checkpoint");
      return res.json();
    },

    async findBefore(projectId, messageId) {
      const res = await fetch(
        `/api/checkpoints/find-before?projectId=${encodeURIComponent(projectId)}&messageId=${encodeURIComponent(messageId)}`
      );
      if (!res.ok) throw new Error("Failed to find checkpoint before message");
      return res.json();
    },

    async delete(projectId, checkpointId) {
      const res = await fetch("/api/checkpoints/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, checkpointId }),
      });
      if (!res.ok) throw new Error("Failed to delete checkpoint");
    },

    async clear(projectId) {
      const res = await fetch("/api/checkpoints/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Failed to clear checkpoints");
    },

    async gitAvailable() {
      const res = await fetch("/api/checkpoints/git-available");
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.available;
    },
  };
}

// ── Export the appropriate bridge ──

export const checkpointBridge: CheckpointBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
