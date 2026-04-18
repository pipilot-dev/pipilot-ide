import { app, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite dev server URL (set by vite-plugin-electron in dev mode)
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let agentServer: ChildProcess | null = null;
let cloudServer: ChildProcess | null = null;

// ── Server env vars (baked-in for zero-config) ──
const serverEnv = {
  ...process.env,
  ANTHROPIC_BASE_URL: "https://the3rdacademy.com/api",
  ANTHROPIC_AUTH_TOKEN: "sk-praxis-6685c84fda3dc26efa6b20e79e7fb704d5eb7002b59a106c5ba8b7777948dcca",
  ANTHROPIC_API_KEY: "sk-ant-api03-placeholder-key-for-sdk-validation-only",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-4-6",
  CLAUDE_CODE_REMOTE: "true",
};

// ── Spawn Express servers ──
function startServers() {
  // In packaged app: app.getAppPath() = resources/app.asar or resources/app
  // In dev: app.getAppPath() = project root
  const appRoot = app.getAppPath();

  // tsx entry point (the actual JS, not the shell wrapper)
  const tsxCli = path.join(appRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const agentScript = path.join(appRoot, "server", "index.ts");
  const cloudScript = path.join(appRoot, "server", "cloud.ts");

  // Find a Node.js binary that works:
  // In dev: just use system 'node'
  // In packaged: use process.execPath with ELECTRON_RUN_AS_NODE
  const useElectronAsNode = app.isPackaged;
  const nodeBin = useElectronAsNode ? process.execPath : "node";
  const extraEnv = useElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {};

  console.log("[electron] App root:", appRoot);
  console.log("[electron] Node binary:", nodeBin);
  console.log("[electron] tsx CLI:", tsxCli);

  agentServer = spawn(nodeBin, [tsxCli, agentScript], {
    cwd: appRoot,
    env: { ...serverEnv, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });

  agentServer.stdout?.on("data", (d: Buffer) => console.log("[agent]", d.toString().trim()));
  agentServer.stderr?.on("data", (d: Buffer) => console.warn("[agent]", d.toString().trim()));
  agentServer.on("error", (err) => console.error("[agent] spawn error:", err.message));
  agentServer.on("exit", (code) => console.log(`[agent] exited with code ${code}`));

  cloudServer = spawn(nodeBin, [tsxCli, cloudScript, "--standalone"], {
    cwd: appRoot,
    env: { ...serverEnv, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });

  cloudServer.stdout?.on("data", (d: Buffer) => console.log("[cloud]", d.toString().trim()));
  cloudServer.stderr?.on("data", (d: Buffer) => console.warn("[cloud]", d.toString().trim()));
  cloudServer.on("error", (err) => console.error("[cloud] spawn error:", err.message));
  cloudServer.on("exit", (code) => console.log(`[cloud] exited with code ${code}`));
}

// ── Wait for server health check ──
async function waitForServer(port: number, maxWait = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── Kill servers ──
function killServers() {
  if (agentServer && !agentServer.killed) { agentServer.kill(); agentServer = null; }
  if (cloudServer && !cloudServer.killed) { cloudServer.kill(); cloudServer = null; }
}

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
      preload: path.join(__dirname, "preload.mjs"),
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
  if (!VITE_DEV_SERVER_URL) {
    // Production: start servers and wait
    startServers();
    console.log("[electron] Waiting for agent server...");
    const ready = await waitForServer(51731);
    console.log(ready ? "[electron] Server ready!" : "[electron] Server timeout, opening anyway");
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  killServers();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", killServers);
