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
  Clock, MessageSquare, Copy, FolderOpen, Rocket, Settings,
  Lock, X, Check, PanelLeftClose, PanelLeft, Send, ArrowLeft,
  GitCommit, GitMerge, Upload,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
            {prov === "supabase" && <SupabaseView pid={p} />}
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
  const [tab, setTab] = useState<"issues" | "pulls" | "actions" | "commits" | "branches">("issues");
  const [issues, setIssues] = useState<any[]>([]);
  const [pulls, setPulls] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [detail, setDetail] = useState<{ type: "issue" | "pr" | "commit"; data: any; comments: any[] } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newRepo, setNewRepo] = useState({ name: "", description: "", private: false });
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [newIssue, setNewIssue] = useState({ title: "", body: "" });
  const [showNewPR, setShowNewPR] = useState(false);
  const [newPR, setNewPR] = useState({ title: "", body: "", head: "", base: "main" });
  const [branches, setBranches] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [showDeploy, setShowDeploy] = useState(false);

  const q = `projectId=${encodeURIComponent(pid)}`;
  const fetchRepos = useCallback(async () => { setLoading(true); try { const d = await api(`/api/cloud/github/repos?${q}`); setRepos(Array.isArray(d) ? d : []); } catch {} finally { setLoading(false); } }, [q]);
  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  const selectRepo = async (r: any) => {
    setRepo(r); setDetail(null);
    const [o, n] = (r.full_name || "").split("/");
    const rq = `${q}&owner=${o}&repo=${n}`;
    try {
      const [i, p, a, c, b, w] = await Promise.all([
        api(`/api/cloud/github/issues?${rq}`), api(`/api/cloud/github/pulls?${rq}`),
        api(`/api/cloud/github/actions?${rq}`), api(`/api/cloud/github/commits?${rq}&per_page=15`),
        api(`/api/cloud/github/branches?${rq}`), api(`/api/cloud/github/workflows?${rq}`),
      ]);
      setIssues(Array.isArray(i) ? i.filter((x: any) => !x.pull_request) : []);
      setPulls(Array.isArray(p) ? p : []);
      setActions(a?.workflow_runs || []);
      setCommits(Array.isArray(c) ? c : []);
      setBranches(Array.isArray(b) ? b.map((x: any) => x.name) : []);
      setWorkflows(w?.workflows || []);
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
    if (!newIssue.title || !repo) return;
    const [ow, rn] = repo.full_name.split("/");
    await post("/api/cloud/github/issues", { projectId: pid, owner: ow, repo: rn, ...newIssue });
    setShowNewIssue(false); setNewIssue({ title: "", body: "" }); selectRepo(repo); notify("success", "Issue created");
  };

  const createPR = async () => {
    if (!newPR.title || !newPR.head || !repo) return;
    const [ow, rn] = repo.full_name.split("/");
    await post("/api/cloud/github/pulls", { projectId: pid, owner: ow, repo: rn, ...newPR });
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
  // Open commit detail — fetch full commit with file changes
  const openCommit = async (commit: any) => {
    const [ow, rn] = (repo?.full_name || "").split("/");
    try {
      const full = await api(`/api/cloud/github/commit?${q}&owner=${ow}&repo=${rn}&sha=${commit.sha}`);
      setDetail({ type: "commit", data: full, comments: [] });
    } catch {
      setDetail({ type: "commit", data: commit, comments: [] });
    }
  };

  if (detail) {
    const d = detail.data;
    const isPR = detail.type === "pr";
    const isCommit = detail.type === "commit";
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setDetail(null)} style={{ ...btnGhost, padding: "3px 8px" }}><ArrowLeft size={12} /> Back</button>
          {isCommit ? <GitCommit size={14} style={{ color: C.accent }} /> : isPR ? <GitPullRequest size={14} style={{ color: "#22c55e" }} /> : <AlertCircle size={14} style={{ color: d.state === "open" ? "#22c55e" : "#ef4444" }} />}
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isCommit ? d.commit?.message?.split("\n")[0] : `#${d.number} ${d.title}`}
          </span>
          {!isCommit && d.state === "open" && !isPR && <button onClick={() => closeIssue(d.number)} style={{ ...btnGhost, padding: "3px 8px", color: "#ef4444", borderColor: "#ef444440" }}>Close</button>}
          {isPR && d.state === "open" && <button onClick={() => mergePR(d.number)} style={{ ...btnPrimary, padding: "4px 12px", background: "#22c55e" }}><GitMerge size={10} /> Merge</button>}
          <button onClick={() => window.open(isCommit ? d.html_url : d.html_url, "_blank")} style={{ ...btnGhost, padding: "3px 8px" }}><ExternalLink size={10} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
          {/* Commit detail */}
          {isCommit && (
            <div>
              <div style={{ padding: "12px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, marginBottom: 6 }}>
                  {d.commit?.author?.name} · {d.commit?.author?.email} · {timeAgo(d.commit?.author?.date)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>{d.commit?.message?.split("\n")[0]}</div>
                {d.commit?.message?.split("\n").slice(1).join("\n").trim() && (
                  <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>
                    <Md>{d.commit.message.split("\n").slice(1).join("\n").trim()}</Md>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: "hsl(220 13% 18%)", color: C.accent, fontFamily: FONTS.mono }}>{d.sha?.slice(0, 7)}</span>
                {d.stats && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: "#22c55e18", color: "#22c55e", fontFamily: FONTS.mono }}>+{d.stats.additions}</span>}
                {d.stats && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: "#ef444418", color: "#ef4444", fontFamily: FONTS.mono }}>-{d.stats.deletions}</span>}
                {d.parents?.map((p: any) => <span key={p.sha} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "hsl(220 13% 18%)", color: C.textDim, fontFamily: FONTS.mono }}>parent: {p.sha?.slice(0, 7)}</span>)}
              </div>
              {d.files && <CommitFiles files={d.files} />}
            </div>
          )}

          {/* Issue/PR Body — rendered as markdown */}
          {!isCommit && (
            <>
              <div style={{ padding: "12px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, marginBottom: 6 }}>{d.user?.login} · {timeAgo(d.created_at)}</div>
                {d.body ? (
                  <div style={{ fontSize: 12, lineHeight: 1.6, color: C.textMid }}>
                    <Md>{d.body}</Md>
                  </div>
                ) : (
                  <em style={{ color: C.textDim, fontSize: 11 }}>No description</em>
                )}
              </div>
              {isPR && (
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: "hsl(220 13% 18%)", color: C.textMid, fontFamily: FONTS.mono }}>{d.head?.ref} → {d.base?.ref}</span>
                  <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 3, background: "hsl(220 13% 18%)", color: C.textDim, fontFamily: FONTS.mono }}>+{d.additions || "?"} -{d.deletions || "?"}</span>
                </div>
              )}
              {/* Comments — also markdown rendered */}
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: C.textDim, marginBottom: 8, letterSpacing: "0.04em", textTransform: "uppercase" }}>Comments ({detail.comments.length})</div>
              {detail.comments.map((c: any) => (
                <div key={c.id} style={{ padding: "10px 12px", marginBottom: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5 }}>
                  <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, marginBottom: 4 }}>{c.user?.login} · {timeAgo(c.created_at)}</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: C.textMid }}>
                    <Md>{c.body || ""}</Md>
                  </div>
                </div>
              ))}
              {/* Add comment */}
              <div style={{ marginTop: 8 }}>
                <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Write a comment (markdown supported)..." rows={3}
                  style={{ ...inputSm, resize: "vertical", fontSize: 12, lineHeight: 1.5 }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addComment(); }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                  <button onClick={addComment} disabled={!commentText.trim()} style={{ ...btnPrimary, opacity: commentText.trim() ? 1 : 0.4 }}><Send size={10} /> Comment</button>
                </div>
              </div>
            </>
          )}
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
              <button style={ts(tab === "branches")} onClick={() => setTab("branches")}>Branches ({branches.length})</button>
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
                <button key={c.sha} onClick={() => openCommit(c)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHover; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}>
                  <GitCommit size={10} style={{ color: C.textDim, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.commit?.message?.split("\n")[0]}</div>
                    <div style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono }}>{c.sha?.slice(0, 7)} · {c.commit?.author?.name} · {timeAgo(c.commit?.author?.date)}</div>
                  </div>
                </button>
              ))}

              {/* Actions — workflows + runs */}
              {tab === "actions" && (
                <div>
                  {/* Workflows list with trigger buttons */}
                  {workflows.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Workflows</div>
                      {workflows.map((w: any) => (
                        <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}` }}>
                          <Settings size={10} style={{ color: C.textDim }} />
                          <span style={{ flex: 1, fontSize: 10, color: C.text }}>{w.name}</span>
                          <span style={{ fontSize: 7, color: C.textDim, fontFamily: FONTS.mono }}>{w.state}</span>
                          <button onClick={async () => {
                            const [ow, rn] = repo.full_name.split("/");
                            await post("/api/cloud/github/workflows/dispatch", { projectId: pid, owner: ow, repo: rn, workflow_id: w.id, ref: gitStatus?.branch || "main" });
                            notify("success", "Workflow triggered", w.name);
                            setTimeout(() => selectRepo(repo), 2000);
                          }} title="Trigger run" style={{ ...btnPrimary, padding: "2px 6px", fontSize: 8 }}>
                            <Rocket size={8} /> Run
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Runs with rerun button for failures */}
                  <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Recent Runs</div>
                  {actions.map((r: any) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}` }}>
                      {r.conclusion === "success" ? <CheckCircle2 size={11} color="#22c55e" /> : r.conclusion === "failure" ? <X size={11} color="#ef4444" /> : <Clock size={11} style={{ color: "#f59e0b" }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.text }}>{r.name}</div>
                        <div style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono }}>{r.head_branch} · {r.event} · {timeAgo(r.created_at)}</div>
                      </div>
                      <span style={{ fontSize: 7, padding: "2px 5px", borderRadius: 3, background: r.conclusion === "success" ? "#22c55e18" : r.conclusion === "failure" ? "#ef444418" : "#f59e0b18", color: r.conclusion === "success" ? "#22c55e" : r.conclusion === "failure" ? "#ef4444" : "#f59e0b", fontFamily: FONTS.mono }}>{r.conclusion || r.status}</span>
                      {r.conclusion === "failure" && (
                        <button onClick={async () => {
                          const [ow, rn] = repo.full_name.split("/");
                          await post("/api/cloud/github/actions/rerun", { projectId: pid, owner: ow, repo: rn, run_id: r.id });
                          notify("info", "Re-running workflow...");
                          setTimeout(() => selectRepo(repo), 2000);
                        }} title="Re-run" style={{ ...btnGhost, padding: "2px 6px", fontSize: 8 }}>
                          <RefreshCw size={8} /> Rerun
                        </button>
                      )}
                      <button onClick={() => window.open(r.html_url, "_blank")} title="View on GitHub" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 1 }}>
                        <ExternalLink size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Branches tab */}
              {tab === "branches" && (
                <BranchExplorer pid={pid} repo={repo} branches={branches} onRefresh={() => selectRepo(repo)} />
              )}

              {/* Empty states */}
              {tab === "issues" && issues.length === 0 && !showNewIssue && <Empty msg="No open issues" />}
              {tab === "pulls" && pulls.length === 0 && !showNewPR && <Empty msg="No open pull requests" />}
              {tab === "commits" && commits.length === 0 && <Empty msg="No commits" />}
              {tab === "actions" && actions.length === 0 && <Empty msg="No workflow runs" />}
              {tab === "branches" && branches.length === 0 && <Empty msg="No branches" />}
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
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", framework: "", repo: "" });
  const [githubRepos, setGithubRepos] = useState<any[]>([]);
  const [showNewDomain, setShowNewDomain] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab, setTab] = useState<"deployments" | "env" | "domains" | "settings">("deployments");
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

  const deleteEnv = async (envId: string) => {
    if (!proj) return;
    await del("/api/cloud/vercel/env", { projectId: pid, vercelProjectId: proj.id, envId });
    selectProj(proj); notify("info", "Env var removed");
  };

  const addDomain = async () => {
    if (!proj || !newDomain.trim()) return;
    await post("/api/cloud/vercel/domains/add", { projectId: pid, vercelProjectId: proj.id, domain: newDomain.trim() });
    setShowNewDomain(false); setNewDomain(""); selectProj(proj); notify("success", "Domain added");
  };

  const removeDomain = async (domain: string) => {
    if (!proj || !confirm(`Remove "${domain}"?`)) return;
    await del("/api/cloud/vercel/domains", { projectId: pid, vercelProjectId: proj.id, domain });
    selectProj(proj); notify("info", "Domain removed");
  };

  const redeployLatest = async () => {
    if (!deployments[0]) return;
    await post("/api/cloud/vercel/redeploy", { projectId: pid, deploymentId: deployments[0].uid });
    notify("success", "Redeployment triggered"); setTimeout(() => selectProj(proj), 3000);
  };

  const createProject = async () => {
    if (!newProject.name) return;
    const body: any = { projectId: pid, name: newProject.name };
    if (newProject.framework) body.framework = newProject.framework;
    if (newProject.repo) body.gitRepository = { repo: newProject.repo, type: "github" };
    await post("/api/cloud/vercel/projects/create", body);
    setShowCreateProject(false); setNewProject({ name: "", framework: "", repo: "" });
    api(`/api/cloud/vercel/projects?${q}`).then((d) => setProjects(d?.projects || []));
    notify("success", "Project created", newProject.name);
  };

  const deleteProject = async () => {
    if (!proj || !confirm(`Delete "${proj.name}"?`)) return;
    await del("/api/cloud/vercel/projects", { projectId: pid, vercelProjectId: proj.id });
    setProj(null); api(`/api/cloud/vercel/projects?${q}`).then((d) => setProjects(d?.projects || [])); notify("info", "Project deleted");
  };

  const FRAMEWORKS = ["", "nextjs", "vite", "create-react-app", "nuxtjs", "svelte", "gatsby", "astro", "remix", "angular", "vue"];

  const ts = (a: boolean): React.CSSProperties => ({ padding: "5px 10px", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: FONTS.mono, color: a ? C.accent : C.textDim, background: "transparent", borderBottom: a ? `2px solid ${C.accent}` : "2px solid transparent" });

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {sidebarOpen && (
        <div style={{ width: 220, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600, color: C.text, flex: 1 }}>PROJECTS ({projects.length})</span>
            <button onClick={() => { setShowCreateProject(!showCreateProject); if (!showCreateProject) api(`/api/cloud/github/repos?${q}`).then((r: any) => setGithubRepos(Array.isArray(r) ? r : [])).catch(() => {}); }} title="New project" style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", padding: 2, display: "flex" }}><Plus size={11} /></button>
            <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, display: "flex" }}><PanelLeftClose size={11} /></button>
          </div>

          {showCreateProject && (
            <div style={{ padding: 8, borderBottom: `1px solid ${C.border}`, background: C.surfaceAlt }}>
              <div style={{ fontSize: 9, color: C.accent, fontWeight: 600, marginBottom: 4 }}>Deploy from GitHub</div>
              <input value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} placeholder="Project name" style={inputSm} />
              <select value={newProject.repo} onChange={(e) => setNewProject({ ...newProject, repo: e.target.value })} style={{ ...inputSm, marginTop: 3 }}>
                <option value="">Select GitHub repo (optional)</option>
                {githubRepos.map((r: any) => <option key={r.id} value={r.full_name}>{r.full_name}</option>)}
              </select>
              <select value={newProject.framework} onChange={(e) => setNewProject({ ...newProject, framework: e.target.value })} style={{ ...inputSm, marginTop: 3 }}>
                <option value="">Auto-detect framework</option>
                {FRAMEWORKS.filter(Boolean).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <button onClick={createProject} disabled={!newProject.name} style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}><Rocket size={9} /> Create</button>
                <button onClick={() => setShowCreateProject(false)} style={{ ...btnGhost, padding: "3px 8px", fontSize: 9 }}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {projects.map((p: any) => (
              <button key={p.id} onClick={() => selectProj(p)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", background: proj?.id === p.id ? C.surfaceAlt : "transparent", border: "none", color: proj?.id === p.id ? C.text : C.textMid, fontFamily: FONTS.sans, fontSize: 10, cursor: "pointer", textAlign: "left", borderBottom: `1px solid ${C.border}` }}>
                <Rocket size={9} style={{ color: C.textDim, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                {p.framework && <span style={{ fontSize: 7, color: C.textDim, fontFamily: FONTS.mono }}>{p.framework}</span>}
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
              <div style={{ flex: 1 }} />
              <button onClick={redeployLatest} title="Redeploy" style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}><Rocket size={9} /> Redeploy</button>
              <button onClick={() => window.open(`https://${proj.name}.vercel.app`, "_blank")} style={{ ...btnGhost, padding: "3px 8px" }}><ExternalLink size={9} /></button>
            </div>
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, padding: "0 10px", flexShrink: 0, overflowX: "auto" }}>
              <button style={ts(tab === "deployments")} onClick={() => setTab("deployments")}>Deploys ({deployments.length})</button>
              <button style={ts(tab === "env")} onClick={() => setTab("env")}>Env ({envVars.length})</button>
              <button style={ts(tab === "domains")} onClick={() => setTab("domains")}>Domains ({domains.length})</button>
              <button style={ts(tab === "settings")} onClick={() => setTab("settings")}>Settings</button>
              <div style={{ flex: 1 }} />
              {tab === "env" && <button onClick={() => setShowNewEnv(!showNewEnv)} style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}><Plus size={9} /> Add</button>}
              {tab === "domains" && <button onClick={() => setShowNewDomain(!showNewDomain)} style={{ ...btnPrimary, padding: "3px 8px", fontSize: 9 }}><Plus size={9} /> Add</button>}
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
                  <button onClick={() => deleteEnv(v.id)} title="Delete" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 1 }}><Trash2 size={9} /></button>
                </div>
              ))}
              {tab === "domains" && showNewDomain && (
                <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                  <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" style={{ ...inputSm, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") addDomain(); }} />
                  <button onClick={addDomain} disabled={!newDomain.trim()} style={btnPrimary}>Add</button>
                </div>
              )}
              {tab === "domains" && domains.map((d: any) => (
                <div key={d.name || d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", marginBottom: 2, borderRadius: 4, background: C.surface, border: `1px solid ${C.border}` }}>
                  <Globe size={9} style={{ color: C.accent }} />
                  <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.text, flex: 1 }}>{d.name || d.apexName || d}</span>
                  {d.verified !== undefined && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: d.verified ? "#22c55e18" : "#f59e0b18", color: d.verified ? "#22c55e" : "#f59e0b", fontFamily: FONTS.mono }}>{d.verified ? "verified" : "pending"}</span>}
                  <button onClick={() => removeDomain(d.name || d.apexName)} title="Remove" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 1 }}><Trash2 size={9} /></button>
                </div>
              ))}
              {tab === "settings" && (
                <div>
                  <div style={{ padding: "12px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 4 }}>Project Info</div>
                    <div style={{ fontSize: 10, color: C.textDim, fontFamily: FONTS.mono, lineHeight: 1.8 }}>
                      <div>ID: {proj.id}</div>
                      <div>Framework: {proj.framework || "auto-detect"}</div>
                      <div>Node: {proj.nodeVersion || "default"}</div>
                      {proj.link?.repo && <div>Repo: {proj.link.repo}</div>}
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px", background: "#ef44440a", border: "1px solid #ef444430", borderRadius: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", marginBottom: 6 }}>Danger Zone</div>
                    <button onClick={deleteProject} style={{ ...btnGhost, padding: "4px 10px", fontSize: 9, color: "#ef4444", borderColor: "#ef444440" }}><Trash2 size={9} /> Delete Project</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Supabase View — Full interactive view with sidebar + tabs
// ═══════════════════════════════════════════════════════════════
function SupabaseView({ pid }: { pid: string }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [project, setProject] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"tables" | "auth" | "storage" | "sql">("tables");
  const [tables, setTables] = useState<any[]>([]);
  const [sqlText, setSqlText] = useState("");
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlRunning, setSqlRunning] = useState(false);

  const q = `projectId=${encodeURIComponent(pid)}`;

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/api/cloud/supabase/projects?${q}`);
      setProjects(Array.isArray(d) ? d : []);
    } catch {} finally { setLoading(false); }
  }, [q]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const selectProject = async (p: any) => {
    setProject(p); setTab("tables"); setSqlResult(null);
    const ref = p.ref || p.id;
    try {
      const t = await api(`/api/cloud/supabase/tables?${q}&ref=${encodeURIComponent(ref)}`);
      setTables(Array.isArray(t) ? t : []);
    } catch { setTables([]); }
  };

  const runSql = async () => {
    if (!sqlText.trim() || !project) return;
    setSqlRunning(true); setSqlResult(null);
    try {
      const r = await post("/api/cloud/supabase/sql", { projectId: pid, ref: project.ref || project.id, query: sqlText });
      setSqlResult(r);
    } catch (e: any) { setSqlResult({ error: e.message || "Query failed" }); }
    finally { setSqlRunning(false); }
  };

  const ts = (a: boolean): React.CSSProperties => ({
    padding: "5px 10px", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600,
    fontFamily: FONTS.mono, color: a ? C.accent : C.textDim, background: "transparent",
    borderBottom: a ? `2px solid ${C.accent}` : "2px solid transparent",
  });

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{ width: 220, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600, color: C.text, flex: 1 }}>PROJECTS ({projects.length})</span>
            <button onClick={fetchProjects} title="Refresh" style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", padding: 2, display: "flex" }}><RefreshCw size={11} /></button>
            <button onClick={() => setSidebarOpen(false)} title="Collapse" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, display: "flex" }}><PanelLeftClose size={11} /></button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && <div style={{ padding: 12, textAlign: "center" }}><Loader2 size={14} style={{ color: C.accent, animation: "spin 1s linear infinite" }} /></div>}
            {projects.map((p) => (
              <button key={p.id || p.ref} onClick={() => selectProject(p)} style={{
                width: "100%", display: "flex", flexDirection: "column", gap: 2, padding: "8px 10px",
                border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", textAlign: "left",
                background: project?.id === p.id ? C.surfaceAlt : "transparent",
                borderLeft: project?.id === p.id ? `2px solid ${C.accent}` : "2px solid transparent",
              }}
                onMouseEnter={(e) => { if (project?.id !== p.id) e.currentTarget.style.background = C.surface; }}
                onMouseLeave={(e) => { if (project?.id !== p.id) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{
                    fontSize: 7, padding: "2px 5px", borderRadius: 3, fontFamily: FONTS.mono, fontWeight: 600,
                    background: p.status === "ACTIVE_HEALTHY" ? "#22c55e18" : "#f59e0b18",
                    color: p.status === "ACTIVE_HEALTHY" ? "#22c55e" : "#f59e0b",
                  }}>{p.status === "ACTIVE_HEALTHY" ? "Healthy" : p.status || "?"}</span>
                </div>
                <div style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.region || ""}{p.region && p.ref ? " · " : ""}{p.ref || ""}
                </div>
              </button>
            ))}
            {!loading && projects.length === 0 && <Empty msg="No projects found" />}
          </div>
        </div>
      )}

      {/* Edge toggle when sidebar collapsed */}
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

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!project ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: C.textDim }}>
            <Database size={20} style={{ opacity: 0.3 }} />
            <span style={{ fontSize: 11 }}>Select a project to manage</span>
          </div>
        ) : (
          <>
            {/* Project header */}
            <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, display: "flex" }}><PanelLeft size={12} /></button>}
              <Database size={12} style={{ color: C.accent }} />
              <span style={{ fontWeight: 600, fontSize: 12 }}>{project.name}</span>
              <span style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono }}>{project.ref || project.id}</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => window.open(`https://supabase.com/dashboard/project/${project.ref || project.id}`, "_blank")} style={btnGhost}><ExternalLink size={9} /> Dashboard</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}`, padding: "0 10px", flexShrink: 0 }}>
              <button style={ts(tab === "tables")} onClick={() => setTab("tables")}>Tables ({tables.length})</button>
              <button style={ts(tab === "auth")} onClick={() => setTab("auth")}>Auth</button>
              <button style={ts(tab === "storage")} onClick={() => setTab("storage")}>Storage</button>
              <button style={ts(tab === "sql")} onClick={() => setTab("sql")}>SQL</button>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10 }}>
              {/* Tables tab */}
              {tab === "tables" && (
                <>
                  {tables.length === 0 ? <Empty msg="No tables found" /> : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
                      {tables.map((t: any, i: number) => (
                        <div key={t.id || t.name || i} style={{
                          padding: "12px 14px", borderRadius: 8, background: C.surface,
                          border: `1px solid ${C.border}`, transition: "border-color 0.15s",
                        }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHover; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <Database size={10} style={{ color: C.accent }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{t.name}</span>
                          </div>
                          <div style={{ fontSize: 10, color: C.textDim, fontFamily: FONTS.mono }}>
                            {t.schema || "public"}{t.rows !== undefined ? ` · ${t.rows} rows` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Auth tab */}
              {tab === "auth" && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: C.textDim, padding: 40 }}>
                  <Lock size={20} style={{ opacity: 0.3 }} />
                  <span style={{ fontSize: 11 }}>Auth management coming soon</span>
                </div>
              )}

              {/* Storage tab */}
              {tab === "storage" && (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: C.textDim, padding: 40 }}>
                  <FolderOpen size={20} style={{ opacity: 0.3 }} />
                  <span style={{ fontSize: 11 }}>Storage management coming soon</span>
                </div>
              )}

              {/* SQL tab */}
              {tab === "sql" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
                  <textarea
                    value={sqlText}
                    onChange={(e) => setSqlText(e.target.value)}
                    placeholder="SELECT * FROM your_table LIMIT 10;"
                    rows={6}
                    style={{ ...inputSm, resize: "vertical", fontSize: 12, lineHeight: 1.5 }}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runSql(); }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={runSql} disabled={!sqlText.trim() || sqlRunning} style={{ ...btnPrimary, opacity: sqlText.trim() && !sqlRunning ? 1 : 0.4 }}>
                      {sqlRunning ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <Rocket size={10} />} Run
                    </button>
                    <span style={{ fontSize: 9, color: C.textDim, fontFamily: FONTS.mono }}>Ctrl+Enter to execute</span>
                  </div>
                  {sqlResult && (
                    <div style={{ marginTop: 4, borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
                      {sqlResult.error ? (
                        <div style={{ padding: "10px 14px", background: "#ef444410", color: "#f87171", fontSize: 11, fontFamily: FONTS.mono }}>{sqlResult.error}</div>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          {Array.isArray(sqlResult) && sqlResult.length > 0 ? (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FONTS.mono }}>
                              <thead style={{ background: "hsl(220 13% 16%)" }}>
                                <tr>{Object.keys(sqlResult[0]).map((k) => <th key={k} style={{ padding: "5px 8px", textAlign: "left", fontSize: 9, color: C.textDim, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{k}</th>)}</tr>
                              </thead>
                              <tbody>
                                {sqlResult.map((row: any, ri: number) => (
                                  <tr key={ri}>
                                    {Object.values(row).map((v: any, ci: number) => (
                                      <td key={ci} style={{ padding: "4px 8px", borderBottom: `1px solid hsl(220 13% 20%)`, color: C.textMid, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {v === null ? <span style={{ color: C.textDim, fontStyle: "italic" }}>null</span> : String(v)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div style={{ padding: "10px 14px", fontSize: 11, color: C.textMid, fontFamily: FONTS.mono }}>
                              {sqlResult.message || JSON.stringify(sqlResult, null, 2)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Simple List View (Neon, Netlify)
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

// ── Commit Files with inline diff ──
function CommitFiles({ files }: { files: any[] }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  return (
    <div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: C.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Changed Files ({files.length})</div>
      {files.map((f: any) => (
        <div key={f.filename}>
          <button onClick={() => setExpandedFile(expandedFile === f.filename ? null : f.filename)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", marginBottom: 1,
            borderRadius: 3, background: C.surface, border: `1px solid ${expandedFile === f.filename ? C.borderHover : C.border}`,
            fontSize: 10, fontFamily: FONTS.mono, cursor: "pointer", textAlign: "left",
          }}>
            <span style={{ color: f.status === "added" ? "#22c55e" : f.status === "removed" ? "#ef4444" : "#f59e0b", fontSize: 9, width: 12, fontWeight: 700 }}>
              {f.status === "added" ? "A" : f.status === "removed" ? "D" : "M"}
            </span>
            <span style={{ flex: 1, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</span>
            <span style={{ color: "#22c55e", fontSize: 8 }}>+{f.additions}</span>
            <span style={{ color: "#ef4444", fontSize: 8 }}>-{f.deletions}</span>
            <ChevronDown size={10} style={{ color: C.textDim, transform: expandedFile === f.filename ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {expandedFile === f.filename && f.patch && (
            <div style={{ margin: "2px 0 6px", borderRadius: 4, overflow: "hidden", border: `1px solid ${C.border}` }}>
              <pre style={{ margin: 0, padding: "8px 10px", fontSize: 10, lineHeight: 1.5, fontFamily: FONTS.mono, overflowX: "auto", background: "hsl(220 13% 10%)" }}>
                {f.patch.split("\n").map((line: string, i: number) => (
                  <div key={i} style={{
                    padding: "0 4px",
                    background: line.startsWith("+") && !line.startsWith("+++") ? "#22c55e0a" : line.startsWith("-") && !line.startsWith("---") ? "#ef44440a" : "transparent",
                    color: line.startsWith("+") && !line.startsWith("+++") ? "#4ade80" : line.startsWith("-") && !line.startsWith("---") ? "#f87171" : line.startsWith("@@") ? "#818cf8" : C.textMid,
                  }}>
                    {line}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Branch Explorer — view files, create/delete branches ──
function BranchExplorer({ pid, repo, branches, onRefresh }: { pid: string; repo: any; branches: string[]; onRefresh: () => void }) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [tree, setTree] = useState<any[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string; name: string } | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("main");

  const [ow, rn] = (repo?.full_name || "").split("/");
  const q = `projectId=${encodeURIComponent(pid)}&owner=${ow}&repo=${rn}`;

  const loadTree = async (branch: string) => {
    setSelectedBranch(branch);
    setFileContent(null);
    setLoadingTree(true);
    try {
      const d = await api(`/api/cloud/github/tree?${q}&ref=${encodeURIComponent(branch)}`);
      setTree(d?.tree || []);
    } catch {} finally { setLoadingTree(false); }
  };

  const loadFile = async (path: string) => {
    try {
      const d = await api(`/api/cloud/github/file?${q}&path=${encodeURIComponent(path)}&ref=${encodeURIComponent(selectedBranch || "main")}`);
      setFileContent({ path, content: d?.content || "", name: path.split("/").pop() || path });
    } catch {}
  };

  const createBranch = async () => {
    if (!newBranch.trim()) return;
    await post("/api/cloud/github/branches/create", { projectId: pid, owner: ow, repo: rn, branch: newBranch.trim(), from_branch: fromBranch });
    setShowCreate(false); setNewBranch("");
    onRefresh();
    notify("success", "Branch created", newBranch);
  };

  const deleteBranch = async (branch: string) => {
    if (!confirm(`Delete branch "${branch}"?`)) return;
    await del("/api/cloud/github/branches", { projectId: pid, owner: ow, repo: rn, branch });
    onRefresh();
    if (selectedBranch === branch) { setSelectedBranch(null); setTree([]); setFileContent(null); }
    notify("info", "Branch deleted", branch);
  };

  // Group tree items into folders
  const folders = new Map<string, any[]>();
  const rootFiles: any[] = [];
  for (const item of tree.filter((t: any) => t.type === "blob")) {
    const parts = item.path.split("/");
    if (parts.length === 1) rootFiles.push(item);
    else {
      const folder = parts.slice(0, -1).join("/");
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder)!.push(item);
    }
  }

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 300 }}>
      {/* Branch list */}
      <div style={{ width: 180, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "4px 6px", display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 8, fontWeight: 600, color: C.textDim, flex: 1, textTransform: "uppercase" }}>Branches</span>
          <button onClick={() => setShowCreate(!showCreate)} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", padding: 1, display: "flex" }}><Plus size={10} /></button>
        </div>
        {showCreate && (
          <div style={{ padding: 6, borderBottom: `1px solid ${C.border}`, background: C.surfaceAlt }}>
            <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="new-branch" style={{ ...inputSm, fontSize: 9, padding: "3px 6px" }} />
            <select value={fromBranch} onChange={(e) => setFromBranch(e.target.value)} style={{ ...inputSm, fontSize: 9, padding: "3px 6px", marginTop: 3 }}>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={createBranch} disabled={!newBranch.trim()} style={{ ...btnPrimary, padding: "2px 8px", fontSize: 8, marginTop: 3, width: "100%" }}>Create</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {branches.map((b) => (
            <div key={b} style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
              <button onClick={() => loadTree(b)} style={{
                flex: 1, display: "flex", alignItems: "center", gap: 4, padding: "5px 6px",
                background: selectedBranch === b ? C.surfaceAlt : "transparent", border: "none",
                color: selectedBranch === b ? C.accent : C.textMid, fontFamily: FONTS.mono, fontSize: 9,
                cursor: "pointer", textAlign: "left",
              }}>
                <GitBranch size={9} /> {b}
              </button>
              {b !== "main" && b !== "master" && (
                <button onClick={() => deleteBranch(b)} title="Delete" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: "2px 4px" }}>
                  <Trash2 size={8} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* File tree + viewer */}
      {!selectedBranch ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: 11 }}>
          Select a branch to browse files
        </div>
      ) : loadingTree ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: C.textDim, fontSize: 10 }}>
          <Loader2 size={12} className="animate-spin" /> Loading tree...
        </div>
      ) : (
        <>
          {/* File tree */}
          <div style={{ width: 220, borderRight: `1px solid ${C.border}`, overflowY: "auto", flexShrink: 0 }}>
            <div style={{ padding: "4px 6px", fontFamily: FONTS.mono, fontSize: 8, color: C.textDim, borderBottom: `1px solid ${C.border}`, textTransform: "uppercase" }}>
              {selectedBranch} · {tree.filter((t: any) => t.type === "blob").length} files
            </div>
            {rootFiles.map((f: any) => (
              <button key={f.path} onClick={() => loadFile(f.path)} style={{
                width: "100%", display: "block", padding: "3px 8px", background: fileContent?.path === f.path ? C.surfaceAlt : "transparent",
                border: "none", color: fileContent?.path === f.path ? C.accent : C.textMid, fontFamily: FONTS.mono, fontSize: 9,
                cursor: "pointer", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {f.path}
              </button>
            ))}
            {[...folders.entries()].map(([folder, files]) => (
              <div key={folder}>
                <div style={{ padding: "3px 8px", fontSize: 8, color: C.textDim, fontFamily: FONTS.mono, background: "hsl(220 13% 14%)" }}>
                  {folder}/
                </div>
                {files.map((f: any) => (
                  <button key={f.path} onClick={() => loadFile(f.path)} style={{
                    width: "100%", display: "block", padding: "2px 8px 2px 16px",
                    background: fileContent?.path === f.path ? C.surfaceAlt : "transparent", border: "none",
                    color: fileContent?.path === f.path ? C.accent : C.textMid, fontFamily: FONTS.mono, fontSize: 9,
                    cursor: "pointer", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {f.path.split("/").pop()}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* File content viewer (read-only) */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {!fileContent ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: 11 }}>
                Select a file to view
              </div>
            ) : (
              <>
                <div style={{ padding: "4px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.text }}>{fileContent.path}</span>
                  <span style={{ fontSize: 8, color: C.textDim, fontFamily: FONTS.mono }}>{selectedBranch}</span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => navigator.clipboard.writeText(fileContent.content)} title="Copy" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2 }}>
                    <Copy size={10} />
                  </button>
                </div>
                <pre style={{ flex: 1, margin: 0, padding: "8px 12px", overflowY: "auto", fontSize: 11, lineHeight: 1.5, fontFamily: FONTS.mono, color: C.textMid, background: "hsl(220 13% 10%)" }}>
                  {fileContent.content}
                </pre>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: "30px 16px", textAlign: "center", color: C.textDim, fontSize: 11 }}>{msg}</div>;
}

// Styled markdown renderer — same styling as WikiTabView
function Md({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children: c }) => <h1 style={{ fontSize: 18, fontWeight: 700, color: "hsl(220 14% 95%)", margin: "12px 0 8px" }}>{c}</h1>,
        h2: ({ children: c }) => <h2 style={{ fontSize: 15, fontWeight: 600, color: "hsl(220 14% 90%)", margin: "16px 0 6px", paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>{c}</h2>,
        h3: ({ children: c }) => <h3 style={{ fontSize: 13, fontWeight: 600, color: "hsl(220 14% 88%)", margin: "12px 0 4px" }}>{c}</h3>,
        p: ({ children: c }) => <p style={{ margin: "6px 0", lineHeight: 1.6 }}>{c}</p>,
        strong: ({ children: c }) => <strong style={{ color: "hsl(220 14% 88%)" }}>{c}</strong>,
        a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none" }}>{c}</a>,
        blockquote: ({ children: c }) => <blockquote style={{ margin: "8px 0", padding: "6px 12px", borderLeft: `3px solid ${C.accent}`, background: `${C.accent}08`, borderRadius: "0 4px 4px 0", fontStyle: "italic" }}>{c}</blockquote>,
        ul: ({ children: c }) => <ul style={{ margin: "4px 0", paddingLeft: 18, listStyle: "disc" }}>{c}</ul>,
        ol: ({ children: c }) => <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{c}</ol>,
        li: ({ children: c }) => <li style={{ margin: "2px 0", lineHeight: 1.5 }}>{c}</li>,
        table: ({ children: c }) => <div style={{ overflowX: "auto", margin: "8px 0" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FONTS.mono }}>{c}</table></div>,
        thead: ({ children: c }) => <thead style={{ background: "hsl(220 13% 16%)" }}>{c}</thead>,
        th: ({ children: c }) => <th style={{ padding: "5px 8px", textAlign: "left", fontSize: 9, color: "hsl(220 14% 60%)", fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{c}</th>,
        td: ({ children: c }) => <td style={{ padding: "4px 8px", borderBottom: `1px solid hsl(220 13% 20%)` }}>{c}</td>,
        hr: () => <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "12px 0" }} />,
        img: ({ src, alt }) => <img src={src} alt={alt} style={{ maxWidth: "100%", borderRadius: 6, margin: "6px 0" }} />,
        code: ({ className, children: c }) => {
          const lang = /language-(\w+)/.exec(className || "")?.[1] || "";
          const str = String(c).replace(/\n$/, "");
          if (lang || str.includes("\n")) {
            return <pre style={{ background: "hsl(220 13% 11%)", border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 10px", overflowX: "auto", fontSize: 11, lineHeight: 1.4, fontFamily: FONTS.mono, color: "hsl(220 14% 78%)", margin: "6px 0" }}><code>{str}</code></pre>;
          }
          return <code style={{ background: "hsl(220 13% 18%)", padding: "1px 4px", borderRadius: 3, fontSize: "0.9em", color: "hsl(207 80% 70%)", fontFamily: FONTS.mono }}>{c}</code>;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
