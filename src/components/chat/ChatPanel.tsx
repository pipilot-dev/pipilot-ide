import { useEffect, useRef, useState, useCallback, KeyboardEvent, useMemo, useLayoutEffect } from "react";
import {
  Send,
  Square,
  Trash2,
  Upload,
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
  Settings,
} from "lucide-react";
import { useChat, ChatMode, ToolExecutor, WorkspaceContext, CheckpointManager } from "@/hooks/useChat";
import { useAgentChat } from "@/hooks/useAgentChat";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";
import { TodoPanel } from "./TodoPanel";
import { SessionPicker } from "./SessionPicker";
import { AskUserDialog } from "./AskUserDialog";
import { QueuePanel } from "./QueuePanel";
import { ChatMessageItem, AssistantTurnGroup, CheckpointSeparator } from "./ChatMessage";
import { ChatMessage } from "@/hooks/useChat";
import { FileNode } from "@/hooks/useFileSystem";
import { AtSign, FolderOpen, FileCode2, AlertTriangle } from "lucide-react";

/* ─── @ File Attachment System ───────────────────────────────────────── */
const MAX_ATTACH_LINES = 500;
const MAX_ATTACH_CHARS = 30000;
const TRUNCATION_WARN = "⚠️ File truncated to fit context limit.";

interface FileAttachment {
  id: string;        // file path or "__problems__"
  name: string;
  type: "file" | "folder" | "problems";
  language?: string;
  lineCount: number;
  charCount: number;
  truncated: boolean;
  content: string;   // the actual content (possibly truncated)
  // Problems-attachment metadata (only set when type === "problems")
  problemCount?: number;
  totalProblemCount?: number;
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
  /** IDs of files currently open as editor tabs (for context pills) */
  openTabIds?: string[];
  /** The currently active/focused tab ID */
  activeTabId?: string | null;
  // Kept for compat with IDELayout, but PiPilot Agent is now the only provider.
  activeProvider?: "claude-agent";
  onProviderChange?: (provider: "claude-agent") => void;
}

const atFootKbd: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: 16, padding: "1px 5px",
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 2,
  fontFamily: FONTS.mono,
  fontSize: 9,
  color: C.textMid,
};

export function ChatPanel({ toolExecutor, workspaceContext, checkpointManager, projectId, fileTree, openTabIds, activeTabId }: ChatPanelProps) {
  useEffect(() => { injectFonts(); }, []);

  const agentSdk = useAgentChat(toolExecutor, workspaceContext, checkpointManager, projectId);

  const { messages, isStreaming, mode, setMode, sendMessage, stopStreaming, clearMessages, deleteMessage, revertToMessage, redoToMessage } = agentSdk;
  const agentTodos = (agentSdk as any).todos || [];
  const agentPendingQuestion = (agentSdk as any).pendingQuestion || null;
  const agentAnswerQuestion = (agentSdk as any).answerQuestion;
  const agentContinueInterrupted = (agentSdk as any).continueInterrupted;
  const agentDismissInterruption = (agentSdk as any).dismissInterruption;
  const messageQueue: string[] = (agentSdk as any).messageQueue || [];
  const removeFromQueue: (i: number) => void = (agentSdk as any).removeFromQueue || (() => {});
  const clearQueue: () => void = (agentSdk as any).clearQueue || (() => {});
  const isOptimizingContext: boolean = (agentSdk as any).isOptimizingContext || false;
  const currentSessionId: string = (agentSdk as any).currentSessionId || "";
  const createSession: (name?: string) => Promise<string> = (agentSdk as any).createSession || (async () => "");
  const switchSession: (sid: string) => void = (agentSdk as any).switchSession || (() => {});
  const renameSession: (sid: string, name: string) => Promise<void> = (agentSdk as any).renameSession || (async () => {});
  const deleteSession: (sid: string) => Promise<void> = (agentSdk as any).deleteSession || (async () => {});


  // Handler when user picks "Tell PiPilot something else" and submits a new message
  const handleSendNewAfterInterrupt = useCallback((messageId: string, newMessage: string) => {
    agentDismissInterruption?.(messageId);
    sendMessage(newMessage);
  }, [agentDismissInterruption, sendMessage]);

  const handleSetMode = useCallback((newMode: ChatMode) => {
    setMode(newMode);
  }, [setMode]);

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (isStreaming) return;
      deleteMessage(messageId);
    },
    [deleteMessage, isStreaming]
  );

  // Input is persisted per-project in localStorage so unsent drafts survive
  // page reloads. Initialized lazily so the first render reads the saved value.
  const inputDraftKey = projectId ? `pipilot:input-draft:${projectId}` : null;
  const [input, setInput] = useState<string>(() => {
    if (typeof window === "undefined" || !inputDraftKey) return "";
    try { return localStorage.getItem(inputDraftKey) || ""; } catch { return ""; }
  });

  // When the project changes, reload the saved draft for the new project.
  useEffect(() => {
    if (!inputDraftKey) { setInput(""); return; }
    try {
      setInput(localStorage.getItem(inputDraftKey) || "");
    } catch { setInput(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Persist input to localStorage — debounced at 500ms to avoid
  // blocking the main thread on every keystroke.
  // Persist draft to localStorage — reads from inputRef (the live value)
  // since the textarea is uncontrolled and `input` state is stale during typing.
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const saveDraft = useCallback(() => {
    if (!inputDraftKey) return;
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        const val = inputRef.current || "";
        if (val.length > 0) {
          localStorage.setItem(inputDraftKey, val);
        } else {
          localStorage.removeItem(inputDraftKey);
        }
      } catch {}
    }, 500);
  }, [inputDraftKey]);
  const handleRevertToMessage = useCallback(
    async (messageId: string) => {
      if (isStreaming) return;
      const content = await revertToMessage(messageId);
      if (content) setInput(content);
    },
    [revertToMessage, isStreaming]
  );
  const handleRedoToMessage = useCallback(
    async (messageId: string) => {
      if (isStreaming) return;
      await redoToMessage(messageId);
    },
    [redoToMessage, isStreaming]
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef(input);

  // Sync state → DOM for uncontrolled textarea when input changes
  // programmatically (prefill, slash select, clear on send, etc.)
  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== input) {
      textareaRef.current.value = input;
      inputRef.current = input;
    }
  }, [input]);

  // Listen for focus / prefill / auto-submit requests from the Welcome page
  useEffect(() => {
    const focusHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { prefill?: string; submit?: boolean } | undefined;
      if (detail?.prefill !== undefined) {
        setInput(detail.prefill);
      }
      textareaRef.current?.focus();
      if (detail?.submit && detail.prefill?.trim()) {
        // Defer one tick so React commits the state before send
        setTimeout(() => {
          sendMessage(detail.prefill!);
          setInput("");
          /* charCount derived */
          setAttachments([]);
        }, 50);
      }
    };
    window.addEventListener("pipilot:focus-chat-input", focusHandler);
    const clearAttHandler = () => setAttachments([]);
    window.addEventListener("pipilot:clear-attachments", clearAttHandler);
    // Preview attachment from WebPreview "click to select"
    const previewAttHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      setAttachments((prev) => {
        if (prev.some((a) => a.id === detail.id)) return prev;
        return [...prev, {
          id: detail.id,
          name: detail.name || "Preview",
          type: "file" as const,
          language: "preview",
          lineCount: 0,
          charCount: detail.content?.length || 0,
          truncated: false,
          content: detail.content || "",
        }];
      });
    };
    window.addEventListener("pipilot:add-preview-attachment", previewAttHandler);
    return () => {
      window.removeEventListener("pipilot:focus-chat-input", focusHandler);
      window.removeEventListener("pipilot:clear-attachments", clearAttHandler);
      window.removeEventListener("pipilot:add-preview-attachment", previewAttHandler);
    };
  }, [sendMessage]);

  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  // charCount removed — derived from input.length to avoid extra re-renders

  // @ File attachment state
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atFilter, setAtFilter] = useState("");
  const [atIndex, setAtIndex] = useState(0);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [atCursorStart, setAtCursorStart] = useState(-1); // position of the @ in input
  const atSearchRef = useRef<HTMLInputElement>(null);

  // Auto-focus the @-menu search input when it opens
  useEffect(() => {
    if (showAtMenu) {
      // Defer one tick so the input is mounted before we try to focus
      setTimeout(() => atSearchRef.current?.focus(), 0);
    }
  }, [showAtMenu]);

  // Listen for "Ask AI to fix" from the Problems panel — attaches a
  // problems digest as a removable pill and pre-fills the input prompt.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id: string;
        count: number;
        totalCount: number;
        truncated: boolean;
        content: string;
        prefill?: string;
      } | undefined;
      if (!detail) return;

      const lineCount = detail.content.split("\n").length;
      setAttachments((prev) => {
        // Replace any existing problems attachment so multiple clicks
        // don't pile up duplicates.
        const without = prev.filter((a) => a.type !== "problems");
        return [
          ...without,
          {
            id: "__problems__",
            name: "Problems",
            type: "problems",
            language: "markdown",
            lineCount,
            charCount: detail.content.length,
            truncated: detail.truncated,
            content: detail.content,
            problemCount: detail.count,
            totalProblemCount: detail.totalCount,
          },
        ];
      });
      if (detail.prefill) setInput(detail.prefill);
      setTimeout(() => textareaRef.current?.focus(), 30);
    };
    window.addEventListener("pipilot:attach-problems", handler);
    return () => window.removeEventListener("pipilot:attach-problems", handler);
  }, []);

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
      // Detect binary/non-text files — don't inline content, just reference the path
      const raw = file.content ?? "";
      const isBinary = !raw || /[\x00-\x08\x0E-\x1F]/.test(raw.slice(0, 1024));
      const binaryExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
        ".pdf", ".zip", ".tar", ".gz", ".woff", ".woff2", ".ttf", ".otf", ".eot",
        ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov", ".avi",
        ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".db", ".sqlite"]);
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      const treatAsReference = isBinary || binaryExts.has(ext);

      if (treatAsReference) {
        // Reference-only: tell agent to Read the file at runtime
        setAttachments((prev) => [...prev, {
          id: fileId,
          name: file.name,
          type: "file",
          language: file.language,
          lineCount: 0,
          charCount: 0,
          truncated: false,
          content: `[File reference: ${fileId}]\nThis is a binary or non-text file. Use the Read tool on this file path to view its contents.`,
        }]);
      } else {
        // Text file: inline with smart truncation
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
    }
  }, [flatFiles, attachments]);

  // Listen for "Add File to Chat" from editor context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const filePath = (e as CustomEvent).detail?.filePath;
      if (filePath) attachFile(filePath);
    };
    window.addEventListener("pipilot:attach-file", handler);
    return () => window.removeEventListener("pipilot:attach-file", handler);
  }, [attachFile]);

  // Skip-tool handler — ToolCallCard dispatches this when user clicks Skip
  useEffect(() => {
    const handler = () => {
      if (!projectId) return;
      fetch("/api/agent/skip-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      }).catch(() => {});
    };
    window.addEventListener("pipilot:skip-tool", handler);
    return () => window.removeEventListener("pipilot:skip-tool", handler);
  }, [projectId]);

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
      /* charCount derived */
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

  // ── Lazy message rendering ──
  // Render only the most recent N messages by default. When the user scrolls
  // to the top of the message list, we extend the window by another N. This
  // keeps the render tree small for long conversations and avoids re-rendering
  // hundreds of <ChatMessageItem> + <AssistantTurnGroup> nodes on every tick.
  const VISIBLE_PAGE = 20;
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE);

  // Reset window when the active session changes (so switching sessions
  // doesn't carry the previous expansion) and scroll to bottom
  useEffect(() => {
    setVisibleCount(VISIBLE_PAGE);
    // Scroll to bottom after messages load — use a short delay so the
    // DOM has rendered the new session's messages first.
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }, 50);
    return () => clearTimeout(timer);
  }, [currentSessionId]);

  // If new messages stream in (during a live response), keep the window
  // big enough to include them so the user always sees the latest activity.
  useEffect(() => {
    if (messages.length > visibleCount) {
      setVisibleCount((prev) => Math.max(prev, Math.min(messages.length, prev + 1)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const visibleMessages = useMemo(() => {
    if (messages.length <= visibleCount) return messages;
    return messages.slice(messages.length - visibleCount);
  }, [messages, visibleCount]);

  const hasOlderMessages = messages.length > visibleCount;
  const hiddenCount = messages.length - visibleCount;

  const loadOlder = useCallback(() => {
    setVisibleCount((prev) => Math.min(messages.length, prev + VISIBLE_PAGE));
  }, [messages.length]);

  // Track scroll position for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollDown(!isNearBottom);
    // Auto-load older messages when the user scrolls within 80px of the top.
    // We preserve scroll position by anchoring on scrollHeight delta after the
    // window grows (handled by the useLayoutEffect below).
    if (el.scrollTop < 80 && hasOlderMessages) {
      loadOlder();
    }
  }, [hasOlderMessages, loadOlder]);

  // After auto-loading older messages, the scroll container's scrollHeight
  // grows. Without this, the scroll position would jump to the new bottom.
  // We capture the height before the load and restore the relative offset.
  const prevScrollHeightRef = useRef<number>(0);
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const prev = prevScrollHeightRef.current;
    if (prev > 0 && el.scrollHeight > prev) {
      el.scrollTop = el.scrollHeight - prev + el.scrollTop;
    }
    prevScrollHeightRef.current = el.scrollHeight;
  }, [visibleCount]);

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
    // Read from ref (latest value) — state may be stale since we skip
    // re-renders on normal typing for performance.
    const currentInput = inputRef.current ?? input;
    const trimmed = currentInput.trim();
    if (!trimmed && attachments.length === 0) return;
    // NOTE: We DO allow sending while streaming. sendMessage detects the
    // streaming state and pushes the new message into the local queue
    // (see useAgentChat). The queue auto-drains when streaming completes.

    // Build the final message with attached file context
    let finalMessage = trimmed;
    if (attachments.length > 0) {
      const contextBlocks = attachments.map((a) => {
        if (a.type === "folder") {
          return `--- Attached folder: ${a.id} ---\n${a.content}`;
        }
        if (a.type === "problems") {
          const totalNote = a.truncated && a.totalProblemCount
            ? ` (truncated from ${a.totalProblemCount})`
            : "";
          return `--- Attached diagnostics: ${a.problemCount} problem${a.problemCount === 1 ? "" : "s"}${totalNote} ---\n${a.content}`;
        }
        const header = `--- Attached file: ${a.id} (${a.lineCount} lines, ${a.language || "plaintext"})${a.truncated ? " [TRUNCATED]" : ""} ---`;
        return `${header}\n${a.content}`;
      });
      finalMessage = `${contextBlocks.join("\n\n")}\n\n---\n\n${trimmed}`;
    }

    sendMessage(finalMessage);
    inputRef.current = "";
    setInput("");
    setAttachments([]);
    // Clear draft from localStorage
    if (inputDraftKey) try { localStorage.removeItem(inputDraftKey); } catch {}
    setShowSlashMenu(false);
    setShowAtMenu(false);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput(cmd.prompt);
      /* charCount derived */
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

  // ── Optimized input handler ──
  // Uses a ref to track the value and only calls setInput (triggering a
  // React re-render) when a menu needs to open/close. Normal typing just
  // updates the ref — the textarea is read from the ref on send.
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const ta = e.target;
    inputRef.current = value;

    // Auto-resize — deferred to avoid layout thrash
    requestAnimationFrame(() => {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    });

    // Slash command detection (only at start of input)
    const isSlash = value.startsWith("/") && !value.includes(" ");
    if (value === "/" || isSlash) {
      setInput(value); // re-render needed for slash menu
      setShowSlashMenu(true);
      setSlashFilter(value.length > 1 ? value.slice(1) : "");
      setSlashIndex(0);
      if (showAtMenu) setShowAtMenu(false);
      return;
    }
    if (showSlashMenu) {
      setInput(value);
      setShowSlashMenu(false);
      return;
    }

    // @ mention detection
    const cursorPos = ta.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIdx = textBeforeCursor.lastIndexOf("@");
    if (lastAtIdx >= 0) {
      const charBefore = lastAtIdx > 0 ? value[lastAtIdx - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAtIdx === 0) {
        const afterAt = textBeforeCursor.slice(lastAtIdx + 1);
        if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
          setInput(value); // re-render needed for @ menu
          setShowAtMenu(true);
          setAtFilter(afterAt);
          setAtIndex(0);
          setAtCursorStart(lastAtIdx);
          return;
        }
      }
    }
    if (showAtMenu) {
      setInput(value);
      setShowAtMenu(false);
      return;
    }

    // Normal typing — NO re-render. Just update the ref + save draft.
    saveDraft();
  };

  const modeConfig: Record<ChatMode, { label: string; icon: React.ReactNode; desc: string; color: string }> = {
    agent: {
      label: "Agent",
      icon: <Bot size={12} />,
      desc: "Autonomous agent — reads, writes, runs",
      color: C.accent,
    },
    plan: {
      label: "Plan",
      icon: <Zap size={12} />,
      desc: "Research & plan only — no edits",
      color: C.info,
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
          {/* Session Picker — multi-chat sessions per project */}
          {projectId && currentSessionId && (
            <SessionPicker
              projectId={projectId}
              currentSessionId={currentSessionId}
              onSwitch={switchSession}
              onCreate={createSession}
              onRename={renameSession}
              onDelete={deleteSession}
            />
          )}
          {/* Mode Toggle */}
          <div className="relative">
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all duration-200"
              style={{
                background: `linear-gradient(135deg, ${mode === "plan" ? `${C.info}40` : `${C.accent}40`} 0%, ${mode === "plan" ? `${C.info}26` : `${C.accent}26`} 100%)`,
                color: modeConfig[mode]?.color || C.textMid,
                border: `1px solid ${mode === "plan" ? C.accentLine : C.accentLine}`,
                boxShadow: `0 0 12px ${mode === "plan" ? `${C.info}26` : `${C.accent}26`}`,
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
                    background: C.surface,
                    borderColor: C.border,
                    minWidth: "220px",
                    backdropFilter: "blur(16px)",
                    boxShadow: `0 8px 32px #00000099, 0 0 0 1px ${C.border}`,
                  }}
                >
                  {(["agent", "plan"] as ChatMode[]).map((m) => (
                    <button
                      key={m}
                      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-xs transition-all duration-150 text-left"
                      style={
                        mode === m
                          ? { color: modeConfig[m].color, background: `${C.info}1f` }
                          : { color: C.textMid }
                      }
                      onMouseEnter={(e) => {
                        if (mode !== m) e.currentTarget.style.background = C.surfaceAlt;
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
                        <div style={{ color: C.textDim, marginTop: 1 }}>{modeConfig[m].desc}</div>
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
              style={{ color: C.textDim }}
              onClick={clearMessages}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${C.error}1f`;
                e.currentTarget.style.color = C.error;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = C.textDim;
              }}
              title="Clear conversation"
              data-testid="chat-clear-btn"
            >
              <Trash2 size={14} />
            </button>
          )}

        </div>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3 relative"
        onScroll={handleScroll}
        data-testid="chat-messages"
      >
        {messages.length === 0 && (!projectId || projectId === "default-project") && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
            <div style={{ width: "100%", maxWidth: 340, padding: "32px 16px" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent, marginBottom: 12 }}>
                <span style={{ color: C.textDim }}>// </span>get started
              </div>
              <h2 style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 300, color: C.text, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
                open a <em style={{ fontWeight: 500, fontStyle: "normal", color: C.accent }}>workspace</em>
              </h2>
              <p style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, margin: "0 0 20px" }}>
                Open a folder or generate a new project to start building with the AI agent.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => window.dispatchEvent(new CustomEvent("pipilot:open-folder-picker"))} style={{
                  padding: "9px 16px", borderRadius: 6, fontSize: 11, fontFamily: FONTS.mono, fontWeight: 600,
                  background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>Open Folder</button>
                <button onClick={() => window.dispatchEvent(new CustomEvent("pipilot:show-generate-modal"))} style={{
                  padding: "9px 16px", borderRadius: 6, fontSize: 11, fontFamily: FONTS.mono, fontWeight: 600,
                  background: C.accent, border: "none", color: "#fff", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>Generate with AI</button>
              </div>
            </div>
          </div>
        )}

        {messages.length === 0 && projectId && projectId !== "default-project" && (
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

        {/* Load-older button — visible only when there are hidden messages */}
        {hasOlderMessages && (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
            <button
              onClick={loadOlder}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 14px",
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 3,
                color: C.textMid,
                fontFamily: FONTS.mono,
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = C.accentLine;
                e.currentTarget.style.color = C.accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.color = C.textMid;
              }}
            >
              ↑ Load older ({hiddenCount})
            </button>
          </div>
        )}

        {(() => {
          // Group consecutive assistant/tool messages into unified turns.
          // Operates on `visibleMessages` (the lazy-load slice) instead of
          // the full `messages` array.
          const result: React.ReactNode[] = [];
          let currentTurn: ChatMessage[] = [];
          let lastAssistantTurnEnd = false; // tracks if the previous item was an assistant turn

          function flushTurn() {
            if (currentTurn.length > 0) {
              const turnMsgs = [...currentTurn];
              const firstId = turnMsgs[0].id;
              const isReverted = turnMsgs.some((m) => m.reverted);
              result.push(
                <AssistantTurnGroup
                  key={`turn-${firstId}`}
                  messages={turnMsgs}
                  onDelete={handleDeleteMessage}
                  onContinueInterrupted={agentContinueInterrupted || undefined}
                  onDismissInterruption={handleSendNewAfterInterrupt}
                  reverted={isReverted}
                />
              );
              currentTurn = [];
              lastAssistantTurnEnd = true;
            }
          }

          for (let vi = 0; vi < visibleMessages.length; vi++) {
            const msg = visibleMessages[vi];
            if (msg.role === "user") {
              flushTurn();

              // Insert a checkpoint separator BEFORE this user message
              // (i.e. between the previous assistant turn and this user message)
              if (lastAssistantTurnEnd) {
                // Determine if any messages from this user message onward are reverted
                const isRestoredHere = msg.reverted === true;
                // Check if a later checkpoint was reverted (for "Redo" button):
                // the redo target is this user message's id
                const hasRevertedAfter = visibleMessages.slice(vi).some((m) => m.reverted);
                result.push(
                  <CheckpointSeparator
                    key={`cp-${msg.id}`}
                    messageId={msg.id}
                    timestamp={msg.timestamp}
                    isRestored={isRestoredHere}
                    showRedo={isRestoredHere}
                    showRestore={!isRestoredHere && !hasRevertedAfter}
                    onRestore={handleRevertToMessage}
                    onRedo={handleRedoToMessage}
                  />
                );
              }

              result.push(
                <ChatMessageItem
                  key={msg.id}
                  message={msg}
                  onDelete={handleDeleteMessage}
                  onRevert={handleRevertToMessage}
                />
              );
              lastAssistantTurnEnd = false;
            } else {
              // assistant or tool — accumulate into current turn
              currentTurn.push(msg);
            }
          }
          flushTurn();
          return result;
        })()}

        {/* ── Context optimization status (shimmer + spinning gear) ── */}
        {isOptimizingContext && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              margin: "8px 0",
              background: C.surfaceAlt,
              border: `1px solid ${C.accentLine}`,
              borderRadius: 4,
              fontFamily: FONTS.mono,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Spinning gear */}
            <Settings
              size={13}
              style={{
                color: C.accent,
                flexShrink: 0,
                animation: "pipilot-gear-spin 2.4s linear infinite",
              }}
            />

            {/* Editorial label */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: C.accent,
                flexShrink: 0,
              }}
            >
              / OPT
            </span>

            {/* Shimmering text */}
            <span
              className="pipilot-shimmer-text"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.05em",
              }}
            >
              Optimizing context…
            </span>

            <div style={{ flex: 1 }} />

            <span
              style={{
                fontSize: 9,
                color: C.textDim,
                letterSpacing: "0.05em",
              }}
            >
              summarizing earlier turns
            </span>

            {/* Background shimmer sweep */}
            <div
              aria-hidden
              className="pipilot-shimmer-bg"
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
              }}
            />

            <style>{`
              @keyframes pipilot-gear-spin {
                from { transform: rotate(0deg); }
                to   { transform: rotate(360deg); }
              }
              .pipilot-shimmer-text {
                background: linear-gradient(
                  90deg,
                  ${C.text} 0%,
                  ${C.text} 30%,
                  ${C.accent} 50%,
                  ${C.text} 70%,
                  ${C.text} 100%
                );
                background-size: 200% 100%;
                background-clip: text;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                color: transparent;
                animation: pipilot-shimmer-slide 2s linear infinite;
              }
              @keyframes pipilot-shimmer-slide {
                from { background-position: 200% 0; }
                to   { background-position: -200% 0; }
              }
              .pipilot-shimmer-bg::before {
                content: "";
                position: absolute;
                top: 0;
                left: -50%;
                width: 50%;
                height: 100%;
                background: linear-gradient(
                  90deg,
                  transparent 0%,
                  ${C.accent}0a 50%,
                  transparent 100%
                );
                animation: pipilot-shimmer-sweep 2.2s linear infinite;
              }
              @keyframes pipilot-shimmer-sweep {
                from { transform: translateX(0); }
                to   { transform: translateX(400%); }
              }
            `}</style>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Scroll to bottom fab ── */}
      {showScrollDown && (
        <div className="relative">
          <button
            className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 rounded-full p-1.5 transition-all duration-200 hover:scale-110"
            style={{
              background: C.surfaceAlt,
              border: `1px solid ${C.borderHover}`,
              color: C.textMid,
              boxShadow: "0 4px 12px #00000080",
            }}
            onClick={scrollToBottom}
          >
            <ArrowDown size={14} />
          </button>
        </div>
      )}

      {/* ── @ File mention popup — editorial-terminal styled with search ── */}
      {showAtMenu && (
        <div
          className="mx-3 mb-1 overflow-hidden"
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            boxShadow: `0 -8px 32px rgba(0, 0, 0, 0.6)`,
            maxHeight: 320,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header — editorial label + count */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px",
              borderBottom: `1px solid ${C.border}`,
              background: C.surfaceAlt,
              flexShrink: 0,
            }}
          >
            <AtSign size={10} style={{ color: C.accent }} />
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.accent,
            }}>
              / @
            </span>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.textDim,
            }}>
              Attach File
            </span>
            <div style={{ flex: 1 }} />
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9,
              color: C.textFaint, letterSpacing: "0.05em",
            }}>
              {String(filteredAtFiles.length).padStart(2, "0")} / {String(flatFiles.length).padStart(2, "0")}
            </span>
          </div>

          {/* Search input — editorial */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px",
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <Search size={12} style={{ color: C.textDim, flexShrink: 0 }} />
            <input
              ref={atSearchRef}
              type="text"
              value={atFilter}
              onChange={(e) => {
                setAtFilter(e.target.value);
                setAtIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtIndex((i) => Math.min(i + 1, filteredAtFiles.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const file = filteredAtFiles[atIndex];
                  if (file && !attachments.some((a) => a.id === file.id)) {
                    handleAtSelect(file.id);
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setShowAtMenu(false);
                  setAtFilter("");
                  textareaRef.current?.focus();
                }
              }}
              placeholder="search files…"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: FONTS.mono,
                fontSize: 12,
                color: C.text,
                caretColor: C.accent,
                letterSpacing: "0.01em",
              }}
            />
            {atFilter && (
              <button
                onClick={() => { setAtFilter(""); atSearchRef.current?.focus(); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18,
                  background: "transparent",
                  border: "none",
                  color: C.textDim,
                  cursor: "pointer",
                  borderRadius: 2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}
              >
                <X size={11} />
              </button>
            )}
            <kbd style={{
              padding: "2px 6px",
              fontFamily: FONTS.mono, fontSize: 9,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              color: C.textDim,
              flexShrink: 0,
            }}>
              ESC
            </kbd>
          </div>

          {/* Result list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", minHeight: 0 }}>
            {filteredAtFiles.length === 0 ? (
              <div style={{
                padding: "24px 16px", textAlign: "center",
                fontFamily: FONTS.mono, fontSize: 10, color: C.textDim,
              }}>
                <div style={{
                  fontFamily: FONTS.mono, fontSize: 9,
                  letterSpacing: "0.18em", color: C.textFaint,
                  marginBottom: 6,
                }}>
                  // NO MATCHES
                </div>
                {atFilter ? `No files match "${atFilter}"` : "No files in this project"}
              </div>
            ) : filteredAtFiles.map((file, idx) => {
              const isFolder = file.type === "folder";
              const alreadyAttached = attachments.some((a) => a.id === file.id);
              const lines = file.content ? file.content.split("\n").length : 0;
              const isOverLimit = lines > MAX_ATTACH_LINES;
              const isSelected = idx === atIndex;
              return (
                <button
                  key={file.id}
                  data-at-idx={idx}
                  className="w-full flex items-center gap-3 text-left transition-colors"
                  style={{
                    padding: "7px 14px",
                    background: isSelected ? C.surfaceAlt : "transparent",
                    color: alreadyAttached ? C.textFaint : isSelected ? C.text : C.textMid,
                    borderLeft: `2px solid ${isSelected ? C.accent : "transparent"}`,
                    border: "none",
                    cursor: alreadyAttached ? "not-allowed" : "pointer",
                    fontFamily: FONTS.mono,
                    fontSize: 11,
                    opacity: alreadyAttached ? 0.5 : 1,
                  }}
                  onMouseEnter={() => setAtIndex(idx)}
                  onClick={() => !alreadyAttached && handleAtSelect(file.id)}
                  disabled={alreadyAttached}
                >
                  <span style={{
                    color: isSelected ? C.accent : C.textDim,
                    flexShrink: 0,
                  }}>
                    {isFolder ? <FolderOpen size={11} /> : <FileCode2 size={11} />}
                  </span>
                  <span style={{
                    flex: 1,
                    fontFamily: FONTS.mono,
                    fontSize: 10,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    minWidth: 0,
                  }}>
                    {file.id}
                  </span>
                  {!isFolder && lines > 0 && (
                    <span style={{
                      display: "flex", alignItems: "center", gap: 3,
                      fontFamily: FONTS.mono, fontSize: 9,
                      color: isOverLimit ? C.warn : C.textFaint,
                      flexShrink: 0,
                    }}>
                      {isOverLimit && <AlertTriangle size={8} />}
                      {lines}L
                    </span>
                  )}
                  {alreadyAttached && (
                    <span style={{
                      fontFamily: FONTS.mono, fontSize: 8,
                      letterSpacing: "0.12em", textTransform: "uppercase",
                      color: C.accent,
                      padding: "1px 6px",
                      border: `1px solid ${C.accentLine}`,
                      borderRadius: 2,
                      flexShrink: 0,
                    }}>
                      attached
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer hint */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "8px 14px",
              borderTop: `1px solid ${C.border}`,
              background: C.surfaceAlt,
              fontFamily: FONTS.mono, fontSize: 9,
              color: C.textDim,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <kbd style={atFootKbd}>↑</kbd>
              <kbd style={atFootKbd}>↓</kbd>
              navigate
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <kbd style={atFootKbd}>↵</kbd>
              attach
            </span>
          </div>
        </div>
      )}

      {/* ── Slash command popup ── */}
      {showSlashMenu && filteredSlashCommands.length > 0 && (
        <div
          className="mx-3 mb-1 rounded-xl border overflow-hidden"
          style={{
            background: C.surface,
            borderColor: C.border,
            boxShadow: "0 -8px 32px #00000080",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          <div className="px-3 py-1.5 text-xs font-medium" style={{ color: C.textFaint, borderBottom: `1px solid ${C.surfaceAlt}` }}>
            <Hash size={10} className="inline mr-1" style={{ verticalAlign: "-1px" }} />
            Commands
          </div>
          {filteredSlashCommands.map((cmd, idx) => (
            <button
              key={cmd.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-all duration-100 text-left"
              style={{
                background: idx === slashIndex ? `${C.info}1f` : "transparent",
                color: idx === slashIndex ? C.textMid : C.textMid,
                borderLeft: idx === slashIndex ? `2px solid ${C.info}` : "2px solid transparent",
              }}
              onMouseEnter={() => setSlashIndex(idx)}
              onClick={() => handleSlashSelect(cmd)}
            >
              <span style={{ color: idx === slashIndex ? C.info : C.textDim }}>
                {cmd.icon}
              </span>
              <span className="font-mono font-semibold" style={{ color: idx === slashIndex ? C.info : C.textMid }}>
                {cmd.label}
              </span>
              <span style={{ color: C.textDim }}>{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Queue Panel (local queue, persists in localStorage) ── */}
      <QueuePanel queue={messageQueue} onRemove={removeFromQueue} onClear={clearQueue} />

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

      {/* ── Input Area — editorial-terminal ── */}
      <div
        style={{
          padding: "12px 14px 14px",
          borderTop: `1px solid ${C.border}`,
          background: C.surface,
        }}
      >
        {/* Editorial kicker above input — "// COMPOSE" + lime indicator */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 2px 8px",
        }}>
          <span
            aria-hidden
            style={{
              width: 5, height: 5, borderRadius: "50%",
              background: isStreaming ? C.accent : C.textFaint,
              boxShadow: isStreaming ? `0 0 6px ${C.accent}80` : "none",
              transition: "background 0.2s",
            }}
          />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: isStreaming ? C.accent : C.textDim,
            }}
          >
            {isStreaming ? "// streaming" : "// compose"}
          </span>
          {input.length > 0 && !isStreaming && (
            <span style={{
              marginLeft: "auto",
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: input.length > 4000 ? C.warn : C.textDim,
              letterSpacing: "0.05em",
            }}>
              {input.length.toLocaleString()}
            </span>
          )}
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = C.accent; }}
          onDragLeave={(e) => { e.currentTarget.style.borderColor = isStreaming ? C.accent : C.accentLine; }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = isStreaming ? C.accent : C.accentLine;
            const files = Array.from(e.dataTransfer.files);
            for (const file of files) {
              try {
                const base64 = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve((reader.result as string).split(",")[1]);
                  reader.readAsDataURL(file);
                });
                const res = await fetch("/api/files/upload-temp", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ fileName: file.name, base64 }),
                });
                const data = await res.json();
                if (data.path) {
                  setAttachments((prev) => [...prev, {
                    id: `__upload_${Date.now()}_${file.name}__`,
                    name: `📎 ${file.name}`,
                    type: "file" as const,
                    language: file.name.split(".").pop() || "unknown",
                    lineCount: 0, charCount: 0, truncated: false,
                    content: `[Uploaded file: ${file.name}]\nPath: ${data.path}\n\nThe user uploaded this file from their computer. Read it at the path above to access its contents.`,
                  }]);
                }
              } catch {}
            }
          }}
          style={{
            overflow: "hidden",
            background: C.surfaceAlt,
            border: `1px solid ${isStreaming ? C.accent : C.accentLine}`,
            borderRadius: 4,
            transition: "border-color 0.25s ease",
            boxShadow: isStreaming
              ? `0 0 24px ${C.accent}30, inset 0 0 0 1px ${C.accent}30`
              : `0 0 0 1px ${C.accentDim}`,
          }}
        >

          {/* Queue is now rendered above as <QueuePanel /> — no inline strip here */}

          {/* Editor context pill — active file + count of other open tabs */}
          {activeTabId && openTabIds && openTabIds.length > 0 && (() => {
            const activeFileName = (activeTabId.split("/").pop() || activeTabId);
            const otherCount = openTabIds.length - (openTabIds.includes(activeTabId) ? 1 : 0);
            return (
              <div className="flex items-center gap-1.5" style={{ padding: "8px 12px 2px" }}>
                <span
                  title={activeTabId}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 7px", borderRadius: 3,
                    background: `${C.accent}12`,
                    border: `1px solid ${C.accent}35`,
                    color: C.accent,
                    fontFamily: FONTS.mono, fontSize: 9,
                    maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  <FileCode2 size={9} style={{ flexShrink: 0 }} />
                  {activeFileName}
                </span>
                {otherCount > 0 && (
                  <span
                    title={openTabIds.filter((id) => id !== activeTabId).join("\n")}
                    style={{
                      padding: "2px 6px", borderRadius: 3,
                      border: `1px solid ${C.border}`,
                      color: C.textDim,
                      fontFamily: FONTS.mono, fontSize: 9,
                    }}
                  >
                    +{otherCount}
                  </span>
                )}
              </div>
            );
          })()}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5" style={{ padding: "10px 12px 4px" }}>
              {attachments.map((att) => {
                const isProblems = att.type === "problems";
                const accentColor = isProblems ? C.accent : att.truncated ? C.warn : C.textMid;
                const borderColor = isProblems ? C.accentLine : att.truncated ? C.warn + "55" : C.border;
                return (
                  <div
                    key={att.id}
                    className="inline-flex items-center gap-1.5 group/chip"
                    style={{
                      padding: "3px 8px",
                      background: isProblems ? C.accentDim : "transparent",
                      border: `1px solid ${borderColor}`,
                      borderRadius: 3,
                      color: accentColor,
                      fontFamily: FONTS.mono,
                      fontSize: 10,
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>
                      {isProblems
                        ? <AlertTriangle size={10} />
                        : att.type === "folder"
                          ? <FolderOpen size={10} />
                          : <FileCode2 size={10} />}
                    </span>
                    {isProblems ? (
                      <span style={{
                        fontFamily: FONTS.mono,
                        fontSize: "0.68rem",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                      }}>
                        problems · {att.problemCount}
                        {att.truncated && att.totalProblemCount ? ` / ${att.totalProblemCount}` : ""}
                      </span>
                    ) : (
                      <>
                        <span className="font-mono truncate" style={{ maxWidth: 140, fontSize: "0.68rem" }}>
                          {att.id}
                        </span>
                        <span
                          className="tabular-nums"
                          style={{ color: C.textDim, fontSize: "0.6rem", flexShrink: 0 }}
                        >
                          {att.lineCount}L
                        </span>
                      </>
                    )}
                    {!isProblems && att.truncated && (
                      <span title={`Truncated from ${att.lineCount} lines to ${MAX_ATTACH_LINES} lines`} style={{ flexShrink: 0 }}>
                        <AlertTriangle size={9} />
                      </span>
                    )}
                    <button
                      className="flex-shrink-0 rounded-sm transition-colors opacity-50 group-hover/chip:opacity-100"
                      style={{ color: isProblems ? C.accent : C.textDim }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = C.error; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = isProblems ? C.accent : C.textDim; }}
                      onClick={() => removeAttachment(att.id)}
                      title="Remove attachment"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="w-full resize-none outline-none bg-transparent"
            style={{
              padding: attachments.length > 0 ? "8px 14px 4px" : "12px 14px 4px",
              fontFamily: FONTS.sans,
              fontSize: 13,
              lineHeight: 1.5,
              color: C.text,
              minHeight: "44px",
              maxHeight: "180px",
              caretColor: C.accent,
            }}
            placeholder={(!projectId || projectId === "default-project") ? "Open a workspace to start..." : mode === "plan" ? "describe what to research..." : "build something..."}
            disabled={!projectId || projectId === "default-project"}
            defaultValue={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            data-testid="chat-input"
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between" style={{ padding: "4px 10px 8px" }}>
            <div className="flex items-center gap-8">
              <button
                className="relative"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 6px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: showAtMenu || attachments.length > 0 ? C.accent : C.textDim,
                  fontFamily: FONTS.mono,
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = C.accent;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = showAtMenu || attachments.length > 0 ? C.accent : C.textDim;
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
                <Paperclip size={11} strokeWidth={1.6} />
                <span>@ attach</span>
                {attachments.length > 0 && (
                  <span
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 8, fontWeight: 700,
                      padding: "1px 4px",
                      background: C.accent,
                      color: C.bg,
                      borderRadius: 2,
                      lineHeight: 1,
                    }}
                  >
                    {attachments.length}
                  </span>
                )}
              </button>

              {/* Upload external file to temp dir */}
              <input
                type="file"
                ref={fileUploadRef}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const base64 = await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve((reader.result as string).split(",")[1]);
                      reader.readAsDataURL(file);
                    });
                    const res = await fetch("/api/files/upload-temp", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ fileName: file.name, base64 }),
                    });
                    const data = await res.json();
                    if (data.path) {
                      setAttachments((prev) => [...prev, {
                        id: `__upload_${Date.now()}__`,
                        name: `📎 ${file.name}`,
                        type: "file" as const,
                        language: file.name.split(".").pop() || "unknown",
                        lineCount: 0,
                        charCount: 0,
                        truncated: false,
                        content: `[Uploaded file: ${file.name}]\nPath: ${data.path}\n\nThe user uploaded this file from their computer. Read it at the path above to access its contents.`,
                      }]);
                    }
                  } catch {}
                  e.target.value = "";
                }}
              />
              <button
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "none", border: "none", cursor: "pointer",
                  color: C.textDim, padding: "4px 6px", borderRadius: 4,
                  fontFamily: FONTS.mono, fontSize: 9, letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
                onClick={() => fileUploadRef.current?.click()}
                title="Upload file from computer (saved to temp)"
              >
                <Upload size={11} strokeWidth={1.6} />
                <span>upload</span>
              </button>

              {!isStreaming && (
                <span
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: C.textDim,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  <CornerDownLeft size={10} strokeWidth={1.6} />
                  <span>send</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isStreaming ? (
                <button
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 14px",
                    background: "transparent",
                    color: C.error,
                    border: `1px solid ${C.error}55`,
                    borderRadius: 4,
                    fontFamily: FONTS.mono,
                    fontSize: 10, fontWeight: 600,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${C.error}14`;
                    e.currentTarget.style.borderColor = C.error;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = `${C.error}55`;
                  }}
                  type="button"
                  onClick={stopStreaming}
                  data-testid="chat-stop-btn"
                >
                  <Square size={9} className="fill-current" />
                  Stop
                </button>
              ) : (() => {
                const canSend = (textareaRef.current?.value?.trim() || input.trim()) || attachments.length > 0;
                return (
                  <button
                    type="button"
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 16px",
                      background: canSend ? C.accent : "transparent",
                      color: canSend ? C.bg : C.textFaint,
                      border: `1px solid ${canSend ? C.accent : C.border}`,
                      borderRadius: 4,
                      fontFamily: FONTS.mono,
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      cursor: canSend ? "pointer" : "not-allowed",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (canSend) {
                        e.currentTarget.style.boxShadow = `0 0 20px ${C.accent}40`;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "none";
                    }}
                    onClick={handleSend}
                    disabled={!canSend}
                    data-testid="chat-send-btn"
                  >
                    {isStreaming ? "Queue" : "Send"}
                    <Send size={10} strokeWidth={1.8} />
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
