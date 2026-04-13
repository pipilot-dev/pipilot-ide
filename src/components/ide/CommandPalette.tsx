/**
 * CommandPalette — editorial-terminal styled file search (⌘P).
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { FileCode2, FileJson, FileText, FileType, Search, ArrowUp, ArrowDown, CornerDownLeft } from "lucide-react";
import { FileNode } from "@/hooks/useFileSystem";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface CommandPaletteProps {
  files: FileNode[];
  onSelectFile: (node: FileNode) => void;
  onClose: () => void;
}

function getFileIcon(name: string, color: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx": case "jsx": return <FileCode2 size={12} style={{ color }} />;
    case "ts": case "js": case "mjs": return <FileCode2 size={12} style={{ color }} />;
    case "json": return <FileJson size={12} style={{ color }} />;
    case "css": case "scss": return <FileType size={12} style={{ color }} />;
    default: return <FileText size={12} style={{ color }} />;
  }
}

export function CommandPalette({ files, onSelectFile, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { injectFonts(); }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return files.slice(0, 60);
    const q = query.toLowerCase();
    return files
      .filter((f) => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
      .slice(0, 60);
  }, [files, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIndex(0); }, [query]);

  // Keep selected item in view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const sel = list.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`);
    sel?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && filtered[selectedIndex]) { e.preventDefault(); onSelectFile(filtered[selectedIndex]); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filtered, selectedIndex, onClose, onSelectFile]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "14vh",
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        fontFamily: FONTS.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 620, maxWidth: "92vw",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.7)",
          display: "flex", flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Glow */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -100, right: -100,
            width: 280, height: 280,
            background: `radial-gradient(circle, ${C.accent}10 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        {/* ── Editorial label strip ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 18px 10px",
          borderBottom: `1px solid ${C.border}`,
          position: "relative",
        }}>
          <span style={{
            fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
            letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent,
          }}>
            / Q
          </span>
          <span style={{
            fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
            letterSpacing: "0.18em", textTransform: "uppercase", color: C.textDim,
          }}>
            Quick Open
          </span>
          <div style={{ flex: 1 }} />
          <span style={{
            fontFamily: FONTS.mono, fontSize: 9, color: C.textFaint,
            letterSpacing: "0.05em",
          }}>
            {String(filtered.length).padStart(2, "0")} / {String(files.length).padStart(2, "0")}
          </span>
        </div>

        {/* ── Search input ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 22px",
          borderBottom: `1px solid ${C.border}`,
          position: "relative",
        }}>
          <Search size={14} style={{ color: C.textDim, flexShrink: 0 }} />
          <input
            ref={inputRef}
            placeholder="search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: FONTS.mono,
              fontSize: 13,
              color: C.text,
              caretColor: C.accent,
              letterSpacing: "0.01em",
            }}
          />
          <kbd style={{
            padding: "3px 7px",
            fontFamily: FONTS.mono, fontSize: 9,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            color: C.textDim,
          }}>
            ESC
          </kbd>
        </div>

        {/* ── Result list ── */}
        <div ref={listRef} style={{ maxHeight: 360, overflowY: "auto", padding: "6px 0" }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: "40px 24px", textAlign: "center",
              fontFamily: FONTS.sans, fontSize: 12, color: C.textDim,
            }}>
              <div style={{
                fontFamily: FONTS.mono, fontSize: 9,
                letterSpacing: "0.18em", color: C.textFaint,
                marginBottom: 6,
              }}>
                // NO MATCHES
              </div>
              No files match <span style={{ color: C.text }}>"{query}"</span>
            </div>
          ) : filtered.map((file, i) => {
            const isSelected = i === selectedIndex;
            const dir = file.id.includes("/") ? file.id.slice(0, file.id.lastIndexOf("/")) : "";
            return (
              <button
                key={file.id}
                data-idx={i}
                onClick={() => onSelectFile(file)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  width: "100%", padding: "8px 22px",
                  background: isSelected ? C.surfaceAlt : "transparent",
                  borderLeft: `2px solid ${isSelected ? C.accent : "transparent"}`,
                  border: "none",
                  textAlign: "left", cursor: "pointer",
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: isSelected ? C.text : C.textMid,
                }}
              >
                {getFileIcon(file.name, isSelected ? C.accent : C.textDim)}
                <span style={{
                  flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {file.name}
                </span>
                {dir && (
                  <span style={{
                    fontFamily: FONTS.mono, fontSize: 10,
                    color: C.textFaint,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    maxWidth: 280,
                  }}>
                    {dir}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Footer hint strip ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 18,
          padding: "10px 22px",
          borderTop: `1px solid ${C.border}`,
          background: C.surfaceAlt,
          fontFamily: FONTS.mono, fontSize: 9,
          color: C.textDim,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-flex", gap: 2 }}>
              <kbd style={footKbdStyle}><ArrowUp size={9} /></kbd>
              <kbd style={footKbdStyle}><ArrowDown size={9} /></kbd>
            </span>
            navigate
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <kbd style={footKbdStyle}><CornerDownLeft size={9} /></kbd>
            open
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <kbd style={footKbdStyle}>esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}

const footKbdStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: 18, padding: "2px 5px",
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  fontFamily: FONTS.mono, fontSize: 9,
  color: C.textMid,
};
