// PiPilot IDE — Settings + shell IPC handlers (Phase 6)

const fsp = require('fs').promises;
const path = require('path');

const DEFAULTS = {
  theme: 'midnight',
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  cursorStyle: 'line',
  tabSize: 2,
  wordWrap: 'on',
  minimap: true,
  lineNumbers: true,
  formatOnSave: false,
  terminalFontSize: 13,
  terminalProfile: null,
  agentDefaultMode: 'agent',
  // Built-in extensions (always shipped, user-toggleable). Defaults: all on.
  builtinWordCount: true,
  builtinJsdoc: true,
  builtinColorPreview: true,
  builtinFileSizeIndicator: true,
  builtinAutoCloseTag: true,
  builtinApiPlayground: true,
  builtinDependencyGraph: true,
  // Auto-update wiki docs after agent completes a meaningful change
  autoUpdateWiki: true,
  autoUpdateWikiCooldownMs: 5 * 60 * 1000,
};

module.exports = function register(ipcMain, ctx) {
  const settingsFile = path.join(ctx.userDataPath, 'settings.json');

  function ok(data) { return { ok: true, ...(data || {}) }; }
  function fail(err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }

  async function readAll() {
    try {
      const raw = await fsp.readFile(settingsFile, 'utf8');
      const merged = { ...DEFAULTS, ...JSON.parse(raw) };
      // One-shot migration: the original default was wordWrap: 'off', which
      // most users never actively chose. Flip it to 'on' the first time we
      // see an old settings file, then mark it migrated so we never touch
      // an explicitly-toggled value again.
      const migrations = merged.__migrations || {};
      let dirty = false;
      if (!migrations.wordWrapDefaultOn) {
        if (merged.wordWrap === 'off') merged.wordWrap = 'on';
        migrations.wordWrapDefaultOn = true;
        merged.__migrations = migrations;
        dirty = true;
      }
      if (dirty) { try { await writeAll(merged); } catch {} }
      return merged;
    } catch {
      return { ...DEFAULTS };
    }
  }

  async function writeAll(data) {
    await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
    await fsp.writeFile(settingsFile, JSON.stringify(data, null, 2), 'utf8');
  }

  ipcMain.handle('settings:get', async (_e, key) => {
    try {
      const all = await readAll();
      if (!key) return ok({ value: all });
      return ok({ value: all[key] !== undefined ? all[key] : DEFAULTS[key] });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('settings:set', async (_e, payload) => {
    try {
      const { key, value } = payload || {};
      if (!key) throw new Error('key required');
      const all = await readAll();
      all[key] = value;
      await writeAll(all);
      try {
        const win = ctx.getWindow && ctx.getWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('settings:changed', { key, value });
        }
      } catch {}
      return ok({ key, value });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('settings:all', async () => {
    try {
      const all = await readAll();
      return ok({ settings: all });
    } catch (err) { return fail(err); }
  });

};
