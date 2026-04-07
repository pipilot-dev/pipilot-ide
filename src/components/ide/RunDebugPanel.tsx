import { useState } from "react";
import { Play, Trash2, Bug, Monitor, RefreshCw } from "lucide-react";
import { useProblems } from "@/contexts/ProblemsContext";

interface RunDebugPanelProps {
  onRunPreview?: () => void;
}

export function RunDebugPanel({ onRunPreview }: RunDebugPanelProps) {
  const { problems, clearProblems } = useProblems();
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    clearProblems("preview");
    onRunPreview?.();
    setTimeout(() => setRunning(false), 1000);
  };

  const consoleItems = problems.filter((p) => p.source === "preview" || p.source === "terminal");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "hsl(220 14% 75%)" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid hsl(220 13% 25%)" }}>
        <Bug size={14} style={{ color: "hsl(207 90% 60%)" }} />
        <span style={{ fontWeight: 600, fontSize: 12 }}>Run and Debug</span>
      </div>

      {/* Controls */}
      <div style={{ padding: "10px 12px", display: "flex", gap: 6, borderBottom: "1px solid hsl(220 13% 25%)" }}>
        <button
          onClick={handleRun}
          disabled={running}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", fontSize: 11, fontWeight: 600,
            background: running ? "hsl(142 71% 35%)" : "hsl(142 71% 45%)",
            color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
          {running ? "Running..." : "Run Preview"}
        </button>
        <button
          onClick={() => clearProblems()}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "6px 10px", fontSize: 11,
            background: "hsl(220 13% 22%)", color: "hsl(220 14% 65%)",
            border: "1px solid hsl(220 13% 28%)", borderRadius: 4, cursor: "pointer",
          }}
        >
          <Trash2 size={11} /> Clear
        </button>
      </div>

      {/* Console Output */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{
          padding: "6px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase",
          color: "hsl(220 14% 45%)", letterSpacing: "0.5px",
          borderBottom: "1px solid hsl(220 13% 22%)",
        }}>
          Console ({consoleItems.length})
        </div>

        {consoleItems.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "hsl(220 14% 40%)", fontSize: 11 }}>
            <Monitor size={24} style={{ margin: "0 auto 8px", opacity: 0.5, display: "block" }} />
            No console output yet.<br />Click "Run Preview" to start.
          </div>
        ) : (
          consoleItems.map((item) => (
            <div key={item.id} style={{
              padding: "4px 12px", fontSize: 11, fontFamily: "monospace",
              borderBottom: "1px solid hsl(220 13% 20%)",
              color: item.type === "error" ? "hsl(0 84% 60%)"
                : item.type === "warning" ? "hsl(38 92% 50%)"
                : "hsl(220 14% 65%)",
            }}>
              <span style={{ color: "hsl(220 14% 35%)", fontSize: 10, marginRight: 6 }}>
                {item.timestamp.toLocaleTimeString()}
              </span>
              {item.file && (
                <span style={{ color: "hsl(207 90% 60%)", marginRight: 6 }}>
                  {item.file}{item.line ? `:${item.line}` : ""}
                </span>
              )}
              {item.message}
            </div>
          ))
        )}
      </div>

      {/* Variables */}
      <div style={{ borderTop: "1px solid hsl(220 13% 25%)" }}>
        <div style={{
          padding: "6px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase",
          color: "hsl(220 14% 45%)", letterSpacing: "0.5px",
        }}>
          Environment
        </div>
        <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "hsl(220 14% 55%)" }}>
          <div>Viewport: {typeof window !== "undefined" ? `${window.innerWidth}\u00d7${window.innerHeight}` : "\u2014"}</div>
          <div>Platform: {typeof navigator !== "undefined" ? navigator.platform : "\u2014"}</div>
          <div>Runtime: Browser (Sandpack)</div>
        </div>
      </div>
    </div>
  );
}
