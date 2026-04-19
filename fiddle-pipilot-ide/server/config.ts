/**
 * Shared configuration for PiPilot IDE servers.
 * Ports use the 51730-51739 range (IANA private/dynamic) to avoid
 * conflicts with common dev tools (Vite 5173, Next 3000, Express 3001).
 *
 * Workspace location: ~/PiPilot/workspaces/ on all platforms.
 * Config/cache goes in the standard app-data directory per OS.
 */

import path from "path";
import os from "os";
import fs from "fs";

// ── Ports ────────────────────────────────────────────────────────────

/** Main agent server (Agent SDK, terminal, file system, diagnostics) */
export const PORT_AGENT = parseInt(process.env.PIPILOT_PORT_AGENT || "51731");

/** Cloud API server (GitHub, Vercel, Supabase, Cloudflare, etc.) */
export const PORT_CLOUD = parseInt(process.env.PIPILOT_PORT_CLOUD || "51732");

/** Vite dev server (frontend) — configured in vite.config.ts */
export const PORT_VITE = parseInt(process.env.PIPILOT_PORT_VITE || "51730");

// ── Workspace paths ──────────────────────────────────────────────────

const home = os.homedir();

/**
 * User-visible project directory. Placed in ~/PiPilot/workspaces/
 * so users can browse, git push, and open in other editors easily.
 */
export const WORKSPACE_BASE = (() => {
  // Allow override via env var (useful for dev/testing)
  if (process.env.PIPILOT_WORKSPACE_DIR) return process.env.PIPILOT_WORKSPACE_DIR;

  const dir = path.join(home, "PiPilot", "workspaces");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
})();

/**
 * App data directory for config, tokens, settings.
 * - Windows: %LOCALAPPDATA%\PiPilot\config
 * - macOS:   ~/Library/Application Support/PiPilot/config
 * - Linux:   ~/.config/PiPilot (XDG_CONFIG_HOME)
 */
export const CONFIG_DIR = (() => {
  if (process.env.PIPILOT_CONFIG_DIR) return process.env.PIPILOT_CONFIG_DIR;

  let base: string;
  if (process.platform === "win32") {
    base = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "PiPilot");
  } else if (process.platform === "darwin") {
    base = path.join(home, "Library", "Application Support", "PiPilot");
  } else {
    base = path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "PiPilot");
  }
  const dir = path.join(base, "config");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
})();

/**
 * Cache/data directory for checkpoints, temp files.
 * - Windows: %LOCALAPPDATA%\PiPilot\cache
 * - macOS:   ~/Library/Caches/PiPilot
 * - Linux:   ~/.cache/PiPilot (XDG_CACHE_HOME)
 */
export const CACHE_DIR = (() => {
  if (process.env.PIPILOT_CACHE_DIR) return process.env.PIPILOT_CACHE_DIR;

  let dir: string;
  if (process.platform === "win32") {
    dir = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "PiPilot", "cache");
  } else if (process.platform === "darwin") {
    dir = path.join(home, "Library", "Caches", "PiPilot");
  } else {
    dir = path.join(process.env.XDG_CACHE_HOME || path.join(home, ".cache"), "PiPilot");
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
})();

/** Checkpoint storage (inside cache) */
export const CHECKPOINT_DIR = path.join(CACHE_DIR, "checkpoints");
