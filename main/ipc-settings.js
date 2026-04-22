// PiPilot IDE — Settings + shell IPC handlers (Phase 6)

const fsp = require('fs').promises;
const path = require('path');

const DEFAULTS = {
  theme: 'midnight',
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  cursorStyle: 'line',
  tabSize: 2,
  wordWrap: 'off',
  minimap: true,
  lineNumbers: true,
  formatOnSave: false,
  terminalFontSize: 13,
  terminalProfile: null,
  agentDefaultMode: 'agent',
};

module.exports = function register(ipcMain, ctx) {
  const settingsFile = path.join(ctx.userDataPath, 'settings.json');

  function ok(data) { return { ok: true, ...(data || {}) }; }
  function fail(err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }

  async function readAll() {
    try {
      const raw = await fsp.readFile(settingsFile, 'utf8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
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
