/**
 * Cloud IPC handlers — GitHub, Vercel, Supabase, Netlify, Cloudflare, npm, Neon.
 * Ported from server/cloud.ts.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir } from "./shared";

function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

function getToken(projectId: string, connectorId: string): string | null {
  try {
    const p = path.join(getWorkDir(projectId), ".pipilot", "connectors.json");
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const c = data.connectors?.[connectorId];
    return c?.enabled && c?.token ? c.token : null;
  } catch { return null; }
}

export function registerCloudHandlers(ctx: IpcContext) {
  const { get, post, del } = ctx;

  // ── Status ──
  get("/api/cloud/status", async ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");
    const providers = ["github", "vercel", "supabase", "neon", "netlify", "cloudflare", "npm"];
    const status: Record<string, boolean> = {};
    for (const p of providers) status[p] = !!getToken(projectId, p);
    return { providers: status };
  });

  // ── GitHub read ──

  get("/api/cloud/github/user", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/repos", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const page = query?.page || "1";
    const per_page = query?.per_page || "30";
    const r = await fetch(`https://api.github.com/user/repos?sort=updated&page=${page}&per_page=${per_page}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/repo", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/issues", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/issues?state=open&per_page=30`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/issues/comments", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/issues/${query?.issue_number}/comments?per_page=50`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/pulls", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/pulls?state=open&per_page=30`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/actions", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/actions/runs?per_page=10`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/actions/logs", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/actions/runs/${query?.run_id}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    const data = await r.json() as any;
    return { logs_url: data.logs_url, html_url: data.html_url, jobs_url: data.jobs_url };
  });

  get("/api/cloud/github/workflows", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/actions/workflows`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/branches", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/branches`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/commits", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const per_page = query?.per_page || "30";
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/commits?per_page=${per_page}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/commit", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/commits/${query?.sha}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/commit/diff", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/commits/${query?.sha}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.diff" } });
    const diff = await r.text();
    return { diff };
  });

  get("/api/cloud/github/tree", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/git/trees/${query?.ref}?recursive=1`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    return r.json();
  });

  get("/api/cloud/github/file", async ({ query }) => {
    const token = getToken(query?.projectId as string, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${query?.owner}/${query?.repo}/contents/${query?.path}?ref=${query?.ref}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    const data = await r.json() as any;
    const content = data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf8") : data.content;
    return { content, name: data.name, path: data.path, size: data.size, sha: data.sha };
  });

  get("/api/cloud/github/git-status", ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    try {
      const branch = execSync("git branch --show-current", { cwd: workDir, encoding: "utf8" }).trim();
      const porcelain = execSync("git status --porcelain", { cwd: workDir, encoding: "utf8" }).trim();
      const changedFiles = porcelain ? porcelain.split("\n").length : 0;
      let remotes: { name: string; url: string }[] = [];
      try {
        const remoteOut = execSync("git remote -v", { cwd: workDir, encoding: "utf8" }).trim();
        if (remoteOut) {
          const seen = new Set<string>();
          for (const line of remoteOut.split("\n")) {
            const parts = line.split(/\s+/);
            const key = parts[0];
            if (!seen.has(key)) { seen.add(key); remotes.push({ name: parts[0], url: parts[1] }); }
          }
        }
      } catch { /* no remotes */ }
      return { isRepo: true, branch, changedFiles, remotes, hasUncommittedChanges: changedFiles > 0 };
    } catch {
      return { isRepo: false, branch: "", changedFiles: 0, remotes: [], hasUncommittedChanges: false };
    }
  });

  // ── GitHub write ──

  post("/api/cloud/github/repos", async ({ body }) => {
    const { projectId, name, description, private: isPrivate } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, private: isPrivate }),
    });
    return r.json();
  });

  del("/api/cloud/github/repos", async ({ body }) => {
    const { projectId, owner, repo } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (r.status === 204) return { ok: true };
    return r.json();
  });

  post("/api/cloud/github/issues", async ({ body }) => {
    const { projectId, owner, repo, title, body: issueBody } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: issueBody }),
    });
    return r.json();
  });

  post("/api/cloud/github/issues/comment", async ({ body }) => {
    const { projectId, owner, repo, issue_number, body: commentBody } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentBody }),
    });
    return r.json();
  });

  post("/api/cloud/github/issues/patch", async ({ body }) => {
    const { projectId, owner, repo, issue_number, state } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return r.json();
  });

  post("/api/cloud/github/pulls", async ({ body }) => {
    const { projectId, owner, repo, title, body: prBody, head, base } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: prBody, head, base }),
    });
    return r.json();
  });

  post("/api/cloud/github/pulls/merge", async ({ body }) => {
    const { projectId, owner, repo, pull_number } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/merge`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    return r.json();
  });

  post("/api/cloud/github/branches/create", async ({ body }) => {
    const { projectId, owner, repo, branch, from_branch } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${from_branch}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    const refData = await refRes.json() as any;
    const sha = refData.object?.sha;
    if (!sha) throw new Error("Could not resolve source branch SHA");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    return r.json();
  });

  del("/api/cloud/github/branches", async ({ body }) => {
    const { projectId, owner, repo, branch } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (r.status === 204) return { ok: true };
    return r.json();
  });

  post("/api/cloud/github/workflows/dispatch", async ({ body }) => {
    const { projectId, owner, repo, workflow_id, ref } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: ref || "main" }),
    });
    if (r.status === 204 || r.status === 201) return { success: true };
    return r.json();
  });

  post("/api/cloud/github/actions/rerun", async ({ body }) => {
    const { projectId, owner, repo, run_id } = body;
    const token = getToken(projectId, "github");
    if (!token) throw new Error("GitHub not connected");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run_id}/rerun`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (r.status === 201 || r.status === 204) return { success: true };
    return r.json();
  });

  post("/api/cloud/github/git-init", ({ body }) => {
    const { projectId } = body;
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    execSync("git init", { cwd: workDir, encoding: "utf8" });
    return { ok: true };
  });

  post("/api/cloud/github/git-commit", ({ body }) => {
    const { projectId, message } = body;
    if (!projectId || !message) throw new Error("projectId and message required");
    const workDir = getWorkDir(projectId);
    execSync("git add -A", { cwd: workDir, encoding: "utf8" });
    execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: workDir, encoding: "utf8" });
    return { ok: true };
  });

  post("/api/cloud/github/git-push", ({ body }) => {
    const { projectId, remote, branch } = body;
    if (!projectId || !remote || !branch) throw new Error("projectId, remote, and branch required");
    const workDir = getWorkDir(projectId);
    execSync(`git push ${remote} ${branch}`, { cwd: workDir, encoding: "utf8" });
    return { ok: true };
  });

  post("/api/cloud/github/git-add-remote", ({ body }) => {
    const { projectId, name, url } = body;
    if (!projectId || !name || !url) throw new Error("projectId, name, and url required");
    const workDir = getWorkDir(projectId);
    execSync(`git remote add ${name} ${url}`, { cwd: workDir, encoding: "utf8" });
    return { ok: true };
  });

  // ── Vercel ──

  get("/api/cloud/vercel/user", async ({ query }) => {
    const token = getToken(query?.projectId as string, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/vercel/projects", async ({ query }) => {
    const token = getToken(query?.projectId as string, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch("https://api.vercel.com/v9/projects?limit=20", { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/vercel/deployments", async ({ query }) => {
    const token = getToken(query?.projectId as string, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const vpid = query?.vercelProjectId || "";
    const url = vpid ? `https://api.vercel.com/v6/deployments?projectId=${vpid}&limit=10` : `https://api.vercel.com/v6/deployments?limit=10`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/vercel/domains", async ({ query }) => {
    const token = getToken(query?.projectId as string, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v9/projects/${query?.vercelProjectId}/domains`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/vercel/env", async ({ query }) => {
    const token = getToken(query?.projectId as string, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v9/projects/${query?.vercelProjectId}/env`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/vercel/deployment/events", async ({ query }) => {
    const token = getToken(query?.projectId as string, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v2/deployments/${query?.deploymentId}/events`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  post("/api/cloud/vercel/deploy", async ({ body }) => {
    const { projectId, projectName, framework } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected. Add your token in the Cloud panel.");

    const crypto = await import("crypto");
    const workDir = getWorkDir(projectId);
    const skip = new Set(["node_modules", ".git", ".next", ".cache", "dist", "build", ".vite", ".pipilot", "coverage", ".turbo"]);

    const files: { file: string; sha: string; size: number; data: Buffer }[] = [];
    const walkFiles = (dir: string, prefix: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walkFiles(full, rel);
          } else {
            const stat = fs.statSync(full);
            if (stat.size > 50 * 1024 * 1024) continue;
            const data = fs.readFileSync(full);
            const sha = crypto.createHash("sha1").update(data).digest("hex");
            files.push({ file: rel, sha, size: data.length, data });
          }
        }
      } catch {}
    };
    walkFiles(workDir, "");

    if (files.length === 0) throw new Error("No files found in project");

    for (const f of files) {
      await fetch("https://api.vercel.com/v2/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "x-vercel-digest": f.sha,
          "x-vercel-size": String(f.size),
        },
        body: f.data,
      });
    }

    const deployBody: any = {
      name: projectName || projectId,
      files: files.map((f) => ({ file: f.file, sha: f.sha, size: f.size })),
      projectSettings: {},
    };
    if (framework && framework !== "auto") {
      deployBody.projectSettings.framework = framework;
    }

    const r = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(deployBody),
    });
    const data = await r.json() as any;

    if (data.error) throw new Error(data.error.message || data.error.code || "Vercel deployment failed");

    const url = data.url ? `https://${data.url}` : data.alias?.[0] ? `https://${data.alias[0]}` : "";
    return { success: true, url, deploymentUrl: url, id: data.id, readyState: data.readyState };
  });

  del("/api/cloud/vercel/deployments", async ({ body }) => {
    const { projectId, deploymentId } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 204) return { ok: true };
    return r.json();
  });

  post("/api/cloud/vercel/env", async ({ body }) => {
    const { projectId, vercelProjectId, key, value, target } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, target: [target] }),
    });
    return r.json();
  });

  del("/api/cloud/vercel/env", async ({ body }) => {
    const { projectId, vercelProjectId, envId } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env/${envId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 204) return { ok: true };
    return r.json();
  });

  post("/api/cloud/vercel/projects/create", async ({ body }) => {
    const { projectId, name, framework, gitRepository } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch("https://api.vercel.com/v10/projects", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, framework, gitRepository }),
    });
    return r.json();
  });

  del("/api/cloud/vercel/projects", async ({ body }) => {
    const { projectId, vercelProjectId } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v9/projects/${vercelProjectId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 204) return { ok: true };
    return r.json();
  });

  post("/api/cloud/vercel/domains/add", async ({ body }) => {
    const { projectId, vercelProjectId, domain } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/domains`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: domain }),
    });
    return r.json();
  });

  del("/api/cloud/vercel/domains", async ({ body }) => {
    const { projectId, vercelProjectId, domain } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v9/projects/${vercelProjectId}/domains/${domain}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 204) return { ok: true };
    return r.json();
  });

  post("/api/cloud/vercel/redeploy", async ({ body }) => {
    const { projectId, deploymentId } = body;
    const token = getToken(projectId, "vercel");
    if (!token) throw new Error("Vercel not connected");
    const r = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}/redeploy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.json();
  });

  // ── Supabase ──

  get("/api/cloud/supabase/projects", async ({ query }) => {
    const token = getToken(query?.projectId as string, "supabase");
    if (!token) throw new Error("Supabase not connected");
    const r = await fetch("https://api.supabase.com/v1/projects", { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/supabase/tables", async ({ query }) => {
    const token = getToken(query?.projectId as string, "supabase");
    if (!token) throw new Error("Supabase not connected");
    const ref = query?.ref as string;
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/tables`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const r2 = await fetch(`https://${ref}.supabase.co/rest/v1/`, { headers: { apikey: token, Authorization: `Bearer ${token}` } });
      return r2.json();
    }
    return r.json();
  });

  post("/api/cloud/supabase/sql", async ({ body }) => {
    const { projectId, ref, query: sqlQuery } = body;
    const token = getToken(projectId, "supabase");
    if (!token) throw new Error("Supabase not connected");
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sqlQuery }),
    });
    return r.json();
  });

  // ── Neon ──

  get("/api/cloud/neon/projects", async ({ query }) => {
    const token = getToken(query?.projectId as string, "neon");
    if (!token) throw new Error("Neon not connected");
    const r = await fetch("https://console.neon.tech/api/v2/projects", { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/neon/branches", async ({ query }) => {
    const token = getToken(query?.projectId as string, "neon");
    if (!token) throw new Error("Neon not connected");
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${query?.neonProjectId}/branches`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  // ── Netlify ──

  get("/api/cloud/netlify/sites", async ({ query }) => {
    const token = getToken(query?.projectId as string, "netlify");
    if (!token) throw new Error("Netlify not connected");
    const r = await fetch("https://api.netlify.com/api/v1/sites?per_page=20", { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/netlify/deploys", async ({ query }) => {
    const token = getToken(query?.projectId as string, "netlify");
    if (!token) throw new Error("Netlify not connected");
    const r = await fetch(`https://api.netlify.com/api/v1/sites/${query?.siteId}/deploys?per_page=10`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  post("/api/cloud/netlify/deploy", async ({ body }) => {
    const { projectId, siteName, publishDir } = body;
    const token = getToken(projectId, "netlify");
    if (!token) throw new Error("Netlify not connected. Add your token in the Cloud panel.");

    const workDir = getWorkDir(projectId);
    const skip = new Set(["node_modules", ".git", ".next", ".cache", "dist", "build", ".vite", ".pipilot", "coverage", ".turbo"]);

    const deployDir = publishDir && fs.existsSync(path.join(workDir, publishDir))
      ? path.join(workDir, publishDir)
      : workDir;

    const crypto = await import("crypto");
    const fileDigests: Record<string, string> = {};
    const fileBuffers: Map<string, Buffer> = new Map();

    const walkFiles = (dir: string, prefix: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walkFiles(full, rel);
          } else {
            const stat = fs.statSync(full);
            if (stat.size > 50 * 1024 * 1024) continue;
            const data = fs.readFileSync(full);
            const sha = crypto.createHash("sha1").update(data).digest("hex");
            fileDigests[`/${rel}`] = sha;
            fileBuffers.set(sha, data);
          }
        }
      } catch {}
    };
    walkFiles(deployDir, "");

    if (Object.keys(fileDigests).length === 0) throw new Error("No files found in project");

    let siteId: string | null = null;
    if (siteName) {
      try {
        const listRes = await fetch("https://api.netlify.com/api/v1/sites?per_page=100", { headers: { Authorization: `Bearer ${token}` } });
        const sites = await listRes.json() as any[];
        const existing = sites.find?.((s: any) => s.name === siteName || s.subdomain === siteName);
        if (existing) siteId = existing.id;
      } catch {}

      if (!siteId) {
        const createRes = await fetch("https://api.netlify.com/api/v1/sites", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: siteName }),
        });
        const createData = await createRes.json() as any;
        if (createData.id) siteId = createData.id;
        else throw new Error(createData.message || "Failed to create Netlify site");
      }
    }

    if (!siteId) throw new Error("siteName required for deployment");

    const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: fileDigests }),
    });
    const deployData = await deployRes.json() as any;
    if (!deployData.id) throw new Error(deployData.message || "Failed to create deploy");

    const required: string[] = deployData.required || [];
    for (const sha of required) {
      const buf = fileBuffers.get(sha);
      if (!buf) continue;
      await fetch(`https://api.netlify.com/api/v1/deploys/${deployData.id}/files/${sha}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: buf,
      });
    }

    const url = deployData.ssl_url || deployData.deploy_ssl_url || `https://${siteName}.netlify.app`;
    return { success: true, url, deploymentUrl: url, id: deployData.id, siteId };
  });

  // ── Cloudflare ──

  get("/api/cloud/cloudflare/zones", async ({ query }) => {
    const token = getToken(query?.projectId as string, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    const r = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=20", { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/cloudflare/dns", async ({ query }) => {
    const token = getToken(query?.projectId as string, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    const zoneId = query?.zoneId as string;
    if (!zoneId) throw new Error("zoneId required");
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=50`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  post("/api/cloud/cloudflare/dns", async ({ body }) => {
    const { projectId, zoneId, type, name, content, ttl, proxied } = body;
    const token = getToken(projectId, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    if (!zoneId) throw new Error("zoneId required");
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type, name, content, ttl, proxied }),
    });
    return r.json();
  });

  del("/api/cloud/cloudflare/dns", async ({ body }) => {
    const { projectId, zoneId, recordId } = body;
    const token = getToken(projectId, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    if (!zoneId || !recordId) throw new Error("zoneId and recordId required");
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.json();
  });

  get("/api/cloud/cloudflare/workers", async ({ query }) => {
    const token = getToken(query?.projectId as string, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    const accountId = query?.accountId as string;
    if (!accountId) throw new Error("accountId required");
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/cloudflare/pages", async ({ query }) => {
    const token = getToken(query?.projectId as string, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    const accountId = query?.accountId as string;
    if (!accountId) throw new Error("accountId required");
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/cloudflare/pages/deployments", async ({ query }) => {
    const token = getToken(query?.projectId as string, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    const accountId = query?.accountId as string;
    const projectName = query?.projectName as string;
    if (!accountId || !projectName) throw new Error("accountId and projectName required");
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  get("/api/cloud/cloudflare/account", async ({ query }) => {
    const token = getToken(query?.projectId as string, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected");
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });

  post("/api/cloud/cloudflare/deploy", async ({ body }) => {
    const { projectId, projectName, branch } = body;
    const token = getToken(projectId, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected. Add your API token in the Cloud panel first.");
    if (!projectName) throw new Error("projectName required");

    const acctRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: { Authorization: `Bearer ${token}` } });
    const acctData = await acctRes.json() as any;
    const accountId = acctData.result?.[0]?.id;
    if (!accountId) throw new Error("No Cloudflare account found. Check your API token permissions.");

    const projRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`, { headers: { Authorization: `Bearer ${token}` } });
    if (projRes.status === 404) {
      const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, production_branch: branch || "main" }),
      });
      const createData = await createRes.json() as any;
      if (!createData.success) throw new Error(createData.errors?.[0]?.message || "Failed to create Pages project");
    }

    const workDir = getWorkDir(projectId);
    const FormData = (await import("form-data")).default;
    const formData = new FormData();

    const addFiles = (dir: string, prefix: string) => {
      const skip = new Set(["node_modules", ".git", ".next", ".cache", "dist", "build", ".pipilot", ".vite", "coverage"]);
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            addFiles(full, rel);
          } else {
            const stat = fs.statSync(full);
            if (stat.size > 25 * 1024 * 1024) continue;
            formData.append(rel, fs.readFileSync(full), { filename: rel });
          }
        }
      } catch {}
    };
    addFiles(workDir, "");

    const deployRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...formData.getHeaders() },
        body: formData as any,
      }
    );
    const deployData = await deployRes.json() as any;
    if (!deployData.success) throw new Error(deployData.errors?.[0]?.message || "Deployment failed");

    const url = deployData.result?.url || `https://${projectName}.pages.dev`;
    return { success: true, url, deploymentUrl: url, id: deployData.result?.id };
  });

  post("/api/cloud/cloudflare/workers/deploy", async ({ body }) => {
    const { projectId, workerName, entryPoint } = body;
    const token = getToken(projectId, "cloudflare");
    if (!token) throw new Error("Cloudflare not connected. Add your API token in the Cloud panel.");
    if (!workerName) throw new Error("workerName required");

    const acctRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: { Authorization: `Bearer ${token}` } });
    const acctData = await acctRes.json() as any;
    const accountId = acctData.result?.[0]?.id;
    if (!accountId) throw new Error("No Cloudflare account found");

    const workDir = getWorkDir(projectId);
    const entry = entryPoint || "src/index.ts";
    const scriptPath = path.join(workDir, entry);

    let scriptContent: string;
    if (fs.existsSync(scriptPath)) {
      scriptContent = fs.readFileSync(scriptPath, "utf8");
    } else if (fs.existsSync(path.join(workDir, "index.js"))) {
      scriptContent = fs.readFileSync(path.join(workDir, "index.js"), "utf8");
    } else if (fs.existsSync(path.join(workDir, "index.ts"))) {
      scriptContent = fs.readFileSync(path.join(workDir, "index.ts"), "utf8");
    } else {
      throw new Error(`Entry point not found: ${entry}. Create a worker script with a fetch handler.`);
    }

    const FormData = (await import("form-data")).default;
    const formData = new FormData();
    const isModule = /export\s+default/.test(scriptContent);

    if (isModule) {
      const metadata = JSON.stringify({
        main_module: "worker.js",
        compatibility_date: new Date().toISOString().split("T")[0],
      });
      formData.append("metadata", metadata, { contentType: "application/json" });
      formData.append("worker.js", scriptContent, { contentType: "application/javascript+module" });
    } else {
      formData.append("script", scriptContent, { contentType: "application/javascript" });
    }

    const deployRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, ...formData.getHeaders() },
        body: formData as any,
      }
    );
    const deployData = await deployRes.json() as any;
    if (!deployData.success) throw new Error(deployData.errors?.[0]?.message || "Worker deployment failed");

    try {
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        }
      );
    } catch {} // non-fatal

    const url = `https://${workerName}.${acctData.result?.[0]?.name || accountId}.workers.dev`;
    return { success: true, url, deploymentUrl: url, workerName };
  });

  // ── npm ──

  post("/api/cloud/npm/publish", async ({ body }) => {
    const { projectId, access, tag } = body;
    const token = getToken(projectId, "npm");
    if (!token) throw new Error("npm not connected. Add your npm token in the Cloud panel.");

    const workDir = getWorkDir(projectId);
    const pkgPath = path.join(workDir, "package.json");
    if (!fs.existsSync(pkgPath)) throw new Error("No package.json found");

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (!pkg.name) throw new Error("package.json has no 'name' field");
    if (!pkg.version) throw new Error("package.json has no 'version' field");

    const npmrcPath = path.join(workDir, ".npmrc");
    const existingNpmrc = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, "utf8") : "";
    const tokenLine = `//registry.npmjs.org/:_authToken=${token}`;
    if (!existingNpmrc.includes(tokenLine)) {
      fs.writeFileSync(npmrcPath, existingNpmrc + (existingNpmrc.endsWith("\n") ? "" : "\n") + tokenLine + "\n");
    }

    const { execSync: execS } = await import("child_process");
    const accessFlag = access === "restricted" ? "--access restricted" : "--access public";
    const tagFlag = tag && tag !== "latest" ? `--tag ${tag}` : "";
    const cmd = `npm publish ${accessFlag} ${tagFlag}`.trim();

    try {
      const output = execS(cmd, { cwd: workDir, encoding: "utf8", timeout: 60000, env: { ...process.env, NPM_TOKEN: token } });
      const url = `https://www.npmjs.com/package/${pkg.name}`;
      return { success: true, name: pkg.name, version: pkg.version, url, output: output.trim() };
    } catch (pubErr: any) {
      const stderr = pubErr.stderr || pubErr.message || "";
      throw new Error(`npm publish failed: ${stderr.slice(0, 500)}`);
    } finally {
      if (!existingNpmrc.includes(tokenLine)) {
        if (existingNpmrc) {
          fs.writeFileSync(npmrcPath, existingNpmrc);
        } else {
          try { fs.unlinkSync(npmrcPath); } catch {}
        }
      }
    }
  });
}
