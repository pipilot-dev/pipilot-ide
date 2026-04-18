/**
 * Electron IPC fetch + EventSource interceptor.
 *
 * In web/dev mode: does nothing — Vite proxy handles /api/*.
 * In Electron mode: ALL fetch("/api/...") and EventSource("/api/...")
 * calls are intercepted and routed through Electron IPC.
 *
 * No HTTP, no ports, no "Server Down" — direct IPC to main process.
 *
 * Imported once in main.tsx before the app renders.
 */

const api = (window as any).electronAPI;
const isElectron = !!api?.isElectron;

if (isElectron) {
  // ── Patch window.fetch ──
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    let url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    // Only intercept /api/* calls
    if (!url.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    const method = init?.method?.toUpperCase() || "GET";

    // Parse body
    let body: any = undefined;
    if (init?.body) {
      try {
        body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      } catch {
        body = init.body;
      }
    }

    // Parse query params from URL
    const urlObj = new URL(url, "http://localhost");
    const query: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => { query[k] = v; });

    try {
      const result = await api.invoke("api:request", {
        method,
        path: urlObj.pathname,
        body,
        query,
      });

      // Handle streaming responses (agent SSE)
      if (result?.__stream) {
        const streamId = result.__streamId;
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          start(controller) {
            const unsub = api.on(`api:stream:${streamId}`, (chunk: any) => {
              if (chunk.__done) {
                controller.close();
                unsub();
              } else {
                const sseData = `data: ${JSON.stringify(chunk)}\n\n`;
                controller.enqueue(encoder.encode(sseData));
              }
            });
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      // Handle binary responses (file downloads, zip)
      if (result?.__binary) {
        const buf = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
        return new Response(buf, {
          status: result.status || 200,
          headers: result.headers || {},
        });
      }

      // Normal JSON response
      return new Response(JSON.stringify(result?.data ?? result), {
        status: result?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  // ── Patch EventSource ──
  // SSE endpoints (terminal, file watcher, agent, dev server logs)
  // are replaced with IPC event listeners
  const OriginalEventSource = window.EventSource;

  class IpcEventSource extends OriginalEventSource {
    private _unsub: (() => void) | null = null;

    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const urlStr = typeof url === "string" ? url : url.href;

      if (!urlStr.startsWith("/api/")) {
        // Non-API EventSource — use original
        super(urlStr, eventSourceInitDict);
        return;
      }

      // Parse the URL
      const urlObj = new URL(urlStr, "http://localhost");
      const query: Record<string, string> = {};
      urlObj.searchParams.forEach((v, k) => { query[k] = v; });

      // Create a dummy EventSource that never connects
      // (we'll dispatch events manually via IPC)
      super("data:text/event-stream,", eventSourceInitDict);

      // Request the stream via IPC
      api.invoke("api:stream-start", {
        path: urlObj.pathname,
        query,
      }).then((streamId: string) => {
        // Listen for stream events
        this._unsub = api.on(`api:stream:${streamId}`, (data: any) => {
          if (data.__done) {
            this.dispatchEvent(new Event("error"));
            return;
          }
          const event = new MessageEvent("message", {
            data: JSON.stringify(data),
          });
          this.dispatchEvent(event);
        });
      }).catch((err: any) => {
        console.error("[ipc-eventsource] Stream start failed:", err);
        this.dispatchEvent(new Event("error"));
      });
    }

    close() {
      if (this._unsub) {
        this._unsub();
        this._unsub = null;
      }
      super.close();
    }
  }

  (window as any).EventSource = IpcEventSource;
}

export {};
