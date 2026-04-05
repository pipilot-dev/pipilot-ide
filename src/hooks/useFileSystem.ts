import { useState, useCallback, useEffect } from "react";
import { db, DBFile, fileOps, seedDatabaseIfEmpty } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";
import { useLiveQuery } from "dexie-react-hooks";

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  language?: string;
  content?: string;
  children?: FileNode[];
  expanded?: boolean;
}

export interface FileChangeEvent {
  type: "create" | "edit" | "delete";
  path: string;
  timestamp: Date;
}

// Convert flat DB files into a tree structure
function buildTree(files: DBFile[]): FileNode[] {
  const rootFiles = files.filter((f) => f.parentPath === "");
  return buildChildren(rootFiles, files);
}

function buildChildren(nodes: DBFile[], allFiles: DBFile[]): FileNode[] {
  return nodes
    .map((node) => {
      const fileNode: FileNode = {
        id: node.id,
        name: node.name,
        type: node.type,
        language: node.language,
        content: node.content,
      };

      if (node.type === "folder") {
        const children = allFiles.filter((f) => f.parentPath === node.id);
        fileNode.children = buildChildren(children, allFiles);
        fileNode.expanded = true;
      }

      return fileNode;
    })
    .sort((a, b) => {
      // Folders first, then alphabetical
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function useFileSystem() {
  const [isReady, setIsReady] = useState(false);
  const [changeLog, setChangeLog] = useState<FileChangeEvent[]>([]);
  const { activeProjectId } = useActiveProject();

  // Seed database on first load
  useEffect(() => {
    seedDatabaseIfEmpty().then(() => setIsReady(true));
  }, []);

  // Live query - scoped to active project
  const dbFiles = useLiveQuery(
    () => db.files.where("projectId").equals(activeProjectId).toArray(),
    [activeProjectId]
  ) ?? [];

  // Build tree from flat files
  const files: FileNode[] = isReady ? buildTree(dbFiles) : [];

  // Tool executor that works with IndexedDB
  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<string> => {
      let result: string;

      switch (name) {
        case "read_file":
          result = await fileOps.readFile(
            args.path as string,
            args.startLine as number | undefined,
            args.endLine as number | undefined,
            activeProjectId
          );
          break;
        case "list_files": {
          const listing = await fileOps.listFiles(
            args.path as string,
            args.offset as number | undefined,
            activeProjectId
          );
          const formatted = listing.items.map((f) => ({
            name: f.name,
            type: f.type,
            ...(f.type === "file" ? { lines: f.content ? f.content.split("\n").length : 0 } : {}),
          }));
          result = JSON.stringify(formatted, null, 2);
          if (listing.hasMore) {
            result += `\n\n[Showing ${listing.items.length} of ${listing.total} items. Use offset: ${(args.offset as number ?? 0) + listing.items.length} to see more.]`;
          }
          break;
        }
        case "edit_file":
          result = await fileOps.editFile(
            args.path as string,
            args.search as string | undefined,
            args.replace as string | undefined,
            args.newContent as string | undefined,
            activeProjectId
          );
          setChangeLog((prev) => [...prev, { type: "edit", path: args.path as string, timestamp: new Date() }]);
          break;
        case "create_file":
          result = await fileOps.createFile(args.path as string, args.content as string, activeProjectId);
          setChangeLog((prev) => [...prev, { type: "create", path: args.path as string, timestamp: new Date() }]);
          break;
        case "delete_file":
          result = await fileOps.deleteFile(args.path as string, activeProjectId);
          setChangeLog((prev) => [...prev, { type: "delete", path: args.path as string, timestamp: new Date() }]);
          break;
        case "search_files":
          result = await fileOps.searchFiles(
            args.query as string,
            args.path as string | undefined,
            args.searchContents as boolean | undefined,
            activeProjectId
          );
          break;
        case "get_file_info":
          result = await fileOps.getFileInfo(args.path as string, activeProjectId);
          break;
        case "rename_file":
          result = await fileOps.renameFile(
            args.oldPath as string,
            args.newPath as string,
            activeProjectId
          );
          setChangeLog((prev) => [...prev, { type: "edit", path: args.newPath as string, timestamp: new Date() }]);
          break;
        case "copy_file":
          result = await fileOps.copyFile(
            args.srcPath as string,
            args.destPath as string,
            activeProjectId
          );
          setChangeLog((prev) => [...prev, { type: "create", path: args.destPath as string, timestamp: new Date() }]);
          break;
        case "batch_create_files": {
          const files = args.files as { path: string; content: string }[];
          result = await fileOps.batchCreateFiles(files, activeProjectId);
          for (const f of files) {
            setChangeLog((prev) => [...prev, { type: "create", path: f.path, timestamp: new Date() }]);
          }
          break;
        }
        case "get_project_tree":
          result = await fileOps.getProjectTree(args.path as string | undefined, activeProjectId);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return result;
    },
    [activeProjectId]
  );

  // Direct file operations for the editor
  const updateFileContent = useCallback(async (path: string, content: string) => {
    await db.files.update(path, { content, updatedAt: new Date() });
  }, []);

  const getFileContent = useCallback(async (path: string): Promise<string> => {
    return fileOps.readFile(path);
  }, []);

  return {
    files,
    isReady,
    changeLog,
    executeTool,
    updateFileContent,
    getFileContent,
    activeProjectId,
  };
}
