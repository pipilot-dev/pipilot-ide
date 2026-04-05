import Dexie, { type EntityTable } from "dexie";

// Database schema for the IDE workspace
export interface DBFile {
  id: string;           // path acts as primary key (e.g. "src/App.tsx")
  name: string;
  type: "file" | "folder";
  parentPath: string;   // parent directory path ("" for root)
  language?: string;
  content?: string;
  projectId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DBChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: string;       // JSON serialized
  builtinToolStatuses?: string; // JSON serialized
  tool_call_id?: string;
  sessionId: string;
  timestamp: Date;
}

export interface DBChatSession {
  id: string;
  name: string;
  projectId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DBSetting {
  key: string;
  value: string;
}

export interface DBProject {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DBCheckpoint {
  id: string;
  projectId: string;
  label: string;
  snapshot: string; // JSON-serialized DBFile[]
  createdAt: Date;
  messageId?: string; // ID of the user message this checkpoint is tied to
}

// Shared language map for file extensions
export const LANG_MAP: Record<string, string> = {
  tsx: "typescript", jsx: "typescript", ts: "typescript", js: "javascript",
  mjs: "javascript", cjs: "javascript", mts: "typescript", cts: "typescript",
  json: "json", jsonc: "json", json5: "json",
  md: "markdown", mdx: "markdown",
  css: "css", scss: "scss", sass: "scss", less: "less",
  html: "html", htm: "html", svg: "xml", xml: "xml",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  py: "python", pyw: "python", pyi: "python",
  go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
  c: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", fs: "fsharp",
  rb: "ruby", php: "php", swift: "swift", m: "objective-c",
  sql: "sql", graphql: "graphql", gql: "graphql",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", conf: "ini",
  dockerfile: "dockerfile", makefile: "makefile",
  lua: "lua", r: "r", dart: "dart", scala: "scala",
  vue: "html", svelte: "html", astro: "html",
  tf: "hcl", hcl: "hcl",
  prisma: "prisma", proto: "protobuf",
  txt: "plaintext", log: "plaintext", env: "shell",
};

class PiPilotDB extends Dexie {
  files!: EntityTable<DBFile, "id">;
  chatMessages!: EntityTable<DBChatMessage, "id">;
  chatSessions!: EntityTable<DBChatSession, "id">;
  settings!: EntityTable<DBSetting, "key">;
  projects!: EntityTable<DBProject, "id">;
  checkpoints!: EntityTable<DBCheckpoint, "id">;

  constructor() {
    super("pipilot-ide");

    this.version(1).stores({
      files: "id, parentPath, name, type",
      chatMessages: "id, sessionId, timestamp",
      chatSessions: "id, updatedAt",
      settings: "key",
    });

    this.version(2).stores({
      files: "id, parentPath, name, type, projectId",
      chatMessages: "id, sessionId, timestamp",
      chatSessions: "id, updatedAt, projectId",
      settings: "key",
      projects: "id",
      checkpoints: "id, projectId, createdAt",
    }).upgrade(async (tx) => {
      const defaultProjectId = "default-project";
      const now = new Date();

      // Create default project
      await tx.table("projects").put({
        id: defaultProjectId,
        name: "My Project",
        createdAt: now,
        updatedAt: now,
      });

      // Update all existing files to belong to default project
      await tx.table("files").toCollection().modify((file: DBFile) => {
        file.projectId = defaultProjectId;
      });

      // Update all existing chat sessions to belong to default project
      await tx.table("chatSessions").toCollection().modify((session: DBChatSession) => {
        session.projectId = defaultProjectId;
      });
    });
  }
}

export const db = new PiPilotDB();

// Helper to seed the database with sample project files if empty
export async function seedDatabaseIfEmpty() {
  const defaultProjectId = "default-project";
  const now = new Date();

  // Ensure the default project exists
  const projectCount = await db.projects.count();
  if (projectCount === 0) {
    await db.projects.put({
      id: defaultProjectId,
      name: "My Project",
      createdAt: now,
      updatedAt: now,
    });
  }

  const count = await db.files.count();
  if (count > 0) return false;

  const { SAMPLE_PROJECT } = await import("@/data/sampleFiles");

  const flatFiles: DBFile[] = [];

  function flatten(nodes: { id: string; name: string; type: "file" | "folder"; language?: string; content?: string; children?: typeof nodes }[], parentPath: string) {
    for (const node of nodes) {
      flatFiles.push({
        id: node.id,
        name: node.name,
        type: node.type,
        parentPath,
        language: node.language,
        content: node.content,
        projectId: defaultProjectId,
        createdAt: now,
        updatedAt: now,
      });
      if (node.children) {
        flatten(node.children, node.id);
      }
    }
  }

  flatten(SAMPLE_PROJECT, "");
  await db.files.bulkPut(flatFiles);

  // Create default chat session
  await db.chatSessions.put({
    id: "default",
    name: "New Chat",
    projectId: defaultProjectId,
    createdAt: now,
    updatedAt: now,
  });

  // Set default active project
  await db.settings.put({ key: "activeProjectId", value: defaultProjectId });

  return true;
}

// Constants — generous limits for power users
const MAX_READ_LINES = 500;
const MAX_LIST_ITEMS = 200;
const MAX_SEARCH_RESULTS = 50;

// File operations on IndexedDB
export const fileOps = {
  /**
   * Read file with line-range support. Default: first 150 lines.
   * If the file is larger than 150 lines and no range is given,
   * returns the first 150 lines + a warning telling the AI to use ranges.
   */
  async readFile(
    path: string,
    startLine?: number,
    endLine?: number,
    projectId?: string
  ): Promise<string> {
    const file = await db.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    if (file.type === "folder") throw new Error(`Cannot read directory: ${path}`);
    if (projectId && file.projectId && file.projectId !== projectId) {
      throw new Error(`File ${path} belongs to a different project`);
    }

    const content = file.content ?? "";
    const allLines = content.split("\n");
    const totalLines = allLines.length;

    // If a range was specified, use it
    if (startLine !== undefined || endLine !== undefined) {
      const start = Math.max(0, (startLine ?? 1) - 1); // 1-indexed to 0-indexed
      const end = Math.min(totalLines, endLine ?? totalLines);
      const sliced = allLines.slice(start, end);
      const numbered = sliced.map((line, i) => `${start + i + 1} | ${line}`);
      let result = numbered.join("\n");
      if (end < totalLines) {
        result += `\n\n[Showing lines ${start + 1}-${end} of ${totalLines} total. Use startLine/endLine to read more.]`;
      }
      return result;
    }

    // No range: auto-limit to MAX_READ_LINES
    if (totalLines <= MAX_READ_LINES) {
      // Small file — return everything with line numbers
      return allLines.map((line, i) => `${i + 1} | ${line}`).join("\n");
    }

    // Large file — return first MAX_READ_LINES with a warning
    const sliced = allLines.slice(0, MAX_READ_LINES);
    const numbered = sliced.map((line, i) => `${i + 1} | ${line}`);
    return (
      numbered.join("\n") +
      `\n\n⚠️ FILE TRUNCATED: Showing first ${MAX_READ_LINES} of ${totalLines} lines. ` +
      `Use startLine/endLine parameters to read specific ranges (e.g. startLine: ${MAX_READ_LINES + 1}, endLine: ${Math.min(totalLines, MAX_READ_LINES * 2)}).`
    );
  },

  /**
   * List files — limited to MAX_LIST_ITEMS entries per call.
   * Returns name, type, and child count for folders.
   */
  async listFiles(path: string, offset?: number, projectId?: string): Promise<{ items: DBFile[]; total: number; hasMore: boolean }> {
    const parentPath = (!path || path === "/" || path === ".") ? "" : path;
    let query = db.files.where("parentPath").equals(parentPath);
    let allItems = await query.toArray();
    if (projectId) {
      allItems = allItems.filter((f) => f.projectId === projectId);
    }
    const total = allItems.length;
    const start = offset ?? 0;
    const items = allItems.slice(start, start + MAX_LIST_ITEMS);
    return { items, total, hasMore: start + MAX_LIST_ITEMS < total };
  },

  /**
   * Edit file — returns only status message, never file content.
   */
  async editFile(path: string, search?: string, replace?: string, newContent?: string, projectId?: string): Promise<string> {
    const file = await db.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    if (file.type === "folder") throw new Error(`Cannot edit directory: ${path}`);
    if (projectId && file.projectId && file.projectId !== projectId) {
      throw new Error(`File ${path} belongs to a different project`);
    }

    const currentContent = file.content ?? "";
    const currentLineCount = currentContent.split("\n").length;
    let updatedContent: string;

    if (search !== undefined && replace !== undefined) {
      // Search/replace takes priority — never accidentally overwrite the whole file
      if (!currentContent.includes(search)) {
        throw new Error(
          `Search string not found in ${path}. ` +
          `File has ${currentLineCount} lines. Use read_file to verify the exact content before editing.`
        );
      }
      updatedContent = currentContent.replace(search, replace);
    } else if (newContent !== undefined) {
      updatedContent = newContent;
    } else {
      throw new Error("Must provide either newContent or search/replace");
    }

    const newLineCount = updatedContent.split("\n").length;
    await db.files.update(path, { content: updatedContent, updatedAt: new Date() });

    return `✓ File edited: ${path} (${currentLineCount} → ${newLineCount} lines)`;
  },

  /**
   * Create file — returns only status message, never file content.
   */
  async createFile(path: string, content: string = "", projectId?: string): Promise<string> {
    const existing = await db.files.get(path);
    if (existing) {
      // Guard: don't overwrite files from other projects
      if (projectId && existing.projectId && existing.projectId !== projectId) {
        throw new Error(`File ${path} belongs to a different project`);
      }
      // Overwrite existing file content within same project
      const lineCount = content.split("\n").length;
      await db.files.update(path, { content, updatedAt: new Date() });
      return `✓ File updated: ${path} (${lineCount} lines, ${content.length} chars)`;
    }

    const parts = path.replace(/^\//, "").split("/");
    const fileName = parts.pop()!;
    let parentPath = "";

    for (const part of parts) {
      const dirId = parentPath ? `${parentPath}/${part}` : part;
      const existingDir = await db.files.get(dirId);
      if (!existingDir) {
        await db.files.put({
          id: dirId,
          name: part,
          type: "folder",
          parentPath,
          projectId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      parentPath = dirId;
    }

    const ext = fileName.split(".").pop()?.toLowerCase();

    const lineCount = content.split("\n").length;

    await db.files.put({
      id: path,
      name: fileName,
      type: "file",
      parentPath,
      language: LANG_MAP[ext ?? ""] ?? "plaintext",
      content,
      projectId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return `✓ File created: ${path} (${lineCount} lines, ${content.length} chars)`;
  },

  async deleteFile(path: string, projectId?: string): Promise<string> {
    const file = await db.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    if (projectId && file.projectId && file.projectId !== projectId) {
      throw new Error(`File ${path} belongs to a different project`);
    }

    if (file.type === "folder") {
      const children = await db.files.where("parentPath").equals(path).toArray();
      for (const child of children) {
        await fileOps.deleteFile(child.id);
      }
    }

    await db.files.delete(path);
    return `✓ Deleted: ${path}`;
  },

  /**
   * Search files — limited to MAX_SEARCH_RESULTS results.
   * Content matches show line numbers.
   */
  async searchFiles(query: string, searchPath?: string, searchContents?: boolean, projectId?: string): Promise<string> {
    let allFiles = await db.files.where("type").equals("file").toArray();

    if (projectId) {
      allFiles = allFiles.filter((f) => f.projectId === projectId);
    }

    if (searchPath && searchPath !== "/" && searchPath !== ".") {
      const normalizedPath = searchPath.replace(/^\//, "");
      allFiles = allFiles.filter(
        (f) => f.id.startsWith(normalizedPath) || f.parentPath.startsWith(normalizedPath)
      );
    }

    const results: { path: string; lineCount?: number; matches?: { line: number; text: string }[] }[] = [];

    for (const file of allFiles) {
      if (results.length >= MAX_SEARCH_RESULTS) break;

      if (searchContents) {
        const content = file.content ?? "";
        const lines = content.split("\n");
        const matchingLines: { line: number; text: string }[] = [];
        for (let i = 0; i < lines.length && matchingLines.length < 3; i++) {
          if (lines[i].toLowerCase().includes(query.toLowerCase())) {
            matchingLines.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
          }
        }
        if (matchingLines.length > 0) {
          results.push({ path: file.id, lineCount: lines.length, matches: matchingLines });
        }
      } else {
        if (file.name.toLowerCase().includes(query.toLowerCase())) {
          const lineCount = file.content ? file.content.split("\n").length : 0;
          results.push({ path: file.id, lineCount });
        }
      }
    }

    const totalFiles = allFiles.length;
    let output = JSON.stringify(results, null, 2);
    if (results.length >= MAX_SEARCH_RESULTS) {
      output += `\n\n[Results capped at ${MAX_SEARCH_RESULTS}. Narrow your query or specify a path to search within.]`;
    }
    return output;
  },

  /**
   * Rename/move a file or folder to a new path.
   */
  async renameFile(oldPath: string, newPath: string, projectId?: string): Promise<string> {
    const file = await db.files.get(oldPath);
    if (!file) throw new Error(`File not found: ${oldPath}`);
    if (projectId && file.projectId && file.projectId !== projectId) {
      throw new Error(`File ${oldPath} belongs to a different project`);
    }
    const existing = await db.files.get(newPath);
    if (existing) throw new Error(`Target path already exists: ${newPath}`);

    const newParts = newPath.replace(/^\//, "").split("/");
    const newName = newParts.pop()!;
    const newParent = newParts.join("/");

    // Ensure parent dirs exist
    let parentPath = "";
    for (const part of newParts) {
      const dirId = parentPath ? `${parentPath}/${part}` : part;
      const existingDir = await db.files.get(dirId);
      if (!existingDir) {
        await db.files.put({
          id: dirId, name: part, type: "folder", parentPath,
          projectId, createdAt: new Date(), updatedAt: new Date(),
        });
      }
      parentPath = dirId;
    }

    if (file.type === "folder") {
      // Move all children recursively
      const children = await db.files.where("parentPath").equals(oldPath).toArray();
      for (const child of children) {
        const childNewPath = `${newPath}/${child.name}`;
        await fileOps.renameFile(child.id, childNewPath, projectId);
      }
    }

    await db.files.put({
      ...file, id: newPath, name: newName, parentPath: newParent, updatedAt: new Date(),
    });
    await db.files.delete(oldPath);

    return `✓ Renamed: ${oldPath} → ${newPath}`;
  },

  /**
   * Copy a file to a new path.
   */
  async copyFile(srcPath: string, destPath: string, projectId?: string): Promise<string> {
    const file = await db.files.get(srcPath);
    if (!file) throw new Error(`File not found: ${srcPath}`);
    if (file.type === "folder") throw new Error(`Cannot copy directory (yet): ${srcPath}`);

    return await fileOps.createFile(destPath, file.content ?? "", projectId);
  },

  /**
   * Batch create multiple files in one call. Returns summary.
   */
  async batchCreateFiles(files: { path: string; content: string }[], projectId?: string): Promise<string> {
    const results: string[] = [];
    for (const f of files) {
      try {
        const result = await fileOps.createFile(f.path, f.content, projectId);
        results.push(result);
      } catch (err) {
        results.push(`✗ Failed: ${f.path} — ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }
    return results.join("\n");
  },

  /**
   * Get a tree view of the entire project structure.
   */
  async getProjectTree(basePath?: string, projectId?: string): Promise<string> {
    let allFiles = await db.files.toArray();
    if (projectId) {
      allFiles = allFiles.filter((f) => f.projectId === projectId);
    }
    if (basePath && basePath !== "/" && basePath !== ".") {
      allFiles = allFiles.filter((f) => f.id === basePath || f.id.startsWith(basePath + "/"));
    }

    // Build tree structure
    allFiles.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

    const lines: string[] = [];
    const rootPath = basePath && basePath !== "/" && basePath !== "." ? basePath : "";

    function buildTree(parentPath: string, prefix: string) {
      const children = allFiles.filter((f) => f.parentPath === parentPath);
      children.forEach((child, idx) => {
        const isLast = idx === children.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const suffix = child.type === "folder" ? "/" : "";
        const lineCount = child.type === "file" && child.content ? ` (${child.content.split("\n").length}L)` : "";
        lines.push(`${prefix}${connector}${child.name}${suffix}${lineCount}`);
        if (child.type === "folder") {
          const newPrefix = prefix + (isLast ? "    " : "│   ");
          buildTree(child.id, newPrefix);
        }
      });
    }

    lines.push(rootPath || ".");
    buildTree(rootPath, "");
    return lines.join("\n");
  },

  async getFileInfo(path: string, projectId?: string): Promise<string> {
    const file = await db.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    if (projectId && file.projectId && file.projectId !== projectId) {
      throw new Error(`File ${path} belongs to a different project`);
    }

    let childCount: number | undefined;
    if (file.type === "folder") {
      childCount = await db.files.where("parentPath").equals(path).count();
    }

    const lineCount = file.content ? file.content.split("\n").length : 0;

    return JSON.stringify({
      name: file.name,
      type: file.type,
      language: file.language,
      lines: lineCount,
      sizeBytes: file.content?.length ?? 0,
      children: childCount,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }, null, 2);
  },
};
