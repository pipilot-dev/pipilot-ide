import { useState, useMemo, useEffect } from "react";
import {
  AlertCircle, AlertTriangle, Info, Trash2, X, RefreshCw, Loader2,
  ChevronDown, ChevronRight, FileText,
} from "lucide-react";
import { useProblems, type Problem } from "@/contexts/ProblemsContext";
import { useDiagnostics } from "@/hooks/useDiagnostics";

interface ProblemsPanelProps {
  onClose: () => void;
  onNavigateToFile?: (file: string, line?: number, column?: number) => void;
}

const SOURCE_COLORS: Record<string, string> = {
  typescript: "hsl(207 90% 60%)",
  eslint: "hsl(280 75% 65%)",
  json: "hsl(38 92% 60%)",
  syntax: "hsl(142 71% 55%)",
  preview: "hsl(0 70% 65%)",
  terminal: "hsl(220 14% 60%)",
  editor: "hsl(220 14% 60%)",
};

export function ProblemsPanel({ onClose, onNavigateToFile }: ProblemsPanelProps) {
  const { problems, clearProblems, errorCount, warningCount } = useProblems();
  const { runChecks, running, lastResult, error: diagError } = useDiagnostics();

  const [filter, setFilter] = useState<"all" | "error" | "warning" | "info">("all");
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [autoRunOnce, setAutoRunOnce] = useState(false);

  // Auto-run checks once when the panel first opens
  useEffect(() => {
    if (!autoRunOnce) {
      setAutoRunOnce(true);
      runChecks();
    }
  }, [autoRunOnce, runChecks]);

  // Apply severity filter
  const filtered = useMemo(() => {
    if (filter === "all") return problems;
    return problems.filter((p) => p.type === filter);
  }, [problems, filter]);

  // Group by file
  const grouped = useMemo(() => {
    const map = new Map<string, Problem[]>();
    const noFile: Problem[] = [];
    for (const p of filtered) {
      if (p.file) {
        if (!map.has(p.file)) map.set(p.file, []);
        map.get(p.file)!.push(p);
      } else {
        noFile.push(p);
      }
    }
    // Sort each file's problems by line
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.line || 0) - (b.line || 0));
    }
    return { byFile: Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])), noFile };
  }, [filtered]);

  const toggleFile = (file: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const typeIcon = (type: string) => {
    const sz = 11;
    switch (type) {
      case "error": return <AlertCircle size={sz} style={{ color: "hsl(0 84% 60%)", flexShrink: 0 }} />;
      case "warning": return <AlertTriangle size={sz} style={{ color: "hsl(38 92% 60%)", flexShrink: 0 }} />;
      default: return <Info size={sz} style={{ color: "hsl(207 90% 60%)", flexShrink: 0 }} />;
    }
  };

  const totalShown = filtered.length;

  return (
    <div style={{
      height: 240, borderTop: "1px solid hsl(220 13% 25%)",
      background: "hsl(220 13% 14%)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 12px", borderBottom: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 16%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
          <span style={{ fontWeight: 600, color: "hsl(220 14% 75%)" }}>Problems</span>

          {/* Filter pills */}
          <div style={{ display: "flex", gap: 2 }}>
            {[
              { id: "all", label: `All (${problems.length})`, color: "hsl(220 14% 70%)" },
              { id: "error", label: errorCount.toString(), icon: <AlertCircle size={9} />, color: "hsl(0 84% 65%)" },
              { id: "warning", label: warningCount.toString(), icon: <AlertTriangle size={9} />, color: "hsl(38 92% 60%)" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as any)}
                style={{
                  display: "flex", alignItems: "center", gap: 3,
                  padding: "2px 8px", fontSize: 10, fontWeight: 600,
                  background: filter === f.id ? "hsl(220 13% 24%)" : "transparent",
                  color: f.color,
                  border: `1px solid ${filter === f.id ? f.color + "40" : "transparent"}`,
                  borderRadius: 3, cursor: "pointer",
                }}
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>

          {lastResult && (
            <span style={{ color: "hsl(220 14% 40%)", fontSize: 10 }}>
              {lastResult.durationMs}ms
              {lastResult.ran.typescript && " · ts"}
              {lastResult.ran.eslint && " · eslint"}
              {lastResult.ran.json && " · json"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={runChecks}
            disabled={running}
            title="Re-check (run linters)"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "hsl(207 90% 45% / 0.15)",
              color: running ? "hsl(220 14% 40%)" : "hsl(207 90% 65%)",
              border: "1px solid hsl(207 90% 50% / 0.3)",
              borderRadius: 4, padding: "3px 8px",
              fontSize: 10, fontWeight: 600,
              cursor: running ? "not-allowed" : "pointer",
            }}
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {running ? "Checking..." : "Re-check"}
          </button>
          <button onClick={() => clearProblems()} title="Clear All"
            style={{ background: "none", border: "none", color: "hsl(220 14% 50%)", cursor: "pointer", padding: 4 }}>
            <Trash2 size={12} />
          </button>
          <button onClick={onClose} title="Close"
            style={{ background: "none", border: "none", color: "hsl(220 14% 50%)", cursor: "pointer", padding: 4 }}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Error from running checks */}
      {diagError && (
        <div style={{
          padding: "4px 12px", fontSize: 10,
          background: "hsl(0 84% 50% / 0.1)", color: "hsl(0 84% 75%)",
          borderBottom: "1px solid hsl(0 84% 50% / 0.2)",
        }}>
          Diagnostics error: {diagError}
        </div>
      )}

      {/* Problems list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {totalShown === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "hsl(220 14% 40%)", fontSize: 11 }}>
            {running ? "Running checks..." : "No problems detected"}
          </div>
        ) : (
          <>
            {/* Files with problems */}
            {grouped.byFile.map(([file, items]) => {
              const isCollapsed = collapsedFiles.has(file);
              const fileErrors = items.filter((p) => p.type === "error").length;
              const fileWarns = items.filter((p) => p.type === "warning").length;
              return (
                <div key={file}>
                  <button
                    onClick={() => toggleFile(file)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      width: "100%", padding: "4px 12px",
                      background: "hsl(220 13% 16%)",
                      border: "none", cursor: "pointer", textAlign: "left",
                      borderBottom: "1px solid hsl(220 13% 19%)",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(220 13% 19%)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(220 13% 16%)"; }}
                  >
                    {isCollapsed ? <ChevronRight size={11} style={{ color: "hsl(220 14% 50%)" }} /> : <ChevronDown size={11} style={{ color: "hsl(220 14% 50%)" }} />}
                    <FileText size={11} style={{ color: "hsl(207 90% 60%)" }} />
                    <span style={{ fontSize: 11, color: "hsl(220 14% 85%)", fontFamily: "monospace" }}>{file}</span>
                    <span style={{
                      marginLeft: 4, padding: "0 5px", fontSize: 9,
                      background: "hsl(220 13% 22%)", color: "hsl(220 14% 60%)",
                      borderRadius: 8,
                    }}>
                      {items.length}
                    </span>
                    {fileErrors > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 2, color: "hsl(0 84% 65%)", fontSize: 10 }}>
                        <AlertCircle size={9} /> {fileErrors}
                      </span>
                    )}
                    {fileWarns > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 2, color: "hsl(38 92% 60%)", fontSize: 10 }}>
                        <AlertTriangle size={9} /> {fileWarns}
                      </span>
                    )}
                  </button>

                  {!isCollapsed && items.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => p.file && onNavigateToFile?.(p.file, p.line, p.column)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        padding: "3px 12px 3px 32px", fontSize: 11,
                        cursor: "pointer",
                        borderBottom: "1px solid hsl(220 13% 17%)",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(220 13% 18%)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      {typeIcon(p.type)}
                      <span style={{ flex: 1, color: "hsl(220 14% 78%)", lineHeight: 1.4 }}>
                        {p.message}
                      </span>
                      {p.code && (
                        <span style={{
                          color: "hsl(220 14% 50%)", fontSize: 10, fontFamily: "monospace",
                          padding: "0 4px", background: "hsl(220 13% 19%)", borderRadius: 3,
                        }}>
                          {p.code}
                        </span>
                      )}
                      <span style={{
                        color: "hsl(220 14% 50%)", flexShrink: 0, fontSize: 10,
                        fontFamily: "monospace",
                      }}>
                        [Ln {p.line || "?"}{p.column ? `, Col ${p.column}` : ""}]
                      </span>
                      <span style={{
                        color: SOURCE_COLORS[p.source] || "hsl(220 14% 50%)",
                        flexShrink: 0, fontSize: 9, fontWeight: 600,
                      }}>
                        {p.source}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Problems with no file */}
            {grouped.noFile.length > 0 && grouped.noFile.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "4px 12px", fontSize: 11,
                  borderBottom: "1px solid hsl(220 13% 19%)",
                }}
              >
                {typeIcon(p.type)}
                <span style={{ flex: 1, color: "hsl(220 14% 70%)" }}>{p.message}</span>
                <span style={{
                  color: SOURCE_COLORS[p.source] || "hsl(220 14% 50%)",
                  fontSize: 9, fontWeight: 600,
                }}>
                  {p.source}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
