/**
 * Project IPC handlers — search, seed-config, detect-framework, scripts, deployments.
 * Ported from server/index.ts.
 */

import fs from "fs";
import path from "path";
import type { IpcContext } from "../ipc-api";
import { resolveWorkspaceDir } from "./shared";

function getWorkDir(projectId: string): string {
  return resolveWorkspaceDir(projectId);
}

function deployHistoryPath(projectId: string): string {
  const dir = path.join(getWorkDir(projectId), ".pipilot");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "deployments.json");
}

export function registerProjectHandlers(ctx: IpcContext) {
  const { get, post } = ctx;

  // ── Search ──

  post("/api/project/search", async ({ body }) => {
    const { projectId, query, mode, caseSensitive, useRegex, exclude, maxResults } = body;
    if (!projectId || !query) throw new Error("projectId and query required");

    const workDir = getWorkDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    const excludeSet = new Set(["node_modules", ".git", "dist", "build", ".next", "out", ".cache", ".vite"]);
    if (Array.isArray(exclude)) {
      for (const e of exclude) excludeSet.add(e);
    }

    const limit = Math.min(maxResults || 200, 1000);
    const results: { fileId: string; fileName: string; filePath: string; matches: { lineNumber: number; lineText: string; matchStart: number; matchEnd: number }[] }[] = [];

    let pattern: RegExp;
    try {
      const flags = caseSensitive ? "g" : "gi";
      if (useRegex) pattern = new RegExp(query, flags);
      else pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch {
      throw new Error("Invalid regex");
    }

    function walk(dir: string, relBase: string) {
      if (results.length >= limit) return;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        if (results.length >= limit) return;
        if (excludeSet.has(entry)) continue;
        const full = path.join(dir, entry);
        const relPath = relBase ? `${relBase}/${entry}` : entry;
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }

        if (stat.isDirectory()) {
          walk(full, relPath);
        } else if (stat.isFile()) {
          if (stat.size > 1_000_000) continue;

          if (mode === "filename") {
            pattern.lastIndex = 0;
            if (pattern.test(entry)) {
              results.push({ fileId: relPath, fileName: entry, filePath: relPath, matches: [] });
            }
          } else {
            let content: string;
            try { content = fs.readFileSync(full, "utf8"); } catch { continue; }
            if (content.slice(0, 8192).includes("\0")) continue;

            const lines = content.split("\n");
            const matches: { lineNumber: number; lineText: string; matchStart: number; matchEnd: number }[] = [];
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= 20) break;
              const line = lines[i];
              pattern.lastIndex = 0;
              const m = pattern.exec(line);
              if (m) {
                matches.push({
                  lineNumber: i + 1,
                  lineText: line.slice(0, 500),
                  matchStart: m.index,
                  matchEnd: m.index + m[0].length,
                });
              }
            }
            if (matches.length > 0) {
              results.push({ fileId: relPath, fileName: entry, filePath: relPath, matches });
            }
          }
        }
      }
    }

    walk(workDir, "");
    return { results, truncated: results.length >= limit };
  });

  // ── Seed config ──

  post("/api/project/seed-config", async ({ body }) => {
    const { projectId } = body;
    if (!projectId) throw new Error("projectId required");

    const workDir = getWorkDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    const { seedMissingConfigs } = await import("../../server/seed-config");
    return seedMissingConfigs(workDir);
  });

  // ── Detect framework ──

  get("/api/project/detect-framework", async ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");

    const workDir = getWorkDir(projectId);
    if (!fs.existsSync(workDir)) throw new Error("Workspace not found");

    const { detectFramework } = await import("../../server/seed-config");
    const framework = detectFramework(workDir);
    return { framework };
  });

  // ── Project scripts ──

  get("/api/project/scripts", ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");
    const workDir = getWorkDir(projectId);
    const pkgPath = path.join(workDir, "package.json");
    if (!fs.existsSync(pkgPath)) return { scripts: {}, hasPackageJson: false };
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return {
      scripts: pkg.scripts || {},
      hasPackageJson: true,
      name: pkg.name,
      version: pkg.version,
    };
  });

  // ── Deployment history ──

  get("/api/deployments/list", ({ query }) => {
    const projectId = query?.projectId as string;
    if (!projectId) throw new Error("projectId required");
    try {
      const p = deployHistoryPath(projectId);
      const deployments = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
      return { deployments };
    } catch { return { deployments: [] }; }
  });

  post("/api/deployments/record", ({ body }) => {
    const { projectId, ...record } = body;
    if (!projectId) throw new Error("projectId required");
    const p = deployHistoryPath(projectId);
    const existing = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
    existing.unshift(record);
    while (existing.length > 50) existing.pop();
    fs.writeFileSync(p, JSON.stringify(existing, null, 2));
    return { success: true };
  });
}
