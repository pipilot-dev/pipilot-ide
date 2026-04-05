import { useState, useEffect, useRef } from "react";
import { FileCode2, FileJson, FileText, FileType, Search } from "lucide-react";
import { FileNode } from "@/hooks/useFileSystem";

interface CommandPaletteProps {
  files: FileNode[];
  onSelectFile: (node: FileNode) => void;
  onClose: () => void;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx":
    case "jsx":
      return <FileCode2 size={14} className="text-blue-400" />;
    case "ts":
    case "js":
      return <FileCode2 size={14} className="text-yellow-400" />;
    case "json":
      return <FileJson size={14} className="text-yellow-300" />;
    case "css":
      return <FileType size={14} className="text-blue-400" />;
    default:
      return <FileText size={14} className="text-gray-400" />;
  }
}

export function CommandPalette({ files, onSelectFile, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = files.filter(
    (f) =>
      f.name.toLowerCase().includes(query.toLowerCase()) ||
      f.id.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        onSelectFile(filtered[selectedIndex]);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filtered, selectedIndex, onClose, onSelectFile]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="fixed inset-0" style={{ background: "rgba(0,0,0,0.5)" }} />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg rounded-lg border shadow-xl overflow-hidden"
        style={{
          background: "hsl(220 13% 18%)",
          borderColor: "hsl(220 13% 28%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 border-b"
          style={{ borderColor: "hsl(220 13% 24%)" }}
        >
          <Search size={14} style={{ color: "hsl(220 14% 50%)" }} />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "hsl(220 14% 90%)" }}
            placeholder="Search files by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: "hsl(220 13% 24%)",
              color: "hsl(220 14% 55%)",
              border: "1px solid hsl(220 13% 30%)",
            }}
          >
            Esc
          </kbd>
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: "hsl(220 14% 50%)" }}>
              No files found
            </div>
          )}
          {filtered.map((file, i) => (
            <button
              key={file.id}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
              style={{
                background: i === selectedIndex ? "hsl(207 90% 40% / 0.2)" : "transparent",
                color: "hsl(220 14% 85%)",
              }}
              onClick={() => onSelectFile(file)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {getFileIcon(file.name)}
              <span className="text-sm">{file.name}</span>
              <span className="text-xs ml-auto truncate max-w-[200px]" style={{ color: "hsl(220 14% 45%)" }}>
                {file.id}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
