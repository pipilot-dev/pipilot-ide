import { useEffect, useState } from "react";
import { GitCommit, FileText, Loader2, ChevronDown, ChevronRight, User, Calendar, Hash } from "lucide-react";
import { apiGet } from "@/lib/api";

interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
}

interface CommitDetail {
  oid: string;
  shortOid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parent: string;
  files: CommitFile[];
}

interface CommitDetailViewProps {
  projectId: string;
  oid: string;
}

function statusColor(status: string): string {
  if (status === "A") return "hsl(142 71% 55%)";
  if (status === "D") return "hsl(0 84% 65%)";
  if (status === "M") return "hsl(38 92% 60%)";
  if (status === "R") return "hsl(207 90% 65%)";
  return "hsl(220 14% 60%)";
}

function statusLabel(status: string): string {
  return ({ A: "Added", D: "Deleted", M: "Modified", R: "Renamed" } as Record<string, string>)[status] || status;
}

/**
 * Render a unified diff with color-coded lines.
 * Skips git's "diff --git", "index", "+++", "---" header lines for cleaner display.
 */
function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const skipPrefixes = ["diff --git", "index ", "+++ ", "--- ", "new file mode", "deleted file mode", "similarity index", "rename from", "rename to"];

  return (
    <div style={{
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      fontSize: 11, lineHeight: "17px",
      background: "hsl(220 13% 10%)",
      borderTop: "1px solid hsl(220 13% 22%)",
    }}>
      {lines.map((line, i) => {
        if (skipPrefixes.some(p => line.startsWith(p))) return null;
        if (!line) return null;

        let bg = "transparent";
        let color = "hsl(220 14% 75%)";
        let prefix = " ";

        if (line.startsWith("@@")) {
          bg = "hsl(220 13% 16%)";
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

export function CommitDetailView({ projectId, oid }: CommitDetailViewProps) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet("/api/git/commit-detail", { projectId, oid })
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setDetail(data);
          // Expand all files by default for small commits
          if (data.files && data.files.length <= 5) {
            setExpanded(new Set(data.files.map((f: CommitFile) => f.path)));
          }
        }
      })
      .catch((e: any) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, oid]);

  const toggleFile = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(220 13% 14%)" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: "hsl(207 90% 60%)" }} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(220 13% 14%)", color: "hsl(0 84% 65%)", fontSize: 12 }}>
        Failed to load commit: {error || "Unknown error"}
      </div>
    );
  }

  const totalAdditions = detail.files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = detail.files.reduce((s, f) => s + f.deletions, 0);
  const date = new Date(detail.timestamp * 1000);

  return (
    <div style={{ flex: 1, overflow: "auto", background: "hsl(220 13% 14%)", color: "hsl(220 14% 85%)" }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 16%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <GitCommit size={16} style={{ color: "hsl(207 90% 60%)" }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Commit</span>
          <code style={{
            fontSize: 11, fontFamily: "monospace",
            color: "hsl(207 90% 65%)", padding: "2px 6px",
            background: "hsl(220 13% 12%)", borderRadius: 3,
          }}>
            {detail.shortOid}
          </code>
        </div>

        <div style={{
          fontSize: 14, fontWeight: 600, color: "hsl(220 14% 95%)",
          whiteSpace: "pre-wrap", marginBottom: 12, lineHeight: 1.5,
        }}>
          {detail.message}
        </div>

        <div style={{ display: "flex", gap: 16, fontSize: 11, color: "hsl(220 14% 55%)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <User size={11} />
            <span>{detail.author}</span>
            <span style={{ color: "hsl(220 14% 35%)" }}>&lt;{detail.email}&gt;</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Calendar size={11} />
            <span>{date.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Hash size={11} />
            <code style={{ fontFamily: "monospace", color: "hsl(220 14% 60%)" }}>{detail.oid}</code>
          </div>
        </div>

        <div style={{
          marginTop: 12, fontSize: 11,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ color: "hsl(220 14% 65%)" }}>
            {detail.files.length} file{detail.files.length !== 1 ? "s" : ""} changed
          </span>
          <span style={{ color: "hsl(142 71% 60%)" }}>+{totalAdditions}</span>
          <span style={{ color: "hsl(0 84% 65%)" }}>−{totalDeletions}</span>
        </div>
      </div>

      {/* Files */}
      <div>
        {detail.files.map((f) => {
          const isExpanded = expanded.has(f.path);
          return (
            <div key={f.path} style={{ borderBottom: "1px solid hsl(220 13% 22%)" }}>
              <button
                onClick={() => toggleFile(f.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  width: "100%", padding: "8px 16px",
                  background: "hsl(220 13% 16%)",
                  border: "none", cursor: "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(220 13% 18%)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "hsl(220 13% 16%)"; }}
              >
                {isExpanded ? <ChevronDown size={11} style={{ color: "hsl(220 14% 55%)" }} /> : <ChevronRight size={11} style={{ color: "hsl(220 14% 55%)" }} />}
                <FileText size={12} style={{ color: "hsl(220 14% 50%)" }} />
                <span style={{ fontSize: 12, color: "hsl(220 14% 85%)", fontFamily: "monospace" }}>{f.path}</span>
                <div className="flex-1" />
                <span title={statusLabel(f.status)} style={{
                  fontSize: 9, fontWeight: 700,
                  padding: "1px 5px", borderRadius: 3,
                  color: statusColor(f.status),
                  background: `${statusColor(f.status)}1a`,
                }}>
                  {f.status}
                </span>
                <span style={{ fontSize: 10, color: "hsl(142 71% 60%)" }}>+{f.additions}</span>
                <span style={{ fontSize: 10, color: "hsl(0 84% 65%)" }}>−{f.deletions}</span>
              </button>
              {isExpanded && f.diff && <DiffBlock diff={f.diff} />}
              {isExpanded && !f.diff && (
                <div style={{ padding: "12px 20px", fontSize: 11, color: "hsl(220 14% 45%)", fontStyle: "italic" }}>
                  Binary file or no diff available
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
