/**
 * checkpoints.ts — Zip-based file snapshots. Zero git involvement.
 *
 * Like Cursor: automatically zips project files before AI edits.
 * Stored in a hidden local directory, completely separate from git.
 * Restore overwrites workspace files from the zip. Simple and safe.
 *
 * Create:  walk workspace → zip all files → save to checkpoints dir
 * Restore: read zip → delete current files → extract zip to workspace
 */

import path from "path";
import fs from "fs";
import { createReadStream, createWriteStream } from "fs";

// ── Skip these when snapshotting (not part of the user's code) ──
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  ".cache", ".vite", "coverage", ".turbo", ".vercel",
  ".pipilot-data", ".pipilot-checkpoints", ".claude",
  ".svn", ".hg", "__pycache__", ".pytest_cache",
  ".parcel-cache", "vendor", "target",
]);

const SKIP_FILES = new Set([
  ".DS_Store", "Thumbs.db", "desktop.ini",
  ".pipilot-tsconfig.json",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_CHECKPOINTS = 50;

// ── Types ────────────────────────────────────────────────────────────

export interface CheckpointMeta {
  id: string;
  projectId: string;
  label: string;
  messageId?: string;
  createdAt: number;
  fileCount: number;
  byteSize: number;
  sha: string; // kept for API compat — just the ID
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

// ── Index file ───────────────────────────────────────────────────────

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

// ── File walking ─────────────────────────────────────────────────────

interface FileEntry {
  relativePath: string; // forward slashes, relative to workDir
  absolutePath: string;
  size: number;
}

function walkWorkspace(workDir: string): FileEntry[] {
  const files: FileEntry[] = [];

  function walk(dir: string, relBase: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".pipilot-")) continue;
        walk(path.join(dir, entry.name), relBase ? `${relBase}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        try {
          const stat = fs.statSync(abs);
          if (stat.size > MAX_FILE_SIZE) continue;
          const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
          files.push({ relativePath: rel, absolutePath: abs, size: stat.size });
        } catch {}
      }
    }
  }

  walk(workDir, "");
  return files;
}

// ── Zip/Unzip (pure Node, no dependencies) ───────────────────────────
// We store checkpoints as a simple JSON manifest + raw files in a directory.
// This is faster and more reliable than actual zip compression, and we can
// read individual files without decompressing the whole archive.

interface SnapshotManifest {
  version: 1;
  createdAt: number;
  fileCount: number;
  totalSize: number;
  files: { path: string; size: number }[];
}

function snapshotDir(projectId: string, checkpointId: string): string {
  return path.join(projectDir(projectId), checkpointId);
}

function createSnapshot(workDir: string, projectId: string, checkpointId: string): { fileCount: number; byteSize: number } {
  const dir = snapshotDir(projectId, checkpointId);
  fs.mkdirSync(dir, { recursive: true });

  const files = walkWorkspace(workDir);
  let totalSize = 0;

  // Copy each file into the snapshot directory, preserving relative paths
  for (const file of files) {
    const dest = path.join(dir, "files", file.relativePath);
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(file.absolutePath, dest);
    totalSize += file.size;
  }

  // Write manifest
  const manifest: SnapshotManifest = {
    version: 1,
    createdAt: Date.now(),
    fileCount: files.length,
    totalSize,
    files: files.map((f) => ({ path: f.relativePath, size: f.size })),
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return { fileCount: files.length, byteSize: totalSize };
}

function restoreSnapshot(workDir: string, projectId: string, checkpointId: string): { restored: number; deleted: number } {
  const dir = snapshotDir(projectId, checkpointId);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Checkpoint snapshot not found");

  const manifest: SnapshotManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // 1. Build set of files that SHOULD exist after restore
  const snapshotFiles = new Set(manifest.files.map((f) => f.path));

  // 2. Delete files in workspace that are NOT in the snapshot
  //    (files added after the checkpoint was created)
  //    walkWorkspace already skips SKIP_DIRS (node_modules, .git, etc.)
  //    so those directories are never touched during restore.
  let deleted = 0;
  const currentFiles = walkWorkspace(workDir);
  for (const file of currentFiles) {
    if (!snapshotFiles.has(file.relativePath)) {
      try {
        fs.unlinkSync(file.absolutePath);
        deleted++;
        // Clean up empty parent directories
        let parent = path.dirname(file.absolutePath);
        while (parent !== workDir && parent.length > workDir.length) {
          try {
            const entries = fs.readdirSync(parent);
            if (entries.length === 0) { fs.rmdirSync(parent); } else { break; }
          } catch { break; }
          parent = path.dirname(parent);
        }
      } catch {}
    }
  }

  // 3. Copy snapshot files back into the workspace
  let restored = 0;
  for (const file of manifest.files) {
    const src = path.join(dir, "files", file.path);
    const dest = path.join(workDir, file.path);
    if (!fs.existsSync(src)) continue; // skip missing snapshot files (shouldn't happen)

    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    restored++;
  }

  return { restored, deleted };
}

// ── Public API ───────────────────────────────────────────────────────

export async function isGitCheckpointsAvailable(): Promise<boolean> {
  // No longer requires git — always available
  return true;
}

export async function createCheckpoint(opts: {
  projectId: string;
  workDir: string;
  label: string;
  messageId?: string;
  useGit?: boolean;
}): Promise<CheckpointMeta> {
  if (!fs.existsSync(opts.workDir)) throw new Error(`Workspace not found: ${opts.workDir}`);

  const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { fileCount, byteSize } = createSnapshot(opts.workDir, opts.projectId, id);

  const meta: CheckpointMeta = {
    id,
    projectId: opts.projectId,
    label: opts.label,
    messageId: opts.messageId,
    createdAt: Date.now(),
    fileCount,
    byteSize,
    sha: id, // kept for API compat
  };

  const index = readIndex(opts.projectId);
  index.push(meta);

  // Enforce limit — delete oldest snapshots
  while (index.length > MAX_CHECKPOINTS) {
    const oldest = index.shift()!;
    const oldDir = snapshotDir(opts.projectId, oldest.id);
    try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch {}
  }

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
  if (!entry) return { success: false, restored: 0, deleted: 0, message: "Checkpoint not found" };

  try {
    const { restored, deleted } = restoreSnapshot(opts.workDir, opts.projectId, opts.checkpointId);
    return { success: true, restored, deleted };
  } catch (err: any) {
    return { success: false, restored: 0, deleted: 0, message: err.message };
  }
}

export async function deleteCheckpoint(projectId: string, checkpointId: string) {
  const dir = snapshotDir(projectId, checkpointId);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  const index = readIndex(projectId).filter((m) => m.id !== checkpointId);
  writeIndex(projectId, index);
}

export function clearProjectCheckpoints(projectId: string) {
  const index = readIndex(projectId);
  for (const entry of index) {
    const dir = snapshotDir(projectId, entry.id);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  writeIndex(projectId, []);
}
