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
  FilePlus,
  FolderPlus,
  Trash2,
  X,
  CheckSquare,
} from "lucide-react";
import { exportProjectAsZip } from "@/lib/exportZip";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";
import { importFromZip, importFromFolder } from "@/lib/importFiles";
import { useActiveProject } from "@/contexts/ProjectContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { ExtensionMarketplace } from "@/components/extensions/ExtensionMarketplace";
import { WikiPanel } from "./WikiPanel";
import { ExtensionSidebarHost } from "@/components/extensions/ExtensionSidebarHost";
import { RunDebugPanel } from "@/components/ide/RunDebugPanel";
import { SourceControlPanel } from "@/components/ide/SourceControlPanel";
import { useProjects } from "@/hooks/useProjects";
import { db, fileOps, LANG_MAP } from "@/lib/db";

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

/**
 * Compact icon button for the sidebar header — matches the editorial-terminal
 * design system with subtle hover and lime accent on active.
 */
function SidebarIconButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 22,
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 3,
        cursor: disabled ? "not-allowed" : "pointer",
        color: C.textDim,
        opacity: disabled ? 0.5 : 1,
        transition: "color 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLElement).style.color = C.accent;
        (e.currentTarget as HTMLElement).style.borderColor = C.borderHover;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLElement).style.color = C.textDim;
        (e.currentTarget as HTMLElement).style.borderColor = "transparent";
      }}
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
  onOpenTerminal?: () => void;
  onOpenCommit?: (oid: string, shortOid: string) => void;
  onOpenDiff?: (filePath: string, staged: boolean) => void;
  onCreateFile?: (filePath: string, content?: string) => Promise<void>;
  onCreateFolder?: (folderPath: string) => Promise<void>;
  onRenameFile?: (oldPath: string, newPath: string) => Promise<void>;
  onDeleteFile?: (filePath: string) => Promise<void>;
  onUpdateFileContent?: (filePath: string, content: string) => Promise<void>;
  onCheckFileExists?: (filePath: string) => Promise<boolean>;
  onGetFileContent?: (filePath: string) => Promise<string>;
  /** Lazy-load the immediate children of a folder marked `lazy` (e.g. node_modules). */
  onExpandLazyFolder?: (folderPath: string) => Promise<void>;
  /** Shared git API instance from IDELayout — passed to SourceControlPanel
   * so both the status bar branch picker and the panel share the same state. */
  git?: import("@/hooks/useRealGit").RealGitApi;
}

const bulkBtnStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontFamily: FONTS.mono,
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  background: "transparent",
  color: C.textDim,
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  cursor: "pointer",
  transition: "color 0.15s",
};

export function SidebarPanel({ view, selectedFileId, onSelectFile, files, onSearchFiles, onRunPreview, onOpenTerminal, onOpenCommit, onOpenDiff, onCreateFile, onCreateFolder, onRenameFile, onDeleteFile, onUpdateFileContent, onCheckFileExists, onExpandLazyFolder, git }: SidebarPanelProps) {
  useEffect(() => { injectFonts(); }, []);
  const { activeProjectId } = useActiveProject();
  const { activeProject } = useProjects();
  const { addNotification, showToast } = useNotifications();
  const [searchQuery, setSearchQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);
  // Bulk selection — node ids selected via shift/ctrl/cmd-click, drag-select,
  // or keyboard navigation. Folders can be selected too (matches VSCode).
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [lastClickedFileId, setLastClickedFileId] = useState<string | null>(null);
  // Focused node — separate from selection. Arrow keys move focus, enter/click
  // promotes the focused node into the selection.
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  // Marquee drag-select state. When the user mousedowns on empty space inside
  // the file tree wrapper and drags, we draw a rectangle and select every
  // node row that intersects it.
  const [marquee, setMarquee] = useState<{
    startX: number; startY: number; endX: number; endY: number; additive: boolean;
  } | null>(null);
  const fileTreeWrapperRef = useRef<HTMLDivElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // --- Search state ---
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("content");
  // Initialise from saved settings (localStorage mirrors IndexedDB via SettingsTabView)
  const [caseSensitive, setCaseSensitive] = useState(
    () => localStorage.getItem("pipilot:searchCaseSensitive") === "true"
  );
  const [useRegex, setUseRegex] = useState(
    () => localStorage.getItem("pipilot:searchRegex") === "true"
  );
  const [searchMaxResults, setSearchMaxResults] = useState<number>(
    () => parseInt(localStorage.getItem("pipilot:searchMaxResults") ?? "200", 10) || 200
  );
  const [searchExclude, setSearchExclude] = useState<string>(
    () => localStorage.getItem("pipilot:searchExclude") ?? "node_modules,.git,dist,build,.next"
  );
  const [showReplace, setShowReplace] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // React to settings changes dispatched by SettingsTabView in real-time
  useEffect(() => {
    function onSettingChanged(e: Event) {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail ?? {};
      if (key === "searchCaseSensitive") setCaseSensitive(value === "true");
      if (key === "searchRegex") setUseRegex(value === "true");
      if (key === "searchMaxResults") {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n > 0) setSearchMaxResults(n);
      }
      if (key === "searchExclude") setSearchExclude(value ?? "");
    }
    window.addEventListener("pipilot:setting-changed", onSettingChanged);
    return () => window.removeEventListener("pipilot:setting-changed", onSettingChanged);
  }, []);

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

  // Perform search when debounced query changes — uses real disk via server
  useEffect(() => {
    if (!debouncedQuery.trim() || !activeProjectId) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    async function performSearch() {
      try {
        const res = await fetch("/api/project/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProjectId,
            query: debouncedQuery,
            mode: searchMode,
            caseSensitive,
            useRegex,
            maxResults: searchMaxResults,
            exclude: searchExclude,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const results: SearchResult[] = data.results || [];
        setSearchResults(results);
        setExpandedResults(new Set(results.map((r) => r.fileId)));
        setIsSearching(false);
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
  }, [debouncedQuery, searchMode, caseSensitive, useRegex, searchMaxResults, searchExclude, activeProjectId]);

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
        // Prefer in-memory content from the file tree, fall back to onGetFileContent callback
        const flatFiles = flattenFileTree(files);
        const inMemory = flatFiles.find((f) => f.id === fileId);
        let content = inMemory?.content;
        if (!content && onGetFileContent) {
          content = await onGetFileContent(fileId);
        }
        if (!content) return;

        const lines = content.split("\n");
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

        if (onUpdateFileContent) {
          await onUpdateFileContent(fileId, newContent);
        }
        // Re-trigger search
        setDebouncedQuery("");
        setTimeout(() => setDebouncedQuery(sidebarSearchQuery), 50);
      } catch (err) {
        console.error("Replace failed:", err);
      }
    },
    [debouncedQuery, replaceQuery, useRegex, caseSensitive, sidebarSearchQuery, files, onUpdateFileContent]
  );

  // Replace all in a single file
  const handleReplaceInFile = useCallback(
    async (fileId: string) => {
      try {
        // Prefer in-memory content from the file tree, fall back to onGetFileContent callback
        const flatFiles = flattenFileTree(files);
        const inMemory = flatFiles.find((f) => f.id === fileId);
        let content = inMemory?.content;
        if (!content && onGetFileContent) {
          content = await onGetFileContent(fileId);
        }
        if (!content) return;

        let pattern: RegExp;
        if (useRegex) {
          pattern = new RegExp(debouncedQuery, caseSensitive ? "g" : "gi");
        } else {
          pattern = new RegExp(escapeRegExp(debouncedQuery), caseSensitive ? "g" : "gi");
        }

        const newContent = content.replace(pattern, replaceQuery);
        if (onUpdateFileContent) {
          await onUpdateFileContent(fileId, newContent);
        }
        // Re-trigger search
        setDebouncedQuery("");
        setTimeout(() => setDebouncedQuery(sidebarSearchQuery), 50);
      } catch (err) {
        console.error("Replace all failed:", err);
      }
    },
    [debouncedQuery, replaceQuery, useRegex, caseSensitive, sidebarSearchQuery, files, onUpdateFileContent]
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
      if (onCreateFile) {
        await onCreateFile(filePath, "");
      } else {
        await fileOps.createFile(filePath, "", activeProjectId);
      }
    } catch (err) {
      alert(`Failed to create file: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [activeProjectId, onCreateFile]);

  const handleCreateFolder = useCallback(async (parentPath: string) => {
    const name = prompt("Enter folder name:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const folderPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    try {
      if (onCreateFolder) {
        await onCreateFolder(folderPath);
      }
    } catch (err) {
      alert(`Failed to create folder: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [onCreateFolder]);

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
      if (onRenameFile) {
        await onRenameFile(oldPath, newPath);
      }
    } catch (err) {
      alert(`Rename failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [onRenameFile]);

  const handleRenameCancel = useCallback(() => {
    setRenamingNodeId(null);
  }, []);

  const handleCtxDelete = useCallback(async (node: FileNode) => {
    const confirmed = confirm(`Delete "${node.name}"${node.type === "folder" ? " and all its contents" : ""}?`);
    if (!confirmed) return;
    try {
      if (onDeleteFile) {
        await onDeleteFile(node.id);
      } else {
        await fileOps.deleteFile(node.id);
      }
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [onDeleteFile]);

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
      // Get content from in-memory tree for agent mode
      const flatFiles = flattenFileTree(files);
      const inMemory = flatFiles.find((f) => f.id === node.id);
      if (onCreateFile) {
        await onCreateFile(newPath, inMemory?.content ?? node.content ?? "");
      }
    } catch (err) {
      alert(`Duplicate failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [onCreateFile, files]);

  const handleCopyPath = useCallback((node: FileNode) => {
    navigator.clipboard.writeText(node.id)
      .then(() => showToast({ type: "success", title: "Path copied", message: node.id }))
      .catch(() => showToast({ type: "warning", title: "Copy failed", message: node.id }));
  }, [showToast]);

  // ── Bulk multi-select ──
  // Flat list of ALL visible nodes (files AND folders) for shift-click range
  // expansion and keyboard navigation. Order matches the rendered tree
  // (depth-first, folders before their children, only including expanded
  // folders' children — that mirrors what the user sees).
  const flatNodeIds = useMemo(() => {
    const out: string[] = [];
    function walk(nodes: FileNode[]) {
      const sorted = [...nodes].sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of sorted) {
        out.push(n.id);
        if (n.type === "folder" && n.children) walk(n.children);
      }
    }
    walk(files);
    return out;
  }, [files]);

  // Pure-file list (kept for ZIP/delete operations that only operate on files)
  const flatFileIds = useMemo(() => {
    const out: string[] = [];
    function walk(nodes: FileNode[]) {
      for (const n of nodes) {
        if (n.type === "file") out.push(n.id);
        if (n.children) walk(n.children);
      }
    }
    walk(files);
    return out;
  }, [files]);

  const handleMultiSelect = useCallback((node: FileNode, e: React.MouseEvent) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      // Shift-click → range select between last clicked and this one
      if (e.shiftKey && lastClickedFileId) {
        const a = flatNodeIds.indexOf(lastClickedFileId);
        const b = flatNodeIds.indexOf(node.id);
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a];
          for (let i = from; i <= to; i++) next.add(flatNodeIds[i]);
        } else {
          next.add(node.id);
        }
      } else {
        // Cmd/Ctrl-click → toggle individual
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
      }
      return next;
    });
    setLastClickedFileId(node.id);
  }, [lastClickedFileId, flatNodeIds]);

  const handleSelectAll = useCallback(() => {
    // Toggle: if all are already selected, deselect all
    if (selectedSet.size === flatNodeIds.length && flatNodeIds.length > 0) {
      setSelectedSet(new Set());
      setLastClickedFileId(null);
    } else {
      setSelectedSet(new Set(flatNodeIds));
    }
  }, [flatNodeIds, selectedSet.size]);

  const handleClearSelection = useCallback(() => {
    setSelectedSet(new Set());
    setLastClickedFileId(null);
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedSet.size === 0) return;
    const ids = Array.from(selectedSet);
    if (!confirm(`Delete ${ids.length} file${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    for (const id of ids) {
      try {
        if (onDeleteFile) await onDeleteFile(id);
      } catch (err) {
        console.error("delete failed:", id, err);
      }
    }
    setSelectedSet(new Set());
  }, [selectedSet, onDeleteFile]);

  const handleBulkCopyPaths = useCallback(() => {
    if (selectedSet.size === 0) return;
    const paths = Array.from(selectedSet).join("\n");
    navigator.clipboard.writeText(paths)
      .then(() => showToast({
        type: "success",
        title: `Copied ${selectedSet.size} path${selectedSet.size === 1 ? "" : "s"}`,
      }))
      .catch(() => showToast({
        type: "warning",
        title: "Copy failed",
        message: paths,
      }));
  }, [selectedSet, showToast]);

  const handleBulkDownload = useCallback(async () => {
    if (selectedSet.size === 0) return;
    if (!activeProjectId) return;
    showToast({
      type: "info",
      title: `Zipping ${selectedSet.size} file${selectedSet.size === 1 ? "" : "s"}…`,
    });
    try {
      const res = await fetch("/api/files/zip-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          paths: Array.from(selectedSet),
          name: `selection-${selectedSet.size}-files`,
        }),
      });
      if (!res.ok) throw new Error(`zip failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `selection-${selectedSet.size}-files.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addNotification({
        type: "success",
        title: "Download ready",
        message: `${selectedSet.size} file${selectedSet.size === 1 ? "" : "s"} · ${(blob.size / 1024).toFixed(1)}KB`,
      });
    } catch (err) {
      addNotification({
        type: "error",
        title: "Download failed",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [selectedSet, activeProjectId, addNotification, showToast]);

  // ── Keyboard navigation for the file tree ──
  // ⌘A / Ctrl+A → select all
  // Esc → clear selection
  // ↑ / ↓ → move focus
  // Shift + ↑/↓ → extend selection in that direction
  // Enter → open the focused file (or expand/collapse the focused folder)
  // Delete → delete selected items
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (view !== "explorer") return;
      const target = e.target as HTMLElement | null;
      // Don't hijack inputs / textareas / Monaco
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      // ⌘A — select all
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      // Esc — clear selection
      if (e.key === "Escape" && selectedSet.size > 0) {
        handleClearSelection();
        return;
      }

      // ↑ / ↓ — move focus through the visible flat node list
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (flatNodeIds.length === 0) return;
        e.preventDefault();
        const currentIdx = focusedNodeId ? flatNodeIds.indexOf(focusedNodeId) : -1;
        let nextIdx: number;
        if (currentIdx < 0) {
          nextIdx = e.key === "ArrowDown" ? 0 : flatNodeIds.length - 1;
        } else {
          nextIdx = e.key === "ArrowDown"
            ? Math.min(flatNodeIds.length - 1, currentIdx + 1)
            : Math.max(0, currentIdx - 1);
        }
        const nextId = flatNodeIds[nextIdx];
        setFocusedNodeId(nextId);

        if (e.shiftKey) {
          // Extend the selection toward the new focus
          setSelectedSet((prev) => {
            const next = new Set(prev);
            next.add(nextId);
            return next;
          });
        } else {
          // Plain arrow — replace selection with just the focused node
          setSelectedSet(new Set([nextId]));
        }
        setLastClickedFileId(nextId);

        // Scroll the row into view
        requestAnimationFrame(() => {
          const wrapper = fileTreeWrapperRef.current;
          const row = wrapper?.querySelector<HTMLElement>(`[data-tree-node-id="${CSS.escape(nextId)}"]`);
          row?.scrollIntoView({ block: "nearest" });
        });
        return;
      }

      // Enter — open the focused file or toggle the focused folder
      if (e.key === "Enter" && focusedNodeId) {
        e.preventDefault();
        // Find the node in the tree
        const findNode = (nodes: FileNode[]): FileNode | null => {
          for (const n of nodes) {
            if (n.id === focusedNodeId) return n;
            if (n.children) {
              const found = findNode(n.children);
              if (found) return found;
            }
          }
          return null;
        };
        const node = findNode(files);
        if (node) onSelectFile(node);
        return;
      }

      // Delete — bulk delete selected items
      if ((e.key === "Delete" || e.key === "Backspace") && selectedSet.size > 0) {
        e.preventDefault();
        handleBulkDelete();
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, handleSelectAll, handleClearSelection, selectedSet.size, focusedNodeId, flatNodeIds, files]);

  // ── Marquee drag-to-select ──
  // Compute which node rows intersect the marquee rectangle and update
  // the selection set accordingly. Uses data-tree-node-id attributes that
  // FileTree adds to every row.
  const updateMarqueeSelection = useCallback(
    (startX: number, startY: number, endX: number, endY: number, additive: boolean) => {
      const wrapper = fileTreeWrapperRef.current;
      if (!wrapper) return;
      const rectLeft = Math.min(startX, endX);
      const rectRight = Math.max(startX, endX);
      const rectTop = Math.min(startY, endY);
      const rectBottom = Math.max(startY, endY);
      const wrapperRect = wrapper.getBoundingClientRect();

      const hits = new Set<string>();
      const rows = wrapper.querySelectorAll<HTMLElement>("[data-tree-node-id]");
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        // Convert wrapper-relative coords to viewport coords
        const rowTop = r.top - wrapperRect.top + wrapper.scrollTop;
        const rowBottom = r.bottom - wrapperRect.top + wrapper.scrollTop;
        const rowLeft = r.left - wrapperRect.left + wrapper.scrollLeft;
        const rowRight = r.right - wrapperRect.left + wrapper.scrollLeft;
        // Vertical overlap is enough — file tree rows span the full width
        if (rowBottom < rectTop || rowTop > rectBottom) continue;
        if (rowRight < rectLeft || rowLeft > rectRight) continue;
        const id = row.dataset.treeNodeId;
        if (id) hits.add(id);
      }

      setSelectedSet((prev) => {
        if (additive) {
          // Cmd/Ctrl held — union with existing selection
          const next = new Set(prev);
          for (const id of hits) next.add(id);
          return next;
        }
        return hits;
      });
    },
    [],
  );

  const handleTreeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only start marquee on left button drag from EMPTY space (not on a row)
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-tree-node-id]")) return; // clicked on a row
    if (target.closest("button")) return;               // clicked on a button
    if (target.closest("input")) return;                // clicked on an input

    const wrapper = fileTreeWrapperRef.current;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const x = e.clientX - wrapperRect.left + wrapper.scrollLeft;
    const y = e.clientY - wrapperRect.top + wrapper.scrollTop;
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    setMarquee({ startX: x, startY: y, endX: x, endY: y, additive });
    if (!additive) {
      setSelectedSet(new Set());
      setLastClickedFileId(null);
    }
    e.preventDefault();
  }, []);

  // Track mouse globally while marquee is active
  useEffect(() => {
    if (!marquee) return;
    const handleMove = (e: MouseEvent) => {
      const wrapper = fileTreeWrapperRef.current;
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const x = e.clientX - wrapperRect.left + wrapper.scrollLeft;
      const y = e.clientY - wrapperRect.top + wrapper.scrollTop;
      setMarquee((prev) => prev ? { ...prev, endX: x, endY: y } : null);
      updateMarqueeSelection(marquee.startX, marquee.startY, x, y, marquee.additive);
    };
    const handleUp = () => setMarquee(null);
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [marquee, updateMarqueeSelection]);

  // Drag-and-drop UPLOAD: read OS files as base64 and POST to the server.
  // Works for binary files (images, fonts, archives, etc.) — base64 round-trip
  // preserves bytes exactly. Folders dragged from the OS are silently skipped
  // (DataTransfer.files only includes top-level files, not folder entries).
  const handleUploadFiles = useCallback(async (targetFolderPath: string, fileList: File[]) => {
    if (!activeProjectId) {
      addNotification({ type: "warning", title: "No project open", message: "Open or create a project first." });
      return;
    }
    if (fileList.length === 0) return;
    // Filter: a directory dragged from the OS appears as an entry with size=0
    // and empty type. We can't read directory contents from a plain drop event
    // without DataTransferItemList.webkitGetAsEntry, which we'll skip for now.
    const realFiles = fileList.filter((f) => f.size > 0 || f.type !== "");
    if (realFiles.length === 0) {
      addNotification({
        type: "warning",
        title: "Folders not supported",
        message: "Drag individual files into the explorer for now.",
      });
      return;
    }

    setImporting(true);
    const where = targetFolderPath || "(root)";
    showToast({
      type: "info",
      title: `Uploading ${realFiles.length} file${realFiles.length === 1 ? "" : "s"}…`,
      message: `→ ${where}`,
    });
    try {
      // Read each file as base64. FileReader.readAsDataURL handles binary fine.
      const filesPayload = await Promise.all(
        realFiles.map((file) => new Promise<{ name: string; base64: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Strip the "data:.../base64," prefix
            const base64 = result.includes(",") ? result.split(",")[1] : result;
            resolve({ name: file.name, base64 });
          };
          reader.onerror = () => {
            console.error(`[upload] FileReader failed for ${file.name}:`, reader.error);
            reject(reader.error || new Error("FileReader failed"));
          };
          reader.readAsDataURL(file);
        })),
      );

      const totalBytes = filesPayload.reduce((s, f) => s + (f.base64.length * 3) / 4, 0);

      const res = await fetch("/api/files/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          targetFolder: targetFolderPath,
          files: filesPayload,
        }),
      });
      if (res.status === 413) {
        throw new Error("Files are too large (server limit: 1GB total)");
      }
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      addNotification({
        type: "success",
        title: `Uploaded ${data.count} file${data.count === 1 ? "" : "s"}`,
        message: `${(totalBytes / 1024).toFixed(1)}KB → ${where}`,
      });
    } catch (err) {
      console.error("[upload] failed:", err);
      addNotification({
        type: "error",
        title: "Upload failed",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setImporting(false);
    }
  }, [activeProjectId, addNotification, showToast]);

  // Drag-and-drop move: rename src to be inside the target folder.
  const handleMoveFile = useCallback(async (srcPath: string, targetFolderPath: string) => {
    const basename = srcPath.split("/").pop() || srcPath;
    const newPath = targetFolderPath ? `${targetFolderPath}/${basename}` : basename;
    if (newPath === srcPath) return;
    if (newPath.startsWith(srcPath + "/")) return; // can't move into self/descendant
    try {
      if (onRenameFile) {
        await onRenameFile(srcPath, newPath);
      }
    } catch (err) {
      alert(`Move failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [onRenameFile]);

  // Copy the workspace-relative path (e.g. "src/utils/foo.ts")
  const handleCopyRelativePath = useCallback((node: FileNode) => {
    const p = node.id.replace(/^\/+/, "");
    navigator.clipboard.writeText(p)
      .then(() => showToast({ type: "success", title: "Relative path copied", message: p }))
      .catch(() => showToast({ type: "warning", title: "Copy failed", message: p }));
  }, [showToast]);

  // Copy the absolute disk path. For linked projects we know the base from
  // activeProject.linkedPath. For non-linked projects we ask the server for
  // the workspace path so the result is correct on Windows/Mac/Linux.
  const handleCopyAbsolutePath = useCallback(async (node: FileNode) => {
    const rel = node.id.replace(/^\/+/, "");
    let basePath = activeProject?.linkedPath;
    if (!basePath && activeProjectId) {
      try {
        const res = await fetch(`/api/workspaces/info?projectId=${encodeURIComponent(activeProjectId)}`);
        if (res.ok) {
          const data = await res.json();
          basePath = data.absolutePath || data.path;
        }
      } catch {}
    }
    if (!basePath) {
      navigator.clipboard.writeText(rel)
        .then(() => showToast({ type: "success", title: "Path copied", message: rel }))
        .catch(() => showToast({ type: "warning", title: "Copy failed", message: rel }));
      return;
    }
    const isWin = /^[a-zA-Z]:\\/.test(basePath) || basePath.includes("\\");
    const sep = isWin ? "\\" : "/";
    const joined = basePath.replace(/[/\\]+$/, "") + sep + rel.replace(/\//g, sep);
    navigator.clipboard.writeText(joined)
      .then(() => showToast({ type: "success", title: "Absolute path copied", message: joined }))
      .catch(() => showToast({ type: "warning", title: "Copy failed", message: joined }));
  }, [activeProject, activeProjectId, showToast]);

  // Filter files by search query
  const filteredFiles = searchQuery
    ? filterFileTree(files, searchQuery.toLowerCase())
    : files;

  if (!view) return null;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      data-testid="sidebar-panel"
      style={{
        background: C.surface,
        color: C.text,
        fontFamily: FONTS.sans,
        borderRight: `1px solid ${C.border}`,
      }}
    >
      {/* Hidden file inputs */}
      <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleZipImport} />
      <input ref={folderInputRef} type="file" className="hidden" onChange={handleFolderImport}
        {...{ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>} />

      {view === "explorer" && (
        <>
          {/* Section label — editorial mono */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "16px 14px 10px",
            }}
          >
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase",
                color: C.accent,
              }}
            >
              / A
            </span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase",
                color: C.text,
              }}
            >
              Explorer
            </span>
            {activeProject?.type && activeProject.type !== "static" && (
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 8, padding: "1px 5px",
                  borderRadius: 2,
                  background: activeProject.type === "linked" ? `${C.accent}1a` : C.surfaceAlt,
                  color: activeProject.type === "linked" ? C.accent : C.textMid,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  border: `1px solid ${activeProject.type === "linked" ? C.accentLine : C.border}`,
                }}
              >
                {activeProject.type === "cloud" ? "cloud" : activeProject.type === "linked" ? "linked" : "node"}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <SidebarIconButton onClick={() => handleCreateFile("")} title="New File (in root)">
              <FilePlus size={12} strokeWidth={1.6} />
            </SidebarIconButton>
            <SidebarIconButton onClick={() => handleCreateFolder("")} title="New Folder (in root)">
              <FolderPlus size={12} strokeWidth={1.6} />
            </SidebarIconButton>
          </div>

          {/* Hairline divider */}
          <div style={{ height: 1, background: C.border, margin: "0 14px" }} />

          {/* Project Switcher + Import/Export */}
          <div style={{ padding: "8px 14px 4px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ProjectSwitcher />
            </div>
            <SidebarIconButton onClick={() => folderInputRef.current?.click()} title="Import Folder" disabled={importing}>
              <Upload size={11} strokeWidth={1.6} />
            </SidebarIconButton>
            <SidebarIconButton onClick={handleExport} title="Export as ZIP">
              <Download size={11} strokeWidth={1.6} />
            </SidebarIconButton>
          </div>

          {/* File search input */}
          <div style={{ padding: "4px 14px 8px" }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px",
                background: C.surfaceAlt,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
              }}
            >
              <Search size={11} style={{ color: C.textDim }} />
              <input
                placeholder="filter files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  background: "transparent",
                  outline: "none",
                  border: "none",
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: C.text,
                }}
              />
            </div>
          </div>

          {/* Bulk-selection strip — floats over filter input when files selected */}
          {selectedSet.size > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 2,
              padding: "4px 8px",
              margin: "-30px 8px 4px",
              position: "relative", zIndex: 5,
              background: "hsl(220 13% 14%)",
              border: `1px solid ${C.accentLine}`,
              borderRadius: 5,
            }}>
              <span style={{
                fontFamily: FONTS.mono, fontSize: 8, fontWeight: 600,
                color: C.accent, marginRight: 2,
              }}>
                {selectedSet.size}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={handleSelectAll} title="Select all (⌘A)" style={bulkBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}>
                <CheckSquare size={11} />
              </button>
              <button onClick={handleBulkDownload} title="Download as ZIP" style={bulkBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}>
                <Download size={11} />
              </button>
              <button onClick={handleBulkDelete} title="Delete selected" style={bulkBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#ff9b9b"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}>
                <Trash2 size={11} />
              </button>
              <button onClick={handleClearSelection} title="Clear selection (Esc)" style={bulkBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}>
                <X size={10} />
              </button>
            </div>
          )}

          <div style={{ borderTop: `1px solid ${C.border}` }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 14px 6px",
                cursor: "pointer", userSelect: "none",
              }}
            >
              <ChevronDown size={11} style={{ color: C.textDim }} />
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9, fontWeight: 500,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  color: C.textMid,
                }}
              >
                Workspace
              </span>
            </div>

            <div
              ref={fileTreeWrapperRef}
              className="pb-2 overflow-y-auto"
              style={{
                maxHeight: "calc(100vh - 220px)",
                position: "relative",
                userSelect: marquee ? "none" : undefined,
                ...(rootDragOver && {
                  background: C.accentDim,
                  boxShadow: `inset 0 0 0 1px ${C.accent}`,
                }),
              }}
              onMouseDown={handleTreeMouseDown}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setRootDragOver(true);
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setRootDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setRootDragOver(false);
                const externalFiles = Array.from(e.dataTransfer.files || []);
                if (externalFiles.length > 0) {
                  handleUploadFiles("", externalFiles);
                }
              }}
            >
              {/* Marquee selection rectangle overlay */}
              {marquee && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: Math.min(marquee.startX, marquee.endX),
                    top: Math.min(marquee.startY, marquee.endY),
                    width: Math.abs(marquee.endX - marquee.startX),
                    height: Math.abs(marquee.endY - marquee.startY),
                    background: `${C.accent}1a`,
                    border: `1px solid ${C.accent}88`,
                    borderRadius: 2,
                    pointerEvents: "none",
                    zIndex: 50,
                  }}
                />
              )}
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
                onCopyRelativePath={handleCopyRelativePath}
                onCopyAbsolutePath={handleCopyAbsolutePath}
                onMoveFile={handleMoveFile}
                onUploadFiles={handleUploadFiles}
                selectedSet={selectedSet}
                onMultiSelect={handleMultiSelect}
                onClearSelection={() => setSelectedSet(new Set())}
                focusedNodeId={focusedNodeId}
                onBulkDelete={handleBulkDelete}
                onBulkDownload={handleBulkDownload}
                onBulkCopyPaths={handleBulkCopyPaths}
                renamingNodeId={renamingNodeId}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={handleRenameCancel}
                onExpandLazyFolder={onExpandLazyFolder}
              />
            </div>
          </div>
        </>
      )}

      {view === "search" && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Editorial section header */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "16px 14px 10px",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase",
                color: C.accent,
              }}
            >
              / B
            </span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase",
                color: C.text,
              }}
            >
              Search
            </span>
            {totalMatchCount > 0 && (
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9, padding: "1px 6px",
                  background: `${C.accent}1a`,
                  color: C.accent,
                  borderRadius: 2,
                  border: `1px solid ${C.accentLine}`,
                  letterSpacing: "0.05em",
                  marginLeft: "auto",
                }}
              >
                {totalMatchCount} {totalMatchCount === 1 ? "result" : "results"}
              </span>
            )}
          </div>
          <div style={{ height: 1, background: C.border, margin: "0 14px 8px" }} />

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
        <SourceControlPanel onOpenCommit={onOpenCommit} onOpenDiff={onOpenDiff} git={git} />
      )}

      {view === "debug" && (
        <RunDebugPanel onRunPreview={onRunPreview} onOpenTerminal={onOpenTerminal} />
      )}

      {view === "extensions" && (
        <ExtensionMarketplace />
      )}

      {view === "wiki" && (
        <WikiPanel activeTabId={selectedFileId} />
      )}

      {view && !["explorer", "search", "source-control", "debug", "extensions", "wiki"].includes(view) && (
        <ExtensionSidebarHost panelId={view} />
      )}
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
