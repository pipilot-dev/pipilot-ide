/**
 * Desktop fetch + EventSource interceptor for Electron production mode.
 *
 * In web/dev mode (served by Vite): does nothing — Vite proxy handles /api/*.
 * In Electron production (loaded from file://): rewrites relative /api/* URLs
 * to absolute http://localhost:PORT so they reach the Express servers.
 *
 * Imported once in main.tsx before the app renders.
 */

const isElectron = typeof window !== "undefined" && !!(window as any).electronAPI?.isElectron;
const isFileProtocol = typeof window !== "undefined" && window.location.protocol === "file:";
const needsRewrite = isElectron && isFileProtocol;

if (needsRewrite) {
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

    if (!url.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    const base = url.startsWith("/api/cloud") ? CLOUD_BASE : AGENT_BASE;
    const absoluteUrl = `${base}${url}`;

    if (input instanceof Request) {
      return originalFetch(new Request(absoluteUrl, input), init);
    }

    return originalFetch(absoluteUrl, init);
  };

  // ── Patch EventSource ──
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

  (window as any).EventSource = PatchedEventSource;
}

export {};
