import { useState, useCallback, useRef, useEffect } from "react";
import { COLORS as C, FONTS } from "@/lib/design-tokens";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage as ChatMessageType, ToolCallInfo, BuiltinToolStatus } from "@/hooks/useChat";
import {
  Bot,
  User,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  FileEdit,
  FilePlus,
  Trash2,
  Search,
  Globe,
  Image,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  RotateCcw,
  Check,
  GitBranch,
  FileSymlink,
  Network,
  Files,
  Sparkles,
  Clock,
  Camera,
  MousePointer,
  ArrowDownUp,
  Keyboard,
  ScanSearch,
  Play,
  Stethoscope,
  Server,
  Package,
  ScrollText,
  Terminal,
  Bookmark,
  CheckCircle,
  Redo2,
} from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
  onDelete?: (messageId: string) => void;
  onRevert?: (messageId: string) => void;
}

/* ─── Tool Metadata ──────────────────────────────────────────────────── */
/** Strip the mcp__pipilot__ prefix so our lookup maps work for custom tools. */
function normalizeToolName(name: string): string {
  return name.replace(/^mcp__pipilot__/, "");
}

function getToolIcon(name: string) {
  const n = normalizeToolName(name);
  const iconMap: Record<string, React.ReactNode> = {
    read_file: <FileText size={12} />,
    list_files: <FolderTree size={12} />,
    edit_file: <FileEdit size={12} />,
    create_file: <FilePlus size={12} />,
    delete_file: <Trash2 size={12} />,
    search_files: <Search size={12} />,
    get_file_info: <FileText size={12} />,
    rename_file: <FileSymlink size={12} />,
    copy_file: <Copy size={12} />,
    batch_create_files: <Files size={12} />,
    get_project_tree: <Network size={12} />,
    deploy_site: <Globe size={12} />,
    screenshot_preview: <Camera size={12} />,
    preview_click: <MousePointer size={12} />,
    preview_scroll: <ArrowDownUp size={12} />,
    preview_type: <Keyboard size={12} />,
    preview_find_elements: <ScanSearch size={12} />,
    run_script: <Play size={12} />,
    web_search: <Globe size={12} />,
    web_extract: <Globe size={12} />,
    image_generation: <Image size={12} />,
    // PiPilot custom tools
    get_diagnostics: <Stethoscope size={12} />,
    manage_dev_server: <Server size={12} />,
    search_npm: <Package size={12} />,
    get_dev_server_logs: <ScrollText size={12} />,
    update_project_context: <Network size={12} />,
    frontend_design_guide: <Sparkles size={12} />,
    analyze_ui: <ScanSearch size={12} />,
    screenshot_preview: <Camera size={12} />,
  };
  return iconMap[n] || <FileText size={12} />;
}

function getToolLabel(name: string) {
  const n = normalizeToolName(name);
  const labelMap: Record<string, string> = {
    read_file: "Read File",
    list_files: "List Files",
    edit_file: "Edit File",
    create_file: "Create File",
    delete_file: "Delete File",
    search_files: "Search Files",
    get_file_info: "File Info",
    rename_file: "Rename File",
    copy_file: "Copy File",
    batch_create_files: "Batch Create",
    get_project_tree: "Project Tree",
    deploy_site: "Deploy Site",
    screenshot_preview: "Screenshot Preview",
    preview_click: "Click Element",
    preview_scroll: "Scroll Preview",
    preview_type: "Type Text",
    preview_find_elements: "Find Elements",
    run_script: "Run Script",
    web_search: "Web Search",
    web_extract: "Extract Page",
    image_generation: "Generate Image",
    // PiPilot custom tools
    get_diagnostics: "Diagnostics",
    manage_dev_server: "Dev Server",
    search_npm: "npm Search",
    get_dev_server_logs: "Dev Logs",
    update_project_context: "Project Context",
    frontend_design_guide: "Design Guide",
    analyze_ui: "Analyze UI",
  };
  return labelMap[n] || n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getToolAccentColor(name: string): string {
  const n = normalizeToolName(name);
  // PiPilot custom tools — distinctive colors
  if (n === "get_diagnostics") return C.error;        // red — problems
  if (n === "manage_dev_server") return C.ok;          // green — running
  if (n === "search_npm") return C.error;              // npm red
  if (n === "get_dev_server_logs") return C.accent;    // amber — warnings
  if (n === "update_project_context") return C.info;   // blue
  if (n === "frontend_design_guide") return "#b392f0"; // purple
  if (n === "analyze_ui") return "#56d4dd";            // teal
  // Built-in tool colors
  if (n.includes("create") || n.includes("batch")) return C.ok;
  if (n.includes("edit") || n.includes("rename")) return C.accent;
  if (n.includes("delete")) return C.error;
  if (n.includes("deploy")) return "#b392f0";
  if (n.startsWith("preview_")) return "#56d4dd";
  if (n.includes("search") || n.includes("list") || n.includes("read") || n.includes("info") || n.includes("tree")) return C.info;
  return C.textDim;
}

/* ─── Deep-linked file paths ─────────────────────────────────────────
 * Detects file paths in inline `code` spans and makes them clickable.
 * Clicking dispatches `pipilot:open-file` which IDELayout listens for.
 * ──────────────────────────────────────────────────────────────────── */
const FILE_PATH_RE = /^(?:\.?\/?)?(?:[\w@.-]+\/)*[\w@.-]+\.\w{1,10}$/;

function isFilePath(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 200) return false;
  if (!FILE_PATH_RE.test(t)) return false;
  // Must have at least one slash OR a known extension
  const knownExts = /\.(tsx?|jsx?|css|scss|html?|json|md|ya?ml|toml|vue|svelte|py|go|rs|rb|php|sh|sql|env|lock|config|mjs|cjs)$/i;
  return t.includes("/") || knownExts.test(t);
}

function openFileInEditor(filePath: string) {
  window.dispatchEvent(new CustomEvent("pipilot:open-file", {
    detail: { filePath: filePath.trim() },
  }));
}

/** Custom ReactMarkdown components that make inline code paths clickable. */
const markdownComponents = {
  code: ({ children, className }: any) => {
    // Only handle INLINE code (no className = no language tag = not a code block)
    if (className) return <code className={className}>{children}</code>;
    const text = String(children).replace(/\n$/, "");
    if (isFilePath(text)) {
      return (
        <code
          onClick={() => openFileInEditor(text)}
          title={`Open ${text} in editor`}
          style={{
            cursor: "pointer",
            borderBottom: `1px dashed ${C.accentLine}`,
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderBottomColor = C.accent;
            e.currentTarget.style.color = C.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderBottomColor = C.accentLine;
            e.currentTarget.style.color = "";
          }}
        >
          {text}
        </code>
      );
    }
    return <code>{text}</code>;
  },
};

/* ─── Tool Call Card ─────────────────────────────────────────────────── */
/* ─── Tool Result Display ─────────────────────────────────────────────
 * Renders tool results — shows screenshot image + layout analysis
 * for screenshot results, or plain text for other tools.
 * ──────────────────────────────────────────────────────────────────── */
function ToolResultDisplay({ result, isError }: { result: string; isError: boolean }) {
  if (result.startsWith("data:image/")) {
    const splitIdx = result.indexOf("\n\n");
    const imgSrc = splitIdx > 0 ? result.slice(0, splitIdx) : result;
    const layoutText = splitIdx > 0 ? result.slice(splitIdx + 2) : null;
    return (
      <div className="mt-1 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
        <img
          src={imgSrc}
          alt="Preview screenshot"
          className="w-full h-auto"
          style={{ maxHeight: 400, objectFit: "contain", background: "#fff" }}
        />
        <div
          className="px-2 py-1 text-center font-sans"
          style={{ background: C.bg, color: C.ok, fontSize: "0.6rem" }}
        >
          Screenshot captured + DOM layout analyzed
        </div>
        {layoutText && (
          <pre
            className="p-2 overflow-x-auto max-h-32 overflow-y-auto"
            style={{ background: C.bg, fontSize: "0.58rem", lineHeight: "1.5", color: C.textDim }}
          >
            {layoutText.length > 2000 ? layoutText.slice(0, 2000) + "\n..." : layoutText}
          </pre>
        )}
      </div>
    );
  }

  return (
    <pre
      className="mt-1 p-2.5 rounded-lg overflow-x-auto max-h-52 overflow-y-auto"
      style={{
        background: C.bg,
        fontSize: "0.68rem",
        lineHeight: "1.6",
        border: `1px solid ${C.border}`,
        color: isError ? C.error : C.textMid,
      }}
    >
      {result.length > 3000 ? result.slice(0, 3000) + "\n... (truncated)" : result}
    </pre>
  );
}

// ── Sequential Thinking — collapsible reasoning card ──
function ThinkingCard({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  let args: any = {};
  try { args = JSON.parse(toolCall.arguments); } catch {}
  const thought = args.thought || "";
  const num = args.thoughtNumber || "?";
  const total = args.totalThoughts || "?";

  return (
    <div style={{ margin: "4px 0", borderRadius: 5, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px", background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left",
          color: C.textDim, fontSize: 11,
        }}
      >
        <span style={{ fontSize: 10, color: "#818cf8" }}>💭</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "#818cf8", fontWeight: 600 }}>
          Thinking {num}/{total}
        </span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: C.textDim }}>
          {!expanded && thought.slice(0, 80)}{!expanded && thought.length > 80 ? "..." : ""}
        </span>
        <ChevronDown size={10} style={{ color: C.textDim, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
      </button>
      {expanded && (
        <div style={{
          padding: "8px 12px 10px 28px", fontSize: 11, lineHeight: 1.6,
          color: C.textMid, whiteSpace: "pre-wrap",
        }}>
          {thought}
        </div>
      )}
    </div>
  );
}

// ── Terminal Command Card — Open Shell + Run Command buttons ──
function TerminalCommandCard({ toolCall }: { toolCall: ToolCallInfo }) {
  const [shellOpened, setShellOpened] = useState(false);
  const [cmdSent, setCmdSent] = useState(false);
  let args: any = {};
  try { args = JSON.parse(toolCall.arguments); } catch {}
  const command = args.command || "";

  const openShell = () => {
    window.dispatchEvent(new CustomEvent("pipilot:open-terminal"));
    setShellOpened(true);
  };

  const runCommand = () => {
    window.dispatchEvent(new CustomEvent("pipilot:terminal-send", { detail: { command } }));
    setCmdSent(true);
  };

  return (
    <div style={{
      margin: "4px 0", padding: "8px 10px", borderRadius: 5,
      background: "hsl(220 13% 14%)", border: `1px solid ${C.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Terminal size={11} style={{ color: C.accent }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600, color: C.accent, textTransform: "uppercase", letterSpacing: "0.04em" }}>Terminal</span>
      </div>
      <div style={{
        padding: "6px 8px", borderRadius: 3, background: "hsl(220 13% 10%)",
        fontFamily: FONTS.mono, fontSize: 11, color: C.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        marginBottom: 8,
      }}>
        $ {command}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={openShell} disabled={shellOpened} style={{
          display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
          fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
          background: shellOpened ? "hsl(142 50% 20%)" : C.surfaceAlt,
          color: shellOpened ? "#6ee7b7" : C.textMid,
          border: `1px solid ${shellOpened ? "#6ee7b740" : C.border}`,
          borderRadius: 3, cursor: shellOpened ? "default" : "pointer",
        }}>
          {shellOpened ? <CheckCircle2 size={9} /> : <Terminal size={9} />}
          {shellOpened ? "Shell Open" : "Open Shell"}
        </button>
        <button onClick={runCommand} disabled={!shellOpened || cmdSent} style={{
          display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
          fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
          background: cmdSent ? "hsl(142 50% 20%)" : (shellOpened ? C.accent : C.surfaceAlt),
          color: cmdSent ? "#6ee7b7" : (shellOpened ? C.bg : C.textDim),
          border: `1px solid ${cmdSent ? "#6ee7b740" : (shellOpened ? C.accent : C.border)}`,
          borderRadius: 3, cursor: (!shellOpened || cmdSent) ? "default" : "pointer",
          opacity: shellOpened ? 1 : 0.5,
        }}>
          {cmdSent ? <CheckCircle2 size={9} /> : <Play size={9} />}
          {cmdSent ? "Sent" : "Run Command"}
        </button>
      </div>
    </div>
  );
}

// ── Sub-Agent Card — delegated background tasks ──
function SubAgentCard({ toolCall, childToolCalls = [] }: { toolCall: ToolCallInfo; childToolCalls?: ToolCallInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  let args: any = {};
  try { args = JSON.parse(toolCall.arguments); } catch {}

  const description = args.description || args.prompt?.slice(0, 60) || "Sub-agent task";
  const prompt = args.prompt || "";
  const isRunning = toolCall.status === "running" || toolCall.status === "pending";
  const isDone = toolCall.status === "done";
  const isError = toolCall.status === "error";

  // Timer for running tasks
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isRunning, startTime]);

  // Parse result for summary
  let resultSummary = "";
  let resultFull = "";
  if (toolCall.result) {
    resultFull = toolCall.result;
    // Try to extract a clean summary (first 200 chars, first paragraph, etc.)
    const lines = toolCall.result.split("\n").filter((l: string) => l.trim());
    resultSummary = lines[0]?.slice(0, 150) || "";
    if (lines.length > 1 && resultSummary.length < 50) {
      resultSummary = lines.slice(0, 2).join(" ").slice(0, 150);
    }
  }

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };

  return (
    <div style={{
      margin: "6px 0", borderRadius: 8, overflow: "hidden",
      background: C.surface, border: `1px solid ${isRunning ? `${C.info}40` : isDone ? `${C.ok}25` : isError ? `${C.error}25` : C.border}`,
      transition: "border-color 0.3s",
    }}>
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px", background: "transparent", border: "none",
        cursor: "pointer", textAlign: "left",
      }}>
        {/* Status indicator */}
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: isRunning ? `${C.info}15` : isDone ? `${C.ok}12` : isError ? `${C.error}12` : `${C.textFaint}10`,
        }}>
          {isRunning ? (
            <Loader2 size={14} className="animate-spin" style={{ color: C.info }} />
          ) : isDone ? (
            <CheckCircle2 size={14} style={{ color: C.ok }} />
          ) : isError ? (
            <XCircle size={14} style={{ color: C.error }} />
          ) : (
            <Clock size={14} style={{ color: C.textDim }} />
          )}
        </div>

        {/* Description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600,
            color: isRunning ? C.info : isDone ? C.ok : isError ? C.error : C.textDim,
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2,
          }}>
            {isRunning ? "⚡ Agent working" : isDone ? "✓ Agent completed" : isError ? "✗ Agent failed" : "◌ Agent queued"}
          </div>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {description}
          </div>
        </div>

        {/* Timer */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: C.textDim }}>
            {isRunning ? formatTime(elapsed) : isDone && toolCall.result ? formatTime(Math.floor((toolCall.result.length / 100))) : ""}
          </span>
          <ChevronDown size={11} style={{
            color: C.textDim, transition: "transform 0.2s",
            transform: expanded ? "rotate(180deg)" : "none",
          }} />
        </div>
      </button>

      {/* Progress bar for running */}
      {isRunning && (
        <div style={{ height: 2, background: C.border, overflow: "hidden" }}>
          <div style={{
            height: "100%", background: `linear-gradient(90deg, ${C.info}, ${C.accent})`,
            animation: "subagent-progress 2s ease-in-out infinite",
          }} />
          <style>{`@keyframes subagent-progress { 0% { width: 0%; margin-left: 0; } 50% { width: 60%; margin-left: 20%; } 100% { width: 0%; margin-left: 100%; } }`}</style>
        </div>
      )}

      {/* Summary (always visible when done) */}
      {isDone && resultSummary && !expanded && (
        <div style={{
          padding: "0 12px 10px 48px", fontSize: 11, color: C.textMid,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {resultSummary}{resultFull.length > 150 ? "…" : ""}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div style={{
          padding: "8px 12px 12px", borderTop: `1px solid ${C.border}`,
        }}>
          {/* Prompt — markdown rendered */}
          {prompt && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Task</div>
              <div className="chat-message" style={{
                padding: "6px 8px", borderRadius: 4, background: C.bg,
                fontSize: 11, color: C.textMid, lineHeight: 1.5,
                maxHeight: 150, overflowY: "auto",
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {prompt.length > 500 ? prompt.slice(0, 500) + "\n\n…" : prompt}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Result — markdown rendered */}
          {resultFull && (
            <div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Result</div>
              <div className="chat-message" style={{
                padding: "6px 8px", borderRadius: 4, background: C.bg,
                fontSize: 11, color: C.textMid, lineHeight: 1.5,
                maxHeight: 250, overflowY: "auto",
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {resultFull}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {isError && !resultFull && (
            <div style={{ fontSize: 11, color: C.error }}>Task failed — no output returned</div>
          )}

          {/* Nested tool calls from the sub-agent */}
          {childToolCalls.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                Agent actions ({childToolCalls.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {childToolCalls.map((ct, i) => {
                  let args: any = {};
                  try { args = JSON.parse(ct.arguments); } catch {}
                  const summary = args.file_path || args.path || args.command?.slice(0, 50) || args.pattern || ct.name;
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "3px 6px", borderRadius: 3,
                      background: C.bg, fontSize: 10, fontFamily: FONTS.mono,
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: 5, flexShrink: 0,
                        background: ct.status === "done" ? C.ok : ct.status === "error" ? C.error : ct.status === "running" ? C.info : C.textFaint,
                      }} />
                      <span style={{ color: C.textDim, fontSize: 8, width: 36, flexShrink: 0 }}>{ct.name.replace("mcp__", "").slice(0, 6)}</span>
                      <span style={{ color: C.textMid, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsed child count badge */}
      {!expanded && childToolCalls.length > 0 && (
        <div style={{ padding: "0 12px 8px 48px", fontSize: 9, color: C.textDim, fontFamily: FONTS.mono }}>
          {childToolCalls.filter(c => c.status === "done").length}/{childToolCalls.length} actions completed
        </div>
      )}
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);

  let parsedArgs: Record<string, unknown> = {};
  try { parsedArgs = JSON.parse(toolCall.arguments); } catch { /* */ }

  const accentColor = getToolAccentColor(toolCall.name);
  const isRunning = toolCall.status === "running";
  const isDone = toolCall.status === "done";
  const isError = toolCall.status === "error";

  const statusColor = isDone
    ? C.ok
    : isError
    ? C.error
    : isRunning
    ? C.info
    : C.textDim;

  // Smart summary: show the most relevant arg for the tool type.
  // For file-based tools, also expose `summaryFilePath` so the path can be
  // rendered as a clickable deep link to the editor.
  const filePathArg = (parsedArgs.file_path || parsedArgs.path) as string | undefined;
  // Only treat the value as a real file path if the tool is file-related —
  // grep/glob/bash also use `path` for directories or globs which we don't
  // want to make clickable.
  const isFileTool =
    toolCall.name === "Read" ||
    toolCall.name === "Write" ||
    toolCall.name === "Edit" ||
    toolCall.name === "MultiEdit" ||
    toolCall.name === "NotebookEdit" ||
    toolCall.name === "read_file" ||
    toolCall.name === "edit_file" ||
    toolCall.name === "create_file" ||
    toolCall.name === "write_file";
  const summaryFilePath = isFileTool && filePathArg ? filePathArg : null;

  // For Bash: description shown separately above command
  const bashDescription = (toolCall.name === "Bash" && parsedArgs.description) ? parsedArgs.description as string : null;

  const summary = filePathArg
    ? filePathArg
    : parsedArgs.command
    ? `$ ${(parsedArgs.command as string).substring(0, 80)}`
    : parsedArgs.pattern
    ? parsedArgs.pattern as string
    : parsedArgs.content && typeof parsedArgs.content === "string"
    ? `${(parsedArgs.content as string).substring(0, 50)}...`
    : parsedArgs.oldPath
    ? `${parsedArgs.oldPath} → ${parsedArgs.newPath}`
    : parsedArgs.query
    ? `"${parsedArgs.query}"`
    : parsedArgs.description
    ? parsedArgs.description as string
    : parsedArgs.files
    ? `${(parsedArgs.files as unknown[]).length} files`
    : null;

  // Border color reflects state: accent for running, border for idle/done, error for failed
  const borderColor = isRunning
    ? C.accentLine
    : isError
    ? `${C.error}55`
    : C.border;

  return (
    <div
      className="overflow-hidden my-1.5"
      style={{
        background: "transparent",
        border: `1px solid ${borderColor}`,
        borderRadius: 4,
        transition: "border-color 0.2s ease",
      }}
    >
      {/* Bash description label — sits above the pill row */}
      {bashDescription && (
        <div style={{
          padding: "4px 10px 0", fontSize: 10, color: C.textMid,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {bashDescription}
        </div>
      )}
      <button
        className="w-full flex items-center gap-2 text-xs"
        style={{
          background: "transparent",
          padding: bashDescription ? "3px 10px 6px" : "6px 10px",
          fontFamily: "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
          border: "none",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#10101580"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status indicator */}
        <span
          className="flex-shrink-0 flex items-center justify-center"
          style={{
            width: 14, height: 14,
            color: statusColor,
          }}
        >
          {isRunning ? (
            <Loader2 size={11} className="animate-spin" />
          ) : isDone ? (
            <CheckCircle2 size={11} />
          ) : isError ? (
            <XCircle size={11} />
          ) : (
            <Clock size={11} />
          )}
        </span>

        {/* Tool icon + label */}
        <span style={{ color: C.textDim }} className="flex-shrink-0">{getToolIcon(toolCall.name)}</span>
        <span
          style={{
            color: C.textMid,
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
          className="flex-shrink-0"
        >
          {getToolLabel(toolCall.name)}
        </span>

        {/* Separator */}
        {summary && (
          <span style={{ color: C.textFaint, flexShrink: 0 }}>/</span>
        )}

        {/* Summary — clickable deep link when it's a file path */}
        {summary && summaryFilePath ? (
          <span
            className="truncate"
            style={{
              color: C.accent,
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: "0.02em",
              borderBottom: `1px dotted ${C.accentLine}`,
              cursor: "pointer",
              transition: "color 0.15s, border-bottom-color 0.15s",
            }}
            title={`Open ${summaryFilePath} in editor`}
            onClick={(e) => {
              e.stopPropagation(); // don't toggle the expand/collapse
              window.dispatchEvent(
                new CustomEvent("pipilot:open-file", {
                  detail: { filePath: summaryFilePath },
                }),
              );
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderBottomColor = C.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderBottomColor = C.accentLine;
            }}
          >
            {summary}
          </span>
        ) : summary ? (
          <span
            className="truncate"
            style={{
              color: C.accent,
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: "0.02em",
            }}
          >
            {summary}
          </span>
        ) : null}


        {/* Expand arrow */}
        <span className="ml-auto flex-shrink-0" style={{ color: C.textFaint }}>
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div
          className="px-2.5 py-2.5 text-xs font-mono"
          style={{
            borderTop: `1px solid ${C.border}`,
            background: "#10101580",
            color: C.textMid,
          }}
        >
          <div className="mb-2">
            <span
              className="text-xs font-sans font-medium uppercase tracking-wider"
              style={{ color: C.textFaint, fontSize: "0.6rem" }}
            >
              Arguments
            </span>
            <pre
              className="mt-1 p-2.5 rounded-lg overflow-x-auto"
              style={{
                background: C.bg,
                fontSize: "0.68rem",
                lineHeight: "1.6",
                border: `1px solid ${C.border}`,
              }}
            >
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span
                className="text-xs font-sans font-medium uppercase tracking-wider"
                style={{ color: C.textFaint, fontSize: "0.6rem" }}
              >
                Result
              </span>
              <ToolResultDisplay result={toolCall.result} isError={isError} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Builtin Tool Badge ─────────────────────────────────────────────── */
function BuiltinToolBadge({ status }: { status: BuiltinToolStatus }) {
  const isStart = status.type === "tool_start";
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs my-0.5"
      style={{
        background: "#6cb6ff18",
        color: C.info,
        border: "1px solid #6cb6ff33",
      }}
    >
      {isStart ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        <CheckCircle2 size={10} style={{ color: C.ok }} />
      )}
      <span className="font-medium">{getToolLabel(status.name)}</span>
      {status.arguments && (status.arguments as Record<string, unknown>).query && (
        <span style={{ color: "#8eccff", opacity: 0.7 }}>
          "{(status.arguments as Record<string, unknown>).query as string}"
        </span>
      )}
    </div>
  );
}

/* ─── Message Actions ────────────────────────────────────────────────── */
function MessageActions({
  message,
  isUser,
  onDelete,
  onRevert,
}: {
  message: ChatMessageType;
  isUser: boolean;
  onDelete?: (messageId: string) => void;
  onRevert?: (messageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  const btnBase = {
    width: "22px",
    height: "22px",
    borderRadius: "6px",
    transition: "all 0.15s ease",
  };

  return (
    <div
      className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-all duration-200 mt-1"
      style={{ justifyContent: isUser ? "flex-end" : "flex-start" }}
    >
      {/* Copy */}
      <button
        className="flex items-center justify-center"
        style={{
          ...btnBase,
          background: C.surfaceAlt,
          color: copied ? C.ok : C.textDim,
          border: `1px solid ${C.border}`,
        }}
        onMouseEnter={(e) => {
          if (!copied) {
            e.currentTarget.style.color = C.text;
            e.currentTarget.style.background = C.border;
            e.currentTarget.style.borderColor = C.borderHover;
          }
        }}
        onMouseLeave={(e) => {
          if (!copied) {
            e.currentTarget.style.color = C.textDim;
            e.currentTarget.style.background = C.surfaceAlt;
            e.currentTarget.style.borderColor = C.border;
          }
        }}
        onClick={handleCopy}
        title="Copy message"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>

      {/* Revert */}
      {isUser && onRevert && (
        <button
          className="flex items-center justify-center"
          style={{
            ...btnBase,
            background: C.surfaceAlt,
            color: C.info,
            border: `1px solid ${C.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#8eccff";
            e.currentTarget.style.background = "#6cb6ff20";
            e.currentTarget.style.borderColor = "#6cb6ff4d";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = C.info;
            e.currentTarget.style.background = C.surfaceAlt;
            e.currentTarget.style.borderColor = C.border;
          }}
          onClick={() => onRevert(message.id)}
          title="Revert to this point"
        >
          <RotateCcw size={11} />
        </button>
      )}

      {/* Delete */}
      {onDelete && (
        <button
          className="flex items-center justify-center"
          style={{
            ...btnBase,
            background: C.surfaceAlt,
            color: C.textDim,
            border: `1px solid ${C.border}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = C.error;
            e.currentTarget.style.background = `${C.error}20`;
            e.currentTarget.style.borderColor = `${C.error}55`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = C.textDim;
            e.currentTarget.style.background = C.surfaceAlt;
            e.currentTarget.style.borderColor = C.border;
          }}
          onClick={() => onDelete(message.id)}
          title="Delete message"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

/* ─── Checkpoint Separator ───────────────────────────────────────────── */
function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface CheckpointSeparatorProps {
  messageId: string;
  timestamp: Date;
  isRestored: boolean;
  showRedo: boolean;
  showRestore: boolean;
  onRestore: (messageId: string) => void;
  onRedo: (messageId: string) => void;
}

export function CheckpointSeparator({
  messageId,
  timestamp,
  isRestored,
  showRedo,
  showRestore,
  onRestore,
  onRedo,
}: CheckpointSeparatorProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex items-center gap-2 my-3 px-1"
      style={{ minHeight: 28 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`checkpoint-${messageId}`}
    >
      {/* Left line */}
      <div style={{ flex: 1, height: 1, background: "hsl(220 13% 24%)" }} />

      {/* Center content */}
      <div
        className="flex items-center gap-1.5"
        style={{
          padding: "3px 10px",
          borderRadius: 12,
          background: isRestored ? `${C.ok}12` : "transparent",
          border: `1px solid ${isRestored ? `${C.ok}30` : "hsl(220 13% 24%)"}`,
          transition: "all 0.15s ease",
        }}
      >
        {isRestored ? (
          <CheckCircle size={11} style={{ color: C.ok, flexShrink: 0 }} />
        ) : (
          <Bookmark size={11} style={{ color: C.textDim, flexShrink: 0 }} />
        )}

        <span
          style={{
            fontSize: 10,
            fontFamily: FONTS.sans,
            fontWeight: 500,
            color: isRestored ? C.ok : C.textDim,
            whiteSpace: "nowrap",
          }}
        >
          {isRestored ? "Restored" : "Checkpoint"}
        </span>

        <span
          style={{
            fontSize: 9,
            fontFamily: FONTS.sans,
            color: C.textFaint,
            whiteSpace: "nowrap",
          }}
        >
          {formatRelativeTime(timestamp)}
        </span>

        {/* Action buttons — show on hover or when restored */}
        {(hovered || isRestored) && (
          <>
            {showRestore && (
              <button
                onClick={() => onRestore(messageId)}
                style={{
                  marginLeft: 4,
                  padding: "1px 8px",
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: FONTS.sans,
                  color: C.accent,
                  background: C.accentDim,
                  border: `1px solid ${C.accentLine}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                Restore
              </button>
            )}
            {showRedo && (
              <button
                onClick={() => onRedo(messageId)}
                className="flex items-center gap-1"
                style={{
                  marginLeft: 4,
                  padding: "1px 8px",
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: FONTS.sans,
                  color: C.info,
                  background: `${C.info}12`,
                  border: `1px solid ${C.info}30`,
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                <Redo2 size={9} />
                Redo
              </button>
            )}
          </>
        )}
      </div>

      {/* Right line */}
      <div style={{ flex: 1, height: 1, background: "hsl(220 13% 24%)" }} />
    </div>
  );
}

/* ─── Single Message Item (used for user messages) ───────────────────── */
const TRUNCATE_WORD_LIMIT = 35;

export function ChatMessageItem({ message, onDelete, onRevert }: ChatMessageProps) {
  const isUser = message.role === "user";
  const [expanded, setExpanded] = useState(false);

  // Non-user messages should go through AssistantTurnGroup, but handle gracefully
  if (!isUser) {
    return (
      <AssistantTurnGroup messages={[message]} onDelete={onDelete} />
    );
  }

  // Reverted user messages: collapsed to a single dimmed line
  if (message.reverted) {
    const summary = message.content.replace(/\n/g, " ").slice(0, 80) + (message.content.length > 80 ? "..." : "");
    return (
      <div
        className="flex gap-2 mb-2 flex-row items-center"
        style={{ opacity: 0.3, animation: "fadeInMsg 0.3s ease-out" }}
        data-testid={`chat-message-${message.id}`}
      >
        <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 14, color: C.textMid }}>
          <User size={10} strokeWidth={1.8} />
        </div>
        <div
          className="text-xs truncate"
          style={{ color: C.textDim, fontFamily: FONTS.sans, maxWidth: "100%", overflow: "hidden" }}
        >
          {summary}
        </div>
      </div>
    );
  }

  const words = message.content.split(/\s+/);
  const needsTruncation = words.length > TRUNCATE_WORD_LIMIT;
  const truncatedText = needsTruncation ? words.slice(0, TRUNCATE_WORD_LIMIT).join(" ") + "..." : message.content;

  return (
    <div
      className="group/msg relative flex gap-2 mb-5 flex-row"
      style={{ animation: "fadeInMsg 0.3s ease-out" }}
      data-testid={`chat-message-${message.id}`}
    >
      {/* User Avatar — bare icon, no chrome */}
      <div
        className="flex-shrink-0 flex items-start justify-center"
        style={{
          width: 14,
          paddingTop: 4,
          color: C.textMid,
        }}
      >
        <User size={12} strokeWidth={1.8} />
      </div>

      {/* User message — full-width editorial block */}
      <div className="relative flex-1 w-full text-left" style={{ minWidth: 0 }}>
        <div
          className="text-left text-sm leading-relaxed"
          style={{
            background: C.surface,
            color: C.text,
            padding: "10px 14px",
            border: `1px solid ${C.border}`,
            borderLeft: `2px solid ${C.accent}`,
            borderRadius: 4,
            maxWidth: "100%",
            overflow: "hidden",
            overflowWrap: "break-word",
            wordBreak: "break-word",
          }}
        >
          {needsTruncation && !expanded ? (
            <>
              <p className="whitespace-pre-wrap leading-relaxed">{truncatedText}</p>
              <button
                onClick={() => setExpanded(true)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  marginTop: 6, padding: "3px 10px",
                  fontSize: 10, fontWeight: 600,
                  background: C.accentDim,
                  color: C.accent,
                  border: `1px solid ${C.accentLine}`,
                  borderRadius: 12, cursor: "pointer",
                }}
              >
                <ChevronDown size={10} />
                Show More
              </button>
            </>
          ) : needsTruncation && expanded ? (
            <>
              <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              </div>
              <button
                onClick={() => setExpanded(false)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  marginTop: 6, padding: "3px 10px",
                  fontSize: 10, fontWeight: 600,
                  background: C.accentDim,
                  color: C.accent,
                  border: `1px solid ${C.accentLine}`,
                  borderRadius: 12, cursor: "pointer",
                }}
              >
                <ChevronRight size={10} />
                Show Less
              </button>
            </>
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          )}
        </div>

        {/* Action buttons */}
        {!message.streaming && (
          <MessageActions
            message={message}
            isUser
            onDelete={onDelete}
            onRevert={onRevert}
          />
        )}

        {/* Timestamp */}
        <div
          className="mt-1 px-1 tabular-nums"
          style={{
            color: C.textDim,
            fontSize: 9,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.05em",
            textAlign: "left",
          }}
        >
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

/* ─── Interruption Prompt ─────────────────────────────────────────────
 * Shown when an agent stream was interrupted (e.g. by page refresh).
 * Lets the user resume the session or send a different message.
 * ──────────────────────────────────────────────────────────────────── */
interface InterruptionPromptProps {
  messageId: string;
  onContinue: (messageId: string) => void;
  onSendNew: (messageId: string, text: string) => void;
}

function InterruptionPrompt({ messageId, onContinue, onSendNew }: InterruptionPromptProps) {
  const [mode, setMode] = useState<"choice" | "input">("choice");
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === "input") inputRef.current?.focus();
  }, [mode]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendNew(messageId, trimmed);
  };

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: C.accentDim,
        border: `1px solid ${C.accentLine}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>
          Agent was interrupted
        </span>
      </div>

      {mode === "choice" ? (
        <>
          <div style={{ fontSize: 11, color: C.textMid, marginBottom: 10, lineHeight: 1.5 }}>
            The previous session was paused. Click continue below to resume, or send a different message.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => onContinue(messageId)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", fontSize: 11, fontWeight: 600,
                background: "linear-gradient(135deg, #56d364 0%, #3da34e 100%)",
                color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
                boxShadow: `0 1px 3px ${C.ok}66`,
              }}
            >
              <Play size={11} />
              Continue
            </button>
            <button
              onClick={() => setMode("input")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", fontSize: 11, fontWeight: 600,
                background: C.surfaceAlt,
                color: C.textMid,
                border: `1px solid ${C.border}`,
                borderRadius: 6, cursor: "pointer",
              }}
            >
              Tell PiPilot something else
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              } else if (e.key === "Escape") {
                setMode("choice");
              }
            }}
            placeholder="Type a new message for PiPilot..."
            rows={3}
            style={{
              width: "100%", padding: "8px 10px",
              fontSize: 12, fontFamily: "inherit",
              background: C.surface,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", fontSize: 11, fontWeight: 600,
                background: text.trim()
                  ? "linear-gradient(135deg, #e5a639 0%, #d19530 100%)"
                  : C.surfaceAlt,
                color: text.trim() ? "#fff" : C.textDim,
                border: "none", borderRadius: 6,
                cursor: text.trim() ? "pointer" : "not-allowed",
              }}
            >
              Send
            </button>
            <button
              onClick={() => { setMode("choice"); setText(""); }}
              style={{
                padding: "5px 10px", fontSize: 11,
                background: "transparent", color: C.textDim,
                border: `1px solid ${C.border}`,
                borderRadius: 6, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Assistant Turn Group ────────────────────────────────────────────
 * Renders all consecutive assistant + tool messages from one agent loop
 * turn inside a SINGLE unified bubble with one avatar and one set of
 * action buttons.
 * ──────────────────────────────────────────────────────────────────── */
interface AssistantTurnGroupProps {
  messages: ChatMessageType[];
  onDelete?: (messageId: string) => void;
  onContinueInterrupted?: (messageId: string) => void;
  onDismissInterruption?: (messageId: string, newMessage: string) => void;
  reverted?: boolean;
}

export function AssistantTurnGroup({ messages, onDelete, onContinueInterrupted, onDismissInterruption, reverted }: AssistantTurnGroupProps) {
  const [copied, setCopied] = useState(false);

  // Aggregate all text content for the copy button
  const allContent = messages
    .filter((m) => m.role === "assistant" && m.content)
    .map((m) => m.content)
    .join("\n\n");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(allContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [allContent]);

  // Check if any message is still streaming
  const isStreaming = messages.some((m) => m.streaming);

  // Get the last assistant message for the delete action
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");

  // Collect all tool calls and content blocks across all messages in this turn
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  // Timestamp from the first message
  const timestamp = messages[0]?.timestamp;

  const btnBase = {
    width: "22px",
    height: "22px",
    borderRadius: "6px",
    transition: "all 0.15s ease",
  };

  // Reverted turns are collapsed to a single-line summary at low opacity
  if (reverted) {
    const summary = allContent
      ? allContent.replace(/\n/g, " ").slice(0, 80) + (allContent.length > 80 ? "..." : "")
      : "Assistant response";
    return (
      <div
        className="flex gap-2 mb-2 flex-row items-center"
        style={{ opacity: 0.3, animation: "fadeInMsg 0.3s ease-out" }}
        data-testid={`chat-turn-${messages[0]?.id}`}
      >
        <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 14, color: C.accent }}>
          <Sparkles size={10} strokeWidth={1.8} />
        </div>
        <div
          className="text-xs truncate"
          style={{ color: C.textDim, fontFamily: FONTS.sans, maxWidth: "100%", overflow: "hidden" }}
        >
          {summary}
        </div>
      </div>
    );
  }

  return (
    <div
      className="group/msg relative flex gap-2 mb-5 flex-row"
      style={{ animation: "fadeInMsg 0.3s ease-out" }}
      data-testid={`chat-turn-${messages[0]?.id}`}
    >
      {/* AI Avatar — bare icon, no chrome */}
      <div
        className="flex-shrink-0 flex items-start justify-center"
        style={{
          width: 14,
          paddingTop: 4,
          color: C.accent,
        }}
      >
        <Sparkles size={12} strokeWidth={1.8} />
      </div>

      {/* Assistant turn — transparent container, no bubble */}
      <div className="relative flex-1 w-full text-left" style={{ minWidth: 0 }}>
        <div
          className="text-left text-sm leading-relaxed"
          style={{
            background: "transparent",
            color: C.text,
            padding: "2px 0 4px",
            maxWidth: "100%",
          }}
        >
          {assistantMessages.map((msg, idx) => {
            const hasContent = msg.content && msg.content.trim();
            const hasTools = msg.toolCalls && msg.toolCalls.length > 0;
            const hasBuiltinTools = msg.builtinToolStatuses && msg.builtinToolStatuses.length > 0;
            const isEmpty = !hasContent && !hasTools && !hasBuiltinTools && !msg.streaming;

            // Skip truly empty messages, but keep interrupted ones so the prompt renders
            if (isEmpty && !msg.interrupted) return null;

            // Add a subtle divider between iterations (but not before the first)
            const showDivider = idx > 0 && (hasContent || hasTools || hasBuiltinTools);

            return (
              <div key={msg.id}>
                {showDivider && (
                  <div
                    className="my-2"
                    style={{
                      borderTop: `1px solid ${C.border}`,
                    }}
                  />
                )}

                {/* Built-in tool status badges */}
                {hasBuiltinTools && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {msg.builtinToolStatuses!
                      .filter((s) => s.type === "tool_start")
                      .map((s, i) => (
                        <BuiltinToolBadge key={i} status={s} />
                      ))}
                  </div>
                )}

                {/* Render parts in order (interleaved text + tools) if available */}
                {msg.parts && msg.parts.length > 0 ? (
                  <div>
                    {(() => {
                      // Pre-process parts to group sub-agent tool calls inside their
                      // parent Agent card. Tool calls between an Agent(running) and
                      // Agent(done) are children of that sub-agent.
                      const elements: React.ReactNode[] = [];
                      let activeAgentTc: ToolCallInfo | null = null;
                      let agentChildTools: ToolCallInfo[] = [];

                      const flushAgent = () => {
                        if (activeAgentTc) {
                          elements.push(
                            <SubAgentCard key={`${msg.id}-agent-${activeAgentTc.id}`} toolCall={activeAgentTc} childToolCalls={agentChildTools} />
                          );
                          activeAgentTc = null;
                          agentChildTools = [];
                        }
                      };

                      for (let pi = 0; pi < msg.parts.length; pi++) {
                        const part = msg.parts[pi];
                        if (part.type === "tool" && part.toolCallId) {
                          const tc = msg.toolCalls?.find(t => t.id === part.toolCallId);
                          if (!tc) continue;

                          const isAgent = tc.name === "Agent" || tc.name === "agent" || tc.name === "SubAgent" || tc.name === "Task";
                          if (isAgent) {
                            flushAgent(); // flush previous if any
                            activeAgentTc = tc;
                            agentChildTools = [];
                            // If already done, flush immediately (no children to collect)
                            if (tc.status === "done" || tc.status === "error") flushAgent();
                            continue;
                          }

                          // If inside an active agent, collect as child
                          if (activeAgentTc && (activeAgentTc.status === "running" || activeAgentTc.status === "pending")) {
                            agentChildTools.push(tc);
                            continue;
                          }

                          // Regular tool calls
                          if (tc.name.includes("sequentialthinking") || tc.name.includes("sequential_thinking") || tc.name.includes("Sequentialthinking")) {
                            elements.push(<ThinkingCard key={`${msg.id}-think-${pi}`} toolCall={tc} />);
                          } else if (tc.name === "run_in_terminal" || tc.name.includes("run_in_terminal")) {
                            elements.push(<TerminalCommandCard key={`${msg.id}-term-${pi}`} toolCall={tc} />);
                          } else {
                            elements.push(<ToolCallCard key={`${msg.id}-pt-${pi}`} toolCall={tc} />);
                          }
                        } else if (part.type === "text" && part.content) {
                          flushAgent(); // text after agent means agent is done
                          elements.push(
                            <div key={`${msg.id}-txt-${pi}`} className="chat-message">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {part.content}
                              </ReactMarkdown>
                            </div>
                          );
                        }
                      }
                      flushAgent(); // flush any trailing agent
                      return elements;
                    })()}
                    {msg.streaming && (
                      <div className="flex items-center gap-2 py-1">
                        <div style={{
                          display: "flex", gap: 3, alignItems: "center",
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.info, animation: "pulse-dot 1.4s ease-in-out infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.info, animation: "pulse-dot 1.4s ease-in-out 0.2s infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.info, animation: "pulse-dot 1.4s ease-in-out 0.4s infinite" }} />
                        </div>
                        <span style={{ fontSize: 11, color: C.info, fontWeight: 500 }}>Working...</span>
                        <style>{`@keyframes pulse-dot { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.2); } }`}</style>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Fallback: tool calls first, then content (AI SDK mode) */}
                    {hasTools && (
                      <div className="mb-2">
                        {/* Dedupe by id — AI SDK may emit the same tool call
                            in multiple stream chunks during a step */}
                        {Array.from(
                          new Map(msg.toolCalls!.map((tc) => [tc.id, tc])).values()
                        ).map((tc, idx) => {
                          if (tc.name.includes("sequentialthinking") || tc.name.includes("sequential_thinking") || tc.name.includes("Sequentialthinking")) {
                            return <ThinkingCard key={`${msg.id}-fb-think-${idx}`} toolCall={tc} />;
                          }
                          if (tc.name === "run_in_terminal" || tc.name.includes("run_in_terminal")) {
                            return <TerminalCommandCard key={`${msg.id}-fb-term-${idx}`} toolCall={tc} />;
                          }
                          if (tc.name === "Agent" || tc.name === "agent" || tc.name === "SubAgent") {
                            return <SubAgentCard key={`${msg.id}-fb-agent-${idx}`} toolCall={tc} />;
                          }
                          return <ToolCallCard key={`${msg.id}-fb-${tc.id}-${idx}`} toolCall={tc} />;
                        })}
                      </div>
                    )}
                    {(hasContent || msg.streaming) && (
                      <div className={`chat-message ${msg.streaming ? "streaming-cursor" : ""}`}>
                        {msg.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {msg.content}
                          </ReactMarkdown>
                        ) : null}
                      </div>
                    )}
                    {/* Working indicator — shown in fallback branch too */}
                    {msg.streaming && (
                      <div className="flex items-center gap-2 py-1">
                        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.info, animation: "pulse-dot 1.4s ease-in-out infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.info, animation: "pulse-dot 1.4s ease-in-out 0.2s infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.info, animation: "pulse-dot 1.4s ease-in-out 0.4s infinite" }} />
                        </div>
                        <span style={{ fontSize: 11, color: C.info, fontWeight: 500 }}>Working...</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Interruption prompt — shown when the agent stream was cut off */}
          {(() => {
            const interruptedMsg = messages.find(m => m.interrupted);
            if (!interruptedMsg || !onContinueInterrupted || !onDismissInterruption) return null;
            return (
              <InterruptionPrompt
                messageId={interruptedMsg.id}
                onContinue={onContinueInterrupted}
                onSendNew={onDismissInterruption}
              />
            );
          })()}
        </div>

        {/* Single set of action buttons for the entire turn */}
        {!isStreaming && allContent && (
          <div
            className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-all duration-200 mt-1"
          >
            {/* Copy all */}
            <button
              className="flex items-center justify-center"
              style={{
                ...btnBase,
                background: C.surfaceAlt,
                color: copied ? C.ok : C.textDim,
                border: `1px solid ${C.border}`,
              }}
              onMouseEnter={(e) => {
                if (!copied) {
                  e.currentTarget.style.color = C.text;
                  e.currentTarget.style.background = C.border;
                }
              }}
              onMouseLeave={(e) => {
                if (!copied) {
                  e.currentTarget.style.color = C.textDim;
                  e.currentTarget.style.background = C.surfaceAlt;
                }
              }}
              onClick={handleCopy}
              title="Copy all text"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>

            {/* Delete all messages in this turn */}
            {onDelete && lastAssistantMsg && (
              <button
                className="flex items-center justify-center"
                style={{
                  ...btnBase,
                  background: C.surfaceAlt,
                  color: C.textDim,
                  border: `1px solid ${C.border}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = C.error;
                  e.currentTarget.style.background = `${C.error}20`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = C.textDim;
                  e.currentTarget.style.background = C.surfaceAlt;
                }}
                onClick={() => {
                  // Delete all messages in this turn
                  for (const m of messages) onDelete(m.id);
                }}
                title="Delete this response"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        )}

        {/* Single timestamp */}
        {timestamp && (
          <div
            className="text-xs mt-1 px-1 tabular-nums"
            style={{ color: C.textFaint, fontSize: "0.65rem" }}
          >
            {timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    </div>
  );
}
