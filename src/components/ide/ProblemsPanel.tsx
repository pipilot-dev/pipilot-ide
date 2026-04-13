/**
 * ProblemsPanel — editorial-terminal styled diagnostics panel.
 *
 * Features:
 *  - Resizable (drag handle is in IDELayout)
 *  - Re-check (server-side diagnostics)
 *  - Ask AI to Fix — auto-attaches up to 100 problems and primes the chat
 *    panel with a "fix these" prompt
 */

import { useState, useMemo, useEffect } from "react";
import {
  AlertCircle, AlertTriangle, Info, Trash2, X, RefreshCw, Loader2,
  ChevronDown, ChevronRight, FileText, Sparkles,
} from "lucide-react";
import { useProblems, type Problem } from "@/contexts/ProblemsContext";
import { useDiagnostics } from "@/hooks/useDiagnostics";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface ProblemsPanelProps {
  onClose: () => void;
  onNavigateToFile?: (file: string, line?: number, column?: number) => void;
}

const SOURCE_COLORS: Record<string, string> = {
  typescript: "#7ad6ff",
  eslint:     "#c6a6ff",
  json:       "#ffb86b",
  syntax:     "#a8ff7a",
  python:     "#ffd96b",
  go:         "#7adfff",
  rust:       "#ff9b6b",
  php:        "#c6a6ff",
  ruby:       "#ff7a8e",
  preview:    "#ff7a8e",
  terminal:   "#a8a8b3",
  editor:     "#a8a8b3",
};

/** Cap to keep the agent's context window safe */
export const MAX_PROBLEMS_FOR_AI = 100;

export function ProblemsPanel({ onClose, onNavigateToFile }: ProblemsPanelProps) {
  const { problems, clearProblems, errorCount, warningCount } = useProblems();
  const { runChecks, running, lastResult, lastSeedReport, error: diagError } = useDiagnostics();

  const [filter, setFilter] = useState<"all" | "error" | "warning" | "info">("all");
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [autoRunOnce, setAutoRunOnce] = useState(false);

  useEffect(() => { injectFonts(); }, []);

  // Auto-run checks once when the panel first opens
  useEffect(() => {
    if (!autoRunOnce) {
      setAutoRunOnce(true);
      runChecks();
    }
  }, [autoRunOnce, runChecks]);

  const filtered = useMemo(() => {
    if (filter === "all") return problems;
    return problems.filter((p) => p.type === filter);
  }, [problems, filter]);

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
      case "error":   return <AlertCircle size={sz} style={{ color: C.error, flexShrink: 0 }} />;
      case "warning": return <AlertTriangle size={sz} style={{ color: C.warn, flexShrink: 0 }} />;
      default:        return <Info size={sz} style={{ color: C.info, flexShrink: 0 }} />;
    }
  };

  /**
   * Build a compact textual representation of the problems list and dispatch
   * a `pipilot:attach-problems` event that ChatPanel listens for. The event
   * payload becomes an attachment pill so the user can review (and remove)
   * before sending.
   */
  const handleAskAi = () => {
    if (filtered.length === 0) return;
    const total = filtered.length;
    const truncated = total > MAX_PROBLEMS_FOR_AI;
    const slice = truncated ? filtered.slice(0, MAX_PROBLEMS_FOR_AI) : filtered;

    // Group by file for a more readable digest
    const byFile = new Map<string, Problem[]>();
    const noFile: Problem[] = [];
    for (const p of slice) {
      if (p.file) {
        if (!byFile.has(p.file)) byFile.set(p.file, []);
        byFile.get(p.file)!.push(p);
      } else noFile.push(p);
    }

    const lines: string[] = [];
    lines.push(`# Diagnostics report — ${slice.length} of ${total} problem${total === 1 ? "" : "s"}`);
    if (truncated) lines.push(`(truncated to first ${MAX_PROBLEMS_FOR_AI} for context safety)`);
    lines.push("");

    for (const [file, items] of byFile.entries()) {
      lines.push(`## ${file}`);
      for (const p of items) {
        const loc = p.line ? `:${p.line}${p.column ? `:${p.column}` : ""}` : "";
        const code = p.code ? ` [${p.code}]` : "";
        lines.push(`- ${p.type.toUpperCase()}${code} (${p.source})${loc} — ${p.message}`);
      }
      lines.push("");
    }
    if (noFile.length > 0) {
      lines.push(`## (no file)`);
      for (const p of noFile) {
        lines.push(`- ${p.type.toUpperCase()} (${p.source}) — ${p.message}`);
      }
    }

    const content = lines.join("\n");
    window.dispatchEvent(new CustomEvent("pipilot:attach-problems", {
      detail: {
        id: "__problems__",
        count: slice.length,
        totalCount: total,
        truncated,
        content,
        prefill:
          truncated
            ? `Please fix these ${slice.length} problems (truncated from ${total}). Start with errors first, then warnings.`
            : `Please fix these ${slice.length} problem${slice.length === 1 ? "" : "s"}. Start with errors first, then warnings.`,
      },
    }));
  };

  const totalShown = filtered.length;

  return (
    <div style={{
      height: "100%",
      background: C.bg,
      display: "flex", flexDirection: "column",
      fontFamily: FONTS.sans,
      borderTop: `1px solid ${C.border}`,
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          {/* Editorial section label */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: errorCount > 0 ? C.error : warningCount > 0 ? C.warn : C.accent,
              boxShadow: `0 0 8px ${errorCount > 0 ? C.error : warningCount > 0 ? C.warn : C.accent}80`,
              flexShrink: 0,
            }} />
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.accent,
            }}>
              / P
            </span>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.text,
            }}>
              Problems
            </span>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9,
              color: C.textDim, letterSpacing: "0.05em",
            }}>
              ({String(problems.length).padStart(2, "0")})
            </span>
          </div>

          {/* Filter pills */}
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {([
              { id: "all" as const, label: "ALL", count: problems.length, color: C.textMid },
              { id: "error" as const, label: "ERR", count: errorCount, icon: <AlertCircle size={9} />, color: C.error },
              { id: "warning" as const, label: "WARN", count: warningCount, icon: <AlertTriangle size={9} />, color: C.warn },
            ]).map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "3px 9px",
                    fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                    letterSpacing: "0.1em",
                    background: active ? C.surfaceAlt : "transparent",
                    color: active ? f.color : C.textDim,
                    border: `1px solid ${active ? f.color + "66" : C.border}`,
                    borderRadius: 3, cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.borderColor = C.borderHover;
                      e.currentTarget.style.color = C.text;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.borderColor = C.border;
                      e.currentTarget.style.color = C.textDim;
                    }
                  }}
                >
                  {f.icon}
                  <span>{f.label}</span>
                  <span style={{ color: active ? f.color : C.textFaint }}>
                    {String(f.count).padStart(2, "0")}
                  </span>
                </button>
              );
            })}
          </div>

          {lastResult && (
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, color: C.textFaint,
              letterSpacing: "0.05em",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              // {lastResult.durationMs}ms
              {lastResult.ran.typescript && " · ts"}
              {lastResult.ran.eslint && " · eslint"}
              {lastResult.ran.python && " · py"}
              {lastResult.ran.go && " · go"}
              {lastResult.ran.rust && " · rust"}
              {lastResult.ran.json && " · json"}
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {/* AI fix */}
          <button
            onClick={handleAskAi}
            disabled={filtered.length === 0}
            title={
              filtered.length === 0
                ? "No problems to send"
                : `Send ${Math.min(filtered.length, MAX_PROBLEMS_FOR_AI)} problem${filtered.length === 1 ? "" : "s"} to PiPilot Agent`
            }
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px",
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600,
              letterSpacing: "0.12em", textTransform: "uppercase",
              background: filtered.length === 0 ? "transparent" : C.accent,
              color: filtered.length === 0 ? C.textDim : C.bg,
              border: `1px solid ${filtered.length === 0 ? C.border : C.accent}`,
              borderRadius: 3,
              cursor: filtered.length === 0 ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            <Sparkles size={10} />
            AI Fix
          </button>

          {/* Re-check */}
          <button
            onClick={runChecks}
            disabled={running}
            title="Re-check (run linters)"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px",
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.12em", textTransform: "uppercase",
              background: "transparent",
              color: running ? C.textDim : C.textMid,
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              cursor: running ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!running) {
                e.currentTarget.style.borderColor = C.accentLine;
                e.currentTarget.style.color = C.accent;
              }
            }}
            onMouseLeave={(e) => {
              if (!running) {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.color = C.textMid;
              }
            }}
          >
            {running ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {running ? "Checking" : "Re-check"}
          </button>

          {/* Clear */}
          <button
            onClick={() => clearProblems()}
            title="Clear all"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 24, height: 24,
              background: "transparent", border: "none", borderRadius: 3,
              color: C.textDim, cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}
          >
            <Trash2 size={11} />
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            title="Close"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 24, height: 24,
              background: "transparent", border: "none", borderRadius: 3,
              color: C.textDim, cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Diagnostics error */}
      {diagError && (
        <div style={{
          padding: "8px 16px",
          fontSize: 11, fontFamily: FONTS.mono,
          background: "#ff6b6b12",
          color: "#ff9b9b",
          borderBottom: `1px solid #ff6b6b33`,
          flexShrink: 0,
        }}>
          // ERROR: {diagError}
        </div>
      )}

      {/* Seed report */}
      {lastSeedReport && lastSeedReport.added.length > 0 && (
        <div style={{
          padding: "8px 16px",
          fontSize: 11, fontFamily: FONTS.mono,
          background: C.accentDim,
          color: C.accent,
          borderBottom: `1px solid ${C.accentLine}`,
          flexShrink: 0,
        }}>
          // Detected <strong>{lastSeedReport.framework}</strong> — added: {lastSeedReport.added.join(", ")}
        </div>
      )}

      {/* ── Problems list ── */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {totalShown === 0 ? (
          <div style={{
            padding: "60px 24px", textAlign: "center",
            fontFamily: FONTS.sans, fontSize: 13, color: C.textDim,
            lineHeight: 1.6,
          }}>
            <div style={{
              fontFamily: FONTS.mono, fontSize: 9,
              letterSpacing: "0.18em", color: C.textFaint,
              marginBottom: 10,
            }}>
              {running ? "// CHECKING…" : "// CLEAN"}
            </div>
            {running ? "Running language checks…" : "No problems detected."}
          </div>
        ) : (
          <>
            {grouped.byFile.map(([file, items]) => {
              const isCollapsed = collapsedFiles.has(file);
              const fileErrors = items.filter((p) => p.type === "error").length;
              const fileWarns = items.filter((p) => p.type === "warning").length;
              return (
                <div key={file}>
                  <button
                    onClick={() => toggleFile(file)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", padding: "8px 16px",
                      background: C.surface,
                      border: "none", cursor: "pointer", textAlign: "left",
                      borderBottom: `1px solid ${C.border}`,
                      fontFamily: FONTS.mono,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.surfaceAlt; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = C.surface; }}
                  >
                    {isCollapsed
                      ? <ChevronRight size={11} style={{ color: C.textDim, flexShrink: 0 }} />
                      : <ChevronDown size={11} style={{ color: C.accent, flexShrink: 0 }} />}
                    <FileText size={11} style={{ color: C.textDim, flexShrink: 0 }} />
                    <span style={{
                      fontSize: 11, color: C.text, fontFamily: FONTS.mono,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
                    }}>
                      {file}
                    </span>
                    <span style={{
                      padding: "1px 7px", fontSize: 9, fontFamily: FONTS.mono,
                      background: C.bg, color: C.textDim,
                      border: `1px solid ${C.border}`, borderRadius: 2,
                      flexShrink: 0,
                    }}>
                      {String(items.length).padStart(2, "0")}
                    </span>
                    {fileErrors > 0 && (
                      <span style={{
                        display: "flex", alignItems: "center", gap: 3,
                        color: C.error, fontSize: 10, fontFamily: FONTS.mono,
                        flexShrink: 0,
                      }}>
                        <AlertCircle size={9} /> {fileErrors}
                      </span>
                    )}
                    {fileWarns > 0 && (
                      <span style={{
                        display: "flex", alignItems: "center", gap: 3,
                        color: C.warn, fontSize: 10, fontFamily: FONTS.mono,
                        flexShrink: 0,
                      }}>
                        <AlertTriangle size={9} /> {fileWarns}
                      </span>
                    )}
                  </button>

                  {!isCollapsed && items.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => p.file && onNavigateToFile?.(p.file, p.line, p.column)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        padding: "6px 16px 6px 38px",
                        cursor: "pointer",
                        borderBottom: `1px solid ${C.border}`,
                        borderLeft: "2px solid transparent",
                        transition: "background 0.12s, border-left-color 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = C.surfaceAlt;
                        (e.currentTarget as HTMLElement).style.borderLeftColor = C.accentLine;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
                      }}
                    >
                      {typeIcon(p.type)}
                      <span style={{
                        flex: 1,
                        fontFamily: FONTS.sans, fontSize: 12,
                        color: C.text, lineHeight: 1.5, minWidth: 0,
                      }}>
                        {p.message}
                      </span>
                      {p.code && (
                        <span style={{
                          fontFamily: FONTS.mono, fontSize: 9,
                          color: C.textDim,
                          padding: "1px 6px",
                          background: C.bg,
                          border: `1px solid ${C.border}`,
                          borderRadius: 2,
                          flexShrink: 0,
                        }}>
                          {p.code}
                        </span>
                      )}
                      <span style={{
                        fontFamily: FONTS.mono, fontSize: 9,
                        color: C.textFaint, flexShrink: 0,
                      }}>
                        {p.line ? `${p.line}${p.column ? `:${p.column}` : ""}` : "—"}
                      </span>
                      <span style={{
                        fontFamily: FONTS.mono, fontSize: 9,
                        letterSpacing: "0.05em",
                        color: SOURCE_COLORS[p.source] || C.textDim,
                        flexShrink: 0,
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
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 16px",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {typeIcon(p.type)}
                <span style={{
                  flex: 1, fontFamily: FONTS.sans, fontSize: 12,
                  color: C.textMid, lineHeight: 1.5,
                }}>
                  {p.message}
                </span>
                <span style={{
                  fontFamily: FONTS.mono, fontSize: 9,
                  letterSpacing: "0.05em",
                  color: SOURCE_COLORS[p.source] || C.textDim,
                  flexShrink: 0,
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
