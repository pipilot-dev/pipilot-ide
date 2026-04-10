/**
 * Server-side workspace checkpoints.
 *
 * Snapshots all "user code" files in a workspace dir into a JSON manifest
 * stored in a server data directory. Restores by writing the snapshot
 * contents back, removing any files that exist now but didn't exist in
 * the snapshot. Standard exclusion list (node_modules, .git, dist, etc.)
 * is honored on both capture and restore.
 *
 * Used by agent mode and linked projects where files live on real disk.
 */

import path from "path";
import fs from "fs";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  ".cache", ".vite", "coverage", ".turbo", ".vercel",
  ".pipilot-data", ".pipilot-checkpoints", ".pipilot-tsconfig.json",
]);

const MAX_FILES = 5000;
const MAX_FILE_SIZE = 1_000_000;     // 1 MB per file
const MAX_TOTAL_SIZE = 100_000_000;  // 100 MB per snapshot
const MAX_CHECKPOINTS_PER_PROJECT = 50;

interface SnapshotFile {
  path: string;     // workspace-relative, forward slashes
  content: string;  // utf-8
}

export interface CheckpointMeta {
  id: string;
  projectId: string;
  label: string;
  messageId?: string;
  createdAt: number;
  fileCount: number;
  byteSize: number;
}

interface CheckpointFile {
  meta: CheckpointMeta;
  files: SnapshotFile[];
}

let dataDir = "";

/** Initialize the checkpoints data dir. Call once at server startup. */
export function initCheckpoints(opts: { dataDir: string }) {
  dataDir = opts.dataDir;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function projectDir(projectId: string): string {
  const dir = path.join(dataDir, projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function checkpointPath(projectId: string, checkpointId: string): string {
  return path.join(projectDir(projectId), `${checkpointId}.json`);
}

/** Walk a workspace and collect all included files. */
function collectFiles(workDir: string): SnapshotFile[] {
  const files: SnapshotFile[] = [];
  let totalBytes = 0;

  function walk(dir: string, relBase: string) {
    if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_SIZE) return;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_SIZE) return;
      if (SKIP_DIRS.has(entry)) continue;

      const full = path.join(dir, entry);
      const relPath = relBase ? `${relBase}/${entry}` : entry;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        walk(full, relPath);
      } else if (stat.isFile()) {
        if (stat.size > MAX_FILE_SIZE) continue;
        let content: string;
        try { content = fs.readFileSync(full, "utf8"); }
        catch { continue; }
        // Skip binary-ish files (null byte in first 8KB)
        if (content.slice(0, 8192).includes("\0")) continue;
        files.push({ path: relPath, content });
        totalBytes += content.length;
      }
    }
  }

  walk(workDir, "");
  return files;
}

/** Create a snapshot of the workspace for a given project. */
export function createCheckpoint(opts: {
  projectId: string;
  workDir: string;
  label: string;
  messageId?: string;
}): CheckpointMeta {
  if (!fs.existsSync(opts.workDir)) {
    throw new Error(`Workspace not found: ${opts.workDir}`);
  }

  const files = collectFiles(opts.workDir);
  const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const meta: CheckpointMeta = {
    id,
    projectId: opts.projectId,
    label: opts.label,
    messageId: opts.messageId,
    createdAt: Date.now(),
    fileCount: files.length,
    byteSize: files.reduce((s, f) => s + f.content.length, 0),
  };

  const data: CheckpointFile = { meta, files };
  fs.writeFileSync(checkpointPath(opts.projectId, id), JSON.stringify(data));

  // Enforce per-project limit
  enforceLimit(opts.projectId);

  return meta;
}

function enforceLimit(projectId: string) {
  const dir = projectDir(projectId);
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return; }
  if (entries.length <= MAX_CHECKPOINTS_PER_PROJECT) return;

  const all = entries
    .filter((e) => e.endsWith(".json"))
    .map((e) => {
      const full = path.join(dir, e);
      try {
        const stat = fs.statSync(full);
        return { name: e, mtime: stat.mtime.getTime(), full };
      } catch { return null; }
    })
    .filter((e): e is { name: string; mtime: number; full: string } => !!e)
    .sort((a, b) => a.mtime - b.mtime);

  const toDelete = all.slice(0, all.length - MAX_CHECKPOINTS_PER_PROJECT);
  for (const f of toDelete) {
    try { fs.unlinkSync(f.full); } catch {}
  }
}

/** List all checkpoints for a project, newest first */
export function listCheckpoints(projectId: string): CheckpointMeta[] {
  const dir = projectDir(projectId);
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return []; }

  const metas: CheckpointMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8")) as CheckpointFile;
      if (data.meta) metas.push(data.meta);
    } catch {}
  }
  return metas.sort((a, b) => b.createdAt - a.createdAt);
}

/** Find a checkpoint by id */
export function getCheckpoint(projectId: string, id: string): CheckpointFile | null {
  const file = checkpointPath(projectId, id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as CheckpointFile;
  } catch { return null; }
}

/** Find the "before-<messageId>" checkpoint */
export function findCheckpointBeforeMessage(projectId: string, messageId: string): CheckpointMeta | null {
  const all = listCheckpoints(projectId);
  return all.find((m) => m.messageId === `before-${messageId}`) || null;
}

/**
 * Restore a workspace to a checkpoint.
 * Writes all snapshot files back, then removes any files in the workspace
 * that are NOT in the snapshot (within the included set).
 */
export function restoreCheckpoint(opts: {
  projectId: string;
  workDir: string;
  checkpointId: string;
}): { success: boolean; restored: number; deleted: number; message?: string } {
  const data = getCheckpoint(opts.projectId, opts.checkpointId);
  if (!data) return { success: false, restored: 0, deleted: 0, message: "Checkpoint not found" };
  if (!fs.existsSync(opts.workDir)) {
    return { success: false, restored: 0, deleted: 0, message: "Workspace not found" };
  }

  const snapshotPaths = new Set(data.files.map((f) => f.path));

  // 1. Walk current workspace, delete any file not in the snapshot
  let deleted = 0;
  function cleanup(dir: string, relBase: string) {
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      const relPath = relBase ? `${relBase}/${entry}` : entry;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        cleanup(full, relPath);
        // Remove empty dirs
        try {
          const remaining = fs.readdirSync(full);
          if (remaining.length === 0) fs.rmdirSync(full);
        } catch {}
      } else if (stat.isFile()) {
        if (!snapshotPaths.has(relPath)) {
          try { fs.unlinkSync(full); deleted++; } catch {}
        }
      }
    }
  }
  cleanup(opts.workDir, "");

  // 2. Write all snapshot files back
  let restored = 0;
  for (const f of data.files) {
    const full = path.join(opts.workDir, f.path);
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.content, "utf8");
      restored++;
    } catch {}
  }

  return { success: true, restored, deleted };
}

/** Delete a checkpoint */
export function deleteCheckpoint(projectId: string, checkpointId: string): boolean {
  const file = checkpointPath(projectId, checkpointId);
  if (!fs.existsSync(file)) return false;
  try { fs.unlinkSync(file); return true; }
  catch { return false; }
}

/** Wipe all checkpoints for a project */
export function clearProjectCheckpoints(projectId: string): number {
  const dir = projectDir(projectId);
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return 0; }
  let count = 0;
  for (const entry of entries) {
    try { fs.unlinkSync(path.join(dir, entry)); count++; } catch {}
  }
  return count;
}
