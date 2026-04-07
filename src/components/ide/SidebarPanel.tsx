import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { FileNode } from "@/hooks/useFileSystem";
import { FileTree } from "./FileTree";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ActivityBarView } from "./ActivityBar";
import {
  Search,
  GitBranch,
  GitCommit,
  Package,
  Bug,
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  FileText,
  Replace,
  Plus,
  Minus,
  Check,
  RefreshCw,
  History,
} from "lucide-react";
import { exportProjectAsZip } from "@/lib/exportZip";
import { importFromZip, importFromFolder } from "@/lib/importFiles";
import { useActiveProject } from "@/contexts/ProjectContext";
import { ExtensionMarketplace } from "@/components/extensions/ExtensionMarketplace";
import { ExtensionSidebarHost } from "@/components/extensions/ExtensionSidebarHost";
import { RunDebugPanel } from "@/components/ide/RunDebugPanel";
import { useProjects } from "@/hooks/useProjects";
import { db, fileOps, LANG_MAP } from "@/lib/db";
import { useGit, type FileStatus } from "@/hooks/useGit";

// --- Search types ---
type SearchMode = "filename" | "content";

interface ContentMatch {
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchResult {
  fileId: string;
  fileName: string;
  filePath: string;
  matches: ContentMatch[]; // empty for filename search
}

// --- Helpers ---

function flattenFileTree(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") result.push(node);
    if (node.children) result.push(...flattenFileTree(node.children));
  }
  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Toggle button component ---
function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className="flex items-center justify-center rounded transition-colors"
      style={{
        width: 22,
        height: 22,
        fontSize: 11,
        fontWeight: 600,
        background: active ? "hsl(220 13% 30%)" : "transparent",
        color: active ? "hsl(220 14% 90%)" : "hsl(220 14% 55%)",
        border: active ? "1px solid hsl(220 13% 40%)" : "1px solid transparent",
      }}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

// --- Main component ---

interface SidebarPanelProps {
  view: ActivityBarView | null;
  selectedFileId: string | null;
  onSelectFile: (node: FileNode) => void;
  files: FileNode[];
  onSearchFiles?: (query: string) => void;
  onRunPreview?: () => void;
}

export function SidebarPanel({ view, selectedFileId, onSelectFile, files, onSearchFiles, onRunPreview }: SidebarPanelProps) {
  const { activeProjectId } = useActiveProject();
  const { activeProject } = useProjects();
  const [searchQuery, setSearchQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // --- Search state ---
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("content");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce the search query by 300ms
  useEffect(() => {
    if (!sidebarSearchQuery.trim()) {
      setDebouncedQuery("");
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(sidebarSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [sidebarSearchQuery]);

  // Perform search when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    async function performSearch() {
      try {
        let allFiles = await db.files.where("type").equals("file").toArray();
        if (activeProjectId) {
          allFiles = allFiles.filter((f) => f.projectId === activeProjectId);
        }

        let pattern: RegExp;
        try {
          if (useRegex) {
            pattern = new RegExp(debouncedQuery, caseSensitive ? "g" : "gi");
          } else {
            pattern = new RegExp(escapeRegExp(debouncedQuery), caseSensitive ? "g" : "gi");
          }
        } catch {
          // Invalid regex - bail out
          if (!cancelled) {
            setSearchResults([]);
            setIsSearching(false);
          }
          return;
        }

        const results: SearchResult[] = [];

        if (searchMode === "filename") {
          for (const file of allFiles) {
            if (results.length >= 50) break;
            if (pattern.test(file.name)) {
              pattern.lastIndex = 0;
              results.push({
                fileId: file.id,
                fileName: file.name,
                filePath: file.id,
                matches: [],
              });
            }
            pattern.lastIndex = 0;
          }
        } else {
          // Content search
          for (const file of allFiles) {
            if (results.length >= 50) break;
            const content = file.content ?? "";
            if (!content) continue;

            const lines = content.split("\n");
            const matches: ContentMatch[] = [];

            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= 10) break;
              const line = lines[i];
              pattern.lastIndex = 0;
              const match = pattern.exec(line);
              if (match) {
                matches.push({
                  lineNumber: i + 1,
                  lineText: line,
                  matchStart: match.index,
                  matchEnd: match.index + match[0].length,
                });
              }
            }

            if (matches.length > 0) {
              results.push({
                fileId: file.id,
                fileName: file.name,
                filePath: file.id,
                matches,
              });
            }
          }
        }

        if (!cancelled) {
          setSearchResults(results);
          // Auto-expand all results
          setExpandedResults(new Set(results.map((r) => r.fileId)));
          setIsSearching(false);
        }
      } catch (err) {
        console.error("Search error:", err);
        if (!cancelled) {
          setSearchResults([]);
          setIsSearching(false);
        }
      }
    }

    performSearch();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, searchMode, caseSensitive, useRegex, activeProjectId]);

  // Count total matches
  const totalMatchCount = useMemo(() => {
    if (searchMode === "filename") return searchResults.length;
    return searchResults.reduce((sum, r) => sum + r.matches.length, 0);
  }, [searchResults, searchMode]);

  // Handle clicking a search result
  const handleResultClick = useCallback(
    (fileId: string) => {
      // Find the file node in the tree
      const flatFiles = flattenFileTree(files);
      const node = flatFiles.find((f) => f.id === fileId);
      if (node) {
        onSelectFile(node);
      }
    },
    [files, onSelectFile]
  );

  // Toggle expanded state for a result
  const toggleResultExpanded = useCallback((fileId: string) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  // Replace in a single match
  const handleReplace = useCallback(
    async (fileId: string, match: ContentMatch) => {
      try {
        const file = await db.files.get(fileId);
        if (!file || !file.content) return;

        const lines = file.content.split("\n");
        const lineIdx = match.lineNumber - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) return;

        const line = lines[lineIdx];
        let pattern: RegExp;
        if (useRegex) {
          pattern = new RegExp(debouncedQuery, caseSensitive ? "" : "i");
        } else {
          pattern = new RegExp(escapeRegExp(debouncedQuery), caseSensitive ? "" : "i");
        }

        lines[lineIdx] = line.replace(pattern, replaceQuery);
        const newContent = lines.join("\n");

        await db.files.update(fileId, { content: newContent, updatedAt: new Date() });
        // Re-trigger search
        setDebouncedQuery("");
        setTimeout(() => setDebouncedQuery(sidebarSearchQuery), 50);
      } catch (err) {
        console.error("Replace failed:", err);
      }
    },
    [debouncedQuery, replaceQuery, useRegex, caseSensitive, sidebarSearchQuery]
  );

  // Replace all in a single file
  const handleReplaceInFile = useCallback(
    async (fileId: string) => {
      try {
        const file = await db.files.get(fileId);
        if (!file || !file.content) return;

        let pattern: RegExp;
        if (useRegex) {
          pattern = new RegExp(debouncedQuery, caseSensitive ? "g" : "gi");
        } else {
          pattern = new RegExp(escapeRegExp(debouncedQuery), caseSensitive ? "g" : "gi");
        }

        const newContent = file.content.replace(pattern, replaceQuery);
        await db.files.update(fileId, { content: newContent, updatedAt: new Date() });
        // Re-trigger search
        setDebouncedQuery("");
        setTimeout(() => setDebouncedQuery(sidebarSearchQuery), 50);
      } catch (err) {
        console.error("Replace all failed:", err);
      }
    },
    [debouncedQuery, replaceQuery, useRegex, caseSensitive, sidebarSearchQuery]
  );

  // Replace all across all files
  const handleReplaceAll = useCallback(async () => {
    for (const result of searchResults) {
      await handleReplaceInFile(result.fileId);
    }
  }, [searchResults, handleReplaceInFile]);

  // Render a highlighted line preview
  function renderHighlightedLine(match: ContentMatch) {
    const { lineText, matchStart, matchEnd } = match;
    const before = lineText.slice(0, matchStart);
    const matched = lineText.slice(matchStart, matchEnd);
    const after = lineText.slice(matchEnd);

    // Trim long lines for display
    const maxLen = 120;
    const trimmedBefore = before.length > 40 ? "..." + before.slice(-37) : before;
    const trimmedAfter = after.length > (maxLen - trimmedBefore.length - matched.length)
      ? after.slice(0, maxLen - trimmedBefore.length - matched.length) + "..."
      : after;

    return (
      <span className="text-xs" style={{ color: "hsl(220 14% 70%)" }}>
        <span>{trimmedBefore}</span>
        <span
          style={{
            background: "hsl(38 92% 50% / 0.35)",
            color: "hsl(38 100% 80%)",
            borderRadius: 2,
            padding: "0 1px",
          }}
        >
          {matched}
        </span>
        <span>{trimmedAfter}</span>
      </span>
    );
  }

  const handleExport = useCallback(async () => {
    if (!activeProject) return;
    try {
      await exportProjectAsZip(activeProject.name, activeProjectId);
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, [activeProject, activeProjectId]);

  const handleZipImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const count = await importFromZip(file, activeProjectId);
      alert(`Imported ${count} files`);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setImporting(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  }, [activeProjectId]);

  const handleFolderImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setImporting(true);
    try {
      const count = await importFromFolder(fileList, activeProjectId);
      alert(`Imported ${count} files`);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setImporting(false);
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }, [activeProjectId]);

  // ----- Context menu action handlers -----

  const handleCreateFile = useCallback(async (parentPath: string) => {
    const name = prompt("Enter file name:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const filePath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    try {
      await fileOps.createFile(filePath, "", activeProjectId);
    } catch (err) {
      alert(`Failed to create file: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [activeProjectId]);

  const handleCreateFolder = useCallback(async (parentPath: string) => {
    const name = prompt("Enter folder name:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const folderPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    try {
      const existing = await db.files.get(folderPath);
      if (existing) {
        alert(`A file or folder already exists at: ${folderPath}`);
        return;
      }
      await db.files.put({
        id: folderPath,
        name: trimmed,
        type: "folder",
        parentPath,
        projectId: activeProjectId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      alert(`Failed to create folder: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [activeProjectId]);

  const handleCtxRename = useCallback((node: FileNode) => {
    setRenamingNodeId(node.id);
  }, []);

  const handleRenameSubmit = useCallback(async (node: FileNode, newName: string) => {
    setRenamingNodeId(null);
    if (newName === node.name) return;

    const oldPath = node.id;
    const parentPath = oldPath.includes("/")
      ? oldPath.substring(0, oldPath.lastIndexOf("/"))
      : "";
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    try {
      const existing = await db.files.get(newPath);
      if (existing) {
        alert(`A file or folder already exists at: ${newPath}`);
        return;
      }

      const oldFile = await db.files.get(oldPath);
      if (!oldFile) return;

      if (node.type === "folder") {
        // Recursively rename folder and all descendants
        const allFiles = await db.files.toArray();
        const descendants = allFiles.filter(
          (f) => f.parentPath === oldPath || f.parentPath.startsWith(oldPath + "/")
        );

        await db.files.put({
          ...oldFile,
          id: newPath,
          name: newName,
          updatedAt: new Date(),
        });

        for (const desc of descendants) {
          const newDescId = newPath + desc.id.substring(oldPath.length);
          const newDescParent = newPath + desc.parentPath.substring(oldPath.length);
          await db.files.put({
            ...desc,
            id: newDescId,
            parentPath: newDescParent,
            updatedAt: new Date(),
          });
          await db.files.delete(desc.id);
        }

        await db.files.delete(oldPath);
      } else {
        const ext = newName.split(".").pop()?.toLowerCase();
        await db.files.put({
          ...oldFile,
          id: newPath,
          name: newName,
          language: LANG_MAP[ext ?? ""] ?? "plaintext",
          updatedAt: new Date(),
        });
        await db.files.delete(oldPath);
      }
    } catch (err) {
      alert(`Rename failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenamingNodeId(null);
  }, []);

  const handleCtxDelete = useCallback(async (node: FileNode) => {
    const confirmed = confirm(`Delete "${node.name}"${node.type === "folder" ? " and all its contents" : ""}?`);
    if (!confirmed) return;
    try {
      await fileOps.deleteFile(node.id);
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  const handleDuplicate = useCallback(async (node: FileNode) => {
    if (node.type === "folder") return;
    const parentPath = node.id.includes("/")
      ? node.id.substring(0, node.id.lastIndexOf("/"))
      : "";
    const ext = node.name.includes(".") ? `.${node.name.split(".").pop()}` : "";
    const baseName = ext
      ? node.name.substring(0, node.name.length - ext.length)
      : node.name;
    const newName = `${baseName} copy${ext}`;
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    try {
      const original = await db.files.get(node.id);
      await fileOps.createFile(newPath, original?.content ?? "", original?.projectId);
    } catch (err) {
      alert(`Duplicate failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, []);

  const handleCopyPath = useCallback((node: FileNode) => {
    navigator.clipboard.writeText(node.id).catch(() => {
      alert(`Path: ${node.id}`);
    });
  }, []);

  // Filter files by search query
  const filteredFiles = searchQuery
    ? filterFileTree(files, searchQuery.toLowerCase())
    : files;

  if (!view) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="sidebar-panel">
      {/* Hidden file inputs */}
      <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleZipImport} />
      <input ref={folderInputRef} type="file" className="hidden" onChange={handleFolderImport}
        {...{ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>} />

      {view === "explorer" && (
        <>
          <div
            className="flex items-center justify-between px-4 py-2 text-xs font-semibold tracking-widest uppercase"
            style={{ color: "hsl(220 14% 60%)" }}
          >
            <span>Explorer</span>
            <div className="flex items-center gap-1">
              <button
                className="p-1 rounded hover:bg-white/10 transition-colors"
                onClick={() => folderInputRef.current?.click()}
                title="Import Folder"
                disabled={importing}
              >
                <Upload size={12} />
              </button>
              <button
                className="p-1 rounded hover:bg-white/10 transition-colors"
                onClick={() => zipInputRef.current?.click()}
                title="Import ZIP"
                disabled={importing}
              >
                <Upload size={12} style={{ transform: "scaleX(-1)" }} />
              </button>
              <button
                className="p-1 rounded hover:bg-white/10 transition-colors"
                onClick={handleExport}
                title="Export as ZIP"
              >
                <Download size={12} />
              </button>
            </div>
          </div>

          {/* Project Switcher */}
          <ProjectSwitcher />

          {/* File search */}
          <div className="px-2 py-1">
            <div className="flex items-center gap-2 rounded px-2 py-1" style={{ background: "hsl(220 13% 22%)" }}>
              <Search size={11} style={{ color: "hsl(220 14% 50%)" }} />
              <input
                className="bg-transparent text-xs outline-none w-full"
                placeholder="Filter files..."
                style={{ color: "hsl(220 14% 85%)" }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="border-b" style={{ borderColor: "hsl(220 13% 22%)" }}>
            <div
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold cursor-pointer select-none"
              style={{ color: "hsl(220 14% 75%)" }}
            >
              <ChevronDown size={12} />
              <span>WORKSPACE</span>
            </div>
            <div className="pb-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
              <FileTree
                nodes={filteredFiles}
                selectedFileId={selectedFileId}
                onSelectFile={onSelectFile}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onRename={handleCtxRename}
                onDelete={handleCtxDelete}
                onDuplicate={handleDuplicate}
                onCopyPath={handleCopyPath}
                renamingNodeId={renamingNodeId}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={handleRenameCancel}
              />
            </div>
          </div>
        </>
      )}

      {view === "search" && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-2 text-xs font-semibold tracking-widest uppercase shrink-0"
            style={{ color: "hsl(220 14% 60%)" }}
          >
            <span>Search</span>
            {totalMatchCount > 0 && (
              <span
                className="text-xs font-normal normal-case tracking-normal rounded-full px-1.5 py-0.5"
                style={{
                  background: "hsl(220 13% 28%)",
                  color: "hsl(220 14% 75%)",
                  fontSize: 10,
                }}
              >
                {totalMatchCount} {totalMatchCount === 1 ? "result" : "results"}
              </span>
            )}
          </div>

          {/* Search inputs area */}
          <div className="px-2 pb-2 flex flex-col gap-1.5 shrink-0">
            {/* Search input row */}
            <div className="flex items-center gap-1">
              {/* Toggle replace expand */}
              <button
                className="shrink-0 flex items-center justify-center rounded transition-colors"
                style={{
                  width: 18,
                  height: 18,
                  color: "hsl(220 14% 55%)",
                }}
                onClick={() => setShowReplace(!showReplace)}
                title={showReplace ? "Hide Replace" : "Show Replace"}
              >
                {showReplace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>

              <div className="flex-1 flex items-center gap-1">
                <div
                  className="flex-1 flex items-center rounded px-2 py-1"
                  style={{
                    background: "hsl(220 13% 22%)",
                    border: "1px solid hsl(220 13% 28%)",
                  }}
                >
                  <input
                    ref={searchInputRef}
                    className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground"
                    placeholder="Search"
                    style={{ color: "hsl(220 14% 85%)" }}
                    value={sidebarSearchQuery}
                    onChange={(e) => setSidebarSearchQuery(e.target.value)}
                    data-testid="search-input"
                  />
                </div>

                {/* Toggle buttons */}
                <ToggleButton
                  active={caseSensitive}
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  title="Match Case"
                >
                  Aa
                </ToggleButton>
                <ToggleButton
                  active={useRegex}
                  onClick={() => setUseRegex(!useRegex)}
                  title="Use Regular Expression"
                >
                  .*
                </ToggleButton>
                <ToggleButton
                  active={searchMode === "filename"}
                  onClick={() =>
                    setSearchMode(searchMode === "filename" ? "content" : "filename")
                  }
                  title={
                    searchMode === "filename"
                      ? "Switch to Content Search"
                      : "Switch to Filename Search"
                  }
                >
                  <FileText size={12} />
                </ToggleButton>
              </div>
            </div>

            {/* Replace input row */}
            {showReplace && (
              <div className="flex items-center gap-1">
                {/* Spacer to align with search input */}
                <div style={{ width: 18 }} className="shrink-0" />
                <div className="flex-1 flex items-center gap-1">
                  <div
                    className="flex-1 flex items-center rounded px-2 py-1"
                    style={{
                      background: "hsl(220 13% 22%)",
                      border: "1px solid hsl(220 13% 28%)",
                    }}
                  >
                    <input
                      className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground"
                      placeholder="Replace"
                      style={{ color: "hsl(220 14% 85%)" }}
                      value={replaceQuery}
                      onChange={(e) => setReplaceQuery(e.target.value)}
                      data-testid="replace-input"
                    />
                  </div>
                  <ToggleButton
                    active={false}
                    onClick={handleReplaceAll}
                    title="Replace All"
                  >
                    <Replace size={12} />
                  </ToggleButton>
                </div>
              </div>
            )}

            {/* Search mode label */}
            <div className="px-1 flex items-center gap-1" style={{ color: "hsl(220 14% 50%)", fontSize: 10 }}>
              <Search size={10} />
              <span>
                {searchMode === "filename" ? "Filename search" : "Content search"}
                {caseSensitive ? " (case sensitive)" : ""}
                {useRegex ? " (regex)" : ""}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderBottom: "1px solid hsl(220 13% 22%)" }} />

          {/* Results */}
          <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
            {isSearching && (
              <div className="px-3 py-2 text-xs" style={{ color: "hsl(220 14% 55%)" }}>
                Searching...
              </div>
            )}

            {!isSearching && debouncedQuery && searchResults.length === 0 && (
              <div className="px-3 py-4 text-xs text-center" style={{ color: "hsl(220 14% 50%)" }}>
                No results found for &quot;{debouncedQuery}&quot;
              </div>
            )}

            {!isSearching && !debouncedQuery && (
              <div className="px-3 py-4 text-xs text-center" style={{ color: "hsl(220 14% 50%)" }}>
                Type to search across files
              </div>
            )}

            {searchResults.map((result) => {
              const isExpanded = expandedResults.has(result.fileId);

              return (
                <div key={result.fileId}>
                  {/* File header */}
                  <div
                    className="flex items-center gap-1 px-2 py-0.5 cursor-pointer select-none hover:bg-white/5 transition-colors group"
                    style={{ minHeight: 22 }}
                    onClick={() => {
                      if (searchMode === "content" && result.matches.length > 0) {
                        toggleResultExpanded(result.fileId);
                      } else {
                        handleResultClick(result.fileId);
                      }
                    }}
                  >
                    {searchMode === "content" && result.matches.length > 0 ? (
                      isExpanded ? (
                        <ChevronDown size={12} style={{ color: "hsl(220 14% 55%)", flexShrink: 0 }} />
                      ) : (
                        <ChevronRight size={12} style={{ color: "hsl(220 14% 55%)", flexShrink: 0 }} />
                      )
                    ) : (
                      <div style={{ width: 12, flexShrink: 0 }} />
                    )}

                    <FileText size={12} style={{ color: "hsl(220 14% 55%)", flexShrink: 0 }} />

                    <span
                      className="text-xs truncate flex-1 cursor-pointer"
                      style={{ color: "hsl(220 14% 80%)" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResultClick(result.fileId);
                      }}
                      title={result.filePath}
                    >
                      {result.fileName}
                    </span>

                    {/* Path in subdued text */}
                    {result.filePath !== result.fileName && (
                      <span
                        className="text-xs truncate"
                        style={{ color: "hsl(220 14% 45%)", fontSize: 10, maxWidth: "45%" }}
                        title={result.filePath}
                      >
                        {result.filePath.replace("/" + result.fileName, "").replace(result.fileName, "")}
                      </span>
                    )}

                    {/* Match count badge */}
                    {result.matches.length > 0 && (
                      <span
                        className="rounded-full px-1.5 shrink-0"
                        style={{
                          background: "hsl(220 13% 28%)",
                          color: "hsl(220 14% 70%)",
                          fontSize: 10,
                          lineHeight: "16px",
                        }}
                      >
                        {result.matches.length}
                      </span>
                    )}

                    {/* Replace all in file button */}
                    {showReplace && replaceQuery !== undefined && (
                      <button
                        className="opacity-0 group-hover:opacity-100 shrink-0 rounded transition-all hover:bg-white/10"
                        style={{ padding: 2, color: "hsl(220 14% 60%)" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReplaceInFile(result.fileId);
                        }}
                        title="Replace All in File"
                      >
                        <Replace size={11} />
                      </button>
                    )}
                  </div>

                  {/* Line matches (content search, expanded) */}
                  {searchMode === "content" && isExpanded && result.matches.map((match, idx) => (
                    <div
                      key={`${result.fileId}-${match.lineNumber}-${idx}`}
                      className="flex items-center gap-1 cursor-pointer hover:bg-white/5 transition-colors group/line"
                      style={{ paddingLeft: 36, paddingRight: 8, minHeight: 20 }}
                      onClick={() => handleResultClick(result.fileId)}
                    >
                      {/* Line number */}
                      <span
                        className="shrink-0 text-right"
                        style={{
                          color: "hsl(220 14% 45%)",
                          fontSize: 10,
                          width: 28,
                          fontFamily: "monospace",
                        }}
                      >
                        {match.lineNumber}
                      </span>

                      {/* Line preview with highlight */}
                      <span className="truncate flex-1">
                        {renderHighlightedLine(match)}
                      </span>

                      {/* Replace single match button */}
                      {showReplace && (
                        <button
                          className="opacity-0 group-hover/line:opacity-100 shrink-0 rounded transition-all hover:bg-white/10"
                          style={{ padding: 2, color: "hsl(220 14% 60%)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReplace(result.fileId, match);
                          }}
                          title="Replace"
                        >
                          <Replace size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "source-control" && (
        <SourceControlPanel />
      )}

      {view === "debug" && (
        <RunDebugPanel onRunPreview={onRunPreview} />
      )}

      {view === "extensions" && (
        <ExtensionMarketplace />
      )}

      {view && !["explorer", "search", "source-control", "debug", "extensions"].includes(view) && (
        <ExtensionSidebarHost panelId={view} />
      )}
    </div>
  );
}

// --- Status badge component ---
function StatusBadge({ status }: { status: FileStatus }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    modified: { label: "M", color: "hsl(40 80% 60%)", bg: "hsl(40 80% 60% / 0.15)" },
    added: { label: "A", color: "hsl(140 60% 55%)", bg: "hsl(140 60% 55% / 0.15)" },
    deleted: { label: "D", color: "hsl(0 70% 60%)", bg: "hsl(0 70% 60% / 0.15)" },
    untracked: { label: "U", color: "hsl(220 14% 55%)", bg: "hsl(220 14% 55% / 0.15)" },
    "*modified": { label: "M", color: "hsl(40 80% 60%)", bg: "hsl(40 80% 60% / 0.15)" },
    "*added": { label: "A", color: "hsl(140 60% 55%)", bg: "hsl(140 60% 55% / 0.15)" },
    "*deleted": { label: "D", color: "hsl(0 70% 60%)", bg: "hsl(0 70% 60% / 0.15)" },
  };
  const c = config[status] ?? { label: "?", color: "hsl(220 14% 55%)", bg: "transparent" };
  return (
    <span
      className="inline-flex items-center justify-center rounded font-bold shrink-0"
      style={{
        width: 16,
        height: 16,
        fontSize: 10,
        color: c.color,
        background: c.bg,
        lineHeight: 1,
      }}
    >
      {c.label}
    </span>
  );
}

// --- Relative time helper ---
function relativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

// --- Source Control Panel ---
function SourceControlPanel() {
  const gitState = useGit();
  const {
    initialized,
    status,
    stagedFiles,
    log,
    currentBranch,
    branches,
    hasChanges,
    loading,
    initRepo,
    refreshStatus,
    stageFile,
    unstageFile,
    stageAll,
    commit,
    getLog,
    createBranch,
    checkoutBranch,
    getDiff,
  } = gitState;

  const [commitMessage, setCommitMessage] = useState("");
  const [expandStaged, setExpandStaged] = useState(true);
  const [expandChanges, setExpandChanges] = useState(true);
  const [expandCommits, setExpandCommits] = useState(false);
  const [diffView, setDiffView] = useState<{ path: string; old: string; new: string } | null>(null);
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showBranchList, setShowBranchList] = useState(false);

  // Auto-refresh status when panel becomes visible
  useEffect(() => {
    if (initialized) {
      refreshStatus();
      getLog();
    }
  }, [initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute unstaged changes (files in status but not in stagedFiles)
  const unstagedFiles = Array.from(status.entries())
    .filter(([path]) => !stagedFiles.includes(path))
    .map(([path, st]) => ({ path, status: st }));

  const stagedEntries = stagedFiles.map((path) => ({
    path,
    status: status.get(path) ?? ("added" as FileStatus),
  }));

  const handleCommit = async () => {
    if (!commitMessage.trim() || stagedFiles.length === 0) return;
    await commit(commitMessage);
    setCommitMessage("");
  };

  const handleShowDiff = async (path: string) => {
    const diff = await getDiff(path);
    setDiffView({ path, ...diff });
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    await createBranch(newBranchName.trim());
    setNewBranchName("");
    setShowBranchInput(false);
  };

  // Not initialized state
  if (!initialized) {
    return (
      <div className="flex flex-col p-3">
        <div className="flex items-center gap-2 mb-3">
          <GitBranch size={14} style={{ color: "hsl(220 14% 60%)" }} />
          <span
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "hsl(220 14% 60%)" }}
          >
            Source Control
          </span>
        </div>
        <div className="text-xs px-1" style={{ color: "hsl(220 14% 55%)" }}>
          <p className="mb-3">No active repository.</p>
          <button
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{
              background: "hsl(212 92% 45%)",
              color: "white",
              width: "100%",
              justifyContent: "center",
            }}
            onClick={initRepo}
            disabled={loading}
          >
            {loading ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <GitBranch size={12} />
            )}
            {loading ? "Initializing..." : "Initialize Repository"}
          </button>
        </div>
      </div>
    );
  }

  // Diff view
  if (diffView) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0"
          style={{ borderBottom: "1px solid hsl(220 13% 22%)" }}
        >
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
              style={{ color: "hsl(220 14% 70%)" }}
              onClick={() => setDiffView(null)}
            >
              Back
            </button>
            <span className="text-xs font-medium" style={{ color: "hsl(220 14% 80%)" }}>
              {diffView.path}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2" style={{ minHeight: 0 }}>
          <div className="flex flex-col gap-2">
            {/* Old content */}
            <div>
              <div
                className="text-xs font-medium px-2 py-1 rounded-t"
                style={{ background: "hsl(0 50% 20% / 0.3)", color: "hsl(0 70% 70%)" }}
              >
                Previous (HEAD)
              </div>
              <pre
                className="text-xs p-2 rounded-b overflow-x-auto whitespace-pre-wrap"
                style={{
                  background: "hsl(0 10% 12% / 0.4)",
                  color: "hsl(220 14% 65%)",
                  fontFamily: "monospace",
                  fontSize: 11,
                  maxHeight: 250,
                  overflowY: "auto",
                }}
              >
                {diffView.old || "(empty)"}
              </pre>
            </div>
            {/* New content */}
            <div>
              <div
                className="text-xs font-medium px-2 py-1 rounded-t"
                style={{ background: "hsl(140 50% 20% / 0.3)", color: "hsl(140 60% 65%)" }}
              >
                Current (Working Tree)
              </div>
              <pre
                className="text-xs p-2 rounded-b overflow-x-auto whitespace-pre-wrap"
                style={{
                  background: "hsl(140 10% 12% / 0.4)",
                  color: "hsl(220 14% 65%)",
                  fontFamily: "monospace",
                  fontSize: 11,
                  maxHeight: 250,
                  overflowY: "auto",
                }}
              >
                {diffView.new || "(empty / deleted)"}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ color: "hsl(220 14% 60%)" }}
      >
        <div className="flex items-center gap-2">
          <GitBranch size={14} />
          <span className="text-xs font-semibold tracking-widest uppercase">
            Source Control
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Branch indicator */}
          <button
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs hover:bg-white/10 transition-colors"
            style={{ color: "hsl(220 14% 70%)", fontSize: 10 }}
            onClick={() => setShowBranchList(!showBranchList)}
            title="Switch branch"
          >
            <GitBranch size={10} />
            {currentBranch}
          </button>
          <button
            className="p-1 rounded hover:bg-white/10 transition-colors"
            onClick={() => {
              refreshStatus();
              getLog();
            }}
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Branch switcher dropdown */}
      {showBranchList && (
        <div
          className="mx-2 mb-2 rounded overflow-hidden shrink-0"
          style={{
            background: "hsl(220 13% 18%)",
            border: "1px solid hsl(220 13% 28%)",
          }}
        >
          {branches.map((b) => (
            <button
              key={b}
              className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left hover:bg-white/5 transition-colors"
              style={{
                color: b === currentBranch ? "hsl(212 92% 60%)" : "hsl(220 14% 70%)",
              }}
              onClick={() => {
                checkoutBranch(b);
                setShowBranchList(false);
              }}
            >
              {b === currentBranch && <Check size={10} />}
              {b !== currentBranch && <span style={{ width: 10 }} />}
              {b}
            </button>
          ))}
          <div style={{ borderTop: "1px solid hsl(220 13% 25%)" }}>
            {!showBranchInput ? (
              <button
                className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left hover:bg-white/5 transition-colors"
                style={{ color: "hsl(220 14% 55%)" }}
                onClick={() => setShowBranchInput(true)}
              >
                <Plus size={10} />
                Create new branch
              </button>
            ) : (
              <div className="flex items-center gap-1 p-1">
                <input
                  autoFocus
                  className="flex-1 bg-transparent text-xs outline-none px-1 py-0.5 rounded"
                  style={{
                    color: "hsl(220 14% 85%)",
                    background: "hsl(220 13% 22%)",
                    border: "1px solid hsl(220 13% 30%)",
                  }}
                  placeholder="Branch name"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateBranch();
                    if (e.key === "Escape") {
                      setShowBranchInput(false);
                      setNewBranchName("");
                    }
                  }}
                />
                <button
                  className="p-0.5 rounded hover:bg-white/10"
                  style={{ color: "hsl(140 60% 55%)" }}
                  onClick={handleCreateBranch}
                >
                  <Check size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Commit area */}
      <div className="px-2 pb-2 shrink-0">
        <div className="flex flex-col gap-1.5">
          <textarea
            className="w-full text-xs rounded px-2 py-1.5 outline-none resize-none placeholder:text-muted-foreground"
            style={{
              background: "hsl(220 13% 22%)",
              color: "hsl(220 14% 85%)",
              border: "1px solid hsl(220 13% 28%)",
              minHeight: 56,
              fontFamily: "inherit",
            }}
            placeholder="Commit message"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                handleCommit();
              }
            }}
            rows={2}
          />
          <div className="flex items-center gap-1">
            <button
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                background:
                  stagedFiles.length > 0 && commitMessage.trim()
                    ? "hsl(212 92% 45%)"
                    : "hsl(220 13% 25%)",
                color:
                  stagedFiles.length > 0 && commitMessage.trim()
                    ? "white"
                    : "hsl(220 14% 50%)",
              }}
              disabled={stagedFiles.length === 0 || !commitMessage.trim() || loading}
              onClick={handleCommit}
            >
              <Check size={12} />
              Commit
            </button>
            <button
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-white/10 disabled:opacity-40"
              style={{ color: "hsl(220 14% 70%)" }}
              onClick={stageAll}
              disabled={unstagedFiles.length === 0 || loading}
              title="Stage All Changes"
            >
              <Plus size={12} />
              Stage All
            </button>
          </div>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid hsl(220 13% 22%)" }} />

      {/* Scrollable changes + commits area */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {/* Staged Changes */}
        <div>
          <div
            className="flex items-center gap-1 px-2 py-1 cursor-pointer select-none hover:bg-white/5 transition-colors"
            style={{ color: "hsl(220 14% 75%)" }}
            onClick={() => setExpandStaged(!expandStaged)}
          >
            {expandStaged ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="text-xs font-semibold flex-1">
              Staged Changes
            </span>
            {stagedEntries.length > 0 && (
              <span
                className="rounded-full px-1.5 text-xs"
                style={{
                  background: "hsl(140 60% 55% / 0.15)",
                  color: "hsl(140 60% 55%)",
                  fontSize: 10,
                  lineHeight: "16px",
                }}
              >
                {stagedEntries.length}
              </span>
            )}
          </div>
          {expandStaged &&
            stagedEntries.map(({ path, status: st }) => (
              <div
                key={`staged-${path}`}
                className="flex items-center gap-1 px-3 py-0.5 cursor-pointer hover:bg-white/5 transition-colors group"
                style={{ paddingLeft: 24, minHeight: 22 }}
                onClick={() => handleShowDiff(path)}
              >
                <StatusBadge status={st} />
                <span
                  className="text-xs truncate flex-1"
                  style={{ color: "hsl(220 14% 75%)" }}
                  title={path}
                >
                  {path.split("/").pop()}
                </span>
                <span
                  className="text-xs truncate"
                  style={{ color: "hsl(220 14% 40%)", fontSize: 10, maxWidth: "35%" }}
                  title={path}
                >
                  {path.includes("/")
                    ? path.substring(0, path.lastIndexOf("/"))
                    : ""}
                </span>
                <button
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-all shrink-0"
                  style={{ color: "hsl(0 70% 60%)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    unstageFile(path);
                  }}
                  title="Unstage"
                >
                  <Minus size={12} />
                </button>
              </div>
            ))}
          {expandStaged && stagedEntries.length === 0 && (
            <div
              className="text-xs px-6 py-1"
              style={{ color: "hsl(220 14% 45%)" }}
            >
              No staged changes
            </div>
          )}
        </div>

        <div style={{ borderBottom: "1px solid hsl(220 13% 20%)" }} />

        {/* Unstaged Changes */}
        <div>
          <div
            className="flex items-center gap-1 px-2 py-1 cursor-pointer select-none hover:bg-white/5 transition-colors"
            style={{ color: "hsl(220 14% 75%)" }}
            onClick={() => setExpandChanges(!expandChanges)}
          >
            {expandChanges ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="text-xs font-semibold flex-1">Changes</span>
            {unstagedFiles.length > 0 && (
              <span
                className="rounded-full px-1.5 text-xs"
                style={{
                  background: "hsl(40 80% 60% / 0.15)",
                  color: "hsl(40 80% 60%)",
                  fontSize: 10,
                  lineHeight: "16px",
                }}
              >
                {unstagedFiles.length}
              </span>
            )}
          </div>
          {expandChanges &&
            unstagedFiles.map(({ path, status: st }) => (
              <div
                key={`unstaged-${path}`}
                className="flex items-center gap-1 px-3 py-0.5 cursor-pointer hover:bg-white/5 transition-colors group"
                style={{ paddingLeft: 24, minHeight: 22 }}
                onClick={() => handleShowDiff(path)}
              >
                <StatusBadge status={st} />
                <span
                  className="text-xs truncate flex-1"
                  style={{ color: "hsl(220 14% 75%)" }}
                  title={path}
                >
                  {path.split("/").pop()}
                </span>
                <span
                  className="text-xs truncate"
                  style={{ color: "hsl(220 14% 40%)", fontSize: 10, maxWidth: "35%" }}
                  title={path}
                >
                  {path.includes("/")
                    ? path.substring(0, path.lastIndexOf("/"))
                    : ""}
                </span>
                <button
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-all shrink-0"
                  style={{ color: "hsl(140 60% 55%)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    stageFile(path);
                  }}
                  title="Stage"
                >
                  <Plus size={12} />
                </button>
              </div>
            ))}
          {expandChanges && unstagedFiles.length === 0 && !hasChanges && (
            <div
              className="text-xs px-6 py-1"
              style={{ color: "hsl(220 14% 45%)" }}
            >
              No changes detected
            </div>
          )}
        </div>

        <div style={{ borderBottom: "1px solid hsl(220 13% 20%)" }} />

        {/* Commit History */}
        <div>
          <div
            className="flex items-center gap-1 px-2 py-1 cursor-pointer select-none hover:bg-white/5 transition-colors"
            style={{ color: "hsl(220 14% 75%)" }}
            onClick={() => {
              setExpandCommits(!expandCommits);
              if (!expandCommits && log.length === 0) {
                getLog();
              }
            }}
          >
            {expandCommits ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <History size={12} />
            <span className="text-xs font-semibold flex-1">Commits</span>
            {log.length > 0 && (
              <span
                className="rounded-full px-1.5 text-xs"
                style={{
                  background: "hsl(220 13% 28%)",
                  color: "hsl(220 14% 60%)",
                  fontSize: 10,
                  lineHeight: "16px",
                }}
              >
                {log.length}
              </span>
            )}
          </div>
          {expandCommits &&
            log.map((entry) => (
              <div
                key={entry.oid}
                className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors"
                style={{ paddingLeft: 24 }}
              >
                <GitCommit
                  size={12}
                  className="shrink-0 mt-0.5"
                  style={{ color: "hsl(220 14% 45%)" }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-xs truncate"
                    style={{ color: "hsl(220 14% 75%)" }}
                    title={entry.message}
                  >
                    {entry.message.split("\n")[0]}
                  </div>
                  <div
                    className="flex items-center gap-2"
                    style={{ fontSize: 10, color: "hsl(220 14% 45%)" }}
                  >
                    <span style={{ fontFamily: "monospace" }}>
                      {entry.oid.slice(0, 7)}
                    </span>
                    <span>{relativeTime(entry.author.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
          {expandCommits && log.length === 0 && (
            <div
              className="text-xs px-6 py-1"
              style={{ color: "hsl(220 14% 45%)" }}
            >
              No commits yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Recursively filter file tree by name match */
function filterFileTree(nodes: FileNode[], query: string): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder") {
      const filteredChildren = node.children ? filterFileTree(node.children, query) : [];
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
        result.push({ ...node, children: filteredChildren, expanded: true });
      }
    } else if (node.name.toLowerCase().includes(query)) {
      result.push(node);
    }
  }
  return result;
}
