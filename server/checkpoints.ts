/**
 * Server-side workspace checkpoints — git-backed, branch-free.
 *
 * Uses git plumbing commands (write-tree, commit-tree) to create
 * snapshot commits WITHOUT touching HEAD or any branch. The user's
 * commit history stays clean — checkpoints are "dangling" objects
 * that only exist in our index file.
 *
 * Create:  git add -A → git write-tree → git commit-tree → reset index
 * Restore: git read-tree <sha> → git checkout-index -a -f → git clean -fd
 */

import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const SKIP_DIRS = [
  "node_modules", ".git", "dist", "build", ".next", "out",
  ".cache", ".vite", "coverage", ".turbo", ".vercel",
  ".pipilot-data", ".pipilot-checkpoints", ".pipilot-tsconfig.json",
];

const MAX_CHECKPOINTS_PER_PROJECT = 50;

// Prevent git GC from collecting our dangling checkpoint commits.
// We store refs in .git/refs/pipilot/ so git knows they're reachable.
const CHECKPOINT_REF_PREFIX = "refs/pipilot/cp";

// ── Types ────────────────────────────────────────────────────────────

export interface CheckpointMeta {
  id: string;
  projectId: string;
  label: string;
  messageId?: string;
  createdAt: number;
  fileCount: number;
  byteSize: number;
  sha: string;
}

// ── Internal state ───────────────────────────────────────────────────

let dataDir = "";

export function initCheckpoints(opts: { dataDir: string }) {
  dataDir = opts.dataDir;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function projectDir(projectId: string): string {
  const dir = path.join(dataDir, projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Index file (lightweight JSON metadata) ───────────────────────────

function indexPath(projectId: string): string {
  return path.join(projectDir(projectId), "index.json");
}

function readIndex(projectId: string): CheckpointMeta[] {
  const p = indexPath(projectId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")) || []; } catch { return []; }
}

function writeIndex(projectId: string, entries: CheckpointMeta[]) {
  fs.writeFileSync(indexPath(projectId), JSON.stringify(entries, null, 2));
}

// ── Git helpers ──────────────────────────────────────────────────────

async function git(workDir: string, args: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd: workDir,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return stdout.trim();
}

async function ensureGitRepo(workDir: string) {
  if (!fs.existsSync(path.join(workDir, ".git"))) {
    await git(workDir, "init");
  }
  ensureGitignore(workDir);
  await ensureGitUser(workDir);
}

function ensureGitignore(workDir: string) {
  const gitignorePath = path.join(workDir, ".gitignore");
  let existing = "";
  if (fs.existsSync(gitignorePath)) existing = fs.readFileSync(gitignorePath, "utf8");
  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  const toAdd: string[] = [];
  for (const dir of SKIP_DIRS) {
    const pattern = dir.includes(".") && !dir.endsWith("/") ? dir : `${dir}/`;
    if (!lines.includes(dir) && !lines.includes(pattern)) toAdd.push(pattern);
  }
  if (toAdd.length > 0) {
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(gitignorePath, `${prefix}# PiPilot checkpoint exclusions\n${toAdd.join("\n")}\n`);
  }
}

async function ensureGitUser(workDir: string) {
  try { await git(workDir, "config user.name"); } catch { await git(workDir, 'config user.name "PiPilot"'); }
  try { await git(workDir, "config user.email"); } catch { await git(workDir, 'config user.email "checkpoints@pipilot.local"'); }
}

export async function isGitCheckpointsAvailable(): Promise<boolean> {
  try { await execAsync("git --version"); return true; } catch { return false; }
}

async function countFilesAtCommit(workDir: string, sha: string): Promise<number> {
  try {
    const out = await git(workDir, `ls-tree -r --name-only ${sha}`);
    return out ? out.split("\n").length : 0;
  } catch { return 0; }
}

/**
 * Store a ref so git GC won't collect our checkpoint commit.
 * Refs go in .git/refs/pipilot/cp-<short-sha> — invisible to
 * normal branch/tag listings.
 */
async function protectFromGC(workDir: string, sha: string) {
  try {
    await git(workDir, `update-ref ${CHECKPOINT_REF_PREFIX}-${sha.slice(0, 12)} ${sha}`);
  } catch {}
}

/** Remove the GC-protection ref when a checkpoint is deleted. */
async function unprotectFromGC(workDir: string, sha: string) {
  try {
    await git(workDir, `update-ref -d ${CHECKPOINT_REF_PREFIX}-${sha.slice(0, 12)}`);
  } catch {}
}

// ── Public API ───────────────────────────────────────────────────────

export async function createCheckpoint(opts: {
  projectId: string;
  workDir: string;
  label: string;
  messageId?: string;
  useGit?: boolean;
}): Promise<CheckpointMeta> {
  if (!fs.existsSync(opts.workDir)) throw new Error(`Workspace not found: ${opts.workDir}`);
  if (!(await isGitCheckpointsAvailable())) throw new Error("Git is not installed. Install git to enable checkpoints.");

  await ensureGitRepo(opts.workDir);

  // ── Create checkpoint WITHOUT touching HEAD or any branch ──
  //
  // 1. Stage all current files into the index
  await git(opts.workDir, "add -A");
  // 2. Write the index as a tree object (returns tree SHA)
  const treeSha = await git(opts.workDir, "write-tree");
  // 3. Create a commit object pointing to that tree (not on any branch)
  const msg = `checkpoint: ${opts.label}`.replace(/"/g, '\\"');
  const sha = await git(opts.workDir, `commit-tree ${treeSha} -m "${msg}"`);
  // 4. Reset the index back to HEAD so we don't leave staged changes
  //    that would show up in the user's next `git status`
  try { await git(opts.workDir, "reset HEAD"); } catch {
    // reset fails if there's no HEAD yet (brand new repo with no commits).
    // In that case, just clear the index.
    try { await git(opts.workDir, "rm -r --cached ."); } catch {}
  }
  // 5. Protect from garbage collection
  await protectFromGC(opts.workDir, sha);

  const fileCount = await countFilesAtCommit(opts.workDir, sha);

  const meta: CheckpointMeta = {
    id: sha,
    projectId: opts.projectId,
    label: opts.label,
    messageId: opts.messageId,
    createdAt: Date.now(),
    fileCount,
    byteSize: 0,
    sha,
  };

  const index = readIndex(opts.projectId);
  index.push(meta);
  while (index.length > MAX_CHECKPOINTS_PER_PROJECT) index.shift();
  writeIndex(opts.projectId, index);

  return meta;
}

export function listCheckpoints(projectId: string): CheckpointMeta[] {
  return readIndex(projectId).sort((a, b) => b.createdAt - a.createdAt);
}

export function getCheckpoint(projectId: string, id: string): { meta: CheckpointMeta; files: never[] } | null {
  const entry = readIndex(projectId).find((m) => m.id === id);
  if (!entry) return null;
  return { meta: entry, files: [] };
}

export function findCheckpointBeforeMessage(projectId: string, messageId: string): CheckpointMeta | null {
  return listCheckpoints(projectId).find((m) => m.messageId === `before-${messageId}`) || null;
}

export async function restoreCheckpoint(opts: {
  projectId: string;
  workDir: string;
  checkpointId: string;
}): Promise<{ success: boolean; restored: number; deleted: number; message?: string }> {
  if (!fs.existsSync(opts.workDir)) return { success: false, restored: 0, deleted: 0, message: "Workspace not found" };

  const entry = readIndex(opts.projectId).find((m) => m.id === opts.checkpointId);
  if (!entry?.sha) return { success: false, restored: 0, deleted: 0, message: "Checkpoint not found" };

  try {
    // Verify the commit object exists
    await git(opts.workDir, `cat-file -t ${entry.sha}`);

    // Restore working tree to match the checkpoint's tree, WITHOUT
    // moving HEAD or creating any commits on the user's branch.
    //
    // 1. Load the checkpoint's tree into the index
    await git(opts.workDir, `read-tree ${entry.sha}`);
    // 2. Write the index contents to the working tree
    await git(opts.workDir, "checkout-index -a -f");
    // 3. Remove files that exist in working tree but not in the checkpoint
    await git(opts.workDir, "clean -fd");
    // 4. Reset the index back to HEAD so `git status` shows the diff
    //    between HEAD and the restored (checkpoint) state cleanly.
    //    This means the user sees "modified" files, not a dirty index.
    try { await git(opts.workDir, "reset HEAD"); } catch {
      try { await git(opts.workDir, "rm -r --cached ."); } catch {}
    }

    const fileCount = await countFilesAtCommit(opts.workDir, entry.sha);
    return { success: true, restored: fileCount, deleted: 0 };
  } catch (err: any) {
    return { success: false, restored: 0, deleted: 0, message: err.message };
  }
}

export async function deleteCheckpoint(projectId: string, checkpointId: string) {
  const entry = readIndex(projectId).find((m) => m.id === checkpointId);
  // Remove GC protection ref
  if (entry?.sha) {
    // Try to find the workDir — best effort
    try {
      const { resolveWorkspaceDir } = await import("./workspaces");
      const workDir = resolveWorkspaceDir(projectId);
      await unprotectFromGC(workDir, entry.sha);
    } catch {}
  }
  const index = readIndex(projectId).filter((m) => m.id !== checkpointId);
  writeIndex(projectId, index);
}

export function clearProjectCheckpoints(projectId: string) {
  writeIndex(projectId, []);
}
