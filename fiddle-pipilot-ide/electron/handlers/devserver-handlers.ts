/**
 * Dev Server IPC Handlers — replaces Express /api/dev-server/ and /api/dev-preview endpoints.
 *
 * Delegates to the same server/dev-server module used by the Express server,
 * so all dev-server business logic (port detection, install, log streaming)
 * is shared between HTTP and IPC modes.
 */

import fs from "fs";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir, initWorkspaces } from "../../server/workspaces";
import { WORKSPACE_BASE } from "../../server/config";
import {
  startDevServer,
  stopDevServer,
  getDevServerStatus,
  subscribeToLogs,
} from "../../server/dev-server";

// Ensure the workspace registry is initialised (idempotent).
initWorkspaces({ workspaceBase: WORKSPACE_BASE });

// ── Register all dev-server IPC handlers ──
export function registerDevServerHandlers(ctx: IpcContext) {

  // POST /api/dev-server/start — start a dev server for a project
  ctx.post("/api/dev-server/start", async ({ body }) => {
    const { projectId, force } = body || {};
    if (!projectId) throw new Error("projectId required");

    const workDir = resolveWorkspaceDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    // Reuse existing dev server if already running (unless force restart requested)
    const existing = getDevServerStatus(projectId);
    if (
      !force &&
      existing &&
      (existing.status === "running" ||
        existing.status === "starting" ||
        existing.status === "installing")
    ) {
      console.log(
        `[dev-server] Reusing ${existing.status} server for ${projectId}${
          existing.port ? ` on port ${existing.port}` : ""
        }`,
      );
      return {
        success: true,
        status: existing.status,
        projectId,
        port: existing.port,
        url: existing.url,
        reused: true,
      };
    }

    // Start async — don't await, respond immediately
    startDevServer(projectId, workDir, (status, port, url) => {
      console.log(`[dev-server] ${projectId}: ${status}${port ? ` on port ${port}` : ""}`);
    });

    return { success: true, status: "starting", projectId, reused: false };
  });

  // POST /api/dev-server/stop — stop a dev server
  ctx.post("/api/dev-server/stop", async ({ body }) => {
    const { projectId } = body || {};
    if (!projectId) throw new Error("projectId required");
    const stopped = stopDevServer(projectId);
    return { success: stopped };
  });

  // GET /api/dev-server/status — get dev server status
  ctx.get("/api/dev-server/status", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");
    return getDevServerStatus(projectId) || { running: false, status: "stopped" };
  });

  // GET /api/dev-preview — redirect/info for the running dev server
  // In Electron mode there is no HTTP proxy to redirect through, so we return
  // the target URL and let the renderer open it (e.g. in an <iframe> or shell).
  ctx.get("/api/dev-preview", async ({ query }) => {
    const projectId = query?.projectId;
    if (!projectId) throw new Error("projectId required");

    const status = getDevServerStatus(projectId);
    if (!status || !status.running || !status.port) {
      throw new Error(`Dev server not running (status: ${status?.status || "stopped"})`);
    }

    // Return the target URL; the renderer is responsible for navigation/embed.
    const targetUrl = `http://localhost:${status.port}${query?.path || "/"}`;
    return { url: targetUrl, port: status.port };
  });

  // GET /api/dev-server/logs — SSE stream of dev server log output
  // Replaces the Express SSE handler using the IPC stream protocol.
  ctx.stream("GET", "/api/dev-server/logs", async ({ query }, send, done) => {
    const projectId = query?.projectId;
    if (!projectId) { done(); return; }

    // Send existing logs as initial batch so the client sees history
    const status = getDevServerStatus(projectId);
    if (status?.logs?.length) {
      for (const log of status.logs) {
        send({ text: log, source: "stdout", level: "info" });
      }
    }

    // Subscribe to live log events and forward them via the stream
    const unsub = subscribeToLogs(projectId, (entry) => {
      try {
        send(entry);
      } catch {}
    });

    // Keep the stream alive until the dev server stops or the client disconnects.
    // The IPC layer will call done() when the renderer side closes — we resolve
    // when either the server stops or the subscription is no longer needed.
    await new Promise<void>((resolve) => {
      // Poll for server stop so we can signal done()
      const interval = setInterval(() => {
        const s = getDevServerStatus(projectId);
        if (!s || s.status === "stopped" || s.status === "error") {
          clearInterval(interval);
          unsub();
          done();
          resolve();
        }
      }, 2000);

      // Safety cleanup: resolve if this promise is abandoned
      // (the ipc-api layer does not currently cancel in-flight streams,
      //  so we rely on the poll above to eventually clean up).
    });
  });
}
