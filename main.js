// PiPilot IDE — Electron main process entry
// Loads .env, creates BrowserWindow, wires all IPC handlers.

// Load runtime env. Explicit path so production builds (where cwd is
// the install dir, NOT the asar root containing .env) find the file.
// `path.join(__dirname, '.env')` resolves correctly in both dev and
// asar-packaged production.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Squirrel.Windows install/update event handler. MUST run before anything
// else that reads process.argv or opens a window.
//
// During install / update / uninstall, Squirrel re-launches the app's
// pipilot-ide.exe with flags like --squirrel-install / --squirrel-firstrun
// / --squirrel-uninstall. Without this guard, every one of those launches
// would build a BrowserWindow and try to open the same IndexedDB,
// producing the classic "UnknownError: Internal error" that breaks
// chat session creation on first run after install.
//
// We use our OWN handler instead of electron-squirrel-startup so we can
// create shortcuts in BOTH StartMenu AND Desktop (the upstream package
// only ever creates StartMenu shortcuts — that's why users couldn't find
// the app icon on their desktop after install).
if (require('./main/squirrel-events').handleSquirrelEvent()) {
  // handleSquirrelEvent already scheduled process.exit; just return so
  // we don't accidentally start setting up the rest of the main process.
  return;
}

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Force the preview iframe (localhost dev server) to live in the SAME
// process as the renderer. Without this Chromium puts cross-origin
// iframes in their own process (Site Isolation / OOPIFs), which makes
// `iframe.contentDocument` unreadable from the parent regardless of
// the BrowserWindow's webSecurity flag — breaking the tag-to-select
// bridge + console-injection.
//
// MUST be called before app.whenReady(). Safe for an IDE: the only
// frames we ever embed are the user's own dev server (preview) and
// our own help/settings pages. External browsing happens in <webview>
// tags which have their own isolated security context.
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process');
app.commandLine.appendSwitch('disable-site-isolation-trials');

// Single-instance lock — even after Squirrel handling, two normal launches
// of the app would race for the same IndexedDB / userData files. The
// second-instance handler focuses the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length) {
    const w = wins[0];
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.focus();
  }
});

// Force a no-space userData path. Electron's default uses app.getName()
// which in our packaged build is "PiPilot IDE" (with space) → produces
// a path like %AppData%\PiPilot IDE\. Spaces in storage paths trigger
// "UnknownError: Internal error." from Chromium's IndexedDB / LevelDB
// on Windows in some configurations. Pin to a deterministic, no-space
// directory matching our install folder name.
//
// Best-effort migration: if the legacy "PiPilot IDE" userData exists
// from a prior install, copy its contents to the new location once so
// users don't lose their auth token, settings, sessions, etc.
const desiredUserData = path.join(app.getPath('appData'), 'PiPilot');
const legacyUserData  = path.join(app.getPath('appData'), 'PiPilot IDE');
try {
  if (!fs.existsSync(desiredUserData) && fs.existsSync(legacyUserData)) {
    fs.cpSync(legacyUserData, desiredUserData, { recursive: true, errorOnExist: false });
    console.log('[startup] migrated userData from "PiPilot IDE" → "PiPilot"');
  }
} catch (err) {
  console.warn('[startup] userData migration skipped:', err.message);
}
try { fs.mkdirSync(desiredUserData, { recursive: true }); } catch {}
app.setPath('userData', desiredUserData);

// IPC handler modules (one per feature domain — each owns its own channels)
const registerFileHandlers = require('./main/ipc-files');
const registerTerminalHandlers = require('./main/ipc-terminal');
const registerAuthHandlers = require('./main/ipc-auth');
const registerAgentHandlers = require('./main/ipc-agent');
const registerGitHandlers = require('./main/ipc-git');
const registerCloudHandlers = require('./main/ipc-cloud');
const registerCheckpointHandlers = require('./main/ipc-checkpoints');
const registerDevServerHandlers = require('./main/ipc-devserver');
const registerSettingsHandlers = require('./main/ipc-settings');
const registerCodestralHandlers = require('./main/ipc-codestral');
const registerDiagnosticsHandlers = require('./main/ipc-diagnostics');
const registerWikiHandlers = require('./main/ipc-wiki');
const registerSpeechHandlers = require('./main/ipc-speech');
const registerSearchIndexHandlers = require('./main/ipc-search-index');
const registerExtensionHandlers = require('./main/ipc-extensions');
const registerExtDBHandlers = require('./main/ipc-ext-db');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#16161a',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    frame: false,
    icon: path.join(__dirname, 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      // Required so the preview iframe (localhost:5173) is reachable
      // cross-origin from this file:// renderer — we need to read its
      // contentDocument to inject the tag-to-select bridge script.
      // Acceptable risk: the only frames we ever load are
      //   1. our own index.html (trusted)
      //   2. the user's own dev server in the preview iframe (trusted)
      //   3. external sites in <webview> tabs which have their own
      //      isolated security context regardless of this flag.
      webSecurity: false,
    },
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Browser webview popups → route to a new in-IDE browser tab.
  // Without this, target=_blank, window.open(...), and JS-driven popups
  // either get rendered as a floating Chromium modal window inside the
  // webview area (unusable) or are silently denied. We catch them in main
  // via setWindowOpenHandler attached at webview-attach time and bounce
  // the URL back to the renderer to open a fresh browser-tab.
  mainWindow.webContents.on('did-attach-webview', (_event, wc) => {
    try {
      wc.setWindowOpenHandler(({ url, disposition }) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('browser:popup-request', { url, disposition });
          }
        } catch (err) { console.warn('[browser] popup forward failed:', err); }
        // Always deny — we open it as a new browser tab in the renderer.
        // The disposition info lets the renderer decide foreground vs
        // background (currently we always foreground).
        return { action: 'deny' };
      });
      // Also catch will-navigate redirects that hop to a new origin —
      // some sites use a 302 chain through a third-party tracker before
      // the final destination. Those stay in the same webview by design,
      // we don't need to open a new tab for them.
    } catch (err) {
      console.warn('[browser] setWindowOpenHandler attach failed:', err);
    }
  });
}

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open-folder') },
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-file') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:save-all') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => mainWindow?.webContents.send('menu:toggle-sidebar') },
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+`', click: () => mainWindow?.webContents.send('menu:toggle-terminal') },
        { label: 'Toggle Chat', accelerator: 'CmdOrCtrl+I', click: () => mainWindow?.webContents.send('menu:toggle-chat') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Shared IPC — folder picker, app lifecycle
ipcMain.handle('app:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('app:pick-file', async (_e, opts = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', opts.multi ? 'multiSelections' : null].filter(Boolean),
    filters: opts.filters || [],
  });
  if (result.canceled) return null;
  return opts.multi ? result.filePaths : result.filePaths[0];
});

ipcMain.handle('app:get-platform', () => process.platform);
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:get-home', () => require('os').homedir());

ipcMain.handle('app:pick-save-path', async (_e, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts?.defaultPath || 'export.zip',
    filters: opts?.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePath;
});

// Window controls (frameless window)
ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => { mainWindow?.close(); });
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() || false);
// Bounce the OS taskbar/dock to grab attention when the agent needs the
// user (e.g. AskUserQuestion). No-op when the window is already focused.
ipcMain.handle('window:flash-frame', (_e, on) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (on && mainWindow.isFocused()) return false;
    mainWindow.flashFrame(!!on);
    return true;
  } catch { return false; }
});

ipcMain.handle('app:recent-projects:get', () => {
  const file = path.join(app.getPath('userData'), 'recent-projects.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
});

ipcMain.handle('app:recent-projects:add', (_e, project) => {
  const file = path.join(app.getPath('userData'), 'recent-projects.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  list = list.filter(p => p.path !== project.path);
  list.unshift({ ...project, openedAt: Date.now() });
  list = list.slice(0, 20);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
  return list;
});

ipcMain.handle('app:recent-projects:remove', (_e, projectPath) => {
  const file = path.join(app.getPath('userData'), 'recent-projects.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  list = list.filter(p => p.path !== projectPath);
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
  return list;
});

// Helper: stream wrapper used by feature modules to push chunks to renderer
function makeStreamHelper(channel) {
  return (event, streamId, payload) => {
    event.sender.send(`${channel}:${streamId}`, payload);
  };
}

app.whenReady().then(() => {
  setupMenu();


  const ctx = {
    getWindow: () => mainWindow,
    userDataPath: app.getPath('userData'),
    appPath: app.getAppPath(),
    stream: makeStreamHelper,
  };

  registerFileHandlers(ipcMain, ctx);
  registerTerminalHandlers(ipcMain, ctx);
  // Auth must register before the agent so the JWT cache is warm before
  // the first chat turn lands.
  registerAuthHandlers(ipcMain, ctx);
  registerAgentHandlers(ipcMain, ctx);
  registerGitHandlers(ipcMain, ctx);
  registerCloudHandlers(ipcMain, ctx);
  registerCheckpointHandlers(ipcMain, ctx);
  registerDevServerHandlers(ipcMain, ctx);
  registerSettingsHandlers(ipcMain, ctx);
  registerCodestralHandlers(ipcMain, ctx);
  registerDiagnosticsHandlers(ipcMain, ctx);
  registerWikiHandlers(ipcMain, ctx);
  registerSpeechHandlers(ipcMain, ctx);
  registerSearchIndexHandlers(ipcMain, ctx);
  registerExtensionHandlers(ipcMain, ctx);
  registerExtDBHandlers(ipcMain, ctx);
  try { require('./main/ipc-browser')(ipcMain, ctx); } catch (err) { console.error('[browser] register failed:', err); }
  try { require('./main/ipc-debug')(ipcMain, { ...ctx, app }); } catch (err) { console.error('[debug] register failed:', err); }
  let browserCtrl = null;
  try { browserCtrl = require('./main/browser-control')(ipcMain, ctx); } catch (err) { console.error('[browser-control] register failed:', err); }
  // Stash on ctx so ide-tools-mcp can pick it up
  ctx.browserExec = browserCtrl?.browserExec || (() => Promise.reject(new Error('browser control unavailable')));
  try { require('./main/diary')(ipcMain); } catch (err) { console.error('[diary] register failed:', err); }
  let secretsApi = null;
  try { secretsApi = require('./main/secrets')(ipcMain, ctx); } catch (err) { console.error('[secrets] register failed:', err); }
  let githubApi = null;
  try { githubApi = require('./main/github')(ipcMain, ctx, { getSecret: secretsApi?.getSecret }); } catch (err) { console.error('[github] register failed:', err); }
  let ghCliApi = null;
  try { ghCliApi = require('./main/gh-cli')(ipcMain, ctx, { getSecret: secretsApi?.getSecret }); } catch (err) { console.error('[gh-cli] register failed:', err); }
  let gitlabApi = null;
  try { gitlabApi = require('./main/gitlab')(ipcMain, ctx, { getSecret: secretsApi?.getSecret }); } catch (err) { console.error('[gitlab] register failed:', err); }
  try {
    require('./main/ipc-publish')(ipcMain, ctx, {
      getSecret: secretsApi?.getSecret,
      createGithubRepo: githubApi?.createRepo,
      createGitlabProject: gitlabApi?.createProject,
    });
  } catch (err) { console.error('[publish] register failed:', err); }
  try { require('./main/ipc-deploy')(ipcMain, ctx); } catch (err) { console.error('[deploy] register failed:', err); }
  try { require('./main/vercel-api')(ipcMain, ctx); } catch (err) { console.error('[vercel-api] register failed:', err); }
  try { require('./main/netlify-api')(ipcMain, ctx); } catch (err) { console.error('[netlify-api] register failed:', err); }
  try { require('./main/cloudflare-api')(ipcMain, ctx); } catch (err) { console.error('[cloudflare-api] register failed:', err); }
  try { require('./main/render-api')(ipcMain, ctx); } catch (err) { console.error('[render-api] register failed:', err); }
  try { require('./main/railway-api')(ipcMain, ctx); } catch (err) { console.error('[railway-api] register failed:', err); }
  try { require('./main/missions')(ipcMain, ctx, { getSecret: secretsApi?.getSecret, githubInvalidate: githubApi?.invalidate, ghEnsure: ghCliApi?.ensureForMission }); } catch (err) { console.error('[missions] register failed:', err); }

  createWindow();

  // Tray + power-save + sleep monitor. Must run after createWindow so the
  // close-interceptor can be attached to the freshly created window.
  try {
    require('./main/background-mode').init({
      ipcMain,
      getWindow: () => mainWindow,
      userDataPath: ctx.userDataPath,
    });
  } catch (err) {
    console.error('[background-mode] init failed:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('window-all-closed', () => {
  // With background mode the tray keeps the app alive even when no window
  // exists. The user explicitly quits via the tray menu.
  if (process.platform !== 'darwin') {
    // Don't auto-quit — tray handles it.
  }
});
