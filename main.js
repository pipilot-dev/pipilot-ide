// PiPilot IDE — Electron main process entry
// Loads .env, creates BrowserWindow, wires all IPC handlers.

require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

// IPC handler modules (one per feature domain — each owns its own channels)
const registerFileHandlers = require('./main/ipc-files');
const registerTerminalHandlers = require('./main/ipc-terminal');
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
  try { require('./main/diary')(ipcMain); } catch (err) { console.error('[diary] register failed:', err); }
  let secretsApi = null;
  try { secretsApi = require('./main/secrets')(ipcMain, ctx); } catch (err) { console.error('[secrets] register failed:', err); }
  try { require('./main/missions')(ipcMain, ctx, { getSecret: secretsApi?.getSecret }); } catch (err) { console.error('[missions] register failed:', err); }

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
