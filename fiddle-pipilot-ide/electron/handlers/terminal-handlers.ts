/**
 * Terminal IPC Handlers — replaces Express /api/terminal/ endpoints.
 *
 * PTY processes run directly in the Electron main process.
 * Instead of SSE, PTY output is pushed to the renderer via
 * webContents.send('terminal:data', { sessionId, output }).
 */

import * as pty from "node-pty";
import path from "path";
import fs from "fs";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, initWorkspaces } from "../../server/workspaces";
import { WORKSPACE_BASE } from "../../server/config";

// Ensure the workspace registry is initialised (idempotent — safe to call
// multiple times; subsequent calls re-load the linked-workspace registry).
initWorkspaces({ workspaceBase: WORKSPACE_BASE });

// ── Session storage ──
const activePtys = new Map<string, pty.IPty>();
// Reverse lookup: which project each pty session belongs to.
// Used by workspace-delete to kill PTYs holding a folder open.
const ptyProjectIds = new Map<string, string>();
// Per-session scrollback buffer (raw bytes, capped to ~512 KB per session)
const ptyBuffers = new Map<string, string>();
const PTY_BUFFER_MAX = 512 * 1024;

// ── Shell profile types ──
interface ShellProfile {
  id: string;        // stable id (e.g. "powershell", "bash", "cmd")
  label: string;     // user-visible name
  command: string;   // executable path (ALWAYS absolute after resolveCommand)
  args?: string[];   // default args
  available: boolean;
}

/**
 * Resolve an executable name to an absolute path. node-pty on Windows
 * requires absolute paths — it does NOT walk PATH itself.
 */
function resolveCommand(command: string): string | null {
  // Already absolute and exists? Use it directly.
  if (command.includes("/") || command.includes("\\")) {
    try {
      if (fs.existsSync(command)) return command;
    } catch {}
    return null;
  }

  // Walk PATH. On Windows also try each PATHEXT suffix.
  const isWin = process.platform === "win32";
  const pathSep = isWin ? ";" : ":";
  const pathDirs = (process.env.PATH || "").split(pathSep).filter(Boolean);
  const pathExts = isWin
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").map((e) => e.toLowerCase())
    : [""];

  // If the command already has an extension, skip PATHEXT expansion
  const hasExt = /\.[a-z0-9]+$/i.test(command);

  for (const dir of pathDirs) {
    for (const ext of hasExt ? [""] : pathExts) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }
  }
  return null;
}

/** Cached profile list (rebuilt on first call per process lifetime). */
let cachedProfiles: ShellProfile[] | null = null;

/** All profiles known on this host, with `available` and resolved paths. */
function listShellProfiles(): ShellProfile[] {
  if (cachedProfiles) return cachedProfiles;

  const plat = process.platform;
  interface Candidate {
    id: string;
    label: string;
    commands: string[]; // ordered list — first resolved wins
    args?: string[];
  }
  const candidates: Candidate[] = [];

  if (plat === "win32") {
    const sysRoot = process.env.SystemRoot || "C:\\Windows";
    const system32 = path.join(sysRoot, "System32");
    candidates.push({
      id: "pwsh",
      label: "PowerShell 7",
      commands: [
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "pwsh.exe",
      ],
      args: ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass"],
    });
    candidates.push({
      id: "powershell",
      label: "Windows PowerShell",
      commands: [
        path.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"),
        "powershell.exe",
      ],
      args: ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass"],
    });
    candidates.push({
      id: "cmd",
      label: "Command Prompt",
      commands: [
        path.join(system32, "cmd.exe"),
        "cmd.exe",
      ],
    });
    candidates.push({
      id: "git-bash",
      label: "Git Bash",
      commands: [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        "bash.exe",
      ],
      args: ["--login", "-i"],
    });
  } else if (plat === "darwin") {
    candidates.push({ id: "bash", label: "Bash", commands: ["/bin/bash", "bash"], args: ["-l"] });
    candidates.push({ id: "zsh", label: "Zsh", commands: ["/bin/zsh", "zsh"], args: ["-l"] });
    candidates.push({ id: "sh", label: "Sh", commands: ["/bin/sh", "sh"] });
    candidates.push({
      id: "fish",
      label: "Fish",
      commands: ["/opt/homebrew/bin/fish", "/usr/local/bin/fish", "fish"],
      args: ["-l"],
    });
  } else {
    // Linux & other Unix
    candidates.push({ id: "bash", label: "Bash", commands: ["/bin/bash", "/usr/bin/bash", "bash"], args: ["-l"] });
    candidates.push({ id: "zsh", label: "Zsh", commands: ["/usr/bin/zsh", "/bin/zsh", "zsh"], args: ["-l"] });
    candidates.push({ id: "sh", label: "Sh", commands: ["/bin/sh", "sh"] });
    candidates.push({ id: "fish", label: "Fish", commands: ["/usr/bin/fish", "/usr/local/bin/fish", "fish"], args: ["-l"] });
  }

  cachedProfiles = candidates.map((c) => {
    let resolved: string | null = null;
    for (const cmd of c.commands) {
      resolved = resolveCommand(cmd);
      if (resolved) break;
    }
    return {
      id: c.id,
      label: c.label,
      command: resolved || c.commands[0], // keep a display fallback even if unresolved
      args: c.args,
      available: resolved !== null,
    };
  });
  return cachedProfiles;
}

/** Look up a profile by id. Returns null if the id is unknown. */
function getShellProfile(profileId: string | undefined): ShellProfile | null {
  if (!profileId) return null;
  return listShellProfiles().find((p) => p.id === profileId) || null;
}

/** Default profile when the client doesn't specify one. */
function getDefaultShellProfile(): ShellProfile {
  const profiles = listShellProfiles();
  const plat = process.platform;

  if (plat === "win32") {
    // cmd.exe is ALWAYS present on Windows — bulletproof fallback.
    const cmd = profiles.find((p) => p.id === "cmd" && p.available);
    if (cmd) return cmd;
  } else {
    // macOS / Linux — default to bash (universally available).
    const bash = profiles.find((p) => p.id === "bash" && p.available);
    if (bash) return bash;
  }

  // Fallback: first available profile, or first entry if none resolve.
  return profiles.find((p) => p.available) || profiles[0];
}

function createPtyForProject(projectId: string, profileId?: string): pty.IPty {
  const workDir = resolveWorkspaceDir(projectId);
  const cwd = fs.existsSync(workDir) ? workDir : WORKSPACE_BASE;

  // Pick the profile: explicit > env SHELL > OS default
  let profile = getShellProfile(profileId);

  // If caller asked for a specific profile but it's not available on
  // this host, fall back to the default rather than crashing.
  if (profile && !profile.available) {
    console.warn(`[terminal] requested profile "${profile.id}" unavailable, falling back to default`);
    profile = null;
  }

  if (!profile && process.platform !== "win32" && process.env.SHELL) {
    const envShell = process.env.SHELL;
    if (fs.existsSync(envShell)) {
      profile = {
        id: "env",
        label: "System default",
        command: envShell,
        args: [],
        available: true,
      };
    }
  }
  if (!profile) profile = getDefaultShellProfile();

  if (!profile.available) {
    throw new Error(
      `No shell executable could be resolved for "${profile.label}" (${profile.command}). ` +
      `Checked absolute paths and PATH.`,
    );
  }

  console.log(`[terminal] spawning ${profile.label} (${profile.command}) for ${projectId}`);

  const ptyProcess = pty.spawn(profile.command, profile.args || [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: (() => {
      // Clean pnpm-injected env vars that cause npm warnings
      const env = { ...process.env, TERM: "xterm-256color" };
      delete env.npm_config_globalconfig;
      delete (env as any)["npm_config_verify-deps-before-run"];
      delete (env as any)["npm_config__jsr-registry"];
      return env;
    })() as Record<string, string>,
  });

  return ptyProcess;
}

/**
 * Find and kill ALL PTY processes belonging to a project.
 * Returns the number of sessions killed.
 * Exported so the workspace-delete handler can call it.
 */
export async function killProjectPtys(projectId: string): Promise<number> {
  const { spawn } = await import("child_process");
  const sessionIdsToKill: string[] = [];
  for (const [sid, pid] of ptyProjectIds.entries()) {
    if (pid === projectId) sessionIdsToKill.push(sid);
  }
  for (const sid of sessionIdsToKill) {
    const p = activePtys.get(sid);
    if (p) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(p.pid), "/f", "/t"], { shell: true });
        } else {
          p.kill();
        }
      } catch {}
    }
    activePtys.delete(sid);
    ptyBuffers.delete(sid);
    ptyProjectIds.delete(sid);
  }
  // Give Windows a moment to release handles after taskkill
  if (sessionIdsToKill.length > 0 && process.platform === "win32") {
    await new Promise((r) => setTimeout(r, 250));
  }
  return sessionIdsToKill.length;
}

// ── Register all terminal IPC handlers ──
export function registerTerminalHandlers(ctx: IpcContext) {

  // GET /api/terminal/profiles — list available shell profiles for the host
  ctx.get("/api/terminal/profiles", async () => {
    const profiles = listShellProfiles();
    const defaultProfile = getDefaultShellProfile();
    return {
      platform: process.platform,
      default: defaultProfile.id,
      profiles,
    };
  });

  // POST /api/terminal/create — create a PTY session
  // In Electron mode the SSE stream is replaced with direct webContents.send
  // events: when PTY outputs data, 'terminal:data' is pushed to the renderer.
  ctx.post("/api/terminal/create", async ({ body }) => {
    const { projectId, sessionId, profile } = body || {};
    if (!projectId || !sessionId) {
      throw new Error("projectId and sessionId required");
    }

    // Return immediately if the session already exists
    if (activePtys.has(sessionId)) {
      return { success: true, sessionId, existing: true };
    }

    let ptyProc: pty.IPty;
    try {
      ptyProc = createPtyForProject(projectId, profile);
    } catch (err: any) {
      console.error(`[terminal] failed to spawn shell for ${projectId}:`, err?.message || err);
      throw new Error(`Failed to spawn shell: ${err?.message || String(err)}`);
    }

    activePtys.set(sessionId, ptyProc);
    ptyProjectIds.set(sessionId, projectId);
    ptyBuffers.set(sessionId, "");

    // Always-on listener: captures every byte to the scrollback buffer AND
    // pushes output directly to the renderer window via IPC (replaces SSE).
    ptyProc.onData((data: string) => {
      let buf = ptyBuffers.get(sessionId) || "";
      buf += data;
      if (buf.length > PTY_BUFFER_MAX) {
        buf = buf.slice(buf.length - PTY_BUFFER_MAX);
      }
      ptyBuffers.set(sessionId, buf);

      // Push to renderer (SSE replacement)
      ctx.getWindow()?.webContents.send("terminal:data", { sessionId, output: data });
    });

    ptyProc.onExit(() => {
      activePtys.delete(sessionId);
      ptyProjectIds.delete(sessionId);
      ptyBuffers.delete(sessionId);
      console.log(`[terminal] PTY ${sessionId} exited`);
      ctx.getWindow()?.webContents.send("terminal:data", { sessionId, exit: true });
    });

    console.log(`[terminal] Created PTY ${sessionId} for ${projectId}`);

    // Send scrollback replay if there's already data (e.g. reconnect scenario).
    // Since creation is brand-new here this will typically be empty, but kept
    // for consistency with the Express implementation.
    const existingBuffer = ptyBuffers.get(sessionId) || "";
    if (existingBuffer.length > 0) {
      win?.webContents.send("terminal:data", { sessionId, output: existingBuffer, replay: true });
    }

    return { success: true, sessionId };
  });

  // POST /api/terminal/write — send input to PTY
  ctx.post("/api/terminal/write", async ({ body }) => {
    const { sessionId, data } = body || {};
    const ptyProc = activePtys.get(sessionId);
    if (!ptyProc) throw new Error("PTY not found");
    ptyProc.write(data);
    return { success: true };
  });

  // POST /api/terminal/resize — resize PTY
  ctx.post("/api/terminal/resize", async ({ body }) => {
    const { sessionId, cols, rows } = body || {};
    const ptyProc = activePtys.get(sessionId);
    if (!ptyProc) throw new Error("PTY not found");
    try { ptyProc.resize(cols, rows); } catch {}
    return { success: true };
  });

  // POST /api/terminal/destroy — kill a PTY session
  ctx.post("/api/terminal/destroy", async ({ body }) => {
    const { sessionId } = body || {};
    const ptyProc = activePtys.get(sessionId);
    if (ptyProc) {
      ptyProc.kill();
      activePtys.delete(sessionId);
      ptyBuffers.delete(sessionId);
      ptyProjectIds.delete(sessionId);
    }
    return { success: true };
  });

  // NOTE: GET /api/terminal/stream (SSE) is NOT registered here.
  // In Electron mode PTY output is pushed via webContents.send('terminal:data').
  // The renderer should listen for that IPC event instead of connecting to an SSE
  // stream. A stream stub is provided below only for API-compat clients that
  // still check whether the endpoint exists.
  ctx.stream("GET", "/api/terminal/stream", async ({ query }, send, done) => {
    const sessionId = query?.sessionId;
    if (!sessionId) { done(); return; }

    const ptyProc = activePtys.get(sessionId);
    if (!ptyProc) { done(); return; }

    // Replay scrollback
    const buffer = ptyBuffers.get(sessionId) || "";
    if (buffer.length > 0) {
      send({ output: buffer, replay: true });
    }

    // Forward live data via the stream protocol
    const disposable = ptyProc.onData((data: string) => {
      send({ output: data });
    });

    const exitDisposable = ptyProc.onExit(() => {
      send({ exit: true });
      disposable.dispose();
      done();
    });

    // The stream stays open until the PTY exits; the caller can disconnect by
    // navigating away (the IPC layer handles cleanup via `done`).
    // We return a cleanup promise that never resolves (PTY drives the lifecycle).
    await new Promise<void>((resolve) => {
      ptyProc.onExit(() => resolve());
    });

    exitDisposable.dispose();
  });
}
