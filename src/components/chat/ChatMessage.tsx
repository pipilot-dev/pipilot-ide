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
} from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
  onDelete?: (messageId: string) => void;
  onRevert?: (messageId: string) => void;
}

function getToolIcon(name: string) {
  switch (name) {
    case "read_file":
      return <FileText size={12} />;
    case "list_files":
      return <FolderTree size={12} />;
    case "edit_file":
      return <FileEdit size={12} />;
    case "create_file":
      return <FilePlus size={12} />;
    case "delete_file":
      return <Trash2 size={12} />;
    case "search_files":
      return <Search size={12} />;
    case "web_search":
      return <Globe size={12} />;
    case "web_extract":
      return <Globe size={12} />;
    case "image_generation":
      return <Image size={12} />;
    default:
      return <FileText size={12} />;
  }
}

function getToolLabel(name: string) {
  switch (name) {
    case "read_file":
      return "Read File";
    case "list_files":
      return "List Files";
    case "edit_file":
      return "Edit File";
    case "create_file":
      return "Create File";
    case "delete_file":
      return "Delete File";
    case "search_files":
      return "Search Files";
    case "web_search":
      return "Web Search";
    case "web_extract":
      return "Extract Page";
    case "image_generation":
      return "Generate Image";
    default:
      return name;
  }
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);

  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(toolCall.arguments);
  } catch {
    /* empty */
  }

  const statusColor =
    toolCall.status === "done"
      ? "hsl(142 71% 50%)"
      : toolCall.status === "error"
      ? "hsl(0 84% 60%)"
      : toolCall.status === "running"
      ? "hsl(207 90% 60%)"
      : "hsl(220 14% 55%)";

  const StatusIcon =
    toolCall.status === "done"
      ? CheckCircle2
      : toolCall.status === "error"
      ? XCircle
      : Loader2;

  return (
    <div
      className="rounded-md border overflow-hidden my-1.5"
      style={{
        background: "hsl(220 13% 14%)",
        borderColor: "hsl(220 13% 24%)",
      }}
    >
      <button
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: statusColor }}>
          {toolCall.status === "running" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <StatusIcon size={12} />
          )}
        </span>
        <span style={{ color: "hsl(220 14% 55%)" }}>{getToolIcon(toolCall.name)}</span>
        <span style={{ color: "hsl(220 14% 85%)" }} className="font-medium">
          {getToolLabel(toolCall.name)}
        </span>
        {parsedArgs.path && (
          <span
            className="font-mono truncate"
            style={{ color: "hsl(207 90% 65%)", fontSize: "0.7rem" }}
          >
            {parsedArgs.path as string}
          </span>
        )}
        {parsedArgs.query && (
          <span
            className="truncate"
            style={{ color: "hsl(38 92% 60%)", fontSize: "0.7rem" }}
          >
            "{parsedArgs.query as string}"
          </span>
        )}
        <span className="ml-auto" style={{ color: "hsl(220 14% 45%)" }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {expanded && (
        <div
          className="border-t px-2.5 py-2 text-xs font-mono"
          style={{
            borderColor: "hsl(220 13% 22%)",
            color: "hsl(220 14% 70%)",
          }}
        >
          <div className="mb-1.5">
            <span style={{ color: "hsl(220 14% 50%)" }}>Args: </span>
            <pre
              className="mt-0.5 p-2 rounded overflow-x-auto"
              style={{ background: "hsl(220 13% 11%)", fontSize: "0.7rem" }}
            >
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span style={{ color: "hsl(220 14% 50%)" }}>Result: </span>
              <pre
                className="mt-0.5 p-2 rounded overflow-x-auto max-h-48 overflow-y-auto"
                style={{ background: "hsl(220 13% 11%)", fontSize: "0.7rem" }}
              >
                {toolCall.result.length > 2000
                  ? toolCall.result.slice(0, 2000) + "\n... (truncated)"
                  : toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BuiltinToolBadge({ status }: { status: BuiltinToolStatus }) {
  const isStart = status.type === "tool_start";
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs my-1"
      style={{
        background: "hsl(207 90% 36% / 0.15)",
        color: "hsl(207 90% 70%)",
        border: "1px solid hsl(207 90% 36% / 0.25)",
      }}
    >
      {isStart ? (
        <Loader2 size={10} className="animate-spin" />
      ) : (
        <CheckCircle2 size={10} />
      )}
      <span>{getToolLabel(status.name)}</span>
      {status.arguments && (status.arguments as Record<string, unknown>).query && (
        <span style={{ color: "hsl(207 90% 80%)" }}>
          "{(status.arguments as Record<string, unknown>).query as string}"
        </span>
      )}
    </div>
  );
}

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

  const handleDelete = useCallback(() => {
    if (onDelete) onDelete(message.id);
  }, [onDelete, message.id]);

  const handleRevert = useCallback(() => {
    if (onRevert) onRevert(message.id);
  }, [onRevert, message.id]);

  return (
    <div
      className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150 mt-0.5"
      style={{
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      {/* Copy */}
      <button
        className="flex items-center justify-center rounded transition-colors"
        style={{
          width: "20px",
          height: "20px",
          background: "hsla(220, 13%, 16%, 0.7)",
          color: copied ? "hsl(142 71% 55%)" : "hsl(220 14% 55%)",
        }}
        onMouseEnter={(e) => {
          if (!copied) (e.currentTarget.style.color = "hsl(220 14% 85%)");
          e.currentTarget.style.background = "hsla(220, 13%, 22%, 0.9)";
        }}
        onMouseLeave={(e) => {
          if (!copied) (e.currentTarget.style.color = "hsl(220 14% 55%)");
          else (e.currentTarget.style.color = "hsl(142 71% 55%)");
          e.currentTarget.style.background = "hsla(220, 13%, 16%, 0.7)";
        }}
        onClick={handleCopy}
        title="Copy message"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>

      {/* Revert (user messages only) */}
      {isUser && onRevert && (
        <button
          className="flex items-center justify-center rounded transition-colors"
          style={{
            width: "20px",
            height: "20px",
            background: "hsla(220, 13%, 16%, 0.7)",
            color: "hsl(207 80% 60%)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "hsl(207 90% 75%)";
            e.currentTarget.style.background = "hsla(207, 60%, 30%, 0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "hsl(207 80% 60%)";
            e.currentTarget.style.background = "hsla(220, 13%, 16%, 0.7)";
          }}
          onClick={handleRevert}
          title="Revert to this point"
        >
          <RotateCcw size={12} />
        </button>
      )}

      {/* Delete */}
      {onDelete && (
        <button
          className="flex items-center justify-center rounded transition-colors"
          style={{
            width: "20px",
            height: "20px",
            background: "hsla(220, 13%, 16%, 0.7)",
            color: "hsl(220 14% 55%)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "hsl(0 84% 65%)";
            e.currentTarget.style.background = "hsla(0, 40%, 20%, 0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "hsl(220 14% 55%)";
            e.currentTarget.style.background = "hsla(220, 13%, 16%, 0.7)";
          }}
          onClick={handleDelete}
          title="Delete message"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

export function ChatMessageItem({ message, onDelete, onRevert }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`group/msg relative flex gap-2 mb-4 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      data-testid={`chat-message-${message.id}`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium mt-0.5 ${
          isUser ? "bg-blue-600 text-white" : "text-white"
        }`}
        style={isUser ? {} : { background: "hsl(207 90% 35%)" }}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Bubble */}
      <div className={`relative flex-1 max-w-[85%] ${isUser ? "text-right" : "text-left"}`}>
        <div
          className={`inline-block text-left rounded-lg px-3 py-2 text-sm ${
            isUser ? "text-white rounded-tr-sm" : "rounded-tl-sm"
          }`}
          style={
            isUser
              ? { background: "hsl(207 90% 36%)" }
              : { background: "hsl(220 13% 22%)", color: "hsl(220 14% 88%)", maxWidth: "100%" }
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
                  <span className="opacity-60 text-xs">Thinking...</span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Action buttons below bubble, shown on hover */}
        {!message.streaming && (
          <MessageActions
            message={message}
            isUser={isUser}
            onDelete={onDelete}
            onRevert={isUser ? onRevert : undefined}
          />
        )}

        <div className="text-xs mt-0.5 opacity-40 px-1">
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
