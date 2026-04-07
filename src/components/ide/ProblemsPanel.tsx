import { AlertCircle, AlertTriangle, Info, Trash2, X } from "lucide-react";
import { useProblems } from "@/contexts/ProblemsContext";

interface ProblemsPanelProps {
  onClose: () => void;
  onNavigateToFile?: (file: string, line?: number) => void;
}

export function ProblemsPanel({ onClose, onNavigateToFile }: ProblemsPanelProps) {
  const { problems, clearProblems, errorCount, warningCount } = useProblems();

  const typeIcon = (type: string) => {
    switch (type) {
      case "error": return <AlertCircle size={12} style={{ color: "hsl(0 84% 60%)", flexShrink: 0 }} />;
      case "warning": return <AlertTriangle size={12} style={{ color: "hsl(38 92% 50%)", flexShrink: 0 }} />;
      default: return <Info size={12} style={{ color: "hsl(207 90% 60%)", flexShrink: 0 }} />;
    }
  };

  return (
    <div style={{
      height: 200, borderTop: "1px solid hsl(220 13% 25%)",
      background: "hsl(220 13% 16%)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 12px", borderBottom: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 18%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11 }}>
          <span style={{ fontWeight: 600, color: "hsl(220 14% 75%)" }}>Problems</span>
          {errorCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, color: "hsl(0 84% 60%)" }}>
              <AlertCircle size={11} /> {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, color: "hsl(38 92% 50%)" }}>
              <AlertTriangle size={11} /> {warningCount}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => clearProblems()} title="Clear All"
            style={{ background: "none", border: "none", color: "hsl(220 14% 50%)", cursor: "pointer", padding: 2 }}>
            <Trash2 size={13} />
          </button>
          <button onClick={onClose} title="Close"
            style={{ background: "none", border: "none", color: "hsl(220 14% 50%)", cursor: "pointer", padding: 2 }}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Problems list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {problems.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "hsl(220 14% 40%)", fontSize: 11 }}>
            No problems detected
          </div>
        ) : (
          problems.map((p) => (
            <div
              key={p.id}
              onClick={() => p.file && onNavigateToFile?.(p.file, p.line)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "4px 12px", fontSize: 11,
                cursor: p.file ? "pointer" : "default",
                borderBottom: "1px solid hsl(220 13% 19%)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(220 13% 20%)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {typeIcon(p.type)}
              <span style={{ flex: 1, color: "hsl(220 14% 70%)", fontFamily: "monospace", lineHeight: 1.4 }}>
                {p.message}
              </span>
              {p.file && (
                <span style={{ color: "hsl(207 90% 60%)", flexShrink: 0, fontSize: 10 }}>
                  {p.file}{p.line ? `:${p.line}` : ""}
                </span>
              )}
              <span style={{ color: "hsl(220 14% 35%)", flexShrink: 0, fontSize: 10 }}>
                {p.source}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
