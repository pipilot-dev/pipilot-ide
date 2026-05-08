// PiPilot IDE — Embedded browser (in-app webview)
//
// Backs the renderer's <webview>-based browser tabs:
//   - Tracks downloads on the browser session and streams progress events
//     back to the renderer (which surfaces them through the notification
//     system + a downloads list).
//   - Persists history + bookmarks to <userData>/browser/{history,bookmarks}.json
//   - Exposes a small IPC surface for opening external URLs, clearing
//     browsing data, and per-session UA spoofing.

const path = require('path');
const fs = require('fs');
const { app, session, shell, dialog, BrowserWindow } = require('electron');

const BROWSER_PARTITION = 'persist:pipilot-browser';
const INCOGNITO_PARTITION = 'pipilot-browser-incognito'; // no `persist:` prefix → in-memory only
const WEBVIEW_PRELOAD = path.join(__dirname, 'browser-webview-preload.js');

module.exports = function register(ipcMain, ctx) {
  const userData = app.getPath('userData');
  const browserDir = path.join(userData, 'browser');
  const historyPath = path.join(browserDir, 'history.json');
  const bookmarksPath = path.join(browserDir, 'bookmarks.json');
  const permsPath = path.join(browserDir, 'permissions.json');
  const downloadsRoot = path.join(app.getPath('downloads') || userData, 'PiPilot');

  try { fs.mkdirSync(browserDir, { recursive: true }); } catch {}
  try { fs.mkdirSync(downloadsRoot, { recursive: true }); } catch {}

  function readJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
  }
  function writeJson(p, data) {
    try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (err) { console.warn('[browser] write failed:', err); }
  }

  // ── Download tracking ────────────────────────────────────────────
  // We attach a single will-download listener to each browser session
  // (regular + incognito). Each download gets a stable id; renderer
  // subscribes to `browser:download:event` for { id, kind, ...data }.
  const wiredSessions = new Set();
  function wireDownloads(sess) {
    if (wiredSessions.has(sess)) return;
    wiredSessions.add(sess);
    sess.on('will-download', (event, item) => {
      const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const fileName = item.getFilename();
      const url = item.getURL();
      const totalBytes = item.getTotalBytes();
      const savePath = path.join(downloadsRoot, fileName);
      try { item.setSavePath(savePath); } catch {}
      const win = ctx.getWindow && ctx.getWindow();
      const send = (kind, extra) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('browser:download:event', { id, kind, ...extra });
        }
      };
      send('start', { fileName, url, totalBytes, savePath });
      item.on('updated', (_e, state) => {
        if (state === 'progressing') {
          send('progress', {
            received: item.getReceivedBytes(),
            totalBytes,
            isPaused: item.isPaused(),
          });
        } else if (state === 'interrupted') {
          send('interrupted', { reason: 'paused' });
        }
      });
      item.once('done', (_e, state) => {
        send('done', { state, savePath });
      });
    });
  }

  // ── Permission decisions cache ───────────────────────────────────
  // Format: { "<origin>": { "<permission>": "allow" | "deny" } }
  // Used by setPermissionRequestHandler — if a decision is recorded, we
  // honor it silently. Otherwise we ask the renderer.
  function loadPerms() { return readJson(permsPath, {}); }
  function savePerm(origin, permission, decision) {
    const all = loadPerms();
    all[origin] = all[origin] || {};
    all[origin][permission] = decision;
    writeJson(permsPath, all);
  }

  // In-flight permission asks: id → { resolve }
  const permAsks = new Map();
  let permSeq = 0;
  function askRendererForPermission(origin, permission, details) {
    return new Promise((resolve) => {
      const id = ++permSeq;
      permAsks.set(id, resolve);
      const win = ctx.getWindow && ctx.getWindow();
      if (!win || win.isDestroyed()) { resolve('deny'); return; }
      win.webContents.send('browser:permission-ask', { id, origin, permission, details });
      // Safety timeout — auto-deny if user doesn't respond in 60s
      setTimeout(() => {
        if (permAsks.has(id)) { permAsks.delete(id); resolve('deny'); }
      }, 60000);
    });
  }
  ipcMain.handle('browser:permission-respond', (_e, { id, decision, remember } = {}) => {
    const r = permAsks.get(id);
    if (r) { permAsks.delete(id); r(decision || 'deny'); }
    return { ok: true };
  });
  ipcMain.handle('browser:permission-save', (_e, { origin, permission, decision } = {}) => {
    if (origin && permission && decision) savePerm(origin, permission, decision);
    return { ok: true };
  });

  // In-flight basic-auth asks
  const authAsks = new Map();
  let authSeq = 0;
  function askRendererForAuth(host, realm) {
    return new Promise((resolve) => {
      const id = ++authSeq;
      authAsks.set(id, resolve);
      const win = ctx.getWindow && ctx.getWindow();
      if (!win || win.isDestroyed()) { resolve(null); return; }
      win.webContents.send('browser:auth-ask', { id, host, realm });
      setTimeout(() => { if (authAsks.has(id)) { authAsks.delete(id); resolve(null); } }, 60000);
    });
  }
  ipcMain.handle('browser:auth-respond', (_e, { id, username, password } = {}) => {
    const r = authAsks.get(id);
    if (r) { authAsks.delete(id); r(username ? { username, password: password || '' } : null); }
    return { ok: true };
  });

  // In-flight cert-error asks
  const certAsks = new Map();
  let certSeq = 0;
  const certAllowList = new Set(); // `${origin}` → trusted this session
  function askRendererForCert(origin, error) {
    if (certAllowList.has(origin)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const id = ++certSeq;
      certAsks.set(id, resolve);
      const win = ctx.getWindow && ctx.getWindow();
      if (!win || win.isDestroyed()) { resolve(false); return; }
      win.webContents.send('browser:cert-ask', { id, origin, error });
      setTimeout(() => { if (certAsks.has(id)) { certAsks.delete(id); resolve(false); } }, 60000);
    });
  }
  ipcMain.handle('browser:cert-respond', (_e, { id, allow, remember } = {}) => {
    const r = certAsks.get(id);
    if (r) { certAsks.delete(id); r(!!allow); }
    return { ok: true };
  });

  function wireBrowserSession(sess, partitionName) {
    if (!sess) return;
    wireDownloads(sess);
    // Permission requests (camera, mic, geolocation, notifications, clipboard-read, etc.)
    sess.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
      const url = details?.requestingUrl || webContents?.getURL() || '';
      let origin = '';
      try { origin = new URL(url).origin; } catch {}
      // Always-deny risky ones unless user has explicitly allowed
      const RISKY = ['display-capture', 'midi', 'midi-sysex', 'serial', 'hid', 'usb', 'background-sync'];
      const all = loadPerms();
      const saved = all[origin]?.[permission];
      if (saved === 'allow') return callback(true);
      if (saved === 'deny')  return callback(false);
      if (RISKY.includes(permission) && !saved) return callback(false);
      const decision = await askRendererForPermission(origin, permission, { url });
      callback(decision === 'allow');
    });
    // Basic auth (HTTP 401 with WWW-Authenticate)
    sess.on('login', async (event, _details, authInfo, callback) => {
      event.preventDefault();
      const creds = await askRendererForAuth(authInfo.host || '', authInfo.realm || '');
      if (creds) callback(creds.username, creds.password);
      else callback(); // cancel → request fails
    });
  }

  // Cert errors are at app-level (fire on any webContents).
  // We only handle them for our browser sessions by inspecting the partition.
  app.on('certificate-error', async (event, webContents, url, error, _certificate, callback) => {
    try {
      const partition = webContents?.session?.getStoragePath?.() || '';
      const isBrowserWebview = partition.includes('pipilot-browser');
      if (!isBrowserWebview) return; // let Electron's default deny stand
      event.preventDefault();
      let origin = url;
      try { origin = new URL(url).origin; } catch {}
      const allow = await askRendererForCert(origin, error);
      if (allow) certAllowList.add(origin);
      callback(allow);
    } catch (err) {
      console.warn('[browser] cert-error handler failed:', err);
      callback(false);
    }
  });

  // Wire on app:ready (sessions exist by then)
  app.whenReady().then(() => {
    try { wireBrowserSession(session.fromPartition(BROWSER_PARTITION), BROWSER_PARTITION); } catch (err) { console.warn('[browser] wire session (persist) failed:', err); }
    try { wireBrowserSession(session.fromPartition(INCOGNITO_PARTITION), INCOGNITO_PARTITION); } catch (err) { console.warn('[browser] wire session (incognito) failed:', err); }
  }).catch(() => {});

  // ── Save-as for shift-click downloads ────────────────────────────
  // Renderer triggers a download on a URL with a chosen save path.
  ipcMain.handle('browser:save-as', async (_e, { url, suggestedName } = {}) => {
    try {
      const win = ctx.getWindow && ctx.getWindow();
      if (!win || !url) return { ok: false, error: 'window or url missing' };
      const result = await dialog.showSaveDialog(win, {
        title: 'Save As',
        defaultPath: path.join(downloadsRoot, suggestedName || path.basename(new URL(url).pathname) || 'download'),
      });
      if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
      // Use the persistent browser session to download — preserves cookies/auth.
      const sess = session.fromPartition(BROWSER_PARTITION);
      // Hook a one-shot will-download to set the chosen path
      const onceHandler = (event, item) => {
        try { item.setSavePath(result.filePath); } catch {}
        sess.removeListener('will-download', onceHandler);
      };
      sess.on('will-download', onceHandler);
      sess.downloadURL(url);
      return { ok: true, savePath: result.filePath };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Print page → PDF (offered when page calls window.print) ──────
  ipcMain.handle('browser:print-to-pdf', async (_e, { webContentsId, suggestedName } = {}) => {
    try {
      const { webContents } = require('electron');
      const wc = webContents.fromId(webContentsId);
      if (!wc) throw new Error('webContents not found for id ' + webContentsId);
      const win = ctx.getWindow && ctx.getWindow();
      const result = await dialog.showSaveDialog(win, {
        title: 'Save as PDF',
        defaultPath: path.join(downloadsRoot, (suggestedName || 'page') + '.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
      const buf = await wc.printToPDF({ printBackground: true });
      fs.writeFileSync(result.filePath, buf);
      return { ok: true, savePath: result.filePath };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Expose webview preload path to renderer ──────────────────────
  ipcMain.handle('browser:get-preload-path', () => {
    // Return as file:// URL — that's what <webview preload="..."> accepts
    return { ok: true, url: 'file:///' + WEBVIEW_PRELOAD.replace(/\\/g, '/') };
  });

  // ── History ──────────────────────────────────────────────────────
  // { url, title, ts, faviconUrl } entries, newest last. Capped at 2000.
  const HISTORY_CAP = 2000;
  ipcMain.handle('browser:history:add', (_e, payload) => {
    try {
      const { url, title, faviconUrl } = payload || {};
      if (!url || /^(about:|chrome:|file:|data:)/i.test(url)) return { ok: true };
      const list = readJson(historyPath, []);
      // De-dupe consecutive identical URLs
      if (list.length && list[list.length - 1].url === url) {
        list[list.length - 1].ts = Date.now();
        list[list.length - 1].title = title || list[list.length - 1].title;
        if (faviconUrl) list[list.length - 1].faviconUrl = faviconUrl;
      } else {
        list.push({ url, title: title || url, ts: Date.now(), faviconUrl: faviconUrl || null });
      }
      if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP);
      writeJson(historyPath, list);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('browser:history:list', (_e, { limit, query } = {}) => {
    try {
      const list = readJson(historyPath, []);
      let out = list.slice().reverse(); // newest first
      if (query) {
        const q = String(query).toLowerCase();
        out = out.filter(e => (e.url || '').toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q));
      }
      if (limit && limit > 0) out = out.slice(0, limit);
      return { ok: true, entries: out };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('browser:history:clear', () => {
    try { writeJson(historyPath, []); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Bookmarks ────────────────────────────────────────────────────
  ipcMain.handle('browser:bookmarks:list', () => {
    try { return { ok: true, entries: readJson(bookmarksPath, []) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('browser:bookmarks:add', (_e, { url, title, faviconUrl } = {}) => {
    try {
      if (!url) throw new Error('url required');
      const list = readJson(bookmarksPath, []);
      if (list.some(b => b.url === url)) return { ok: true, alreadyExists: true };
      list.push({ url, title: title || url, faviconUrl: faviconUrl || null, ts: Date.now() });
      writeJson(bookmarksPath, list);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('browser:bookmarks:remove', (_e, { url } = {}) => {
    try {
      const list = readJson(bookmarksPath, []).filter(b => b.url !== url);
      writeJson(bookmarksPath, list);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Open external (system browser) ───────────────────────────────
  ipcMain.handle('browser:open-external', (_e, url) => {
    try { if (url) shell.openExternal(url); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Clear browsing data ──────────────────────────────────────────
  ipcMain.handle('browser:clear-data', async (_e, { incognito } = {}) => {
    try {
      const sess = session.fromPartition(incognito ? INCOGNITO_PARTITION : BROWSER_PARTITION);
      await sess.clearStorageData();
      await sess.clearCache();
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Reveal a downloaded file in the system file explorer ─────────
  ipcMain.handle('browser:reveal-file', (_e, p) => {
    try { if (p) shell.showItemInFolder(p); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });

  // ── Per-tab extra request headers ────────────────────────────────
  // Agents can prime auth or X-Test-* headers on the next browser tab
  // request. We keep a map of webContentsId → { Header: value } and
  // install a single onBeforeSendHeaders on each browser session that
  // looks up the originating webContents at request time.
  const extraHeadersByWcId = new Map(); // webContentsId → headers object
  const wiredHeaderSessions = new WeakSet();
  function wireExtraHeaders(sess) {
    if (!sess || wiredHeaderSessions.has(sess)) return;
    wiredHeaderSessions.add(sess);
    sess.webRequest.onBeforeSendHeaders((details, callback) => {
      const wcId = details.webContents?.id || details.webContentsId;
      const extras = wcId != null ? extraHeadersByWcId.get(wcId) : null;
      if (extras && Object.keys(extras).length) {
        callback({ requestHeaders: { ...details.requestHeaders, ...extras } });
      } else {
        callback({ requestHeaders: details.requestHeaders });
      }
    });
  }
  ipcMain.handle('browser:set-extra-headers', (_e, { webContentsId, headers } = {}) => {
    try {
      const { webContents } = require('electron');
      const wc = webContents.fromId(Number(webContentsId));
      if (!wc) return { ok: false, error: 'no such webContents' };
      // Wire the session lazily — this also covers incognito tabs.
      wireExtraHeaders(wc.session);
      if (!headers || typeof headers !== 'object') {
        extraHeadersByWcId.delete(wc.id);
        return { ok: true, cleared: true };
      }
      // Coerce all values to strings (Electron rejects non-strings).
      const clean = {};
      for (const [k, v] of Object.entries(headers)) {
        if (k && v != null) clean[String(k)] = String(v);
      }
      extraHeadersByWcId.set(wc.id, clean);
      return { ok: true, count: Object.keys(clean).length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  return {
    BROWSER_PARTITION,
    INCOGNITO_PARTITION,
    downloadsRoot,
  };
};
