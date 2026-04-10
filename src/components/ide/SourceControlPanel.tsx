import { useState, useEffect, useMemo } from "react";
import {
  GitBranch, GitCommit, RefreshCw, Plus, Minus, Check, ChevronDown, ChevronRight,
  Upload, Download, History, AlertTriangle, ExternalLink, Loader2, FileText, X,
  RotateCcw, MoreHorizontal,
} from "lucide-react";
import { useRealGit, GitFileStatus } from "@/hooks/useRealGit";

function statusToLabel(f: GitFileStatus): { letter: string; color: string; tooltip: string } {
  // Combine index + worktree
  if (f.index === "?" && f.worktree === "?") return { letter: "U", color: "hsl(142 71% 55%)", tooltip: "Untracked" };
  if (f.index === "A") return { letter: "A", color: "hsl(142 71% 55%)", tooltip: "Added" };
  if (f.index === "M" || f.worktree === "M") return { letter: "M", color: "hsl(38 92% 60%)", tooltip: "Modified" };
  if (f.index === "D" || f.worktree === "D") return { letter: "D", color: "hsl(0 84% 65%)", tooltip: "Deleted" };
  if (f.index === "R") return { letter: "R", color: "hsl(207 90% 65%)", tooltip: "Renamed" };
  return { letter: "?", color: "hsl(220 14% 60%)", tooltip: "Unknown" };
}

function FileRow({ file, staged, onStage, onUnstage, onDiscard, onView }: {
  file: GitFileStatus;
  staged: boolean;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
  onView: () => void;
}) {
  const label = statusToLabel(file);
  const fileName = file.path.split("/").pop() || file.path;
  const dir = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : "";

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-white/5"
      style={{ fontSize: 11 }}
      onClick={onView}
    >
      <FileText size={11} style={{ color: "hsl(220 14% 50%)", flexShrink: 0 }} />
      <span style={{ color: "hsl(220 14% 85%)", flexShrink: 0 }}>{fileName}</span>
      {dir && <span style={{ color: "hsl(220 14% 35%)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir}</span>}
      <div className="flex-1" />
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        {!staged && onDiscard && (
          <button
            onClick={(e) => { e.stopPropagation(); onDiscard(); }}
            title="Discard changes"
            style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "hsl(220 14% 55%)" }}
          >
            <RotateCcw size={11} />
          </button>
        )}
        {staged ? (
          <button
            onClick={(e) => { e.stopPropagation(); onUnstage?.(); }}
            title="Unstage"
            style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "hsl(220 14% 55%)" }}
          >
            <Minus size={11} />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onStage?.(); }}
            title="Stage"
            style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "hsl(142 71% 55%)" }}
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      <span title={label.tooltip} style={{ color: label.color, fontWeight: 700, fontSize: 10, width: 10, textAlign: "center" }}>
        {label.letter}
      </span>
    </div>
  );
}

function DiffViewer({ filePath, oldContent, newContent, onClose }: {
  filePath: string;
  oldContent: string;
  newContent: string;
  onClose: () => void;
}) {
  // Simple line-by-line diff
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);

  return (
    <div style={{
      position: "absolute", inset: 0, background: "hsl(220 13% 12%)", zIndex: 10,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
        borderBottom: "1px solid hsl(220 13% 22%)", background: "hsl(220 13% 16%)",
      }}>
        <FileText size={12} style={{ color: "hsl(207 90% 60%)" }} />
        <span style={{ fontSize: 11, color: "hsl(220 14% 80%)", flex: 1, fontFamily: "monospace" }}>{filePath}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 2 }}>
          <X size={12} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", fontFamily: "monospace", fontSize: 10, lineHeight: "16px" }}>
        {Array.from({ length: maxLen }).map((_, i) => {
          const oldLine = oldLines[i];
          const newLine = newLines[i];
          if (oldLine === newLine) {
            return (
              <div key={i} style={{ display: "flex", color: "hsl(220 14% 50%)", padding: "0 8px" }}>
                <span style={{ width: 32, textAlign: "right", color: "hsl(220 14% 30%)", marginRight: 8 }}>{i + 1}</span>
                <span style={{ whiteSpace: "pre", flex: 1 }}>{oldLine}</span>
              </div>
            );
          }
          return (
            <div key={i}>
              {oldLine !== undefined && (
                <div style={{ display: "flex", background: "hsl(0 84% 50% / 0.12)", padding: "0 8px" }}>
                  <span style={{ width: 32, textAlign: "right", color: "hsl(0 84% 50%)", marginRight: 8 }}>-</span>
                  <span style={{ whiteSpace: "pre", color: "hsl(0 84% 75%)", flex: 1 }}>{oldLine}</span>
                </div>
              )}
              {newLine !== undefined && (
                <div style={{ display: "flex", background: "hsl(142 71% 45% / 0.12)", padding: "0 8px" }}>
                  <span style={{ width: 32, textAlign: "right", color: "hsl(142 71% 55%)", marginRight: 8 }}>+</span>
                  <span style={{ whiteSpace: "pre", color: "hsl(142 71% 75%)", flex: 1 }}>{newLine}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SourceControlPanel() {
  const git = useRealGit();
  const [commitMessage, setCommitMessage] = useState("");
  const [expandStaged, setExpandStaged] = useState(true);
  const [expandChanges, setExpandChanges] = useState(true);
  const [expandHistory, setExpandHistory] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [diffView, setDiffView] = useState<{ path: string; old: string; new: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Auto-refresh on visibility (poll every 5s while panel is mounted)
  useEffect(() => {
    if (!git.isRepo) return;
    const interval = setInterval(() => git.refreshStatus(), 5000);
    return () => clearInterval(interval);
  }, [git.isRepo, git.refreshStatus]);

  const handleViewDiff = async (path: string, staged: boolean) => {
    const data = await git.getDiff(path, staged);
    setDiffView({ path, old: data.oldContent, new: data.newContent });
  };

  const handleCommit = async () => {
    if (!commitMessage.trim() || git.stagedFiles.length === 0) return;
    setBusy("commit");
    const result = await git.commit(commitMessage);
    setBusy(null);
    if (result.success) {
      setCommitMessage("");
      setStatusMessage("Committed successfully");
      setTimeout(() => setStatusMessage(null), 3000);
    } else {
      setStatusMessage(result.message);
    }
  };

  const handlePush = async () => {
    if (git.remotes.length === 0) {
      setStatusMessage("No remote configured. Add one in the terminal first.");
      return;
    }
    setBusy("push");
    const result = await git.push();
    setBusy(null);
    setStatusMessage(result.success ? "Pushed successfully" : `Push failed: ${result.message.slice(0, 200)}`);
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const handlePull = async () => {
    if (git.remotes.length === 0) {
      setStatusMessage("No remote configured.");
      return;
    }
    setBusy("pull");
    const result = await git.pull();
    setBusy(null);
    setStatusMessage(result.success ? "Pulled successfully" : `Pull failed: ${result.message.slice(0, 200)}`);
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    await git.createBranch(newBranchName.trim());
    setNewBranchName("");
    setShowNewBranch(false);
  };

  // ── Git Not Installed State ───────────────────────────────────────
  if (git.installStatus.state === "checking") {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <Loader2 size={20} className="animate-spin" style={{ color: "hsl(207 90% 60%)" }} />
        <span style={{ fontSize: 11, color: "hsl(220 14% 55%)", marginTop: 8 }}>Checking git installation...</span>
      </div>
    );
  }

  if (git.installStatus.state === "missing" || git.installStatus.state === "installing") {
    const installing = git.installStatus.state === "installing";
    return (
      <div className="flex flex-col p-4 gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} style={{ color: "hsl(38 92% 60%)" }} />
          <span style={{ fontWeight: 600, fontSize: 12, color: "hsl(220 14% 85%)" }}>Git Not Installed</span>
        </div>
        <p style={{ fontSize: 11, color: "hsl(220 14% 60%)", lineHeight: 1.6 }}>
          Git is required for source control. PiPilot can attempt to install it automatically using your system's package manager.
        </p>
        <button
          onClick={git.installGit}
          disabled={installing}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 12px", fontSize: 11, fontWeight: 600,
            background: installing ? "hsl(220 13% 22%)" : "linear-gradient(135deg, hsl(207 90% 45%), hsl(207 90% 38%))",
            color: "#fff", border: "none", borderRadius: 6, cursor: installing ? "not-allowed" : "pointer",
          }}
        >
          {installing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {installing ? "Installing..." : "Auto-install Git"}
        </button>
        <a
          href="https://git-scm.com/downloads"
          target="_blank"
          rel="noopener"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "6px 12px", fontSize: 11,
            background: "hsl(220 13% 18%)", color: "hsl(220 14% 75%)",
            border: "1px solid hsl(220 13% 25%)", borderRadius: 6, textDecoration: "none",
          }}
        >
          <ExternalLink size={11} />
          Manual download
        </a>
        {git.lastError && (
          <div style={{
            padding: "6px 8px", fontSize: 10, color: "hsl(0 84% 75%)",
            background: "hsl(0 84% 50% / 0.1)", borderRadius: 4,
            border: "1px solid hsl(0 84% 50% / 0.2)",
            whiteSpace: "pre-wrap", maxHeight: 100, overflowY: "auto",
          }}>
            {git.lastError}
          </div>
        )}
      </div>
    );
  }

  // ── Git installed but no repo in this project ─────────────────────
  if (git.isRepo === false) {
    return (
      <div className="flex flex-col p-4 gap-3">
        <div className="flex items-center gap-2">
          <GitBranch size={14} style={{ color: "hsl(220 14% 60%)" }} />
          <span style={{ fontWeight: 600, fontSize: 12, color: "hsl(220 14% 85%)" }}>Source Control</span>
        </div>
        <p style={{ fontSize: 11, color: "hsl(220 14% 60%)", lineHeight: 1.6 }}>
          This project is not a git repository yet.
        </p>
        <button
          onClick={git.initRepo}
          disabled={git.loading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "8px 12px", fontSize: 11, fontWeight: 600,
            background: "linear-gradient(135deg, hsl(207 90% 45%), hsl(207 90% 38%))",
            color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
          }}
        >
          {git.loading ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
          Initialize Repository
        </button>
        <div style={{ fontSize: 10, color: "hsl(220 14% 45%)" }}>
          {(git.installStatus as any).version}
        </div>
      </div>
    );
  }

  if (git.isRepo === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={16} className="animate-spin" style={{ color: "hsl(207 90% 60%)" }} />
      </div>
    );
  }

  // ── Main panel ────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
        borderBottom: "1px solid hsl(220 13% 22%)",
      }}>
        <GitBranch size={12} style={{ color: "hsl(220 14% 60%)" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 75%)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Source Control
        </span>
        <div className="flex-1" />
        <button
          onClick={() => git.refreshStatus()}
          title="Refresh"
          style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 2 }}
        >
          <RefreshCw size={11} className={git.loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Branch + actions bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "6px 10px",
        borderBottom: "1px solid hsl(220 13% 22%)", background: "hsl(220 13% 14%)",
      }}>
        <button
          onClick={() => setShowBranchMenu(!showBranchMenu)}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "2px 8px",
            fontSize: 11, background: "hsl(220 13% 20%)", color: "hsl(220 14% 80%)",
            border: "1px solid hsl(220 13% 26%)", borderRadius: 4, cursor: "pointer",
          }}
        >
          <GitBranch size={10} />
          {git.branch}
          <ChevronDown size={10} />
        </button>
        <div className="flex-1" />
        <button
          onClick={handlePull}
          disabled={busy === "pull" || git.remotes.length === 0}
          title="Pull"
          style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 4, opacity: git.remotes.length === 0 ? 0.4 : 1 }}
        >
          {busy === "pull" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        </button>
        <button
          onClick={handlePush}
          disabled={busy === "push" || git.remotes.length === 0}
          title="Push"
          style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 4, opacity: git.remotes.length === 0 ? 0.4 : 1 }}
        >
          {busy === "push" ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
        </button>
      </div>

      {/* Branch dropdown menu */}
      {showBranchMenu && (
        <div style={{
          padding: "6px 10px", borderBottom: "1px solid hsl(220 13% 22%)",
          background: "hsl(220 13% 13%)",
        }}>
          {git.branches.map(b => (
            <button
              key={b}
              onClick={() => { git.checkout(b); setShowBranchMenu(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                width: "100%", padding: "4px 6px", fontSize: 11,
                background: b === git.branch ? "hsl(220 13% 22%)" : "transparent",
                color: b === git.branch ? "hsl(207 90% 65%)" : "hsl(220 14% 70%)",
                border: "none", borderRadius: 3, cursor: "pointer", textAlign: "left",
              }}
            >
              {b === git.branch && <Check size={10} />}
              <span style={{ marginLeft: b === git.branch ? 0 : 16 }}>{b}</span>
            </button>
          ))}
          <div style={{ borderTop: "1px solid hsl(220 13% 22%)", marginTop: 4, paddingTop: 4 }}>
            {showNewBranch ? (
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  autoFocus
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
                  placeholder="Branch name"
                  style={{
                    flex: 1, padding: "3px 6px", fontSize: 10,
                    background: "hsl(220 13% 18%)", color: "hsl(220 14% 90%)",
                    border: "1px solid hsl(220 13% 28%)", borderRadius: 3, outline: "none",
                  }}
                />
                <button
                  onClick={handleCreateBranch}
                  style={{
                    padding: "3px 8px", fontSize: 10,
                    background: "hsl(207 90% 45%)", color: "#fff",
                    border: "none", borderRadius: 3, cursor: "pointer",
                  }}
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewBranch(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  width: "100%", padding: "4px 6px", fontSize: 11,
                  background: "transparent", color: "hsl(142 71% 60%)",
                  border: "none", borderRadius: 3, cursor: "pointer", textAlign: "left",
                }}
              >
                <Plus size={10} />
                New branch...
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status message */}
      {statusMessage && (
        <div style={{
          padding: "6px 10px", fontSize: 10,
          background: "hsl(207 90% 50% / 0.1)",
          color: "hsl(207 90% 75%)",
          borderBottom: "1px solid hsl(207 90% 50% / 0.2)",
        }}>
          {statusMessage}
        </div>
      )}

      {/* Commit input */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid hsl(220 13% 22%)" }}>
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Message (Ctrl+Enter to commit)"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
          style={{
            width: "100%", padding: "6px 8px", fontSize: 11,
            background: "hsl(220 13% 12%)", color: "hsl(220 14% 90%)",
            border: "1px solid hsl(220 13% 25%)", borderRadius: 4,
            resize: "vertical", outline: "none", fontFamily: "inherit",
          }}
        />
        <button
          onClick={handleCommit}
          disabled={!commitMessage.trim() || git.stagedFiles.length === 0 || busy === "commit"}
          style={{
            marginTop: 6, width: "100%", padding: "6px 12px",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontSize: 11, fontWeight: 600,
            background: (!commitMessage.trim() || git.stagedFiles.length === 0)
              ? "hsl(220 13% 22%)"
              : "linear-gradient(135deg, hsl(142 71% 45%), hsl(142 71% 38%))",
            color: (!commitMessage.trim() || git.stagedFiles.length === 0) ? "hsl(220 14% 45%)" : "#fff",
            border: "none", borderRadius: 4,
            cursor: (!commitMessage.trim() || git.stagedFiles.length === 0) ? "not-allowed" : "pointer",
          }}
        >
          {busy === "commit" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Commit ({git.stagedFiles.length})
        </button>
      </div>

      {/* File lists */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Staged */}
        {git.stagedFiles.length > 0 && (
          <div>
            <button
              onClick={() => setExpandStaged(!expandStaged)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                width: "100%", padding: "4px 10px", fontSize: 10, fontWeight: 600,
                background: "hsl(220 13% 14%)", color: "hsl(220 14% 65%)",
                border: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5,
                borderTop: "1px solid hsl(220 13% 22%)",
                borderBottom: "1px solid hsl(220 13% 22%)",
              }}
            >
              {expandStaged ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Staged Changes ({git.stagedFiles.length})
              <div className="flex-1" />
              <button
                onClick={(e) => { e.stopPropagation(); git.unstage(git.stagedFiles.map(f => f.path)); }}
                title="Unstage all"
                style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 2 }}
              >
                <Minus size={11} />
              </button>
            </button>
            {expandStaged && git.stagedFiles.map(f => (
              <FileRow
                key={`s-${f.path}`}
                file={f}
                staged
                onUnstage={() => git.unstage([f.path])}
                onView={() => handleViewDiff(f.path, true)}
              />
            ))}
          </div>
        )}

        {/* Unstaged */}
        {git.unstagedFiles.length > 0 && (
          <div>
            <button
              onClick={() => setExpandChanges(!expandChanges)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                width: "100%", padding: "4px 10px", fontSize: 10, fontWeight: 600,
                background: "hsl(220 13% 14%)", color: "hsl(220 14% 65%)",
                border: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5,
                borderTop: "1px solid hsl(220 13% 22%)",
                borderBottom: "1px solid hsl(220 13% 22%)",
              }}
            >
              {expandChanges ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Changes ({git.unstagedFiles.length})
              <div className="flex-1" />
              <button
                onClick={(e) => { e.stopPropagation(); git.stageAll(); }}
                title="Stage all"
                style={{ background: "none", border: "none", color: "hsl(142 71% 55%)", cursor: "pointer", padding: 2 }}
              >
                <Plus size={12} />
              </button>
            </button>
            {expandChanges && git.unstagedFiles.map(f => (
              <FileRow
                key={`u-${f.path}`}
                file={f}
                staged={false}
                onStage={() => git.stage([f.path])}
                onDiscard={() => {
                  if (confirm(`Discard changes to ${f.path}?`)) git.discard([f.path]);
                }}
                onView={() => handleViewDiff(f.path, false)}
              />
            ))}
          </div>
        )}

        {/* History */}
        <div>
          <button
            onClick={() => setExpandHistory(!expandHistory)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              width: "100%", padding: "4px 10px", fontSize: 10, fontWeight: 600,
              background: "hsl(220 13% 14%)", color: "hsl(220 14% 65%)",
              border: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5,
              borderTop: "1px solid hsl(220 13% 22%)",
              borderBottom: "1px solid hsl(220 13% 22%)",
            }}
          >
            {expandHistory ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            History ({git.log.length})
          </button>
          {expandHistory && git.log.map(c => (
            <div key={c.oid} style={{
              padding: "4px 10px", fontSize: 10,
              borderBottom: "1px solid hsl(220 13% 16%)",
            }}>
              <div style={{ color: "hsl(220 14% 80%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.message.split("\n")[0]}
              </div>
              <div style={{ color: "hsl(220 14% 45%)", fontSize: 9, marginTop: 2 }}>
                <span style={{ fontFamily: "monospace", color: "hsl(207 90% 60%)" }}>{c.shortOid}</span>
                {" · "}{c.author}{" · "}{new Date(c.timestamp * 1000).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>

        {git.stagedFiles.length === 0 && git.unstagedFiles.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "hsl(220 14% 40%)", fontSize: 11 }}>
            <Check size={20} style={{ display: "block", margin: "0 auto 8px", opacity: 0.5 }} />
            Working tree clean
          </div>
        )}
      </div>

      {/* Diff viewer overlay */}
      {diffView && (
        <DiffViewer
          filePath={diffView.path}
          oldContent={diffView.old}
          newContent={diffView.new}
          onClose={() => setDiffView(null)}
        />
      )}
    </div>
  );
}
