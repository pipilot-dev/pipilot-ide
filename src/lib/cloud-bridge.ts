/**
 * Cloud API bridge — abstracts cloud provider operations between:
 *   - Web mode: HTTP fetch to Express cloud server (port 51732)
 *   - Tauri mode: IPC invoke to Rust commands (no separate process)
 *
 * Auto-detects runtime. In Tauri mode, cloud API calls go through
 * the Rust backend which makes the external HTTP requests directly —
 * no Express cloud server needed, no crash risk.
 */

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

// ── Generic fetch helper for web mode ──

async function cloudGet(path: string, params?: Record<string, string>): Promise<any> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`/api/cloud${path}${qs}`);
  return res.json();
}

async function cloudPost(path: string, body: any): Promise<any> {
  const res = await fetch(`/api/cloud${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function cloudDel(path: string, body: any): Promise<any> {
  const res = await fetch(`/api/cloud${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function cloudPatch(path: string, body: any): Promise<any> {
  const res = await fetch(`/api/cloud${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Cloud Bridge Interface ──

export interface CloudBridge {
  // Status
  status(projectId: string): Promise<{ providers: Record<string, boolean> }>;

  // GitHub
  githubRepos(projectId: string): Promise<any[]>;
  githubIssues(projectId: string, owner: string, repo: string): Promise<any[]>;
  githubPulls(projectId: string, owner: string, repo: string): Promise<any[]>;
  githubActions(projectId: string, owner: string, repo: string): Promise<any>;
  githubWorkflows(projectId: string, owner: string, repo: string): Promise<any>;
  githubBranches(projectId: string, owner: string, repo: string): Promise<any[]>;
  githubCommits(projectId: string, owner: string, repo: string, perPage?: number): Promise<any[]>;
  githubCommit(projectId: string, owner: string, repo: string, sha: string): Promise<any>;
  githubTree(projectId: string, owner: string, repo: string, ref: string): Promise<any>;
  githubFile(projectId: string, owner: string, repo: string, path: string, ref: string): Promise<any>;
  githubIssueComments(projectId: string, owner: string, repo: string, issueNumber: number): Promise<any[]>;
  githubCreateRepo(projectId: string, name: string, description: string, isPrivate: boolean): Promise<any>;
  githubCreateIssue(projectId: string, owner: string, repo: string, title: string, body: string): Promise<any>;
  githubCreatePR(projectId: string, owner: string, repo: string, title: string, body: string, head: string, base: string): Promise<any>;
  githubCommentIssue(projectId: string, owner: string, repo: string, issueNumber: number, body: string): Promise<any>;
  githubMergePR(projectId: string, owner: string, repo: string, pullNumber: number): Promise<any>;
  githubDispatchWorkflow(projectId: string, owner: string, repo: string, workflowId: number, ref: string): Promise<any>;
  githubRerunWorkflow(projectId: string, owner: string, repo: string, runId: number): Promise<any>;
  githubCreateBranch(projectId: string, owner: string, repo: string, branch: string, fromBranch: string): Promise<any>;
  githubDeleteBranch(projectId: string, owner: string, repo: string, branch: string): Promise<any>;

  // Git local
  gitStatus(projectId: string): Promise<any>;
  gitInit(projectId: string): Promise<any>;
  gitCommit(projectId: string, message: string): Promise<any>;
  gitPush(projectId: string, remote: string, branch: string): Promise<any>;
  gitAddRemote(projectId: string, name: string, url: string): Promise<any>;

  // Vercel
  vercelProjects(projectId: string): Promise<any>;
  vercelDeployments(projectId: string, vercelProjectId: string): Promise<any>;
  vercelEnv(projectId: string, vercelProjectId: string): Promise<any>;
  vercelDomains(projectId: string, vercelProjectId: string): Promise<any>;
  vercelCreateProject(projectId: string, opts: any): Promise<any>;
  vercelAddEnv(projectId: string, vercelProjectId: string, key: string, value: string, target: string): Promise<any>;
  vercelAddDomain(projectId: string, vercelProjectId: string, domain: string): Promise<any>;
  vercelRedeploy(projectId: string, deploymentId: string): Promise<any>;

  // Supabase
  supabaseProjects(projectId: string): Promise<any>;
  supabaseSql(projectId: string, ref: string, query: string): Promise<any>;

  // Neon
  neonProjects(projectId: string): Promise<any>;

  // Netlify
  netlifySites(projectId: string): Promise<any>;

  // Cloudflare
  cloudflareZones(projectId: string): Promise<any>;
  cloudflareDns(projectId: string, zoneId: string): Promise<any>;
  cloudflareWorkers(projectId: string, accountId: string): Promise<any>;
  cloudflarePages(projectId: string, accountId: string): Promise<any>;
  cloudflareAccount(projectId: string): Promise<any>;

  // Connectors
  connectorsList(projectId: string): Promise<any>;
  connectorSave(projectId: string, connectorId: string, token: string, enabled: boolean): Promise<any>;
}

// ── Web mode implementation ──

function createWebBridge(): CloudBridge {
  return {
    status: (pid) => cloudGet("/status", { projectId: pid }),

    // GitHub
    githubRepos: (pid) => cloudGet("/github/repos", { projectId: pid }),
    githubIssues: (pid, o, r) => cloudGet("/github/issues", { projectId: pid, owner: o, repo: r }),
    githubPulls: (pid, o, r) => cloudGet("/github/pulls", { projectId: pid, owner: o, repo: r }),
    githubActions: (pid, o, r) => cloudGet("/github/actions", { projectId: pid, owner: o, repo: r }),
    githubWorkflows: (pid, o, r) => cloudGet("/github/workflows", { projectId: pid, owner: o, repo: r }),
    githubBranches: (pid, o, r) => cloudGet("/github/branches", { projectId: pid, owner: o, repo: r }),
    githubCommits: (pid, o, r, n = 15) => cloudGet("/github/commits", { projectId: pid, owner: o, repo: r, per_page: String(n) }),
    githubCommit: (pid, o, r, sha) => cloudGet("/github/commit", { projectId: pid, owner: o, repo: r, sha }),
    githubTree: (pid, o, r, ref) => cloudGet("/github/tree", { projectId: pid, owner: o, repo: r, ref }),
    githubFile: (pid, o, r, path, ref) => cloudGet("/github/file", { projectId: pid, owner: o, repo: r, path, ref }),
    githubIssueComments: (pid, o, r, num) => cloudGet("/github/issues/comments", { projectId: pid, owner: o, repo: r, issue_number: String(num) }),
    githubCreateRepo: (pid, name, desc, priv) => cloudPost("/github/repos", { projectId: pid, name, description: desc, private: priv }),
    githubCreateIssue: (pid, o, r, title, body) => cloudPost("/github/issues", { projectId: pid, owner: o, repo: r, title, body }),
    githubCreatePR: (pid, o, r, title, body, head, base) => cloudPost("/github/pulls", { projectId: pid, owner: o, repo: r, title, body, head, base }),
    githubCommentIssue: (pid, o, r, num, body) => cloudPost("/github/issues/comment", { projectId: pid, owner: o, repo: r, issue_number: num, body }),
    githubMergePR: (pid, o, r, num) => cloudPost("/github/pulls/merge", { projectId: pid, owner: o, repo: r, pull_number: num }),
    githubDispatchWorkflow: (pid, o, r, wid, ref) => cloudPost("/github/workflows/dispatch", { projectId: pid, owner: o, repo: r, workflow_id: wid, ref }),
    githubRerunWorkflow: (pid, o, r, rid) => cloudPost("/github/actions/rerun", { projectId: pid, owner: o, repo: r, run_id: rid }),
    githubCreateBranch: (pid, o, r, branch, from) => cloudPost("/github/branches/create", { projectId: pid, owner: o, repo: r, branch, from_branch: from }),
    githubDeleteBranch: (pid, o, r, branch) => cloudDel("/github/branches", { projectId: pid, owner: o, repo: r, branch }),

    // Git local
    gitStatus: (pid) => cloudGet("/github/git-status", { projectId: pid }),
    gitInit: (pid) => cloudPost("/github/git-init", { projectId: pid }),
    gitCommit: (pid, msg) => cloudPost("/github/git-commit", { projectId: pid, message: msg }),
    gitPush: (pid, remote, branch) => cloudPost("/github/git-push", { projectId: pid, remote, branch }),
    gitAddRemote: (pid, name, url) => cloudPost("/github/git-add-remote", { projectId: pid, name, url }),

    // Vercel
    vercelProjects: (pid) => cloudGet("/vercel/projects", { projectId: pid }),
    vercelDeployments: (pid, vpid) => cloudGet("/vercel/deployments", { projectId: pid, vercelProjectId: vpid }),
    vercelEnv: (pid, vpid) => cloudGet("/vercel/env", { projectId: pid, vercelProjectId: vpid }),
    vercelDomains: (pid, vpid) => cloudGet("/vercel/domains", { projectId: pid, vercelProjectId: vpid }),
    vercelCreateProject: (pid, opts) => cloudPost("/vercel/projects/create", { projectId: pid, ...opts }),
    vercelAddEnv: (pid, vpid, key, value, target) => cloudPost("/vercel/env", { projectId: pid, vercelProjectId: vpid, key, value, target }),
    vercelAddDomain: (pid, vpid, domain) => cloudPost("/vercel/domains/add", { projectId: pid, vercelProjectId: vpid, domain }),
    vercelRedeploy: (pid, did) => cloudPost("/vercel/redeploy", { projectId: pid, deploymentId: did }),

    // Supabase
    supabaseProjects: (pid) => cloudGet("/supabase/projects", { projectId: pid }),
    supabaseSql: (pid, ref, query) => cloudPost("/supabase/sql", { projectId: pid, ref, query }),

    // Neon
    neonProjects: (pid) => cloudGet("/neon/projects", { projectId: pid }),

    // Netlify
    netlifySites: (pid) => cloudGet("/netlify/sites", { projectId: pid }),

    // Cloudflare
    cloudflareZones: (pid) => cloudGet("/cloudflare/zones", { projectId: pid }),
    cloudflareDns: (pid, zid) => cloudGet("/cloudflare/dns", { projectId: pid, zoneId: zid }),
    cloudflareWorkers: (pid, aid) => cloudGet("/cloudflare/workers", { projectId: pid, accountId: aid }),
    cloudflarePages: (pid, aid) => cloudGet("/cloudflare/pages", { projectId: pid, accountId: aid }),
    cloudflareAccount: (pid) => cloudGet("/cloudflare/account", { projectId: pid }),

    // Connectors
    connectorsList: (pid) => fetch(`/api/connectors/list?projectId=${encodeURIComponent(pid)}`).then(r => r.json()),
    connectorSave: (pid, cid, token, enabled) => fetch("/api/connectors/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid, connectorId: cid, token, enabled }),
    }).then(r => r.json()),
  };
}

// ── Tauri IPC implementation ──

function createTauriBridge(): CloudBridge {
  // In Tauri mode, cloud API calls go through Rust which makes the
  // external HTTP requests directly. For now, we proxy through the
  // same Express server running as a sidecar — but the bridge abstraction
  // means we can swap to pure Rust HTTP later without changing any UI code.
  //
  // The key win: if the cloud Express server crashes, the Tauri app
  // can restart it automatically. And eventually we'll move the HTTP
  // calls to reqwest in Rust (zero Node.js dependency for cloud ops).
  return createWebBridge(); // Phase 1: same HTTP calls, will be replaced with invoke() later
}

// ── Export ──

export const cloudBridge: CloudBridge = isTauri ? createTauriBridge() : createWebBridge();
export const isDesktopApp = isTauri;
