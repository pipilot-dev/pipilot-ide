// PiPilot IDE — File system IPC handlers (Phase 2)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { shell } = require('electron');
const chokidar = require('chokidar');

// Hidden from tree entirely
const IGNORED = new Set([
  '.DS_Store',
  '_pipilot_history.json',
]);

// Entries hidden inside specific parents (e.g. .pipilot/checkpoints, .pipilot/search-index.json)
const IGNORED_CHILDREN = { '.pipilot': new Set(['checkpoints', 'search-index.json']) };

// Ignored by file watchers (never watch these — too many files, causes lag)
const WATCHER_IGNORED = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'dist',
  'build',
  'out',
  '.cache',
  '.turbo',
  '.angular',
  '__pycache__',
  '.tox',
  'vendor',
  'target',
  '.pipilot',
  '.DS_Store',
]);

// Heavy directories — shown in tree, only subfolders loaded (no files), click opens in OS explorer
const HEAVY_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.turbo',
  '.angular',
  '__pycache__',
  '.tox',
  'vendor',
  'target',
]);

// Lazy directories — shown in tree, full children loaded on expand
const LAZY_DIRS = new Set([
  'dist',
  'build',
  'out',
]);

const MAX_DEPTH = 5;
const BINARY_THRESHOLD_BYTES = 1024 * 1024;
const SEARCH_MAX_RESULTS = 500;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;

function safeAbsolute(p) {
  if (typeof p !== 'string' || !p) throw new Error('Path is required');
  if (!path.isAbsolute(p)) throw new Error('Path must be absolute: ' + p);
  // Block any traversal segments in the literal string
  const norm = path.normalize(p);
  if (norm.split(path.sep).includes('..')) throw new Error('Path traversal not allowed');
  return norm;
}

// Shallow tree — heavy dirs (node_modules, .git, etc.) marked lazy, loaded on demand
// Yields to event loop every YIELD_BATCH dirs to prevent main process freeze
let walkBatchCount = 0;
const WALK_YIELD_EVERY = 20;

async function walkTree(dir, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  // Yield to event loop periodically to prevent UI freeze
  walkBatchCount++;
  if (walkBatchCount % WALK_YIELD_EVERY === 0) {
    await new Promise(r => setImmediate(r));
  }

  const parentName = path.basename(dir);
  const parentIgnored = IGNORED_CHILDREN[parentName];
  const dirs = [];
  const files = [];
  for (const ent of entries) {
    if (IGNORED.has(ent.name)) continue;
    if (parentIgnored && parentIgnored.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (HEAVY_DIRS.has(ent.name) || ent.name.startsWith('.')) {
        // Heavy dir — show folder, only load subfolders (no files)
        dirs.push({ name: ent.name, path: full, type: 'dir', lazy: true, heavy: true, children: [] });
      } else if (LAZY_DIRS.has(ent.name)) {
        // Lazy dir — show folder, load full children on demand
        dirs.push({ name: ent.name, path: full, type: 'dir', lazy: true, children: [] });
      } else {
        const children = await walkTree(full, depth + 1);
        dirs.push({ name: ent.name, path: full, type: 'dir', children: children || [] });
      }
    } else if (ent.isFile() || ent.isSymbolicLink()) {
      files.push({ name: ent.name, path: full, type: 'file' });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

// Check if a path is inside a heavy directory
function isInsideHeavyDir(dirPath) {
  const segments = dirPath.split(path.sep);
  return segments.some(s => HEAVY_DIRS.has(s));
}

// List immediate children of a single directory (for lazy loading)
// Heavy dirs: only return subdirectories (no files) to keep tree lightweight
async function listDirShallow(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const parentName = path.basename(dir);
  const parentIgnored = IGNORED_CHILDREN[parentName];
  const heavy = isInsideHeavyDir(dir);
  const dirs = [];
  const files = [];
  for (const ent of entries) {
    if (IGNORED.has(ent.name)) continue;
    if (parentIgnored && parentIgnored.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      dirs.push({ name: ent.name, path: full, type: 'dir', lazy: true, heavy, children: [] });
    } else if (!heavy && (ent.isFile() || ent.isSymbolicLink())) {
      files.push({ name: ent.name, path: full, type: 'file' });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

function isLikelyBinary(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function listChildren(dirPath, includeHidden = false) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    const isHidden = ent.name.startsWith('.');
    if (!includeHidden && isHidden) continue;
    out.push({
      name: ent.name,
      path: path.join(dirPath, ent.name),
      isDir: ent.isDirectory(),
      isHidden,
    });
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

async function searchInProject(projectPath, query, opts = {}) {
  const results = [];
  const caseSensitive = !!opts.caseSensitive;
  const useRegex = !!opts.regex;
  let matcher;
  if (useRegex) {
    try {
      matcher = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch (e) {
      throw new Error('Invalid regex: ' + e.message);
    }
  } else {
    const q = caseSensitive ? query : query.toLowerCase();
    matcher = {
      test(line) {
        return (caseSensitive ? line : line.toLowerCase()).includes(q);
      },
      find(line) {
        const hay = caseSensitive ? line : line.toLowerCase();
        const idx = hay.indexOf(q);
        return idx === -1 ? null : { index: idx, length: query.length };
      },
    };
  }

  async function walk(dir) {
    if (results.length >= SEARCH_MAX_RESULTS) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (results.length >= SEARCH_MAX_RESULTS) return;
      if (IGNORED.has(ent.name) || WATCHER_IGNORED.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        try {
          const stat = await fsp.stat(full);
          if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
          const buf = await fsp.readFile(full);
          if (isLikelyBinary(buf)) continue;
          const text = buf.toString('utf8');
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (useRegex) {
              matcher.lastIndex = 0;
              const m = matcher.exec(line);
              if (m) {
                results.push({
                  file: full,
                  line: i + 1,
                  col: m.index + 1,
                  preview: line.slice(0, 300),
                });
                if (results.length >= SEARCH_MAX_RESULTS) return;
              }
            } else {
              const m = matcher.find(line);
              if (m) {
                results.push({
                  file: full,
                  line: i + 1,
                  col: m.index + 1,
                  preview: line.slice(0, 300),
                });
                if (results.length >= SEARCH_MAX_RESULTS) return;
              }
            }
          }
        } catch {
          // ignore unreadable files
        }
      }
    }
  }

  await walk(projectPath);
  return results;
}

module.exports = function register(ipcMain, ctx) {
  const watchers = new Map();

  ipcMain.handle('files:tree', async (_e, projectPath) => {
    const root = safeAbsolute(projectPath);
    const _t0 = Date.now();
    walkBatchCount = 0;
    const children = await walkTree(root, 0);
    const name = path.basename(root) || root;
    console.log(`[startup] walkTree(${name}) took ${Date.now() - _t0}ms (${walkBatchCount} dirs scanned)`);
    return {
      name,
      path: root,
      type: 'dir',
      children: children || [],
    };
  });

  // Lazy load: list immediate children of a directory (for expanding heavy dirs)
  ipcMain.handle('files:list-dir', async (_e, dirPath) => {
    const p = safeAbsolute(dirPath);
    return await listDirShallow(p);
  });

  // ZIP selected files/folders — filters out heavy dirs, returns a temp file path
  const SKIP_IN_ZIP = new Set([
    'node_modules', '.git', '.next', '.nuxt', '.cache', '.turbo',
    'dist', 'build', 'out', '.svelte-kit', '.angular', '__pycache__',
    '.tox', 'vendor', 'target', '.venv', 'venv', '.mypy_cache',
    '.pytest_cache', 'coverage', '.DS_Store',
  ]);

  // Save pasted/dropped file data to OS temp folder, return the path
  ipcMain.handle('files:save-temp', async (_e, { fileName, base64, buffer }) => {
    const tmpDir = path.join(require('os').tmpdir(), 'pipilot-paste');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
    const safeName = (fileName || 'paste-' + Date.now()).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(tmpDir, safeName);
    if (base64) {
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    } else if (buffer) {
      fs.writeFileSync(filePath, Buffer.from(buffer));
    }
    return { ok: true, path: filePath, name: safeName };
  });

  ipcMain.handle('files:zip', async (_e, { paths: selectedPaths, projectPath, savePath }) => {
    const archiver = require('archiver');
    const root = safeAbsolute(projectPath);
    const zipPath = savePath || path.join(require('os').tmpdir(), (path.basename(root) || 'export') + '-' + Date.now() + '.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => resolve({ ok: true, path: zipPath, size: archive.pointer() }));
      archive.on('error', (err) => reject(err));
      archive.pipe(output);

      const addPath = async (absPath) => {
        const stat = await fsp.stat(absPath).catch(() => null);
        if (!stat) return;
        const rel = path.relative(root, absPath).replace(/\\/g, '/');

        if (stat.isFile()) {
          archive.file(absPath, { name: rel });
        } else if (stat.isDirectory()) {
          const name = path.basename(absPath);
          if (SKIP_IN_ZIP.has(name) && name !== '.pipilot') return;
          // Recurse directory but skip heavy subdirs
          const entries = await fsp.readdir(absPath, { withFileTypes: true }).catch(() => []);
          for (const ent of entries) {
            if (SKIP_IN_ZIP.has(ent.name) && ent.name !== '.pipilot') continue;
            await addPath(path.join(absPath, ent.name));
          }
        }
      };

      (async () => {
        for (const p of selectedPaths) {
          await addPath(safeAbsolute(p));
        }
        archive.finalize();
      })().catch(reject);
    });
  });

  ipcMain.handle('files:read', async (_e, filePath) => {
    const p = safeAbsolute(filePath);
    const stat = await fsp.stat(p);
    const ext = path.extname(p).toLowerCase().slice(1);
    const MIME_MAP = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      ico: 'image/x-icon', bmp: 'image/bmp',
      pdf: 'application/pdf', zip: 'application/zip',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
      mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
    };
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    const isImage = /^image\//.test(mime);
    if (stat.size > BINARY_THRESHOLD_BYTES) {
      return { binary: true, size: stat.size, mime };
    }
    const buf = await fsp.readFile(p);
    // MIME-first short-circuit: small JPGs (and some videos/fonts/pdfs)
    // can have zero NUL bytes in the first 8 KB, so isLikelyBinary's
    // null-byte heuristic misses them and they get UTF-8-decoded into
    // mojibake in the editor. If the extension already tells us it's a
    // known media/font/pdf type, trust it.
    const knownBinary = isImage
      || /^(video|audio|font)\//.test(mime)
      || mime === 'application/pdf'
      || mime === 'application/zip';
    if (knownBinary || isLikelyBinary(buf)) {
      let dataUrl = null;
      // Inline a data URL for any media type the renderer can preview, up to 25MB
      const isMedia = isImage || /^(video|audio)\//.test(mime) || mime === 'application/pdf';
      if (isMedia && stat.size < 25 * 1024 * 1024) {
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      }
      return { binary: true, size: stat.size, mime, dataUrl };
    }
    return {
      content: buf.toString('utf8'),
      encoding: 'utf8',
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  });

  ipcMain.handle('files:write', async (_e, { filePath, content }) => {
    const p = safeAbsolute(filePath);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, content ?? '', 'utf8');
    const stat = await fsp.stat(p);
    return { ok: true, mtime: stat.mtimeMs, size: stat.size };
  });

  ipcMain.handle('files:mkdir', async (_e, dirPath) => {
    const p = safeAbsolute(dirPath);
    await fsp.mkdir(p, { recursive: true });
    return { ok: true };
  });

  ipcMain.handle('files:delete', async (_e, targetPath) => {
    const p = safeAbsolute(targetPath);
    await fsp.rm(p, { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('files:rename', async (_e, { from, to }) => {
    const src = safeAbsolute(from);
    const dst = safeAbsolute(to);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(src, dst);
    return { ok: true };
  });

  // OS → IDE drag-and-drop. `sources` is an array of absolute paths
  // outside the project (resolved by webUtils.getPathForFile in
  // preload). `destDir` is the project-relative or absolute directory
  // they should land in. Files and directories are copied
  // recursively. Name collisions get a " (n)" suffix so we never
  // silently overwrite the user's existing files.
  ipcMain.handle('files:import-external', async (_e, { sources = [], destDir } = {}) => {
    if (!destDir || !Array.isArray(sources) || !sources.length) {
      return { ok: false, error: 'sources and destDir required' };
    }
    const dst = safeAbsolute(destDir);
    await fsp.mkdir(dst, { recursive: true });

    async function uniqueDestPath(dir, name) {
      let candidate = path.join(dir, name);
      try { await fsp.access(candidate); }
      catch { return candidate; } // doesn't exist → use as-is
      const ext = path.extname(name);
      const base = ext ? name.slice(0, -ext.length) : name;
      for (let i = 1; i < 1000; i++) {
        candidate = path.join(dir, `${base} (${i})${ext}`);
        try { await fsp.access(candidate); }
        catch { return candidate; }
      }
      throw new Error('too many name collisions');
    }

    const imported = [];
    const errors = [];
    for (const src of sources) {
      if (!src || typeof src !== 'string') continue;
      try {
        const stat = await fsp.stat(src);
        const dest = await uniqueDestPath(dst, path.basename(src));
        if (stat.isDirectory()) {
          await fsp.cp(src, dest, { recursive: true });
        } else {
          await fsp.copyFile(src, dest);
        }
        imported.push(dest);
      } catch (err) {
        errors.push({ src, error: err.message });
      }
    }
    return { ok: errors.length === 0, imported, errors };
  });

  ipcMain.handle('files:stat', async (_e, p) => {
    try {
      const abs = safeAbsolute(p);
      const stat = await fsp.stat(abs);
      return {
        exists: true,
        isDir: stat.isDirectory(),
        size: stat.size,
        mtime: stat.mtimeMs,
      };
    } catch {
      return { exists: false, isDir: false, size: 0, mtime: 0 };
    }
  });

  ipcMain.handle('files:list', async (_e, dirPath) => {
    const p = safeAbsolute(dirPath);
    return listChildren(p, false);
  });

  ipcMain.handle('files:search', async (_e, { projectPath, query, opts }) => {
    if (!query) return [];
    const root = safeAbsolute(projectPath);
    return searchInProject(root, query, opts || {});
  });

  ipcMain.handle('files:watch:start', async (e, { streamId, projectPath }) => {
    const root = safeAbsolute(projectPath);
    if (watchers.has(streamId)) return { ok: true };

    const _t0 = Date.now();
    const watcher = chokidar.watch(root, {
      ignored: (p) => {
        // Check every segment — if any part is in WATCHER_IGNORED, skip it
        const segments = p.split(path.sep);
        return segments.some(s => WATCHER_IGNORED.has(s));
      },
      ignoreInitial: true,
      depth: 4,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      usePolling: false,
    });
    watcher.once('ready', () => {
      console.log(`[startup] chokidar ready (root=${path.basename(root)}) in ${Date.now() - _t0}ms`);
    });

    const send = (type, p) => {
      const win = ctx.getWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send(`files:watch:${streamId}`, { type, path: p });
      }
    };

    watcher
      .on('add', (p) => send('add', p))
      .on('change', (p) => send('change', p))
      .on('unlink', (p) => send('unlink', p))
      .on('addDir', (p) => send('addDir', p))
      .on('unlinkDir', (p) => send('unlinkDir', p))
      .on('error', (err) => console.error('watcher error:', err));

    watchers.set(streamId, watcher);
    return { ok: true };
  });

  ipcMain.handle('files:watch:stop', async (_e, streamId) => {
    const w = watchers.get(streamId);
    if (w) {
      try { await w.close(); } catch {}
      watchers.delete(streamId);
    }
    return { ok: true };
  });

  ipcMain.handle('fs:home', () => os.homedir());

  ipcMain.handle('fs:list', async (_e, dirPath) => {
    const p = safeAbsolute(dirPath || os.homedir());
    return listChildren(p, false);
  });

  ipcMain.handle('shell:open-external', async (_e, url) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('shell:show-in-folder', async (_e, p) => {
    const abs = safeAbsolute(p);
    shell.showItemInFolder(abs);
    return { ok: true };
  });
};
