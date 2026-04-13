import { useState, useCallback, useEffect } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";

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
    fetch("/api/git/check")
      .then(r => r.json())
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
    fetch(`/api/git/repo-status?projectId=${encodeURIComponent(activeProjectId)}`)
      .then(r => r.json())
      .then(data => setIsRepo(data.isRepo))
      .catch(() => setIsRepo(false));
  }, [activeProjectId, installStatus.state]);

  const installGit = useCallback(async () => {
    setInstallStatus({ state: "installing" });
    setLastError(null);
    try {
      const res = await fetch("/api/git/install", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        // Re-check after install
        const check = await fetch("/api/git/check").then(r => r.json());
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
      const res = await fetch("/api/git/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      const data = await res.json();
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
      const res = await fetch(`/api/git/status?projectId=${encodeURIComponent(activeProjectId)}`);
      if (!res.ok) return;
      const data = await res.json();
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
      const res = await fetch(`/api/git/log?projectId=${encodeURIComponent(activeProjectId)}&limit=50`);
      if (!res.ok) return;
      const data = await res.json();
      setLog(data.log || []);
    } catch {}
  }, [activeProjectId, isRepo]);

  const stage = useCallback(async (paths: string[]) => {
    if (!activeProjectId) return;
    await fetch("/api/git/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, files: paths }),
    });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const stageAll = useCallback(async () => {
    if (!activeProjectId) return;
    await fetch("/api/git/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, all: true }),
    });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const unstage = useCallback(async (paths: string[]) => {
    if (!activeProjectId) return;
    await fetch("/api/git/unstage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, files: paths }),
    });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const commit = useCallback(async (message: string): Promise<{ success: boolean; message: string }> => {
    if (!activeProjectId) return { success: false, message: "No project" };
    const res = await fetch("/api/git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, message }),
    });
    const data = await res.json();
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
    const res = await fetch("/api/git/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, remote, branch: branchName }),
    });
    return res.json();
  }, [activeProjectId]);

  const pull = useCallback(async (remote = "origin", branchName?: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, remote, branch: branchName }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const createBranch = useCallback(async (name: string) => {
    if (!activeProjectId) return;
    await fetch("/api/git/branch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, name }),
    });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const checkout = useCallback(async (branchName: string) => {
    if (!activeProjectId) return;
    await fetch("/api/git/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, branch: branchName }),
    });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const discard = useCallback(async (paths: string[]) => {
    if (!activeProjectId) return;
    await fetch("/api/git/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, files: paths }),
    });
    await refreshStatus();
  }, [activeProjectId, refreshStatus]);

  const getDiff = useCallback(async (filePath: string, staged: boolean): Promise<{ diff: string; oldContent: string; newContent: string }> => {
    if (!activeProjectId) return { diff: "", oldContent: "", newContent: "" };
    const res = await fetch(`/api/git/diff?projectId=${encodeURIComponent(activeProjectId)}&path=${encodeURIComponent(filePath)}&staged=${staged}`);
    return res.json();
  }, [activeProjectId]);

  // ── Extended git actions for the three-dot menu ─────────────────
  const fetchRemote = useCallback(async (remote = "origin") => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/fetch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, remote }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const stash = useCallback(async (message?: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/stash", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, message }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const stashPop = useCallback(async () => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/stash-pop", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const stashList = useCallback(async (): Promise<string[]> => {
    if (!activeProjectId) return [];
    const res = await fetch(`/api/git/stash-list?projectId=${encodeURIComponent(activeProjectId)}`);
    const data = await res.json();
    return data.stashes || [];
  }, [activeProjectId]);

  const pullRebase = useCallback(async (remote = "origin", branchName?: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/pull-rebase", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, remote, branch: branchName }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const merge = useCallback(async (branchName: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/merge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, branch: branchName }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const cherryPick = useCallback(async (oid: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/cherry-pick", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, oid }),
    });
    const data = await res.json();
    if (data.success) { await refreshStatus(); await refreshLog(); }
    return data;
  }, [activeProjectId, refreshStatus, refreshLog]);

  const reset = useCallback(async (mode: "soft" | "mixed" | "hard", target = "HEAD") => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/reset", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, mode, target }),
    });
    const data = await res.json();
    if (data.success) { await refreshStatus(); await refreshLog(); }
    return data;
  }, [activeProjectId, refreshStatus, refreshLog]);

  const addRemote = useCallback(async (name: string, url: string) => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/add-remote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, name, url }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const deleteBranch = useCallback(async (name: string, force = false) => {
    if (!activeProjectId) return { success: false, message: "" };
    const res = await fetch("/api/git/delete-branch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, name, force }),
    });
    const data = await res.json();
    if (data.success) await refreshStatus();
    return data;
  }, [activeProjectId, refreshStatus]);

  const getCommitDetail = useCallback(async (oid: string) => {
    if (!activeProjectId) return null;
    const res = await fetch(`/api/git/commit-detail?projectId=${encodeURIComponent(activeProjectId)}&oid=${encodeURIComponent(oid)}`);
    if (!res.ok) return null;
    return res.json();
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
