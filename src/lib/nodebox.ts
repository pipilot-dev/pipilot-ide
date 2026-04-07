import { Nodebox } from "@codesandbox/nodebox";
import { db } from "./db";

let _instance: Nodebox | null = null;
let _bootPromise: Promise<Nodebox> | null = null;
let _iframeEl: HTMLIFrameElement | null = null;

/**
 * Get or boot the Nodebox singleton.
 * Nodebox runs Node.js in the browser via a hidden iframe — no special headers needed.
 */
export async function getNodebox(): Promise<Nodebox> {
  if (_instance) return _instance;
  if (_bootPromise) return _bootPromise;

  _bootPromise = (async () => {
    // Create a hidden iframe for Nodebox runtime
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden;";
    document.body.appendChild(iframe);
    _iframeEl = iframe;

    const nodebox = new Nodebox({ iframe });
    await nodebox.connect();
    _instance = nodebox;
    return nodebox;
  })();

  return _bootPromise;
}

export function isNodeboxBooted(): boolean {
  return _instance !== null;
}

/**
 * Sync project files from IndexedDB into the Nodebox filesystem.
 * Uses fs.init() for bulk initialization with a flat file map.
 */
export async function syncFilesToNodebox(
  nodebox: Nodebox,
  projectId: string
): Promise<number> {
  const files = await db.files
    .where("projectId")
    .equals(projectId)
    .and((f) => f.type === "file" && !!f.content)
    .toArray();

  // Build flat file map: { "/index.html": "content", "/src/app.js": "content" }
  const fileMap: Record<string, string> = {};
  for (const file of files) {
    const filePath = file.id.startsWith("/") ? file.id : `/${file.id}`;
    fileMap[filePath] = file.content || "";
  }

  // Initialize the entire filesystem at once
  await nodebox.fs.init(fileMap);

  return files.length;
}

export function disposeNodebox() {
  _instance = null;
  _bootPromise = null;
  if (_iframeEl) {
    _iframeEl.remove();
    _iframeEl = null;
  }
}
