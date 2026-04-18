/**
 * Shared utilities for IPC handlers.
 * Workspace resolution, config paths, etc.
 */

import path from "path";
import os from "os";
import fs from "fs";

const home = os.homedir();

// ── Workspace base ──
export const WORKSPACE_BASE = (() => {
  if (process.env.PIPILOT_WORKSPACE_DIR) return process.env.PIPILOT_WORKSPACE_DIR;
  const dir = path.join(home, "PiPilot", "workspaces");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
})();

// ── Config directory ──
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

// ── Cache directory ──
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

// ── Resolve workspace directory ──
// Checks linked workspaces first, falls back to WORKSPACE_BASE/projectId
export function resolveWorkspaceDir(projectId: string): string {
  // Check linked workspaces registry
  try {
    const regPath = path.join(WORKSPACE_BASE, ".pipilot-linked.json");
    if (fs.existsSync(regPath)) {
      const registry = JSON.parse(fs.readFileSync(regPath, "utf8"));
      for (const entry of Object.values(registry) as any[]) {
        if (entry.id === projectId && entry.absolutePath && fs.existsSync(entry.absolutePath)) {
          return entry.absolutePath;
        }
      }
    }
  } catch {}
  return path.join(WORKSPACE_BASE, projectId);
}
