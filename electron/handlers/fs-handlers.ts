/**
 * File system IPC handlers — migrated from Express server/index.ts.
 *
 * Covers all /api/files/* and /api/preview endpoints.
 * Business logic is extracted verbatim; Express req/res boilerplate is replaced
 * with the IpcContext get/post/del/stream pattern.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import chokidar from "chokidar";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, WORKSPACE_BASE } from "./shared";

// ── Workspace/path helpers ───────────────────────────────────────────────────

/** Resolve a projectId to its absolute working directory. */
function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

/**
 * Resolve a relative path inside a project workspace, with path-traversal guard.
 * If relativePath is omitted, returns the workspace root.
 */
function resolveWorkspacePath(projectId: string, relativePath?: string): string {
  const base = getWorkDir(projectId);
  if (!relativePath) return base;
  const resolved = path.resolve(base, relativePath);
  if (!resolved.startsWith(base)) throw new Error("Invalid path");
  return resolved;
}

// ── File tree helpers ────────────────────────────────────────────────────────

// Folders that appear in the tree but are lazy-loaded on first expansion.
const LAZY_DIRS = new Set([
  "node_modules",
  ".git",
  ".pipilot-data",
  ".next",
  ".nuxt",
  ".cache",
  ".vite",
  ".turbo",
  ".vercel",
  ".svelte-kit",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
]);

// PiPilot internals that should never appear in the tree.
const HIDDEN_NAMES = new Set([
  "CLAUDE.md",
  ".claude_history.json",
  ".pipilot-tsconfig.json",
]);

/** Build a recursive FileNode tree from disk. */
function buildFileTree(dir: string, basePath: string = ""): any[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: any[] = [];

  for (const entry of entries) {
    if (HIDDEN_NAMES.has(entry.name)) continue;

    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (LAZY_DIRS.has(entry.name)) {
        nodes.push({
          id: relativePath,
          name: entry.name,
          type: "folder",
          parentPath: basePath,
          lazy: true,
          children: [],
        });
        continue;
      }
      nodes.push({
        id: relativePath,
        name: entry.name,
        type: "folder",
        parentPath: basePath,
        children: buildFileTree(fullPath, relativePath),
      });
    } else {
      let content = "";
      let language = "plaintext";
      try {
        content = fs.readFileSync(fullPath, "utf8");
        const ext = entry.name.split(".").pop()?.toLowerCase() || "";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          json: "json", html: "html", css: "css", md: "markdown", py: "python",
          svg: "xml", xml: "xml", yml: "yaml", yaml: "yaml", txt: "plaintext",
          sh: "shell", bash: "shell", mjs: "javascript", cjs: "javascript",
        };
        language = langMap[ext] || "plaintext";
      } catch {}

      nodes.push({
        id: relativePath,
        name: entry.name,
        type: "file",
        parentPath: basePath,
        language,
        content,
      });
    }
  }

  // Sort: folders first, then alphabetical
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

// ── Watcher registry ─────────────────────────────────────────────────────────
// Each project can have multiple concurrent watchers. Tracked so that the
// workspace-delete handler can close all of them before deleting the directory
// (otherwise Windows holds file handles and the rm fails).

const activeWatchers = new Map<string, Set<chokidar.FSWatcher>>();

function registerWatcher(projectId: string, watcher: chokidar.FSWatcher) {
  let set = activeWatchers.get(projectId);
  if (!set) { set = new Set(); activeWatchers.set(projectId, set); }
  set.add(watcher);
}

function unregisterWatcher(projectId: string, watcher: chokidar.FSWatcher) {
  const set = activeWatchers.get(projectId);
  if (!set) return;
  set.delete(watcher);
  if (set.size === 0) activeWatchers.delete(projectId);
}

export async function closeAllWatchers(projectId: string) {
  const set = activeWatchers.get(projectId);
  if (!set) return;
  for (const w of set) {
    try { await w.close(); } catch {}
  }
  activeWatchers.delete(projectId);
}

// ── MIME map (shared by /api/files/raw and /api/preview) ────────────────────

const MIME_MAP: Record<string, string> = {
  // Images
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".ico": "image/x-icon", ".avif": "image/avif",
  ".svg": "image/svg+xml",
  // Video
  ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  // Audio
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac",
  // Documents
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Web
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".mjs": "application/javascript", ".json": "application/json",
  ".txt": "text/plain", ".xml": "application/xml",
  // Fonts
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  // Archives
  ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
};

// ── Register all file system handlers ───────────────────────────────────────

export function registerFileSystemHandlers(ctx: IpcContext) {

  // ── GET /api/files/tree ─────────────────────────────────────────────────
  // Returns the full recursive file tree for a project workspace.
  ctx.get("/api/files/tree", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");

    const dir = resolveWorkspacePath(projectId);
    const tree = buildFileTree(dir);
    return { files: tree };
  });

  // ── GET /api/files/zip ──────────────────────────────────────────────────
  // Packages the entire project as a ZIP archive (base64-encoded buffer).
  // Excludes node_modules, .git, build artifacts, and other heavy dirs.
  ctx.get("/api/files/zip", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");

    const workDir = getWorkDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    const SKIP_DIRS = new Set([
      "node_modules", ".git", "dist", "build", ".next", ".nuxt", "out",
      ".cache", ".vite", ".turbo", ".vercel", "coverage",
      "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache",
      "target", "vendor", ".pipilot-data",
    ]);
    const SKIP_FILES = new Set([
      "CLAUDE.md", ".claude_history.json", ".pipilot-tsconfig.json",
    ]);
    const MAX_FILE_BYTES = 25 * 1024 * 1024;
    const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    let totalBytes = 0;
    let fileCount = 0;
    let skippedLargeFiles = 0;

    function walk(dir: string, prefix: string) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (totalBytes >= MAX_TOTAL_BYTES) return;
        if (SKIP_DIRS.has(entry.name)) continue;
        if (SKIP_FILES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(full, rel);
        } else if (entry.isFile()) {
          let stat: fs.Stats;
          try { stat = fs.statSync(full); } catch { continue; }
          if (stat.size > MAX_FILE_BYTES) { skippedLargeFiles++; continue; }
          if (totalBytes + stat.size > MAX_TOTAL_BYTES) return;
          try {
            const buf = fs.readFileSync(full);
            zip.file(rel, buf);
            totalBytes += stat.size;
            fileCount++;
          } catch {}
        }
      }
    }
    walk(workDir, "");

    const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const safeName = query?.name?.replace(/[^a-zA-Z0-9._-]/g, "_") || projectId;

    return {
      // Return as base64 so it can be serialized over IPC
      base64: blob.toString("base64"),
      fileName: `${safeName}.zip`,
      contentType: "application/zip",
      fileCount,
      skippedLargeFiles,
    };
  });

  // ── POST /api/files/zip-selection ───────────────────────────────────────
  // Zip a specific list of files/folders selected by the user.
  // Body: { projectId, paths: string[], name? }
  ctx.post("/api/files/zip-selection", async ({ body }) => {
    const { projectId, paths = [], name = "selection" } = body || {};
    if (!projectId) throw new Error("projectId required");
    if (!Array.isArray(paths) || paths.length === 0) throw new Error("paths required");

    const baseDir = resolveWorkspacePath(projectId);
    if (!fs.existsSync(baseDir)) throw new Error("Workspace not found");

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
    const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
    let total = 0;

    function addFile(absPath: string, relPath: string) {
      try {
        const stat = fs.statSync(absPath);
        if (stat.size > 25 * 1024 * 1024) return;
        if (total + stat.size > MAX_TOTAL_BYTES) return;
        const buf = fs.readFileSync(absPath);
        zip.file(relPath, buf);
        total += stat.size;
      } catch {}
    }

    function walkDir(absDir: string, relDir: string) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const absChild = path.join(absDir, e.name);
        const relChild = relDir ? `${relDir}/${e.name}` : e.name;
        if (e.isDirectory()) walkDir(absChild, relChild);
        else if (e.isFile()) addFile(absChild, relChild);
      }
    }

    for (const p of paths) {
      let abs: string;
      try { abs = resolveWorkspacePath(projectId, p); } catch { continue; }
      if (!fs.existsSync(abs)) continue;
      const stat = fs.statSync(abs);
      const rel = p.replace(/^\/+/, "").replace(/\\/g, "/");
      if (stat.isDirectory()) {
        walkDir(abs, rel);
      } else if (stat.isFile()) {
        addFile(abs, rel);
      }
    }

    const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_") || "selection";

    return {
      base64: blob.toString("base64"),
      fileName: `${safe}.zip`,
      contentType: "application/zip",
    };
  });

  // ── POST /api/files/upload-temp ─────────────────────────────────────────
  // Upload a single file to OS temp dir for agent access.
  // Body: { fileName, base64 }
  // Returns: { path, name }
  ctx.post("/api/files/upload-temp", async ({ body }) => {
    const { fileName, base64 } = body || {};
    if (!fileName || !base64) throw new Error("fileName and base64 required");

    const tmpDir = path.join(os.tmpdir(), "pipilot-uploads");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(tmpDir, safeName);
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    return { path: filePath, name: fileName };
  });

  // ── POST /api/files/upload ───────────────────────────────────────────────
  // Bulk upload files into a workspace folder (drag-and-drop from OS).
  // Body: { projectId, targetFolder, files: [{ name, base64 }] }
  ctx.post("/api/files/upload", async ({ body }) => {
    const { projectId, targetFolder = "", files = [] } = body || {};
    if (!projectId) throw new Error("projectId required");
    if (!Array.isArray(files) || files.length === 0) throw new Error("files required");

    const baseDir = resolveWorkspacePath(projectId);
    const targetDir = targetFolder
      ? resolveWorkspacePath(projectId, targetFolder)
      : baseDir;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const written: string[] = [];
    for (const f of files) {
      if (!f?.name || typeof f.base64 !== "string") continue;
      const safeName = path.basename(f.name);
      if (!safeName || safeName.startsWith(".")) continue;
      const fullPath = path.join(targetDir, safeName);
      if (!fullPath.startsWith(baseDir)) continue;
      try {
        const buf = Buffer.from(f.base64, "base64");
        fs.writeFileSync(fullPath, buf);
        const rel = targetFolder ? `${targetFolder}/${safeName}` : safeName;
        written.push(rel);
      } catch (err) {
        console.error(`[upload] failed to write ${safeName}:`, err);
      }
    }

    return { success: true, written, count: written.length };
  });

  // ── GET /api/files/raw ───────────────────────────────────────────────────
  // Read a binary/media file and return it as base64 with its MIME type.
  // Used by the rich FileViewer (images, video, pdf, audio, svg, etc.).
  // Note: range requests for video/audio are not supported over IPC — the
  // renderer should use a dedicated file:// URL or a native protocol handler
  // for large media. This handler is intended for previewing small-to-medium
  // files (images, PDFs, fonts) without a round-trip over HTTP.
  ctx.get("/api/files/raw", async ({ query }) => {
    const projectId = query?.projectId;
    const filePath = query?.path;
    if (!projectId || !filePath) throw new Error("projectId and path required");

    const fullPath = resolveWorkspacePath(projectId, filePath);
    if (!fs.existsSync(fullPath)) throw new Error("File not found");
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) throw new Error("Not a file");

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext] || "application/octet-stream";
    const buf = fs.readFileSync(fullPath);

    return {
      base64: buf.toString("base64"),
      contentType: mime,
      size: stat.size,
    };
  });

  // ── GET /api/files/list-dir ──────────────────────────────────────────────
  // List immediate children of a folder (one level, lazy-loading).
  // Used by the explorer when the user expands a lazy node (node_modules etc.).
  ctx.get("/api/files/list-dir", async ({ query }) => {
    const projectId = query?.projectId;
    const relPath = query?.path || "";
    if (!projectId) throw new Error("projectId required");

    const fullPath = resolveWorkspacePath(projectId, relPath);
    if (!fs.existsSync(fullPath)) throw new Error("Path not found");
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) throw new Error("Not a directory");

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const nodes: any[] = [];

    for (const entry of entries) {
      if (HIDDEN_NAMES.has(entry.name)) continue;

      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        nodes.push({
          id: childRel,
          name: entry.name,
          type: "folder",
          parentPath: relPath,
          lazy: true,
          children: [],
        });
      } else {
        const ext = entry.name.split(".").pop()?.toLowerCase() || "";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          json: "json", html: "html", css: "css", md: "markdown", py: "python",
          svg: "xml", xml: "xml", yml: "yaml", yaml: "yaml", txt: "plaintext",
          sh: "shell", bash: "shell", mjs: "javascript", cjs: "javascript",
        };
        nodes.push({
          id: childRel,
          name: entry.name,
          type: "file",
          parentPath: relPath,
          language: langMap[ext] || "plaintext",
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { children: nodes };
  });

  // ── GET /api/files/read ──────────────────────────────────────────────────
  // Read a single text file.
  ctx.get("/api/files/read", async ({ query }) => {
    const projectId = query?.projectId;
    const filePath = query?.path;
    if (!projectId || !filePath) throw new Error("projectId and path required");

    const fullPath = resolveWorkspacePath(projectId, filePath);
    if (!fs.existsSync(fullPath)) throw new Error("File not found");
    const content = fs.readFileSync(fullPath, "utf8");
    return { content };
  });

  // ── POST /api/files/write ────────────────────────────────────────────────
  // Write (create or overwrite) a file.
  // Body: { projectId, path, content }
  ctx.post("/api/files/write", async ({ body }) => {
    const { projectId, path: filePath, content } = body || {};
    if (!projectId || !filePath) throw new Error("projectId and path required");

    const fullPath = resolveWorkspacePath(projectId, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content || "", "utf8");
    return { success: true };
  });

  // ── POST /api/files/mkdir ────────────────────────────────────────────────
  // Create a directory (and all intermediate paths).
  // Body: { projectId, path }
  ctx.post("/api/files/mkdir", async ({ body }) => {
    const { projectId, path: dirPath } = body || {};
    if (!projectId || !dirPath) throw new Error("projectId and path required");

    const fullPath = resolveWorkspacePath(projectId, dirPath);
    fs.mkdirSync(fullPath, { recursive: true });
    return { success: true };
  });

  // ── DELETE /api/files ────────────────────────────────────────────────────
  // Delete a file or directory (recursive).
  ctx.del("/api/files", async ({ query }) => {
    const projectId = query?.projectId;
    const filePath = query?.path;
    if (!projectId || !filePath) throw new Error("projectId and path required");

    const fullPath = resolveWorkspacePath(projectId, filePath);
    if (!fs.existsSync(fullPath)) throw new Error("Not found");
    fs.rmSync(fullPath, { recursive: true, force: true });
    return { success: true };
  });

  // ── POST /api/files/rename ───────────────────────────────────────────────
  // Rename or move a file/directory within the workspace.
  // Body: { projectId, oldPath, newPath }
  ctx.post("/api/files/rename", async ({ body }) => {
    const { projectId, oldPath, newPath } = body || {};
    if (!projectId || !oldPath || !newPath) throw new Error("projectId, oldPath, and newPath required");

    const from = resolveWorkspacePath(projectId, oldPath);
    const to = resolveWorkspacePath(projectId, newPath);
    if (!fs.existsSync(from)) throw new Error("Source not found");
    const toDir = path.dirname(to);
    if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
    fs.renameSync(from, to);
    return { success: true };
  });

  // ── POST /api/files/seed ─────────────────────────────────────────────────
  // Seed a new workspace with initial files. Will not overwrite an existing workspace.
  // Body: { projectId, files: [{ path, content }] }
  ctx.post("/api/files/seed", async ({ body }) => {
    const { projectId, files } = body || {};
    if (!projectId) throw new Error("projectId required");

    const dir = resolveWorkspacePath(projectId);

    // If workspace already has files, don't overwrite
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      return { seeded: false, message: "Workspace already exists" };
    }

    fs.mkdirSync(dir, { recursive: true });

    if (Array.isArray(files)) {
      for (const file of files) {
        try {
          const fullPath = resolveWorkspacePath(projectId, file.path);
          const fileDir = path.dirname(fullPath);
          if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
          fs.writeFileSync(fullPath, file.content || "", "utf8");
        } catch {}
      }
    }

    return { seeded: true, fileCount: files?.length || 0 };
  });

  // ── DELETE /api/files/workspace ──────────────────────────────────────────
  // Delete a project's workspace directory entirely.
  //
  // CRITICAL: For LINKED workspaces (real on-disk folders the user opened from
  // elsewhere) we MUST NOT delete the underlying directory — we only unlink
  // the mapping. For non-linked workspaces (those under WORKSPACE_BASE) we
  // delete the directory with Windows-safe retry logic.
  //
  // Windows-specific: chokidar watchers and running dev servers can hold file
  // handles. We close all watchers, stop the dev server, and kill stray PTYs
  // before attempting deletion, with retries and a manual-walk fallback.
  ctx.del("/api/files/workspace", async ({ query }) => {
    // Lazy-import here so fs-handlers doesn't create a circular dependency.
    // terminal-handlers exports the PTY kill helpers; devserver-handlers
    // exports stopDevServer; checkpoint-handlers exports clearProjectCheckpoints.
    // In the IPC world these modules all run in the same process, so the
    // Map references are shared.
    const { isLinked, unlinkFolder } = await import("../../server/workspaces");
    const { stopDevServer } = await import("../../server/dev-server");
    const { clearProjectCheckpoints } = await import("../../server/checkpoints");

    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");

    const linked = isLinked(projectId);
    if (linked) {
      try { unlinkFolder(projectId); } catch {}
      try { clearProjectCheckpoints(projectId); } catch {}
      return { success: true, unlinked: true };
    }

    const dir = getWorkDir(projectId);
    if (fs.existsSync(dir)) {
      // 1a. Stop the dev server (releases .next/.vite/dist/node_modules locks)
      try { await stopDevServer(projectId); } catch {}

      // 1b. Close ALL chokidar watchers for this project
      await closeAllWatchers(projectId);

      // 1c. On Windows, kill stray processes referencing this folder
      if (process.platform === "win32") {
        await killStrayProcessesInFolder(dir);
      }

      // 2. Give the OS a moment to release handles (Windows is slow)
      await new Promise((r) => setTimeout(r, 250));

      // 3. Try the modern async fs.rm with retries
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.promises.rm(dir, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          if (err.code !== "EBUSY" && err.code !== "EPERM" && err.code !== "ENOTEMPTY") break;
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }

      // 4. Last-resort manual walk if rm still failed
      if (lastErr && fs.existsSync(dir)) {
        console.warn(`[delete workspace] fs.rm failed (${lastErr.code}), falling back to manual walk`);
        const walk = (d: string) => {
          try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, entry.name);
              if (entry.isDirectory()) walk(p);
              else { try { fs.unlinkSync(p); } catch {} }
            }
            try { fs.rmdirSync(d); } catch {}
          } catch {}
        };
        walk(dir);
      }

      // 5. If the directory still exists (held by external process), empty it
      //    and return partial success so the UI can prompt for manual removal.
      if (fs.existsSync(dir)) {
        const emptyDir = (d: string) => {
          try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, entry.name);
              try {
                if (entry.isDirectory()) {
                  emptyDir(p);
                  try { fs.rmdirSync(p); } catch {}
                } else {
                  fs.unlinkSync(p);
                }
              } catch {}
            }
          } catch {}
        };
        emptyDir(dir);

        let leftoverCount = 0;
        try {
          const countWalk = (d: string) => {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
              if (entry.isDirectory()) countWalk(path.join(d, entry.name));
              else leftoverCount++;
            }
          };
          countWalk(dir);
        } catch {}

        try { clearProjectCheckpoints(projectId); } catch {}

        return {
          success: true,
          partial: true,
          path: dir,
          leftoverCount,
          message:
            "The project folder couldn't be removed because it's held open by another process. " +
            "The folder has been emptied — close PiPilot IDE and delete the empty folder manually.",
        };
      }
    }

    try { clearProjectCheckpoints(projectId); } catch {}
    return { success: true };
  });

  // ── GET /api/files/watch (SSE) ───────────────────────────────────────────
  // Streams file-tree changes in real-time via the IPC stream pattern.
  // Sends { type: "tree", files: [...] } on initial connect and after each
  // debounced change. Sends { type: "heartbeat" } every 15 seconds.
  ctx.stream("GET", "/api/files/watch", async ({ query }, send, done) => {
    const projectId = query?.projectId;
    if (!projectId) {
      send({ error: "projectId required" });
      done();
      return;
    }

    const dir = getWorkDir(projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Send initial tree immediately
    const initialTree = buildFileTree(dir);
    send({ type: "tree", files: initialTree });

    // Set up chokidar watcher
    const watcher = chokidar.watch(dir, {
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        "**/.cache/**",
        "**/.claude/**",
        "**/.claude_history.json",
        "**/CLAUDE.md",
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });
    registerWatcher(projectId, watcher);

    const sendUpdate = () => {
      try {
        const tree = buildFileTree(dir);
        send({ type: "tree", files: tree });
      } catch {}
    };

    // Debounce rapid changes
    let debounceTimer: NodeJS.Timeout | null = null;
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(sendUpdate, 300);
    };

    watcher.on("add", debouncedUpdate);
    watcher.on("change", debouncedUpdate);
    watcher.on("unlink", debouncedUpdate);
    watcher.on("addDir", debouncedUpdate);
    watcher.on("unlinkDir", debouncedUpdate);

    // Heartbeat every 15s to keep the stream alive
    const heartbeat = setInterval(() => {
      try { send({ type: "heartbeat" }); } catch {}
    }, 15000);

    // The stream runs indefinitely until the renderer disconnects.
    // We return a Promise that never resolves — the IPC layer calls done()
    // when the stream is explicitly closed from the renderer side.
    // Cleanup is handled by the watcher's own close logic.
    await new Promise<void>((resolve) => {
      // Resolve (and thus end this handler) when the watcher errors or is
      // explicitly closed from outside (e.g. workspace deletion).
      watcher.on("error", () => {
        clearInterval(heartbeat);
        if (debounceTimer) clearTimeout(debounceTimer);
        unregisterWatcher(projectId, watcher);
        watcher.close().catch(() => {});
        done();
        resolve();
      });

      // Allow external callers (closeAllWatchers) to trigger cleanup.
      // We listen for the watcher's own close event.
      watcher.on("close" as any, () => {
        clearInterval(heartbeat);
        if (debounceTimer) clearTimeout(debounceTimer);
        unregisterWatcher(projectId, watcher);
        done();
        resolve();
      });
    });
  });

  // ── GET /api/preview ─────────────────────────────────────────────────────
  // Serve a workspace file with correct MIME type for in-app preview.
  // Returns the file as base64 so it can be rendered client-side.
  // For HTML files the client should use a sandboxed iframe / blob URL.
  ctx.get("/api/preview", async ({ query }) => {
    const projectId = query?.projectId;
    const filePath = (query?.path) || "index.html";

    if (!projectId) throw new Error("projectId required");

    const fullPath = resolveWorkspacePath(projectId, filePath);

    // Try the path; fall back to index.html for directory requests
    let resolvedPath = fullPath;
    if (!fs.existsSync(fullPath)) {
      const indexPath = path.join(fullPath, "index.html");
      if (fs.existsSync(indexPath)) {
        resolvedPath = indexPath;
      } else {
        throw new Error("Not found");
      }
    } else {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const indexPath = path.join(fullPath, "index.html");
        if (fs.existsSync(indexPath)) {
          resolvedPath = indexPath;
        } else {
          throw new Error("Not found");
        }
      }
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const mime = MIME_MAP[ext] || "application/octet-stream";
    const buf = fs.readFileSync(resolvedPath);

    return {
      base64: buf.toString("base64"),
      contentType: mime,
    };
  });

  // ── GET /api/files/types ─────────────────────────────────────────────────
  // Serve TypeScript type definitions from node_modules for Monaco IntelliSense.
  // Returns a map of { relPath: fileContent } for all .d.ts files in the package.
  ctx.get("/api/files/types", async ({ query }) => {
    const projectId = query?.projectId;
    const pkg = query?.package;
    if (!projectId || !pkg) throw new Error("projectId and package required");

    const workDir = getWorkDir(projectId);
    const nodeModules = path.join(workDir, "node_modules");

    if (!fs.existsSync(nodeModules)) return { files: {} };

    const typesMap: Record<string, string> = {};

    // Check @types/{pkg} first, then the package itself
    const candidates = [
      path.join(nodeModules, "@types", pkg.replace("@", "").replace("/", "__")),
      path.join(nodeModules, pkg),
    ];

    function walkTypes(dir: string, base: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          const rel = base ? `${base}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            walkTypes(full, rel);
          } else if (
            entry.name.endsWith(".d.ts") ||
            entry.name.endsWith(".d.mts") ||
            entry.name === "package.json"
          ) {
            try { typesMap[rel] = fs.readFileSync(full, "utf8"); } catch {}
          }
        }
      } catch {}
    }

    for (const pkgDir of candidates) {
      if (!fs.existsSync(pkgDir)) continue;
      walkTypes(pkgDir, "");
      if (Object.keys(typesMap).length > 0) break;
    }

    return { files: typesMap, package: pkg };
  });
}

// ── Internal utility: kill stray processes referencing a folder (Windows) ───

async function killStrayProcessesInFolder(absoluteFolder: string): Promise<number> {
  if (process.platform !== "win32") return 0;

  const folderName = path.basename(absoluteFolder);
  if (!folderName || folderName.length < 4) return 0;

  const pids: number[] = await new Promise((resolve) => {
    let out = "";
    const child = spawn(
      "wmic",
      [
        "process",
        "where",
        `(CommandLine like "%${folderName}%" OR ExecutablePath like "%${folderName}%")`,
        "get",
        "ProcessId",
      ],
      { shell: true },
    );
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.on("exit", () => {
      const list = out
        .split(/\r?\n/)
        .map((l) => parseInt(l.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      resolve(list);
    });
    child.on("error", () => resolve([]));
    setTimeout(() => { try { child.kill(); } catch {}; resolve([]); }, 8000);
  });

  const myPid = process.pid;
  const filtered = pids.filter((p) => p !== myPid);

  for (const pid of filtered) {
    try {
      spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { shell: true });
    } catch {}
  }

  if (filtered.length > 0) {
    await new Promise((r) => setTimeout(r, 300));
  }
  return filtered.length;
}
