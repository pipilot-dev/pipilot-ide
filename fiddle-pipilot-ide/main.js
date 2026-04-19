const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// ── Baked-in env vars for zero-config ──
process.env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://the3rdacademy.com/api';
process.env.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || 'sk-praxis-6685c84fda3dc26efa6b20e79e7fb704d5eb7002b59a106c5ba8b7777948dcca';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-api03-placeholder-key-for-sdk-validation-only';
process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6';
process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'claude-sonnet-4-6';
process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'claude-sonnet-4-6';
process.env.CLAUDE_CODE_REMOTE = 'true';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'PiPilot IDE',
    icon: path.join(__dirname, 'dist', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  // Load the built frontend
  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Register IPC handlers ──
// Uses the compiled handlers from scripts/build-electron.mjs
function registerHandlers() {
  try {
    const { registerAllHandlers } = require('./dist-electron/ipc-handlers.cjs');
    registerAllHandlers(ipcMain, () => mainWindow);
    console.log('[main] IPC handlers registered');
  } catch (err) {
    console.error('[main] Failed to register IPC handlers:', err.message);
    console.error('[main] Run: node scripts/build-ipc-handlers.mjs');
  }
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
