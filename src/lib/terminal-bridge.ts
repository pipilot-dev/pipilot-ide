/**
 * Terminal bridge — abstracts terminal operations between:
 *   - Web mode: HTTP fetch + SSE (current Express-based terminal)
 *   - Tauri mode: IPC invoke + event listeners (Rust PTY, zero HTTP)
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 * Components use this instead of calling fetch/EventSource directly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface TerminalBridge {
  create(opts: { projectId: string; sessionId: string; profile?: string }): Promise<{ id: string }>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;
  onData(sessionId: string, callback: (data: string) => void): () => void;
  onExit(sessionId: string, callback: () => void): () => void;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): TerminalBridge {
  // Dynamic import to avoid errors in web mode
  let invoke: any;
  let listen: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      const event = await import("@tauri-apps/api/event");
      invoke = core.invoke;
      listen = event.listen;
    }
  };

  return {
    async create(opts) {
      await init();
      const cwd = `/api/workspaces/${opts.projectId}`;  // resolved by server
      const result = await invoke("terminal_create", {
        cwd: opts.projectId, // The Rust side will resolve the workspace path
        shell: opts.profile || null,
      });
      return { id: result.id };
    },

    write(sessionId, data) {
      init().then(() => invoke("terminal_write", { id: sessionId, data }));
    },

    resize(sessionId, cols, rows) {
      init().then(() => invoke("terminal_resize", { id: sessionId, cols, rows }));
    },

    kill(sessionId) {
      init().then(() => invoke("terminal_kill", { id: sessionId }));
    },

    onData(sessionId, callback) {
      let unlisten: (() => void) | null = null;
      init().then(async () => {
        unlisten = await listen("terminal:data", (event: any) => {
          if (event.payload?.id === sessionId) {
            callback(event.payload.data);
          }
        });
      });
      return () => { unlisten?.(); };
    },

    onExit(sessionId, callback) {
      let unlisten: (() => void) | null = null;
      init().then(async () => {
        unlisten = await listen("terminal:exit", (event: any) => {
          if (event.payload?.id === sessionId) {
            callback();
          }
        });
      });
      return () => { unlisten?.(); };
    },
  };
}

// ── HTTP + SSE bridge (existing web mode) ──

function createWebBridge(): TerminalBridge {
  // Keystroke batching: buffer input and flush after 8ms of silence
  const writeBuffers = new Map<string, { buffer: string; timer: ReturnType<typeof setTimeout> | null }>();

  function flushWrite(sessionId: string) {
    const entry = writeBuffers.get(sessionId);
    if (!entry || !entry.buffer) return;
    const data = entry.buffer;
    entry.buffer = "";
    entry.timer = null;
    fetch("/api/terminal/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, data }),
    }).catch(() => {});
  }

  return {
    async create(opts) {
      const res = await fetch("/api/terminal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: opts.projectId,
          sessionId: opts.sessionId,
          profile: opts.profile,
        }),
      });
      if (!res.ok) throw new Error("Failed to create terminal session");
      return { id: opts.sessionId };
    },

    write(sessionId, data) {
      let entry = writeBuffers.get(sessionId);
      if (!entry) {
        entry = { buffer: "", timer: null };
        writeBuffers.set(sessionId, entry);
      }
      entry.buffer += data;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => flushWrite(sessionId), 8);
    },

    resize(sessionId, cols, rows) {
      fetch("/api/terminal/resize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, cols, rows }),
      }).catch(() => {});
    },

    kill(sessionId) {
      writeBuffers.delete(sessionId);
      // Server handles cleanup on SSE disconnect
    },

    onData(sessionId, callback) {
      const es = new EventSource(`/api/terminal/stream?sessionId=${encodeURIComponent(sessionId)}`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.output) callback(data.output);
          if (data.exit) es.close();
        } catch {}
      };
      return () => es.close();
    },

    onExit(sessionId, callback) {
      const es = new EventSource(`/api/terminal/stream?sessionId=${encodeURIComponent(sessionId)}`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.exit) { callback(); es.close(); }
        } catch {}
      };
      return () => es.close();
    },
  };
}

// ── Export the appropriate bridge ──

export const terminalBridge: TerminalBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
