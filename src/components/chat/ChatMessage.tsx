import { useState, useCallback, useRef, useEffect } from "react";
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
} from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
  onDelete?: (messageId: string) => void;
  onRevert?: (messageId: string) => void;
}

/* ─── Tool Metadata ──────────────────────────────────────────────────── */
function getToolIcon(name: string) {
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
  };
  return iconMap[name] || <FileText size={12} />;
}

function getToolLabel(name: string) {
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
  };
  return labelMap[name] || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getToolAccentColor(name: string): string {
  if (name.includes("create") || name.includes("batch")) return "hsl(142 71% 50%)";
  if (name.includes("edit") || name.includes("rename")) return "hsl(38 92% 55%)";
  if (name.includes("delete")) return "hsl(0 84% 60%)";
  if (name.includes("deploy")) return "hsl(280 65% 60%)";
  if (name.startsWith("preview_")) return "hsl(170 70% 50%)";
  if (name.includes("search") || name.includes("list") || name.includes("read") || name.includes("info") || name.includes("tree")) return "hsl(207 90% 60%)";
  return "hsl(220 14% 60%)";
}

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
      <div className="mt-1 rounded-lg overflow-hidden" style={{ border: "1px solid hsl(220 13% 17%)" }}>
        <img
          src={imgSrc}
          alt="Preview screenshot"
          className="w-full h-auto"
          style={{ maxHeight: 400, objectFit: "contain", background: "#fff" }}
        />
        <div
          className="px-2 py-1 text-center font-sans"
          style={{ background: "hsl(220 13% 10%)", color: "hsl(142 71% 55%)", fontSize: "0.6rem" }}
        >
          Screenshot captured + DOM layout analyzed
        </div>
        {layoutText && (
          <pre
            className="p-2 overflow-x-auto max-h-32 overflow-y-auto"
            style={{ background: "hsl(220 13% 8%)", fontSize: "0.58rem", lineHeight: "1.5", color: "hsl(220 14% 50%)" }}
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
        background: "hsl(220 13% 10%)",
        fontSize: "0.68rem",
        lineHeight: "1.6",
        border: "1px solid hsl(220 13% 17%)",
        color: isError ? "hsl(0 84% 65%)" : "hsl(220 14% 68%)",
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
    ? "hsl(142 71% 50%)"
    : isError
    ? "hsl(0 84% 60%)"
    : isRunning
    ? "hsl(207 90% 60%)"
    : "hsl(220 14% 50%)";

  // Smart summary: show the most relevant arg for the tool type
  const summary = parsedArgs.file_path
    ? parsedArgs.file_path as string
    : parsedArgs.command
    ? `$ ${(parsedArgs.command as string).substring(0, 80)}`
    : parsedArgs.path
    ? parsedArgs.path as string
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

  return (
    <div
      className="rounded-lg overflow-hidden my-1.5 transition-all duration-200"
      style={{
        background: "hsl(220 13% 13%)",
        border: `1px solid ${isRunning ? "hsl(207 90% 45% / 0.3)" : "hsl(220 13% 21%)"}`,
        boxShadow: isRunning ? "0 0 16px hsl(207 90% 50% / 0.08)" : "none",
      }}
    >
      <button
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs transition-all duration-150"
        style={{ background: expanded ? "hsl(220 13% 15%)" : "transparent" }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = "hsl(220 13% 15%)"; }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status indicator */}
        <span
          className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center"
          style={{
            background: `${statusColor}15`,
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
        <span style={{ color: accentColor }} className="flex-shrink-0">{getToolIcon(toolCall.name)}</span>
        <span style={{ color: "hsl(220 14% 82%)" }} className="font-medium flex-shrink-0">
          {getToolLabel(toolCall.name)}
        </span>

        {/* Summary */}
        {summary && (
          <span
            className="font-mono truncate"
            style={{
              color: "hsl(207 90% 65%)",
              fontSize: "0.68rem",
              opacity: 0.85,
            }}
          >
            {summary}
          </span>
        )}

        {/* Expand arrow */}
        <span className="ml-auto flex-shrink-0" style={{ color: "hsl(220 14% 40%)" }}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div
          className="px-2.5 py-2.5 text-xs font-mono"
          style={{
            borderTop: "1px solid hsl(220 13% 19%)",
            color: "hsl(220 14% 68%)",
          }}
        >
          <div className="mb-2">
            <span
              className="text-xs font-sans font-medium uppercase tracking-wider"
              style={{ color: "hsl(220 14% 42%)", fontSize: "0.6rem" }}
            >
              Arguments
            </span>
            <pre
              className="mt-1 p-2.5 rounded-lg overflow-x-auto"
              style={{
                background: "hsl(220 13% 10%)",
                fontSize: "0.68rem",
                lineHeight: "1.6",
                border: "1px solid hsl(220 13% 17%)",
              }}
            >
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span
                className="text-xs font-sans font-medium uppercase tracking-wider"
                style={{ color: "hsl(220 14% 42%)", fontSize: "0.6rem" }}
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
        background: "hsl(207 90% 36% / 0.1)",
        color: "hsl(207 90% 68%)",
        border: "1px solid hsl(207 90% 36% / 0.2)",
      }}
    >
      {isStart ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        <CheckCircle2 size={10} style={{ color: "hsl(142 71% 55%)" }} />
      )}
      <span className="font-medium">{getToolLabel(status.name)}</span>
      {status.arguments && (status.arguments as Record<string, unknown>).query && (
        <span style={{ color: "hsl(207 90% 80%)", opacity: 0.7 }}>
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
          background: "hsl(220 13% 18%)",
          color: copied ? "hsl(142 71% 55%)" : "hsl(220 14% 48%)",
          border: "1px solid hsl(220 13% 24%)",
        }}
        onMouseEnter={(e) => {
          if (!copied) {
            e.currentTarget.style.color = "hsl(220 14% 80%)";
            e.currentTarget.style.background = "hsl(220 13% 24%)";
            e.currentTarget.style.borderColor = "hsl(220 13% 30%)";
          }
        }}
        onMouseLeave={(e) => {
          if (!copied) {
            e.currentTarget.style.color = "hsl(220 14% 48%)";
            e.currentTarget.style.background = "hsl(220 13% 18%)";
            e.currentTarget.style.borderColor = "hsl(220 13% 24%)";
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
            background: "hsl(220 13% 18%)",
            color: "hsl(207 80% 58%)",
            border: "1px solid hsl(220 13% 24%)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "hsl(207 90% 72%)";
            e.currentTarget.style.background = "hsl(207 60% 25% / 0.3)";
            e.currentTarget.style.borderColor = "hsl(207 60% 40% / 0.3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "hsl(207 80% 58%)";
            e.currentTarget.style.background = "hsl(220 13% 18%)";
            e.currentTarget.style.borderColor = "hsl(220 13% 24%)";
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
            background: "hsl(220 13% 18%)",
            color: "hsl(220 14% 48%)",
            border: "1px solid hsl(220 13% 24%)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "hsl(0 84% 62%)";
            e.currentTarget.style.background = "hsl(0 50% 20% / 0.3)";
            e.currentTarget.style.borderColor = "hsl(0 50% 35% / 0.3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "hsl(220 14% 48%)";
            e.currentTarget.style.background = "hsl(220 13% 18%)";
            e.currentTarget.style.borderColor = "hsl(220 13% 24%)";
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
      className="group/msg relative flex gap-2.5 mb-5 flex-row-reverse"
      style={{ animation: "fadeInMsg 0.3s ease-out" }}
      data-testid={`chat-message-${message.id}`}
    >
      {/* User Avatar */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium mt-0.5"
        style={{
          background: "linear-gradient(135deg, hsl(207 90% 45%) 0%, hsl(207 90% 38%) 100%)",
          color: "white",
          boxShadow: "0 2px 6px hsl(207 90% 35% / 0.3)",
        }}
      >
        <User size={13} />
      </div>

      {/* User Bubble */}
      <div className="relative flex-1 max-w-[88%] text-right">
        <div
          className="inline-block text-left text-sm leading-relaxed rounded-2xl rounded-tr-md"
          style={{
            background: "linear-gradient(135deg, hsl(207 90% 38%) 0%, hsl(207 85% 33%) 100%)",
            color: "white",
            padding: "10px 14px",
            boxShadow: "0 2px 8px hsl(207 90% 30% / 0.3)",
            maxWidth: "100%",
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
                  background: "hsl(207 90% 50% / 0.2)",
                  color: "hsl(207 90% 85%)",
                  border: "1px solid hsl(207 90% 50% / 0.3)",
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
                  background: "hsl(207 90% 50% / 0.2)",
                  color: "hsl(207 90% 85%)",
                  border: "1px solid hsl(207 90% 50% / 0.3)",
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
          className="text-xs mt-1 px-1 tabular-nums"
          style={{ color: "hsl(220 14% 35%)", fontSize: "0.65rem", textAlign: "right" }}
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
        background: "hsl(38 92% 50% / 0.08)",
        border: "1px solid hsl(38 92% 50% / 0.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(38 92% 65%)" }}>
          Agent was interrupted
        </span>
      </div>

      {mode === "choice" ? (
        <>
          <div style={{ fontSize: 11, color: "hsl(220 14% 65%)", marginBottom: 10, lineHeight: 1.5 }}>
            The previous session was paused. Click continue below to resume, or send a different message.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => onContinue(messageId)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", fontSize: 11, fontWeight: 600,
                background: "linear-gradient(135deg, hsl(142 71% 45%) 0%, hsl(142 71% 38%) 100%)",
                color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
                boxShadow: "0 1px 3px hsl(142 71% 30% / 0.4)",
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
                background: "hsl(220 13% 22%)",
                color: "hsl(220 14% 75%)",
                border: "1px solid hsl(220 13% 28%)",
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
              background: "hsl(220 13% 12%)",
              color: "hsl(220 14% 90%)",
              border: "1px solid hsl(220 13% 28%)",
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
                  ? "linear-gradient(135deg, hsl(207 90% 45%) 0%, hsl(207 90% 38%) 100%)"
                  : "hsl(220 13% 22%)",
                color: text.trim() ? "#fff" : "hsl(220 14% 45%)",
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
                background: "transparent", color: "hsl(220 14% 55%)",
                border: "1px solid hsl(220 13% 28%)",
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
      className="group/msg relative flex gap-2.5 mb-5 flex-row"
      style={{ animation: "fadeInMsg 0.3s ease-out" }}
      data-testid={`chat-turn-${messages[0]?.id}`}
    >
      {/* Single AI Avatar for entire turn */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium mt-0.5"
        style={{
          background: "linear-gradient(135deg, hsl(220 13% 25%) 0%, hsl(220 13% 20%) 100%)",
          color: "hsl(207 90% 65%)",
          border: "1px solid hsl(220 13% 28%)",
        }}
      >
        <Sparkles size={13} />
      </div>

      {/* Single unified bubble for entire turn */}
      <div className="relative flex-1 max-w-[88%] text-left">
        <div
          className="text-left text-sm leading-relaxed rounded-2xl rounded-tl-md"
          style={{
            background: "hsl(220 13% 19%)",
            color: "hsl(220 14% 88%)",
            padding: "10px 14px",
            maxWidth: "100%",
            border: "1px solid hsl(220 13% 23%)",
            boxShadow: "0 1px 4px hsl(220 13% 5% / 0.2)",
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
                      borderTop: "1px solid hsl(220 13% 24%)",
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
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(207 90% 60%)", animation: "pulse-dot 1.4s ease-in-out infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(207 90% 60%)", animation: "pulse-dot 1.4s ease-in-out 0.2s infinite" }} />
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(207 90% 60%)", animation: "pulse-dot 1.4s ease-in-out 0.4s infinite" }} />
                        </div>
                        <span style={{ fontSize: 11, color: "hsl(207 90% 60%)", fontWeight: 500 }}>Working...</span>
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
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        ) : msg.streaming ? (
                          <span className="flex items-center gap-2 text-xs" style={{ color: "hsl(207 90% 60%)" }}>
                            <Loader2 size={12} className="animate-spin" />
                            <span>Thinking...</span>
                          </span>
                        ) : null}
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
                background: "hsl(220 13% 18%)",
                color: copied ? "hsl(142 71% 55%)" : "hsl(220 14% 48%)",
                border: "1px solid hsl(220 13% 24%)",
              }}
              onMouseEnter={(e) => {
                if (!copied) {
                  e.currentTarget.style.color = "hsl(220 14% 80%)";
                  e.currentTarget.style.background = "hsl(220 13% 24%)";
                }
              }}
              onMouseLeave={(e) => {
                if (!copied) {
                  e.currentTarget.style.color = "hsl(220 14% 48%)";
                  e.currentTarget.style.background = "hsl(220 13% 18%)";
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
                  background: "hsl(220 13% 18%)",
                  color: "hsl(220 14% 48%)",
                  border: "1px solid hsl(220 13% 24%)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "hsl(0 84% 62%)";
                  e.currentTarget.style.background = "hsl(0 50% 20% / 0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "hsl(220 14% 48%)";
                  e.currentTarget.style.background = "hsl(220 13% 18%)";
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
            style={{ color: "hsl(220 14% 35%)", fontSize: "0.65rem" }}
          >
            {timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    </div>
  );
}
