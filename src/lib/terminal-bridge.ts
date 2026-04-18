/**
 * Terminal bridge — abstracts terminal operations via HTTP + SSE.
 * Components use this instead of calling fetch/EventSource directly.
 */

export interface TerminalBridge {
  create(opts: { projectId: string; sessionId: string; profile?: string }): Promise<{ id: string }>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;
  onData(sessionId: string, callback: (data: string) => void): () => void;
  onExit(sessionId: string, callback: () => void): () => void;
}

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

export const terminalBridge: TerminalBridge = {
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

export const isDesktopApp = !!(window as any).electronAPI?.isElectron;
