import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode2,
  FileJson,
  FileText,
  FileType,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  Files,
  Loader2,
} from "lucide-react";
import { FileNode } from "@/hooks/useFileSystem";

interface FileTreeProps {
  nodes: FileNode[];
  selectedFileId: string | null;
  onSelectFile: (node: FileNode) => void;
  depth?: number;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRename?: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
  onDuplicate?: (node: FileNode) => void;
  onCopyPath?: (node: FileNode) => void;
  onCopyRelativePath?: (node: FileNode) => void;
  onCopyAbsolutePath?: (node: FileNode) => void;
  /** Drag-and-drop move: called when user drops `srcPath` onto a folder.
   * The handler is responsible for renaming `srcPath` → `targetFolder + "/" + basename(srcPath)`. */
  onMoveFile?: (srcPath: string, targetFolderPath: string) => void;
  /** External file upload: called when the user drops native OS files onto a folder. */
  onUploadFiles?: (targetFolderPath: string, files: File[]) => void;
  /** Multi-select set (file ids). When provided, FileTree highlights these
   * with the lime accent and treats them as the bulk selection. */
  selectedSet?: Set<string>;
  /** Click handler that supports modifier keys for multi-select. */
  onMultiSelect?: (node: FileNode, e: React.MouseEvent) => void;
  /** Clear the multi-selection. Called on plain (no-modifier) click when
   * a multi-selection exists, matching VSCode's behavior. */
  onClearSelection?: () => void;
  /** ID of the node that has keyboard focus (gets a 1px lime ring). */
  focusedNodeId?: string | null;
  /** Bulk operations — invoked from the adaptive context menu when the
   * right-clicked node is part of a multi-selection. */
  onBulkDelete?: () => void;
  onBulkDownload?: () => void;
  onBulkCopyPaths?: () => void;
  renamingNodeId?: string | null;
  onRenameSubmit?: (node: FileNode, newName: string) => void;
  onRenameCancel?: () => void;
  /** Lazy-load the children of a `lazy` folder (e.g. node_modules). */
  onExpandLazyFolder?: (folderPath: string) => Promise<void>;
  // Internal: context menu state is managed at the root level only
  _contextMenu?: ContextMenuState | null;
  _setContextMenu?: (menu: ContextMenuState | null) => void;
  _expandedFolders?: Set<string>;
  _toggleFolder?: (id: string) => void;
  _loadingFolders?: Set<string>;
  _setLoadingFolder?: (id: string, loading: boolean) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode;
}

// Editorial-terminal icon colors — quiet, one muted hue per family
const ICON_COLORS = {
  ts:    "#7ad6ff", // sky
  js:    "#ffb86b", // amber
  json:  "#ffd96b", // gold
  md:    "#a8ff7a", // mint
  css:   "#c6a6ff", // lavender
  html:  "#ff9b6b", // coral
  yaml:  "#a8a8b3", // mid
  py:    "#7adfff", // bright sky
  go:    "#7adfff",
  rs:    "#ff9b6b",
  default: "#5e5e68",
} as const;

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const sz = 12;
  switch (ext) {
    case "tsx": case "ts":
      return <FileCode2 size={sz} style={{ color: ICON_COLORS.ts, flexShrink: 0 }} />;
    case "jsx": case "js": case "mjs": case "cjs":
      return <FileCode2 size={sz} style={{ color: ICON_COLORS.js, flexShrink: 0 }} />;
    case "json":
      return <FileJson size={sz} style={{ color: ICON_COLORS.json, flexShrink: 0 }} />;
    case "md": case "mdx":
      return <FileText size={sz} style={{ color: ICON_COLORS.md, flexShrink: 0 }} />;
    case "css": case "scss": case "sass":
      return <FileType size={sz} style={{ color: ICON_COLORS.css, flexShrink: 0 }} />;
    case "html": case "htm":
      return <FileType size={sz} style={{ color: ICON_COLORS.html, flexShrink: 0 }} />;
    case "yml": case "yaml": case "toml":
      return <FileText size={sz} style={{ color: ICON_COLORS.yaml, flexShrink: 0 }} />;
    case "py":
      return <FileCode2 size={sz} style={{ color: ICON_COLORS.py, flexShrink: 0 }} />;
    case "go":
      return <FileCode2 size={sz} style={{ color: ICON_COLORS.go, flexShrink: 0 }} />;
    case "rs":
      return <FileCode2 size={sz} style={{ color: ICON_COLORS.rs, flexShrink: 0 }} />;
    default:
      return <FileText size={sz} style={{ color: ICON_COLORS.default, flexShrink: 0 }} />;
  }
}

// ---------- Context Menu Component (rendered via portal) ----------

interface ContextMenuProps {
  x: number;
  y: number;
  node: FileNode;
  isExpanded: boolean;
  onClose: () => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
  onDuplicate?: (node: FileNode) => void;
  onCopyPath?: (node: FileNode) => void;
  onCopyRelativePath?: (node: FileNode) => void;
  onCopyAbsolutePath?: (node: FileNode) => void;
  onToggleFolder?: (id: string) => void;
  // Adaptive: when the right-clicked node is part of a multi-selection,
  // these handlers operate on the WHOLE selection instead of just the node.
  bulkSelectionSize?: number;
  onBulkDelete?: () => void;
  onBulkDownload?: () => void;
  onBulkCopyPaths?: () => void;
}

function ContextMenu({
  x,
  y,
  node,
  isExpanded,
  onClose,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onDuplicate,
  onCopyPath,
  onCopyRelativePath,
  onCopyAbsolutePath,
  onToggleFolder,
  bulkSelectionSize = 0,
  onBulkDelete,
  onBulkDownload,
  onBulkCopyPaths,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) {
      menuRef.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const isFolder = node.type === "folder";
  const parentPath = isFolder ? node.id : node.id.includes("/") ? node.id.substring(0, node.id.lastIndexOf("/")) : "";

  // Editorial-terminal context menu items
  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 14px",
    fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
    fontSize: 10,
    color: "#a8a8b3",
    cursor: "pointer",
    borderLeft: "2px solid transparent",
    transition: "background 0.12s, color 0.12s, border-left-color 0.12s",
  };
  const onItemEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = "#15151b";
    e.currentTarget.style.color = "#c6ff3d";
    e.currentTarget.style.borderLeftColor = "#c6ff3d";
  };
  const onItemLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = "transparent";
    e.currentTarget.style.color = "#a8a8b3";
    e.currentTarget.style.borderLeftColor = "transparent";
  };
  const sep = (
    <div style={{ height: 1, background: "#28282f", margin: "4px 0" }} />
  );

  // Adaptive: when the right-clicked node is part of a multi-selection,
  // render a bulk-operations menu instead of the single-item menu.
  const isBulk = bulkSelectionSize > 1;

  if (isBulk) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50"
        style={{
          left: x,
          top: y,
          background: "#15151b",
          border: "1px solid #28282f",
          borderRadius: 4,
          padding: "4px 0",
          minWidth: 220,
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Editorial header showing the selection count */}
        <div
          style={{
            padding: "8px 14px 6px",
            fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#c6ff3d",
            borderBottom: "1px solid #28282f",
            marginBottom: 4,
          }}
        >
          / {String(bulkSelectionSize).padStart(2, "0")} SELECTED
        </div>

        {onBulkDownload && (
          <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
            onClick={() => handleAction(onBulkDownload)}>
            <Files size={11} />
            <span>Download as ZIP</span>
          </div>
        )}

        {onBulkCopyPaths && (
          <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
            onClick={() => handleAction(onBulkCopyPaths)}>
            <Copy size={11} />
            <span>Copy Paths</span>
          </div>
        )}

        {sep}

        {onBulkDelete && (
          <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
            onClick={() => handleAction(onBulkDelete)}>
            <Trash2 size={11} style={{ color: "#ff9b9b" }} />
            <span>Delete {bulkSelectionSize} items</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{
        left: x,
        top: y,
        background: "#15151b",
        border: "1px solid #28282f",
        borderRadius: 4,
        padding: "4px 0",
        minWidth: 200,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
      }}
    >
      <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
        onClick={() => handleAction(() => onCreateFile(isFolder ? node.id : parentPath))}>
        <FilePlus size={11} />
        <span>New File</span>
      </div>
      <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
        onClick={() => handleAction(() => onCreateFolder(isFolder ? node.id : parentPath))}>
        <FolderPlus size={11} />
        <span>New Folder</span>
      </div>

      {sep}

      <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
        onClick={() => handleAction(() => onRename(node))}>
        <Pencil size={11} />
        <span>Rename</span>
      </div>
      <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
        onClick={() => handleAction(() => onDelete(node))}>
        <Trash2 size={11} style={{ color: "#ff9b9b" }} />
        <span>Delete</span>
      </div>

      {(!isFolder && onDuplicate) || onCopyRelativePath || onCopyAbsolutePath || (isFolder && onToggleFolder) ? sep : null}

      {!isFolder && onDuplicate && (
        <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
          onClick={() => handleAction(() => onDuplicate(node))}>
          <Files size={11} />
          <span>Duplicate</span>
        </div>
      )}

      {onCopyRelativePath && (
        <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
          onClick={() => handleAction(() => onCopyRelativePath(node))}>
          <Copy size={11} />
          <span>Copy Relative Path</span>
        </div>
      )}

      {onCopyAbsolutePath && (
        <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
          onClick={() => handleAction(() => onCopyAbsolutePath(node))}>
          <Copy size={11} />
          <span>Copy Absolute Path</span>
        </div>
      )}

      {isFolder && onToggleFolder && (
        <div style={itemStyle} onMouseEnter={onItemEnter} onMouseLeave={onItemLeave}
          onClick={() => handleAction(() => onToggleFolder(node.id))}>
          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span>{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      )}
    </div>
  );
}

// ---------- Inline Rename Input ----------

function InlineRenameInput({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Select just the name part (without extension for files)
      const dotIndex = initialName.lastIndexOf(".");
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [initialName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && trimmed !== initialName) {
        onSubmit(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialName) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      className="outline-none w-full"
      style={{
        color: "#f5f5f7",
        background: "#0b0b0e",
        border: "1px solid #c6ff3d",
        borderRadius: 2,
        padding: "1px 5px",
        fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
        fontSize: 11,
        caretColor: "#c6ff3d",
      }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ---------- Main FileTree Component ----------

export function FileTree({
  nodes,
  selectedFileId,
  onSelectFile,
  depth = 0,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onDuplicate,
  onCopyPath,
  onCopyRelativePath,
  onCopyAbsolutePath,
  onMoveFile,
  onUploadFiles,
  selectedSet,
  onMultiSelect,
  onClearSelection,
  focusedNodeId,
  onBulkDelete,
  onBulkDownload,
  onBulkCopyPaths,
  renamingNodeId,
  onRenameSubmit,
  onRenameCancel,
  onExpandLazyFolder,
  _contextMenu,
  _setContextMenu,
  _expandedFolders: parentExpandedFolders,
  _toggleFolder: parentToggleFolder,
  _loadingFolders: parentLoadingFolders,
  _setLoadingFolder: parentSetLoadingFolder,
}: FileTreeProps) {
  const isRoot = depth === 0;

  const [localExpandedFolders, setLocalExpandedFolders] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.expanded).map((n) => n.id))
  );
  const [localLoadingFolders, setLocalLoadingFolders] = useState<Set<string>>(new Set());
  // Drag-and-drop hover state for visual feedback (lime border on drop target)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Use parent state if available (for recursive children), else use local state
  const activeContextMenu = isRoot ? contextMenu : (_contextMenu ?? null);
  const setActiveContextMenu = isRoot
    ? setContextMenu
    : (_setContextMenu ?? setContextMenu);

  const expandedFolders = parentExpandedFolders ?? localExpandedFolders;
  const loadingFolders = parentLoadingFolders ?? localLoadingFolders;
  const setLoadingFolder = parentSetLoadingFolder ?? ((id: string, loading: boolean) => {
    setLocalLoadingFolders((prev) => {
      const next = new Set(prev);
      if (loading) next.add(id); else next.delete(id);
      return next;
    });
  });

  const toggleFolder = useCallback(
    (id: string) => {
      if (parentToggleFolder) {
        parentToggleFolder(id);
      } else {
        setLocalExpandedFolders((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
    },
    [parentToggleFolder]
  );

  /** Click handler that lazy-loads on first expand for folders marked `lazy`. */
  const handleFolderClick = useCallback(
    async (node: FileNode) => {
      const willExpand = !expandedFolders.has(node.id);
      toggleFolder(node.id);
      if (willExpand && node.lazy && onExpandLazyFolder) {
        setLoadingFolder(node.id, true);
        try {
          await onExpandLazyFolder(node.id);
        } finally {
          setLoadingFolder(node.id, false);
        }
      }
    },
    [expandedFolders, toggleFolder, onExpandLazyFolder, setLoadingFolder],
  );

  // Sync expanded state when nodes change (new folders added should be expanded)
  useEffect(() => {
    if (!parentExpandedFolders) {
      setLocalExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const n of nodes) {
          if (n.expanded && !next.has(n.id)) next.add(n.id);
        }
        return next;
      });
    }
  }, [nodes, parentExpandedFolders]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: FileNode) => {
      e.preventDefault();
      e.stopPropagation();
      setActiveContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [setActiveContextMenu]
  );

  const closeContextMenu = useCallback(() => {
    setActiveContextMenu(null);
  }, [setActiveContextMenu]);

  return (
    <div
      // Capture-phase dragover so file drops on file ROWS (which have no
      // drop handlers of their own) bubble up properly. Without this,
      // the browser cancels the drop before it can reach the SidebarPanel
      // root drop target.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
        }
      }}
    >
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.id);
        const isSelected = selectedFileId === node.id;
        const paddingLeft = depth * 12 + 8;
        const isRenaming = renamingNodeId === node.id;

        if (node.type === "folder") {
          const isLoading = loadingFolders.has(node.id);
          // node_modules and other lazy-loaded heavy folders are dimmed
          // to mirror VSCode's visual treatment (faded "external" content).
          const isLazy = node.lazy || node.id === "node_modules" || node.id.startsWith("node_modules/");
          const isMultiSelected = selectedSet?.has(node.id) || false;
          const isFocused = focusedNodeId === node.id;
          const showSelectedStyle = isSelected || isMultiSelected;
          const folderIconColor = showSelectedStyle ? "#c6ff3d" : isLazy ? "#5e5e68" : "#a8a8b3";
          const chevronColor = showSelectedStyle ? "#c6ff3d" : isExpanded ? "#a8a8b3" : "#5e5e68";
          return (
            <div key={node.id}>
              <div
                className={`file-tree-item ${showSelectedStyle ? "selected" : ""}`}
                data-tree-node-id={node.id}
                style={{
                  paddingLeft,
                  opacity: isLazy ? 0.65 : 1,
                  ...(isMultiSelected && {
                    background: "#c6ff3d22",
                    borderLeftColor: "#c6ff3d",
                    color: "#c6ff3d",
                  }),
                  ...(isFocused && {
                    boxShadow: "inset 0 0 0 1px #c6ff3d88",
                  }),
                  ...(dragOverFolderId === node.id && {
                    background: "#c6ff3d22",
                    borderLeftColor: "#c6ff3d",
                    boxShadow: "inset 0 0 0 1px #c6ff3d",
                  }),
                }}
                draggable={!isLazy && !!onMoveFile}
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("application/x-pipilot-path", node.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (isLazy) return;
                  // Two valid drops: internal node move OR native OS file upload
                  const types = e.dataTransfer.types;
                  const isInternal = types.includes("application/x-pipilot-path");
                  const isExternal = types.includes("Files");
                  if ((isInternal && onMoveFile) || (isExternal && onUploadFiles)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = isExternal ? "copy" : "move";
                    setDragOverFolderId(node.id);
                  }
                }}
                onDragLeave={(e) => {
                  // Only clear if we're actually leaving (not entering a child)
                  if (e.currentTarget === e.target) setDragOverFolderId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverFolderId(null);
                  if (isLazy) return;
                  // External file upload takes precedence — if there are real
                  // files in the drop, hand them off to onUploadFiles.
                  const externalFiles = Array.from(e.dataTransfer.files || []);
                  if (externalFiles.length > 0 && onUploadFiles) {
                    onUploadFiles(node.id, externalFiles);
                    return;
                  }
                  if (!onMoveFile) return;
                  const src = e.dataTransfer.getData("application/x-pipilot-path");
                  if (!src || src === node.id) return;
                  if (node.id === src || node.id.startsWith(src + "/")) return;
                  onMoveFile(src, node.id);
                }}
                onClick={(e) => {
                  // Modifier-click toggles selection on the folder instead
                  // of expanding it. Plain click expands as before AND
                  // clears any active multi-selection (VSCode style).
                  if ((e.shiftKey || e.metaKey || e.ctrlKey) && onMultiSelect) {
                    onMultiSelect(node, e);
                  } else {
                    if (selectedSet && selectedSet.size > 0 && onClearSelection) {
                      onClearSelection();
                    }
                    handleFolderClick(node);
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, node)}
                data-testid={`file-tree-folder-${node.id}`}
              >
                <span style={{ color: chevronColor, flexShrink: 0, display: "flex" }}>
                  {isLoading ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : isExpanded ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )}
                </span>
                {isExpanded ? (
                  <FolderOpen
                    size={12}
                    style={{ color: folderIconColor, flexShrink: 0 }}
                  />
                ) : (
                  <Folder
                    size={12}
                    style={{ color: folderIconColor, flexShrink: 0 }}
                  />
                )}
                {isRenaming && onRenameSubmit && onRenameCancel ? (
                  <InlineRenameInput
                    initialName={node.name}
                    onSubmit={(newName) => onRenameSubmit(node, newName)}
                    onCancel={onRenameCancel}
                  />
                ) : (
                  <span style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}>{node.name}</span>
                )}
              </div>
              {isExpanded && node.children && (
                <FileTree
                  nodes={node.children}
                  selectedFileId={selectedFileId}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                  onCreateFile={onCreateFile}
                  onCreateFolder={onCreateFolder}
                  onRename={onRename}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onCopyPath={onCopyPath}
                  onCopyRelativePath={onCopyRelativePath}
                  onCopyAbsolutePath={onCopyAbsolutePath}
                  onMoveFile={onMoveFile}
                  onUploadFiles={onUploadFiles}
                  selectedSet={selectedSet}
                  onMultiSelect={onMultiSelect}
                  onClearSelection={onClearSelection}
                  focusedNodeId={focusedNodeId}
                  onBulkDelete={onBulkDelete}
                  onBulkDownload={onBulkDownload}
                  onBulkCopyPaths={onBulkCopyPaths}
                  renamingNodeId={renamingNodeId}
                  onRenameSubmit={onRenameSubmit}
                  onRenameCancel={onRenameCancel}
                  onExpandLazyFolder={onExpandLazyFolder}
                  _contextMenu={activeContextMenu}
                  _setContextMenu={setActiveContextMenu}
                  _expandedFolders={expandedFolders}
                  _toggleFolder={toggleFolder}
                  _loadingFolders={loadingFolders}
                  _setLoadingFolder={setLoadingFolder}
                />
              )}
            </div>
          );
        }

        // Files inside a lazy subtree (e.g. node_modules/...) get the
        // same dimmed treatment as their parent folder.
        const isLazyFile = node.id.startsWith("node_modules/");
        const isMultiSelected = selectedSet?.has(node.id) || false;
        const isFocused = focusedNodeId === node.id;
        return (
          <div
            key={node.id}
            className={`file-tree-item ${isSelected || isMultiSelected ? "selected" : ""}`}
            data-tree-node-id={node.id}
            style={{
              paddingLeft: paddingLeft + 17,
              opacity: isLazyFile ? 0.65 : 1,
              ...(isMultiSelected && {
                background: "#c6ff3d22",
                borderLeftColor: "#c6ff3d",
                color: "#c6ff3d",
              }),
              ...(isFocused && {
                boxShadow: "inset 0 0 0 1px #c6ff3d88",
              }),
            }}
            draggable={!isLazyFile && !!onMoveFile}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData("application/x-pipilot-path", node.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={(e) => {
              if ((e.shiftKey || e.metaKey || e.ctrlKey) && onMultiSelect) {
                onMultiSelect(node, e);
              } else {
                // Plain click: clear any active multi-selection (VSCode style)
                // so the user doesn't need to press Esc first.
                if (selectedSet && selectedSet.size > 0 && onClearSelection) {
                  onClearSelection();
                }
                onSelectFile(node);
              }
            }}
            onContextMenu={(e) => handleContextMenu(e, node)}
            data-testid={`file-tree-file-${node.id}`}
          >
            {getFileIcon(node.name)}
            {isRenaming && onRenameSubmit && onRenameCancel ? (
              <InlineRenameInput
                initialName={node.name}
                onSubmit={(newName) => onRenameSubmit(node, newName)}
                onCancel={onRenameCancel}
              />
            ) : (
              <span style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}>{node.name}</span>
            )}
          </div>
        );
      })}

      {/* Render context menu via portal — only at the root level */}
      {isRoot &&
        activeContextMenu &&
        onCreateFile &&
        onCreateFolder &&
        onRename &&
        onDelete &&
        createPortal(
          <ContextMenu
            x={activeContextMenu.x}
            y={activeContextMenu.y}
            node={activeContextMenu.node}
            isExpanded={expandedFolders.has(activeContextMenu.node.id)}
            onClose={closeContextMenu}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onCopyPath={onCopyPath}
            onCopyRelativePath={onCopyRelativePath}
            onCopyAbsolutePath={onCopyAbsolutePath}
            onToggleFolder={
              activeContextMenu.node.type === "folder"
                ? toggleFolder
                : undefined
            }
            // Adaptive bulk-mode: only flips on if the right-clicked node
            // is itself part of the selection AND there's more than one item
            bulkSelectionSize={
              selectedSet?.has(activeContextMenu.node.id) ? selectedSet.size : 0
            }
            onBulkDelete={onBulkDelete}
            onBulkDownload={onBulkDownload}
            onBulkCopyPaths={onBulkCopyPaths}
          />,
          document.body
        )}
    </div>
  );
}
