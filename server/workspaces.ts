/**
 * Linked workspaces — let users open arbitrary folders on disk and use
 * them as projects (like VS Code's "Open Folder" feature).
 *
 * The registry maps a synthetic projectId to an absolute filesystem path.
 * When file ops are performed on that projectId, they go to the linked
 * path instead of WORKSPACE_BASE/<projectId>.
 *
 * The registry is persisted to a JSON file in the server's data dir so
 * links survive restarts.
 */

import path from "path";
import fs from "fs";

export interface LinkedWorkspace {
  id: string;            // synthetic project id (e.g. "linked-1234")
  name: string;          // display name
  absolutePath: string;  // resolved absolute path on disk
  template?: string;     // detected framework, if any
  linkedAt: number;      // timestamp
  lastOpened?: number;   // timestamp of most recent open
}

const REGISTRY_VERSION = 1;
let registryPath = "";
let registry = new Map<string, LinkedWorkspace>();
let workspaceBase = "";

function load() {
  if (!fs.existsSync(registryPath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    if (data.version !== REGISTRY_VERSION) return;
    for (const entry of data.workspaces || []) {
      registry.set(entry.id, entry);
    }
  } catch (err) {
    console.error("[workspaces] failed to load registry", err);
  }
}

function save() {
  try {
    const data = {
      version: REGISTRY_VERSION,
      workspaces: Array.from(registry.values()),
    };
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[workspaces] failed to save registry", err);
  }
}

/** Initialize the linked-workspace registry. Call once at server startup. */
export function initWorkspaces(opts: { workspaceBase: string; registryPath?: string }) {
  workspaceBase = opts.workspaceBase;
  registryPath = opts.registryPath || path.join(workspaceBase, ".pipilot-linked.json");
  load();
}

/** Resolve a projectId to an absolute working directory */
export function resolveWorkspaceDir(projectId: string): string {
  const linked = registry.get(projectId);
  if (linked && fs.existsSync(linked.absolutePath)) {
    return linked.absolutePath;
  }
  return path.join(workspaceBase, projectId);
}

/** Check if a projectId is a linked workspace */
export function isLinked(projectId: string): boolean {
  return registry.has(projectId);
}

/** Get linked workspace metadata */
export function getLinked(projectId: string): LinkedWorkspace | null {
  return registry.get(projectId) || null;
}

/** Detect the framework from a folder's package.json */
function detectFrameworkAt(absPath: string): string | undefined {
  try {
    const pkgPath = path.join(absPath, "package.json");
    if (!fs.existsSync(pkgPath)) return undefined;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if ("next" in deps) return "nextjs";
    if ("vite" in deps) return "vite-react";
    if ("express" in deps) return "express";
    return "node";
  } catch {
    return undefined;
  }
}

/**
 * Link a folder on disk as a workspace.
 * Returns the registered LinkedWorkspace, or throws if the path is invalid.
 */
export function linkFolder(absolutePath: string, displayName?: string): LinkedWorkspace {
  // Normalize and validate
  const normalized = path.resolve(absolutePath);
  if (!fs.existsSync(normalized)) {
    throw new Error(`Path does not exist: ${normalized}`);
  }
  if (!fs.statSync(normalized).isDirectory()) {
    throw new Error(`Path is not a directory: ${normalized}`);
  }

  // Check if already linked — return existing entry
  for (const entry of registry.values()) {
    if (entry.absolutePath === normalized) {
      entry.lastOpened = Date.now();
      save();
      return entry;
    }
  }

  // Generate a unique id
  const id = `linked-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const name = displayName || path.basename(normalized) || "Folder";
  const template = detectFrameworkAt(normalized);

  const ws: LinkedWorkspace = {
    id,
    name,
    absolutePath: normalized,
    template,
    linkedAt: Date.now(),
    lastOpened: Date.now(),
  };
  registry.set(id, ws);
  save();
  return ws;
}

/** Remove a link (does NOT delete the actual files) */
export function unlinkFolder(projectId: string): boolean {
  const existed = registry.delete(projectId);
  if (existed) save();
  return existed;
}

/** Mark a linked workspace as recently opened */
export function touchLinked(projectId: string) {
  const ws = registry.get(projectId);
  if (ws) {
    ws.lastOpened = Date.now();
    save();
  }
}

/** List all linked workspaces, sorted by lastOpened desc */
export function listLinked(): LinkedWorkspace[] {
  return Array.from(registry.values()).sort(
    (a, b) => (b.lastOpened || b.linkedAt) - (a.lastOpened || a.linkedAt),
  );
}
