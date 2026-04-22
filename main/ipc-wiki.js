// PiPilot IDE — Wiki IPC handlers (matches Vite's /api/wiki/* endpoints)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

module.exports = function register(ipcMain, ctx) {
  function ok(data) { return { ok: true, ...(data || {}) }; }
  function fail(err) { return { ok: false, error: err?.message || String(err) }; }

  function wikiDir(projectPath) {
    return path.join(projectPath, '.pipilot', 'wikis');
  }

  // List all wiki pages
  ipcMain.handle('wiki:tree', async (_e, { projectPath }) => {
    const dir = wikiDir(projectPath);
    if (!fs.existsSync(dir)) return ok({ sections: [], exists: false });
    try {
      const files = await fsp.readdir(dir);
      const sections = [];
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        const fp = path.join(dir, f);
        const stat = await fsp.stat(fp);
        const id = f.replace(/\.md$/, '');
        const title = id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ');
        sections.push({ id, title, path: fp, size: stat.size });
      }
      // Sort: index first, then alphabetically
      sections.sort((a, b) => {
        if (a.id === 'index') return -1;
        if (b.id === 'index') return 1;
        return a.title.localeCompare(b.title);
      });
      return ok({ sections, exists: true });
    } catch (err) { return fail(err); }
  });

  // Read a specific wiki page
  ipcMain.handle('wiki:page', async (_e, { projectPath, pageId }) => {
    const fp = path.join(wikiDir(projectPath), pageId + '.md');
    if (!fs.existsSync(fp)) return fail(new Error('Page not found'));
    try {
      const content = await fsp.readFile(fp, 'utf8');
      return ok({ id: pageId, content });
    } catch (err) { return fail(err); }
  });

  // Save a wiki page
  ipcMain.handle('wiki:save', async (_e, { projectPath, pageId, content }) => {
    const dir = wikiDir(projectPath);
    try {
      await fsp.mkdir(dir, { recursive: true });
      const fp = path.join(dir, pageId + '.md');
      await fsp.writeFile(fp, content, 'utf8');
      return ok({ id: pageId, path: fp });
    } catch (err) { return fail(err); }
  });

  // Delete a wiki page
  ipcMain.handle('wiki:delete', async (_e, { projectPath, pageId }) => {
    const fp = path.join(wikiDir(projectPath), pageId + '.md');
    try {
      if (fs.existsSync(fp)) await fsp.unlink(fp);
      return ok({});
    } catch (err) { return fail(err); }
  });

  // Scan project for wiki generation context
  ipcMain.handle('wiki:scan', async (_e, { projectPath }) => {
    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.pipilot']);
    const files = [];
    let total = 0;
    function walk(dir, rel) {
      if (total > 200) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (total > 200) return;
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else { files.push(r); total++; }
      }
    }
    walk(projectPath, '');
    return ok({ files, total: files.length });
  });
};
