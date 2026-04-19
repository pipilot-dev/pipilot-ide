/**
 * Unified API layer — direct IPC in Electron, HTTP fetch in web mode.
 *
 * All frontend code should use these functions instead of raw fetch/EventSource.
 * In Electron: calls window.electronAPI.invoke() directly — no HTTP, no ports.
 * In web: falls back to regular fetch() for dev server proxy.
 */

const electron = (window as any).electronAPI;
export const isElectron = !!electron?.isElectron;

// ── Request/Response ──

export async function apiGet<T = any>(
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  if (isElectron) {
    const result = await electron.invoke("api:request", { method: "GET", path, query });
    if (result?.status >= 400) throw new Error(result?.data?.error || `API error ${result?.status}`);
    return result?.data;
  }
  const params = query ? "?" + new URLSearchParams(query).toString() : "";
  const res = await fetch(`${path}${params}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function apiPost<T = any>(
  path: string,
  body?: any,
  query?: Record<string, string>,
): Promise<T> {
  if (isElectron) {
    const result = await electron.invoke("api:request", { method: "POST", path, body, query });
    if (result?.status >= 400) throw new Error(result?.data?.error || `API error ${result?.status}`);
    return result?.data;
  }
  const params = query ? "?" + new URLSearchParams(query).toString() : "";
  const res = await fetch(`${path}${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function apiDelete<T = any>(
  path: string,
  query?: Record<string, string>,
  body?: any,
): Promise<T> {
  if (isElectron) {
    const result = await electron.invoke("api:request", { method: "DELETE", path, body, query });
    if (result?.status >= 400) throw new Error(result?.data?.error || `API error ${result?.status}`);
    return result?.data;
  }
  const params = query ? "?" + new URLSearchParams(query).toString() : "";
  const res = await fetch(`${path}${params}`, {
    method: "DELETE",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── Streaming ──

export interface StreamHandle {
  close: () => void;
}

/**
 * Subscribe to a server-sent event stream.
 * In Electron: uses IPC events directly.
 * In web: uses EventSource.
 */
export function apiStream(
  path: string,
  query?: Record<string, string>,
  callbacks?: {
    onData?: (data: any) => void;
    onOpen?: () => void;
    onError?: (err?: any) => void;
  },
): StreamHandle {
  if (isElectron) {
    let unsub: (() => void) | null = null;

    electron.invoke("api:stream-start", { path, query }).then((streamId: string) => {
      callbacks?.onOpen?.();
      unsub = electron.on(`api:stream:${streamId}`, (data: any) => {
        if (data.__done) {
          callbacks?.onError?.();
          return;
        }
        callbacks?.onData?.(data);
      });
    }).catch((err: any) => {
      callbacks?.onError?.(err);
    });

    return {
      close: () => {
        unsub?.();
      },
    };
  }

  // Web mode: use EventSource
  const params = query ? "?" + new URLSearchParams(query).toString() : "";
  const es = new EventSource(`${path}${params}`);
  es.onopen = () => callbacks?.onOpen?.();
  es.onmessage = (e) => {
    try {
      callbacks?.onData?.(JSON.parse(e.data));
    } catch {}
  };
  es.onerror = () => callbacks?.onError?.();

  return { close: () => es.close() };
}

/**
 * POST a streaming request (e.g., agent chat).
 * In Electron: uses IPC stream.
 * In web: uses fetch with ReadableStream.
 */
export function apiPostStream(
  path: string,
  body: any,
  callbacks?: {
    onData?: (data: any) => void;
    onDone?: () => void;
    onError?: (err?: any) => void;
  },
): StreamHandle {
  if (isElectron) {
    let unsub: (() => void) | null = null;

    electron.invoke("api:request", { method: "POST", path, body }).then((result: any) => {
      if (result?.__stream) {
        const streamId = result.__streamId;
        unsub = electron.on(`api:stream:${streamId}`, (data: any) => {
          if (data.__done) {
            callbacks?.onDone?.();
            return;
          }
          callbacks?.onData?.(data);
        });
      } else {
        // Non-streaming response
        callbacks?.onData?.(result?.data);
        callbacks?.onDone?.();
      }
    }).catch((err: any) => {
      callbacks?.onError?.(err);
    });

    return {
      close: () => {
        unsub?.();
      },
    };
  }

  // Web mode: use fetch with SSE parsing
  const controller = new AbortController();
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      callbacks?.onError?.(new Error(`${res.status}`));
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            callbacks?.onData?.(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
    }
    callbacks?.onDone?.();
  }).catch((err) => {
    if (err.name !== "AbortError") callbacks?.onError?.(err);
  });

  return { close: () => controller.abort() };
}
