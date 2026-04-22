// PiPilot IDE — Extension system IPC handlers
// Fetches registry from GitHub, installs/uninstalls extension JS files,
// loads installed extensions on startup.

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// GitHub raw URL for the extension registry
const REGISTRY_URL = 'https://raw.githubusercontent.com/pipilot-dev/pipilot-extensions/main/registry.json';
const EXTENSIONS_DIR_NAME = 'extensions';

module.exports = function register(ipcMain, ctx) {

  function extensionsDir() {
    return path.join(ctx.userDataPath, EXTENSIONS_DIR_NAME);
  }

  function installedManifestPath() {
    return path.join(extensionsDir(), 'installed.json');
  }

  async function ensureDir() {
    await fsp.mkdir(extensionsDir(), { recursive: true });
  }

  async function getInstalled() {
    try {
      const raw = await fsp.readFile(installedManifestPath(), 'utf8');
      return JSON.parse(raw);
    } catch { return {}; }
  }

  async function saveInstalled(data) {
    await ensureDir();
    await fsp.writeFile(installedManifestPath(), JSON.stringify(data, null, 2), 'utf8');
  }

  // Fetch the extension registry from GitHub
  ipcMain.handle('extensions:registry', async () => {
    try {
      const resp = await fetch(REGISTRY_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return { ok: true, extensions: data.extensions || [] };
    } catch (err) {
      return { ok: false, error: err.message, extensions: [] };
    }
  });

  // List installed extensions
  ipcMain.handle('extensions:installed', async () => {
    try {
      const installed = await getInstalled();
      return { ok: true, installed };
    } catch (err) {
      return { ok: false, error: err.message, installed: {} };
    }
  });

  // Install an extension: download JS from URL, save to extensions dir
  ipcMain.handle('extensions:install', async (_e, { id, url, manifest }) => {
    try {
      await ensureDir();

      // Download extension JS
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
      const code = await resp.text();

      // Save the JS file
      const filePath = path.join(extensionsDir(), `${id}.js`);
      await fsp.writeFile(filePath, code, 'utf8');

      // Update installed manifest
      const installed = await getInstalled();
      installed[id] = {
        ...manifest,
        installedAt: Date.now(),
        filePath,
        enabled: true,
      };
      await saveInstalled(installed);

      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Uninstall an extension
  ipcMain.handle('extensions:uninstall', async (_e, { id }) => {
    try {
      const installed = await getInstalled();
      if (installed[id]?.filePath) {
        try { await fsp.unlink(installed[id].filePath); } catch {}
      }
      delete installed[id];
      await saveInstalled(installed);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Toggle enable/disable
  ipcMain.handle('extensions:toggle', async (_e, { id, enabled }) => {
    try {
      const installed = await getInstalled();
      if (installed[id]) {
        installed[id].enabled = enabled;
        await saveInstalled(installed);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Get the JS code for an installed extension (renderer loads it)
  ipcMain.handle('extensions:load', async (_e, { id }) => {
    try {
      const installed = await getInstalled();
      const ext = installed[id];
      if (!ext || !ext.filePath) throw new Error('Extension not found');
      const code = await fsp.readFile(ext.filePath, 'utf8');
      return { ok: true, code, manifest: ext };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Get all enabled extensions' code (for startup loading)
  ipcMain.handle('extensions:load-all', async () => {
    try {
      const installed = await getInstalled();
      const results = [];
      for (const [id, ext] of Object.entries(installed)) {
        if (!ext.enabled || !ext.filePath) continue;
        try {
          const code = await fsp.readFile(ext.filePath, 'utf8');
          results.push({ id, code, manifest: ext });
        } catch { /* skip broken extensions */ }
      }
      return { ok: true, extensions: results };
    } catch (err) {
      return { ok: false, error: err.message, extensions: [] };
    }
  });
};
