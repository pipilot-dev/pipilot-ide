import { useState, useCallback, useEffect } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { apiGet, apiPost } from "@/lib/api";

export interface GitFileStatus {
  path: string;
  index: string;   // staged status
  worktree: string; // unstaged status
}

export interface GitCommit {
  oid: string;
  shortOid: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
}

export interface GitRemote {
  name: string;
  url: string;
}

export type GitInstallStatus =
  | { state: "checking" }
  | { state: "missing"; manualCommand?: string }
  | { state: "installing" }
  | { state: "installed"; version: string };

export function useRealGit() {
  const { activeProjectId } = useActiveProject();
  const [installStatus, setInstallStatus] = useState<GitInstallStatus>({ state: "checking" });
  const [isRepo, setIsRepo] = useState<boolean | null>(null);
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [branch, setBranch] = useState<string>("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Check git installation on mount
  useEffect(() => {
    let cancelled = false;
    apiGet("/api/git/check")
      .then(data => {
        if (cancelled) return;
        if (data.installed) {
          setInstallStatus({ state: "installed", version: data.version });
        } else {
          setInstallStatus({ state: "missing" });
        }
      })
      .catch(() => {
        if (!cancelled) setInstallStatus({ state: "missing" });
      });
    return () => { cancelled = true; };
  }, []);

  // Check repo status when project changes
  useEffect(() => {
    if (!activeProjectId || installStatus.state !== "installed") return;
    apiGet("/api/git/repo-status", { projectId: activeProjectId })
      .then(data => setIsRepo(data.isRepo))
      .catch(() => setIsRepo(false));
  }, [activeProjectId, installStatus.state]);

  const installGit = useCallback(async () => {
    setInstallStatus({ state: "installing" });
    setLastError(null);
    try {
      const data = await apiPost("/api/git/install");
      if (data.success) {
        // Re-check after install
        const check = await apiGet("/api/git/check");
        if (check.installed) {
          setInstallStatus({ state: "installed", version: check.version });
        } else {
          setInstallStatus({ state: "missing", manualCommand: data.manualCommand });
          setLastError(data.message);
        }
      } else {
        setInstallStatus({ state: "missing", manualCommand: data.manualCommand });
        setLastError(data.message);
      }
    } catch (err: any) {
      setInstallStatus({ state: "missing" });
      setLastError(err.message);
    }
  }, []);

  const initRepo = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    setLastError(null);
    try {
      const data = await apiPost("/api/git/init", { projectId: activeProjectId });
      if (data.success) {
        setIsRepo(true);
      } else {
        setLastError(data.message);
      }
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  const refreshStatus = useCallback(async () => {
    if (!activeProjectId || !isRepo) return;
    setLoading(true);
    try {
      const data = await apiGet("/api/git/status", { projectId: activeProjectId });
      setFiles(data.files || []);
      setBranch(data.branch || "main");
      setBranches(data.branches || []);
      setRemotes(data.remotes || []);
    } catch (err: any) {
      setLastError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, isRepo]);

  const refreshLog = useCallback(async () => {
    if (!activeProjectId || !isRepo) return;
    try {
      const data = await apiGet("/api/git/log", { projectId: activeProjectId, limit: "50" });
      setLog(data.log || []);
    } catch {}
  }, [activeProjectId, isRepo]);

  const stage = useCallback(async (paths: string[]) => {
    if (!activeProjectId) return;
    await apiPost("/api/git/add", { projectId: activeProjectId, files: paths });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const stageAll = useCallback(async () => {
    if (!activeProjectId) return;
    await apiPost("/api/git/add", { projectId: activeProjectId, all: true });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const unstage = useCallback(async (paths: string[]) => {
    if (!activeProjectId) return;
    await apiPost("/api/git/unstage", { projectId: activeProjectId, files: paths });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const commit = useCallback(async (message: string): Promise<{ success: boolean; message: string }> => {
    if (!activeProjectId) return { success: false, message: "No project" };
    const data = await apiPost("/api/git/commit", { projectId: activeProjectId, message });
    if (data.success) {
      await refreshStatus();
      await refreshLog();
    } else {
      setLastError(data.message);
    }
    return data;
  }, [activeProjectId, refreshStatus, refreshLog]);

  const push = useCallback(async (remote = "origin", branchName?: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    return apiPost("/api/git/push", { projectId: activeProjectId, remote, branch: branchName });
  }, [activeProjectId]);

  const pull = useCallback(async (remote = "origin", branchName?: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/pull", { projectId: activeProjectId, remote, branch: branchName });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const createBranch = useCallback(async (name: string) => {
    if (!activeProjectId) return;
    await apiPost("/api/git/branch", { projectId: activeProjectId, name });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const checkout = useCallback(async (branchName: string) => {
    if (!activeProjectId) return;
    await apiPost("/api/git/checkout", { projectId: activeProjectId, branch: branchName });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const discard = useCallback(async (paths: string[]) => {
    if (!activeProjectId) return;
    await apiPost("/api/git/discard", { projectId: activeProjectId, files: paths });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const getDiff = useCallback(async (filePath: string, staged: boolean): Promise<{ diff: string; oldContent: string; newContent: string }> => {
    if (!activeProjectId) return { diff: "", oldContent: "", newContent: "" };
    return apiGet("/api/git/diff", { projectId: activeProjectId, path: filePath, staged: String(staged) });
  }, [activeProjectId]);

  // ── Extended git actions for the three-dot menu ─────────────────
  const fetchRemote = useCallback(async (remote = "origin") => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/fetch", { projectId: activeProjectId, remote });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const stash = useCallback(async (message?: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/stash", { projectId: activeProjectId, message });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const stashPop = useCallback(async () => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/stash-pop", { projectId: activeProjectId });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const stashList = useCallback(async (): Promise<string[]> => {
    if (!activeProjectId) return [];
    const data = await apiGet("/api/git/stash-list", { projectId: activeProjectId });
    return data.stashes || [];
  }, [activeProjectId]);

  const pullRebase = useCallback(async (remote = "origin", branchName?: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/pull-rebase", { projectId: activeProjectId, remote, branch: branchName });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const merge = useCallback(async (branchName: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/merge", { projectId: activeProjectId, branch: branchName });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const cherryPick = useCallback(async (oid: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/cherry-pick", { projectId: activeProjectId, oid });
    if (data.success) { await refreshStatus(); await refreshLog(); }
    return data;
  }, [activeProjectId, refreshStatus, refreshLog]);

  const reset = useCallback(async (mode: "soft" | "mixed" | "hard", target = "HEAD") => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/reset", { projectId: activeProjectId, mode, target });
    if (data.success) { await refreshStatus(); await refreshLog(); }
    return data;
  }, [activeProjectId, refreshStatus, refreshLog]);

  const addRemote = useCallback(async (name: string, url: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/add-remote", { projectId: activeProjectId, name, url });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const deleteBranch = useCallback(async (name: string, force = false) => {
    if (!activeProjectId) return { success: false, message: "" };
    const data = await apiPost("/api/git/delete-branch", { projectId: activeProjectId, name, force });
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const getCommitDetail = useCallback(async (oid: string) => {
    if (!activeProjectId) return null;
    try {
      return await apiGet("/api/git/commit-detail", { projectId: activeProjectId, oid });
    } catch { return null; }
  }, [activeProjectId]);

  // Auto-refresh when repo becomes available
  useEffect(() => {
    if (isRepo) {
      refreshStatus();
      refreshLog();
    }
  }, [isRepo, refreshStatus, refreshLog]);

  // Derived state
  const stagedFiles = files.filter(f => f.index !== " " && f.index !== "?");
  const unstagedFiles = files.filter(f => f.worktree !== " " || f.index === "?");

  const gitApi = {
    installStatus,
    installGit,
    isRepo,
    initRepo,
    files,
    stagedFiles,
    unstagedFiles,
    branch,
    branches,
    remotes,
    log,
    loading,
    lastError,
    refreshStatus,
    refreshLog,
    stage,
    stageAll,
    unstage,
    commit,
    push,
    pull,
    createBranch,
    checkout,
    discard,
    getDiff,
    // Extended actions
    fetchRemote,
    stash,
    stashPop,
    stashList,
    pullRebase,
    merge,
    cherryPick,
    reset,
    addRemote,
    deleteBranch,
    getCommitDetail,
  };
  return gitApi;
}

export type RealGitApi = ReturnType<typeof useRealGit>;
