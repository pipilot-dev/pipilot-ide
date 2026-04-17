import { useState, useEffect } from "react";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

/**
 * In Tauri production mode, polls the sidecar health endpoint until it responds.
 * Returns true immediately in web/dev mode (servers are started separately).
 */
export function useSidecarReady(): boolean {
  const [ready, setReady] = useState(!isTauri);

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch("http://localhost:51731/api/health", {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) {
            setReady(true);
            return;
          }
        } catch {
          // Server not ready yet
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    poll();
    return () => { cancelled = true; };
  }, []);

  return ready;
}
