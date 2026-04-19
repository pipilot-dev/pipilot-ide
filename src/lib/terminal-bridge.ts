/**
 * Terminal bridge — abstracts terminal operations via HTTP + SSE.
 * Components use this instead of calling fetch/EventSource directly.
 */

import { apiPost, apiStream, isElectron } from "@/lib/api";

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
  apiPost("/api/terminal/write", { sessionId, data }).catch(() => {});
}

export const terminalBridge: TerminalBridge = {
  async create(opts) {
    await apiPost("/api/terminal/create", {
      projectId: opts.projectId,
      sessionId: opts.sessionId,
      profile: opts.profile,
    });
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
    apiPost("/api/terminal/resize", { sessionId, cols, rows }).catch(() => {});
  },

  kill(sessionId) {
    writeBuffers.delete(sessionId);
  },

  onData(sessionId, callback) {
    const handle = apiStream(
      "/api/terminal/stream",
      { sessionId },
      {
        onData(data) {
          if (data.output) callback(data.output);
          if (data.exit) handle.close();
        },
      },
    );
    return () => handle.close();
  },

  onExit(sessionId, callback) {
    const handle = apiStream(
      "/api/terminal/stream",
      { sessionId },
      {
        onData(data) {
          if (data.exit) { callback(); handle.close(); }
        },
      },
    );
    return () => handle.close();
  },
};

export const isDesktopApp = isElectron;
