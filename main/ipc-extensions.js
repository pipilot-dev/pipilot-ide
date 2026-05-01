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

  // Read the bundled registry that ships with the app — used as a fallback
  // when the GitHub fetch fails (offline / DNS / repo not yet published)
  // AND merged on top so extensions shipped with the app (e.g. our sample
  // themes) are always discoverable even when the user has no network.
  async function readBundledRegistry() {
    try {
      const sourceDir = path.join(ctx.appPath || path.join(__dirname, '..'), 'extensions');
      const raw = await fsp.readFile(path.join(sourceDir, 'registry.json'), 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data?.extensions) ? data.extensions : [];
    } catch { return []; }
  }

  // Fetch the extension registry from GitHub, then merge with the
  // bundled-with-the-app registry so the local sample themes are always
  // present. Bundled entries with the same id win — they're guaranteed
  // to install successfully via the pipilot://builtin/ scheme.
  ipcMain.handle('extensions:registry', async () => {
    const bundled = await readBundledRegistry();
    let remote = [];
    let remoteOk = true;
    try {
      const resp = await fetch(REGISTRY_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      remote = Array.isArray(data?.extensions) ? data.extensions : [];
    } catch { remoteOk = false; }

    // Merge: bundled first (wins on id conflict), then remote-only entries.
    const byId = new Map();
    for (const e of bundled) byId.set(e.id, e);
    for (const e of remote) if (!byId.has(e.id)) byId.set(e.id, e);
    return { ok: true, remoteOk, extensions: [...byId.values()] };
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

  // Resolve the source code for an extension being installed. Two URL
  // schemes are supported:
  //   pipilot://builtin/<id>  → read from the app's bundled extensions/
  //                              dir (sample themes, demos shipped with
  //                              the IDE — works fully offline).
  //   https?://...            → standard fetch from the public registry
  //                              host (GitHub raw, etc).
  async function fetchExtensionCode(id, url) {
    if (typeof url !== 'string') throw new Error('url required');
    if (url.startsWith('pipilot://builtin/')) {
      const wantedId = url.slice('pipilot://builtin/'.length).split('/').pop() || id;
      const sourceDir = path.join(ctx.appPath || path.join(__dirname, '..'), 'extensions');
      // Look in extensions/themes/ first, then extensions/ root.
      const candidates = [
        path.join(sourceDir, 'themes', `${wantedId}.js`),
        path.join(sourceDir, `${wantedId}.js`),
      ];
      for (const p of candidates) {
        try { return await fsp.readFile(p, 'utf8'); } catch {}
      }
      throw new Error(`bundled extension "${wantedId}" not found`);
    }
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
    return await resp.text();
  }

  // Install an extension: resolve source via fetchExtensionCode, save to
  // extensions dir, record in installed manifest.
  ipcMain.handle('extensions:install', async (_e, { id, url, manifest }) => {
    try {
      await ensureDir();
      const code = await fetchExtensionCode(id, url);
      const filePath = path.join(extensionsDir(), `${id}.js`);
      await fsp.writeFile(filePath, code, 'utf8');

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

  // Built-in extensions — shipped with the IDE, always available, gated
  // per-user via settings toggles (key: `builtin.<id>`). Sources live in
  // the app's source `extensions/` directory (NOT userDataPath, which is
  // for user-installed extensions). Each one is read fresh at startup.
  const BUILTIN_EXTENSIONS = [
    { id: 'word-count',          name: 'Word Count',          settingsKey: 'builtinWordCount',          desc: 'Word count, line count, and reading time in the status bar.' },
    { id: 'jsdoc-generator',     name: 'JSDoc Generator',     settingsKey: 'builtinJsdoc',              desc: 'Generate JSDoc comments for selected functions (Mod+Shift+D).' },
    { id: 'color-preview',       name: 'Color Preview',       settingsKey: 'builtinColorPreview',       desc: 'Show colored markers in the gutter for hex / rgb / hsl literals.' },
    { id: 'file-size-indicator', name: 'File Size Indicator', settingsKey: 'builtinFileSizeIndicator',  desc: 'Show file size, line count, and character count in the status bar.' },
    { id: 'auto-close-tag',      name: 'Auto Close Tag',      settingsKey: 'builtinAutoCloseTag',       desc: 'Auto-insert closing tags in HTML/JSX/Vue/Svelte files.' },
    { id: 'api-playground',      name: 'API Playground',      settingsKey: 'builtinApiPlayground',      desc: 'Sidebar HTTP client for testing REST APIs.' },
    { id: 'dependency-graph',    name: 'Dependency Graph',    settingsKey: 'builtinDependencyGraph',    desc: 'Activity-bar tool to visualize import/require relationships.' },
  ];

  ipcMain.handle('extensions:list-builtins', async () => {
    return { ok: true, builtins: BUILTIN_EXTENSIONS };
  });

  // Read source code for built-in extensions. Caller passes a list of the
  // ids it wants enabled (the renderer reads settings and decides). We
  // never load anything not on the BUILTIN_EXTENSIONS allowlist.
  ipcMain.handle('extensions:load-builtins', async (_e, { enabledIds } = {}) => {
    try {
      const allowed = new Set(BUILTIN_EXTENSIONS.map(b => b.id));
      const wanted = Array.isArray(enabledIds) ? enabledIds.filter(id => allowed.has(id)) : Array.from(allowed);
      // Source dir = app/<extensions> from the running app's root.
      const sourceDir = path.join(ctx.appPath || path.join(__dirname, '..'), 'extensions');
      const results = [];
      for (const id of wanted) {
        const filePath = path.join(sourceDir, id + '.js');
        try {
          const code = await fsp.readFile(filePath, 'utf8');
          const meta = BUILTIN_EXTENSIONS.find(b => b.id === id);
          results.push({ id, code, manifest: meta });
        } catch (err) {
          console.warn(`[builtins] missing source for ${id}:`, err.message);
        }
      }
      return { ok: true, extensions: results };
    } catch (err) {
      return { ok: false, error: err.message, extensions: [] };
    }
  });
};
