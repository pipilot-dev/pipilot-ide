/**
 * Dev Server Manager — spawns and manages dev servers for project preview.
 */

import { spawn, execSync, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

// Check if pnpm is available, install if not
let packageManager = "npm";
try {
  execSync("pnpm --version", { stdio: "pipe" });
  packageManager = "pnpm";
  console.log("[dev-server] Using pnpm");
} catch {
  try {
    console.log("[dev-server] pnpm not found, installing globally...");
    execSync("npm install -g pnpm", { stdio: "pipe" });
    packageManager = "pnpm";
    console.log("[dev-server] pnpm installed successfully");
  } catch {
    console.log("[dev-server] Could not install pnpm, falling back to npm");
  }
}

interface RunningApp {
  process: ChildProcess | null;
  port: number | null;
  url: string | null;
  projectId: string;
  workDir: string;
  logs: string[];
  status: "installing" | "starting" | "running" | "stopped" | "error";
  startedAt: number;
}

const runningApps = new Map<string, RunningApp>();

const URL_PATTERNS = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
  /Local:\s+https?:\/\/[^:]+:(\d+)/i,
  /listening\s+(?:on\s+)?(?:port\s+)?(\d{4,5})/i,
  /started\s+(?:on\s+)?(?:port\s+)?(\d{4,5})/i,
  /port\s+(\d{4,5})/i,
];

function extractPort(text: string): number | null {
  for (const pattern of URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const port = parseInt(match[1]);
      if (port > 0 && port < 65536) return port;
    }
  }
  return null;
}

function detectDevCommand(workDir: string): { command: string; args: string[] } | null {
  const pkgPath = path.join(workDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    if (scripts.dev) return { command: packageManager, args: ["run", "dev"] };
    if (scripts.start) return { command: packageManager, args: ["run", "start"] };
    if (scripts.serve) return { command: packageManager, args: ["run", "serve"] };
  } catch {}

  if (fs.existsSync(path.join(workDir, "server.js"))) return { command: "node", args: ["server.js"] };
  if (fs.existsSync(path.join(workDir, "index.js"))) return { command: "node", args: ["index.js"] };

  return null;
}

export async function startDevServer(
  projectId: string,
  workDir: string,
  onStatusChange?: (status: RunningApp["status"], port?: number, url?: string) => void
): Promise<RunningApp | null> {
  stopDevServer(projectId);

  const cmd = detectDevCommand(workDir);
  if (!cmd) {
    console.log(`[dev-server] No dev command found for ${projectId}`);
    return null;
  }

  const app: RunningApp = {
    process: null,
    port: null,
    url: null,
    projectId,
    workDir,
    logs: [],
    status: "installing",
    startedAt: Date.now(),
  };
  runningApps.set(projectId, app);

  console.log(`[dev-server] Starting ${cmd.command} ${cmd.args.join(" ")} in ${workDir}`);

  // Install dependencies if needed
  const nodeModulesPath = path.join(workDir, "node_modules");
  if (!fs.existsSync(nodeModulesPath) && fs.existsSync(path.join(workDir, "package.json"))) {
    console.log(`[dev-server] Installing dependencies for ${projectId}...`);
    onStatusChange?.("installing");

    await new Promise<void>((resolve) => {
      const install = spawn(packageManager, ["install"], { cwd: workDir, shell: true, stdio: "pipe" });
      install.stdout?.on("data", (d) => {
        const t = d.toString();
        app.logs.push(t);
        console.log(`[dev-server] [install] ${t.trim()}`);
      });
      install.stderr?.on("data", (d) => {
        const t = d.toString();
        app.logs.push(t);
      });
      install.on("exit", (code) => {
        if (code !== 0) {
          app.status = "error";
          app.logs.push(`npm install failed with code ${code}`);
          console.log(`[dev-server] npm install failed for ${projectId}`);
          onStatusChange?.("error");
        } else {
          console.log(`[dev-server] Dependencies installed for ${projectId}`);
        }
        resolve();
      });
      install.on("error", () => resolve());
    });

    if (app.status === "error") return app;
  }

  // Start the dev server with a random available port
  app.status = "starting";
  onStatusChange?.("starting");

  const suggestedPort = 30000 + Math.floor(Math.random() * 20000);

  // Override the port in the command args to avoid conflicts
  // Read package.json to get the actual script and modify it
  let finalCommand = cmd.command;
  let finalArgs = [...cmd.args];

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workDir, "package.json"), "utf8"));
    const scriptName = cmd.args[cmd.args.length - 1]; // "dev", "start", "serve"
    const script = pkg.scripts?.[scriptName] || "";

    if (script.includes("next dev") || script.includes("next ")) {
      // Next.js: run directly with our port
      finalCommand = "npx";
      finalArgs = ["next", "dev", "-H", "0.0.0.0", "-p", String(suggestedPort)];
    } else if (script.includes("vite")) {
      // Vite: run directly with our port
      finalCommand = "npx";
      finalArgs = ["vite", "--host", "0.0.0.0", "--port", String(suggestedPort)];
    }
    // For other commands, PORT env var will be used
  } catch {}

  console.log(`[dev-server] Running: ${finalCommand} ${finalArgs.join(" ")} (port ${suggestedPort})`);

  const child = spawn(finalCommand, finalArgs, {
    cwd: workDir,
    shell: true,
    env: {
      ...process.env,
      PORT: String(suggestedPort),
      HOST: "0.0.0.0",
      NODE_ENV: "development",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  app.process = child;

  const handleOutput = (data: Buffer) => {
    const text = data.toString();
    app.logs.push(text);
    if (app.logs.length > 500) app.logs.shift();

    console.log(`[dev-server] [${projectId}] ${text.trim().slice(0, 120)}`);

    if (!app.port) {
      const port = extractPort(text);
      if (port) {
        app.port = port;
        app.url = `http://localhost:${port}`;
        app.status = "running";
        console.log(`[dev-server] ✓ ${projectId} running on port ${port}`);
        onStatusChange?.("running", port, app.url);
      }
    }
  };

  child.stdout?.on("data", handleOutput);
  child.stderr?.on("data", handleOutput);

  child.on("exit", (code) => {
    app.status = "stopped";
    console.log(`[dev-server] ${projectId} exited with code ${code}`);
    onStatusChange?.("stopped");
    runningApps.delete(projectId);
  });

  child.on("error", (err) => {
    app.status = "error";
    app.logs.push(`Error: ${err.message}`);
    onStatusChange?.("error");
  });

  return app;
}

export function stopDevServer(projectId: string): boolean {
  const app = runningApps.get(projectId);
  if (!app || !app.process) return false;

  try {
    // On Windows, need to kill the entire process tree
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(app.process.pid), "/f", "/t"], { shell: true });
    } else {
      app.process.kill("SIGTERM");
      setTimeout(() => { try { app.process?.kill("SIGKILL"); } catch {} }, 5000);
    }
  } catch {}

  app.status = "stopped";
  runningApps.delete(projectId);
  console.log(`[dev-server] Stopped ${projectId}`);
  return true;
}

export function getDevServerStatus(projectId: string) {
  const app = runningApps.get(projectId);
  if (!app) return { running: false, port: null, url: null, status: "stopped", logs: [] as string[] };

  return {
    running: app.status === "running",
    port: app.port,
    url: app.url,
    status: app.status,
    logs: app.logs.slice(-50),
  };
}

export function getAllRunningApps() { return runningApps; }

export function stopAllDevServers() {
  for (const [pid] of runningApps) stopDevServer(pid);
}
