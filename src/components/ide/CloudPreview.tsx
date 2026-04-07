import { useState, useRef, useCallback, useEffect } from "react";
import { FileNode } from "@/hooks/useFileSystem";
import { useActiveProject } from "@/contexts/ProjectContext";
import { createCloudPreview, stopCloudPreview, getCachedSession } from "@/lib/cloud-preview";
import { RefreshCw, ExternalLink, Play, Square, Cloud, Loader2 } from "lucide-react";

interface CloudPreviewProps {
  files: FileNode[];
}

export function CloudPreview({ files }: CloudPreviewProps) {
  const { activeProjectId } = useActiveProject();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"idle" | "building" | "ready" | "error">("idle");
  const [previewUrl, setPreviewUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [framework, setFramework] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [progressMsg, setProgressMsg] = useState("");

  // Check for cached session on mount
  useEffect(() => {
    const cached = getCachedSession(activeProjectId);
    if (cached) {
      setPreviewUrl(cached.previewUrl);
      setSessionId(cached.sessionId);
      setStatus("ready");
    }
  }, [activeProjectId]);

  const startPreview = useCallback(async (force?: boolean) => {
    setStatus("building");
    setErrorMsg("");
    setProgressMsg("Creating sandbox...");

    const result = await createCloudPreview(
      activeProjectId,
      { force },
      (msg) => setProgressMsg(msg)
    );

    if (result.success) {
      setPreviewUrl(result.previewUrl);
      setSessionId(result.sessionId);
      setFramework(result.framework || "");
      setStatus("ready");
      if (iframeRef.current) {
        iframeRef.current.src = result.previewUrl;
      }
    } else {
      setStatus("error");
      setErrorMsg(result.error || "Unknown error");
    }
  }, [activeProjectId]);

  const handleStop = useCallback(async () => {
    if (sessionId) {
      await stopCloudPreview(sessionId);
    }
    setStatus("idle");
    setPreviewUrl("");
    setSessionId("");
    if (iframeRef.current) {
      iframeRef.current.src = "about:blank";
    }
  }, [sessionId]);

  const handleRefresh = useCallback(() => {
    if (previewUrl && iframeRef.current) {
      iframeRef.current.src = previewUrl;
    }
  }, [previewUrl]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "hsl(220 13% 14%)" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        borderBottom: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 18%)",
        height: 32, minHeight: 32,
      }}>
        {status === "ready" ? (
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
              <Cloud size={10} style={{ color: "hsl(280 65% 60%)", flexShrink: 0 }} />
              {previewUrl}
            </div>
            <button onClick={() => window.open(previewUrl, "_blank")} title="Open in new tab"
              style={{ background: "none", border: "none", color: "hsl(220 14% 60%)", cursor: "pointer", padding: 4 }}>
              <ExternalLink size={13} />
            </button>
            {/* Update button — re-syncs files to existing sandbox */}
            <button onClick={() => startPreview(false)} title="Sync files to sandbox"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "2px 8px", fontSize: 10, fontWeight: 500,
                background: "hsl(207 90% 54% / 0.15)", color: "hsl(207 90% 60%)",
                border: "1px solid hsl(207 90% 54% / 0.3)", borderRadius: 4, cursor: "pointer",
              }}>
              <RefreshCw size={10} /> Sync
            </button>
            <button onClick={handleStop} title="Stop sandbox"
              style={{ background: "none", border: "none", color: "hsl(0 84% 60%)", cursor: "pointer", padding: 4 }}>
              <Square size={13} />
            </button>
          </>
        ) : (
          <>
            <Cloud size={13} style={{ color: "hsl(280 65% 60%)" }} />
            <span style={{ flex: 1, fontSize: 11, color: "hsl(220 14% 55%)" }}>
              {status === "building" ? "Building sandbox..." : "Cloud Preview (E2B)"}
              {framework && ` • ${framework}`}
            </span>
            {status !== "building" && (
              <button onClick={() => startPreview(true)} title="Start preview"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 12px", fontSize: 10, fontWeight: 600,
                  background: "hsl(280 65% 55%)", color: "#fff",
                  border: "none", borderRadius: 4, cursor: "pointer",
                }}>
                <Play size={11} /> Start Cloud Preview
              </button>
            )}
          </>
        )}
      </div>

      {/* Content */}
      {status === "idle" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <Cloud size={40} style={{ color: "hsl(280 65% 55% / 0.4)" }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(220 14% 65%)" }}>Cloud Preview</div>
          <div style={{ fontSize: 11, color: "hsl(220 14% 45%)", textAlign: "center", maxWidth: 260, lineHeight: 1.6 }}>
            Full Node.js sandbox with npm, Vite HMR, Next.js SSR, and more. Powered by E2B.
          </div>
          <button onClick={() => startPreview(true)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 20px", fontSize: 12, fontWeight: 600,
            background: "hsl(280 65% 55%)", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer",
            marginTop: 8,
          }}>
            <Play size={14} /> Start Preview
          </button>
        </div>
      )}

      {status === "building" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <Loader2 size={28} style={{ color: "hsl(280 65% 55%)", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: 12, color: "hsl(220 14% 55%)" }}>{progressMsg || "Creating E2B sandbox..."}</div>
          <div style={{ fontSize: 10, color: "hsl(220 14% 40%)" }}>This may take 30-60 seconds on first build</div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {status === "error" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "hsl(0 84% 60%)" }}>Failed to start preview</div>
          <div style={{ fontSize: 11, color: "hsl(220 14% 45%)", maxWidth: 300, textAlign: "center" }}>{errorMsg}</div>
          <button onClick={() => startPreview(true)} style={{
            marginTop: 8, padding: "6px 16px", fontSize: 11,
            background: "hsl(280 65% 55%)", color: "#fff",
            border: "none", borderRadius: 4, cursor: "pointer",
          }}>Retry</button>
        </div>
      )}

      {/* Preview iframe */}
      <iframe
        ref={iframeRef}
        style={{
          flex: 1, border: "none", width: "100%",
          display: status === "ready" ? "block" : "none",
          background: "#fff",
        }}
        title="Cloud Preview"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
