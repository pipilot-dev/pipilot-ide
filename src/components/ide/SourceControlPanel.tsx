import { useState, useEffect, useMemo } from "react";
import {
  GitBranch, GitCommit, RefreshCw, Plus, Minus, Check, ChevronDown, ChevronRight,
  Upload, Download, History, AlertTriangle, ExternalLink, Loader2, FileText, X,
  RotateCcw, MoreHorizontal, Copy, Terminal, Sparkles, Archive, GitMerge,
  GitPullRequest, Cloud, Trash2, Server, ListTree, Eye,
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


interface SourceControlPanelProps {
  onOpenCommit?: (oid: string, shortOid: string) => void;
  onOpenDiff?: (filePath: string, staged: boolean) => void;
}

export function SourceControlPanel({ onOpenCommit, onOpenDiff }: SourceControlPanelProps = {}) {
  const git = useRealGit();
  const [commitMessage, setCommitMessage] = useState("");
  const [expandStaged, setExpandStaged] = useState(true);
  const [expandChanges, setExpandChanges] = useState(true);
  const [expandHistory, setExpandHistory] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);

  // Auto-refresh on visibility (poll every 5s while panel is mounted)
  useEffect(() => {
    if (!git.isRepo) return;
    const interval = setInterval(() => git.refreshStatus(), 5000);
    return () => clearInterval(interval);
  }, [git.isRepo, git.refreshStatus]);

  const handleViewDiff = (path: string, staged: boolean) => {
    onOpenDiff?.(path, staged);
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

  // ── AI commit message generation via a0 LLM ─────────────────────
  const handleGenerateMessage = async () => {
    if (git.stagedFiles.length === 0) {
      setStatusMessage("Stage some files first");
      setTimeout(() => setStatusMessage(null), 2500);
      return;
    }
    setGeneratingMessage(true);
    try {
      // Collect diffs for staged files (cap to keep prompt small)
      const diffs: string[] = [];
      let totalLen = 0;
      const MAX_DIFF_LEN = 8000;
      for (const f of git.stagedFiles) {
        if (totalLen > MAX_DIFF_LEN) break;
        const d = await git.getDiff(f.path, true);
        const slice = (d.diff || "").slice(0, 2000);
        diffs.push(`### ${f.path} (${f.index})\n${slice}`);
        totalLen += slice.length;
      }

      const systemPrompt = `You are a commit message generator. Given a git diff, write ONE concise conventional commit message (subject line under 72 chars, optionally followed by a short body separated by a blank line). Use prefixes like feat, fix, refactor, docs, chore, style, test, perf, build, ci. Output ONLY the commit message — no quotes, no markdown, no explanation.`;

      const userPrompt = `Here are the staged changes:\n\n${diffs.join("\n\n")}\n\nGenerate the commit message.`;

      const res = await fetch("https://api.a0.dev/ai/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!res.ok) throw new Error(`a0 API ${res.status}`);
      const data = await res.json();
      const msg = (data.completion || "").trim()
        .replace(/^["'`]+|["'`]+$/g, "")  // strip surrounding quotes
        .replace(/^```[a-z]*\n?|\n?```$/g, "");  // strip code fences
      if (msg) {
        setCommitMessage(msg);
      } else {
        setStatusMessage("AI returned an empty message");
        setTimeout(() => setStatusMessage(null), 3000);
      }
    } catch (err: any) {
      setStatusMessage(`AI generation failed: ${err.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setGeneratingMessage(false);
    }
  };

  // ── Three-dot menu actions ───────────────────────────────────────
  const runAction = async (label: string, fn: () => Promise<{ success: boolean; message: string }>) => {
    setShowActionMenu(false);
    setBusy(label);
    const result = await fn();
    setBusy(null);
    setStatusMessage(result.success ? `${label} ✓` : `${label} failed: ${result.message.slice(0, 200)}`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const promptAndRun = async (label: string, prompt: string, fn: (input: string) => Promise<{ success: boolean; message: string }>) => {
    setShowActionMenu(false);
    const input = window.prompt(prompt);
    if (input === null || !input.trim()) return;
    await runAction(label, () => fn(input.trim()));
  };

  const handleClickCommit = async (oid: string, shortOid: string) => {
    onOpenCommit?.(oid, shortOid);
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
    const manualCmd = git.installStatus.state === "missing" ? git.installStatus.manualCommand : undefined;
    return (
      <div className="flex flex-col p-4 gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} style={{ color: "hsl(38 92% 60%)" }} />
          <span style={{ fontWeight: 600, fontSize: 12, color: "hsl(220 14% 85%)" }}>Git Not Installed</span>
        </div>
        <p style={{ fontSize: 11, color: "hsl(220 14% 60%)", lineHeight: 1.6 }}>
          Git is required for source control. PiPilot will try to install it via your system's package manager (winget on Windows, Homebrew on macOS, apt/dnf/pacman on Linux).
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

        {/* Manual command — copy to clipboard or run in terminal */}
        {manualCmd && (
          <div style={{
            padding: "8px 10px", borderRadius: 6,
            background: "hsl(220 13% 12%)",
            border: "1px solid hsl(220 13% 25%)",
          }}>
            <div style={{ fontSize: 10, color: "hsl(220 14% 55%)", marginBottom: 4 }}>
              Or run this manually in a terminal:
            </div>
            <code style={{
              display: "block", fontSize: 10, fontFamily: "monospace",
              color: "hsl(207 90% 70%)", padding: "4px 6px",
              background: "hsl(220 13% 8%)", borderRadius: 3, marginBottom: 6,
              wordBreak: "break-all", whiteSpace: "pre-wrap",
            }}>
              {manualCmd}
            </code>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(manualCmd);
                  setStatusMessage("Copied to clipboard");
                  setTimeout(() => setStatusMessage(null), 2000);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 8px", fontSize: 10,
                  background: "hsl(220 13% 20%)", color: "hsl(220 14% 80%)",
                  border: "1px solid hsl(220 13% 28%)", borderRadius: 4, cursor: "pointer",
                }}
              >
                <Copy size={10} />
                Copy
              </button>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("pipilot:run-in-terminal", {
                    detail: { command: manualCmd, label: "install git" },
                  }));
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 8px", fontSize: 10,
                  background: "hsl(207 90% 45%)", color: "#fff",
                  border: "none", borderRadius: 4, cursor: "pointer",
                }}
              >
                <Terminal size={10} />
                Run in terminal
              </button>
            </div>
          </div>
        )}

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
          Download from git-scm.com
        </a>

        {git.lastError && (
          <div style={{
            padding: "6px 8px", fontSize: 10, color: "hsl(0 84% 75%)",
            background: "hsl(0 84% 50% / 0.1)", borderRadius: 4,
            border: "1px solid hsl(0 84% 50% / 0.2)",
            whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto",
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
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowActionMenu(!showActionMenu)}
            title="More git actions"
            style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 4 }}
          >
            <MoreHorizontal size={12} />
          </button>
          {showActionMenu && (
            <>
              {/* Backdrop to close menu */}
              <div
                onClick={() => setShowActionMenu(false)}
                style={{ position: "fixed", inset: 0, zIndex: 50 }}
              />
              <div style={{
                position: "absolute", top: "100%", right: 0, zIndex: 51,
                marginTop: 4, minWidth: 200,
                background: "hsl(220 13% 16%)",
                border: "1px solid hsl(220 13% 28%)",
                borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                padding: 4,
                maxHeight: 400, overflowY: "auto",
              }}>
                {[
                  { label: "Fetch", icon: <Cloud size={11} />, fn: () => git.fetchRemote() },
                  { label: "Pull", icon: <Download size={11} />, fn: () => git.pull() },
                  { label: "Pull (Rebase)", icon: <Download size={11} />, fn: () => git.pullRebase() },
                  { label: "Push", icon: <Upload size={11} />, fn: () => git.push() },
                  { sep: true },
                  { label: "Stage All Changes", icon: <Plus size={11} />, fn: async () => { await git.stageAll(); return { success: true, message: "" }; } },
                  { label: "Unstage All", icon: <Minus size={11} />, fn: async () => { await git.unstage(git.stagedFiles.map(f => f.path)); return { success: true, message: "" }; } },
                  { label: "Discard All Changes", icon: <RotateCcw size={11} />, danger: true, fn: async () => {
                    if (!confirm("Discard ALL unstaged changes? This cannot be undone.")) return { success: false, message: "Cancelled" };
                    await git.discard(git.unstagedFiles.map(f => f.path));
                    return { success: true, message: "" };
                  } },
                  { sep: true },
                  { label: "Stash Changes", icon: <Archive size={11} />, fn: () => git.stash() },
                  { label: "Pop Stash", icon: <Archive size={11} />, fn: () => git.stashPop() },
                  { sep: true },
                  { label: "Merge Branch...", icon: <GitMerge size={11} />, prompt: "Branch name to merge into current:", fn: (name: string) => git.merge(name) },
                  { label: "Cherry-pick Commit...", icon: <GitCommit size={11} />, prompt: "Commit hash to cherry-pick:", fn: (oid: string) => git.cherryPick(oid) },
                  { label: "Delete Branch...", icon: <Trash2 size={11} />, danger: true, prompt: "Branch name to delete:", fn: (name: string) => git.deleteBranch(name, false) },
                  { sep: true },
                  { label: "Reset (soft)", icon: <RotateCcw size={11} />, fn: () => git.reset("soft") },
                  { label: "Reset (mixed)", icon: <RotateCcw size={11} />, fn: () => git.reset("mixed") },
                  { label: "Reset (hard) HEAD", icon: <RotateCcw size={11} />, danger: true, fn: async () => {
                    if (!confirm("Hard reset to HEAD will discard ALL changes. Continue?")) return { success: false, message: "Cancelled" };
                    return git.reset("hard");
                  } },
                  { sep: true },
                  { label: "Add Remote...", icon: <Server size={11} />, prompt: "Remote URL (e.g. https://github.com/user/repo.git):", fn: async (url: string) => {
                    return git.addRemote("origin", url);
                  } },
                  { label: "Refresh Status", icon: <RefreshCw size={11} />, fn: async () => { await git.refreshStatus(); return { success: true, message: "" }; } },
                ].map((item: any, i) => {
                  if (item.sep) return <div key={`sep-${i}`} style={{ height: 1, background: "hsl(220 13% 22%)", margin: "4px 0" }} />;
                  return (
                    <button
                      key={item.label}
                      onClick={() => {
                        if (item.prompt) {
                          promptAndRun(item.label, item.prompt, item.fn);
                        } else {
                          runAction(item.label, item.fn);
                        }
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "5px 8px",
                        fontSize: 11, textAlign: "left",
                        background: "transparent",
                        color: item.danger ? "hsl(0 84% 70%)" : "hsl(220 14% 80%)",
                        border: "none", borderRadius: 4, cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(220 13% 22%)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ flexShrink: 0, color: item.danger ? "hsl(0 84% 65%)" : "hsl(220 14% 55%)" }}>{item.icon}</span>
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
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
        <div style={{ position: "relative" }}>
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
              width: "100%", padding: "6px 28px 6px 8px", fontSize: 11,
              background: "hsl(220 13% 12%)", color: "hsl(220 14% 90%)",
              border: "1px solid hsl(220 13% 25%)", borderRadius: 4,
              resize: "vertical", outline: "none", fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleGenerateMessage}
            disabled={generatingMessage || git.stagedFiles.length === 0}
            title="Generate commit message with AI"
            style={{
              position: "absolute", top: 4, right: 4,
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22,
              background: generatingMessage ? "transparent" : "hsl(280 75% 50% / 0.15)",
              color: git.stagedFiles.length === 0 ? "hsl(220 14% 35%)" : "hsl(280 75% 70%)",
              border: "1px solid " + (git.stagedFiles.length === 0 ? "hsl(220 13% 25%)" : "hsl(280 75% 50% / 0.3)"),
              borderRadius: 4,
              cursor: git.stagedFiles.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {generatingMessage ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          </button>
        </div>
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
            <button
              key={c.oid}
              onClick={() => handleClickCommit(c.oid, c.shortOid)}
              title="Open commit details"
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "4px 10px", fontSize: 10,
                borderBottom: "1px solid hsl(220 13% 16%)",
                background: "transparent", border: "none", borderBottom: "1px solid hsl(220 13% 16%)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(220 13% 16%)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ color: "hsl(220 14% 80%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.message.split("\n")[0]}
              </div>
              <div style={{ color: "hsl(220 14% 45%)", fontSize: 9, marginTop: 2 }}>
                <span style={{ fontFamily: "monospace", color: "hsl(207 90% 60%)" }}>{c.shortOid}</span>
                {" · "}{c.author}{" · "}{new Date(c.timestamp * 1000).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>

        {git.stagedFiles.length === 0 && git.unstagedFiles.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "hsl(220 14% 40%)", fontSize: 11 }}>
            <Check size={20} style={{ display: "block", margin: "0 auto 8px", opacity: 0.5 }} />
            Working tree clean
          </div>
        )}
      </div>

    </div>
  );
}
