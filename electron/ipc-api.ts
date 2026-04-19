/**
 * IPC API Router — replaces the Express server entirely.
 *
 * All API endpoints are registered as IPC handlers.
 * The renderer calls `api:request` with {method, path, body, query}
 * and this router dispatches to the appropriate handler.
 *
 * For streaming endpoints (SSE), the renderer calls `api:stream-start`
 * and receives events via `api:stream:{streamId}`.
 */

import type { IpcMain, BrowserWindow } from "electron";
import { randomUUID } from "crypto";

// Handler type: receives params, returns data
type Handler = (params: { body?: any; query?: Record<string, string> }) => Promise<any>;

// Stream handler: receives params + send function for pushing events
type StreamHandler = (
  params: { body?: any; query?: Record<string, string> },
  send: (data: any) => void,
  done: () => void,
) => Promise<void>;

// Route registry
const routes = new Map<string, Handler>();
const streamRoutes = new Map<string, StreamHandler>();

// Helper to register routes
function get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); }
function post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); }
function del(path: string, handler: Handler) { routes.set(`DELETE ${path}`, handler); }

// Helper to register stream routes (SSE replacements)
function stream(method: string, path: string, handler: StreamHandler) {
  streamRoutes.set(`${method} ${path}`, handler);
}

// ── Import all server modules ──
// These run directly in the Electron main process — no child processes, no HTTP
import { registerFileSystemHandlers } from "./handlers/fs-handlers";
import { registerTerminalHandlers } from "./handlers/terminal-handlers";
import { registerGitHandlers } from "./handlers/git-handlers";
import { registerAgentHandlers } from "./handlers/agent-handlers";
import { registerCheckpointHandlers } from "./handlers/checkpoint-handlers";
import { registerWorkspaceHandlers } from "./handlers/workspace-handlers";
import { registerDevServerHandlers } from "./handlers/devserver-handlers";
import { registerProjectHandlers } from "./handlers/project-handlers";
import { registerDiagnosticsHandlers } from "./handlers/diagnostics-handlers";
import { registerMcpHandlers } from "./handlers/mcp-handlers";
import { registerCloudHandlers } from "./handlers/cloud-handlers";
import { registerMiscHandlers } from "./handlers/misc-handlers";

// ── Register all handlers ──
export function registerAllHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
) {
  // Register domain-specific handlers
  const ctx = { get, post, del, stream, getWindow };
  registerFileSystemHandlers(ctx);
  registerTerminalHandlers(ctx);
  registerGitHandlers(ctx);
  registerAgentHandlers(ctx);
  registerCheckpointHandlers(ctx);
  registerWorkspaceHandlers(ctx);
  registerDevServerHandlers(ctx);
  registerProjectHandlers(ctx);
  registerDiagnosticsHandlers(ctx);
  registerMcpHandlers(ctx);
  registerCloudHandlers(ctx);
  registerMiscHandlers(ctx);

  console.log(`[ipc] Registered ${routes.size} routes + ${streamRoutes.size} stream routes`);

  // ── Generic request handler ──
  ipcMain.handle("api:request", async (_event, req: {
    method: string;
    path: string;
    body?: any;
    query?: Record<string, string>;
  }) => {
    const key = `${req.method} ${req.path}`;
    const handler = routes.get(key);

    if (handler) {
      try {
        const result = await handler({ body: req.body, query: req.query });
        return { status: 200, data: result };
      } catch (err: any) {
        console.error(`[ipc] ${key} error:`, err.message);
        return { status: 500, data: { error: err.message } };
      }
    }

    // Check if it's a stream route
    const streamHandler = streamRoutes.get(key);
    if (streamHandler) {
      const streamId = randomUUID();
      const win = getWindow();

      const send = (data: any) => {
        win?.webContents.send(`api:stream:${streamId}`, data);
      };
      const done = () => {
        win?.webContents.send(`api:stream:${streamId}`, { __done: true });
      };

      // Run stream handler asynchronously
      streamHandler({ body: req.body, query: req.query }, send, done).catch((err) => {
        console.error(`[ipc] stream ${key} error:`, err.message);
        done();
      });

      return { __stream: true, __streamId: streamId };
    }

    console.warn(`[ipc] No handler for: ${key}`);
    return { status: 404, data: { error: `No handler for ${key}` } };
  });

  // ── Stream start handler (for EventSource replacement) ──
  ipcMain.handle("api:stream-start", async (_event, req: {
    path: string;
    query?: Record<string, string>;
  }) => {
    const key = `GET ${req.path}`;
    const streamHandler = streamRoutes.get(key);

    if (!streamHandler) {
      throw new Error(`No stream handler for ${key}`);
    }

    const streamId = randomUUID();
    const win = getWindow();

    const send = (data: any) => {
      win?.webContents.send(`api:stream:${streamId}`, data);
    };
    const done = () => {
      win?.webContents.send(`api:stream:${streamId}`, { __done: true });
    };

    // Delay stream start slightly so the renderer has time to register
    // its listener for api:stream:${streamId} after receiving the streamId
    setTimeout(() => {
      streamHandler({ query: req.query }, send, done).catch((err) => {
        console.error(`[ipc] stream ${key} error:`, err.message);
        done();
      });
    }, 50);

    return streamId;
  });
}

// Export context type for handler files
export type IpcContext = {
  get: typeof get;
  post: typeof post;
  del: typeof del;
  stream: (method: string, path: string, handler: StreamHandler) => void;
  getWindow: () => BrowserWindow | null;
};
