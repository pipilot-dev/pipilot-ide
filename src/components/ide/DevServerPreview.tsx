import { useState, useCallback, useEffect, useRef } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { Play, Square, RefreshCw, ExternalLink, Loader2, Terminal } from "lucide-react";

export function DevServerPreview() {
  const { activeProjectId } = useActiveProject();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "installing" | "running" | "stopped" | "error">("idle");
  const [previewUrl, setPreviewUrl] = useState("");
  const [port, setPort] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

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

        setLogs(data.logs || []);

        setLogs(data.logs || []);

        if (data.running && data.port) {
          setStatus("running");
          setPort(data.port);
          const url = `http://localhost:${data.port}`;
          setPreviewUrl(url);
          if (iframeRef.current) iframeRef.current.src = url;
          clearInterval(pollRef.current!);
        } else if (data.status === "error") {
          setStatus("error");
          clearInterval(pollRef.current!);
        } else if (data.status === "installing") {
          setStatus("installing");
        } else if (data.status === "starting") {
          setStatus("starting");
        } else if (data.status === "stopped") {
          // Process died — stop polling
          setStatus("error");
          setLogs(prev => [...prev, "Dev server process exited unexpectedly"]);
          clearInterval(pollRef.current!);
        }
      } catch {}
    }, 2000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, activeProjectId]);

  const handleStart = useCallback(async () => {
    setStatus("installing");
    setLogs([]);
    setPreviewUrl("");
    setPort(null);

    try {
      const res = await fetch("/api/dev-server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      const data = await res.json();

      if (data.success) {
        setStatus("starting");
      } else {
        setStatus("error");
        setLogs([data.message || "Failed to start"]);
      }
    } catch (err: any) {
      setStatus("error");
      setLogs([err.message]);
    }
  }, [activeProjectId]);

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
    if (iframeRef.current) iframeRef.current.src = "about:blank";
  }, [activeProjectId]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current && previewUrl) {
      iframeRef.current.src = previewUrl;
    }
  }, [previewUrl]);

  // Auto-start on mount if not running
  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`/api/dev-server/status?projectId=${encodeURIComponent(activeProjectId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.running && data.port) {
          setStatus("running");
          setPort(data.port);
          setPreviewUrl(`http://localhost:${data.port}`);
        }
      })
      .catch(() => {});
  }, [activeProjectId]);

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
            <button onClick={() => setShowLogs(!showLogs)} title="Toggle logs"
              style={{ background: "none", border: "none", color: showLogs ? "hsl(207 90% 60%)" : "hsl(220 14% 45%)", cursor: "pointer", padding: 4 }}>
              <Terminal size={13} />
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

      {/* Logs panel */}
      {showLogs && (
        <div style={{
          height: 120, overflowY: "auto", padding: "4px 8px",
          background: "hsl(220 13% 10%)", borderBottom: "1px solid hsl(220 13% 22%)",
          fontFamily: "monospace", fontSize: 10, color: "hsl(220 14% 55%)",
          whiteSpace: "pre-wrap",
        }}>
          {logs.length === 0 ? "No logs yet" : logs.join("")}
        </div>
      )}

      {/* Content */}
      {status === "idle" || status === "stopped" ? (
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
      ) : status === "error" ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "hsl(0 84% 60%)" }}>Failed to start dev server</div>
          <div style={{ fontSize: 10, color: "hsl(220 14% 45%)", maxWidth: 300, textAlign: "center" }}>
            {logs[logs.length - 1] || "Unknown error"}
          </div>
          <button onClick={handleStart} style={{
            marginTop: 8, padding: "6px 16px", fontSize: 11,
            background: "hsl(142 71% 45%)", color: "#fff",
            border: "none", borderRadius: 4, cursor: "pointer",
          }}>Retry</button>
        </div>
      ) : null}

      {/* Preview iframe */}
      <iframe
        ref={iframeRef}
        style={{
          flex: 1, border: "none", width: "100%",
          display: status === "running" && !showLogs ? "block" : status === "running" && showLogs ? "block" : "none",
          background: "#fff",
        }}
        title="Dev Server Preview"
        src={previewUrl || "about:blank"}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
