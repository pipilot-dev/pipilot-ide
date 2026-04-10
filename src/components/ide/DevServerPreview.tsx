import { useState, useCallback, useEffect, useRef } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { Play, Square, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { ConsolePanel, ConsoleEntry } from "./ConsolePanel";

let nextEntryId = 0;

export function DevServerPreview() {
  const { activeProjectId } = useActiveProject();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "installing" | "running" | "stopped" | "error">("idle");
  const [previewUrl, setPreviewUrl] = useState("");
  const [port, setPort] = useState<number | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const sseRef = useRef<EventSource | null>(null);

  // Helper to add console entries
  const addEntry = useCallback((level: ConsoleEntry["level"], source: ConsoleEntry["source"], text: string) => {
    if (!text.trim()) return;
    setConsoleEntries(prev => [...prev, {
      id: nextEntryId++,
      timestamp: Date.now(),
      level, source, text,
    }]);
  }, []);

  // ── SSE: Stream dev server logs in real-time ────────────────────────
  useEffect(() => {
    if (status !== "starting" && status !== "installing" && status !== "running") {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      return;
    }
    if (!activeProjectId) return;

    const es = new EventSource(`/api/dev-server/logs?projectId=${encodeURIComponent(activeProjectId)}`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const level = data.level === "error" ? "error" : data.level === "warn" ? "warn" : data.source === "system" ? "system" : "info";
        addEntry(level, data.source === "system" ? "system" : "server", data.text);
      } catch {}
    };

    es.onerror = () => {
      // SSE reconnects automatically
    };

    return () => { es.close(); sseRef.current = null; };
  }, [status, activeProjectId, addEntry]);

  // ── Listen for iframe console messages ──────────────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "pipilot-console") {
        const { level, args } = e.data;
        const text = (args || []).map((a: any) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
        const consoleLevel = level === "error" ? "error" : level === "warn" ? "warn" : level === "info" ? "info" : "log";
        addEntry(consoleLevel, "runtime", text);
      }
      if (e.data?.type === "pipilot-error") {
        addEntry("error", "runtime", e.data.message || "Unknown error");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [addEntry]);

  // ── Inject console interceptor into iframe on load ──────────────────
  const injectConsoleHook = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;
    try {
      // Inject a script that overrides console methods and forwards to parent
      iframeRef.current.contentWindow.postMessage({ type: "pipilot-inject-console" }, "*");
      // Also try direct injection for same-origin iframes
      const iframeDoc = iframeRef.current.contentDocument;
      if (iframeDoc) {
        const script = iframeDoc.createElement("script");
        script.textContent = `
          (function() {
            if (window.__pipilotConsoleHooked) return;
            window.__pipilotConsoleHooked = true;
            var origConsole = {};
            ['log','info','warn','error','debug'].forEach(function(level) {
              origConsole[level] = console[level];
              console[level] = function() {
                origConsole[level].apply(console, arguments);
                try {
                  var args = Array.from(arguments).map(function(a) {
                    if (typeof a === 'string') return a;
                    try { return JSON.stringify(a); } catch(e) { return String(a); }
                  });
                  window.parent.postMessage({ type: 'pipilot-console', level: level, args: args }, '*');
                } catch(e) {}
              };
            });
            window.addEventListener('error', function(e) {
              window.parent.postMessage({ type: 'pipilot-error', message: e.message + ' at ' + e.filename + ':' + e.lineno }, '*');
            });
            window.addEventListener('unhandledrejection', function(e) {
              window.parent.postMessage({ type: 'pipilot-error', message: 'Unhandled Promise: ' + (e.reason?.message || e.reason || 'unknown') }, '*');
            });
          })();
        `;
        iframeDoc.head?.appendChild(script);
      }
    } catch {
      // Cross-origin — can't directly inject, rely on postMessage
    }
  }, []);

  // Poll status while starting
  useEffect(() => {
    if (status !== "starting" && status !== "installing") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/dev-server/status?projectId=${encodeURIComponent(activeProjectId)}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.running && data.port) {
          setStatus("running");
          setPort(data.port);
          const url = `http://localhost:${data.port}`;
          setPreviewUrl(url);
          if (iframeRef.current) iframeRef.current.src = url;
          clearInterval(pollRef.current!);
        } else if (data.status === "error") {
          setStatus("error");
          addEntry("error", "system", "Dev server failed to start");
          clearInterval(pollRef.current!);
        } else if (data.status === "installing") {
          setStatus("installing");
        } else if (data.status === "starting") {
          setStatus("starting");
        } else if (data.status === "stopped") {
          setStatus("error");
          addEntry("error", "system", "Dev server process exited unexpectedly");
          clearInterval(pollRef.current!);
        }
      } catch {}
    }, 2000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, activeProjectId, addEntry]);

  const handleStart = useCallback(async () => {
    setStatus("installing");
    setConsoleEntries([]);
    setPreviewUrl("");
    setPort(null);
    addEntry("system", "system", "Starting dev server...");

    try {
      const res = await fetch("/api/dev-server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.reused && data.port) {
          // Server was already running — skip straight to running state
          setStatus("running");
          setPort(data.port);
          setPreviewUrl(data.url || `http://localhost:${data.port}`);
          addEntry("system", "system", `Reusing running dev server on port ${data.port}`);
        } else {
          setStatus(data.status === "running" ? "running" : "starting");
        }
      } else {
        setStatus("error");
        addEntry("error", "system", data.message || "Failed to start");
      }
    } catch (err: any) {
      setStatus("error");
      addEntry("error", "system", err.message);
    }
  }, [activeProjectId, addEntry]);

  const handleStop = useCallback(async () => {
    try {
      await fetch("/api/dev-server/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
    } catch {}
    setStatus("stopped");
    setPreviewUrl("");
    setPort(null);
    addEntry("system", "system", "Dev server stopped");
    if (iframeRef.current) iframeRef.current.src = "about:blank";
  }, [activeProjectId, addEntry]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current && previewUrl) {
      iframeRef.current.src = previewUrl;
    }
  }, [previewUrl]);

  // Auto-detect existing server or auto-start a new one on mount.
  // Guard by projectId so strict-mode double-effects don't double-start.
  const autoStartedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProjectId) return;
    if (autoStartedForRef.current === activeProjectId) return;

    fetch(`/api/dev-server/status?projectId=${encodeURIComponent(activeProjectId)}`)
      .then(r => r.json())
      .then(data => {
        if (autoStartedForRef.current === activeProjectId) return;
        autoStartedForRef.current = activeProjectId;

        if (data.running && data.port) {
          // Reuse the cached running dev server — no restart
          setStatus("running");
          setPort(data.port);
          setPreviewUrl(`http://localhost:${data.port}`);
          addEntry("system", "system", `Reusing running dev server on port ${data.port}`);
        } else if (data.status === "installing" || data.status === "starting") {
          // Already starting from a previous mount — reattach polling
          setStatus(data.status);
        } else {
          // No server running — auto-start it
          handleStart();
        }
      })
      .catch(() => {});
  }, [activeProjectId, handleStart, addEntry]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "hsl(220 13% 14%)" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        borderBottom: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 18%)",
        height: 32, minHeight: 32,
      }}>
        {status === "running" ? (
          <>
            <button onClick={handleRefresh} title="Refresh"
              style={{ background: "none", border: "none", color: "hsl(220 14% 60%)", cursor: "pointer", padding: 4 }}>
              <RefreshCw size={13} />
            </button>
            <div style={{
              flex: 1, padding: "2px 10px", fontSize: 11, borderRadius: 4,
              background: "hsl(220 13% 14%)", color: "hsl(220 14% 60%)",
              border: "1px solid hsl(220 13% 22%)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(142 71% 45%)", flexShrink: 0 }} />
              localhost:{port}
            </div>
            <button onClick={() => window.open(previewUrl, "_blank")} title="Open in browser"
              style={{ background: "none", border: "none", color: "hsl(220 14% 60%)", cursor: "pointer", padding: 4 }}>
              <ExternalLink size={13} />
            </button>
            <button onClick={handleStop} title="Stop server"
              style={{ background: "none", border: "none", color: "hsl(0 84% 60%)", cursor: "pointer", padding: 4 }}>
              <Square size={13} />
            </button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 11, color: "hsl(220 14% 55%)", display: "flex", alignItems: "center", gap: 6 }}>
              {status === "starting" || status === "installing" ? (
                <>
                  <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                  {status === "installing" ? "Installing dependencies..." : "Starting dev server..."}
                </>
              ) : (
                "Dev Server Preview"
              )}
            </span>
            {status !== "starting" && status !== "installing" && (
              <button onClick={handleStart} title="Start dev server"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 12px", fontSize: 10, fontWeight: 600,
                  background: "hsl(142 71% 45%)", color: "#fff",
                  border: "none", borderRadius: 4, cursor: "pointer",
                }}>
                <Play size={11} /> Start
              </button>
            )}
          </>
        )}
      </div>

      {/* Content area */}
      {status === "idle" || status === "stopped" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
            <Play size={40} style={{ color: "hsl(142 71% 45% / 0.3)" }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(220 14% 65%)" }}>Dev Server Preview</div>
            <div style={{ fontSize: 11, color: "hsl(220 14% 45%)", textAlign: "center", maxWidth: 260, lineHeight: 1.6 }}>
              Runs your project's dev server locally. Click Start to launch.
            </div>
            <button onClick={handleStart} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 20px", fontSize: 12, fontWeight: 600,
              background: "hsl(142 71% 45%)", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer", marginTop: 8,
            }}>
              <Play size={14} /> Start Dev Server
            </button>
          </div>
          {consoleEntries.length > 0 && (
            <ConsolePanel entries={consoleEntries} onClear={() => setConsoleEntries([])} />
          )}
        </div>
      ) : status === "error" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "hsl(0 84% 60%)" }}>Failed to start dev server</div>
            <div style={{ fontSize: 10, color: "hsl(220 14% 45%)", maxWidth: 300, textAlign: "center" }}>
              Check the console below for details
            </div>
            <button onClick={handleStart} style={{
              marginTop: 8, padding: "6px 16px", fontSize: 11,
              background: "hsl(142 71% 45%)", color: "#fff",
              border: "none", borderRadius: 4, cursor: "pointer",
            }}>Retry</button>
          </div>
          <ConsolePanel entries={consoleEntries} onClear={() => setConsoleEntries([])} defaultOpen />
        </div>
      ) : (
        /* Starting / Running state */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Preview iframe */}
          <iframe
            ref={iframeRef}
            onLoad={injectConsoleHook}
            style={{
              flex: 1, border: "none", width: "100%",
              display: status === "running" ? "block" : "none",
              background: "#fff",
              minHeight: 0,
            }}
            title="Dev Server Preview"
            src={previewUrl || "about:blank"}
          />
          {status !== "running" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: "hsl(207 90% 60%)" }} />
            </div>
          )}
          {/* Console always visible at bottom during starting/running */}
          <ConsolePanel
            entries={consoleEntries}
            onClear={() => setConsoleEntries([])}
            defaultOpen={status === "installing" || status === "starting"}
          />
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
