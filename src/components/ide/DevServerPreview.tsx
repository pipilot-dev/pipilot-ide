import { useState, useCallback, useEffect, useRef } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";
import {
  Play, Square, RefreshCw, ExternalLink, Loader2,
  ArrowLeft, ArrowRight, Maximize2, Minimize2,
  Monitor, Tablet, Smartphone, Terminal as TerminalIcon,
} from "lucide-react";
import { ConsolePanel, ConsoleEntry } from "./ConsolePanel";
import { COLORS as C, FONTS } from "@/lib/design-tokens";

let nextEntryId = 0;

/* ── Responsive presets ──────────────────────────────────────────────── */
type ResponsiveMode = "desktop" | "tablet" | "mobile";
const RESPONSIVE_PRESETS: Record<ResponsiveMode, { label: string; width: string | number; icon: typeof Monitor }> = {
  desktop: { label: "Desktop", width: "100%", icon: Monitor },
  tablet:  { label: "Tablet",  width: 768,    icon: Tablet },
  mobile:  { label: "Mobile",  width: 375,    icon: Smartphone },
};

/* ── Shared button style ─────────────────────────────────────────────── */
const navBtn = (disabled = false): React.CSSProperties => ({
  background: "none",
  border: "none",
  color: disabled ? C.textFaint : C.textMid,
  cursor: disabled ? "default" : "pointer",
  padding: 4,
  borderRadius: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: disabled ? 0.4 : 1,
  transition: "color 0.15s, opacity 0.15s",
});

export function DevServerPreview() {
  const { activeProjectId } = useActiveProject();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "installing" | "running" | "stopped" | "error">("idle");
  const [previewUrl, setPreviewUrl] = useState("");
  const [port, setPort] = useState<number | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const sseRef = useRef<EventSource | null>(null);

  /* ── Navigation history ───────────────────────────────────────────── */
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [urlInput, setUrlInput] = useState("");
  const canGoBack = historyIdx > 0;
  const canGoForward = historyIdx < history.length - 1;

  /* ── UI state ─────────────────────────────────────────────────────── */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [responsiveMode, setResponsiveMode] = useState<ResponsiveMode>("desktop");
  const [showConsole, setShowConsole] = useState(false);

  const pushHistory = useCallback((url: string) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIdx + 1);
      return [...trimmed, url];
    });
    setHistoryIdx(prev => prev + 1);
    setUrlInput(url);
  }, [historyIdx]);

  /* ── Console entry helper ─────────────────────────────────────────── */
  const addEntry = useCallback((level: ConsoleEntry["level"], source: ConsoleEntry["source"], text: string) => {
    if (!text.trim()) return;
    setConsoleEntries(prev => [...prev, {
      id: nextEntryId++,
      timestamp: Date.now(),
      level, source, text,
    }]);
  }, []);

  /* ── SSE: Stream dev server logs in real-time ─────────────────────── */
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

    es.onerror = () => {};

    return () => { es.close(); sseRef.current = null; };
  }, [status, activeProjectId, addEntry]);

  /* ── Listen for iframe console messages ───────────────────────────── */
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

  /* ── Inject console interceptor into iframe on load ────────────────── */
  const injectConsoleHook = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage({ type: "pipilot-inject-console" }, "*");
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
      // Cross-origin — rely on postMessage
    }
  }, []);

  /* ── Poll status while starting ────────────────────────────────────── */
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
          pushHistory(url);
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
  }, [status, activeProjectId, addEntry, pushHistory]);

  /* ── Start / Stop / Refresh handlers ───────────────────────────────── */
  const handleStart = useCallback(async () => {
    setStatus("installing");
    setConsoleEntries([]);
    setPreviewUrl("");
    setPort(null);
    setHistory([]);
    setHistoryIdx(-1);
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
          setStatus("running");
          setPort(data.port);
          const url = data.url || `http://localhost:${data.port}`;
          setPreviewUrl(url);
          pushHistory(url);
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
  }, [activeProjectId, addEntry, pushHistory]);

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

  /* ── Navigation handlers ───────────────────────────────────────────── */
  const handleGoBack = useCallback(() => {
    if (!canGoBack) return;
    const newIdx = historyIdx - 1;
    setHistoryIdx(newIdx);
    const url = history[newIdx];
    setPreviewUrl(url);
    setUrlInput(url);
    if (iframeRef.current) iframeRef.current.src = url;
  }, [canGoBack, historyIdx, history]);

  const handleGoForward = useCallback(() => {
    if (!canGoForward) return;
    const newIdx = historyIdx + 1;
    setHistoryIdx(newIdx);
    const url = history[newIdx];
    setPreviewUrl(url);
    setUrlInput(url);
    if (iframeRef.current) iframeRef.current.src = url;
  }, [canGoForward, historyIdx, history]);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) url = `http://${url}`;
    setPreviewUrl(url);
    pushHistory(url);
    if (iframeRef.current) iframeRef.current.src = url;
  }, [urlInput, pushHistory]);

  const handleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  /* ── Auto-detect / auto-start on mount ─────────────────────────────── */
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
          setStatus("running");
          setPort(data.port);
          const url = `http://localhost:${data.port}`;
          setPreviewUrl(url);
          pushHistory(url);
          addEntry("system", "system", `Reusing running dev server on port ${data.port}`);
        } else if (data.status === "installing" || data.status === "starting") {
          setStatus(data.status);
        } else {
          handleStart();
        }
      })
      .catch(() => {});
  }, [activeProjectId, handleStart, addEntry, pushHistory]);

  /* ── Iframe loading state ──────────────────────────────────────────── */
  const [iframeLoading, setIframeLoading] = useState(false);
  const handleIframeLoad = useCallback(() => {
    setIframeLoading(false);
    injectConsoleHook();
  }, [injectConsoleHook]);

  // Set loading when src changes
  useEffect(() => {
    if (previewUrl && status === "running") setIframeLoading(true);
  }, [previewUrl, status]);

  const errorCount = consoleEntries.filter(e => e.level === "error").length;
  const warnCount = consoleEntries.filter(e => e.level === "warn").length;

  const isRunning = status === "running";
  const isStarting = status === "starting" || status === "installing";

  /* ── Responsive width ──────────────────────────────────────────────── */
  const preset = RESPONSIVE_PRESETS[responsiveMode];
  const iframeWidth = preset.width;
  const showResponsiveFrame = responsiveMode !== "desktop" && isRunning;

  /* ── Fullscreen wrapper ────────────────────────────────────────────── */
  const containerStyle: React.CSSProperties = isFullscreen
    ? { position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: C.bg }
    : { height: "100%", display: "flex", flexDirection: "column", background: C.bg };

  return (
    <div style={containerStyle}>
      {/* ── Navigation bar ─────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "3px 6px",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        height: 34, minHeight: 34,
        fontFamily: FONTS.sans,
      }}>
        {/* Back */}
        <button
          onClick={handleGoBack}
          disabled={!canGoBack}
          title="Back"
          style={navBtn(!canGoBack)}
        >
          <ArrowLeft size={14} />
        </button>

        {/* Forward */}
        <button
          onClick={handleGoForward}
          disabled={!canGoForward}
          title="Forward"
          style={navBtn(!canGoForward)}
        >
          <ArrowRight size={14} />
        </button>

        {/* Reload */}
        <button
          onClick={handleRefresh}
          disabled={!isRunning}
          title="Reload"
          style={navBtn(!isRunning)}
        >
          <RefreshCw size={13} />
        </button>

        {/* URL bar */}
        {isRunning ? (
          <form onSubmit={handleUrlSubmit} style={{ flex: 1, display: "flex" }}>
            <div style={{
              flex: 1, display: "flex", alignItems: "center", gap: 6,
              padding: "0 10px", height: 24, borderRadius: 6,
              background: C.surfaceAlt,
              border: `1px solid ${C.border}`,
              transition: "border-color 0.15s",
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: C.ok, flexShrink: 0,
              }} />
              <input
                type="text"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onFocus={e => e.target.select()}
                style={{
                  flex: 1, background: "none", border: "none", outline: "none",
                  color: C.text, fontSize: 11,
                  fontFamily: FONTS.mono,
                  padding: 0,
                }}
                spellCheck={false}
              />
              {iframeLoading && (
                <Loader2 size={11} style={{ color: C.accent, animation: "spin 1s linear infinite", flexShrink: 0 }} />
              )}
            </div>
          </form>
        ) : (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 6,
            padding: "0 10px", height: 24, borderRadius: 6,
            background: C.surfaceAlt,
            border: `1px solid ${C.border}`,
          }}>
            {isStarting ? (
              <>
                <Loader2 size={11} style={{ color: C.accent, animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: 11, color: C.textDim, fontFamily: FONTS.mono }}>
                  {status === "installing" ? "Installing dependencies..." : "Starting dev server..."}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11, color: C.textDim, fontFamily: FONTS.mono }}>
                No server running
              </span>
            )}
          </div>
        )}

        {/* Console toggle */}
        <button
          onClick={() => setShowConsole(prev => !prev)}
          title="Toggle console"
          style={{
            ...navBtn(false),
            color: showConsole ? C.accent : (errorCount > 0 ? C.error : warnCount > 0 ? C.warn : C.textMid),
            position: "relative",
          }}
        >
          <TerminalIcon size={13} />
          {errorCount > 0 && (
            <span style={{
              position: "absolute", top: 0, right: 0,
              width: 6, height: 6, borderRadius: "50%",
              background: C.error, border: `1px solid ${C.surface}`,
            }} />
          )}
        </button>

        {/* Open in new tab */}
        <button
          onClick={() => previewUrl && window.open(previewUrl, "_blank")}
          disabled={!isRunning}
          title="Open in new tab"
          style={navBtn(!isRunning)}
        >
          <ExternalLink size={13} />
        </button>

        {/* Fullscreen */}
        <button
          onClick={handleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          style={navBtn(false)}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: C.border, margin: "0 2px" }} />

        {/* Server control */}
        {isRunning ? (
          <button onClick={handleStop} title="Stop server" style={{ ...navBtn(false), color: C.error }}>
            <Square size={13} />
          </button>
        ) : !isStarting ? (
          <button
            onClick={handleStart}
            title="Start dev server"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 10px", fontSize: 10, fontWeight: 600,
              background: C.ok, color: "#fff",
              border: "none", borderRadius: 4, cursor: "pointer",
              fontFamily: FONTS.sans,
            }}
          >
            <Play size={11} /> Start
          </button>
        ) : null}
      </div>

      {/* ── Responsive toolbar ─────────────────────────────────────── */}
      {isRunning && (
        <div style={{
          display: "flex", alignItems: "center", gap: 2,
          padding: "2px 8px",
          borderBottom: `1px solid ${C.border}`,
          background: C.surface,
          height: 26, minHeight: 26,
        }}>
          {(Object.entries(RESPONSIVE_PRESETS) as [ResponsiveMode, typeof RESPONSIVE_PRESETS["desktop"]][]).map(([mode, info]) => {
            const Icon = info.icon;
            const active = responsiveMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setResponsiveMode(mode)}
                title={`${info.label}${typeof info.width === "number" ? ` (${info.width}px)` : ""}`}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", fontSize: 10, borderRadius: 4,
                  border: "none", cursor: "pointer",
                  background: active ? C.surfaceAlt : "transparent",
                  color: active ? C.text : C.textDim,
                  fontWeight: active ? 600 : 400,
                  fontFamily: FONTS.sans,
                  transition: "all 0.15s",
                }}
              >
                <Icon size={11} />
                {info.label}
                {typeof info.width === "number" && (
                  <span style={{ fontSize: 9, color: C.textFaint, fontFamily: FONTS.mono }}>{info.width}px</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Content area ───────────────────────────────────────────── */}
      {status === "idle" || status === "stopped" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 12,
          }}>
            <Play size={40} style={{ color: `${C.ok}40` }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: FONTS.sans }}>
              Dev Server Preview
            </div>
            <div style={{
              fontSize: 11, color: C.textDim, textAlign: "center",
              maxWidth: 260, lineHeight: 1.6, fontFamily: FONTS.sans,
            }}>
              Runs your project's dev server locally. Click Start to launch.
            </div>
            <button onClick={handleStart} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 20px", fontSize: 12, fontWeight: 600,
              background: C.ok, color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer", marginTop: 8,
              fontFamily: FONTS.sans,
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
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontSize: 12, color: C.error, fontFamily: FONTS.sans }}>
              Failed to start dev server
            </div>
            <div style={{ fontSize: 10, color: C.textDim, maxWidth: 300, textAlign: "center", fontFamily: FONTS.sans }}>
              Check the console below for details
            </div>
            <button onClick={handleStart} style={{
              marginTop: 8, padding: "6px 16px", fontSize: 11,
              background: C.ok, color: "#fff",
              border: "none", borderRadius: 4, cursor: "pointer",
              fontFamily: FONTS.sans,
            }}>Retry</button>
          </div>
          <ConsolePanel entries={consoleEntries} onClear={() => setConsoleEntries([])} defaultOpen />
        </div>
      ) : (
        /* Starting / Running state */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Preview iframe area */}
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            minHeight: 0, overflow: "hidden",
            background: showResponsiveFrame ? C.surfaceAlt : "transparent",
          }}>
            {isRunning ? (
              <div style={{
                width: typeof iframeWidth === "number" ? iframeWidth : "100%",
                height: "100%",
                position: "relative",
                transition: "width 0.2s ease",
                ...(showResponsiveFrame ? {
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  overflow: "hidden",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
                } : {}),
              }}>
                {iframeLoading && (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 2,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: `${C.bg}cc`,
                  }}>
                    <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: C.accent }} />
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  onLoad={handleIframeLoad}
                  style={{
                    width: "100%", height: "100%", border: "none",
                    background: "#fff",
                  }}
                  title="Dev Server Preview"
                  src={previewUrl || "about:blank"}
                />
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
                <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: C.info }} />
              </div>
            )}
          </div>

          {/* Console panel */}
          {showConsole && (
            <ConsolePanel
              entries={consoleEntries}
              onClear={() => setConsoleEntries([])}
              defaultOpen
            />
          )}
          {!showConsole && isStarting && (
            <ConsolePanel
              entries={consoleEntries}
              onClear={() => setConsoleEntries([])}
              defaultOpen
            />
          )}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
