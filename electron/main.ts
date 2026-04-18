import { app, BrowserWindow } from "electron";
import { ChildProcess, spawn } from "child_process";
import path from "path";

// __dirname is provided by electron-vite's CJS shim — don't redeclare
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

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
  NODE_ENV: isDev ? "development" : "production",
};

// ── Spawn Express servers ──
function startServers() {
  const serverDir = isDev
    ? path.join(__dirname, "..", "..")  // project root in dev
    : path.join(process.resourcesPath!, "app");  // packaged app

  const tsxBin = isDev
    ? path.join(serverDir, "node_modules", ".bin", "tsx")
    : path.join(serverDir, "node_modules", ".bin", "tsx");

  const agentScript = path.join(serverDir, "server", "index.ts");
  const cloudScript = path.join(serverDir, "server", "cloud.ts");

  console.log("[electron] Starting agent server:", agentScript);
  agentServer = spawn(tsxBin, [agentScript], {
    cwd: serverDir,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  agentServer.stdout?.on("data", (data: Buffer) => {
    console.log("[agent]", data.toString().trim());
  });
  agentServer.stderr?.on("data", (data: Buffer) => {
    console.warn("[agent]", data.toString().trim());
  });
  agentServer.on("exit", (code) => {
    console.log(`[agent] exited with code ${code}`);
  });

  console.log("[electron] Starting cloud server:", cloudScript);
  cloudServer = spawn(tsxBin, [cloudScript, "--standalone"], {
    cwd: serverDir,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  cloudServer.stdout?.on("data", (data: Buffer) => {
    console.log("[cloud]", data.toString().trim());
  });
  cloudServer.stderr?.on("data", (data: Buffer) => {
    console.warn("[cloud]", data.toString().trim());
  });
  cloudServer.on("exit", (code) => {
    console.log(`[cloud] exited with code ${code}`);
  });
}

// ── Wait for server to be ready ──
async function waitForServer(port: number, maxWait = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── Kill server processes ──
function killServers() {
  if (agentServer && !agentServer.killed) {
    agentServer.kill();
    agentServer = null;
  }
  if (cloudServer && !cloudServer.killed) {
    cloudServer.kill();
    cloudServer = null;
  }
}

// ── Create main window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "PiPilot IDE",
    icon: path.join(__dirname, "..", "..", "public", "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // allow file:// to fetch localhost
    },
  });

  if (isDev) {
    // Dev mode: load from Vite dev server
    mainWindow.loadURL("http://localhost:51730");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load built frontend
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App lifecycle ──
app.whenReady().then(async () => {
  // Start servers (in both dev and prod — in dev they may already be running)
  if (!isDev) {
    startServers();
    console.log("[electron] Waiting for agent server...");
    const ready = await waitForServer(51731);
    if (ready) {
      console.log("[electron] Agent server ready!");
    } else {
      console.warn("[electron] Agent server did not respond in time, opening window anyway");
    }
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  killServers();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killServers();
});
