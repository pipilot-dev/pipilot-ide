/**
 * Diagnostics IPC handlers — check and install-deps.
 * Ported from server/index.ts.
 */

import fs from "fs";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir } from "./shared";

function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

export function registerDiagnosticsHandlers(ctx: IpcContext) {
  const { get, post } = ctx;

  // GET /api/diagnostics/check?projectId=&source=all|typescript|python|go|rust|php|ruby
  get("/api/diagnostics/check", async ({ query }) => {
    const projectId = query?.projectId as string;
    const source = (query?.source as string) || "all";
    if (!projectId) throw new Error("projectId required");

    const workDir = getWorkDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    const {
      runAllChecks, runTypeScriptCheck, runPythonCheck,
      runGoCheck, runRustCheck, runPhpCheck, runRubyCheck,
    } = await import("../../server/diagnostics");

    const singles: Record<string, (w: string) => Promise<any[]>> = {
      typescript: runTypeScriptCheck,
      python: runPythonCheck,
      go: runGoCheck,
      rust: runRustCheck,
      php: runPhpCheck,
      ruby: runRubyCheck,
    };

    if (source !== "all" && singles[source]) {
      const diagnostics = await singles[source](workDir);
      return { diagnostics, ran: { [source]: true } };
    } else {
      return runAllChecks(workDir);
    }
  });

  // POST /api/diagnostics/install-deps
  post("/api/diagnostics/install-deps", async ({ body }) => {
    const { projectId } = body || {};
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    const { ensureNodeModules } = await import("../../server/diagnostics");
    return ensureNodeModules(workDir);
  });
}
