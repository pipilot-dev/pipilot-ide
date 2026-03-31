import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage as ChatMessageType } from "@/hooks/useChat";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessageItem({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-2 mb-4 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      data-testid={`chat-message-${message.id}`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium mt-0.5 ${
          isUser
            ? "bg-blue-600 text-white"
            : "text-white"
        }`}
        style={isUser ? {} : { background: "hsl(207 90% 35%)" }}
      >
        {isUser ? (
          <User size={14} />
        ) : (
          <Bot size={14} />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`flex-1 max-w-[85%] ${isUser ? "text-right" : "text-left"}`}
      >
        <div
          className={`inline-block text-left rounded-lg px-3 py-2 text-sm ${
            isUser
              ? "text-white rounded-tr-sm"
              : "rounded-tl-sm"
          }`}
          style={
            isUser
              ? { background: "hsl(207 90% 36%)" }
              : { background: "hsl(220 13% 22%)", color: "hsl(220 14% 88%)" }
          }
        >
          {isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          ) : (
            <div className={`chat-message ${message.streaming ? "streaming-cursor" : ""}`}>
              {message.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              ) : (
                <span className="opacity-60 text-xs">Thinking...</span>
              )}
            </div>
          )}
        </div>
        <div className="text-xs mt-1 opacity-40 px-1">
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
