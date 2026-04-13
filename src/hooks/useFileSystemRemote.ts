import { useState, useCallback, useEffect, useRef } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { db } from "@/lib/db";
import { capturePreviewScreenshot } from "@/lib/screenshot";
import { previewClick, previewScroll, previewType, previewFindElements } from "@/lib/browser-interact";
import { runScript } from "@/lib/run-script";

// Import types from useFileSystem
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

export function useFileSystemRemote() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [changeLog, setChangeLog] = useState<FileChangeEvent[]>([]);
  const { activeProjectId } = useActiveProject();
  const seededRef = useRef(false);

  // Seed workspace from IndexedDB on first mount
  useEffect(() => {
    if (!activeProjectId || seededRef.current) return;

    async function seed() {
      try {
        // Collect files from IndexedDB
        const dbFiles = await db.files
          .where("projectId")
          .equals(activeProjectId)
          .and((f) => f.type === "file" && !!f.content)
          .toArray();

        const filesToSeed = dbFiles.map((f) => ({
          path: f.id,
          content: f.content || "",
        }));

        // Seed the server workspace (idempotent — won't overwrite if exists)
        await fetch("/api/files/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProjectId, files: filesToSeed }),
        });

        seededRef.current = true;
      } catch (err) {
        console.error("[useFileSystemRemote] Seed failed:", err);
      }
    }

    seed();
  }, [activeProjectId]);

  // Connect to SSE file watcher for real-time updates
  useEffect(() => {
    if (!activeProjectId) return;

    let eventSource: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      eventSource = new EventSource(`/api/files/watch?projectId=${encodeURIComponent(activeProjectId)}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "tree" && data.files) {
            setFiles(data.files);
            if (!isReady) setIsReady(true);
          }
          // Ignore heartbeat
        } catch {}
      };

      eventSource.onerror = () => {
        // Reconnect after 3 seconds on error
        eventSource?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(retryTimeout);
    };
  }, [activeProjectId]);

  // Update file content via server API
  const updateFileContent = useCallback(async (filePath: string, content: string) => {
    try {
      await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, path: filePath, content }),
      });
    } catch (err) {
      console.error("[useFileSystemRemote] Write failed:", err);
    }
  }, [activeProjectId]);

  // Read file content via server API
  const getFileContent = useCallback(async (filePath: string): Promise<string> => {
    try {
      const res = await fetch(`/api/files/read?projectId=${encodeURIComponent(activeProjectId)}&path=${encodeURIComponent(filePath)}`);
      if (!res.ok) return "";
      const data = await res.json();
      return data.content || "";
    } catch {
      return "";
    }
  }, [activeProjectId]);

  /**
   * Lazy-load the children of a folder (used for `node_modules` and any
   * subfolder under it). Replaces the placeholder children in the tree
   * with the real listing and clears the `lazy` flag so it isn't
   * re-fetched on subsequent toggles.
   */
  const loadFolderChildren = useCallback(async (folderPath: string): Promise<void> => {
    try {
      const res = await fetch(
        `/api/files/list-dir?projectId=${encodeURIComponent(activeProjectId)}&path=${encodeURIComponent(folderPath)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const children: FileNode[] = data.children || [];

      // Walk the tree and replace the matching folder's children
      function patch(nodes: FileNode[]): FileNode[] {
        return nodes.map((n) => {
          if (n.id === folderPath) {
            return { ...n, children, lazy: false };
          }
          if (n.children) {
            return { ...n, children: patch(n.children) };
          }
          return n;
        });
      }
      setFiles((prev) => patch(prev));
    } catch (err) {
      console.error("[useFileSystemRemote] loadFolderChildren failed:", err);
    }
  }, [activeProjectId]);

  // Tool executor — file ops go to server, browser tools stay client-side
  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<string> => {
      // Browser-side tools (screenshot, preview interaction)
      switch (name) {
        case "screenshot_preview": {
          const screenshot = await capturePreviewScreenshot(activeProjectId);
          return screenshot.dataUrl + "\n\n" + screenshot.layoutReport;
        }
        case "preview_click": {
          const result = await previewClick(activeProjectId, args as any);
          return result.dataUrl + "\n\n" + result.report;
        }
        case "preview_scroll": {
          const result = await previewScroll(activeProjectId, args as any);
          return result.dataUrl + "\n\n" + result.report;
        }
        case "preview_type": {
          const result = await previewType(activeProjectId, args as any);
          return result.dataUrl + "\n\n" + result.report;
        }
        case "preview_find_elements": {
          const result = await previewFindElements(activeProjectId, args as any);
          return result.dataUrl + "\n\n" + result.report;
        }
        case "run_script": {
          const result = await runScript(args.code as string, activeProjectId, {
            filename: args.filename as string | undefined,
            timeout: args.timeout as number | undefined,
          });
          const parts: string[] = [];
          if (result.stdout) parts.push(`=== STDOUT ===\n${result.stdout}`);
          if (result.stderr) parts.push(`=== STDERR ===\n${result.stderr}`);
          if (result.error) parts.push(`=== ERROR ===\n${result.error}`);
          if (!result.stdout && !result.stderr && !result.error) parts.push("(no output)");
          parts.push(`\nExit code: ${result.exitCode}`);
          return parts.join("\n\n");
        }

        // File operations — delegate to server API
        case "read_file": {
          const content = await getFileContent(args.path as string);
          return content || `File not found: ${args.path}`;
        }
        case "create_file":
        case "write_file": {
          await updateFileContent(args.path as string, (args.content as string) || "");
          setChangeLog(prev => [...prev, { type: "create", path: args.path as string, timestamp: new Date() }]);
          return `Created: ${args.path}`;
        }
        case "edit_file": {
          if (args.newContent) {
            await updateFileContent(args.path as string, args.newContent as string);
          } else if (args.search && args.replace !== undefined) {
            const content = await getFileContent(args.path as string);
            const newContent = content.replace(args.search as string, args.replace as string);
            await updateFileContent(args.path as string, newContent);
          }
          setChangeLog(prev => [...prev, { type: "edit", path: args.path as string, timestamp: new Date() }]);
          return `Edited: ${args.path}`;
        }
        case "delete_file": {
          await fetch(`/api/files?projectId=${encodeURIComponent(activeProjectId)}&path=${encodeURIComponent(args.path as string)}`, { method: "DELETE" });
          setChangeLog(prev => [...prev, { type: "delete", path: args.path as string, timestamp: new Date() }]);
          return `Deleted: ${args.path}`;
        }
        case "list_files": {
          // Read from current tree state
          const listPath = (args.path as string) || "";
          const findInTree = (nodes: FileNode[], targetPath: string): FileNode[] => {
            if (!targetPath) return nodes;
            for (const node of nodes) {
              if (node.id === targetPath && node.children) return node.children;
              if (node.children) {
                const found = findInTree(node.children, targetPath);
                if (found.length) return found;
              }
            }
            return [];
          };
          const items = findInTree(files, listPath);
          return JSON.stringify(items.map(f => ({ name: f.name, type: f.type })), null, 2);
        }
        case "get_project_tree": {
          // Build text tree from current state
          const buildTextTree = (nodes: FileNode[], prefix: string = ""): string => {
            return nodes.map((n, i) => {
              const isLast = i === nodes.length - 1;
              const connector = isLast ? "└── " : "├── ";
              const line = `${prefix}${connector}${n.name}${n.type === "folder" ? "/" : ""}`;
              if (n.children && n.children.length > 0) {
                return line + "\n" + buildTextTree(n.children, prefix + (isLast ? "    " : "│   "));
              }
              return line;
            }).join("\n");
          };
          return ".\n" + buildTextTree(files);
        }
        case "batch_create_files": {
          let filesList = args.files as any[];
          if (typeof filesList === "string") {
            try { filesList = JSON.parse(filesList); } catch { return "Error: invalid files JSON"; }
          }
          for (const f of filesList) {
            await updateFileContent(f.path, f.content || "");
          }
          setChangeLog(prev => [...prev, ...filesList.map((f: any) => ({ type: "create" as const, path: f.path, timestamp: new Date() }))]);
          return `Created ${filesList.length} files`;
        }
        case "rename_file": {
          await fetch("/api/files/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: activeProjectId, oldPath: args.oldPath, newPath: args.newPath }),
          });
          return `Renamed: ${args.oldPath} → ${args.newPath}`;
        }
        case "search_files": {
          const query = (args.query as string || "").toLowerCase();
          const results: string[] = [];
          const searchTree = (nodes: FileNode[]) => {
            for (const n of nodes) {
              if (n.name.toLowerCase().includes(query)) results.push(n.id);
              if (args.searchContents && n.content?.toLowerCase().includes(query)) {
                results.push(`${n.id} (content match)`);
              }
              if (n.children) searchTree(n.children);
            }
          };
          searchTree(files);
          return results.length > 0 ? results.join("\n") : "No matches found";
        }
        case "research_search": {
          const { searchWeb, formatSearchResults } = await import("@/lib/research");
          const query = args.query as string;
          if (!query) return "Error: query is required";
          const results = await searchWeb(query);
          return formatSearchResults(results);
        }
        case "research_extract": {
          const { extractUrl, formatExtractedContent } = await import("@/lib/research");
          const url = args.url as string;
          if (!url) return "Error: url is required";
          const content = await extractUrl(url);
          return formatExtractedContent(content);
        }
        default:
          return `Unknown tool: ${name}`;
      }
    },
    [activeProjectId, files, getFileContent, updateFileContent]
  );

  return {
    files,
    isReady,
    changeLog,
    executeTool,
    updateFileContent,
    getFileContent,
    loadFolderChildren,
    activeProjectId,
  };
}
