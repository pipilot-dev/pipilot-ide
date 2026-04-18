import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";

// __dirname is available natively in CJS output
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

// ── Baked-in env vars for zero-config ──
process.env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://the3rdacademy.com/api";
process.env.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || "sk-praxis-6685c84fda3dc26efa6b20e79e7fb704d5eb7002b59a106c5ba8b7777948dcca";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-api03-placeholder-key-for-sdk-validation-only";
process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-sonnet-4-6";
process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || "claude-sonnet-4-6";
process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "claude-sonnet-4-6";
process.env.CLAUDE_CODE_REMOTE = "true";

// ── IPC API Router ──
// Import and register all IPC handlers (replaces Express server entirely)
import { registerAllHandlers } from "./ipc-api";

// ── Create window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "PiPilot IDE",
    icon: path.join(app.getAppPath(), "public", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── App lifecycle ──
app.whenReady().then(async () => {
  // Register all IPC handlers before creating the window
  registerAllHandlers(ipcMain, () => mainWindow);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
