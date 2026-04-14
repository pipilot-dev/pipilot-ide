/**
 * Wiki bridge — abstracts wiki/documentation operations between:
 *   - Web mode: HTTP fetch to Express endpoints
 *   - Tauri mode: IPC invoke to Rust backend
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface WikiBridge {
  tree(projectId: string): Promise<any>;
  page(projectId: string, pagePath: string): Promise<any>;
  scan(projectId: string): Promise<any>;
  save(projectId: string, pagePath: string, content: string): Promise<void>;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): WikiBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async tree(projectId) {
      await init();
      return invoke("wikiTree", { projectId });
    },

    async page(projectId, pagePath) {
      await init();
      return invoke("wikiPage", { projectId, pagePath });
    },

    async scan(projectId) {
      await init();
      return invoke("wikiScan", { projectId });
    },

    async save(projectId, pagePath, content) {
      await init();
      return invoke("wikiSave", { projectId, pagePath, content });
    },
  };
}

// ── HTTP bridge (existing web mode) ──

function createWebBridge(): WikiBridge {
  return {
    async tree(projectId) {
      const res = await fetch(`/api/wiki/tree?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to get wiki tree");
      return res.json();
    },

    async page(projectId, pagePath) {
      const res = await fetch(
        `/api/wiki/page?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(pagePath)}`
      );
      if (!res.ok) throw new Error("Failed to get wiki page");
      return res.json();
    },

    async scan(projectId) {
      const res = await fetch(`/api/wiki/scan?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to scan wiki");
      return res.json();
    },

    async save(projectId, pagePath, content) {
      const res = await fetch("/api/wiki/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, pagePath, content }),
      });
      if (!res.ok) throw new Error("Failed to save wiki page");
    },
  };
}

// ── Export the appropriate bridge ──

export const wikiBridge: WikiBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
