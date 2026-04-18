/**
 * Git IPC Handlers — replaces Express /api/git/ endpoints.
 *
 * All git operations run directly in the Electron main process
 * using the system git binary (via server/git.ts).
 */

import path from "path";
import fs from "fs";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, WORKSPACE_BASE } from "./shared";
import * as gitOps from "../../server/git";

// ── Helper ───────────────────────────────────────────────────────────

function getGitWorkDir(projectId: string): string | null {
  if (!projectId) return null;
  const workDir = resolveWorkspaceDir(projectId);
  if (!fs.existsSync(workDir)) return null;
  return workDir;
}

// ── Handler registration ─────────────────────────────────────────────

export function registerGitHandlers(ctx: IpcContext) {
  const { get, post } = ctx;

  // GET /api/git/check — check if git is installed
  get("/api/git/check", async () => {
    return gitOps.isGitInstalled();
  });

  // POST /api/git/install — attempt to install git
  post("/api/git/install", async () => {
    return gitOps.installGit();
  });

  // GET /api/git/repo-status — check if project is a git repo
  get("/api/git/repo-status", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    const isRepo = await gitOps.isGitRepo(workDir);
    return { isRepo };
  });

  // POST /api/git/init
  post("/api/git/init", async ({ body }) => {
    const { projectId } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitInit(workDir);
  });

  // GET /api/git/config — read git author name + email from global config
  get("/api/git/config", async () => {
    const [name, email] = await Promise.all([
      gitOps.gitConfigGet("user.name"),
      gitOps.gitConfigGet("user.email"),
    ]);
    return { name, email };
  });

  // POST /api/git/config — set git author name + email in global config
  post("/api/git/config", async ({ body }) => {
    const { name, email } = body || {};
    if (typeof name === "string") await gitOps.gitConfigSet("user.name", name);
    if (typeof email === "string") await gitOps.gitConfigSet("user.email", email);
    return { success: true };
  });

  // POST /api/git/clone — clone a remote repo into the workspace base dir
  post("/api/git/clone", async ({ body }) => {
    const { url, parentDir } = body || {};
    if (!url || typeof url !== "string") {
      throw new Error("url required");
    }
    const installed = await gitOps.isGitInstalled();
    if (!installed.installed) {
      throw new Error("Git is not installed. Install it from https://git-scm.com");
    }
    const target = (parentDir && typeof parentDir === "string") ? parentDir : WORKSPACE_BASE;
    return gitOps.gitClone(url, target);
  });

  // GET /api/git/status
  get("/api/git/status", async ({ query }) => {
    const projectId = query?.projectId;
    const workDir = getGitWorkDir(projectId || "");
    if (!workDir) throw new Error("Workspace not found");
    const [files, branch, branches, remotes] = await Promise.all([
      gitOps.gitStatus(workDir),
      gitOps.gitCurrentBranch(workDir),
      gitOps.gitBranches(workDir),
      gitOps.gitRemotes(workDir),
    ]);
    return { files, branch, branches, remotes };
  });

  // GET /api/git/log
  get("/api/git/log", async ({ query }) => {
    const projectId = query?.projectId;
    const limit = parseInt(query?.limit || "50") || 50;
    const workDir = getGitWorkDir(projectId || "");
    if (!workDir) throw new Error("Workspace not found");
    const log = await gitOps.gitLog(workDir, limit);
    return { log };
  });

  // GET /api/git/diff?projectId=&path=&staged=
  get("/api/git/diff", async ({ query }) => {
    const projectId = query?.projectId;
    const filePath = query?.path || "";
    const staged = query?.staged === "true";
    const workDir = getGitWorkDir(projectId || "");
    if (!workDir) throw new Error("Workspace not found");
    const diff = await gitOps.gitDiff(workDir, filePath, staged);

    let oldContent = "";
    let newContent = "";
    try {
      oldContent = await gitOps.gitShowFile(workDir, filePath);
    } catch {}
    try {
      const fullPath = path.join(workDir, filePath);
      if (fs.existsSync(fullPath)) {
        newContent = fs.readFileSync(fullPath, "utf8");
      }
    } catch {}

    return { diff, oldContent, newContent };
  });

  // POST /api/git/add
  post("/api/git/add", async ({ body }) => {
    const { projectId, files, all } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return all
      ? gitOps.gitAddAll(workDir)
      : gitOps.gitAdd(workDir, files || []);
  });

  // POST /api/git/unstage
  post("/api/git/unstage", async ({ body }) => {
    const { projectId, files } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitUnstage(workDir, files || []);
  });

  // POST /api/git/commit
  post("/api/git/commit", async ({ body }) => {
    const { projectId, message } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitCommit(workDir, message);
  });

  // POST /api/git/push
  post("/api/git/push", async ({ body }) => {
    const { projectId, remote, branch } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitPush(workDir, remote, branch);
  });

  // POST /api/git/pull
  post("/api/git/pull", async ({ body }) => {
    const { projectId, remote, branch } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitPull(workDir, remote, branch);
  });

  // POST /api/git/branch — create a new branch
  post("/api/git/branch", async ({ body }) => {
    const { projectId, name } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitCreateBranch(workDir, name);
  });

  // POST /api/git/checkout
  post("/api/git/checkout", async ({ body }) => {
    const { projectId, branch } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitCheckout(workDir, branch);
  });

  // POST /api/git/discard
  post("/api/git/discard", async ({ body }) => {
    const { projectId, files } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitDiscard(workDir, files || []);
  });

  // GET /api/git/commit-detail?projectId=&oid=
  get("/api/git/commit-detail", async ({ query }) => {
    const projectId = query?.projectId;
    const oid = query?.oid;
    const workDir = getGitWorkDir(projectId || "");
    if (!workDir) throw new Error("Workspace not found");
    if (!oid) throw new Error("oid required");
    return gitOps.gitCommitDetail(workDir, oid);
  });

  // POST /api/git/fetch
  post("/api/git/fetch", async ({ body }) => {
    const { projectId, remote } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitFetch(workDir, remote || "origin");
  });

  // POST /api/git/stash
  post("/api/git/stash", async ({ body }) => {
    const { projectId, message } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitStash(workDir, message);
  });

  // GET /api/git/stash-list
  get("/api/git/stash-list", async ({ query }) => {
    const projectId = query?.projectId;
    const workDir = getGitWorkDir(projectId || "");
    if (!workDir) throw new Error("Workspace not found");
    const stashes = await gitOps.gitStashList(workDir);
    return { stashes };
  });

  // POST /api/git/stash-pop
  post("/api/git/stash-pop", async ({ body }) => {
    const { projectId } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitStashPop(workDir);
  });

  // POST /api/git/stash-apply
  post("/api/git/stash-apply", async ({ body }) => {
    const { projectId, ref } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitStashApply(workDir, ref);
  });

  // POST /api/git/stash-drop
  post("/api/git/stash-drop", async ({ body }) => {
    const { projectId, ref } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitStashDrop(workDir, ref);
  });

  // POST /api/git/pull-rebase
  post("/api/git/pull-rebase", async ({ body }) => {
    const { projectId, remote, branch } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitPullRebase(workDir, remote || "origin", branch);
  });

  // POST /api/git/merge
  post("/api/git/merge", async ({ body }) => {
    const { projectId, branch } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitMerge(workDir, branch);
  });

  // POST /api/git/cherry-pick
  post("/api/git/cherry-pick", async ({ body }) => {
    const { projectId, oid } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitCherryPick(workDir, oid);
  });

  // POST /api/git/reset
  post("/api/git/reset", async ({ body }) => {
    const { projectId, mode, target } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    if (!["soft", "mixed", "hard"].includes(mode)) {
      throw new Error("mode must be soft|mixed|hard");
    }
    return gitOps.gitReset(workDir, mode as "soft" | "mixed" | "hard", target);
  });

  // POST /api/git/add-remote
  post("/api/git/add-remote", async ({ body }) => {
    const { projectId, name, url } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitAddRemote(workDir, name, url);
  });

  // POST /api/git/remove-remote
  post("/api/git/remove-remote", async ({ body }) => {
    const { projectId, name } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitRemoveRemote(workDir, name);
  });

  // POST /api/git/delete-branch
  post("/api/git/delete-branch", async ({ body }) => {
    const { projectId, name, force } = body || {};
    const workDir = getGitWorkDir(projectId);
    if (!workDir) throw new Error("Workspace not found");
    return gitOps.gitDeleteBranch(workDir, name, force);
  });
}
