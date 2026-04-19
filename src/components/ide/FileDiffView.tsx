import { useEffect, useState, useCallback } from "react";
import { FileText, Loader2, RefreshCw, Plus, Minus } from "lucide-react";
import { apiGet } from "@/lib/api";

interface FileDiffViewProps {
  projectId: string;
  filePath: string;
  staged: boolean;
}

interface DiffData {
  diff: string;
  oldContent: string;
  newContent: string;
}

/**
 * Render a unified git diff with color-coded lines.
 */
function DiffBlock({ diff }: { diff: string }) {
  if (!diff || !diff.trim()) {
    return (
      <div style={{ padding: 20, fontSize: 11, color: "hsl(220 14% 45%)", textAlign: "center" }}>
        No diff available (binary file or unchanged)
      </div>
    );
  }

  const lines = diff.split("\n");
  const skipPrefixes = ["diff --git", "index ", "+++ ", "--- ", "new file mode", "deleted file mode", "similarity index", "rename from", "rename to"];

  return (
    <div style={{
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      fontSize: 12, lineHeight: "18px",
    }}>
      {lines.map((line, i) => {
        if (skipPrefixes.some(p => line.startsWith(p))) return null;
        if (!line) return null;

        let bg = "transparent";
        let color = "hsl(220 14% 75%)";
        let prefix = " ";

        if (line.startsWith("@@")) {
          bg = "hsl(220 13% 18%)";
          color = "hsl(207 90% 65%)";
        } else if (line.startsWith("+")) {
          bg = "hsl(142 71% 45% / 0.12)";
          color = "hsl(142 71% 75%)";
          prefix = "+";
        } else if (line.startsWith("-")) {
          bg = "hsl(0 84% 50% / 0.12)";
          color = "hsl(0 84% 75%)";
          prefix = "-";
        }

        return (
          <div key={i} style={{
            display: "flex", padding: "0 12px",
            background: bg, color,
            whiteSpace: "pre",
          }}>
            <span style={{ width: 16, color: "hsl(220 14% 35%)", flexShrink: 0 }}>{prefix !== " " ? prefix : ""}</span>
            <span style={{ flex: 1 }}>{line.startsWith("+") || line.startsWith("-") ? line.slice(1) : line}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Side-by-side view: original on left, modified on right
 */
function SideBySide({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr",
      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
      fontSize: 12, lineHeight: "18px",
      borderTop: "1px solid hsl(220 13% 22%)",
    }}>
      {/* Headers */}
      <div style={{
        padding: "6px 12px", fontSize: 10, fontWeight: 600,
        background: "hsl(0 84% 50% / 0.1)",
        color: "hsl(0 84% 70%)",
        borderRight: "1px solid hsl(220 13% 22%)",
        borderBottom: "1px solid hsl(220 13% 22%)",
      }}>
        Original
      </div>
      <div style={{
        padding: "6px 12px", fontSize: 10, fontWeight: 600,
        background: "hsl(142 71% 45% / 0.1)",
        color: "hsl(142 71% 70%)",
        borderBottom: "1px solid hsl(220 13% 22%)",
      }}>
        Modified
      </div>

      {/* Lines */}
      {Array.from({ length: maxLen }).map((_, i) => {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        const same = oldLine === newLine;

        const cellStyle = (side: "old" | "new"): React.CSSProperties => ({
          padding: "0 12px",
          whiteSpace: "pre",
          background: same
            ? "transparent"
            : side === "old"
              ? "hsl(0 84% 50% / 0.10)"
              : "hsl(142 71% 45% / 0.10)",
          color: same
            ? "hsl(220 14% 65%)"
            : side === "old"
              ? "hsl(0 84% 80%)"
              : "hsl(142 71% 80%)",
          borderRight: side === "old" ? "1px solid hsl(220 13% 22%)" : "none",
          minHeight: 18,
        });

        return (
          <>
            <div key={`o-${i}`} style={cellStyle("old")}>
              <span style={{ width: 36, display: "inline-block", color: "hsl(220 14% 30%)", textAlign: "right", marginRight: 8 }}>
                {oldLine !== undefined ? i + 1 : ""}
              </span>
              {oldLine ?? ""}
            </div>
            <div key={`n-${i}`} style={cellStyle("new")}>
              <span style={{ width: 36, display: "inline-block", color: "hsl(220 14% 30%)", textAlign: "right", marginRight: 8 }}>
                {newLine !== undefined ? i + 1 : ""}
              </span>
              {newLine ?? ""}
            </div>
          </>
        );
      })}
    </div>
  );
}

export function FileDiffView({ projectId, filePath, staged }: FileDiffViewProps) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"unified" | "split">("unified");

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet("/api/git/diff", { projectId, path: filePath, staged: String(staged) })
      .then(setData)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, filePath, staged]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(220 13% 14%)" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: "hsl(207 90% 60%)" }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(220 13% 14%)", color: "hsl(0 84% 65%)", fontSize: 12 }}>
        Failed to load diff: {error || "Unknown error"}
      </div>
    );
  }

  // Compute simple stats
  const additions = (data.diff.match(/^\+[^+]/gm) || []).length;
  const deletions = (data.diff.match(/^-[^-]/gm) || []).length;

  return (
    <div style={{ flex: 1, overflow: "auto", background: "hsl(220 13% 14%)", color: "hsl(220 14% 85%)" }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 1,
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 16px",
        background: "hsl(220 13% 16%)",
        borderBottom: "1px solid hsl(220 13% 22%)",
      }}>
        <FileText size={14} style={{ color: "hsl(207 90% 60%)" }} />
        <span style={{ fontSize: 12, fontFamily: "monospace", color: "hsl(220 14% 90%)" }}>{filePath}</span>
        <span style={{
          fontSize: 9, padding: "1px 6px", borderRadius: 3,
          background: staged ? "hsl(142 71% 45% / 0.2)" : "hsl(38 92% 50% / 0.2)",
          color: staged ? "hsl(142 71% 65%)" : "hsl(38 92% 65%)",
          fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          {staged ? "Staged" : "Unstaged"}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <span style={{ fontSize: 11, color: "hsl(142 71% 60%)", display: "flex", alignItems: "center", gap: 2 }}>
            <Plus size={10} />{additions}
          </span>
          <span style={{ fontSize: 11, color: "hsl(0 84% 65%)", display: "flex", alignItems: "center", gap: 2 }}>
            <Minus size={10} />{deletions}
          </span>
        </div>

        <div className="flex-1" />

        {/* View toggle */}
        <div style={{ display: "flex", background: "hsl(220 13% 12%)", borderRadius: 4, border: "1px solid hsl(220 13% 25%)" }}>
          <button
            onClick={() => setView("unified")}
            style={{
              padding: "3px 10px", fontSize: 10,
              background: view === "unified" ? "hsl(220 13% 22%)" : "transparent",
              color: view === "unified" ? "hsl(207 90% 65%)" : "hsl(220 14% 60%)",
              border: "none", cursor: "pointer", borderRadius: 3,
              fontWeight: view === "unified" ? 600 : 400,
            }}
          >
            Unified
          </button>
          <button
            onClick={() => setView("split")}
            style={{
              padding: "3px 10px", fontSize: 10,
              background: view === "split" ? "hsl(220 13% 22%)" : "transparent",
              color: view === "split" ? "hsl(207 90% 65%)" : "hsl(220 14% 60%)",
              border: "none", cursor: "pointer", borderRadius: 3,
              fontWeight: view === "split" ? 600 : 400,
            }}
          >
            Split
          </button>
        </div>

        <button
          onClick={refresh}
          title="Refresh"
          style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 4 }}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Diff body */}
      {view === "unified" ? (
        <DiffBlock diff={data.diff} />
      ) : (
        <SideBySide oldContent={data.oldContent} newContent={data.newContent} />
      )}
    </div>
  );
}
