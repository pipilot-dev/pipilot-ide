import { useState, useCallback, useRef, useEffect } from "react";
import { COLORS as C } from "@/lib/design-tokens";
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
      <button
        className="w-full flex items-center gap-2 text-xs"
        style={{
          background: "transparent",
          padding: "6px 10px",
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
}

export function AssistantTurnGroup({ messages, onDelete, onContinueInterrupted, onDismissInterruption }: AssistantTurnGroupProps) {
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
                    {msg.parts.map((part, pi) => {
                      if (part.type === "tool" && part.toolCallId) {
                        const tc = msg.toolCalls?.find(t => t.id === part.toolCallId);
                        return tc ? <ToolCallCard key={`${msg.id}-pt-${pi}`} toolCall={tc} /> : null;
                      }
                      if (part.type === "text" && part.content) {
                        return (
                          <div key={`${msg.id}-txt-${pi}`} className="chat-message">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                              {part.content}
                            </ReactMarkdown>
                          </div>
                        );
                      }
                      return null;
                    })}
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
                        ).map((tc, idx) => (
                          <ToolCallCard key={`${msg.id}-fb-${tc.id}-${idx}`} toolCall={tc} />
                        ))}
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
