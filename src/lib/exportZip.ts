import JSZip from "jszip";
import { saveAs } from "file-saver";
import { db } from "@/lib/db";

/**
 * Export the active project as a downloadable ZIP.
 *
 * Strategy:
 *  1. Try the server endpoint first — it walks the real disk workspace,
 *     supports binary files, and excludes node_modules / .git / build
 *     artifacts.
 *  2. Fall back to IndexedDB if the server is unreachable. Even on the
 *     fallback path we filter out node_modules paths defensively.
 */
export async function exportProjectAsZip(
  projectName: string,
  projectId: string,
): Promise<void> {
  // ── 1. Server-backed export (preferred) ──
  try {
    const res = await fetch(
      `/api/files/zip?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(projectName)}`,
    );
    if (res.ok) {
      const blob = await res.blob();
      saveAs(blob, `${projectName}.zip`);
      return;
    }
    // Non-OK response from server — fall through to IndexedDB
  } catch {
    // Network error — fall through
  }

  // ── 2. IndexedDB fallback ──
  const files = await db.files
    .where("projectId")
    .equals(projectId)
    .toArray();

  // Defensive filter: anything inside node_modules / .git / build
  // shouldn't end up in a user-facing export.
  const SKIP_PREFIXES = [
    "node_modules/", ".git/", "dist/", "build/", ".next/", "out/",
    ".cache/", ".vite/", "coverage/", ".turbo/", ".vercel/",
  ];
  const isExcluded = (id: string) =>
    SKIP_PREFIXES.some((p) => id === p.slice(0, -1) || id.startsWith(p));

  const zip = new JSZip();
  for (const file of files) {
    if (file.type !== "file") continue;
    if (isExcluded(file.id)) continue;
    zip.file(file.id, file.content ?? "");
  }

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `${projectName}.zip`);
}
