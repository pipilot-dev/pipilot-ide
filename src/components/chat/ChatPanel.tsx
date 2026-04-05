import { useEffect, useRef, useState, useCallback, KeyboardEvent } from "react";
import {
  Send,
  Square,
  Trash2,
  Bot,
  Zap,
  ChevronDown,
  Sparkles,
  Paperclip,
} from "lucide-react";
import { useChat, ChatMode, ToolExecutor, WorkspaceContext, CheckpointManager } from "@/hooks/useChat";
import { ChatMessageItem } from "./ChatMessage";

interface ChatPanelProps {
  toolExecutor?: ToolExecutor;
  workspaceContext?: WorkspaceContext;
  checkpointManager?: CheckpointManager;
  projectId?: string;
}

export function ChatPanel({ toolExecutor, workspaceContext, checkpointManager, projectId }: ChatPanelProps) {
  const {
    messages,
    isStreaming,
    mode,
    setMode,
    sendMessage,
    stopStreaming,
    clearMessages,
    deleteMessage,
    revertToMessage,
  } = useChat(toolExecutor, workspaceContext, checkpointManager, projectId);

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (isStreaming) return;
      deleteMessage(messageId);
    },
    [deleteMessage, isStreaming]
  );

  const [input, setInput] = useState("");
  const handleRevertToMessage = useCallback(
    async (messageId: string) => {
      if (isStreaming) return;
      const content = await revertToMessage(messageId);
      if (content) setInput(content);
    },
    [revertToMessage, isStreaming]
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const modeConfig: Record<ChatMode, { label: string; icon: React.ReactNode; desc: string }> = {
    chat: {
      label: "Chat",
      icon: <Bot size={12} />,
      desc: "Single-turn conversation",
    },
    agent: {
      label: "Agent",
      icon: <Zap size={12} />,
      desc: "Multi-step with file tools",
    },
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "hsl(220 13% 16%)" }}
      data-testid="chat-panel"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "hsl(220 13% 22%)" }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: "hsl(207 90% 60%)" }} />
          <span className="text-sm font-medium" style={{ color: "hsl(220 14% 90%)" }}>
            PiPilot AI
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Mode Toggle */}
          <div className="relative">
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
              style={{
                background: mode === "agent" ? "hsl(207 90% 36% / 0.3)" : "hsl(220 13% 22%)",
                color: mode === "agent" ? "hsl(207 90% 75%)" : "hsl(220 14% 75%)",
              }}
              onClick={() => setShowModeMenu((p) => !p)}
              data-testid="chat-mode-toggle"
            >
              {modeConfig[mode].icon}
              <span>{modeConfig[mode].label}</span>
              <ChevronDown size={10} />
            </button>

            {showModeMenu && (
              <div
                className="absolute right-0 top-full mt-1 rounded border shadow-lg z-50 overflow-hidden"
                style={{
                  background: "hsl(220 13% 18%)",
                  borderColor: "hsl(220 13% 28%)",
                  minWidth: "180px",
                }}
              >
                {(["chat", "agent"] as ChatMode[]).map((m) => (
                  <button
                    key={m}
                    className="w-full flex items-start gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left"
                    style={
                      mode === m
                        ? { color: "hsl(207 90% 60%)", background: "hsl(207 90% 40% / 0.15)" }
                        : { color: "hsl(220 14% 75%)" }
                    }
                    onClick={() => {
                      setMode(m);
                      setShowModeMenu(false);
                    }}
                    data-testid={`chat-mode-option-${m}`}
                  >
                    <span className="mt-0.5">{modeConfig[m].icon}</span>
                    <div>
                      <div className="font-medium">{modeConfig[m].label}</div>
                      <div className="opacity-60">{modeConfig[m].desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {messages.length > 0 && (
            <button
              className="rounded p-1 text-xs transition-colors hover:bg-accent"
              style={{ color: "hsl(220 14% 55%)" }}
              onClick={clearMessages}
              title="Clear conversation"
              data-testid="chat-clear-btn"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Mode badge */}
      {mode === "agent" && (
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border-b"
          style={{
            background: "hsl(207 90% 36% / 0.12)",
            borderColor: "hsl(220 13% 22%)",
            color: "hsl(207 90% 65%)",
          }}
        >
          <Zap size={10} />
          <span>Agent mode — can read, create, edit & search files</span>
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3"
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(207 90% 36% / 0.2)" }}
            >
              <Sparkles size={22} style={{ color: "hsl(207 90% 60%)" }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: "hsl(220 14% 75%)" }}>
                PiPilot AI
              </p>
              <p className="text-xs mt-1" style={{ color: "hsl(220 14% 50%)" }}>
                Your AI coding assistant with file access
              </p>
            </div>
            <div className="flex flex-col gap-1.5 mt-2 w-full max-w-[220px]">
              {[
                "Show me the project structure",
                "Build a landing page",
                "Add a contact form",
                "Create a dark mode toggle",
              ].map((prompt) => (
                <button
                  key={prompt}
                  className="text-xs rounded px-3 py-1.5 text-left transition-colors hover:bg-accent"
                  style={{
                    background: "hsl(220 13% 22%)",
                    color: "hsl(220 14% 70%)",
                    border: "1px solid hsl(220 13% 28%)",
                  }}
                  onClick={() => {
                    setInput(prompt);
                    textareaRef.current?.focus();
                  }}
                  data-testid={`chat-suggestion-${prompt}`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageItem
            key={msg.id}
            message={msg}
            onDelete={handleDeleteMessage}
            onRevert={handleRevertToMessage}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="border-t px-3 py-2"
        style={{ borderColor: "hsl(220 13% 22%)" }}
      >
        <div
          className="rounded-lg border overflow-hidden"
          style={{
            background: "hsl(220 13% 20%)",
            borderColor: isStreaming ? "hsl(207 90% 45%)" : "hsl(220 13% 28%)",
            transition: "border-color 0.2s",
          }}
        >
          <textarea
            ref={textareaRef}
            className="w-full px-3 pt-2.5 pb-1 text-sm resize-none outline-none bg-transparent leading-relaxed"
            style={{
              color: "hsl(220 14% 88%)",
              minHeight: "40px",
              maxHeight: "120px",
            }}
            placeholder={
              mode === "agent"
                ? "Ask AI to read, edit, or create files..."
                : "Ask AI anything..."
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            data-testid="chat-input"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-2">
              <button
                className="rounded p-1 transition-colors hover:bg-accent"
                style={{ color: "hsl(220 14% 45%)" }}
                title="Attach file context"
              >
                <Paperclip size={13} />
              </button>
              <span className="text-xs" style={{ color: "hsl(220 14% 45%)" }}>
                {isStreaming ? (
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    Working...
                  </span>
                ) : (
                  "Enter to send"
                )}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {isStreaming ? (
                <button
                  className="rounded px-2 py-1 text-xs flex items-center gap-1 transition-colors hover:bg-accent"
                  style={{ color: "hsl(0 84% 65%)" }}
                  onClick={stopStreaming}
                  data-testid="chat-stop-btn"
                >
                  <Square size={11} className="fill-current" />
                  Stop
                </button>
              ) : (
                <button
                  className="rounded px-2.5 py-1 text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40"
                  style={{
                    background: input.trim() ? "hsl(207 90% 38%)" : "hsl(220 13% 26%)",
                    color: "white",
                  }}
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  data-testid="chat-send-btn"
                >
                  <Send size={11} />
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
