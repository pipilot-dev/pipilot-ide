import { useState, useCallback, useEffect } from "react";
import { db, DBFile, fileOps, seedDatabaseIfEmpty } from "@/lib/db";
import { capturePreviewScreenshot } from "@/lib/screenshot";
import { previewClick, previewScroll, previewType, previewFindElements } from "@/lib/browser-interact";
import { runScript } from "@/lib/run-script";
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
        case "screenshot_preview": {
          // Returns both a base64 image (for UI display) and a text layout analysis (for the AI)
          const screenshot = await capturePreviewScreenshot(activeProjectId);
          // Prefix the data URL so the chat hook can detect it for vision API + UI display
          // The layout report is the main content the AI always receives (works without vision API)
          result = screenshot.dataUrl + "\n\n" + screenshot.layoutReport;
          break;
        }
        case "preview_click": {
          const clickResult = await previewClick(activeProjectId, {
            selector: args.selector as string | undefined,
            x: args.x as number | undefined,
            y: args.y as number | undefined,
          });
          result = clickResult.dataUrl + "\n\n" + clickResult.report;
          break;
        }
        case "preview_scroll": {
          const scrollResult = await previewScroll(activeProjectId, {
            direction: args.direction as "up" | "down" | "left" | "right",
            amount: args.amount as number | undefined,
            selector: args.selector as string | undefined,
          });
          result = scrollResult.dataUrl + "\n\n" + scrollResult.report;
          break;
        }
        case "preview_type": {
          const typeResult = await previewType(activeProjectId, {
            selector: args.selector as string,
            text: args.text as string,
            clear: args.clear as boolean | undefined,
            pressEnter: args.pressEnter as boolean | undefined,
          });
          result = typeResult.dataUrl + "\n\n" + typeResult.report;
          break;
        }
        case "preview_find_elements": {
          const findResult = await previewFindElements(activeProjectId, {
            type: args.type as "clickable" | "input" | "text" | "all" | undefined,
            selector: args.selector as string | undefined,
          });
          result = findResult.dataUrl + "\n\n" + findResult.report;
          break;
        }
        case "run_script": {
          const scriptResult = await runScript(
            args.code as string,
            activeProjectId,
            {
              filename: args.filename as string | undefined,
              timeout: args.timeout as number | undefined,
            }
          );
          const parts: string[] = [];
          if (scriptResult.stdout) parts.push(`=== STDOUT ===\n${scriptResult.stdout}`);
          if (scriptResult.stderr) parts.push(`=== STDERR ===\n${scriptResult.stderr}`);
          if (scriptResult.error) parts.push(`=== ERROR ===\n${scriptResult.error}`);
          if (!scriptResult.stdout && !scriptResult.stderr && !scriptResult.error) {
            parts.push("(no output)");
          }
          parts.push(`\nExit code: ${scriptResult.exitCode}`);
          result = parts.join("\n\n");
          break;
        }
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
