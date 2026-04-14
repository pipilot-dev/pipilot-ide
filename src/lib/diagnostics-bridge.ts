/**
 * Diagnostics bridge — abstracts diagnostics operations between:
 *   - Web mode: HTTP fetch to Express endpoints
 *   - Tauri mode: IPC invoke to Rust backend
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface DiagnosticsBridge {
  check(projectId: string): Promise<any>;
  installDeps(projectId: string, packageManager?: string): Promise<any>;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): DiagnosticsBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async check(projectId) {
      await init();
      return invoke("diagnosticsCheck", { projectId });
    },

    async installDeps(projectId, packageManager) {
      await init();
      return invoke("diagnosticsInstallDeps", { projectId, packageManager: packageManager ?? null });
    },
  };
}

// ── HTTP bridge (existing web mode) ──

function createWebBridge(): DiagnosticsBridge {
  return {
    async check(projectId) {
      const res = await fetch(`/api/diagnostics/check?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("Failed to run diagnostics check");
      return res.json();
    },

    async installDeps(projectId, packageManager) {
      const res = await fetch("/api/diagnostics/install-deps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, packageManager }),
      });
      if (!res.ok) throw new Error("Failed to install dependencies");
      return res.json();
    },
  };
}

// ── Export the appropriate bridge ──

export const diagnosticsBridge: DiagnosticsBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
