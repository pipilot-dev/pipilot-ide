import JSZip from "jszip";
import { db, DBFile, LANG_MAP } from "@/lib/db";

const SKIP_PATTERNS = ["__MACOSX", ".DS_Store", "node_modules"];

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some(
    (pattern) => path.includes(pattern)
  );
}

function detectLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return LANG_MAP[ext] ?? "plaintext";
}

/**
 * Ensure all intermediate folder entries exist in the DB
 * for a given file path. Returns nothing — creates folders as needed.
 */
async function ensureFolders(
  filePath: string,
  projectId: string,
  createdFolders: Set<string>
): Promise<string> {
  const parts = filePath.split("/");
  parts.pop(); // remove the file name

  let parentPath = "";
  for (const part of parts) {
    const dirId = parentPath ? `${parentPath}/${part}` : part;
    if (!createdFolders.has(dirId)) {
      const existing = await db.files.get(dirId);
      if (!existing) {
        const now = new Date();
        await db.files.put({
          id: dirId,
          name: part,
          type: "folder",
          parentPath,
          projectId,
          createdAt: now,
          updatedAt: now,
        } as DBFile);
      }
      createdFolders.add(dirId);
    }
    parentPath = dirId;
  }
  return parentPath;
}

/**
 * Import files from a ZIP archive into the project.
 * Returns the count of files imported.
 */
export async function importFromZip(
  file: File,
  projectId: string
): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const createdFolders = new Set<string>();
  const filesToPut: DBFile[] = [];
  const now = new Date();

  const entries: Array<[string, JSZip.JSZipObject]> = [];
  zip.forEach((relativePath, zipEntry) => {
    entries.push([relativePath, zipEntry]);
  });

  for (const [relativePath, zipEntry] of entries) {
    // Skip directories and filtered patterns
    if (zipEntry.dir) continue;
    if (shouldSkip(relativePath)) continue;

    const content = await zipEntry.async("string");
    const fileName = relativePath.split("/").pop() ?? relativePath;

    // Ensure parent folders exist
    const parentPath = await ensureFolders(
      relativePath,
      projectId,
      createdFolders
    );

    filesToPut.push({
      id: relativePath,
      name: fileName,
      type: "file",
      parentPath,
      projectId,
      language: detectLanguage(fileName),
      content,
      createdAt: now,
      updatedAt: now,
    } as DBFile);
  }

  if (filesToPut.length > 0) {
    await db.files.bulkPut(filesToPut);
  }

  return filesToPut.length;
}

/**
 * Import files from a folder selection (webkitdirectory).
 * Returns the count of files imported.
 */
export async function importFromFolder(
  files: FileList,
  projectId: string
): Promise<number> {
  const createdFolders = new Set<string>();
  const filesToPut: DBFile[] = [];
  const now = new Date();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = (file as File & { webkitRelativePath: string })
      .webkitRelativePath;

    if (!relativePath) continue;

    // Strip the root folder name from the path
    const parts = relativePath.split("/");
    parts.shift(); // remove root folder
    const cleanPath = parts.join("/");

    if (!cleanPath) continue;
    if (shouldSkip(cleanPath)) continue;

    const content = await readFileAsText(file);
    const fileName = parts[parts.length - 1];

    const parentPath = await ensureFolders(
      cleanPath,
      projectId,
      createdFolders
    );

    filesToPut.push({
      id: cleanPath,
      name: fileName,
      type: "file",
      parentPath,
      projectId,
      language: detectLanguage(fileName),
      content,
      createdAt: now,
      updatedAt: now,
    } as DBFile);
  }

  if (filesToPut.length > 0) {
    await db.files.bulkPut(filesToPut);
  }

  return filesToPut.length;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
