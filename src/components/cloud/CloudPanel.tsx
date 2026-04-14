/**
 * CloudPanel — Full-width cloud management panel.
 * Provider dropdown in header. Collapsible sidebar. Full interactive CRUD.
 * Deploy current project to GitHub. Interactive issues/PRs with comments.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Cloud, GitBranch, Globe, Database, Server, ExternalLink,
  RefreshCw, Key, CheckCircle2, Loader2, Plus, Trash2,
  Eye, EyeOff, ChevronDown, GitPullRequest, AlertCircle,
  Clock, MessageSquare, Copy, FolderOpen, Rocket,
  Lock, X, Check, PanelLeftClose, PanelLeft, Send, ArrowLeft,
  GitCommit, GitMerge, Upload,
} from "lucide-react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { COLORS as C, FONTS } from "@/lib/design-tokens";

type Provider = "github" | "vercel" | "supabase" | "neon" | "netlify";

const PROVIDERS: { id: Provider; name: string; icon: React.ReactNode; color: string; tokenUrl: string }[] = [
  { id: "github", name: "GitHub", icon: <GitBranch size={14} />, color: "#f0f6fc", tokenUrl: "github.com/settings/tokens" },
  { id: "vercel", name: "Vercel", icon: <Globe size={14} />, color: "#fff", tokenUrl: "vercel.com/account/tokens" },
  { id: "supabase", name: "Supabase", icon: <Database size={14} />, color: "#3ecf8e", tokenUrl: "supabase.com/dashboard/account/tokens" },
  { id: "neon", name: "Neon", icon: <Database size={14} />, color: "#00e599", tokenUrl: "console.neon.tech/app/settings/api-keys" },
  { id: "netlify", name: "Netlify", icon: <Server size={14} />, color: "#00c7b7", tokenUrl: "app.netlify.com/user/applications#personal-access-tokens" },
];

async function api(url: string, opts?: RequestInit) { return (await fetch(url, opts)).json(); }
async function post(url: string, body: any) { return api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function patch(url: string, body: any) { return api(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function del(url: string, body: any) { return api(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

function timeAgo(d: string): string {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const m = 60_000, h = 3600_000, dy = 86400_000;
  if (diff < m) return "now"; if (diff < h) return `${Math.floor(diff / m)}m`; if (diff < dy) return `${Math.floor(diff / h)}h`;
  if (diff < dy * 30) return `${Math.floor(diff / dy)}d`; return `${Math.floor(diff / (dy * 30))}mo`;
}

function notify(type: string, title: string, message = "") {
  window.dispatchEvent(new CustomEvent("pipilot:notify", { detail: { type, title, message } }));
}

const inputSm: React.CSSProperties = {
  width: "100%", padding: "6px 8px", fontSize: 11, background: "hsl(220 13% 12%)",
  border: "1px solid hsl(220 13% 24%)", borderRadius: 4, color: "#e0e0e0", fontFamily: FONTS.mono, outline: "none",
};
const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", fontSize: 10,
  fontFamily: FONTS.mono, fontWeight: 600, background: C.accent, color: C.bg,
  border: "none", borderRadius: 4, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  ...btnPrimary, background: "transparent", color: C.textMid, border: `1px solid ${C.border}`,
};

export function CloudPanel() {
  const { activeProjectId: pid } = useActiveProject();
  const p = pid || "";
  const [prov, setProv] = useState<Provider>("github");
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [dropdown, setDropdown] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [showTok, setShowTok] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!p) return;
    try { setStatus((await api(`/api/cloud/status?projectId=${encodeURIComponent(p)}`)).providers || {}); } catch {}
  }, [p]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!dropdown) return;
    const h = (e: MouseEvent) => { if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDropdown(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [dropdown]);

  const connected = status[prov];
  const info = PROVIDERS.find((x) => x.id === prov)!;

  const saveTok = async () => {
    if (!p || !tokenInput.trim()) return;
    await post("/api/connectors/save", { projectId: p, connectorId: prov, token: tokenInput.trim(), enabled: true });
    setTokenInput(""); refresh(); notify("success", `${info.name} Connected`);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: FONTS.sans, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        <Cloud size={14} style={{ color: C.accent }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Cloud</span>
        <div style={{ flex: 1 }} />
        <div ref={ddRef} style={{ position: "relative" }}>
          <button onClick={() => setDropdown(!dropdown)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: FONTS.mono, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
            {info.icon} {info.name} {connected && <span style={{ width: 5, height: 5, borderRadius: 5, background: "#22c55e" }} />} <ChevronDown size={9} />
          </button>
          {dropdown && (
            <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 100, minWidth: 170, padding: "4px 0" }}>
              {PROVIDERS.map((x) => (
                <button key={x.id} onClick={() => { setProv(x.id); setDropdown(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: x.id === prov ? C.surfaceAlt : "transparent", border: "none", color: x.id === prov ? C.accent : C.textMid, fontFamily: FONTS.mono, fontSize: 10, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; }} onMouseLeave={(e) => { if (x.id !== prov) e.currentTarget.style.background = "transparent"; }}>
                  {x.icon} {x.name} {status[x.id] && <CheckCircle2 size={9} color="#22c55e" style={{ marginLeft: "auto" }} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={refresh} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 3, display: "flex" }}><RefreshCw size={12} /></button>
      </div>

      {/* Content — scrollable */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!connected ? (
          <div style={{ maxWidth: 400, margin: "50px auto", textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: `${C.accent}12`, border: `1px solid ${C.accent}25`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", color: C.accent }}><Key size={20} /></div>
            <h2 style={{ fontFamily: FONTS.display, fontSize: 18, fontWeight: 400, margin: "0 0 6px" }}>Connect {info.name}</h2>
            <p style={{ fontSize: 11, color: C.textDim, margin: "0 0 16px" }}>Paste your API token to manage resources.</p>
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input type={showTok ? "text" : "password"} value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveTok(); }} placeholder="API token" style={{ ...inputSm, padding: "8px 30px 8px 10px" }} />
                <button onClick={() => setShowTok(!showTok)} style={{ position: "absolute", right: 6, top: 7, background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 0 }}>{showTok ? <EyeOff size={12} /> : <Eye size={12} />}</button>
              </div>
              <button onClick={saveTok} disabled={!tokenInput.trim()} style={{ ...btnPrimary, opacity: tokenInput.trim() ? 1 : 0.4 }}>Connect</button>
            </div>
            <a href={`https://${info.tokenUrl}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 10, fontSize: 9, color: C.accent, textDecoration: "none" }}>Get token <ExternalLink size={8} /></a>
          </div>
        ) : (
          <>
            {prov === "github" && <GitHubView pid={p} />}
            {prov === "vercel" && <VercelView pid={p} />}
            {prov === "supabase" && <SimpleListView pid={p} provider="supabase" endpoint="supabase/projects" icon={<Database size={14} />} title="Projects" urlFn={(p: any) => `https://supabase.com/dashboard/project/${p.ref || p.id}`} badgeFn={(p: any) => [{ label: p.status === "ACTIVE_HEALTHY" ? "Healthy" : p.status || "?", color: p.status === "ACTIVE_HEALTHY" ? "#22c55e" : "#f59e0b" }]} />}
            {prov === "neon" && <SimpleListView pid={p} provider="neon" endpoint="neon/projects" dataKey="projects" icon={<Database size={14} />} title="Projects" urlFn={(p: any) => `https://console.neon.tech/app/projects/${p.id}`} badgeFn={(p: any) => [{ label: `PG ${p.pg_version || "?"}`, color: "#818cf8" }]} />}
            {prov === "netlify" && <SimpleListView pid={p} provider="netlify" endpoint="netlify/sites" icon={<Server size={14} />} title="Sites" urlFn={(s: any) => s.admin_url} badgeFn={(s: any) => [s.published_deploy?.branch && { label: s.published_deploy.branch, color: "#818cf8" }].filter(Boolean) as any} />}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GitHub View — Full interactive workflow
// ═══════════════════════════════════════════════════════════════
function GitHubView({ pid }: { pid: string }) {
  const [repos, setRepos] = useState<any[]>([]);
  const [repo, setRepo] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"issues" | "pulls" | "actions" | "commits">("issues");
  const [issues, setIssues] = useState<any[]>([]);
  const [pulls, setPulls] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [detail, setDetail] = useState<{ type: "issue" | "pr"; data: any; comments: any[] } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: "", description: "", private: false });
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [newIssue, setNewIssue] = useState({ title: "", body: "" });
  const [showNewPR, setShowNewPR] = useState(false);
  const [newPR, setNewPR] = useState({ title: "", body: "", head: "", base: "main" });
  const [branches, setBranches] = useState<string[]>([]);
  const [showDeploy, setShowDeploy] = useState(false);

  const q = `projectId=${encodeURIComponent(pid)}`;
  const fetchRepos = useCallback(async () => { setLoading(true); try { const d = await api(`/api/cloud/github/repos?${q}`); setRepos(Array.isArray(d) ? d : []); } catch {} finally { setLoading(false); } }, [q]);
  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  const selectRepo = async (r: any) => {
    setRepo(r); setDetail(null);
    const [o, n] = (r.full_name || "").split("/");
    const rq = `${q}&owner=${o}&repo=${n}`;
    try {
      const [i, p, a, c, b] = await Promise.all([
        api(`/api/cloud/github/issues?${rq}`), api(`/api/cloud/github/pulls?${rq}`),
        api(`/api/cloud/github/actions?${rq}`), api(`/api/cloud/github/commits?${rq}&per_page=15`),
        api(`/api/cloud/github/branches?${rq}`),
      ]);
      setIssues(Array.isArray(i) ? i.filter((x: any) => !x.pull_request) : []);
      setPulls(Array.isArray(p) ? p : []);
      setActions(a?.workflow_runs || []);
      setCommits(Array.isArray(c) ? c : []);
      setBranches(Array.isArray(b) ? b.map((x: any) => x.name) : []);
    } catch {}
  };

  const [o, n] = (repo?.full_name || "/").split("/");

  const openDetail = async (type: "issue" | "pr", item: any) => {
    const num = item.number;
    const endpoint = type === "issue" ? "issues" : "issues"; // GitHub uses same endpoint for both
    try {
      const comments = await api(`/api/cloud/github/issues/comments?${q}&owner=${o}&repo=${n}&issue_number=${num}`);
      setDetail({ type, data: item, comments: Array.isArray(comments) ? comments : [] });
    } catch {
      setDetail({ type, data: item, comments: [] });
    }
  };

  const addComment = async () => {
    if (!detail || !commentText.trim()) return;
    await post("/api/cloud/github/issues/comment", { projectId: pid, owner: o, repo: n, issue_number: detail.data.number, body: commentText });
    setCommentText("");
    openDetail(detail.type, detail.data);
    notify("success", "Comment added");
  };

  const closeIssue = async (num: number) => {
    await patch("/api/cloud/github/issues", { projectId: pid, owner: o, repo: n, issue_number: num, state: "closed" });
    selectRepo(repo); setDetail(null); notify("info", "Issue closed");
  };

  const mergePR = async (num: number) => {
    await post("/api/cloud/github/pulls/merge", { projectId: pid, owner: o, repo: n, pull_number: num });
    selectRepo(repo); setDetail(null); notify("success", "PR merged");
  };

  const createRepo = async () => {
    if (!newRepo.name) return;
    await post("/api/cloud/github/repos", { projectId: pid, ...newRepo });
    setShowCreate(false); setNewRepo({ name: "", description: "", private: false }); fetchRepos(); notify("success", "Repo created", newRepo.name);
  };

  const createIssue = async () => {
    if (!newIssue.title) return;
    await post("/api/cloud/github/issues", { projectId: pid, owner: o, repo: n, ...newIssue });
    setShowNewIssue(false); setNewIssue({ title: "", body: "" }); selectRepo(repo); notify("success", "Issue created");
  };

  const createPR = async () => {
    if (!newPR.title || !newPR.head) return;
    await post("/api/cloud/github/pulls", { projectId: pid, owner: o, repo: n, ...newPR });
    setShowNewPR(false); setNewPR({ title: "", body: "", head: "", base: "main" }); selectRepo(repo); notify("success", "PR created");
  };

  // ── Interactive Deploy Wizard ──
  const [deployStep, setDeployStep] = useState(0); // 0=check, 1=commit, 2=remote, 3=pushing, 4=done
  const [gitStatus, setGitStatus] = useState<any>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [deployRepoName, setDeployRepoName] = useState("");
  const [deployPrivate, setDeployPrivate] = useState(false);
  const [deployMode, setDeployMode] = useState<"new" | "existing">("new");
  const [deployExistingRepo, setDeployExistingRepo] = useState("");
  const [deployError, setDeployError] = useState("");
  const [deployUrl, setDeployUrl] = useState("");

  const startDeploy = async () => {
    setShowDeploy(true); setDeployStep(0); setDeployError(""); setDeployUrl("");
    try {
      const s = await api(`/api/cloud/github/git-status?projectId=${encodeURIComponent(pid)}`);
      setGitStatus(s);
      if (!s.isRepo) {
        // Auto-init git
        await post("/api/cloud/github/git-init", { projectId: pid });
        const s2 = await api(`/api/cloud/github/git-status?projectId=${encodeURIComponent(pid)}`);
        setGitStatus(s2);
      }
      setDeployStep(1); // go to commit step
    } catch (e: any) { setDeployError(e.message); }
  };

  const deployCommit = async () => {
    if (!commitMsg.trim()) return;
    setDeployError("");
    try {
      await post("/api/cloud/github/git-commit", { projectId: pid, message: commitMsg });
      const s = await api(`/api/cloud/github/git-status?projectId=${encodeURIComponent(pid)}`);
      setGitStatus(s);
      setDeployStep(2); // go to remote step
    } catch (e: any) { setDeployError(e.message || "Commit failed"); }
  };

  const deployPush = async () => {
    setDeployStep(3); setDeployError("");
    try {
      // Get GitHub user for repo URL
      const user = await api(`/api/cloud/github/user?projectId=${encodeURIComponent(pid)}`);
      const username = user?.login;
      if (!username) throw new Error("Could not get GitHub username");

      let repoUrl = "";
      if (deployMode === "new") {
        // Create repo first
        const created = await post("/api/cloud/github/repos", { projectId: pid, name: deployRepoName || "my-project", description: "", private: deployPrivate });
        if (created?.html_url) repoUrl = created.html_url;
        else if (created?.full_name) repoUrl = `https://github.com/${created.full_name}`;
        else repoUrl = `https://github.com/${username}/${deployRepoName}`;
      } else {
        repoUrl = `https://github.com/${deployExistingRepo}`;
      }

      // Add remote if not exists
      const gitUrl = repoUrl.replace("https://github.com/", "https://github.com/") + ".git";
      if (!gitStatus?.remotes?.length) {
        await post("/api/cloud/github/git-add-remote", { projectId: pid, name: "origin", url: gitUrl });
      }

      // Push
      const branch = gitStatus?.branch || "main";
      await post("/api/cloud/github/git-push", { projectId: pid, remote: "origin", branch });
      setDeployUrl(repoUrl);
      setDeployStep(4); // done
      fetchRepos(); // refresh repo list
      notify("success", "Deployed to GitHub!", repoUrl);
    } catch (e: any) { setDeployError(e.message || "Push failed"); setDeployStep(2); }
  };

  const ts = (a: boolean): React.CSSProperties => ({ padding: "5px 10px", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: FONTS.mono, color: a ? C.accent : C.textDim, background: "transparent", borderBottom: a ? `2px solid ${C.accent}` : "2px solid transparent" });

  // ── Detail view (issue/PR with comments) ──
  if (detail) {
    const d = detail.data;
    const isPR = detail.type === "pr";
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setDetail(null)} style={{ ...btnGhost, padding: "3px 8px" }}><ArrowLeft size={12} /> Back</button>
          {isPR ? <GitPullRequest size={14} style={{ color: "#22c55e" }} /> : <AlertCircle size={14} style={{ color: d.state === "open" ? "#22c55e" : "#ef4444" }} />}
          <span style={{ fontWeight: 600, fontSize: 13 }}>#{d.number} {d.title}</span>
          <div style={{ flex: 1 }} />
          {d.state === "open" && !isPR && <button onClick={() => closeIssue(d.number)} style={{ ...btnGhost, padding: "3px 8px", color: "#ef4444", borderColor: "#ef444440" }}>Close Issue</button>}
          {isPR && d.state === "open" && <button onClick={() => mergePR(d.number)} style={{ ...btnPrimary, padding: "4px 12px", background: "#22c55e" }}><GitMerge size={10} /> Merge</button>}
          <button onClick={() => window.open(d.html_url, "_blank")} style={{ ...btnGhost, padding: "3px 8px" }}><ExternalLink size={10} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
          {/* Body */}
          <div style={{ padding: "12px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 12, fontSize: 12, lineHeight: 1.6, color: C.textMid, whiteSpace: "pre-wrap" }}>
            <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, marginBottom: 6 }}>{d.user?.login} · {timeAgo(d.created_at)}</div>
            {d.body || <em style={{ color: C.textDim }}>No description</em>}
          </div>
          {isPR && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: "hsl(220 13% 18%)", color: C.textMid, fontFamily: FONTS.mono }}>{d.head?.ref} → {d.base?.ref}</span>
              <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: "hsl(220 13% 18%)", color: C.textDim, fontFamily: FONTS.mono }}>+{d.additions || "?"} -{d.deletions || "?"}</span>
            </div>
          )}
          {/* Comments */}
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: C.textDim, marginBottom: 8, letterSpacing: "0.04em", textTransform: "uppercase" }}>Comments ({detail.comments.length})</div>
          {detail.comments.map((c: any) => (
            <div key={c.id} style={{ padding: "10px 12px", marginBottom: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, lineHeight: 1.5, color: C.textMid, whiteSpace: "pre-wrap" }}>
              <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, marginBottom: 4 }}>{c.user?.login} · {timeAgo(c.created_at)}</div>
              {c.body}
            </div>
          ))}
          {/* Add comment */}
          <div style={{ marginTop: 8 }}>
            <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Write a comment..." rows={3}
              style={{ ...inputSm, resize: "vertical", fontSize: 12, lineHeight: 1.5 }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addComment(); }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
              <button onClick={addComment} disabled={!commentText.trim()} style={{ ...btnPrimary, opacity: commentText.trim() ? 1 : 0.4 }}><Send size={10} /> Comment</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ──
  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{ width: 240, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600, color: C.text, flex: 1 }}>REPOS ({repos.length})</span>
            <button onClick={() => { if (showDeploy) setShowDeploy(false); else startDeploy(); }} title="Deploy current project" style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", padding: 2, display: "flex" }}><Upload size={11} /></button>
            <button onClick={() => setShowCreate(!showCreate)} title="New repo" style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", padding: 2, display: "flex" }}><Plus size={11} /></button>
            <button onClick={() => setSidebarOpen(false)} title="Collapse" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, display: "flex" }}><PanelLeftClose size={11} /></button>
          </div>

          {showDeploy && (
            <div style={{ padding: 10, borderBottom: `1px solid ${C.border}`, background: `${C.accent}06` }}>
              {/* Step indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
                {["Check", "Commit", "Remote", "Push", "Done"].map((label, i) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: 16, fontSize: 8, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: deployStep > i ? "#22c55e" : deployStep === i ? C.accent : "hsl(220 13% 22%)",
                      color: deployStep >= i ? C.bg : C.textDim,
                    }}>{deployStep > i ? "✓" : i + 1}</div>
                    {i < 4 && <div style={{ width: 12, height: 1, background: deployStep > i ? "#22c55e" : "hsl(220 13% 25%)" }} />}
                  </div>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowDeploy(false)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 0 }}><X size={12} /></button>
              </div>

              {deployError && <div style={{ padding: "4px 8px", marginBottom: 6, fontSize: 9, color: "#ff9b9b", background: "#ff6b6b12", border: "1px solid #ff6b6b33", borderRadius: 3 }}>{deployError}</div>}

              {/* Step 0: Checking */}
              {deployStep === 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.textDim, fontSize: 10 }}>
                  <Loader2 size={12} className="animate-spin" /> Checking project state...
                </div>
              )}

              {/* Step 1: Commit */}
              {deployStep === 1 && (
                <div>
                  <div style={{ fontSize: 9, color: C.accent, fontWeight: 600, marginBottom: 4 }}>
                    {gitStatus?.hasUncommittedChanges ? `${gitStatus.changedFiles} files changed` : "No uncommitted changes"}
                  </div>
                  {gitStatus?.hasUncommittedChanges ? (
                    <>
                      <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message..." style={inputSm}
                        onKeyDown={(e) => { if (e.key === "Enter") deployCommit(); }} autoFocus />
                      <button onClick={deployCommit} disabled={!commitMsg.trim()} style={{ ...btnPrimary, marginTop: 4, padding: "4px 10px", fontSize: 9, opacity: commitMsg.trim() ? 1 : 0.4 }}>
                        <GitCommit size={9} /> Commit & Continue
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setDeployStep(2)} style={{ ...btnPrimary, padding: "4px 10px", fontSize: 9 }}>
                      Continue → Remote
                    </button>
                  )}
                </div>
              )}

              {/* Step 2: Choose remote */}
              {deployStep === 2 && (
                <div>
                  <div style={{ fontSize: 9, color: C.accent, fontWeight: 600, marginBottom: 6 }}>Choose destination</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.textMid, cursor: "pointer" }}>
                      <input type="radio" checked={deployMode === "new"} onChange={() => setDeployMode("new")} /> Create new repository
                    </label>
                    {deployMode === "new" && (
                      <div style={{ display: "flex", gap: 4, marginLeft: 16 }}>
                        <input value={deployRepoName} onChange={(e) => setDeployRepoName(e.target.value)} placeholder="repo-name" style={{ ...inputSm, flex: 1 }} />
                        <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8, color: C.textDim, cursor: "pointer", whiteSpace: "nowrap" }}>
                          <input type="checkbox" checked={deployPrivate} onChange={(e) => setDeployPrivate(e.target.checked)} /> Private
                        </label>
                      </div>
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.textMid, cursor: "pointer" }}>
                      <input type="radio" checked={deployMode === "existing"} onChange={() => setDeployMode("existing")} /> Push to existing
                    </label>
                    {deployMode === "existing" && (
                      <select value={deployExistingRepo} onChange={(e) => setDeployExistingRepo(e.target.value)} style={{ ...inputSm, marginLeft: 16 }}>
                        <option value="">Select repo...</option>
                        {repos.map((r: any) => <option key={r.id} value={r.full_name}>{r.full_name}</option>)}
                      </select>
                    )}
                  </div>
                  <button onClick={deployPush} disabled={(deployMode === "new" && !deployRepoName) || (deployMode === "existing" && !deployExistingRepo)}
                    style={{ ...btnPrimary, marginTop: 6, padding: "4px 10px", fontSize: 9, opacity: ((deployMode === "new" && deployRepoName) || (deployMode === "existing" && deployExistingRepo)) ? 1 : 0.4 }}>
                    <Rocket size={9} /> Deploy
                  </button>
                </div>
              )}

              {/* Step 3: Pushing */}
              {deployStep === 3 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.accent, fontSize: 10 }}>
                  <Loader2 size={12} className="animate-spin" /> Pushing to GitHub...
                </div>
              )}

              {/* Step 4: Done */}
              {deployStep === 4 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#22c55e", fontSize: 10, fontWeight: 600, marginBottom: 4 }}>
                    <CheckCircle2 size={12} /> Deployed successfully!
                  </div>
                  {deployUrl && (
                    <a href={deployUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, color: C.accent, textDecoration: "none" }}>
                      {deployUrl} <ExternalLink size={8} />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {showCreate && (
            <div style={{ padding: 8, borderBottom: `1px solid ${C.border}`, background: C.surfaceAlt }}>
              <input value={newRepo.name} onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })} placeholder="repo-name" style={inputSm} />
              <input value={newRepo.description} onChange={(e) => setNewRepo({ ...newRepo, description: e.target.value })} placeholder="Description" style={{ ...inputSm, marginTop: 3 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: C.textDim, cursor: "pointer" }}>
                  <input type="checkbox" checked={newRepo.private} onChange={(e) => setNewRepo({ ...newRepo, private: e.target.checked })} /> Private
                </label>
                <div style={{ flex: 1 }} />
                <button onClick={createRepo} disabled={!newRepo.name} style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}>Create</button>
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {repos.map((r: any) => (
              <button key={r.id} onClick={() => selectRepo(r)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 5, padding: "6px 8px",
                background: repo?.id === r.id ? C.surfaceAlt : "transparent", border: "none",
                color: repo?.id === r.id ? C.text : C.textMid, fontFamily: FONTS.sans, fontSize: 10,
                cursor: "pointer", textAlign: "left", borderBottom: `1px solid ${C.border}`,
              }}>
                {r.private ? <Lock size={9} style={{ color: "#f59e0b", flexShrink: 0 }} /> : <FolderOpen size={9} style={{ color: C.textDim, flexShrink: 0 }} />}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                {r.language && <span style={{ fontSize: 7, color: C.textDim, fontFamily: FONTS.mono }}>{r.language}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Edge toggle when sidebar collapsed */}
      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)} title="Show repos" style={{
          width: 20, display: "flex", alignItems: "center", justifyContent: "center",
          background: C.surface, border: "none", borderRight: `1px solid ${C.border}`,
          color: C.textDim, cursor: "pointer", flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; e.currentTarget.style.background = C.surfaceAlt; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; e.currentTarget.style.background = C.surface; }}
        >
          <ChevronDown size={12} style={{ transform: "rotate(-90deg)" }} />
        </button>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!repo ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: C.textDim }}>
            <span style={{ fontSize: 11 }}>Select a repository to manage</span>
          </div>
        ) : (
          <>
            {/* Repo header */}
            <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, display: "flex" }}><PanelLeft size={12} /></button>}
              <GitBranch size={12} style={{ color: C.accent }} />
              <span style={{ fontWeight: 600, fontSize: 12 }}>{repo.full_name}</span>
              <span style={{ fontSize: 9, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{repo.description || ""}</span>
              <button onClick={() => window.open(repo.html_url, "_blank")} style={btnGhost}><ExternalLink size={9} /> Open</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}`, padding: "0 10px", flexShrink: 0 }}>
              <button style={ts(tab === "issues")} onClick={() => setTab("issues")}>Issues ({issues.length})</button>
              <button style={ts(tab === "pulls")} onClick={() => setTab("pulls")}>PRs ({pulls.length})</button>
              <button style={ts(tab === "commits")} onClick={() => setTab("commits")}>Commits</button>
              <button style={ts(tab === "actions")} onClick={() => setTab("actions")}>Actions</button>
              <div style={{ flex: 1 }} />
              {tab === "issues" && <button onClick={() => setShowNewIssue(!showNewIssue)} style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}><Plus size={9} /> Issue</button>}
              {tab === "pulls" && <button onClick={() => { setShowNewPR(!showNewPR); setNewPR({ ...newPR, base: "main" }); }} style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}><Plus size={9} /> PR</button>}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10 }}>
              {/* New issue form */}
              {tab === "issues" && showNewIssue && (
                <div style={{ padding: 10, marginBottom: 8, background: C.surfaceAlt, borderRadius: 5, border: `1px solid ${C.border}` }}>
                  <input value={newIssue.title} onChange={(e) => setNewIssue({ ...newIssue, title: e.target.value })} placeholder="Issue title" style={inputSm} />
                  <textarea value={newIssue.body} onChange={(e) => setNewIssue({ ...newIssue, body: e.target.value })} placeholder="Description (markdown)" rows={3} style={{ ...inputSm, marginTop: 4, resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}><button onClick={createIssue} disabled={!newIssue.title} style={btnPrimary}>Submit</button><button onClick={() => setShowNewIssue(false)} style={btnGhost}>Cancel</button></div>
                </div>
              )}

              {/* New PR form */}
              {tab === "pulls" && showNewPR && (
                <div style={{ padding: 10, marginBottom: 8, background: C.surfaceAlt, borderRadius: 5, border: `1px solid ${C.border}` }}>
                  <input value={newPR.title} onChange={(e) => setNewPR({ ...newPR, title: e.target.value })} placeholder="PR title" style={inputSm} />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <select value={newPR.head} onChange={(e) => setNewPR({ ...newPR, head: e.target.value })} style={{ ...inputSm, flex: 1 }}>
                      <option value="">Head branch...</option>
                      {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <span style={{ color: C.textDim, fontSize: 10, alignSelf: "center" }}>→</span>
                    <select value={newPR.base} onChange={(e) => setNewPR({ ...newPR, base: e.target.value })} style={{ ...inputSm, flex: 1 }}>
                      {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <textarea value={newPR.body} onChange={(e) => setNewPR({ ...newPR, body: e.target.value })} placeholder="Description" rows={2} style={{ ...inputSm, marginTop: 4, resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}><button onClick={createPR} disabled={!newPR.title || !newPR.head} style={btnPrimary}>Create PR</button><button onClick={() => setShowNewPR(false)} style={btnGhost}>Cancel</button></div>
                </div>
              )}

              {/* Issues list */}
              {tab === "issues" && issues.map((i: any) => (
                <button key={i.id} onClick={() => openDetail("issue", i)} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", marginBottom: 3, borderRadius: 5, background: C.surface, border: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHover; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}>
                  <AlertCircle size={11} style={{ color: "#22c55e", marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{i.title}</div>
                    <div style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono, marginTop: 2 }}>#{i.number} · {i.user?.login} · {timeAgo(i.created_at)} {i.comments > 0 && `· 💬${i.comments}`}</div>
                  </div>
                  {i.labels?.slice(0, 2).map((l: any) => <span key={l.id} style={{ fontSize: 7, padding: "1px 4px", borderRadius: 8, background: `#${l.color}30`, color: `#${l.color}`, fontFamily: FONTS.mono }}>{l.name}</span>)}
                </button>
              ))}

              {/* PRs list */}
              {tab === "pulls" && pulls.map((pr: any) => (
                <button key={pr.id} onClick={() => openDetail("pr", pr)} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", marginBottom: 3, borderRadius: 5, background: C.surface, border: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHover; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}>
                  <GitPullRequest size={11} style={{ color: pr.draft ? C.textDim : "#22c55e", marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{pr.title}</div>
                    <div style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono, marginTop: 2 }}>#{pr.number} · {pr.head?.ref} → {pr.base?.ref} · {timeAgo(pr.created_at)}</div>
                  </div>
                  {pr.draft && <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, background: "hsl(220 13% 22%)", color: C.textDim, fontFamily: FONTS.mono }}>Draft</span>}
                </button>
              ))}

              {/* Commits list */}
              {tab === "commits" && commits.map((c: any) => (
                <div key={c.sha} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}` }}>
                  <GitCommit size={10} style={{ color: C.textDim, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.commit?.message?.split("\n")[0]}</div>
                    <div style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono }}>{c.sha?.slice(0, 7)} · {c.commit?.author?.name} · {timeAgo(c.commit?.author?.date)}</div>
                  </div>
                </div>
              ))}

              {/* Actions list */}
              {tab === "actions" && actions.map((r: any) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}` }}>
                  {r.conclusion === "success" ? <CheckCircle2 size={11} color="#22c55e" /> : r.conclusion === "failure" ? <X size={11} color="#ef4444" /> : <Clock size={11} style={{ color: "#f59e0b" }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text }}>{r.name}</div>
                    <div style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono }}>{r.head_branch} · {r.event} · {timeAgo(r.created_at)}</div>
                  </div>
                  <span style={{ fontSize: 7, padding: "2px 5px", borderRadius: 3, background: r.conclusion === "success" ? "#22c55e18" : r.conclusion === "failure" ? "#ef444418" : "#f59e0b18", color: r.conclusion === "success" ? "#22c55e" : r.conclusion === "failure" ? "#ef4444" : "#f59e0b", fontFamily: FONTS.mono }}>{r.conclusion || r.status}</span>
                </div>
              ))}

              {/* Empty states */}
              {tab === "issues" && issues.length === 0 && !showNewIssue && <Empty msg="No open issues" />}
              {tab === "pulls" && pulls.length === 0 && !showNewPR && <Empty msg="No open pull requests" />}
              {tab === "commits" && commits.length === 0 && <Empty msg="No commits" />}
              {tab === "actions" && actions.length === 0 && <Empty msg="No workflow runs" />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Vercel View
// ═══════════════════════════════════════════════════════════════
function VercelView({ pid }: { pid: string }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [proj, setProj] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab, setTab] = useState<"deployments" | "env" | "domains">("deployments");
  const [deployments, setDeployments] = useState<any[]>([]);
  const [envVars, setEnvVars] = useState<any[]>([]);
  const [domains, setDomains] = useState<any[]>([]);
  const [showNewEnv, setShowNewEnv] = useState(false);
  const [newEnv, setNewEnv] = useState({ key: "", value: "", target: "production" });
  const q = `projectId=${encodeURIComponent(pid)}`;

  useEffect(() => { api(`/api/cloud/vercel/projects?${q}`).then((d) => setProjects(d?.projects || [])); }, [q]);

  const selectProj = async (p: any) => {
    setProj(p);
    const pq = `${q}&vercelProjectId=${p.id}`;
    const [d, e, dm] = await Promise.all([api(`/api/cloud/vercel/deployments?${pq}`), api(`/api/cloud/vercel/env?${pq}`), api(`/api/cloud/vercel/domains?${pq}`)]);
    setDeployments(d?.deployments || []); setEnvVars(e?.envs || []); setDomains(dm?.domains || []);
  };

  const addEnv = async () => {
    if (!proj || !newEnv.key) return;
    await post("/api/cloud/vercel/env", { projectId: pid, vercelProjectId: proj.id, ...newEnv });
    setShowNewEnv(false); setNewEnv({ key: "", value: "", target: "production" }); selectProj(proj); notify("success", "Env var added");
  };

  const ts = (a: boolean): React.CSSProperties => ({ padding: "5px 10px", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: FONTS.mono, color: a ? C.accent : C.textDim, background: "transparent", borderBottom: a ? `2px solid ${C.accent}` : "2px solid transparent" });

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {sidebarOpen && (
        <div style={{ width: 220, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600, color: C.text, flex: 1 }}>PROJECTS ({projects.length})</span>
            <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, display: "flex" }}><PanelLeftClose size={11} /></button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {projects.map((p: any) => (
              <button key={p.id} onClick={() => selectProj(p)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", background: proj?.id === p.id ? C.surfaceAlt : "transparent", border: "none", color: proj?.id === p.id ? C.text : C.textMid, fontFamily: FONTS.sans, fontSize: 10, cursor: "pointer", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>
                <Rocket size={9} style={{ color: C.textDim, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)} title="Show projects" style={{
          width: 20, display: "flex", alignItems: "center", justifyContent: "center",
          background: C.surface, border: "none", borderRight: `1px solid ${C.border}`,
          color: C.textDim, cursor: "pointer", flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; e.currentTarget.style.background = C.surfaceAlt; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; e.currentTarget.style.background = C.surface; }}
        >
          <ChevronDown size={12} style={{ transform: "rotate(-90deg)" }} />
        </button>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!proj ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: C.textDim }}>
            <span style={{ fontSize: 11 }}>Select a project</span>
          </div>
        ) : (
          <>
            <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, display: "flex" }}><PanelLeft size={12} /></button>}
              <Rocket size={12} style={{ color: C.accent }} />
              <span style={{ fontWeight: 600, fontSize: 12 }}>{proj.name}</span>
              <span style={{ fontSize: 9, color: C.textDim }}>{proj.framework || ""}</span>
            </div>
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, padding: "0 10px", flexShrink: 0 }}>
              <button style={ts(tab === "deployments")} onClick={() => setTab("deployments")}>Deployments ({deployments.length})</button>
              <button style={ts(tab === "env")} onClick={() => setTab("env")}>Env ({envVars.length})</button>
              <button style={ts(tab === "domains")} onClick={() => setTab("domains")}>Domains</button>
              <div style={{ flex: 1 }} />
              {tab === "env" && <button onClick={() => setShowNewEnv(!showNewEnv)} style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}><Plus size={9} /> Add</button>}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10 }}>
              {tab === "env" && showNewEnv && (
                <div style={{ padding: 10, marginBottom: 8, background: C.surfaceAlt, borderRadius: 5, border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={newEnv.key} onChange={(e) => setNewEnv({ ...newEnv, key: e.target.value })} placeholder="KEY" style={{ ...inputSm, flex: 1 }} />
                    <input value={newEnv.value} onChange={(e) => setNewEnv({ ...newEnv, value: e.target.value })} placeholder="value" style={{ ...inputSm, flex: 2 }} />
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <select value={newEnv.target} onChange={(e) => setNewEnv({ ...newEnv, target: e.target.value })} style={{ ...inputSm, flex: 1 }}>
                      <option value="production">Production</option><option value="preview">Preview</option><option value="development">Development</option>
                    </select>
                    <button onClick={addEnv} disabled={!newEnv.key} style={btnPrimary}>Add</button>
                  </div>
                </div>
              )}
              {tab === "deployments" && deployments.map((d: any) => (
                <div key={d.uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", marginBottom: 3, borderRadius: 5, background: C.surface, border: `1px solid ${C.border}` }}>
                  {d.state === "READY" ? <CheckCircle2 size={11} color="#22c55e" /> : d.state === "ERROR" ? <X size={11} color="#ef4444" /> : <Loader2 size={11} className="animate-spin" style={{ color: "#f59e0b" }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.meta?.githubCommitMessage?.split("\n")[0] || d.url || "Deploy"}</div>
                    <div style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono }}>{d.state} · {timeAgo(new Date(d.created).toISOString())}</div>
                  </div>
                  {d.url && <button onClick={() => window.open(`https://${d.url}`, "_blank")} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer" }}><ExternalLink size={9} /></button>}
                </div>
              ))}
              {tab === "env" && !showNewEnv && envVars.map((v: any) => (
                <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}` }}>
                  <Key size={9} style={{ color: C.textDim }} />
                  <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.text, flex: 1 }}>{v.key}</span>
                  <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: "hsl(220 13% 20%)", color: C.textDim, fontFamily: FONTS.mono }}>{v.target?.join(",") || "all"}</span>
                </div>
              ))}
              {tab === "domains" && domains.map((d: any) => (
                <div key={d.name || d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}` }}>
                  <Globe size={9} style={{ color: C.accent }} />
                  <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.text }}>{d.name || d.apexName || d}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Simple List View (Supabase, Neon, Netlify)
// ═══════════════════════════════════════════════════════════════
function SimpleListView({ pid, provider, endpoint, dataKey, icon, title, urlFn, badgeFn }: {
  pid: string; provider: string; endpoint: string; dataKey?: string;
  icon: React.ReactNode; title: string;
  urlFn: (item: any) => string; badgeFn: (item: any) => { label: string; color: string }[];
}) {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    api(`/api/cloud/${endpoint}?projectId=${encodeURIComponent(pid)}`).then((d) => {
      const arr = dataKey ? d?.[dataKey] : d;
      setItems(Array.isArray(arr) ? arr : []);
    });
  }, [pid, endpoint, dataKey]);

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontFamily: FONTS.mono, fontSize: 11, fontWeight: 600, color: C.text }}>
        <span style={{ color: C.accent }}>{icon}</span> {title} <span style={{ color: C.textDim, fontWeight: 400 }}>({items.length})</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
        {items.map((item: any, i: number) => (
          <div key={item.id || i} onClick={() => { const u = urlFn(item); if (u) window.open(u, "_blank"); }} style={{ padding: "12px 14px", borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, cursor: "pointer", transition: "border-color 0.15s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.name}</span>
              <ExternalLink size={9} style={{ color: C.textDim }} />
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.region || item.region_id || item.ssl_url || item.url || item.ref || ""}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {badgeFn(item).map((b: any, j: number) => b && (
                <span key={j} style={{ fontSize: 7, padding: "2px 5px", borderRadius: 3, background: `${b.color}18`, color: b.color, fontFamily: FONTS.mono, fontWeight: 600 }}>{b.label}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 && <Empty msg={`No ${title.toLowerCase()} found`} />}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: "30px 16px", textAlign: "center", color: C.textDim, fontSize: 11 }}>{msg}</div>;
}
