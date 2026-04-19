/**
 * Workspace IPC Handlers — replaces Express /api/workspaces/ endpoints.
 *
 * Linked-workspace registry operations run directly in the Electron main process.
 * The registry maps synthetic project IDs to absolute filesystem paths,
 * persisted across restarts in the workspace base directory.
 */

import path from "path";
import fs from "fs";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir } from "./shared";
import {
  linkFolder,
  unlinkFolder,
  touchLinked,
  listLinked,
  getLinked,
} from "../../server/workspaces";

// ── Handler registration ─────────────────────────────────────────────

export function registerWorkspaceHandlers(ctx: IpcContext) {
  const { get, post } = ctx;

  // POST /api/workspaces/link — register an external folder as a workspace
  post("/api/workspaces/link", async ({ body }) => {
    const { absolutePath, name } = body || {};
    if (!absolutePath || typeof absolutePath !== "string") {
      throw new Error("absolutePath required");
    }
    const ws = linkFolder(absolutePath, name);
    return { success: true, workspace: ws };
  });

  // GET /api/workspaces/list — return all linked workspaces
  get("/api/workspaces/list", async () => {
    return { workspaces: listLinked() };
  });

  // POST /api/workspaces/unlink — remove a linked workspace (does NOT delete files)
  post("/api/workspaces/unlink", async ({ body }) => {
    const { projectId } = body || {};
    if (!projectId) throw new Error("projectId required");
    const removed = unlinkFolder(projectId);
    return { success: removed };
  });

  // POST /api/workspaces/touch — bump the lastOpened timestamp
  post("/api/workspaces/touch", async ({ body }) => {
    const { projectId } = body || {};
    if (!projectId) throw new Error("projectId required");
    touchLinked(projectId);
    return { success: true };
  });

  // GET /api/workspaces/info?projectId=... — info about a single workspace
  get("/api/workspaces/info", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");
    const linked = getLinked(projectId);
    if (linked) {
      return { ...linked, isLinked: true };
    }
    const dir = resolveWorkspaceDir(projectId);
    return {
      id: projectId,
      name: path.basename(dir),
      absolutePath: dir,
      isLinked: false,
      exists: fs.existsSync(dir),
    };
  });
}
