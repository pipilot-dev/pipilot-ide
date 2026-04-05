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
  renamingNodeId?: string | null;
  onRenameSubmit?: (node: FileNode, newName: string) => void;
  onRenameCancel?: () => void;
  // Internal: context menu state is managed at the root level only
  _contextMenu?: ContextMenuState | null;
  _setContextMenu?: (menu: ContextMenuState | null) => void;
  _expandedFolders?: Set<string>;
  _toggleFolder?: (id: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx":
    case "jsx":
      return <FileCode2 size={14} className="text-blue-400 flex-shrink-0" />;
    case "ts":
    case "js":
      return <FileCode2 size={14} className="text-yellow-400 flex-shrink-0" />;
    case "json":
      return <FileJson size={14} className="text-yellow-300 flex-shrink-0" />;
    case "md":
      return <FileText size={14} className="text-blue-300 flex-shrink-0" />;
    case "css":
      return <FileType size={14} className="text-blue-400 flex-shrink-0" />;
    default:
      return <FileText size={14} className="text-gray-400 flex-shrink-0" />;
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
  onToggleFolder?: (id: string) => void;
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
  onToggleFolder,
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

  const itemClass =
    "flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer rounded-sm transition-colors";
  const hoverStyle = "hover:bg-[hsl(220,13%,25%)]";

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const isFolder = node.type === "folder";
  // For files, the parent path is derived from the node id
  const parentPath = isFolder ? node.id : node.id.includes("/") ? node.id.substring(0, node.id.lastIndexOf("/")) : "";

  return (
    <div
      ref={menuRef}
      className="fixed z-50 py-1 rounded shadow-xl border min-w-[180px]"
      style={{
        left: x,
        top: y,
        background: "hsl(220 13% 16%)",
        borderColor: "hsl(220 13% 25%)",
        color: "hsl(220 14% 85%)",
      }}
    >
      <div
        className={`${itemClass} ${hoverStyle}`}
        onClick={() =>
          handleAction(() => onCreateFile(isFolder ? node.id : parentPath))
        }
      >
        <FilePlus size={14} className="text-blue-400" />
        <span>New File</span>
      </div>
      <div
        className={`${itemClass} ${hoverStyle}`}
        onClick={() =>
          handleAction(() => onCreateFolder(isFolder ? node.id : parentPath))
        }
      >
        <FolderPlus size={14} className="text-yellow-400" />
        <span>New Folder</span>
      </div>

      <div
        className="my-1 border-t"
        style={{ borderColor: "hsl(220 13% 25%)" }}
      />

      <div
        className={`${itemClass} ${hoverStyle}`}
        onClick={() => handleAction(() => onRename(node))}
      >
        <Pencil size={14} className="text-gray-400" />
        <span>Rename</span>
      </div>
      <div
        className={`${itemClass} ${hoverStyle}`}
        onClick={() => handleAction(() => onDelete(node))}
      >
        <Trash2 size={14} className="text-red-400" />
        <span>Delete</span>
      </div>

      <div
        className="my-1 border-t"
        style={{ borderColor: "hsl(220 13% 25%)" }}
      />

      {!isFolder && onDuplicate && (
        <div
          className={`${itemClass} ${hoverStyle}`}
          onClick={() => handleAction(() => onDuplicate(node))}
        >
          <Files size={14} className="text-gray-400" />
          <span>Duplicate</span>
        </div>
      )}

      {!isFolder && onCopyPath && (
        <div
          className={`${itemClass} ${hoverStyle}`}
          onClick={() => handleAction(() => onCopyPath(node))}
        >
          <Copy size={14} className="text-gray-400" />
          <span>Copy Path</span>
        </div>
      )}

      {isFolder && onToggleFolder && (
        <div
          className={`${itemClass} ${hoverStyle}`}
          onClick={() => handleAction(() => onToggleFolder(node.id))}
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-gray-400" />
          ) : (
            <ChevronRight size={14} className="text-gray-400" />
          )}
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
      className="bg-transparent text-xs outline-none border rounded px-1 w-full"
      style={{
        color: "hsl(220 14% 85%)",
        borderColor: "hsl(210 100% 50%)",
        background: "hsl(220 13% 18%)",
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
  renamingNodeId,
  onRenameSubmit,
  onRenameCancel,
  _contextMenu,
  _setContextMenu,
  _expandedFolders: parentExpandedFolders,
  _toggleFolder: parentToggleFolder,
}: FileTreeProps) {
  const isRoot = depth === 0;

  const [localExpandedFolders, setLocalExpandedFolders] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.expanded).map((n) => n.id))
  );

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Use parent state if available (for recursive children), else use local state
  const activeContextMenu = isRoot ? contextMenu : (_contextMenu ?? null);
  const setActiveContextMenu = isRoot
    ? setContextMenu
    : (_setContextMenu ?? setContextMenu);

  const expandedFolders = parentExpandedFolders ?? localExpandedFolders;

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
    <div>
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.id);
        const isSelected = selectedFileId === node.id;
        const paddingLeft = depth * 12 + 8;
        const isRenaming = renamingNodeId === node.id;

        if (node.type === "folder") {
          return (
            <div key={node.id}>
              <div
                className={`file-tree-item ${isSelected ? "selected" : ""}`}
                style={{ paddingLeft }}
                onClick={() => toggleFolder(node.id)}
                onContextMenu={(e) => handleContextMenu(e, node)}
                data-testid={`file-tree-folder-${node.id}`}
              >
                <span className="text-gray-400 flex-shrink-0">
                  {isExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </span>
                {isExpanded ? (
                  <FolderOpen
                    size={14}
                    className="text-yellow-400 flex-shrink-0"
                  />
                ) : (
                  <Folder
                    size={14}
                    className="text-yellow-400 flex-shrink-0"
                  />
                )}
                {isRenaming && onRenameSubmit && onRenameCancel ? (
                  <InlineRenameInput
                    initialName={node.name}
                    onSubmit={(newName) => onRenameSubmit(node, newName)}
                    onCancel={onRenameCancel}
                  />
                ) : (
                  <span className="truncate">{node.name}</span>
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
                  renamingNodeId={renamingNodeId}
                  onRenameSubmit={onRenameSubmit}
                  onRenameCancel={onRenameCancel}
                  _contextMenu={activeContextMenu}
                  _setContextMenu={setActiveContextMenu}
                  _expandedFolders={expandedFolders}
                  _toggleFolder={toggleFolder}
                />
              )}
            </div>
          );
        }

        return (
          <div
            key={node.id}
            className={`file-tree-item ${isSelected ? "selected" : ""}`}
            style={{ paddingLeft: paddingLeft + 18 }}
            onClick={() => onSelectFile(node)}
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
              <span className="truncate">{node.name}</span>
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
            onToggleFolder={
              activeContextMenu.node.type === "folder"
                ? toggleFolder
                : undefined
            }
          />,
          document.body
        )}
    </div>
  );
}
