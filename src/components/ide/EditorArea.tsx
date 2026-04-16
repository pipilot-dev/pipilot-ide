import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useProblems, type Problem } from "@/contexts/ProblemsContext";
import { createPortal } from "react-dom";
import Editor, { OnMount, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

// Configure Monaco to use local workers instead of CDN
self.MonacoEnvironment = {
  getWorker(_: any, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });
import { X, Circle, ChevronRight, FileCode2, FileJson, FileText, FileType, Folder, Globe, GitCommit, Settings, Pin, PinOff, Copy, BookOpen } from "lucide-react";
import { FileNode } from "@/hooks/useFileSystem";
import { WebPreview } from "./WebPreview";
import { CommitDetailView } from "./CommitDetailView";
import { FileDiffView } from "./FileDiffView";
import { SettingsTabView } from "./SettingsTabView";
import { WelcomePage } from "./WelcomePage";
import { WalkthroughView } from "./WalkthroughView";
import { WikiTabView } from "./WikiTabView";
import { FileViewer, shouldUseFileViewer } from "./FileViewer";
import { setupInlineAI, configureInlineAI } from "@/hooks/useInlineAI";
import { useSettings } from "@/hooks/useSettings";
import { useActiveProject } from "@/contexts/ProjectContext";
import { COLORS as C, FONTS } from "@/lib/design-tokens";

/**
 * Editorial Terminal Monaco theme. Defined at module scope so both
 * `beforeMount` (which fires before the editor instance exists) and
 * `handleMount` can reference it. Token colors are tuned to be quiet —
 * one muted color per syntactic role, with the lime accent reserved for
 * the cursor, selection highlights, and active indicators.
 */
const PIPILOT_EDITORIAL_THEME: any = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "",                   foreground: "a0a0a8" },
    { token: "comment",            foreground: "5f5f6a", fontStyle: "italic" },
    { token: "keyword",            foreground: "c49a6c" },
    { token: "keyword.control",    foreground: "b08a60" },
    { token: "keyword.operator",   foreground: "909099" },
    { token: "string",             foreground: "7ea868" },
    { token: "string.escape",      foreground: "b08a60" },
    { token: "number",             foreground: "b08a60" },
    { token: "regexp",             foreground: "c06a64" },
    { token: "type",               foreground: "6a9ec0" },
    { token: "type.identifier",    foreground: "6a9ec0" },
    { token: "interface",          foreground: "6a9ec0" },
    { token: "class",              foreground: "6a9ec0" },
    { token: "function",           foreground: "a0a0a8" },
    { token: "variable",           foreground: "a0a0a8" },
    { token: "variable.parameter", foreground: "909099" },
    { token: "constant",           foreground: "b08a60" },
    { token: "constant.language",  foreground: "b08a60" },
    { token: "operator",           foreground: "909099" },
    { token: "delimiter",          foreground: "5f5f6a" },
    { token: "delimiter.bracket",  foreground: "6b6b76" },
    { token: "delimiter.parenthesis", foreground: "6b6b76" },
    { token: "tag",                foreground: "c06a64" },
    { token: "metatag",            foreground: "c06a64" },
    { token: "attribute.name",     foreground: "c49a6c" },
    { token: "attribute.value",    foreground: "7ea868" },
    { token: "namespace",          foreground: "6a9ec0" },
    { token: "key",                foreground: "6a9ec0" },
    { token: "punctuation",        foreground: "5f5f6a" },
    // JSON-specific tokens (Monaco uses distinct token names for JSON)
    { token: "string.key.json",    foreground: "6a9ec0" },
    { token: "string.value.json",  foreground: "7ea868" },
    { token: "number.json",        foreground: "b08a60" },
    { token: "keyword.json",       foreground: "b08a60" },   // true, false, null
    { token: "delimiter.bracket.json", foreground: "6b6b76" },
    { token: "delimiter.colon.json",   foreground: "5f5f6a" },
    { token: "delimiter.comma.json",   foreground: "5f5f6a" },
  ],
  colors: {
    "editor.background":             "#16161a",
    "editor.foreground":             "#a0a0a8",
    "editorGutter.background":       "#16161a",
    "editor.lineHighlightBackground": "#1c1c2188",
    "editor.lineHighlightBorder":     "#1c1c2100",
    "editorWhitespace.foreground":   "#2e2e35",
    "editorIndentGuide.background":  "#2e2e35",
    "editorIndentGuide.activeBackground": "#44444d",
    "editorLineNumber.foreground":        "#42424a",
    "editorLineNumber.activeForeground":  "#a0a0ab",
    "editorCursor.foreground": "#a0a0ab",
    "editor.selectionBackground":         "#2a3a50",
    "editor.selectionHighlightBackground": "#2a3a5040",
    "editor.inactiveSelectionBackground": "#252d38",
    "editor.wordHighlightBackground":     "#2a3a5040",
    "editor.wordHighlightStrongBackground": "#2a3a5060",
    "editor.findMatchBackground":         "#4a3a20",
    "editor.findMatchHighlightBackground": "#4a3a2060",
    "editor.findRangeHighlightBackground": "#4a3a2030",
    "editorLink.activeForeground": "#6a9ec0",
    "editorBracketMatch.background": "#2a3a5030",
    "editorBracketMatch.border":     "#6b6b7660",
    "editorError.foreground":       "#e5534b",
    "editorWarning.foreground":     "#e5a639",
    "editorInfo.foreground":        "#6cb6ff",
    "editorHint.foreground":        "#5e5e68",
    "scrollbar.shadow":                       "#00000000",
    "scrollbarSlider.background":             "#28282f88",
    "scrollbarSlider.hoverBackground":        "#3d3d46aa",
    "scrollbarSlider.activeBackground":       "#c6ff3d55",
    "minimap.background":     "#0b0b0e",
    "minimap.selectionHighlight": "#c6ff3d",
    "minimapSlider.background":         "#28282f44",
    "minimapSlider.hoverBackground":    "#3d3d4666",
    "minimapSlider.activeBackground":   "#c6ff3d55",
    "editorWidget.background":       "#15151b",
    "editorWidget.foreground":       "#f5f5f7",
    "editorWidget.border":           "#28282f",
    "editorSuggestWidget.background": "#15151b",
    "editorSuggestWidget.border":     "#28282f",
    "editorSuggestWidget.foreground": "#f5f5f7",
    "editorSuggestWidget.selectedBackground": "#c6ff3d22",
    "editorSuggestWidget.highlightForeground": "#c6ff3d",
    "editorHoverWidget.background":  "#15151b",
    "editorHoverWidget.border":      "#28282f",
    "editorGhostText.foreground": "#c6ff3d66",
    "diffEditor.insertedTextBackground": "#c6ff3d18",
    "diffEditor.removedTextBackground":  "#ff6b6b18",
  },
};

export interface EditorTab {
  node: FileNode;
  isDirty: boolean;
  isPreview?: boolean;     // special tab for web preview
  isCommit?: boolean;      // special tab for commit detail view
  commitOid?: string;      // full commit hash (when isCommit)
  isDiff?: boolean;        // special tab for file diff view
  diffPath?: string;       // file path being diffed (when isDiff)
  diffStaged?: boolean;    // whether to show staged or unstaged diff
  isSettings?: boolean;    // special tab for settings view
  isWalkthrough?: boolean; // special tab for interactive walkthrough
  walkthroughId?: string;  // which walkthrough ("get-started" | "ai-power")
  isWiki?: boolean;        // special tab for wiki page
  wikiPageId?: string;     // which wiki page to render
  isPinned?: boolean;      // pinned tabs survive "Close Others/All"
}

interface EditorAreaProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onContentChange?: (fileId: string, content: string) => void;
  allFiles?: FileNode[];
  onSelectFile?: (node: FileNode) => void;
  onOpenPreview?: () => void;
  onOpenWalkthrough?: (id: string) => void;
  projectType?: "static" | "nodebox" | "cloud" | "linked";
  /** Bulk close operations from the tab context menu */
  onCloseOtherTabs?: (id: string) => void;
  onCloseTabsToLeft?: (id: string) => void;
  onCloseTabsToRight?: (id: string) => void;
  onCloseAllTabs?: () => void;
  onTogglePinTab?: (id: string) => void;
  /** Reorder tabs after a drag-and-drop */
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
}

// ── Breadcrumb with dropdown navigation ──

function getSmallIcon(name: string, type: "file" | "folder") {
  if (type === "folder") return <Folder size={12} className="text-yellow-400" />;
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx": case "jsx":
      return <FileCode2 size={12} className="text-blue-400" />;
    case "ts": case "js":
      return <FileCode2 size={12} className="text-yellow-400" />;
    case "json":
      return <FileJson size={12} className="text-yellow-300" />;
    case "css":
      return <FileType size={12} className="text-blue-400" />;
    default:
      return <FileText size={12} className="text-gray-400" />;
  }
}

/**
 * Find the siblings at a given breadcrumb depth.
 * For segmentIndex 0, returns root-level items.
 * For segmentIndex N, drills into folders matching pathParts[0..N-1]
 * and returns all children at that level.
 */
function findSiblings(allFiles: FileNode[], pathParts: string[], segmentIndex: number): FileNode[] {
  if (!allFiles || allFiles.length === 0) return [];

  let current = allFiles;

  for (let i = 0; i < segmentIndex; i++) {
    const folderName = pathParts[i];
    // Try matching by name first, then by id segment
    const match = current.find(
      (n) => n.type === "folder" && (n.name === folderName || n.id.endsWith("/" + folderName) || n.id === folderName)
    );
    if (!match) return current; // fallback: show current level if we can't drill deeper
    if (!match.children || match.children.length === 0) return [];
    current = match.children;
  }

  return current;
}

// ─── Tab context menu ───────────────────────────────────────────────

interface TabContextMenuProps {
  x: number;
  y: number;
  tab: EditorTab;
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  onCloseAll: () => void;
  onTogglePin: () => void;
  onCopyPath: () => void;
}

function TabContextMenu({
  x, y, tab, isFirst, isLast, isOnly, onClose,
  onCloseTab, onCloseOthers, onCloseLeft, onCloseRight, onCloseAll,
  onTogglePin, onCopyPath,
}: TabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu within the viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) ref.current.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) ref.current.style.top = `${y - rect.height}px`;
  }, [x, y]);

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
    minWidth: 220,
    justifyContent: "space-between",
  };
  const disabledStyle: React.CSSProperties = {
    ...itemStyle,
    color: "#3a3a42",
    cursor: "not-allowed",
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
  const sep = <div style={{ height: 1, background: "#28282f", margin: "4px 0" }} />;

  const Item = ({ icon, label, shortcut, onClick, disabled }: {
    icon: React.ReactNode; label: string; shortcut?: string; onClick: () => void; disabled?: boolean;
  }) => (
    <div
      style={disabled ? disabledStyle : itemStyle}
      onMouseEnter={(e) => { if (!disabled) onItemEnter(e); }}
      onMouseLeave={(e) => { if (!disabled) onItemLeave(e); }}
      onClick={() => { if (!disabled) onClick(); }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {icon}
        {label}
      </span>
      {shortcut && (
        <span style={{ color: "#3a3a42", fontSize: 9 }}>{shortcut}</span>
      )}
    </div>
  );

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: x, top: y,
        zIndex: 9999,
        background: "#15151b",
        border: "1px solid #28282f",
        borderRadius: 4,
        padding: "4px 0",
        minWidth: 240,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
      }}
    >
      <Item icon={<X size={11} />} label="Close" shortcut="⌘W" onClick={onCloseTab} />
      <Item icon={<X size={11} />} label="Close Others" onClick={onCloseOthers} disabled={isOnly} />
      <Item icon={<X size={11} />} label="Close to the Left" onClick={onCloseLeft} disabled={isFirst} />
      <Item icon={<X size={11} />} label="Close to the Right" onClick={onCloseRight} disabled={isLast} />
      <Item icon={<X size={11} />} label="Close All" onClick={onCloseAll} />
      {sep}
      <Item
        icon={tab.isPinned ? <PinOff size={11} /> : <Pin size={11} />}
        label={tab.isPinned ? "Unpin" : "Pin"}
        onClick={onTogglePin}
      />
      {sep}
      <Item icon={<Copy size={11} />} label="Copy Path" onClick={onCopyPath} />
    </div>
  );
}

interface BreadcrumbSegmentProps {
  label: string;
  isLast: boolean;
  siblings: FileNode[];
  onSelectFile?: (node: FileNode) => void;
}

/**
 * Recursive tree row inside the breadcrumb dropdown.
 * Folders can be expanded to reveal children indented.
 */
function DropdownTreeRow({
  node,
  depth,
  expandedSet,
  toggleExpanded,
  currentName,
  onSelectFile,
  closeDropdown,
}: {
  node: FileNode;
  depth: number;
  expandedSet: Set<string>;
  toggleExpanded: (id: string) => void;
  currentName: string;
  onSelectFile?: (node: FileNode) => void;
  closeDropdown: () => void;
}) {
  const isCurrent = node.name === currentName;
  const isFolder = node.type === "folder";
  const isExpanded = expandedSet.has(node.id);
  const sortedChildren = isFolder && node.children
    ? [...node.children].sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  return (
    <>
      <button
        className="w-full flex items-center gap-2 text-left transition-colors"
        style={{
          padding: "6px 12px",
          paddingLeft: 12 + depth * 14,
          background: isCurrent ? C.accentDim : "transparent",
          color: isCurrent ? C.accent : C.textMid,
          fontFamily: FONTS.mono,
          fontSize: 10,
          border: "none",
          borderLeft: `2px solid ${isCurrent ? C.accent : "transparent"}`,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          if (!isCurrent) {
            (e.currentTarget as HTMLElement).style.background = C.surfaceAlt;
            (e.currentTarget as HTMLElement).style.color = C.text;
          }
        }}
        onMouseLeave={(e) => {
          if (!isCurrent) {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = C.textMid;
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (isFolder) {
            toggleExpanded(node.id);
          } else if (onSelectFile) {
            onSelectFile(node);
            closeDropdown();
          }
        }}
      >
        {isFolder ? (
          <ChevronRight
            size={9}
            style={{
              color: C.textFaint,
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.12s",
              flexShrink: 0,
            }}
          />
        ) : (
          <span style={{ width: 9, flexShrink: 0 }} />
        )}
        {getSmallIcon(node.name, node.type)}
        <span className="truncate flex-1">{node.name}</span>
        {isCurrent && (
          <span style={{
            fontFamily: FONTS.mono, fontSize: 8,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: C.accent,
            padding: "1px 6px",
            border: `1px solid ${C.accentLine}`,
            borderRadius: 2,
          }}>
            current
          </span>
        )}
      </button>
      {isFolder && isExpanded && sortedChildren.map((child) => (
        <DropdownTreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          expandedSet={expandedSet}
          toggleExpanded={toggleExpanded}
          currentName={currentName}
          onSelectFile={onSelectFile}
          closeDropdown={closeDropdown}
        />
      ))}
    </>
  );
}

function BreadcrumbSegment({ label, isLast, siblings, onSelectFile }: BreadcrumbSegmentProps) {
  const [open, setOpen] = useState(false);
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // Position the dropdown below the button using a portal
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 2, left: rect.left });
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const toggleExpanded = (id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sorted = [...siblings].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <button
        ref={buttonRef}
        className="flex items-center gap-1 transition-colors"
        style={{
          padding: "2px 6px",
          borderRadius: 3,
          background: open ? C.surfaceAlt : "transparent",
          color: isLast ? C.accent : C.textMid,
          fontFamily: FONTS.mono,
          fontSize: 10,
          letterSpacing: "0.02em",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.background = C.surfaceAlt;
            if (!isLast) e.currentTarget.style.color = C.text;
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "transparent";
            if (!isLast) e.currentTarget.style.color = C.textMid;
          }
        }}
        onClick={() => setOpen((p) => !p)}
      >
        <span>{label}</span>
        <ChevronRight
          size={9}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            color: isLast ? C.accent : C.textFaint,
            transition: "transform 0.15s",
          }}
        />
      </button>

      {open && sorted.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed overflow-hidden min-w-[260px] max-w-[420px] max-h-[400px] overflow-y-auto"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              zIndex: 9999,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              fontFamily: FONTS.mono,
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
            }}
          >
            {sorted.map((node) => (
              <DropdownTreeRow
                key={node.id}
                node={node}
                depth={0}
                expandedSet={expandedSet}
                toggleExpanded={toggleExpanded}
                currentName={label}
                onSelectFile={onSelectFile}
                closeDropdown={() => setOpen(false)}
              />
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

interface BreadcrumbBarProps {
  filePath: string;
  allFiles: FileNode[];
  onSelectFile?: (node: FileNode) => void;
}

function BreadcrumbBar({ filePath, allFiles, onSelectFile }: BreadcrumbBarProps) {
  const parts = filePath.split("/");

  return (
    <div
      className="flex items-center gap-0 overflow-x-auto"
      style={{
        position: "relative",
        zIndex: 0,  // must be below Monaco's hover widget (z-index ~50)
        height: 26,
        minHeight: 26,
        padding: "0 14px",
        background: C.bg,
        borderBottom: `1px solid ${C.border}`,
        fontFamily: FONTS.mono,
      }}
      data-testid="editor-breadcrumb"
    >
      {/* Editorial path label */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.accent,
          marginRight: 12,
          flexShrink: 0,
        }}
      >
        / PATH
      </span>
      {parts.map((part, i) => {
        const siblings = findSiblings(allFiles, parts, i);
        const isLast = i === parts.length - 1;

        return (
          <BreadcrumbSegment
            key={`${part}-${i}`}
            label={part}
            isLast={isLast}
            siblings={siblings}
            onSelectFile={onSelectFile}
          />
        );
      })}
    </div>
  );
}

// ── Editor Area ──

// ── Inline Chat: Rich content renderer ──
// Parses AI responses for:
//   1. <delegate_to_agent> blocks → renders as tool pills with "Send to Agent" button
//   2. ```code blocks``` → renders with "Copy" button
//   3. Plain text → rendered as-is
function renderInlineChatContent(text: string) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Check for delegate_to_agent block
    const delegateMatch = remaining.match(/<delegate_to_agent>\s*<task>([\s\S]*?)<\/task>\s*<file>([\s\S]*?)<\/file>\s*<\/delegate_to_agent>/);
    // Check for code block
    const cbMatch = remaining.match(/```(\w*)\n([\s\S]*?)```/);

    const dIdx = delegateMatch ? remaining.indexOf(delegateMatch[0]) : -1;
    const cbIdx = cbMatch ? remaining.indexOf(cbMatch[0]) : -1;

    if (dIdx === -1 && cbIdx === -1) {
      if (remaining.trim()) parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const useDelegate = dIdx !== -1 && (cbIdx === -1 || dIdx < cbIdx);
    const matchIdx = useDelegate ? dIdx : cbIdx;
    const match = useDelegate ? delegateMatch! : cbMatch!;

    const before = remaining.slice(0, matchIdx);
    if (before.trim()) parts.push(<span key={key++}>{before}</span>);

    if (useDelegate) {
      parts.push(
        <InlineChatDelegatePill
          key={key++}
          task={delegateMatch![1].trim()}
          file={delegateMatch![2].trim()}
        />,
      );
    } else {
      parts.push(
        <InlineChatCodeBlock key={key++} code={cbMatch![2]} lang={cbMatch![1] || ""} />,
      );
    }

    remaining = remaining.slice(matchIdx + match[0].length);
  }

  return <>{parts}</>;
}

// Track which delegate tasks have been sent so we don't double-fire
// when the pill remounts (streaming → history transition causes remount).
const _sentDelegates = new Set<string>();

// Delegate-to-agent pill — auto-executes once, sends task to chat panel
function InlineChatDelegatePill({ task, file }: { task: string; file: string }) {
  const dedupeKey = `${file}::${task.slice(0, 80)}`;
  const alreadySent = _sentDelegates.has(dedupeKey);
  const [status, setStatus] = useState<"sending" | "sent">(alreadySent ? "sent" : "sending");

  useEffect(() => {
    if (_sentDelegates.has(dedupeKey)) {
      setStatus("sent");
      return;
    }
    _sentDelegates.add(dedupeKey);

    const prompt = `In file \`${file}\`:\n\n${task}`;
    window.dispatchEvent(new CustomEvent("pipilot:attach-file", { detail: { filePath: file } }));
    window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", {
        detail: { prefill: prompt, submit: true },
      }));
      setStatus("sent");
    }, 300);
  }, [dedupeKey]);

  return (
    <div style={{
      margin: "6px 0", padding: "8px 10px", borderRadius: 5,
      background: `${C.accent}10`, border: `1px solid ${C.accent}30`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
        background: status === "sent" ? "hsl(142 50% 30%)" : `${C.accent}25`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: status === "sent" ? "#6ee7b7" : C.accent,
        fontSize: 10, fontWeight: 700,
      }}>
        {status === "sent" ? "\u2713" : "\u2022"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: status === "sent" ? "#6ee7b7" : C.accent, fontFamily: "monospace", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 2 }}>
          {status === "sent" ? "Sent to Agent" : "Sending to Agent\u2026"}
        </div>
        <div style={{ fontSize: 11, color: "hsl(220 14% 70%)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task}</div>
        <div style={{ fontSize: 9, color: "hsl(220 14% 40%)", marginTop: 1, fontFamily: "monospace" }}>{file}</div>
      </div>
    </div>
  );
}

// Code block with Copy button
function InlineChatCodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{
      margin: "6px 0", borderRadius: 5, overflow: "hidden",
      border: "1px solid hsl(220 13% 24%)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 10px", background: "hsl(220 13% 16%)",
        borderBottom: "1px solid hsl(220 13% 24%)",
      }}>
        {lang && <span style={{ fontSize: 9, color: "hsl(220 14% 40%)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{lang}</span>}
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{
            padding: "2px 8px", fontSize: 9, fontFamily: "monospace",
            background: "transparent", color: copied ? C.accent : "hsl(220 14% 50%)",
            border: `1px solid ${copied ? C.accent + "50" : "hsl(220 13% 28%)"}`,
            borderRadius: 3, cursor: "pointer", marginLeft: "auto",
          }}
        >
          {copied ? "\u2713 Copied" : "Copy"}
        </button>
      </div>
      <div style={{
        padding: "8px 10px", fontSize: 11, fontFamily: "monospace",
        background: "hsl(220 13% 11%)", color: "hsl(220 14% 82%)",
        whiteSpace: "pre-wrap", lineHeight: 1.5,
        maxHeight: 180, overflowY: "auto",
      }}>
        {code}
      </div>
    </div>
  );
}

export function EditorArea({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onContentChange,
  allFiles = [],
  onSelectFile,
  onOpenPreview,
  projectType = "static",
  onCloseOtherTabs,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseAllTabs,
  onTogglePinTab,
  onReorderTabs,
}: EditorAreaProps) {
  const editorRef = useRef<unknown>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  const changeTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const { get: getSetting } = useSettings();
  // Tab context menu + drag state
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const { activeProjectId } = useActiveProject();
  const { problems } = useProblems();

  // ── Inline chat state ──
  const [inlineChat, setInlineChat] = useState<{
    top: number; left: number; line: number; col: number;
    selection?: string; filePath?: string; fileContent?: string; language?: string;
  } | null>(null);
  const [inlineChatInput, setInlineChatInput] = useState("");
  const [inlineChatLoading, setInlineChatLoading] = useState(false);
  const [inlineChatResponse, setInlineChatResponse] = useState("");
  const [inlineChatHistory, setInlineChatHistory] = useState<{ role: string; content: string }[]>([]);
  const inlineChatRef = useRef<HTMLInputElement>(null);
  const inlineChatResponseRef = useRef<HTMLDivElement>(null);

  // Listen for inline chat open events (from Ctrl+I context menu action)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const editor = editorRef.current as any;
      if (!editor || !detail) return;

      const model = editor.getModel?.();
      const selection = editor.getSelection?.();
      let selectedText = "";
      if (selection && model && !selection.isEmpty()) {
        selectedText = model.getValueInRange(selection);
      }
      const filePath = model?.uri?.toString()?.replace(/^file:\/\/\//, "") || "";
      const fileContent = model?.getValue?.() || "";
      const language = model?.getLanguageId?.() || "plaintext";

      // Position the widget below the cursor
      const pos = { lineNumber: detail.line, column: detail.column };
      const coords = editor.getScrolledVisiblePosition?.(pos);
      const editorDom = editor.getDomNode?.();
      if (coords && editorDom) {
        const rect = editorDom.getBoundingClientRect();
        setInlineChat({
          top: rect.top + coords.top + coords.height + 4,
          left: Math.max(rect.left, rect.left + coords.left - 180),
          line: detail.line,
          col: detail.column,
          selection: selectedText,
          filePath,
          fileContent,
          language,
        });
        setInlineChatInput("");
        setInlineChatResponse("");
        setInlineChatLoading(false);
        setInlineChatHistory([]);
        setTimeout(() => inlineChatRef.current?.focus(), 50);
      }
    };
    window.addEventListener("pipilot:inline-chat", handler);
    return () => window.removeEventListener("pipilot:inline-chat", handler);
  }, []);

  // Codestral chat for inline widget — self-contained, doesn't touch main chat
  const sendInlineChat = useCallback(async () => {
    if (!inlineChatInput.trim() || inlineChatLoading || !inlineChat) return;
    const userMsg = inlineChatInput.trim();
    setInlineChatInput("");
    setInlineChatLoading(true);
    setInlineChatResponse("");

    // Build messages array with context + history
    // Smart file context for Codestral (256k context window).
    // ≤250 lines: send the entire file — model sees everything.
    // >250 lines: send a focused composite:
    //   1. Head section (imports, type defs, config — first 40 lines)
    //   2. Any exported function/class signatures (structural skeleton)
    //   3. Dense cursor window (~80 lines before, ~40 lines after)
    //   4. Tail (last 10 lines — often has exports/module.exports)
    const raw = inlineChat.fileContent || "";
    const lines = raw.split("\n");
    const totalLines = lines.length;
    const cur = inlineChat.line;
    let fileSnippet = "";

    if (totalLines <= 250) {
      fileSnippet = raw;
    } else if (raw) {
      const parts: string[] = [];

      // 1. Head — imports, type definitions, top-level config
      const headEnd = Math.min(40, cur - 1);
      if (headEnd > 0) {
        parts.push(lines.slice(0, headEnd).join("\n"));
        if (headEnd < cur - 80) {
          // 2. Structural skeleton — exported signatures between head and cursor window
          const skeletonLines: string[] = [];
          for (let i = headEnd; i < Math.max(headEnd, cur - 80); i++) {
            const ln = lines[i];
            if (/^(export\s|const\s+\w+|function\s+\w+|class\s+\w+|interface\s+\w+|type\s+\w+|enum\s+\w+)/.test(ln.trim())) {
              skeletonLines.push(`${i + 1}: ${ln}`);
            }
          }
          if (skeletonLines.length > 0) {
            parts.push(`\n// ... signatures between lines ${headEnd + 1}-${cur - 80} ...\n${skeletonLines.join("\n")}`);
          } else {
            parts.push(`\n// ... (lines ${headEnd + 1}-${Math.max(headEnd, cur - 80)} omitted) ...`);
          }
        }
      }

      // 3. Dense cursor window — this is where the user is working
      const winStart = Math.max(0, cur - 80);
      const winEnd = Math.min(totalLines, cur + 40);
      parts.push(lines.slice(winStart, winEnd).join("\n"));

      // 4. After cursor — skeleton of what comes next
      if (winEnd < totalLines - 10) {
        const afterSigs: string[] = [];
        for (let i = winEnd; i < totalLines - 10; i++) {
          const ln = lines[i];
          if (/^(export\s|const\s+\w+|function\s+\w+|class\s+\w+|interface\s+\w+|type\s+\w+)/.test(ln.trim())) {
            afterSigs.push(`${i + 1}: ${ln}`);
          }
        }
        if (afterSigs.length > 0) {
          parts.push(`\n// ... signatures between lines ${winEnd + 1}-${totalLines - 10} ...\n${afterSigs.slice(0, 15).join("\n")}`);
        } else {
          parts.push(`\n// ... (lines ${winEnd + 1}-${totalLines - 10} omitted) ...`);
        }
      }

      // 5. Tail — often has module.exports, default export, app.listen, etc.
      if (totalLines > 10) {
        const tailStart = Math.max(winEnd, totalLines - 10);
        parts.push(lines.slice(tailStart).join("\n"));
      }

      fileSnippet = parts.join("\n");
    }

    const fileBlock = fileSnippet
      ? `\nFile: ${inlineChat.filePath} (${totalLines} lines, ${inlineChat.language}):\n\`\`\`${inlineChat.language}\n${fileSnippet}\n\`\`\`\n`
      : "";
    const selBlock = inlineChat.selection
      ? `\nSelected code:\n\`\`\`\n${inlineChat.selection}\n\`\`\`\n`
      : "";
    const systemMsg = {
      role: "system",
      content: `You are a concise coding assistant embedded in a code editor. The user is editing ${inlineChat.filePath || "a file"} at line ${inlineChat.line}.${fileBlock}${selBlock}
## Response rules
- Answer briefly and directly. Use markdown code blocks for code snippets.
- When the user asks you to EDIT, FIX, REFACTOR, or IMPROVE code in the file, use this XML tool to delegate the task to the main AI agent which has full file-editing capabilities:
<delegate_to_agent>
<task>Detailed description of exactly what to change</task>
<file>the file path</file>
</delegate_to_agent>
- Only use ONE delegate_to_agent block per response. Be specific in the task description.
- For questions, explanations, or showing NEW code snippets, respond normally with markdown.
- Keep explanations minimal — the user can ask follow-ups.`,
    };
    const newHistory = [...inlineChatHistory, { role: "user", content: userMsg }];
    setInlineChatHistory(newHistory);

    try {
      const res = await fetch("/api/codestral/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "codestral-latest",
          messages: [systemMsg, ...newHistory],
          temperature: 0.3,
          max_tokens: 1024,
          stream: true,
        }),
      });

      if (!res.ok) throw new Error(`${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullResponse += delta;
              setInlineChatResponse(fullResponse);
              // Auto-scroll response area
              if (inlineChatResponseRef.current) {
                inlineChatResponseRef.current.scrollTop = inlineChatResponseRef.current.scrollHeight;
              }
            }
          } catch {}
        }
      }

      setInlineChatHistory((prev) => {
        const updated = [...prev, { role: "assistant", content: fullResponse }];
        // If the AI used the delegate tool, add a system confirmation so it
        // knows the task was sent and the agent is working on it.
        if (/<delegate_to_agent>/.test(fullResponse)) {
          updated.push({
            role: "user",
            content: "[System] Task has been sent to the PiPilot Agent. The agent is now working on the changes. You can inform the user that the edit is in progress.",
          });
        }
        return updated;
      });
    } catch (err: any) {
      setInlineChatResponse(`Error: ${err.message}`);
    } finally {
      setInlineChatLoading(false);
      setTimeout(() => inlineChatRef.current?.focus(), 50);
    }
  }, [inlineChatInput, inlineChatLoading, inlineChat, inlineChatHistory]);

  // Push current AI settings into the inline AI runtime config on every render
  // so changes to "Inline AI enabled / delay / context lines" take effect live.
  configureInlineAI({
    enabled: getSetting("aiInlineEnabled") !== "false",
    keystrokeDebounce: parseInt(getSetting("aiInlineDelay")) || 80,
    contextLinesBefore: parseInt(getSetting("aiContextLines")) || 30,
  });

  const activeTab = tabs.find((t) => t.node.id === activeTabId);

  const monacoRef = useRef<any>(null);

  // ── Sync problems to Monaco markers (inline squiggly underlines) ──
  useEffect(() => {
    if (!monacoRef.current || !problems) return;
    const m = monacoRef.current;

    // Group problems by file
    const byFile = new Map<string, Problem[]>();
    for (const p of problems) {
      if (!p.file || !p.line) continue;
      const list = byFile.get(p.file) || [];
      list.push(p);
      byFile.set(p.file, list);
    }

    // Set markers on all open models
    for (const model of m.editor.getModels()) {
      const uri = model.uri.path?.replace(/^\//, "") || "";
      // Match problems to model by file path (end-match for relative paths)
      let matched: Problem[] = [];
      for (const [file, probs] of byFile) {
        if (uri === file || uri.endsWith(file) || file.endsWith(uri.split("/").pop() || "__none__")) {
          matched = probs;
          break;
        }
      }

      m.editor.setModelMarkers(model, "pipilot-problems", matched.map((p) => ({
        severity: p.type === "error" ? m.MarkerSeverity.Error
          : p.type === "warning" ? m.MarkerSeverity.Warning
          : m.MarkerSeverity.Info,
        message: p.message,
        startLineNumber: p.line || 1,
        startColumn: p.column || 1,
        endLineNumber: p.line || 1,
        endColumn: (p.column || 1) + 200,
        source: p.source,
        code: p.code || undefined,
      })));
    }
  }, [problems]);

  // ── Push settings into the running Monaco editor ──
  // Listen for the `pipilot:setting-changed` event (fired by both
  // SettingsPanel and SettingsTabView on every save) and read fresh
  // values from localStorage. This is more reliable than depending on
  // useLiveQuery propagation across portals / separate React sub-trees.
  useEffect(() => {
    function applyEditorSettings() {
      const editor = editorRef.current;
      if (!editor) return;
      const g = (k: string, fallback: string) => {
        try { return localStorage.getItem(`pipilot:${k}`) ?? fallback; } catch { return fallback; }
      };
      editor.updateOptions({
        fontSize: parseInt(g("editorFontSize", "14")) || 14,
        fontFamily: g("editorFontFamily", "'Cascadia Code', 'Fira Code', 'Menlo', monospace"),
        fontLigatures: g("editorFontLigatures", "true") !== "false",
        tabSize: parseInt(g("editorTabSize", "2")) || 2,
        wordWrap: (g("editorWordWrap", "off")) as "on" | "off" | "wordWrapColumn",
        minimap: { enabled: g("editorMinimap", "false") === "true", scale: 1 },
        renderWhitespace: (g("editorRenderWhitespace", "selection")) as "none" | "selection" | "all",
        formatOnPaste: g("formatOnSave", "false") === "true",
        formatOnType: g("formatOnSave", "false") === "true",
      });
    }

    // Apply once on mount (in case settings were changed before this editor existed)
    if (editorMounted) applyEditorSettings();

    // React to every settings change in real-time
    const handler = (e: Event) => {
      const { key } = (e as CustomEvent).detail || {};
      // Only re-apply if it's an editor-related setting
      if (key?.startsWith("editor") || key === "formatOnSave") {
        applyEditorSettings();
      }
    };
    window.addEventListener("pipilot:setting-changed", handler);
    return () => window.removeEventListener("pipilot:setting-changed", handler);
  }, [editorMounted]);

  // ── Monaco theme wiring ──
  // IDELayout applies the IDE-wide theme by toggling the .dark class on <html>
  // and dispatches this event so we can also swap the Monaco editor theme.
  useEffect(() => {
    function onMonacoThemeChanged(e: Event) {
      const { theme } = (e as CustomEvent<{ theme: string }>).detail ?? {};
      if (!theme || !monacoRef.current) return;
      try {
        monacoRef.current.editor.setTheme(theme);
      } catch {}
    }
    window.addEventListener("pipilot:monaco-theme-changed", onMonacoThemeChanged);
    return () => window.removeEventListener("pipilot:monaco-theme-changed", onMonacoThemeChanged);
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorMounted(true);

    // Register Ctrl/Cmd+S → "Saved" toast. Content is already persisted
    // live via onContentChange → updateFileContent, so the shortcut only
    // needs to clear the dirty flag and give the user visible feedback.
    // Prevents the browser's default "Save Page As…" dialog from opening.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      window.dispatchEvent(new CustomEvent("pipilot:file-saved"));
      window.dispatchEvent(new CustomEvent("pipilot:notify", {
        detail: { type: "success", title: "Saved", message: "" },
      }));
    });

    // ── Context menu: Add File to Chat ──
    editor.addAction({
      id: "pipilot.addFileToChat",
      label: "Add File to Chat",
      contextMenuGroupId: "pipilot",
      contextMenuOrder: 1,
      run: () => {
        const model = editor.getModel();
        if (!model) return;
        const uri = model.uri.toString();
        // Extract file path from uri (file:///path)
        const filePath = uri.replace(/^file:\/\/\//, "");
        window.dispatchEvent(new CustomEvent("pipilot:attach-file", {
          detail: { filePath },
        }));
        window.dispatchEvent(new CustomEvent("pipilot:notify", {
          detail: { type: "success", title: "Added to chat", message: filePath.split("/").pop() || filePath },
        }));
      },
    });

    // ── Context menu: Open Inline Chat (Ctrl+I) ──
    editor.addAction({
      id: "pipilot.openInlineChat",
      label: "Open Inline Chat",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      contextMenuGroupId: "pipilot",
      contextMenuOrder: 2,
      run: (ed) => {
        window.dispatchEvent(new CustomEvent("pipilot:inline-chat", {
          detail: {
            line: ed.getPosition()?.lineNumber || 1,
            column: ed.getPosition()?.column || 1,
          },
        }));
      },
    });

    // Helper: get meaningful text from the editor – selected text, or
    // fall back to the full current line (or word at cursor).
    const getEditorText = (ed: monaco.editor.IStandaloneCodeEditor): string => {
      const model = ed.getModel();
      if (!model) return "";
      const selection = ed.getSelection();
      if (selection && !selection.isEmpty()) {
        const sel = model.getValueInRange(selection);
        if (sel.trim()) return sel;
      }
      // Fallback: current line
      const pos = ed.getPosition();
      if (!pos) return "";
      const line = model.getLineContent(pos.lineNumber).trim();
      if (line) return line;
      // Last resort: word at cursor
      const wordInfo = model.getWordAtPosition(pos);
      return wordInfo?.word ?? "";
    };

    // ── Context menu: Explain ──
    editor.addAction({
      id: "pipilot.explain",
      label: "Explain",
      contextMenuGroupId: "pipilot",
      contextMenuOrder: 3,
      run: (ed) => {
        const text = getEditorText(ed);
        if (!text) return;
        window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", {
            detail: { prefill: `Explain this code:\n\`\`\`\n${text}\n\`\`\``, submit: true },
          }));
          window.dispatchEvent(new CustomEvent("pipilot:clear-attachments"));
        }, 200);
      },
    });

    // ── Context menu: Review ──
    editor.addAction({
      id: "pipilot.review",
      label: "Review",
      contextMenuGroupId: "pipilot",
      contextMenuOrder: 4,
      run: (ed) => {
        const text = getEditorText(ed);
        if (!text) return;
        window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", {
            detail: { prefill: `Review this code for bugs, performance issues, and best practices:\n\`\`\`\n${text}\n\`\`\``, submit: true },
          }));
          window.dispatchEvent(new CustomEvent("pipilot:clear-attachments"));
        }, 200);
      },
    });

    // Apply editorial theme (defined at module scope, also registered in
    // beforeMount to avoid the brief vs-dark flash on first mount).
    try {
      monaco.editor.defineTheme("pipilot-editorial", PIPILOT_EDITORIAL_THEME);
      monaco.editor.setTheme("pipilot-editorial");
    } catch (err) {
      console.warn("Failed to register pipilot-editorial theme:", err);
    }

    // Configure TypeScript with proper module resolution
    const tsDefaults = monaco.languages.typescript.typescriptDefaults;
    const jsDefaults = monaco.languages.typescript.javascriptDefaults;

    const compilerOptions: any = {
      target: monaco.languages.typescript.ScriptTarget.Latest,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      strict: false,
      noEmit: true,
      skipLibCheck: true,
      baseUrl: ".",
      paths: { "@/*": ["src/*"] },
    };

    tsDefaults.setCompilerOptions(compilerOptions);
    jsDefaults.setCompilerOptions(compilerOptions);

    // Enable semantic validation but suppress some noise
    tsDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [
        2307, // Cannot find module
        2304, // Cannot find name
        7016, // Could not find declaration file
        2792, // Cannot find module (moduleResolution)
        1259, // Module can only be default-imported
        2686, // UMD global reference
        1375, // await at top level
        2345, // Argument type not assignable
        2322, // Type not assignable
        2875, // JSX tag requires module path 'react/jsx-runtime'
        2503, // Cannot find namespace
        2694, // Namespace has no exported member
        2695, // Left side of comma operator is unused
        1005, // ';' expected (JSX)
        1382, // Unused directive
        6133, // Declared but never read
        2339, // Property does not exist on type (too noisy without full types)
      ],
    });
    jsDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [2307, 2304, 7016, 2792, 1259, 2686, 1375, 8006, 8010, 2875, 2503, 6133],
    });

    // Enable eager model sync for Ctrl+Click navigation
    tsDefaults.setEagerModelSync(true);
    jsDefaults.setEagerModelSync(true);

    // Add essential global type stubs
    tsDefaults.addExtraLib(`
declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module "react/jsx-dev-runtime" { export const jsxDEV: any; export const Fragment: any; }
declare namespace NodeJS {
  type Timeout = ReturnType<typeof setTimeout>;
  type Timer = ReturnType<typeof setTimeout>;
  type Immediate = ReturnType<typeof setImmediate>;
  interface ProcessEnv { [key: string]: string | undefined; NODE_ENV: string; }
  interface Process { env: ProcessEnv; cwd(): string; argv: string[]; platform: string; exit(code?: number): never; }
  interface ReadableStream { read(): any; on(event: string, listener: Function): this; pipe(dest: any): any; }
  interface WritableStream { write(data: any): boolean; end(): void; on(event: string, listener: Function): this; }
  interface EventEmitter { on(event: string, listener: Function): this; emit(event: string, ...args: any[]): boolean; removeListener(event: string, listener: Function): this; }
}
declare var process: NodeJS.Process;
declare var __dirname: string;
declare var __filename: string;
declare var Buffer: { from(data: any, encoding?: string): any; alloc(size: number): any; isBuffer(obj: any): boolean; };
declare function require(module: string): any;
declare var module: { exports: any };
declare var exports: any;
declare module "*.css" { const content: Record<string, string>; export default content; }
declare module "*.module.css" { const content: Record<string, string>; export default content; }
declare module "*.svg" { const content: any; export default content; }
declare module "*.png" { const content: string; export default content; }
declare module "*.jpg" { const content: string; export default content; }
declare module "*.gif" { const content: string; export default content; }
declare module "*.webp" { const content: string; export default content; }
declare module "*.json" { const content: any; export default content; }
declare module "*.woff" { const content: string; export default content; }
declare module "*.woff2" { const content: string; export default content; }
`, "file:///global.d.ts");

    // ── AI Quick Fix provider ──
    // Registers a CodeActionProvider that offers "Fix with AI" for any
    // diagnostic marker. Calls Codestral to generate a SEARCH/REPLACE fix.
    // ── AI Quick Fix: one-click, no submenu ──
    // Instead of returning code actions (which Monaco shows in a picker),
    // we register a custom lightbulb-click handler. When the user clicks
    // the lightbulb (or presses Ctrl+.), we intercept it and immediately
    // send the first diagnostic to the chat panel — no intermediate menu.
    editor.addAction({
      id: "pipilot.quickFix",
      label: "Quick Fix with AI (Ctrl+.)",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period],
      run: (ed) => {
        const model = ed.getModel();
        const pos = ed.getPosition();
        if (!model || !pos) return;

        // Find diagnostics at or near the cursor
        const allMarkers = monaco.editor.getModelMarkers({ resource: model.uri });
        const atCursor = allMarkers.filter(
          (m) =>
            m.severity >= monaco.MarkerSeverity.Warning &&
            pos.lineNumber >= m.startLineNumber &&
            pos.lineNumber <= m.endLineNumber,
        );
        // Fallback: nearest marker on the same line
        const onLine = atCursor.length > 0
          ? atCursor
          : allMarkers.filter(
              (m) => m.severity >= monaco.MarkerSeverity.Warning && m.startLineNumber === pos.lineNumber,
            );
        const marker = onLine[0] || allMarkers.find((m) => m.severity >= monaco.MarkerSeverity.Warning);

        if (!marker) {
          // No diagnostics — fall back to Monaco's default quick fix
          ed.trigger("pipilot", "editor.action.quickFix", {});
          return;
        }

        const filePath = model.uri.path.replace(/^\//, "");
        const errorLine = marker.startLineNumber;
        const startLine = Math.max(1, errorLine - 10);
        const endLine = Math.min(model.getLineCount(), errorLine + 10);
        const contextCode = model.getValueInRange({
          startLineNumber: startLine, startColumn: 1,
          endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine),
        });

        const prompt = `Fix this error in ${filePath} at line ${errorLine}:\n\n**Error:** ${marker.message}${marker.code ? ` (${marker.code})` : ""}\n\n\`\`\`${model.getLanguageId()}\n${contextCode}\n\`\`\`\n\nPlease fix the error and edit the file.`;

        window.dispatchEvent(new CustomEvent("pipilot:attach-file", { detail: { filePath } }));
        window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", {
            detail: { prefill: prompt, submit: true },
          }));
        }, 200);
      },
    });

    // ── CodeActionProvider for lightbulb "Fix with AI" menu ──
    // Shows a lightbulb on lines with errors/warnings. Clicking it
    // offers "Fix with AI" which sends the error to the chat agent.
    monaco.languages.registerCodeActionProvider("*", {
      provideCodeActions(model, range) {
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })
          .filter((m) => m.severity >= monaco.MarkerSeverity.Warning &&
            range.startLineNumber <= m.endLineNumber && range.endLineNumber >= m.startLineNumber);
        if (markers.length === 0) return { actions: [], dispose() {} };

        const actions = markers.slice(0, 3).map((marker) => ({
          title: `Fix with AI: ${marker.message.slice(0, 60)}${marker.message.length > 60 ? "..." : ""}`,
          kind: "quickfix",
          diagnostics: [marker],
          isPreferred: true,
          command: {
            id: "pipilot.quickFix",
            title: "Fix with AI",
          },
        }));
        return { actions, dispose() {} };
      },
    });

    // Register inline AI completion provider (Copilot-like ghost text)
    // Uses background-poll architecture: synchronous cache reads in
    // provideInlineCompletions, async fetcher fills the cache while typing
    try {
      const aiDisposable = setupInlineAI(monaco, editor);
      (editor as any).__pipilotInlineAI = aiDisposable;
    } catch (err) {
      console.warn("Inline AI setup failed:", err);
    }
  };

  // Listen for "goto-line" events (e.g. from Problems panel) and jump
  // the active editor's cursor to that location.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.filePath || !activeTab) return;
      // Only jump if the active tab matches the requested file
      if (activeTab.node.id !== detail.filePath) return;
      const editor = editorRef.current;
      if (!editor) return;
      try {
        const lineNumber = Math.max(1, detail.line || 1);
        const column = Math.max(1, detail.column || 1);
        editor.revealLineInCenterIfOutsideViewport(lineNumber);
        editor.setPosition({ lineNumber, column });
        editor.focus();
      } catch (err) {
        console.warn("goto-line failed", err);
      }
    };
    window.addEventListener("pipilot:goto-line", handler);
    return () => window.removeEventListener("pipilot:goto-line", handler);
  }, [activeTab]);

  // Editor action dispatcher — TitleBar's Edit menu fires `pipilot:editor-action`
  // events ({ action: "undo" | "redo" | "find" | "replace" | "save" }).
  // We focus the editor first (the menu click steals focus) and use Monaco's
  // canonical action IDs. If no file is open, dispatch a `pipilot:notify`
  // event so the user gets visible feedback instead of a silent no-op.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action: string };
      const editor = editorRef.current as {
        trigger: (source: string, action: string, args: unknown) => void;
        focus: () => void;
        getAction?: (id: string) => { run: () => void } | null;
      } | null;

      if (!editor) {
        window.dispatchEvent(new CustomEvent("pipilot:notify", {
          detail: {
            type: "info",
            title: "No file open",
            message: `Open a file before using ${detail.action}.`,
          },
        }));
        return;
      }

      // Save is a no-op because content is already persisted live via
      // onContentChange → updateFileContent. Just clear dirty state and
      // give the user visible feedback.
      if (detail.action === "save") {
        window.dispatchEvent(new CustomEvent("pipilot:file-saved"));
        window.dispatchEvent(new CustomEvent("pipilot:notify", {
          detail: { type: "success", title: "Saved", message: "" },
        }));
        return;
      }

      // Defer one tick so the menu has fully closed and the editor can
      // accept focus before we trigger the action. Without this, find/replace
      // sometimes opens but immediately loses focus.
      setTimeout(() => {
        try {
          editor.focus();
          // Map our verbs to Monaco's canonical action IDs.
          const actionId =
            detail.action === "undo" ? "undo" :
            detail.action === "redo" ? "redo" :
            detail.action === "find" ? "actions.find" :
            detail.action === "replace" ? "editor.action.startFindReplaceAction" :
            null;
          if (!actionId) return;

          // Prefer getAction(...).run() — it's the public API and gives
          // proper error reporting. Fall back to trigger().
          const action = editor.getAction?.(actionId);
          if (action) {
            action.run();
          } else {
            editor.trigger("titlebar", actionId, null);
          }
        } catch (err) {
          console.warn("editor-action failed", err);
        }
      }, 0);
    };
    window.addEventListener("pipilot:editor-action", handler);
    return () => window.removeEventListener("pipilot:editor-action", handler);
  }, []);

  // Register all project files as Monaco models for Ctrl+Click navigation
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !allFiles?.length) return;

    function walkAndRegister(nodes: FileNode[]) {
      for (const node of nodes) {
        if (node.type === "file" && node.content != null) {
          const ext = node.name.split(".").pop()?.toLowerCase() || "";
          const langMap: Record<string, string> = {
            ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
            json: "json", css: "css", html: "html", md: "markdown", svg: "xml",
          };
          const lang = langMap[ext] || "plaintext";
          const uri = monaco.Uri.parse(`file:///${node.id}`);

          // Only create model if it doesn't exist yet
          if (!monaco.editor.getModel(uri)) {
            monaco.editor.createModel(node.content, lang, uri);
          } else {
            // Update content if changed
            const model = monaco.editor.getModel(uri);
            if (model && model.getValue() !== node.content) {
              model.setValue(node.content);
            }
          }
        }
        if (node.children) walkAndRegister(node.children);
      }
    }

    walkAndRegister(allFiles);
  }, [allFiles]);

  // Auto-fetch type definitions from the workspace's node_modules via our API
  const fetchedTypesRef = useRef(new Set<string>());
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !allFiles?.length || !projectType) return;

    // Find package.json in the file tree
    function findPackageJson(nodes: FileNode[]): string | null {
      for (const node of nodes) {
        if (node.name === "package.json" && node.content) return node.content;
        if (node.children) {
          const found = findPackageJson(node.children);
          if (found) return found;
        }
      }
      return null;
    }

    const pkgContent = findPackageJson(allFiles);
    if (!pkgContent) return;

    let deps: string[] = [];
    try {
      const pkg = JSON.parse(pkgContent);
      deps = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
      ];
    } catch { return; }

    const tsDefaults = monaco.languages.typescript.typescriptDefaults;

    for (const dep of deps) {
      if (fetchedTypesRef.current.has(dep)) continue;
      fetchedTypesRef.current.add(dep);

      // Fetch type definitions from the workspace's node_modules
      fetch(`/api/files/types?projectId=${encodeURIComponent(activeProjectId)}&package=${encodeURIComponent(dep)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data?.files) return;
          // Register all .d.ts files as extra libs
          for (const [filePath, content] of Object.entries(data.files)) {
            if (typeof content === "string") {
              const libPath = `file:///node_modules/${dep}/${filePath}`;
              tsDefaults.addExtraLib(content, libPath);
            }
          }
        })
        .catch(() => {
          // Fallback to CDN if workspace node_modules don't have types
          const typePkg = `@types/${dep.replace("@", "").replace("/", "__")}`;
          fetch(`https://cdn.jsdelivr.net/npm/${typePkg}/index.d.ts`)
            .then(r => r.ok ? r.text() : null)
            .then(dts => {
              if (dts) tsDefaults.addExtraLib(dts, `file:///node_modules/${dep}/index.d.ts`);
            })
            .catch(() => {});
        });
    }
  }, [allFiles, projectType, activeProjectId]);

  useEffect(() => {
    if (editorMounted && editorRef.current) {
      const editor = editorRef.current as {
        getModel: () => { getValue: () => string; setValue: (v: string) => void } | null;
      };
      if (activeTab?.node.content !== undefined) {
        const model = editor.getModel();
        if (model) {
          const currentValue = model.getValue();
          if (currentValue !== activeTab.node.content) {
            model.setValue(activeTab.node.content);
          }
        }
      }
    }
  }, [activeTabId, editorMounted, activeTab?.node.content]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!value || !activeTabId || !onContentChange) return;
      if (changeTimeoutRef.current) clearTimeout(changeTimeoutRef.current);
      changeTimeoutRef.current = setTimeout(() => {
        onContentChange(activeTabId, value);
      }, 500);
    },
    [activeTabId, onContentChange]
  );

  const getFileExt = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
  const getTabIcon = (name: string) => {
    const ext = getFileExt(name);
    switch (ext) {
      case "tsx": case "jsx":
        return <FileCode2 size={13} className="text-blue-400 flex-shrink-0" />;
      case "ts": case "js":
        return <FileCode2 size={13} className="text-yellow-400 flex-shrink-0" />;
      case "json":
        return <FileJson size={13} className="text-yellow-300 flex-shrink-0" />;
      case "css":
        return <FileType size={13} className="text-blue-400 flex-shrink-0" />;
      case "md":
        return <FileText size={13} className="text-blue-300 flex-shrink-0" />;
      default:
        return <FileText size={13} className="text-gray-400 flex-shrink-0" />;
    }
  };

  if (tabs.length === 0) {
    return <WelcomePage onOpenPreview={onOpenPreview} />;
  }

  const isPreviewTab = activeTab?.isPreview;
  const isCommitTab = activeTab?.isCommit;
  const isDiffTab = activeTab?.isDiff;
  const isSettingsTab = activeTab?.isSettings;
  const isWalkthroughTab = activeTab?.isWalkthrough;
  const isWikiTab = activeTab?.isWiki;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="editor-area">
      {/* Tab bar */}
      <div className="editor-tabs" data-testid="editor-tabs">
        {tabs.map((tab, idx) => {
          const isDragging = dragTabId === tab.node.id;
          const isDragOver = dragOverTabId === tab.node.id;
          return (
          <div
            key={tab.node.id}
            className={`editor-tab ${activeTabId === tab.node.id ? "active" : ""}`}
            onClick={() => onActivateTab(tab.node.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.node.id });
            }}
            onAuxClick={(e) => {
              // Middle-click closes tab — VS Code parity
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.node.id);
              }
            }}
            draggable={!!onReorderTabs}
            onDragStart={(e) => {
              if (!onReorderTabs) return;
              e.dataTransfer.setData("application/x-pipilot-tab", tab.node.id);
              e.dataTransfer.effectAllowed = "move";
              setDragTabId(tab.node.id);
            }}
            onDragEnd={() => { setDragTabId(null); setDragOverTabId(null); }}
            onDragOver={(e) => {
              if (!onReorderTabs || !dragTabId || dragTabId === tab.node.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverTabId(tab.node.id);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOverTabId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverTabId(null);
              if (!onReorderTabs || !dragTabId) return;
              const fromIdx = tabs.findIndex((t) => t.node.id === dragTabId);
              if (fromIdx < 0 || fromIdx === idx) return;
              onReorderTabs(fromIdx, idx);
              setDragTabId(null);
            }}
            style={{
              opacity: isDragging ? 0.4 : 1,
              ...(isDragOver && { boxShadow: "inset 2px 0 0 0 #c6ff3d" }),
            }}
            data-testid={`editor-tab-${tab.node.id}`}
          >
            {tab.isPinned && (
              <Pin size={9} style={{ color: "#c6ff3d", flexShrink: 0 }} />
            )}
            {tab.isPreview ? (
              <Globe size={13} className="text-green-400 flex-shrink-0" />
            ) : tab.isCommit ? (
              <GitCommit size={13} style={{ color: "hsl(207 90% 60%)" }} className="flex-shrink-0" />
            ) : tab.isDiff ? (
              <FileText size={13} style={{ color: "hsl(38 92% 60%)" }} className="flex-shrink-0" />
            ) : tab.isSettings ? (
              <Settings size={13} style={{ color: "hsl(220 14% 70%)" }} className="flex-shrink-0" />
            ) : tab.isWalkthrough ? (
              <BookOpen size={13} style={{ color: C.accent }} className="flex-shrink-0" />
            ) : tab.isWiki ? (
              <BookOpen size={13} style={{ color: "hsl(207 80% 65%)" }} className="flex-shrink-0" />
            ) : (
              getTabIcon(tab.node.name)
            )}
            <span className="truncate flex-1">{tab.node.name}</span>
            <button
              className="close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.node.id);
              }}
              data-testid={`editor-tab-close-${tab.node.id}`}
            >
              {tab.isDirty ? (
                <Circle size={10} className="fill-current" />
              ) : (
                <X size={12} />
              )}
            </button>
          </div>
          );
        })}

        {/* Open Preview button — editorial mono pill on the right of tabs */}
        {onOpenPreview && (
          <button
            onClick={onOpenPreview}
            title="Open Web Preview"
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "0 18px",
              height: "100%",
              fontFamily: FONTS.mono,
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: C.textDim,
              background: "transparent",
              border: "none",
              borderLeft: `1px solid ${C.border}`,
              cursor: "pointer",
              flexShrink: 0,
              transition: "color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = C.surface;
              e.currentTarget.style.color = C.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = C.textDim;
            }}
          >
            <Globe size={11} />
            <span>// Preview</span>
          </button>
        )}
      </div>

      {/* ── Tab context menu ── */}
      {tabMenu && (() => {
        const target = tabs.find((t) => t.node.id === tabMenu.tabId);
        if (!target) return null;
        const targetIdx = tabs.findIndex((t) => t.node.id === tabMenu.tabId);
        const close = () => setTabMenu(null);
        return createPortal(
          <TabContextMenu
            x={tabMenu.x}
            y={tabMenu.y}
            tab={target}
            isFirst={targetIdx === 0}
            isLast={targetIdx === tabs.length - 1}
            isOnly={tabs.length === 1}
            onClose={close}
            onCloseTab={() => { onCloseTab(target.node.id); close(); }}
            onCloseOthers={() => { onCloseOtherTabs?.(target.node.id); close(); }}
            onCloseLeft={() => { onCloseTabsToLeft?.(target.node.id); close(); }}
            onCloseRight={() => { onCloseTabsToRight?.(target.node.id); close(); }}
            onCloseAll={() => { onCloseAllTabs?.(); close(); }}
            onTogglePin={() => { onTogglePinTab?.(target.node.id); close(); }}
            onCopyPath={() => {
              navigator.clipboard.writeText(target.node.id).catch(() => {});
              close();
            }}
          />,
          document.body,
        );
      })()}

      {/* Breadcrumb — only for file tabs */}
      {activeTab && !isPreviewTab && !isCommitTab && !isDiffTab && !isSettingsTab && !isWalkthroughTab && !isWikiTab && (
        <BreadcrumbBar
          filePath={activeTab.node.id}
          allFiles={allFiles}
          onSelectFile={onSelectFile}
        />
      )}

      {/* Web Preview tab */}
      {isPreviewTab && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <WebPreview files={allFiles} projectType={projectType} />
          </div>
        </div>
      )}

      {/* Commit detail tab */}
      {isCommitTab && activeTab?.commitOid && activeProjectId && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <CommitDetailView projectId={activeProjectId} oid={activeTab.commitOid} />
        </div>
      )}

      {/* File diff tab */}
      {isDiffTab && activeTab?.diffPath && activeProjectId && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <FileDiffView
            projectId={activeProjectId}
            filePath={activeTab.diffPath}
            staged={activeTab.diffStaged ?? false}
          />
        </div>
      )}

      {/* Settings tab */}
      {isSettingsTab && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <SettingsTabView />
        </div>
      )}

      {/* Walkthrough tab */}
      {isWalkthroughTab && activeTab?.walkthroughId && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden auto" }}>
          <WalkthroughView walkthroughId={activeTab.walkthroughId} onOpenPreview={onOpenPreview} />
        </div>
      )}

      {/* Wiki tab */}
      {isWikiTab && activeTab?.wikiPageId && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <WikiTabView pageId={activeTab.wikiPageId} />
        </div>
      )}

      {/* FileViewer — rich preview for non-text files (image, svg, video, pdf, md, etc.) */}
      {!isPreviewTab && !isCommitTab && !isDiffTab && !isSettingsTab && !isWalkthroughTab && !isWikiTab && activeTab && shouldUseFileViewer(activeTab.node.name) && (
        <FileViewer
          key={`viewer-${activeTab.node.id}`}
          filePath={activeTab.node.id}
          fileName={activeTab.node.name}
          content={activeTab.node.content}
          renderCodeFallback={() => (
            <div className="flex-1 overflow-hidden" style={{ height: "100%" }}>
              <Editor
                key={`code-${activeTab.node.id}`}
                height="100%"
                language={activeTab.node.language ?? "plaintext"}
                path={`file:///${activeTab.node.id}`}
                defaultValue={activeTab.node.content ?? ""}
                theme="pipilot-editorial"
                beforeMount={(monaco) => {
                  try { monaco.editor.defineTheme("pipilot-editorial", PIPILOT_EDITORIAL_THEME); } catch {}
                }}
                onMount={handleMount}
                onChange={handleEditorChange}
                options={{
                  fontSize: parseInt(getSetting("editorFontSize")) || 14,
                  fontFamily: getSetting("editorFontFamily") || "'Cascadia Code', 'Fira Code', 'Menlo', monospace",
                  fontLigatures: getSetting("editorFontLigatures") !== "false",
                  lineNumbers: "on",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          )}
        />
      )}

      {/* Monaco Editor — for plain text/code file tabs */}
      {!isPreviewTab && !isCommitTab && !isDiffTab && !isSettingsTab && !isWalkthroughTab && !isWikiTab && activeTab && !shouldUseFileViewer(activeTab.node.name) && (
        <div className="flex-1 overflow-hidden" data-testid="monaco-editor">
          {activeTab && (
            <Editor
              key={activeTab.node.id}
              height="100%"
              language={activeTab.node.language ?? "plaintext"}
              path={`file:///${activeTab.node.id}`}
              defaultValue={activeTab.node.content ?? ""}
              theme="pipilot-editorial"
              beforeMount={(monaco) => {
                // Define the theme BEFORE the first render so the editor
                // doesn't briefly flash in vs-dark while mounting.
                try {
                  monaco.editor.defineTheme("pipilot-editorial", PIPILOT_EDITORIAL_THEME);
                } catch {}
              }}
              onMount={handleMount}
              onChange={handleEditorChange}
              options={{
                fontSize: parseInt(getSetting("editorFontSize")) || 14,
                fontFamily: getSetting("editorFontFamily") || "'Cascadia Code', 'Fira Code', 'Menlo', monospace",
                fontLigatures: getSetting("editorFontLigatures") !== "false",
                lineNumbers: "on",
                minimap: { enabled: getSetting("editorMinimap") === "true", scale: 1 },
                scrollBeyondLastLine: false,
                wordWrap: (getSetting("editorWordWrap") || "off") as "on" | "off" | "wordWrapColumn",
                tabSize: parseInt(getSetting("editorTabSize")) || 2,
                insertSpaces: true,
                automaticLayout: true,
                cursorBlinking: "smooth",
                smoothScrolling: true,
                renderWhitespace: (getSetting("editorRenderWhitespace") || "selection") as "none" | "selection" | "all",
                bracketPairColorization: { enabled: true },
                formatOnPaste: getSetting("formatOnSave") === "true",
                formatOnType: getSetting("formatOnSave") === "true",
                padding: { top: 8, bottom: 8 },
                scrollbar: {
                  vertical: "auto",
                  horizontal: "auto",
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                // AI inline completions (Copilot-like ghost text)
                inlineSuggest: {
                  enabled: getSetting("aiInlineEnabled") !== "false",
                  mode: "subwordSmart",
                  showToolbar: "always",
                },
                suggest: {
                  preview: true,
                  showInlineDetails: true,
                },
                // Render hover tooltips, parameter hints, and other widgets
                // in a fixed overlay outside the editor's overflow container
                // so they aren't clipped by the breadcrumb bar above.
                fixedOverflowWidgets: true,
              }}
            />
          )}
        </div>
      )}

      {/* ── Inline Chat Widget (self-contained, powered by Codestral) ── */}
      {inlineChat && createPortal(
        <>
          {/* Backdrop to close on outside click */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10009 }}
            onClick={() => { setInlineChat(null); (editorRef.current as any)?.focus?.(); }}
          />
          <div
            style={{
              position: "fixed",
              top: Math.min(inlineChat.top, window.innerHeight - 360),
              left: Math.min(inlineChat.left, window.innerWidth - 420),
              zIndex: 10010,
              width: 400,
              maxHeight: 340,
              display: "flex",
              flexDirection: "column",
              background: "hsl(220 13% 14%)",
              border: `1px solid hsl(220 13% 26%)`,
              borderRadius: 8,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              overflow: "hidden",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setInlineChat(null);
                (editorRef.current as any)?.focus?.();
              }
            }}
          >
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px",
              borderBottom: "1px solid hsl(220 13% 22%)",
              fontFamily: "monospace", fontSize: 10, color: "hsl(220 14% 55%)",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              <span style={{ color: C.accent, fontWeight: 700 }}>AI</span>
              <span>Inline Chat</span>
              {inlineChat.selection && (
                <span style={{ marginLeft: "auto", fontSize: 9, color: "hsl(220 14% 40%)" }}>
                  {inlineChat.selection.split("\n").length} lines selected
                </span>
              )}
              <button
                type="button"
                onClick={() => { setInlineChat(null); (editorRef.current as any)?.focus?.(); }}
                style={{ marginLeft: inlineChat.selection ? 0 : "auto", background: "none", border: "none", color: "hsl(220 14% 45%)", cursor: "pointer", padding: 0, display: "flex" }}
              >
                <X size={12} />
              </button>
            </div>

            {/* Response area (scrollable) */}
            {(inlineChatResponse || inlineChatHistory.length > 0) && (
              <div
                ref={inlineChatResponseRef}
                style={{
                  flex: 1, minHeight: 0, maxHeight: 220,
                  overflowY: "auto", padding: "10px 12px",
                  fontFamily: "monospace", fontSize: 12, lineHeight: 1.6,
                  color: "hsl(220 14% 80%)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}
              >
                {/* Show conversation history with rich code block rendering */}
                {inlineChatHistory.map((msg, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    {msg.role === "user" ? (
                      <div style={{ color: "hsl(220 14% 50%)", fontSize: 10, marginBottom: 3 }}>You:</div>
                    ) : (
                      <div style={{ color: C.accent, fontSize: 10, marginBottom: 3 }}>AI:</div>
                    )}
                    <div style={{ color: msg.role === "user" ? "hsl(220 14% 65%)" : "hsl(220 14% 85%)" }}>
                      {msg.role === "assistant"
                        ? renderInlineChatContent(msg.content)
                        : msg.content}
                    </div>
                  </div>
                ))}
                {/* Streaming response (not yet in history) */}
                {inlineChatLoading && inlineChatResponse && (
                  <div>
                    <div style={{ color: C.accent, fontSize: 10, marginBottom: 3 }}>AI:</div>
                    <div>{renderInlineChatContent(inlineChatResponse)}</div>
                  </div>
                )}
                {inlineChatLoading && !inlineChatResponse && (
                  <div style={{ color: "hsl(220 14% 40%)", fontStyle: "italic" }}>Thinking...</div>
                )}
              </div>
            )}

            {/* Input area */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 8px",
              borderTop: (inlineChatResponse || inlineChatHistory.length > 0) ? "1px solid hsl(220 13% 22%)" : "none",
            }}>
              <input
                ref={inlineChatRef}
                value={inlineChatInput}
                onChange={(e) => setInlineChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendInlineChat();
                  }
                }}
                placeholder={inlineChatHistory.length > 0 ? "Follow up..." : "Ask AI about this code..."}
                disabled={inlineChatLoading}
                style={{
                  flex: 1, padding: "7px 10px",
                  background: "hsl(220 13% 10%)",
                  border: "1px solid hsl(220 13% 22%)",
                  borderRadius: 4,
                  color: "#e0e0e0",
                  fontFamily: "monospace",
                  fontSize: 12,
                  outline: "none",
                }}
                autoFocus
              />
              <button
                type="button"
                onClick={sendInlineChat}
                disabled={!inlineChatInput.trim() || inlineChatLoading}
                style={{
                  background: inlineChatInput.trim() && !inlineChatLoading ? C.accent : "transparent",
                  border: `1px solid ${inlineChatInput.trim() && !inlineChatLoading ? C.accent : "hsl(220 13% 26%)"}`,
                  borderRadius: 4, padding: "5px 8px",
                  color: inlineChatInput.trim() && !inlineChatLoading ? "hsl(220 13% 10%)" : "hsl(220 14% 40%)",
                  cursor: inlineChatInput.trim() && !inlineChatLoading ? "pointer" : "default",
                  display: "flex", alignItems: "center",
                  fontFamily: "monospace", fontSize: 10, fontWeight: 600,
                }}
              >
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
