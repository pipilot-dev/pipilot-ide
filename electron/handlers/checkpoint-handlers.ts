/**
 * Checkpoint IPC Handlers — replaces Express /api/checkpoints/ endpoints.
 *
 * Zip-based file snapshots run directly in the Electron main process.
 * Checkpoints are stored in CACHE_DIR/checkpoints, completely separate from git.
 */

import fs from "fs";
import path from "path";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, CACHE_DIR } from "./shared";
import {
  isGitCheckpointsAvailable,
  createCheckpoint,
  listCheckpoints,
  findCheckpointBeforeMessage,
  restoreCheckpoint,
  deleteCheckpoint,
  clearProjectCheckpoints,
  initCheckpoints,
} from "../../server/checkpoints";

// Derive checkpoint directory from CACHE_DIR (mirrors server/config.ts CHECKPOINT_DIR)
const CHECKPOINT_DIR = path.join(CACHE_DIR, "checkpoints");

// Ensure checkpoints module is initialized for the Electron context.
// initCheckpoints is idempotent — safe to call multiple times.
initCheckpoints({ dataDir: CHECKPOINT_DIR });

// ── Handler registration ─────────────────────────────────────────────

export function registerCheckpointHandlers(ctx: IpcContext) {
  const { get, post } = ctx;

  // GET /api/checkpoints/git-available — check if checkpoints are available
  get("/api/checkpoints/git-available", async () => {
    try {
      const available = await isGitCheckpointsAvailable();
      return { available };
    } catch {
      return { available: false };
    }
  });

  // POST /api/checkpoints/create — snapshot the current workspace
  post("/api/checkpoints/create", async ({ body }) => {
    const { projectId, label, messageId, useGit } = body || {};
    if (!projectId || !label) throw new Error("projectId and label required");

    const workDir = resolveWorkspaceDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    const meta = await createCheckpoint({ projectId, workDir, label, messageId, useGit });
    return { success: true, checkpoint: meta };
  });

  // GET /api/checkpoints/list?projectId=...
  get("/api/checkpoints/list", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");
    return { checkpoints: listCheckpoints(projectId) };
  });

  // GET /api/checkpoints/find-before?projectId=&messageId=
  get("/api/checkpoints/find-before", async ({ query }) => {
    const projectId = query?.projectId;
    const messageId = query?.messageId;
    if (!projectId || !messageId) throw new Error("projectId and messageId required");
    const meta = findCheckpointBeforeMessage(projectId, messageId);
    return { checkpoint: meta };
  });

  // POST /api/checkpoints/restore — restore the workspace to a checkpoint
  post("/api/checkpoints/restore", async ({ body }) => {
    const { projectId, checkpointId } = body || {};
    if (!projectId || !checkpointId) throw new Error("projectId and checkpointId required");

    const workDir = resolveWorkspaceDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    return restoreCheckpoint({ projectId, workDir, checkpointId });
  });

  // POST /api/checkpoints/delete
  post("/api/checkpoints/delete", async ({ body }) => {
    const { projectId, checkpointId } = body || {};
    if (!projectId || !checkpointId) throw new Error("projectId and checkpointId required");
    await deleteCheckpoint(projectId, checkpointId);
    return { success: true };
  });

  // POST /api/checkpoints/clear — wipe all checkpoints for a project
  post("/api/checkpoints/clear", async ({ body }) => {
    const { projectId } = body || {};
    if (!projectId) throw new Error("projectId required");
    clearProjectCheckpoints(projectId);
    return { success: true };
  });
}
