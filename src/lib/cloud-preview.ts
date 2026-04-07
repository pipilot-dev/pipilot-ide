import { db } from "./db";

/**
 * E2B Cloud Preview — full Node.js sandbox with npm, Vite HMR, Next.js SSR.
 * Uses the PiPilot preview API at pipilot.dev backed by E2B sandboxes.
 */

const PREVIEW_API = import.meta.env.VITE_PREVIEW_API_URL || "https://pipilot.dev/api/app-preview";
const API_KEY = import.meta.env.VITE_PREVIEW_API_KEY || "";

export interface CloudPreviewResult {
  success: boolean;
  previewUrl: string;
  sessionId: string;
  framework?: string;
  error?: string;
}

interface CloudPreviewSession {
  sessionId: string;
  previewUrl: string;
  projectId: string;
  createdAt: number;
}

// In-memory session cache — reuse sessions for the same project
const sessionCache = new Map<string, CloudPreviewSession>();

// ─── E2B File Patching ──────────────────────────────────────────────
// Auto-patch Vite/Next.js configs so the dev server binds to 0.0.0.0
// and allows .e2b.app domains. Without this, the sandbox preview fails.

function patchFilesForE2B(files: { path: string; content: string }[]): { path: string; content: string }[] {
  return files.map((f) => {
    // Patch vite.config.ts / vite.config.js
    if (/^(vite\.config\.(ts|js|mjs))$/.test(f.path) || f.path.endsWith("/vite.config.ts") || f.path.endsWith("/vite.config.js")) {
      return { ...f, content: patchViteConfig(f.content) };
    }
    // Patch next.config.js / next.config.mjs / next.config.ts
    if (/^(next\.config\.(js|mjs|ts))$/.test(f.path) || f.path.endsWith("/next.config.js") || f.path.endsWith("/next.config.mjs")) {
      return { ...f, content: patchNextConfig(f.content) };
    }
    // Patch package.json scripts to use host 0.0.0.0
    if (f.path === "package.json" || f.path.endsWith("/package.json")) {
      return { ...f, content: patchPackageJson(f.content) };
    }
    return f;
  });
}

function patchViteConfig(content: string): string {
  // If already has server.host = '0.0.0.0', skip
  if (content.includes("0.0.0.0")) return content;

  // If there's a server: { ... } block, add host and allowedHosts
  if (content.includes("server:") || content.includes("server :")) {
    // Replace the server block to inject host and allowedHosts
    return content.replace(
      /server\s*:\s*\{/,
      `server: {\n    host: '0.0.0.0',\n    allowedHosts: ['.e2b.app'],\n    cors: true,`
    );
  }

  // If no server block exists, inject one before the closing })
  // Find the last }) which closes defineConfig({
  const lastBrace = content.lastIndexOf("})");
  if (lastBrace > 0) {
    return (
      content.slice(0, lastBrace) +
      `  server: {\n    host: '0.0.0.0',\n    cors: true,\n    allowedHosts: ['.e2b.app'],\n  },\n` +
      content.slice(lastBrace)
    );
  }

  return content;
}

function patchNextConfig(content: string): string {
  // For Next.js, we need to set hostname in the dev script, not in config
  // But we can set allowedDevOrigins if Next 15+
  if (content.includes("e2b.app")) return content;

  // Try to inject allowedDevOrigins into the config object
  if (content.includes("module.exports")) {
    return content.replace(
      /module\.exports\s*=\s*\{/,
      `module.exports = {\n  allowedDevOrigins: ['https://*.e2b.app'],`
    );
  }
  if (content.includes("export default")) {
    // For ES module next configs
    return content.replace(
      /export\s+default\s*\{/,
      `export default {\n  allowedDevOrigins: ['https://*.e2b.app'],`
    );
  }

  return content;
}

function patchPackageJson(content: string): string {
  try {
    const pkg = JSON.parse(content);
    let changed = false;

    if (pkg.scripts) {
      // Patch vite dev scripts to bind to 0.0.0.0
      for (const [key, val] of Object.entries(pkg.scripts)) {
        if (typeof val !== "string") continue;

        // vite / vite dev → vite --host 0.0.0.0
        if ((val.includes("vite") && !val.includes("--host")) && (key === "dev" || key === "start")) {
          pkg.scripts[key] = val.replace(/vite(\s|$)/, "vite --host 0.0.0.0$1");
          changed = true;
        }

        // next dev → next dev -H 0.0.0.0
        if (val.includes("next dev") && !val.includes("-H ") && !val.includes("--hostname")) {
          pkg.scripts[key] = val.replace("next dev", "next dev -H 0.0.0.0");
          changed = true;
        }
      }
    }

    return changed ? JSON.stringify(pkg, null, 2) : content;
  } catch {
    return content;
  }
}

/**
 * Poll a URL until it responds with a non-error status.
 * The E2B sandbox returns the preview URL immediately but the dev server
 * may take 10-60 seconds to actually start listening.
 */
async function waitForPortReady(
  url: string,
  timeoutMs: number = 90000,
  onProgress?: (msg: string) => void
): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt++;
    try {
      onProgress?.(`Waiting for server... (attempt ${attempt})`);
      const res = await fetch(url, {
        method: "HEAD",
        mode: "no-cors", // We just need to know it doesn't throw
        signal: AbortSignal.timeout(5000),
      });
      // no-cors returns opaque response (status 0) but no error = port is open
      return true;
    } catch {
      // Connection refused or timeout — port not ready yet
    }
    // Wait before retrying (increasing interval: 2s, 3s, 4s, 5s...)
    const delay = Math.min(2000 + attempt * 500, 5000);
    await new Promise((r) => setTimeout(r, delay));
  }

  return false;
}

/**
 * Create or update a cloud preview for the given project.
 * Syncs all project files to an E2B sandbox, installs deps, starts dev server.
 */
export async function createCloudPreview(
  projectId: string,
  options?: { force?: boolean },
  onProgress?: (msg: string) => void
): Promise<CloudPreviewResult> {
  // Get all project files
  const files = await db.files
    .where("projectId")
    .equals(projectId)
    .and((f) => f.type === "file" && !!f.content)
    .toArray();

  if (files.length === 0) {
    return { success: false, previewUrl: "", sessionId: "", error: "No files to preview" };
  }

  // Check for existing session to reuse
  const cached = sessionCache.get(projectId);
  const sessionId = (!options?.force && cached) ? cached.sessionId : undefined;

  try {
    // Patch project files for E2B compatibility before uploading
    const patchedFiles = patchFilesForE2B(files.map((f) => ({ path: f.id, content: f.content || "" })));

    const res = await fetch(PREVIEW_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": API_KEY,
      },
      body: JSON.stringify({
        files: patchedFiles,
        framework: "auto",
        sessionId,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      return {
        success: false,
        previewUrl: "",
        sessionId: sessionId || "",
        error: `Preview API error (${res.status}): ${errText.slice(0, 200)}`,
      };
    }

    const data = await res.json();
    let previewUrl = data.previewUrl || "";

    // The API returns the URL immediately but the dev server may still be starting.
    // Poll until the URL actually responds (max 90 seconds).
    if (previewUrl) {
      const ready = await waitForPortReady(previewUrl, 90000, onProgress);
      if (!ready) {
        // If the default port isn't ready, the API response might have a different port.
        // Return the URL anyway — the CloudPreview component will keep polling.
      }
    }

    // Cache the session
    sessionCache.set(projectId, {
      sessionId: data.sessionId,
      previewUrl,
      projectId,
      createdAt: Date.now(),
    });

    return {
      success: true,
      previewUrl,
      sessionId: data.sessionId,
      framework: data.framework,
    };
  } catch (err: any) {
    return {
      success: false,
      previewUrl: "",
      sessionId: "",
      error: `Network error: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Check status of a cloud preview session.
 */
export async function getCloudPreviewStatus(sessionId: string): Promise<{
  active: boolean;
  previewUrl?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${PREVIEW_API}?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { "Authorization": API_KEY },
    });
    if (!res.ok) return { active: false, error: `Status check failed: ${res.status}` };
    const data = await res.json();
    return { active: true, previewUrl: data.previewUrl };
  } catch (err: any) {
    return { active: false, error: err?.message || String(err) };
  }
}

/**
 * Stop a cloud preview session.
 */
export async function stopCloudPreview(sessionId: string): Promise<void> {
  try {
    await fetch(`${PREVIEW_API}?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { "Authorization": API_KEY },
    });
  } catch {}
  // Remove from cache
  for (const [pid, session] of sessionCache) {
    if (session.sessionId === sessionId) {
      sessionCache.delete(pid);
      break;
    }
  }
}

/**
 * Get cached session for a project (if any).
 */
export function getCachedSession(projectId: string): CloudPreviewSession | undefined {
  return sessionCache.get(projectId);
}
