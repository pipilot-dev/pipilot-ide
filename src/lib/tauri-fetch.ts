/**
 * Tauri fetch + EventSource interceptor.
 *
 * In web mode (served by Vite dev server): does nothing — Vite proxy handles /api/*.
 * In Tauri production mode (loaded from dist/): rewrites relative /api/* URLs
 * to absolute http://localhost:PORT so they reach the sidecar Express servers.
 *
 * Imported once in main.tsx before the app renders.
 */

const isTauri =
  typeof window !== "undefined" &&
  !!(window as any).__TAURI_INTERNALS__;

if (isTauri) {
  const AGENT_BASE = "http://localhost:51731";
  const CLOUD_BASE = "http://localhost:51732";

  // ── Patch window.fetch ──
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    // Only intercept relative /api/* calls
    if (!url.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    // Route /api/cloud/* to the cloud server, everything else to agent server
    const base = url.startsWith("/api/cloud") ? CLOUD_BASE : AGENT_BASE;
    const absoluteUrl = `${base}${url}`;

    // If input was a Request, clone it with the new URL
    if (input instanceof Request) {
      return originalFetch(new Request(absoluteUrl, input), init);
    }

    return originalFetch(absoluteUrl, init);
  };

  // ─�� Patch EventSource ──
  // SSE endpoints (terminal, file watcher, agent streaming, dev server logs)
  // use `new EventSource("/api/...")` which fails in Tauri because the base
  // URL is tauri://localhost, not http://localhost:PORT.
  const OriginalEventSource = window.EventSource;

  class PatchedEventSource extends OriginalEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      let urlStr = typeof url === "string" ? url : url.href;

      if (urlStr.startsWith("/api/")) {
        const base = urlStr.startsWith("/api/cloud") ? CLOUD_BASE : AGENT_BASE;
        urlStr = `${base}${urlStr}`;
      }

      super(urlStr, eventSourceInitDict);
    }
  }

  // Replace global EventSource
  (window as any).EventSource = PatchedEventSource;
}

export {};
