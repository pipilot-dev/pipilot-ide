/**
 * DeploymentPanel — 4-platform quick deploy with editorial mission-control aesthetic.
 *
 * Platforms: GitHub (push/create repo), Vercel, Netlify, Cloudflare
 * Features: token status, deploy forms, progress bar, streaming logs, history
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  GitBranch, Globe, Server, Cloud, Rocket, CheckCircle2,
  AlertCircle, Loader2, ExternalLink, Copy, RefreshCw,
  ChevronDown, Lock, Eye, EyeOff, Sparkles, Clock,
  XCircle, ArrowRight, Terminal,
} from "lucide-react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { COLORS as C, FONTS } from "@/lib/design-tokens";
import { deploySite } from "@/lib/deploy";

// ── Types ────────────────────────────────────────────────────────────────────

type Platform = "github" | "vercel" | "netlify" | "cloudflare" | "puter";
type DeployStatus = "idle" | "deploying" | "success" | "error";

interface DeployRecord {
  id: string;
  platform: Platform;
  url: string;
  status: "success" | "error";
  projectName: string;
  createdAt: number;
  message?: string;
}

interface PlatformInfo {
  id: Platform;
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

const PLATFORMS: PlatformInfo[] = [
  { id: "puter", name: "Puter", icon: <Rocket size={18} />, color: "#c6ff3d", description: "Free static hosting (HTML/CSS/JS)" },
  { id: "github", name: "GitHub", icon: <GitBranch size={18} />, color: "#f0f6fc", description: "Push to repository" },
  { id: "vercel", name: "Vercel", icon: <Globe size={18} />, color: "#fff", description: "Deploy frontend + serverless" },
  { id: "netlify", name: "Netlify", icon: <Server size={18} />, color: "#00c7b7", description: "Static sites + functions" },
  { id: "cloudflare", name: "Cloudflare", icon: <Cloud size={18} />, color: "#f38020", description: "Pages + Workers" },
];

const F = { m: FONTS.mono, s: FONTS.sans };

// ── Helpers ──────────────────────────────────────────────────────────────────

async function api(url: string, opts?: RequestInit) { return (await fetch(url, opts)).json(); }
async function post(url: string, body: any) { return api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60_000, h = 3600_000, d = 86400_000;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  return `${Math.floor(diff / d)}d ago`;
}

function generateRepoName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "my-project";
}

// ── Shared Styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 12, fontFamily: F.s,
  background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5,
  color: C.text, outline: "none", transition: "border-color 0.2s",
};

const labelStyle: React.CSSProperties = {
  fontFamily: F.m, fontSize: 9, fontWeight: 600, color: C.textDim,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, display: "block",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "8px 20px", fontSize: 11, fontFamily: F.m, fontWeight: 700,
  background: C.accent, color: "#fff", border: "none", borderRadius: 5,
  cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
  transition: "background 0.2s, transform 0.1s",
};

const btnGhost: React.CSSProperties = {
  ...btnPrimary, background: "transparent", color: C.textMid,
  border: `1px solid ${C.border}`, fontWeight: 600,
};

// ── Component ────────────────────────────────────────────────────────────────

export function DeploymentPanel() {
  const { activeProjectId } = useActiveProject();
  const pid = activeProjectId || "";

  // State
  const [platform, setPlatform] = useState<Platform>("puter");
  const [connStatus, setConnStatus] = useState<Record<string, boolean>>({});
  const [deployStatus, setDeployStatus] = useState<DeployStatus>("idle");
  const [deployUrl, setDeployUrl] = useState("");
  const [deployError, setDeployError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [history, setHistory] = useState<DeployRecord[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // GitHub form
  const [ghMode, setGhMode] = useState<"new" | "existing">("new");
  const [ghRepoName, setGhRepoName] = useState("");
  const [ghDescription, setGhDescription] = useState("");
  const [ghCommitMsg, setGhCommitMsg] = useState("Initial commit");
  const [ghPrivate, setGhPrivate] = useState(false);
  const [ghRepos, setGhRepos] = useState<any[]>([]);
  const [ghSelectedRepo, setGhSelectedRepo] = useState("");
  const [generatingMsg, setGeneratingMsg] = useState(false);

  // Vercel form
  const [vcProjectName, setVcProjectName] = useState("");
  const [vcFramework, setVcFramework] = useState("auto");

  // Netlify form
  const [ntSiteName, setNtSiteName] = useState("");
  const [ntBuildCmd, setNtBuildCmd] = useState("npm run build");
  const [ntPublishDir, setNtPublishDir] = useState("dist");

  // Cloudflare form
  const [cfProjectName, setCfProjectName] = useState("");
  const [cfBranch, setCfBranch] = useState("main");

  // Puter
  const [puterSlug, setPuterSlug] = useState("");
  const [hasPackageJson, setHasPackageJson] = useState(false);

  // Load connector status + history
  const refresh = useCallback(async () => {
    if (!pid) return;
    try {
      const data = await api(`/api/cloud/status?projectId=${encodeURIComponent(pid)}`);
      setConnStatus(data.providers || {});
    } catch {}
    try {
      const data = await api(`/api/deployments/list?projectId=${encodeURIComponent(pid)}`);
      setHistory(data.deployments || []);
    } catch {}
  }, [pid]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-fill repo/project names from project + detect package.json
  useEffect(() => {
    if (!pid) return;
    const name = generateRepoName(pid);
    setGhRepoName(name);
    setVcProjectName(name);
    setNtSiteName(name);
    setCfProjectName(name);
    setPuterSlug(name);
    // Check if project has package.json (= not a static site)
    api(`/api/files/read?projectId=${encodeURIComponent(pid)}&path=package.json`)
      .then((d) => setHasPackageJson(!d.error && d.content !== undefined))
      .catch(() => setHasPackageJson(false));
  }, [pid]);

  // Load GitHub repos when switching to existing mode
  useEffect(() => {
    if (platform === "github" && ghMode === "existing" && connStatus.github) {
      api(`/api/cloud/github/repos?projectId=${encodeURIComponent(pid)}`)
        .then((d) => setGhRepos(d.repos || []))
        .catch(() => {});
    }
  }, [platform, ghMode, connStatus.github, pid]);

  // Auto-scroll logs
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  // ── Deploy handlers ──────────────────────────────────────────────────

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const recordDeploy = async (record: Omit<DeployRecord, "id" | "createdAt">) => {
    const entry: DeployRecord = { ...record, id: `dep_${Date.now()}`, createdAt: Date.now() };
    setHistory((prev) => [entry, ...prev]);
    try { await post("/api/deployments/record", { projectId: pid, ...entry }); } catch {}
  };

  const handleDeploy = async () => {
    if (!pid || deployStatus === "deploying") return;
    setDeployStatus("deploying");
    setDeployUrl("");
    setDeployError("");
    setLogs([]);

    const plat = PLATFORMS.find((p) => p.id === platform)!;
    addLog(`Starting ${plat.name} deployment...`);

    try {
      let result: any;

      switch (platform) {
        case "puter": {
          if (hasPackageJson) {
            throw new Error("Puter only supports static sites (HTML/CSS/JS). This project has a package.json — use Vercel, Netlify, or Cloudflare instead.");
          }
          addLog("Deploying to Puter (static hosting)...");
          const puterResult = await deploySite(pid, puterSlug || pid);
          if (!puterResult.success) throw new Error(puterResult.error || "Puter deploy failed");
          addLog(`Uploaded ${puterResult.fileCount} files`);
          addLog(`Live at: ${puterResult.url}`);
          setDeployUrl(puterResult.url);
          setDeployStatus("success");
          await recordDeploy({ platform: "puter", url: puterResult.url, status: "success", projectName: puterSlug || pid });
          break;
        }

        case "github": {
          addLog(ghMode === "new" ? `Creating repository: ${ghRepoName}` : `Pushing to: ${ghSelectedRepo}`);
          result = await post("/api/cloud/github/git-push", {
            projectId: pid,
            repoName: ghMode === "new" ? ghRepoName : undefined,
            repoFullName: ghMode === "existing" ? ghSelectedRepo : undefined,
            description: ghDescription,
            commitMessage: ghCommitMsg,
            isPrivate: ghPrivate,
            createNew: ghMode === "new",
          });
          if (result.error) throw new Error(result.error);
          const url = result.url || result.html_url || `https://github.com/${result.full_name || ghRepoName}`;
          addLog(`Pushed successfully!`);
          addLog(`URL: ${url}`);
          setDeployUrl(url);
          setDeployStatus("success");
          await recordDeploy({ platform: "github", url, status: "success", projectName: ghRepoName, message: ghCommitMsg });
          break;
        }

        case "vercel": {
          addLog(`Deploying to Vercel: ${vcProjectName}`);
          addLog(`Framework: ${vcFramework === "auto" ? "auto-detect" : vcFramework}`);
          result = await post("/api/cloud/vercel/deploy", {
            projectId: pid,
            projectName: vcProjectName,
            framework: vcFramework === "auto" ? undefined : vcFramework,
          });
          if (result.error) throw new Error(result.error);
          const url = result.url || result.deploymentUrl;
          addLog(`Deployed! URL: ${url}`);
          setDeployUrl(url?.startsWith("http") ? url : `https://${url}`);
          setDeployStatus("success");
          await recordDeploy({ platform: "vercel", url: url || "", status: "success", projectName: vcProjectName });
          break;
        }

        case "netlify": {
          addLog(`Deploying to Netlify: ${ntSiteName}`);
          result = await post("/api/cloud/netlify/deploy", {
            projectId: pid,
            siteName: ntSiteName,
            buildCommand: ntBuildCmd,
            publishDir: ntPublishDir,
          });
          if (result.error) throw new Error(result.error);
          const url = result.url || result.deploy_ssl_url || result.ssl_url;
          addLog(`Deployed! URL: ${url}`);
          setDeployUrl(url || "");
          setDeployStatus("success");
          await recordDeploy({ platform: "netlify", url: url || "", status: "success", projectName: ntSiteName });
          break;
        }

        case "cloudflare": {
          addLog(`Deploying to Cloudflare Pages: ${cfProjectName}`);
          result = await post("/api/cloud/cloudflare/deploy", {
            projectId: pid,
            projectName: cfProjectName,
            branch: cfBranch,
          });
          if (result.error) throw new Error(result.error);
          const url = result.url || result.deploymentUrl;
          addLog(`Deployed! URL: ${url}`);
          setDeployUrl(url || "");
          setDeployStatus("success");
          await recordDeploy({ platform: "cloudflare", url: url || "", status: "success", projectName: cfProjectName });
          break;
        }
      }

      window.dispatchEvent(new CustomEvent("pipilot:notify", { detail: { type: "success", title: `${plat.name} Deploy Complete`, message: deployUrl || "Deployment successful" } }));
    } catch (err: any) {
      const msg = err.message || "Deployment failed";
      addLog(`ERROR: ${msg}`);
      setDeployError(msg);
      setDeployStatus("error");
      await recordDeploy({ platform, url: "", status: "error", projectName: platform === "github" ? ghRepoName : platform === "vercel" ? vcProjectName : platform === "netlify" ? ntSiteName : cfProjectName, message: msg });
    }
  };

  // Puter needs no token — it's free/anonymous. All others need a connector token.
  const isConnected = platform === "puter" ? true : connStatus[platform];

  // ── Render ───────────────────────────────────────────────────────────

  if (!pid) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.textDim, fontFamily: F.s, fontSize: 13 }}>
        Open a project to deploy
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, overflow: "hidden" }}>
      {/* ── Header ── */}
      <div style={{
        padding: "16px 24px 12px", borderBottom: `1px solid ${C.border}`,
        background: C.surface,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Rocket size={16} style={{ color: C.accent }} />
          <span style={{ fontFamily: F.m, fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Deploy
          </span>
          <span style={{ fontFamily: F.m, fontSize: 9, color: C.textFaint }}>
            {pid.length > 20 ? pid.slice(0, 20) + "..." : pid}
          </span>
        </div>

        {/* ── Platform Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {PLATFORMS.map((p) => {
            const active = platform === p.id;
            const connected = p.id === "puter" ? true : connStatus[p.id];
            return (
              <button
                key={p.id}
                onClick={() => { setPlatform(p.id); setDeployStatus("idle"); setLogs([]); }}
                style={{
                  position: "relative", padding: "12px 10px", borderRadius: 8, border: "none",
                  background: active ? `${C.accent}12` : C.surfaceAlt,
                  outline: active ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                  cursor: "pointer", textAlign: "left", transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ color: active ? C.accent : p.color, filter: active ? "none" : "brightness(0.7)" }}>
                    {p.icon}
                  </span>
                  <span style={{ fontFamily: F.m, fontSize: 10, fontWeight: 700, color: active ? C.text : C.textMid, letterSpacing: "0.04em" }}>
                    {p.name}
                  </span>
                </div>
                <div style={{ fontFamily: F.s, fontSize: 9, color: C.textDim, lineHeight: 1.3 }}>
                  {p.description}
                </div>
                {/* Connection badge */}
                <div style={{
                  position: "absolute", top: 6, right: 6,
                  width: 6, height: 6, borderRadius: 6,
                  background: connected ? C.ok : C.textFaint,
                }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content Area ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {/* Token warning */}
        {!isConnected && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
            background: `${C.warn}10`, border: `1px solid ${C.warn}30`, borderRadius: 6, marginBottom: 16,
          }}>
            <AlertCircle size={14} style={{ color: C.warn, flexShrink: 0 }} />
            <span style={{ fontFamily: F.s, fontSize: 11, color: C.warn }}>
              {PLATFORMS.find((p) => p.id === platform)?.name} token not configured. Add it in the
              <button onClick={() => { const e = new CustomEvent("pipilot:open-cloud"); window.dispatchEvent(e); }} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontFamily: F.s, fontSize: 11, textDecoration: "underline", padding: "0 3px" }}>
                Cloud panel
              </button>
              first.
            </span>
          </div>
        )}

        {/* ── Deploy Form (per platform) ── */}
        {deployStatus === "idle" && (
          <div style={{ maxWidth: 520 }}>
            {/* Puter — free static hosting */}
            {platform === "puter" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {hasPackageJson && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                    background: `${C.error}10`, border: `1px solid ${C.error}30`, borderRadius: 6,
                  }}>
                    <XCircle size={14} style={{ color: C.error, flexShrink: 0 }} />
                    <span style={{ fontFamily: F.s, fontSize: 11, color: C.error }}>
                      Puter only supports static sites (HTML/CSS/JS). This project has a package.json — use Vercel, Netlify, or Cloudflare instead.
                    </span>
                  </div>
                )}
                {!hasPackageJson && (
                  <>
                    <div style={{
                      padding: "10px 14px", background: `${C.ok}08`, border: `1px solid ${C.ok}20`, borderRadius: 6,
                    }}>
                      <span style={{ fontFamily: F.s, fontSize: 11, color: C.ok }}>
                        Free instant hosting — no account needed. Your static site will be live at <span style={{ fontFamily: F.m, fontSize: 10 }}>{puterSlug || "your-project"}.puter.site</span>
                      </span>
                    </div>
                    <div>
                      <label style={labelStyle}>Site Slug</label>
                      <input value={puterSlug} onChange={(e) => setPuterSlug(e.target.value)} style={inputStyle} placeholder="my-site" />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* GitHub */}
            {platform === "github" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Mode selector */}
                <div>
                  <label style={labelStyle}>Mode</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["new", "existing"] as const).map((m) => (
                      <button key={m} onClick={() => setGhMode(m)} style={{
                        ...btnGhost, flex: 1, fontSize: 10,
                        background: ghMode === m ? `${C.accent}15` : "transparent",
                        borderColor: ghMode === m ? C.accent : C.border,
                        color: ghMode === m ? C.accent : C.textMid,
                      }}>
                        {m === "new" ? "Create New Repo" : "Push to Existing"}
                      </button>
                    ))}
                  </div>
                </div>

                {ghMode === "new" ? (
                  <>
                    <div>
                      <label style={labelStyle}>Repository Name</label>
                      <input value={ghRepoName} onChange={(e) => setGhRepoName(e.target.value)} style={inputStyle} placeholder="my-project" />
                    </div>
                    <div>
                      <label style={labelStyle}>Description</label>
                      <input value={ghDescription} onChange={(e) => setGhDescription(e.target.value)} style={inputStyle} placeholder="Optional description..." />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={ghPrivate} onChange={(e) => setGhPrivate(e.target.checked)} id="gh-private" />
                      <label htmlFor="gh-private" style={{ fontFamily: F.s, fontSize: 11, color: C.textMid, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                        <Lock size={10} /> Private repository
                      </label>
                    </div>
                  </>
                ) : (
                  <div>
                    <label style={labelStyle}>Select Repository</label>
                    <select
                      value={ghSelectedRepo}
                      onChange={(e) => setGhSelectedRepo(e.target.value)}
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="">-- Select a repository --</option>
                      {ghRepos.map((r: any) => (
                        <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label style={labelStyle}>Commit Message</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={ghCommitMsg} onChange={(e) => setGhCommitMsg(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="feat: initial commit" />
                    <button
                      onClick={async () => {
                        setGeneratingMsg(true);
                        try {
                          const res = await post("/api/ai/commit-message", { projectId: pid });
                          if (res.message) setGhCommitMsg(res.message);
                        } catch {}
                        setGeneratingMsg(false);
                      }}
                      disabled={generatingMsg}
                      style={{ ...btnGhost, padding: "6px 10px", flexShrink: 0 }}
                      title="Generate commit message with AI"
                    >
                      {generatingMsg ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Vercel */}
            {platform === "vercel" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Project Name</label>
                  <input value={vcProjectName} onChange={(e) => setVcProjectName(e.target.value)} style={inputStyle} placeholder="my-app" />
                </div>
                <div>
                  <label style={labelStyle}>Framework</label>
                  <select value={vcFramework} onChange={(e) => setVcFramework(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                    <option value="auto">Auto-detect</option>
                    <option value="nextjs">Next.js</option>
                    <option value="vite">Vite</option>
                    <option value="create-react-app">Create React App</option>
                    <option value="vue">Vue</option>
                    <option value="nuxtjs">Nuxt.js</option>
                    <option value="svelte">SvelteKit</option>
                    <option value="angular">Angular</option>
                    <option value="gatsby">Gatsby</option>
                    <option value="astro">Astro</option>
                    <option value="remix">Remix</option>
                  </select>
                </div>
              </div>
            )}

            {/* Netlify */}
            {platform === "netlify" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Site Name</label>
                  <input value={ntSiteName} onChange={(e) => setNtSiteName(e.target.value)} style={inputStyle} placeholder="my-site" />
                </div>
                <div>
                  <label style={labelStyle}>Build Command</label>
                  <input value={ntBuildCmd} onChange={(e) => setNtBuildCmd(e.target.value)} style={inputStyle} placeholder="npm run build" />
                </div>
                <div>
                  <label style={labelStyle}>Publish Directory</label>
                  <input value={ntPublishDir} onChange={(e) => setNtPublishDir(e.target.value)} style={inputStyle} placeholder="dist" />
                </div>
              </div>
            )}

            {/* Cloudflare */}
            {platform === "cloudflare" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Project Name</label>
                  <input value={cfProjectName} onChange={(e) => setCfProjectName(e.target.value)} style={inputStyle} placeholder="my-pages-project" />
                </div>
                <div>
                  <label style={labelStyle}>Production Branch</label>
                  <input value={cfBranch} onChange={(e) => setCfBranch(e.target.value)} style={inputStyle} placeholder="main" />
                </div>
              </div>
            )}

            {/* Deploy button */}
            <div style={{ marginTop: 20 }}>
              <button
                onClick={handleDeploy}
                disabled={!isConnected || deployStatus === "deploying" || (platform === "puter" && hasPackageJson)}
                style={{
                  ...btnPrimary, width: "100%", padding: "10px 20px", fontSize: 12,
                  opacity: (!isConnected || (platform === "puter" && hasPackageJson)) ? 0.4 : 1,
                  cursor: (!isConnected || (platform === "puter" && hasPackageJson)) ? "not-allowed" : "pointer",
                }}
              >
                <Rocket size={13} />
                Deploy to {PLATFORMS.find((p) => p.id === platform)?.name}
              </button>
            </div>
          </div>
        )}

        {/* ── Deploying / Progress ── */}
        {deployStatus === "deploying" && (
          <div style={{ maxWidth: 600 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Loader2 size={16} className="animate-spin" style={{ color: C.accent }} />
              <span style={{ fontFamily: F.m, fontSize: 11, fontWeight: 600, color: C.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Deploying to {PLATFORMS.find((p) => p.id === platform)?.name}...
              </span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: "hidden", marginBottom: 16 }}>
              <div style={{
                height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`,
                animation: "deploy-progress 2s ease-in-out infinite",
              }} />
              <style>{`@keyframes deploy-progress { 0%{width:0;margin-left:0} 50%{width:60%;margin-left:20%} 100%{width:0;margin-left:100%} }`}</style>
            </div>
            {/* Logs */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              padding: "10px 12px", maxHeight: 250, overflowY: "auto",
              fontFamily: F.m, fontSize: 10, color: C.textMid, lineHeight: 1.6,
            }}>
              {logs.map((l, i) => (
                <div key={i} style={{ color: l.includes("ERROR") ? C.error : l.includes("!") ? C.ok : C.textMid }}>{l}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* ── Success ── */}
        {deployStatus === "success" && (
          <div style={{ maxWidth: 520 }}>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
              padding: "32px 20px", background: `${C.ok}08`, border: `1px solid ${C.ok}25`,
              borderRadius: 10, textAlign: "center",
            }}>
              <CheckCircle2 size={32} style={{ color: C.ok }} />
              <div style={{ fontFamily: F.m, fontSize: 12, fontWeight: 700, color: C.ok, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Deployed Successfully
              </div>
              {deployUrl && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` }}>
                  <span style={{ fontFamily: F.m, fontSize: 11, color: C.info, wordBreak: "break-all" }}>{deployUrl}</span>
                  <button onClick={() => navigator.clipboard.writeText(deployUrl)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2 }}>
                    <Copy size={11} />
                  </button>
                  <button onClick={() => window.open(deployUrl, "_blank")} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2 }}>
                    <ExternalLink size={11} />
                  </button>
                </div>
              )}
              <button onClick={() => { setDeployStatus("idle"); setLogs([]); }} style={{ ...btnGhost, marginTop: 8, fontSize: 10 }}>
                Deploy Again
              </button>
            </div>

            {/* Logs */}
            {logs.length > 0 && (
              <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px", maxHeight: 150, overflowY: "auto" }}>
                <div style={{ fontFamily: F.m, fontSize: 8, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Build Log</div>
                {logs.map((l, i) => (
                  <div key={i} style={{ fontFamily: F.m, fontSize: 10, color: l.includes("ERROR") ? C.error : C.textMid, lineHeight: 1.5 }}>{l}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {deployStatus === "error" && (
          <div style={{ maxWidth: 520 }}>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              padding: "24px 20px", background: `${C.error}08`, border: `1px solid ${C.error}25`,
              borderRadius: 10, textAlign: "center",
            }}>
              <XCircle size={28} style={{ color: C.error }} />
              <div style={{ fontFamily: F.m, fontSize: 11, fontWeight: 700, color: C.error, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Deployment Failed
              </div>
              <div style={{ fontFamily: F.s, fontSize: 12, color: C.textMid }}>{deployError}</div>
              <button onClick={() => { setDeployStatus("idle"); setLogs([]); }} style={{ ...btnGhost, marginTop: 6, fontSize: 10 }}>
                Try Again
              </button>
            </div>
            {logs.length > 0 && (
              <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px", maxHeight: 200, overflowY: "auto" }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ fontFamily: F.m, fontSize: 10, color: l.includes("ERROR") ? C.error : C.textMid, lineHeight: 1.5 }}>{l}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Deployment History ── */}
        {deployStatus === "idle" && history.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ ...labelStyle, marginBottom: 10 }}>Recent Deployments</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.slice(0, 8).map((d) => {
                const plat = PLATFORMS.find((p) => p.id === d.platform);
                return (
                  <div key={d.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 12px", background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 6,
                  }}>
                    <span style={{ color: plat?.color || C.textDim, filter: "brightness(0.8)", flexShrink: 0 }}>
                      {plat?.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F.m, fontSize: 10, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.projectName}
                      </div>
                      {d.message && (
                        <div style={{ fontFamily: F.s, fontSize: 9, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.message}
                        </div>
                      )}
                    </div>
                    <div style={{
                      width: 6, height: 6, borderRadius: 6, flexShrink: 0,
                      background: d.status === "success" ? C.ok : C.error,
                    }} />
                    <span style={{ fontFamily: F.m, fontSize: 8, color: C.textFaint, flexShrink: 0 }}>
                      {timeAgo(d.createdAt)}
                    </span>
                    {d.url && d.status === "success" && (
                      <button onClick={() => window.open(d.url, "_blank")} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2, flexShrink: 0 }}>
                        <ExternalLink size={10} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
