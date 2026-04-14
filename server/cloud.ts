import { Router } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Accept getWorkDir as a parameter so we don't duplicate workspace resolution
export function createCloudRouter(getWorkDir: (id: string) => string) {
  const router = Router();

  // Helper: read token from .pipilot/connectors.json
  function getToken(projectId: string, connectorId: string): string | null {
    try {
      const p = path.join(getWorkDir(projectId), ".pipilot", "connectors.json");
      if (!fs.existsSync(p)) return null;
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      const c = data.connectors?.[connectorId];
      return c?.enabled && c?.token ? c.token : null;
    } catch { return null; }
  }

  // GET /api/cloud/status?projectId= — which providers are connected
  router.get("/status", (req, res) => {
    const projectId = req.query.projectId as string;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    const providers = ["github", "vercel", "supabase", "neon", "netlify"];
    const status: Record<string, boolean> = {};
    for (const p of providers) status[p] = !!getToken(projectId, p);
    res.json({ providers: status });
  });

  // ── GitHub ──

  // GET /api/cloud/github/user
  router.get("/github/user", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/repos?projectId=&page=&per_page=
  router.get("/github/repos", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    const page = req.query.page || "1";
    const per_page = req.query.per_page || "30";
    try {
      const r = await fetch(`https://api.github.com/user/repos?sort=updated&page=${page}&per_page=${per_page}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/repo?projectId=&owner=&repo=
  router.get("/github/repo", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${req.query.owner}/${req.query.repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/issues?projectId=&owner=&repo=
  router.get("/github/issues", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${req.query.owner}/${req.query.repo}/issues?state=open&per_page=30`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/pulls?projectId=&owner=&repo=
  router.get("/github/pulls", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${req.query.owner}/${req.query.repo}/pulls?state=open&per_page=30`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/actions?projectId=&owner=&repo=
  router.get("/github/actions", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${req.query.owner}/${req.query.repo}/actions/runs?per_page=10`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ── Vercel ──

  // GET /api/cloud/vercel/user
  router.get("/vercel/user", async (req, res) => {
    const token = getToken(req.query.projectId as string, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/vercel/projects
  router.get("/vercel/projects", async (req, res) => {
    const token = getToken(req.query.projectId as string, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch("https://api.vercel.com/v9/projects?limit=20", { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/vercel/deployments?projectId=&vercelProjectId=
  router.get("/vercel/deployments", async (req, res) => {
    const token = getToken(req.query.projectId as string, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    const vpid = req.query.vercelProjectId || "";
    try {
      const url = vpid ? `https://api.vercel.com/v6/deployments?projectId=${vpid}&limit=10` : `https://api.vercel.com/v6/deployments?limit=10`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/vercel/domains?projectId=&vercelProjectId=
  router.get("/vercel/domains", async (req, res) => {
    const token = getToken(req.query.projectId as string, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch(`https://api.vercel.com/v9/projects/${req.query.vercelProjectId}/domains`, { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/vercel/env?projectId=&vercelProjectId=
  router.get("/vercel/env", async (req, res) => {
    const token = getToken(req.query.projectId as string, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch(`https://api.vercel.com/v9/projects/${req.query.vercelProjectId}/env`, { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ── Supabase ──

  // GET /api/cloud/supabase/projects
  router.get("/supabase/projects", async (req, res) => {
    const token = getToken(req.query.projectId as string, "supabase");
    if (!token) return res.status(401).json({ error: "Supabase not connected" });
    try {
      const r = await fetch("https://api.supabase.com/v1/projects", { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/supabase/tables?projectId=&ref=
  router.get("/supabase/tables", async (req, res) => {
    const token = getToken(req.query.projectId as string, "supabase");
    if (!token) return res.status(401).json({ error: "Supabase not connected" });
    const ref = req.query.ref as string;
    try {
      // Use the Supabase Management API to list tables
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/tables`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        // Fallback: try the PostgREST schema endpoint
        const r2 = await fetch(`https://${ref}.supabase.co/rest/v1/`, { headers: { apikey: token, Authorization: `Bearer ${token}` } });
        res.json(await r2.json());
        return;
      }
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ── Neon ──

  // GET /api/cloud/neon/projects
  router.get("/neon/projects", async (req, res) => {
    const token = getToken(req.query.projectId as string, "neon");
    if (!token) return res.status(401).json({ error: "Neon not connected" });
    try {
      const r = await fetch("https://console.neon.tech/api/v2/projects", { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/neon/branches?projectId=&neonProjectId=
  router.get("/neon/branches", async (req, res) => {
    const token = getToken(req.query.projectId as string, "neon");
    if (!token) return res.status(401).json({ error: "Neon not connected" });
    try {
      const r = await fetch(`https://console.neon.tech/api/v2/projects/${req.query.neonProjectId}/branches`, { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ── Netlify ──

  // GET /api/cloud/netlify/sites
  router.get("/netlify/sites", async (req, res) => {
    const token = getToken(req.query.projectId as string, "netlify");
    if (!token) return res.status(401).json({ error: "Netlify not connected" });
    try {
      const r = await fetch("https://api.netlify.com/api/v1/sites?per_page=20", { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/netlify/deploys?projectId=&siteId=
  router.get("/netlify/deploys", async (req, res) => {
    const token = getToken(req.query.projectId as string, "netlify");
    if (!token) return res.status(401).json({ error: "Netlify not connected" });
    try {
      const r = await fetch(`https://api.netlify.com/api/v1/sites/${req.query.siteId}/deploys?per_page=10`, { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ════════════════════════════════════════════════════════════════════
  //  Write / mutate endpoints
  // ════════════════════════════════════════════════════════════════════

  // ── GitHub write APIs ──

  // POST /api/cloud/github/repos — create a repo
  router.post("/github/repos", async (req, res) => {
    const { projectId, name, description, private: isPrivate } = req.body;
    const token = getToken(projectId, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, private: isPrivate }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // DELETE /api/cloud/github/repos — delete a repo
  router.delete("/github/repos", async (req, res) => {
    const { projectId, owner, repo } = req.body;
    const token = getToken(projectId, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (r.status === 204) return res.json({ ok: true });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // POST /api/cloud/github/issues — create an issue
  router.post("/github/issues", async (req, res) => {
    const { projectId, owner, repo, title, body } = req.body;
    const token = getToken(projectId, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/issues/comments — list comments on an issue
  router.get("/github/issues/comments", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${req.query.owner}/${req.query.repo}/issues/${req.query.issue_number}/comments?per_page=50`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // POST /api/cloud/github/issues/comment — comment on an issue
  router.post("/github/issues/comment", async (req, res) => {
    const { projectId, owner, repo, issue_number, body } = req.body;
    const token = getToken(projectId, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // PATCH /api/cloud/github/issues — update issue (close/reopen)
  router.patch("/github/issues", async (req, res) => {
    const { projectId, owner, repo, issue_number, state } = req.body;
    const token = getToken(projectId, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // POST /api/cloud/github/pulls — create a pull request
  router.post("/github/pulls", async (req, res) => {
    const { projectId, owner, repo, title, body, head, base } = req.body;
    const token = getToken(projectId, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, head, base }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // POST /api/cloud/github/pulls/merge — merge a pull request
  router.post("/github/pulls/merge", async (req, res) => {
    const { projectId, owner, repo, pull_number } = req.body;
    const token = getToken(projectId, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/merge`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/branches?projectId=&owner=&repo=
  router.get("/github/branches", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    try {
      const r = await fetch(`https://api.github.com/repos/${req.query.owner}/${req.query.repo}/branches`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // GET /api/cloud/github/commits?projectId=&owner=&repo=&per_page=
  router.get("/github/commits", async (req, res) => {
    const token = getToken(req.query.projectId as string, "github");
    if (!token) return res.status(401).json({ error: "GitHub not connected" });
    const per_page = req.query.per_page || "30";
    try {
      const r = await fetch(`https://api.github.com/repos/${req.query.owner}/${req.query.repo}/commits?per_page=${per_page}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      res.json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ── GitHub local git operations ──

  // GET /api/cloud/github/git-status?projectId= — local repo status
  router.get("/github/git-status", (req, res) => {
    const projectId = req.query.projectId as string;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
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
      res.json({ isRepo: true, branch, changedFiles, remotes, hasUncommittedChanges: changedFiles > 0 });
    } catch {
      res.json({ isRepo: false, branch: "", changedFiles: 0, remotes: [], hasUncommittedChanges: false });
    }
  });

  // POST /api/cloud/github/git-init — initialize git repo
  router.post("/github/git-init", (req, res) => {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    const workDir = getWorkDir(projectId);
    try {
      execSync("git init", { cwd: workDir, encoding: "utf8" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cloud/github/git-commit — stage all + commit
  router.post("/github/git-commit", (req, res) => {
    const { projectId, message } = req.body;
    if (!projectId || !message) return res.status(400).json({ error: "projectId and message required" });
    const workDir = getWorkDir(projectId);
    try {
      execSync("git add -A", { cwd: workDir, encoding: "utf8" });
      execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: workDir, encoding: "utf8" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cloud/github/git-push — push to remote
  router.post("/github/git-push", (req, res) => {
    const { projectId, remote, branch } = req.body;
    if (!projectId || !remote || !branch) return res.status(400).json({ error: "projectId, remote, and branch required" });
    const workDir = getWorkDir(projectId);
    try {
      execSync(`git push ${remote} ${branch}`, { cwd: workDir, encoding: "utf8" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cloud/github/git-add-remote — add a remote
  router.post("/github/git-add-remote", (req, res) => {
    const { projectId, name, url } = req.body;
    if (!projectId || !name || !url) return res.status(400).json({ error: "projectId, name, and url required" });
    const workDir = getWorkDir(projectId);
    try {
      execSync(`git remote add ${name} ${url}`, { cwd: workDir, encoding: "utf8" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Vercel write APIs ──

  // POST /api/cloud/vercel/deploy — trigger deployment
  router.post("/vercel/deploy", async (req, res) => {
    const { projectId, vercelProjectId, ref } = req.body;
    const token = getToken(projectId, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch("https://api.vercel.com/v13/deployments", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: vercelProjectId, gitSource: { type: "github", ref } }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // DELETE /api/cloud/vercel/deployments — delete a deployment
  router.delete("/vercel/deployments", async (req, res) => {
    const { projectId, deploymentId } = req.body;
    const token = getToken(projectId, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 204) return res.json({ ok: true });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // POST /api/cloud/vercel/env — add env var
  router.post("/vercel/env", async (req, res) => {
    const { projectId, vercelProjectId, key, value, target } = req.body;
    const token = getToken(projectId, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, target: [target] }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // DELETE /api/cloud/vercel/env — delete env var
  router.delete("/vercel/env", async (req, res) => {
    const { projectId, vercelProjectId, envId } = req.body;
    const token = getToken(projectId, "vercel");
    if (!token) return res.status(401).json({ error: "Vercel not connected" });
    try {
      const r = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env/${envId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 204) return res.json({ ok: true });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ── Supabase write APIs ──

  // POST /api/cloud/supabase/sql — execute SQL
  router.post("/supabase/sql", async (req, res) => {
    const { projectId, ref, query } = req.body;
    const token = getToken(projectId, "supabase");
    if (!token) return res.status(401).json({ error: "Supabase not connected" });
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  // ── Netlify write APIs ──

  // POST /api/cloud/netlify/deploy — trigger deploy
  router.post("/netlify/deploy", async (req, res) => {
    const { projectId, siteId } = req.body;
    const token = getToken(projectId, "netlify");
    if (!token) return res.status(401).json({ error: "Netlify not connected" });
    try {
      const r = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  return router;
}
