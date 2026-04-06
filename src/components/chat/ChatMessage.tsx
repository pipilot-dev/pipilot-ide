import { useState, useCallback } from "react";
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
  if (name.includes("search") || name.includes("list") || name.includes("read") || name.includes("info") || name.includes("tree")) return "hsl(207 90% 60%)";
  return "hsl(220 14% 60%)";
}

/* ─── Tool Call Card ─────────────────────────────────────────────────── */
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

  // Smart summary: show the most relevant arg
  const summary = parsedArgs.path
    ? parsedArgs.path as string
    : parsedArgs.oldPath
    ? `${parsedArgs.oldPath} → ${parsedArgs.newPath}`
    : parsedArgs.srcPath
    ? `${parsedArgs.srcPath} → ${parsedArgs.destPath}`
    : parsedArgs.query
    ? `"${parsedArgs.query}"`
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
              {/* Show screenshot as an image instead of base64 blob */}
              {toolCall.result.startsWith("data:image/") ? (
                <div className="mt-1 rounded-lg overflow-hidden" style={{ border: "1px solid hsl(220 13% 17%)" }}>
                  <img
                    src={toolCall.result}
                    alt="Preview screenshot"
                    className="w-full h-auto"
                    style={{ maxHeight: 400, objectFit: "contain", background: "#fff" }}
                  />
                  <div
                    className="px-2 py-1 text-center font-sans"
                    style={{ background: "hsl(220 13% 10%)", color: "hsl(220 14% 45%)", fontSize: "0.6rem" }}
                  >
                    Screenshot captured — AI can see this image
                  </div>
                </div>
              ) : (
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
                  {toolCall.result.length > 3000
                    ? toolCall.result.slice(0, 3000) + "\n... (truncated)"
                    : toolCall.result}
                </pre>
              )}
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

/* ─── Message Item ───────────────────────────────────────────────────── */
export function ChatMessageItem({ message, onDelete, onRevert }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`group/msg relative flex gap-2.5 mb-5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      style={{ animation: "fadeInMsg 0.3s ease-out" }}
      data-testid={`chat-message-${message.id}`}
    >
      {/* Avatar */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium mt-0.5"
        style={
          isUser
            ? {
                background: "linear-gradient(135deg, hsl(207 90% 45%) 0%, hsl(207 90% 38%) 100%)",
                color: "white",
                boxShadow: "0 2px 6px hsl(207 90% 35% / 0.3)",
              }
            : {
                background: "linear-gradient(135deg, hsl(220 13% 25%) 0%, hsl(220 13% 20%) 100%)",
                color: "hsl(207 90% 65%)",
                border: "1px solid hsl(220 13% 28%)",
              }
        }
      >
        {isUser ? <User size={13} /> : <Sparkles size={13} />}
      </div>

      {/* Bubble */}
      <div className={`relative flex-1 max-w-[88%] ${isUser ? "text-right" : "text-left"}`}>
        <div
          className={`inline-block text-left text-sm leading-relaxed ${
            isUser ? "rounded-2xl rounded-tr-md" : "rounded-2xl rounded-tl-md"
          }`}
          style={
            isUser
              ? {
                  background: "linear-gradient(135deg, hsl(207 90% 38%) 0%, hsl(207 85% 33%) 100%)",
                  color: "white",
                  padding: "10px 14px",
                  boxShadow: "0 2px 8px hsl(207 90% 30% / 0.3)",
                }
              : {
                  background: "hsl(220 13% 19%)",
                  color: "hsl(220 14% 88%)",
                  padding: "10px 14px",
                  maxWidth: "100%",
                  border: "1px solid hsl(220 13% 23%)",
                  boxShadow: "0 1px 4px hsl(220 13% 5% / 0.2)",
                }
          }
        >
          {isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          ) : (
            <>
              {/* Built-in tool status badges */}
              {message.builtinToolStatuses && message.builtinToolStatuses.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {message.builtinToolStatuses
                    .filter((s) => s.type === "tool_start")
                    .map((s, i) => (
                      <BuiltinToolBadge key={i} status={s} />
                    ))}
                </div>
              )}

              {/* Tool call cards */}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="mb-2">
                  {message.toolCalls.map((tc) => (
                    <ToolCallCard key={tc.id} toolCall={tc} />
                  ))}
                </div>
              )}

              {/* Message content */}
              <div className={`chat-message ${message.streaming ? "streaming-cursor" : ""}`}>
                {message.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                ) : message.streaming ? (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(207 90% 60%)" }}>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Thinking...</span>
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Action buttons */}
        {!message.streaming && (
          <MessageActions
            message={message}
            isUser={isUser}
            onDelete={onDelete}
            onRevert={isUser ? onRevert : undefined}
          />
        )}

        {/* Timestamp */}
        <div
          className="text-xs mt-1 px-1 tabular-nums"
          style={{ color: "hsl(220 14% 35%)", fontSize: "0.65rem" }}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
