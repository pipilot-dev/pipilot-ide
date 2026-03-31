import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode2,
  FileJson,
  FileText,
  FileType,
} from "lucide-react";
import { FileNode } from "@/data/sampleFiles";

interface FileTreeProps {
  nodes: FileNode[];
  selectedFileId: string | null;
  onSelectFile: (node: FileNode) => void;
  depth?: number;
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

export function FileTree({
  nodes,
  selectedFileId,
  onSelectFile,
  depth = 0,
}: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.expanded).map((n) => n.id))
  );

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.id);
        const isSelected = selectedFileId === node.id;
        const paddingLeft = depth * 12 + 8;

        if (node.type === "folder") {
          return (
            <div key={node.id}>
              <div
                className={`file-tree-item ${isSelected ? "selected" : ""}`}
                style={{ paddingLeft }}
                onClick={() => toggleFolder(node.id)}
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
                  <FolderOpen size={14} className="text-yellow-400 flex-shrink-0" />
                ) : (
                  <Folder size={14} className="text-yellow-400 flex-shrink-0" />
                )}
                <span className="truncate">{node.name}</span>
              </div>
              {isExpanded && node.children && (
                <FileTree
                  nodes={node.children}
                  selectedFileId={selectedFileId}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
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
            data-testid={`file-tree-file-${node.id}`}
          >
            {getFileIcon(node.name)}
            <span className="truncate">{node.name}</span>
          </div>
        );
      })}
    </div>
  );
}
