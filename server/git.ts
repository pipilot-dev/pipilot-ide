/**
 * Real git operations for project workspaces.
 * Uses the system git binary via child_process.
 */

import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export interface GitFileStatus {
  path: string;
  index: string;  // staged status (' ', 'M', 'A', 'D', 'R', '?', etc.)
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

let gitInstalledCache: boolean | null = null;
let gitVersionCache: string | null = null;

/** Check if git is installed on the system */
export async function isGitInstalled(): Promise<{ installed: boolean; version: string | null }> {
  if (gitInstalledCache !== null) {
    return { installed: gitInstalledCache, version: gitVersionCache };
  }
  try {
    const { stdout } = await execAsync("git --version", { timeout: 5000 });
    gitInstalledCache = true;
    gitVersionCache = stdout.trim();
    return { installed: true, version: gitVersionCache };
  } catch {
    gitInstalledCache = false;
    gitVersionCache = null;
    return { installed: false, version: null };
  }
}

/** Reset cache (call after install attempt) */
export function resetGitCache() {
  gitInstalledCache = null;
  gitVersionCache = null;
}

/** Helper to spawn an installer and capture output */
function runInstaller(cmd: string, args: string[], shell = true): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: "pipe", shell });
    let output = "";
    proc.stdout?.on("data", (d) => { output += d.toString(); });
    proc.stderr?.on("data", (d) => { output += d.toString(); });
    proc.on("exit", (code) => {
      resetGitCache();
      resolve({ success: code === 0, output: output.slice(-2000) });
    });
    proc.on("error", () => {
      resolve({ success: false, output: `Failed to spawn ${cmd}` });
    });
  });
}

/** Detect available package manager on the current system */
async function detectPackageManager(): Promise<string | null> {
  const candidates = process.platform === "darwin"
    ? ["brew"]
    : ["apt-get", "dnf", "yum", "pacman", "zypper", "apk"];

  for (const pm of candidates) {
    try {
      await execAsync(`${pm} --version`, { timeout: 3000 });
      return pm;
    } catch {}
  }
  return null;
}

/** Try to install git on the host system */
export async function installGit(): Promise<{ success: boolean; message: string; manualCommand?: string }> {
  // ── Windows: winget ──────────────────────────────────────────────
  if (process.platform === "win32") {
    try {
      await execAsync("winget --version", { timeout: 3000 });
      const result = await runInstaller(
        "winget",
        ["install", "--id", "Git.Git", "-e", "--source", "winget", "--accept-source-agreements", "--accept-package-agreements"],
        true
      );
      if (result.success) {
        return { success: true, message: "Git installed via winget. Please restart the server to use it." };
      }
      return {
        success: false,
        message: `winget install failed: ${result.output}`,
        manualCommand: "winget install --id Git.Git -e",
      };
    } catch {
      return {
        success: false,
        message: "winget not available. Install Git manually from https://git-scm.com/download/win",
        manualCommand: "Download from https://git-scm.com/download/win",
      };
    }
  }

  // ── macOS: brew ──────────────────────────────────────────────────
  if (process.platform === "darwin") {
    try {
      await execAsync("brew --version", { timeout: 3000 });
      const result = await runInstaller("brew", ["install", "git"], true);
      if (result.success) {
        return { success: true, message: "Git installed via Homebrew." };
      }
      return {
        success: false,
        message: `brew install failed: ${result.output}`,
        manualCommand: "brew install git",
      };
    } catch {
      // Try xcode-select --install (this opens a GUI prompt)
      return {
        success: false,
        message: "Homebrew not detected. Install via Xcode Command Line Tools (xcode-select --install) or download Homebrew from https://brew.sh",
        manualCommand: "xcode-select --install",
      };
    }
  }

  // ── Linux: detect package manager ────────────────────────────────
  const pm = await detectPackageManager();
  if (!pm) {
    return {
      success: false,
      message: "No supported package manager detected. Install git manually for your distribution.",
      manualCommand: "Install git via your distro's package manager",
    };
  }

  // Map package manager to install command
  const installCmds: Record<string, string[]> = {
    "apt-get": ["apt-get", "install", "-y", "git"],
    "dnf": ["dnf", "install", "-y", "git"],
    "yum": ["yum", "install", "-y", "git"],
    "pacman": ["pacman", "-S", "--noconfirm", "git"],
    "zypper": ["zypper", "install", "-y", "git"],
    "apk": ["apk", "add", "git"],
  };

  const args = installCmds[pm];
  if (!args) {
    return {
      success: false,
      message: `Detected ${pm} but no install command mapped`,
      manualCommand: `${pm} install git`,
    };
  }

  // Linux installs require root. Check if we're already root.
  const isRoot = process.getuid && process.getuid() === 0;

  if (isRoot) {
    // Run directly without sudo
    const result = await runInstaller(args[0], args.slice(1), false);
    if (result.success) {
      return { success: true, message: `Git installed via ${pm}.` };
    }
    return {
      success: false,
      message: `${pm} install failed: ${result.output}`,
      manualCommand: `sudo ${args.join(" ")}`,
    };
  }

  // Try with sudo -n (non-interactive — only works if NOPASSWD is configured)
  try {
    const result = await runInstaller("sudo", ["-n", ...args], false);
    if (result.success) {
      return { success: true, message: `Git installed via sudo ${pm}.` };
    }
    // Sudo failed (likely password required) — return manual command
    return {
      success: false,
      message: `Auto-install requires a password. Please run this command in a terminal:\n\nsudo ${args.join(" ")}`,
      manualCommand: `sudo ${args.join(" ")}`,
    };
  } catch {
    return {
      success: false,
      message: `Please run this command in a terminal:\n\nsudo ${args.join(" ")}`,
      manualCommand: `sudo ${args.join(" ")}`,
    };
  }
}

/** Run a git command in a workspace directory */
async function runGit(cwd: string, args: string[], opts: { timeout?: number } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
    }, opts.timeout ?? 30000);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr: "git binary not found", code: -1 });
    });
  });
}

/** Check if a directory is the ROOT of a git repository (not just inside one) */
export async function isGitRepo(workDir: string): Promise<boolean> {
  if (!fs.existsSync(workDir)) return false;
  // Check that .git exists directly in this workspace dir (not a parent)
  const dotGit = path.join(workDir, ".git");
  if (!fs.existsSync(dotGit)) return false;
  // Verify it's a valid git dir by running rev-parse
  const { code } = await runGit(workDir, ["rev-parse", "--is-inside-work-tree"]);
  return code === 0;
}

/** Initialize a git repo in a workspace */
export async function gitInit(workDir: string): Promise<{ success: boolean; message: string }> {
  if (!fs.existsSync(workDir)) return { success: false, message: "Workspace not found" };

  const init = await runGit(workDir, ["init", "-b", "main"]);
  if (init.code !== 0) {
    // Older git might not support -b
    const fallback = await runGit(workDir, ["init"]);
    if (fallback.code !== 0) return { success: false, message: fallback.stderr || "git init failed" };
  }

  // Set default user if missing (avoids commit errors)
  const { stdout: name } = await runGit(workDir, ["config", "user.name"]);
  if (!name.trim()) {
    await runGit(workDir, ["config", "user.name", "PiPilot User"]);
  }
  const { stdout: email } = await runGit(workDir, ["config", "user.email"]);
  if (!email.trim()) {
    await runGit(workDir, ["config", "user.email", "user@pipilot.dev"]);
  }

  return { success: true, message: "Repository initialized" };
}

/** Get git status as a list of files */
export async function gitStatus(workDir: string): Promise<GitFileStatus[]> {
  const { stdout, code } = await runGit(workDir, ["status", "--porcelain=v1", "-uall"]);
  if (code !== 0) return [];

  const files: GitFileStatus[] = [];
  const lines = stdout.split("\n").filter(Boolean);
  for (const line of lines) {
    if (line.length < 3) continue;
    const index = line[0];
    const worktree = line[1];
    let filePath = line.slice(3);
    // Handle renamed files: "old -> new"
    if (filePath.includes(" -> ")) {
      filePath = filePath.split(" -> ")[1];
    }
    // Strip surrounding quotes if any
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    files.push({ path: filePath, index, worktree });
  }
  return files;
}

/** Get current branch name */
export async function gitCurrentBranch(workDir: string): Promise<string> {
  const { stdout, code } = await runGit(workDir, ["branch", "--show-current"]);
  if (code !== 0) return "main";
  return stdout.trim() || "HEAD";
}

/** List all branches */
export async function gitBranches(workDir: string): Promise<string[]> {
  const { stdout, code } = await runGit(workDir, ["branch", "--list", "--format=%(refname:short)"]);
  if (code !== 0) return [];
  return stdout.split("\n").map(s => s.trim()).filter(Boolean);
}

/** Get commit log */
export async function gitLog(workDir: string, limit = 50): Promise<GitCommit[]> {
  const fmt = "%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%at";
  const { stdout, code } = await runGit(workDir, ["log", `--format=${fmt}`, `-n${limit}`]);
  if (code !== 0) return [];

  const commits: GitCommit[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [oid, shortOid, message, author, email, ts] = line.split("\x1f");
    commits.push({
      oid, shortOid, message, author, email,
      timestamp: parseInt(ts) || 0,
    });
  }
  return commits;
}

/** Get diff for a file (staged or unstaged) */
export async function gitDiff(workDir: string, filePath: string, staged: boolean): Promise<string> {
  const args = ["diff"];
  if (staged) args.push("--staged");
  args.push("--", filePath);
  const { stdout } = await runGit(workDir, args);
  return stdout;
}

/** Get the original (HEAD) content of a file */
export async function gitShowFile(workDir: string, filePath: string): Promise<string> {
  const { stdout, code } = await runGit(workDir, ["show", `HEAD:${filePath}`]);
  if (code !== 0) return "";
  return stdout;
}

/** Stage files (git add) */
export async function gitAdd(workDir: string, files: string[]): Promise<{ success: boolean; message: string }> {
  if (files.length === 0) return { success: true, message: "No files to stage" };
  const { stderr, code } = await runGit(workDir, ["add", "--", ...files]);
  return { success: code === 0, message: stderr || "Staged" };
}

/** Stage all changes */
export async function gitAddAll(workDir: string): Promise<{ success: boolean; message: string }> {
  const { stderr, code } = await runGit(workDir, ["add", "-A"]);
  return { success: code === 0, message: stderr || "All changes staged" };
}

/** Unstage a file (git reset HEAD <file>) */
export async function gitUnstage(workDir: string, files: string[]): Promise<{ success: boolean; message: string }> {
  if (files.length === 0) return { success: true, message: "" };
  // For initial repo (no HEAD yet), use rm --cached
  const { code: hasHead } = await runGit(workDir, ["rev-parse", "HEAD"]);
  let result;
  if (hasHead === 0) {
    result = await runGit(workDir, ["reset", "HEAD", "--", ...files]);
  } else {
    result = await runGit(workDir, ["rm", "--cached", "--", ...files]);
  }
  return { success: result.code === 0, message: result.stderr || "Unstaged" };
}

/** Commit staged changes */
export async function gitCommit(workDir: string, message: string): Promise<{ success: boolean; message: string }> {
  if (!message.trim()) return { success: false, message: "Commit message required" };
  const { stdout, stderr, code } = await runGit(workDir, ["commit", "-m", message]);
  if (code !== 0) {
    return { success: false, message: stderr || stdout || "Commit failed" };
  }
  return { success: true, message: stdout };
}

/** Push to remote */
export async function gitPush(workDir: string, remote = "origin", branch?: string): Promise<{ success: boolean; message: string }> {
  const args = ["push", remote];
  if (branch) args.push(branch);
  const { stdout, stderr, code } = await runGit(workDir, args, { timeout: 60000 });
  return { success: code === 0, message: stdout + stderr };
}

/** Pull from remote */
export async function gitPull(workDir: string, remote = "origin", branch?: string): Promise<{ success: boolean; message: string }> {
  const args = ["pull", remote];
  if (branch) args.push(branch);
  const { stdout, stderr, code } = await runGit(workDir, args, { timeout: 60000 });
  return { success: code === 0, message: stdout + stderr };
}

/** Create a new branch */
export async function gitCreateBranch(workDir: string, name: string): Promise<{ success: boolean; message: string }> {
  const { stderr, code } = await runGit(workDir, ["branch", name]);
  return { success: code === 0, message: stderr || `Branch ${name} created` };
}

/** Checkout a branch */
export async function gitCheckout(workDir: string, branch: string): Promise<{ success: boolean; message: string }> {
  const { stdout, stderr, code } = await runGit(workDir, ["checkout", branch]);
  return { success: code === 0, message: (stdout + stderr).trim() };
}

/** Discard changes to a file (checkout from HEAD) */
export async function gitDiscard(workDir: string, files: string[]): Promise<{ success: boolean; message: string }> {
  if (files.length === 0) return { success: true, message: "" };
  const { stderr, code } = await runGit(workDir, ["checkout", "HEAD", "--", ...files]);
  return { success: code === 0, message: stderr || "Discarded" };
}

/** Get list of remotes */
export async function gitRemotes(workDir: string): Promise<{ name: string; url: string }[]> {
  const { stdout, code } = await runGit(workDir, ["remote", "-v"]);
  if (code !== 0) return [];
  const remotes = new Map<string, string>();
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [name, urlAndType] = line.split(/\s+/);
    if (name && urlAndType && !remotes.has(name)) {
      remotes.set(name, urlAndType);
    }
  }
  return Array.from(remotes.entries()).map(([name, url]) => ({ name, url }));
}
