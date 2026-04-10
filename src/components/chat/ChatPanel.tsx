import { useEffect, useRef, useState, useCallback, KeyboardEvent, useMemo } from "react";
import {
  Send,
  Square,
  Trash2,
  Bot,
  Zap,
  ChevronDown,
  Sparkles,
  Paperclip,
  ArrowDown,
  Lightbulb,
  Code,
  Layout,
  Globe,
  Palette,
  FileText,
  Search,
  MessageSquare,
  Rocket,
  Command,
  CornerDownLeft,
  Hash,
  X,
} from "lucide-react";
import { useChat, ChatMode, ToolExecutor, WorkspaceContext, CheckpointManager } from "@/hooks/useChat";
import { useAgentChat } from "@/hooks/useAgentChat";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";
import { TodoPanel } from "./TodoPanel";
import { AskUserDialog } from "./AskUserDialog";
import { QueuePanel } from "./QueuePanel";
import { ChatMessageItem, AssistantTurnGroup } from "./ChatMessage";
import { ChatMessage } from "@/hooks/useChat";
import { FileNode } from "@/hooks/useFileSystem";
import { AtSign, FolderOpen, FileCode2, AlertTriangle } from "lucide-react";

/* ─── @ File Attachment System ───────────────────────────────────────── */
const MAX_ATTACH_LINES = 500;
const MAX_ATTACH_CHARS = 30000;
const TRUNCATION_WARN = "⚠️ File truncated to fit context limit.";

interface FileAttachment {
  id: string;        // file path
  name: string;
  type: "file" | "folder";
  language?: string;
  lineCount: number;
  charCount: number;
  truncated: boolean;
  content: string;   // the actual content (possibly truncated)
}

/** Flatten a FileNode tree into a flat list of {id, name, type, language, content} */
function flattenTree(nodes: FileNode[], prefix = ""): { id: string; name: string; type: "file" | "folder"; language?: string; content?: string }[] {
  const result: { id: string; name: string; type: "file" | "folder"; language?: string; content?: string }[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, type: node.type, language: node.language, content: node.content });
    if (node.children) result.push(...flattenTree(node.children, node.id + "/"));
  }
  return result;
}

/** Smart truncation: keeps first N lines, respects char limit, adds warning */
function smartTruncate(content: string, maxLines: number, maxChars: number): { text: string; truncated: boolean; lineCount: number } {
  const lines = content.split("\n");
  const lineCount = lines.length;

  if (lineCount <= maxLines && content.length <= maxChars) {
    return { text: content, truncated: false, lineCount };
  }

  // Truncate by lines first
  let truncLines = lines.slice(0, maxLines);
  let text = truncLines.join("\n");

  // Then by chars if still too long
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    // Cut at last newline to avoid mid-line truncation
    const lastNl = text.lastIndexOf("\n");
    if (lastNl > maxChars * 0.7) text = text.slice(0, lastNl);
  }

  const shownLines = text.split("\n").length;
  text += `\n\n${TRUNCATION_WARN} Showing ${shownLines} of ${lineCount} lines.`;
  return { text, truncated: true, lineCount };
}

/** Fuzzy match: check if query chars appear in order in target */
function fuzzyMatch(target: string, query: string): { matches: boolean; score: number } {
  const tLower = target.toLowerCase();
  const qLower = query.toLowerCase();

  // Exact substring match gets highest score
  if (tLower.includes(qLower)) return { matches: true, score: 100 + (qLower.length / tLower.length) * 50 };

  // Fuzzy: chars must appear in order
  let qi = 0;
  let consecutiveBonus = 0;
  let lastIdx = -2;
  for (let ti = 0; ti < tLower.length && qi < qLower.length; ti++) {
    if (tLower[ti] === qLower[qi]) {
      if (ti === lastIdx + 1) consecutiveBonus += 10;
      lastIdx = ti;
      qi++;
    }
  }
  if (qi === qLower.length) {
    const baseScore = (qLower.length / tLower.length) * 40 + consecutiveBonus;
    // Bonus for matching at word boundaries (after / or .)
    const nameStart = tLower.lastIndexOf("/") + 1;
    if (tLower.slice(nameStart).startsWith(qLower[0])) return { matches: true, score: baseScore + 20 };
    return { matches: true, score: baseScore };
  }
  return { matches: false, score: 0 };
}

/* ─── Slash Commands ─────────────────────────────────────────────────── */
interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "build", label: "/build", description: "Scaffold a new project from scratch", icon: <Rocket size={13} />, prompt: "Build me a complete, production-quality " },
  { id: "design", label: "/design", description: "Create a stunning UI design", icon: <Palette size={13} />, prompt: "Design a beautiful, modern UI for " },
  { id: "landing", label: "/landing", description: "Build a landing page", icon: <Layout size={13} />, prompt: "Build a professional, conversion-optimized landing page for " },
  { id: "fix", label: "/fix", description: "Fix a bug or issue", icon: <Code size={13} />, prompt: "Find and fix the bug in " },
  { id: "refactor", label: "/refactor", description: "Refactor and improve code", icon: <Code size={13} />, prompt: "Refactor and improve the code quality of " },
  { id: "deploy", label: "/deploy", description: "Deploy the project live", icon: <Globe size={13} />, prompt: "Deploy the current project to a live URL." },
  { id: "explain", label: "/explain", description: "Explain how code works", icon: <Lightbulb size={13} />, prompt: "Explain how " },
  { id: "search", label: "/search", description: "Search files and code", icon: <Search size={13} />, prompt: "Search the project for " },
  { id: "tree", label: "/tree", description: "Show project structure", icon: <FileText size={13} />, prompt: "Show me the complete project file tree with details." },
];

/* ─── Smart Suggestions ──────────────────────────────────────────────── */
const SUGGESTION_SETS = [
  [
    { icon: <Rocket size={13} />, text: "Build a portfolio website" },
    { icon: <Layout size={13} />, text: "Create a dashboard UI" },
    { icon: <Palette size={13} />, text: "Design a pricing page" },
    { icon: <Globe size={13} />, text: "Make an e-commerce store" },
  ],
  [
    { icon: <Code size={13} />, text: "Build a todo app" },
    { icon: <Layout size={13} />, text: "Create a blog layout" },
    { icon: <Palette size={13} />, text: "Design a login page" },
    { icon: <Globe size={13} />, text: "Build a weather app" },
  ],
  [
    { icon: <Rocket size={13} />, text: "Build a SaaS landing page" },
    { icon: <Code size={13} />, text: "Create a kanban board" },
    { icon: <Layout size={13} />, text: "Design a settings panel" },
    { icon: <Palette size={13} />, text: "Make a photo gallery" },
  ],
];

/* ─── ChatPanel Props ────────────────────────────────────────────────── */
interface ChatPanelProps {
  toolExecutor?: ToolExecutor;
  workspaceContext?: WorkspaceContext;
  checkpointManager?: CheckpointManager;
  projectId?: string;
  fileTree?: FileNode[];
  activeProvider?: "ai-sdk" | "claude-agent";
  onProviderChange?: (provider: "ai-sdk" | "claude-agent") => void;
}

export function ChatPanel({ toolExecutor, workspaceContext, checkpointManager, projectId, fileTree, activeProvider: activeProviderProp, onProviderChange }: ChatPanelProps) {
  useEffect(() => { injectFonts(); }, []);
  // Call both hooks unconditionally (React rules), pick based on active mode
  const aiSdk = useChat(toolExecutor, workspaceContext, checkpointManager, projectId);
  const agentSdk = useAgentChat(toolExecutor, workspaceContext, checkpointManager, projectId);
  const activeProvider = activeProviderProp || "claude-agent";
  const setActiveProvider = onProviderChange || (() => {});

  const chat = activeProvider === "claude-agent" ? agentSdk : aiSdk;
  const { messages, isStreaming, mode, setMode, sendMessage, stopStreaming, clearMessages, deleteMessage, revertToMessage } = chat;
  const agentTodos = activeProvider === "claude-agent" ? (agentSdk as any).todos || [] : [];
  const agentPendingQuestion = activeProvider === "claude-agent" ? (agentSdk as any).pendingQuestion || null : null;
  const agentAnswerQuestion = activeProvider === "claude-agent" ? (agentSdk as any).answerQuestion : null;
  const agentContinueInterrupted = activeProvider === "claude-agent" ? (agentSdk as any).continueInterrupted : null;
  const agentDismissInterruption = activeProvider === "claude-agent" ? (agentSdk as any).dismissInterruption : null;

  // Handler when user picks "Tell PiPilot something else" and submits a new message
  const handleSendNewAfterInterrupt = useCallback((messageId: string, newMessage: string) => {
    agentDismissInterruption?.(messageId);
    sendMessage(newMessage);
  }, [agentDismissInterruption, sendMessage]);

  // Sync mode changes to switch providers
  const handleSetMode = useCallback((newMode: ChatMode) => {
    if (newMode === "claude-agent") {
      setActiveProvider("claude-agent");
      agentSdk.setMode("claude-agent");
    } else {
      setActiveProvider("ai-sdk");
      aiSdk.setMode(newMode);
    }
  }, [aiSdk, agentSdk]);

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Listen for focus requests (e.g. from the Welcome page "Generate with AI" button)
  useEffect(() => {
    const focusHandler = () => {
      textareaRef.current?.focus();
    };
    window.addEventListener("pipilot:focus-chat-input", focusHandler);
    return () => window.removeEventListener("pipilot:focus-chat-input", focusHandler);
  }, []);

  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [charCount, setCharCount] = useState(0);

  // @ File attachment state
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atFilter, setAtFilter] = useState("");
  const [atIndex, setAtIndex] = useState(0);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [atCursorStart, setAtCursorStart] = useState(-1); // position of the @ in input

  // Flat file list for @ autocomplete
  const flatFiles = useMemo(() => {
    if (!fileTree) return [];
    return flattenTree(fileTree);
  }, [fileTree]);

  // @ autocomplete filtered results
  const filteredAtFiles = useMemo(() => {
    if (!atFilter && !showAtMenu) return [];
    const query = atFilter.toLowerCase();
    const allFiles = flatFiles;

    if (!query) {
      // Show all files (folders first, then files), limited to 12
      return [...allFiles]
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.id.localeCompare(b.id);
        })
        .slice(0, 12);
    }

    // Fuzzy search and rank
    return allFiles
      .map((f) => ({ ...f, ...fuzzyMatch(f.id, query) }))
      .filter((f) => f.matches)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [flatFiles, atFilter, showAtMenu]);

  // Attach a file
  const attachFile = useCallback((fileId: string) => {
    // Don't double-attach
    if (attachments.some((a) => a.id === fileId)) return;

    const file = flatFiles.find((f) => f.id === fileId);
    if (!file) return;

    if (file.type === "folder") {
      // Attach folder: include list of children as context
      const children = flatFiles.filter((f) => f.id.startsWith(fileId + "/") || f.id === fileId);
      const fileList = children.filter((f) => f.type === "file").map((f) => f.id).join("\n");
      const folderContent = `[Folder: ${fileId}]\nContains ${children.filter(f => f.type === "file").length} files:\n${fileList}`;
      setAttachments((prev) => [...prev, {
        id: fileId,
        name: file.name,
        type: "folder",
        lineCount: children.filter(f => f.type === "file").length,
        charCount: folderContent.length,
        truncated: false,
        content: folderContent,
      }]);
    } else {
      // Attach file with smart truncation
      const raw = file.content ?? "";
      const { text, truncated, lineCount } = smartTruncate(raw, MAX_ATTACH_LINES, MAX_ATTACH_CHARS);
      setAttachments((prev) => [...prev, {
        id: fileId,
        name: file.name,
        type: "file",
        language: file.language,
        lineCount,
        charCount: raw.length,
        truncated,
        content: text,
      }]);
    }
  }, [flatFiles, attachments]);

  // Remove an attachment
  const removeAttachment = useCallback((fileId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== fileId));
  }, []);

  // Handle @ autocomplete selection
  const handleAtSelect = useCallback((fileId: string) => {
    attachFile(fileId);
    setShowAtMenu(false);
    setAtFilter("");
    // Remove the @query from input
    if (atCursorStart >= 0) {
      const before = input.slice(0, atCursorStart);
      // Find the end of the @mention (next space or end)
      const afterAt = input.slice(atCursorStart);
      const spaceIdx = afterAt.indexOf(" ");
      const after = spaceIdx >= 0 ? afterAt.slice(spaceIdx) : "";
      const newInput = before + after;
      setInput(newInput);
      setCharCount(newInput.length);
    }
    textareaRef.current?.focus();
  }, [attachFile, atCursorStart, input]);

  // Randomize suggestion set on mount
  const suggestions = useMemo(
    () => SUGGESTION_SETS[Math.floor(Math.random() * SUGGESTION_SETS.length)],
    []
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!showScrollDown) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, showScrollDown]);

  // Track scroll position for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollDown(!isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollDown(false);
  }, []);

  // Slash command filtering
  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.id.includes(slashFilter.toLowerCase()) ||
        cmd.description.toLowerCase().includes(slashFilter.toLowerCase())
    );
  }, [slashFilter]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isStreaming) return;

    // Build the final message with attached file context
    let finalMessage = trimmed;
    if (attachments.length > 0) {
      const contextBlocks = attachments.map((a) => {
        if (a.type === "folder") {
          return `--- Attached folder: ${a.id} ---\n${a.content}`;
        }
        const header = `--- Attached file: ${a.id} (${a.lineCount} lines, ${a.language || "plaintext"})${a.truncated ? " [TRUNCATED]" : ""} ---`;
        return `${header}\n${a.content}`;
      });
      finalMessage = `${contextBlocks.join("\n\n")}\n\n---\n\n${trimmed}`;
    }

    sendMessage(finalMessage);
    setInput("");
    setCharCount(0);
    setAttachments([]);
    setShowSlashMenu(false);
    setShowAtMenu(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput(cmd.prompt);
      setCharCount(cmd.prompt.length);
      setShowSlashMenu(false);
      textareaRef.current?.focus();
      // Auto-resize
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
        }
      }, 0);
    },
    []
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // @ menu navigation
    if (showAtMenu && filteredAtFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtIndex((i) => Math.min(i + 1, filteredAtFiles.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredAtFiles[atIndex]) {
          handleAtSelect(filteredAtFiles[atIndex].id);
        }
        return;
      }
      if (e.key === "Escape") {
        setShowAtMenu(false);
        return;
      }
    }

    // Slash menu navigation
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredSlashCommands[slashIndex]) {
          handleSlashSelect(filteredSlashCommands[slashIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? value.length;
    setInput(value);
    setCharCount(value.length);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";

    // Slash command detection (only at start of input)
    if (value === "/") {
      setShowSlashMenu(true);
      setSlashFilter("");
      setSlashIndex(0);
      setShowAtMenu(false);
    } else if (value.startsWith("/") && !value.includes(" ")) {
      setShowSlashMenu(true);
      setSlashFilter(value.slice(1));
      setSlashIndex(0);
      setShowAtMenu(false);
    } else {
      setShowSlashMenu(false);
    }

    // @ mention detection: find the last @ before cursor that isn't preceded by a space-less word
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIdx = textBeforeCursor.lastIndexOf("@");
    if (lastAtIdx >= 0) {
      // The @ must be at start or preceded by whitespace
      const charBefore = lastAtIdx > 0 ? value[lastAtIdx - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAtIdx === 0) {
        const afterAt = textBeforeCursor.slice(lastAtIdx + 1);
        // Only show menu if there's no space yet (still typing the mention)
        if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
          setShowAtMenu(true);
          setAtFilter(afterAt);
          setAtIndex(0);
          setAtCursorStart(lastAtIdx);
        } else {
          setShowAtMenu(false);
        }
      } else {
        setShowAtMenu(false);
      }
    } else {
      setShowAtMenu(false);
    }
  };

  const modeConfig: Record<ChatMode, { label: string; icon: React.ReactNode; desc: string; color: string }> = {
    chat: {
      label: "Chat",
      icon: <MessageSquare size={12} />,
      desc: "Single-turn conversation",
      color: "hsl(220 14% 65%)",
    },
    agent: {
      label: "Agent",
      icon: <Zap size={12} />,
      desc: "Multi-step autonomous coding",
      color: "hsl(207 90% 65%)",
    },
    "claude-agent": {
      label: "Claude Agent",
      icon: <Bot size={12} />,
      desc: "Claude Agent SDK (server-side)",
      color: "hsl(280 65% 65%)",
    },
  };

  const messageCount = messages.filter((m) => m.role === "user").length;

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: C.surface,
        color: C.text,
        fontFamily: FONTS.sans,
        borderLeft: `1px solid ${C.border}`,
      }}
      data-testid="chat-panel"
    >
      {/* ── Header — editorial label + indicator ── */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 16px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: C.accent,
              boxShadow: `0 0 8px ${C.accent}80`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.accent,
            }}
          >
            / C
          </span>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.text,
            }}
          >
            AI Assistant
          </span>
          {messageCount > 0 && (
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                color: C.textDim,
                letterSpacing: "0.05em",
              }}
            >
              ({String(messageCount).padStart(2, "0")})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Mode Toggle */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200"
              style={{
                background: mode !== "chat"
                  ? `linear-gradient(135deg, ${mode === "claude-agent" ? "hsl(280 65% 36% / 0.25)" : "hsl(207 90% 36% / 0.25)"} 0%, ${mode === "claude-agent" ? "hsl(280 65% 36% / 0.15)" : "hsl(207 90% 36% / 0.15)"} 100%)`
                  : "hsl(220 13% 22%)",
                color: modeConfig[mode]?.color || "hsl(220 14% 65%)",
                border: `1px solid ${mode !== "chat" ? (mode === "claude-agent" ? "hsl(280 65% 45% / 0.3)" : "hsl(207 90% 45% / 0.3)") : "hsl(220 13% 28%)"}`,
                boxShadow: mode !== "chat" ? `0 0 12px ${mode === "claude-agent" ? "hsl(280 65% 50% / 0.15)" : "hsl(207 90% 50% / 0.15)"}` : "none",
              }}
              onClick={() => setShowModeMenu((p) => !p)}
              data-testid="chat-mode-toggle"
            >
              {modeConfig[mode].icon}
              <span>{modeConfig[mode].label}</span>
              <ChevronDown size={10} style={{ opacity: 0.6 }} />
            </button>

            {showModeMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModeMenu(false)} />
                <div
                  className="absolute right-0 top-full mt-1.5 rounded-xl border shadow-xl z-50 overflow-hidden"
                  style={{
                    background: "hsl(220 13% 17%)",
                    borderColor: "hsl(220 13% 25%)",
                    minWidth: "200px",
                    backdropFilter: "blur(16px)",
                    boxShadow: "0 8px 32px hsl(220 13% 5% / 0.6), 0 0 0 1px hsl(220 13% 25%)",
                  }}
                >
                  {(["chat", "agent", "claude-agent"] as ChatMode[]).map((m) => (
                    <button
                      key={m}
                      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-xs transition-all duration-150 text-left"
                      style={
                        mode === m
                          ? { color: modeConfig[m].color, background: "hsl(207 90% 40% / 0.12)" }
                          : { color: "hsl(220 14% 70%)" }
                      }
                      onMouseEnter={(e) => {
                        if (mode !== m) e.currentTarget.style.background = "hsl(220 13% 22%)";
                      }}
                      onMouseLeave={(e) => {
                        if (mode !== m) e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() => {
                        handleSetMode(m);
                        setShowModeMenu(false);
                      }}
                      data-testid={`chat-mode-option-${m}`}
                    >
                      <span className="mt-0.5 flex-shrink-0">{modeConfig[m].icon}</span>
                      <div>
                        <div className="font-semibold">{modeConfig[m].label}</div>
                        <div style={{ color: "hsl(220 14% 50%)", marginTop: 1 }}>{modeConfig[m].desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {messages.length > 0 && (
            <button
              className="rounded-lg p-1.5 text-xs transition-all duration-200 hover:scale-105"
              style={{ color: "hsl(220 14% 50%)" }}
              onClick={clearMessages}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "hsl(0 84% 60% / 0.12)";
                e.currentTarget.style.color = "hsl(0 84% 65%)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "hsl(220 14% 50%)";
              }}
              title="Clear conversation"
              data-testid="chat-clear-btn"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Agent mode badge ── */}
      {(mode === "agent" || mode === "claude-agent") && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs"
          style={{
            background: "linear-gradient(90deg, hsl(207 90% 36% / 0.08) 0%, transparent 100%)",
            borderBottom: "1px solid hsl(220 13% 20%)",
            color: "hsl(207 90% 65%)",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: "hsl(142 71% 50%)",
              boxShadow: "0 0 6px hsl(142 71% 50% / 0.5)",
            }}
          />
          <span style={{ fontWeight: 500 }}>{mode === "claude-agent" ? "Claude Agent" : "Agent mode"}</span>
          <span style={{ color: "hsl(220 14% 45%)" }}>— {mode === "claude-agent" ? "server-side Claude Agent SDK" : "autonomous coding with file tools"}</span>
        </div>
      )}

      {/* ── Messages ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3 relative"
        onScroll={handleScroll}
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
            {/* Editorial empty-state — display heading + numbered prompts */}
            <div style={{ width: "100%", maxWidth: 360, padding: "32px 8px" }}>
              {/* Mono kicker */}
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9, fontWeight: 500,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  color: C.accent, marginBottom: 12,
                }}
              >
                <span style={{ color: C.textDim }}>// </span>type <kbd style={{
                  display: "inline-block",
                  padding: "1px 5px",
                  background: C.surfaceAlt,
                  color: C.accent,
                  border: `1px solid ${C.border}`,
                  borderRadius: 2,
                  fontSize: 9, fontFamily: FONTS.mono,
                  margin: "0 2px",
                }}>/</kbd> for commands
              </div>

              {/* Display heading */}
              <h2
                style={{
                  fontFamily: FONTS.display,
                  fontSize: 38,
                  fontWeight: 400,
                  lineHeight: 1.0,
                  letterSpacing: "-0.02em",
                  color: C.text,
                  margin: 0,
                }}
              >
                what shall we{" "}
                <span style={{ fontStyle: "italic", color: C.accent }}>build</span>
                <span style={{ color: C.accent }}>.</span>
              </h2>

              <p
                style={{
                  marginTop: 14,
                  fontSize: 12,
                  color: C.textMid,
                  lineHeight: 1.5,
                }}
              >
                Describe a feature, ask for a refactor, or pick a starter below.
              </p>

              {/* Numbered prompt list */}
              <ol
                style={{
                  listStyle: "none",
                  margin: "28px 0 0",
                  padding: 0,
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                {suggestions.map((s, i) => (
                  <li key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <button
                      onClick={() => {
                        setInput(s.text);
                        setCharCount(s.text.length);
                        textareaRef.current?.focus();
                      }}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        alignItems: "baseline",
                        gap: 14,
                        padding: "12px 4px",
                        background: "transparent",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        transition: "padding 0.18s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.paddingLeft = "10px";
                        const lbl = e.currentTarget.querySelector("[data-prompt]") as HTMLElement;
                        const idx = e.currentTarget.querySelector("[data-idx]") as HTMLElement;
                        if (lbl) lbl.style.color = C.accent;
                        if (idx) idx.style.color = C.accent;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.paddingLeft = "4px";
                        const lbl = e.currentTarget.querySelector("[data-prompt]") as HTMLElement;
                        const idx = e.currentTarget.querySelector("[data-idx]") as HTMLElement;
                        if (lbl) lbl.style.color = C.text;
                        if (idx) idx.style.color = C.textDim;
                      }}
                    >
                      <span
                        data-idx
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 9,
                          color: C.textDim,
                          letterSpacing: "0.05em",
                          transition: "color 0.18s",
                        }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        data-prompt
                        style={{
                          fontFamily: FONTS.display,
                          fontSize: 16,
                          color: C.text,
                          lineHeight: 1.3,
                          transition: "color 0.18s",
                        }}
                      >
                        {s.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {(() => {
          // Group consecutive assistant/tool messages into unified turns
          const result: React.ReactNode[] = [];
          let currentTurn: ChatMessage[] = [];

          function flushTurn() {
            if (currentTurn.length > 0) {
              const turnMsgs = [...currentTurn];
              const firstId = turnMsgs[0].id;
              result.push(
                <AssistantTurnGroup
                  key={`turn-${firstId}`}
                  messages={turnMsgs}
                  onDelete={handleDeleteMessage}
                  onContinueInterrupted={agentContinueInterrupted || undefined}
                  onDismissInterruption={handleSendNewAfterInterrupt}
                />
              );
              currentTurn = [];
            }
          }

          for (const msg of messages) {
            if (msg.role === "user") {
              flushTurn();
              result.push(
                <ChatMessageItem
                  key={msg.id}
                  message={msg}
                  onDelete={handleDeleteMessage}
                  onRevert={handleRevertToMessage}
                />
              );
            } else {
              // assistant or tool — accumulate into current turn
              currentTurn.push(msg);
            }
          }
          flushTurn();
          return result;
        })()}
        <div ref={bottomRef} />
      </div>

      {/* ── Scroll to bottom fab ── */}
      {showScrollDown && (
        <div className="relative">
          <button
            className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 rounded-full p-1.5 transition-all duration-200 hover:scale-110"
            style={{
              background: "hsl(220 13% 22%)",
              border: "1px solid hsl(220 13% 30%)",
              color: "hsl(220 14% 70%)",
              boxShadow: "0 4px 12px hsl(220 13% 5% / 0.5)",
            }}
            onClick={scrollToBottom}
          >
            <ArrowDown size={14} />
          </button>
        </div>
      )}

      {/* ── @ File mention popup ── */}
      {showAtMenu && filteredAtFiles.length > 0 && (
        <div
          className="mx-3 mb-1 rounded-xl border overflow-hidden"
          style={{
            background: "hsl(220 13% 17%)",
            borderColor: "hsl(220 13% 25%)",
            boxShadow: "0 -8px 32px hsl(220 13% 5% / 0.5)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <div
            className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
            style={{ color: "hsl(220 14% 42%)", borderBottom: "1px solid hsl(220 13% 22%)" }}
          >
            <AtSign size={10} />
            <span>Attach file or folder</span>
            {atFilter && (
              <span className="ml-auto font-mono" style={{ color: "hsl(207 90% 60%)", fontSize: "0.65rem" }}>
                {filteredAtFiles.length} match{filteredAtFiles.length !== 1 ? "es" : ""}
              </span>
            )}
          </div>
          {filteredAtFiles.map((file, idx) => {
            const isFolder = file.type === "folder";
            const alreadyAttached = attachments.some((a) => a.id === file.id);
            const lines = file.content ? file.content.split("\n").length : 0;
            const isOverLimit = lines > MAX_ATTACH_LINES;
            return (
              <button
                key={file.id}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-all duration-100 text-left"
                style={{
                  background: idx === atIndex ? "hsl(207 90% 40% / 0.12)" : "transparent",
                  color: alreadyAttached ? "hsl(220 14% 40%)" : idx === atIndex ? "hsl(220 14% 88%)" : "hsl(220 14% 70%)",
                  borderLeft: idx === atIndex ? "2px solid hsl(207 90% 55%)" : "2px solid transparent",
                  opacity: alreadyAttached ? 0.5 : 1,
                }}
                onMouseEnter={() => setAtIndex(idx)}
                onClick={() => !alreadyAttached && handleAtSelect(file.id)}
                disabled={alreadyAttached}
              >
                <span style={{ color: isFolder ? "hsl(38 92% 55%)" : "hsl(207 90% 60%)", flexShrink: 0 }}>
                  {isFolder ? <FolderOpen size={12} /> : <FileCode2 size={12} />}
                </span>
                <span className="font-mono truncate flex-1" style={{ fontSize: "0.7rem" }}>
                  {file.id}
                </span>
                {!isFolder && lines > 0 && (
                  <span
                    className="flex-shrink-0 flex items-center gap-0.5 tabular-nums"
                    style={{
                      fontSize: "0.6rem",
                      color: isOverLimit ? "hsl(38 92% 55%)" : "hsl(220 14% 40%)",
                    }}
                  >
                    {isOverLimit && <AlertTriangle size={8} />}
                    {lines}L
                  </span>
                )}
                {alreadyAttached && (
                  <span className="flex-shrink-0 text-xs" style={{ color: "hsl(142 71% 50%)", fontSize: "0.6rem" }}>attached</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Slash command popup ── */}
      {showSlashMenu && filteredSlashCommands.length > 0 && (
        <div
          className="mx-3 mb-1 rounded-xl border overflow-hidden"
          style={{
            background: "hsl(220 13% 17%)",
            borderColor: "hsl(220 13% 25%)",
            boxShadow: "0 -8px 32px hsl(220 13% 5% / 0.5)",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          <div className="px-3 py-1.5 text-xs font-medium" style={{ color: "hsl(220 14% 42%)", borderBottom: "1px solid hsl(220 13% 22%)" }}>
            <Hash size={10} className="inline mr-1" style={{ verticalAlign: "-1px" }} />
            Commands
          </div>
          {filteredSlashCommands.map((cmd, idx) => (
            <button
              key={cmd.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-all duration-100 text-left"
              style={{
                background: idx === slashIndex ? "hsl(207 90% 40% / 0.12)" : "transparent",
                color: idx === slashIndex ? "hsl(207 90% 70%)" : "hsl(220 14% 70%)",
                borderLeft: idx === slashIndex ? "2px solid hsl(207 90% 55%)" : "2px solid transparent",
              }}
              onMouseEnter={() => setSlashIndex(idx)}
              onClick={() => handleSlashSelect(cmd)}
            >
              <span style={{ color: idx === slashIndex ? "hsl(207 90% 60%)" : "hsl(220 14% 45%)" }}>
                {cmd.icon}
              </span>
              <span className="font-mono font-semibold" style={{ color: idx === slashIndex ? "hsl(207 90% 75%)" : "hsl(220 14% 60%)" }}>
                {cmd.label}
              </span>
              <span style={{ color: "hsl(220 14% 48%)" }}>{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Queue Panel (shows pending messages) ── */}
      {projectId && <QueuePanel projectId={projectId} isStreaming={isStreaming} />}

      {/* ── Todo Panel (above input, like Cursor/Copilot) ── */}
      {agentTodos.length > 0 && <TodoPanel todos={agentTodos} />}

      {/* ── Ask User Dialog (agent needs input) ── */}
      {agentPendingQuestion && agentAnswerQuestion && (
        <AskUserDialog
          requestId={agentPendingQuestion.requestId}
          questions={agentPendingQuestion.questions}
          onAnswer={agentAnswerQuestion}
        />
      )}

      {/* ── Input Area ── */}
      <div
        className="px-3 py-2.5"
        style={{ borderTop: "1px solid hsl(220 13% 20%)" }}
      >
        <div
          className="rounded-xl overflow-hidden transition-all duration-300"
          style={{
            background: "hsl(220 13% 18%)",
            border: `1px solid ${isStreaming ? "hsl(207 90% 45% / 0.5)" : "hsl(220 13% 25%)"}`,
            boxShadow: isStreaming
              ? "0 0 20px hsl(207 90% 50% / 0.12), inset 0 1px 0 hsl(220 13% 22%)"
              : "0 2px 8px hsl(220 13% 5% / 0.3), inset 0 1px 0 hsl(220 13% 22%)",
          }}
        >

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs group/chip"
                  style={{
                    background: att.truncated ? "hsl(38 92% 50% / 0.1)" : "hsl(207 90% 45% / 0.1)",
                    border: `1px solid ${att.truncated ? "hsl(38 92% 50% / 0.25)" : "hsl(207 90% 45% / 0.2)"}`,
                    color: att.truncated ? "hsl(38 92% 65%)" : "hsl(207 90% 70%)",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>
                    {att.type === "folder" ? <FolderOpen size={10} /> : <FileCode2 size={10} />}
                  </span>
                  <span className="font-mono truncate" style={{ maxWidth: 140, fontSize: "0.68rem" }}>
                    {att.id}
                  </span>
                  <span
                    className="tabular-nums"
                    style={{ color: "hsl(220 14% 45%)", fontSize: "0.6rem", flexShrink: 0 }}
                  >
                    {att.lineCount}L
                  </span>
                  {att.truncated && (
                    <span title={`Truncated from ${att.lineCount} lines to ${MAX_ATTACH_LINES} lines`} style={{ flexShrink: 0 }}>
                      <AlertTriangle size={9} />
                    </span>
                  )}
                  <button
                    className="flex-shrink-0 rounded-sm transition-colors opacity-50 group-hover/chip:opacity-100"
                    style={{ color: "hsl(220 14% 55%)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "hsl(0 84% 65%)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "hsl(220 14% 55%)"; }}
                    onClick={() => removeAttachment(att.id)}
                    title="Remove attachment"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="w-full px-3.5 pt-3 pb-1 text-sm resize-none outline-none bg-transparent leading-relaxed"
            style={{
              color: "hsl(220 14% 90%)",
              minHeight: "42px",
              maxHeight: "160px",
              caretColor: "hsl(207 90% 60%)",
              paddingTop: attachments.length > 0 ? "8px" : undefined,
            }}
            placeholder={
              mode === "agent" || mode === "claude-agent"
                ? "Describe what to build, type / for commands, @ to attach files..."
                : "Ask anything, type @ to attach files..."
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            data-testid="chat-input"
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
            <div className="flex items-center gap-3">
              <button
                className="relative rounded-lg p-1.5 transition-all duration-150"
                style={{
                  color: showAtMenu || attachments.length > 0 ? "hsl(207 90% 60%)" : "hsl(220 14% 42%)",
                  background: showAtMenu ? "hsl(207 90% 40% / 0.15)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "hsl(207 90% 70%)";
                  e.currentTarget.style.background = "hsl(220 13% 24%)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = showAtMenu || attachments.length > 0 ? "hsl(207 90% 60%)" : "hsl(220 14% 42%)";
                  e.currentTarget.style.background = showAtMenu ? "hsl(207 90% 40% / 0.15)" : "transparent";
                }}
                onClick={() => {
                  if (showAtMenu) {
                    setShowAtMenu(false);
                  } else {
                    setShowAtMenu(true);
                    setAtFilter("");
                    setAtIndex(0);
                    setAtCursorStart(input.length);
                  }
                }}
                title="Attach file context (@)"
              >
                <Paperclip size={13} />
                {attachments.length > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-white font-bold"
                    style={{
                      fontSize: "0.5rem",
                      background: "hsl(207 90% 50%)",
                      boxShadow: "0 1px 3px hsl(207 90% 30% / 0.5)",
                    }}
                  >
                    {attachments.length}
                  </span>
                )}
              </button>

              {isStreaming ? (
                <span className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(207 90% 60%)" }}>
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "hsl(207 90% 60%)", animationDelay: "0ms" }} />
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "hsl(207 90% 60%)", animationDelay: "150ms" }} />
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "hsl(207 90% 60%)", animationDelay: "300ms" }} />
                  </span>
                  <span className="font-medium">Working</span>
                </span>
              ) : (
                <span className="text-xs flex items-center gap-1" style={{ color: "hsl(220 14% 38%)" }}>
                  <CornerDownLeft size={10} />
                  <span>to send</span>
                  {charCount > 0 && (
                    <span className="ml-1 tabular-nums" style={{ color: charCount > 4000 ? "hsl(38 92% 55%)" : "hsl(220 14% 35%)" }}>
                      {charCount.toLocaleString()}
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isStreaming ? (
                <button
                  className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 font-medium transition-all duration-200"
                  style={{
                    background: "hsl(0 84% 58% / 0.15)",
                    color: "hsl(0 84% 65%)",
                    border: "1px solid hsl(0 84% 58% / 0.2)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "hsl(0 84% 58% / 0.25)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "hsl(0 84% 58% / 0.15)";
                  }}
                  onClick={stopStreaming}
                  data-testid="chat-stop-btn"
                >
                  <Square size={10} className="fill-current" />
                  Stop
                </button>
              ) : (
                <button
                  className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 font-medium transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: (input.trim() || attachments.length > 0)
                      ? "linear-gradient(135deg, hsl(207 90% 45%) 0%, hsl(207 90% 38%) 100%)"
                      : "hsl(220 13% 24%)",
                    color: (input.trim() || attachments.length > 0) ? "white" : "hsl(220 14% 45%)",
                    boxShadow: (input.trim() || attachments.length > 0)
                      ? "0 2px 8px hsl(207 90% 35% / 0.4), inset 0 1px 0 hsl(207 90% 65% / 0.15)"
                      : "none",
                    border: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (input.trim() || attachments.length > 0) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px hsl(207 90% 35% / 0.5), inset 0 1px 0 hsl(207 90% 65% / 0.2)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    if (input.trim() || attachments.length > 0) {
                      e.currentTarget.style.boxShadow = "0 2px 8px hsl(207 90% 35% / 0.4), inset 0 1px 0 hsl(207 90% 65% / 0.15)";
                    }
                  }}
                  onClick={handleSend}
                  disabled={(!input.trim() && attachments.length === 0) || isStreaming}
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
