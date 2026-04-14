/**
 * Git bridge — abstracts git operations between:
 *   - Web mode: HTTP fetch to Express /api/git/* endpoints
 *   - Tauri mode: IPC invoke to Rust git commands (zero HTTP)
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 * Components use this instead of calling fetch directly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface GitStatus {
  is_repo: boolean;
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitBridge {
  check(): Promise<{ installed: boolean; version: string | null }>;
  status(cwd: string): Promise<GitStatus>;
  init(cwd: string): Promise<void>;
  add(cwd: string, paths: string[]): Promise<void>;
  commit(cwd: string, message: string): Promise<string>;
  log(cwd: string, count?: number): Promise<GitLogEntry[]>;
  diff(cwd: string, path?: string): Promise<string>;
  push(cwd: string, remote: string, branch: string): Promise<void>;
  pull(cwd: string, remote: string, branch: string): Promise<void>;
  branchList(cwd: string): Promise<string[]>;
  branchCreate(cwd: string, name: string): Promise<void>;
  checkout(cwd: string, refName: string): Promise<void>;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): GitBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async check() {
      await init();
      return invoke("git_check");
    },

    async status(cwd) {
      await init();
      return invoke("git_status", { cwd });
    },

    async init(cwd) {
      await init();
      return invoke("git_init", { cwd });
    },

    async add(cwd, paths) {
      await init();
      return invoke("git_add", { cwd, paths });
    },

    async commit(cwd, message) {
      await init();
      return invoke("git_commit", { cwd, message });
    },

    async log(cwd, count = 50) {
      await init();
      return invoke("git_log", { cwd, count });
    },

    async diff(cwd, path) {
      await init();
      return invoke("git_diff", { cwd, path: path ?? null });
    },

    async push(cwd, remote, branch) {
      await init();
      return invoke("git_push", { cwd, remote, branch });
    },

    async pull(cwd, remote, branch) {
      await init();
      return invoke("git_pull", { cwd, remote, branch });
    },

    async branchList(cwd) {
      await init();
      return invoke("git_branch_list", { cwd });
    },

    async branchCreate(cwd, name) {
      await init();
      return invoke("git_branch_create", { cwd, name });
    },

    async checkout(cwd, refName) {
      await init();
      return invoke("git_checkout", { cwd, refName: refName });
    },
  };
}

// ── HTTP bridge (existing Express API) ──

function createWebBridge(): GitBridge {
  async function fetchJson(url: string, opts?: RequestInit) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function post(url: string, body: Record<string, unknown>) {
    return fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function get(url: string) {
    return fetchJson(url);
  }

  return {
    async check() {
      const result = await get("/api/git/check");
      return { installed: result.installed, version: result.version ?? null };
    },

    async status(cwd) {
      // Web mode uses projectId (which is the cwd/project identifier)
      const params = new URLSearchParams({ projectId: cwd });
      const [repoStatus, fullStatus] = await Promise.all([
        get(`/api/git/repo-status?${params}`),
        get(`/api/git/status?${params}`).catch(() => null),
      ]);
      if (!repoStatus.isRepo || !fullStatus) {
        return {
          is_repo: repoStatus.isRepo ?? false,
          branch: "",
          staged: [],
          modified: [],
          untracked: [],
          ahead: 0,
          behind: 0,
        };
      }
      return {
        is_repo: true,
        branch: fullStatus.branch ?? "",
        staged: fullStatus.staged ?? [],
        modified: fullStatus.modified ?? [],
        untracked: fullStatus.untracked ?? [],
        ahead: fullStatus.ahead ?? 0,
        behind: fullStatus.behind ?? 0,
      };
    },

    async init(cwd) {
      await post("/api/git/init", { projectId: cwd });
    },

    async add(cwd, paths) {
      await post("/api/git/add", { projectId: cwd, files: paths });
    },

    async commit(cwd, message) {
      const result = await post("/api/git/commit", { projectId: cwd, message });
      return result.sha ?? result.oid ?? "";
    },

    async log(cwd, count = 50) {
      const params = new URLSearchParams({ projectId: cwd, count: String(count) });
      const result = await get(`/api/git/log?${params}`);
      // Normalize field names from server response
      return (result.entries ?? result ?? []).map((e: any) => ({
        sha: e.sha ?? e.oid ?? "",
        message: e.message ?? "",
        author: e.author ?? "",
        date: e.date ?? e.timestamp ?? "",
      }));
    },

    async diff(cwd, path) {
      const params = new URLSearchParams({ projectId: cwd });
      if (path) params.set("path", path);
      const result = await get(`/api/git/diff?${params}`);
      return typeof result === "string" ? result : result.diff ?? "";
    },

    async push(cwd, remote, branch) {
      await post("/api/git/push", { projectId: cwd, remote, branch });
    },

    async pull(cwd, remote, branch) {
      await post("/api/git/pull", { projectId: cwd, remote, branch });
    },

    async branchList(cwd) {
      const status = await this.status(cwd);
      // The web API doesn't have a dedicated branch-list endpoint that returns
      // an array, so we use git status branch + a log-based approach.
      // For now, return current branch. The full list comes from the status endpoint
      // if available, or we can call the server status which includes branches.
      const params = new URLSearchParams({ projectId: cwd });
      try {
        const result = await get(`/api/git/status?${params}`);
        return result.branches ?? (status.branch ? [status.branch] : []);
      } catch {
        return status.branch ? [status.branch] : [];
      }
    },

    async branchCreate(cwd, name) {
      await post("/api/git/branch", { projectId: cwd, name });
    },

    async checkout(cwd, refName) {
      await post("/api/git/checkout", { projectId: cwd, branch: refName });
    },
  };
}

// ── Export the appropriate bridge ──

export const gitBridge: GitBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
