// PiPilot IDE — Checkpoint (zip snapshot) IPC handlers (Phase 5)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

let archiver = null;
let extract = null;
try { archiver = require('archiver'); } catch (e) { console.warn('[ipc-checkpoints] archiver not available:', e.message); }
try { extract = require('extract-zip'); } catch (e) { console.warn('[ipc-checkpoints] extract-zip not available:', e.message); }

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.pipilot', 'dist', 'build', 'out', '.next', '.cache', '.turbo']);

module.exports = function register(ipcMain, ctx) {
  function ok(data) { return { ok: true, ...(data || {}) }; }
  function fail(err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }

  function checkpointsDir(projectPath) {
    return path.join(projectPath, '.pipilot', 'checkpoints');
  }

  async function ensureDir(dir) {
    await fsp.mkdir(dir, { recursive: true });
  }

  function slugify(s) {
    return String(s || 'checkpoint')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'checkpoint';
  }

  function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  async function listFilesRecursive(root, current = root, out = []) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch { return out; }
    for (const ent of entries) {
      if (EXCLUDED_DIRS.has(ent.name)) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await listFilesRecursive(root, full, out);
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        out.push({ full, rel: path.relative(root, full) });
      }
    }
    return out;
  }

  async function createZip(projectPath, zipPath) {
    if (!archiver) throw new Error('archiver module not available');
    await ensureDir(path.dirname(zipPath));
    const files = await listFilesRecursive(projectPath);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const ar = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      output.on('error', reject);
      ar.on('error', reject);
      ar.pipe(output);
      for (const f of files) {
        ar.file(f.full, { name: f.rel });
      }
      ar.finalize();
    });
  }

  async function listCheckpoints(projectPath) {
    const dir = checkpointsDir(projectPath);
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch { return []; }

    const out = [];
    for (const name of entries) {
      if (!name.endsWith('.zip')) continue;
      const zipPath = path.join(dir, name);
      const id = name.slice(0, -4);
      const sidecarPath = path.join(dir, id + '.json');
      let meta = {};
      try {
        meta = JSON.parse(await fsp.readFile(sidecarPath, 'utf8'));
      } catch {}
      let stat = null;
      try { stat = await fsp.stat(zipPath); } catch {}
      out.push({
        id,
        label: meta.label || id,
        createdAt: meta.createdAt || (stat ? stat.mtimeMs : Date.now()),
        sizeBytes: stat ? stat.size : 0,
        auto: !!meta.auto,
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  async function createCheckpoint(projectPath, label, opts = {}) {
    if (!projectPath) throw new Error('projectPath required');
    const dir = checkpointsDir(projectPath);
    await ensureDir(dir);
    const ts = timestamp();
    const slug = slugify(label || 'checkpoint');
    const id = `${ts}-${slug}`;
    const zipPath = path.join(dir, id + '.zip');
    const sidecarPath = path.join(dir, id + '.json');
    await createZip(projectPath, zipPath);
    const createdAt = Date.now();
    const meta = { id, label: label || slug, createdAt, auto: !!opts.auto };
    await fsp.writeFile(sidecarPath, JSON.stringify(meta, null, 2), 'utf8');
    let sizeBytes = 0;
    try { sizeBytes = (await fsp.stat(zipPath)).size; } catch {}
    return { id, label: meta.label, createdAt, sizeBytes };
  }

  async function deleteProjectFilesExceptCheckpoints(projectPath) {
    const dirEnts = await fsp.readdir(projectPath, { withFileTypes: true });
    for (const ent of dirEnts) {
      if (EXCLUDED_DIRS.has(ent.name)) continue;
      const full = path.join(projectPath, ent.name);
      try {
        await fsp.rm(full, { recursive: true, force: true });
      } catch (err) {
        console.warn('[checkpoints] failed to remove', full, err.message);
      }
    }
  }

  ipcMain.handle('checkpoints:list', async (_e, projectPath) => {
    try {
      if (!projectPath) throw new Error('projectPath required');
      const items = await listCheckpoints(projectPath);
      return ok({ checkpoints: items });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('checkpoints:create', async (_e, payload) => {
    try {
      const { projectPath, label } = payload || {};
      const cp = await createCheckpoint(projectPath, label);
      return ok(cp);
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('checkpoints:restore', async (_e, payload) => {
    try {
      if (!extract) throw new Error('extract-zip module not available');
      const { projectPath, id } = payload || {};
      if (!projectPath || !id) throw new Error('projectPath and id required');
      const dir = checkpointsDir(projectPath);
      const zipPath = path.join(dir, id + '.zip');
      try { await fsp.access(zipPath); } catch { throw new Error('Checkpoint not found: ' + id); }

      const backup = await createCheckpoint(projectPath, `before-restore-${timestamp()}`, { auto: true });
      await deleteProjectFilesExceptCheckpoints(projectPath);
      await extract(zipPath, { dir: projectPath });
      return ok({ restored: id, backupId: backup.id });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('checkpoints:delete', async (_e, payload) => {
    try {
      const { projectPath, id } = payload || {};
      if (!projectPath || !id) throw new Error('projectPath and id required');
      const dir = checkpointsDir(projectPath);
      const zipPath = path.join(dir, id + '.zip');
      const sidecarPath = path.join(dir, id + '.json');
      try { await fsp.unlink(zipPath); } catch {}
      try { await fsp.unlink(sidecarPath); } catch {}
      return ok({ id, deleted: true });
    } catch (err) { return fail(err); }
  });
};
