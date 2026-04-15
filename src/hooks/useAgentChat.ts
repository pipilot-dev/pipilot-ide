import { useState, useCallback, useRef, useEffect } from "react";
import { db } from "@/lib/db";
import type { ChatMessage, ChatMode, ToolExecutor, WorkspaceContext, CheckpointManager } from "./useChat";

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Infer tool name and description from result text.
 * The Agent SDK on custom APIs only sends tool_result (no tool_use),
 * so we parse the output to determine what tool was used.
 */
function inferToolFromResult(r: string): { name: string; desc: string } {
  // Bash: ls output
  if (r.includes("total ") && (r.includes("drwx") || r.includes("-rw-"))) {
    return { name: "Bash", desc: "$ ls -la" };
  }
  // Bash: pwd or directory listing
  if (r.match(/^\/[\w/.-]+\s*$/) || r.match(/^[A-Z]:\\[\w\\.-]+\s*$/)) {
    return { name: "Bash", desc: `$ pwd → ${r.trim().split(/[\\/]/).pop()}` };
  }
  // Bash: generic command output with path
  if (r.includes("working directory") || r.includes("Directory does not exist")) {
    return { name: "Bash", desc: "Running command" };
  }

  // Write: file created
  if (r.includes("File created successfully")) {
    const match = r.match(/at:\s*(.+)/);
    const filePath = match ? match[1].trim() : "";
    const fileName = filePath.split(/[\\/]/).pop() || "file";
    return { name: "Write", desc: `Creating ${fileName}` };
  }

  // Edit: file edited
  if (r.includes("File edited") || r.includes("successfully edited") || r.includes("Applied edit")) {
    return { name: "Edit", desc: "Editing file" };
  }

  // Read: file content (starts with line numbers like "1\t...")
  if (r.match(/^\d+\t/)) {
    // Try to detect file type from content
    const firstLine = r.split("\n")[0] || "";
    const content = firstLine.replace(/^\d+\t/, "");
    if (content.includes("<!DOCTYPE") || content.includes("<html")) return { name: "Read", desc: "Reading index.html" };
    if (content.includes("package.json") || content.startsWith("{")) return { name: "Read", desc: "Reading package.json" };
    if (content.startsWith("//") || content.startsWith("import ") || content.startsWith("const ")) return { name: "Read", desc: "Reading .js file" };
    if (content.startsWith("/*") || content.startsWith(".") || content.startsWith("@")) return { name: "Read", desc: "Reading .css file" };
    if (content.startsWith("#")) return { name: "Read", desc: "Reading .md file" };
    return { name: "Read", desc: "Reading file" };
  }

  // Read: file not found
  if (r.includes("File does not exist") || r.includes("No such file")) {
    return { name: "Read", desc: "File not found" };
  }

  // Glob: file search results
  if (r.includes("Found ") && r.includes(" files") || r.match(/^[\w/.]+\n/m)) {
    return { name: "Glob", desc: "Finding files" };
  }

  // Grep: search results
  if (r.includes("matches found") || r.match(/^\d+:/m)) {
    return { name: "Grep", desc: "Searching content" };
  }

  // Task/Plan
  if (r.includes("plan mode") || r.includes("Plan mode") || r.includes("Entered plan")) {
    return { name: "Task", desc: "Planning approach" };
  }
  if (r.includes("Exit plan mode") || r.includes("Exited plan")) {
    return { name: "Task", desc: "Plan ready" };
  }
  if (r.includes("Answer questions")) {
    return { name: "Task", desc: "Clarifying approach" };
  }

  // TodoWrite
  if (r.includes("todo") || r.includes("task")) {
    return { name: "TodoWrite", desc: "Updating tasks" };
  }

  // WebSearch
  if (r.includes("search results") || r.includes("Search results")) {
    return { name: "WebSearch", desc: "Searching the web" };
  }

  // Default
  return { name: "Tool", desc: r.substring(0, 50).replace(/\n/g, " ") || "Executing" };
}

export function useAgentChat(
  toolExecutor?: ToolExecutor,
  workspaceContext?: WorkspaceContext,
  checkpointManager?: CheckpointManager,
  projectId?: string,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // True while we're calling the summarizer to compress older messages.
  // The chat panel renders a shimmer status row when this is on.
  const [isOptimizingContext, setIsOptimizingContext] = useState(false);
  const [mode, setMode] = useState<ChatMode>("agent");
  const [todos, setTodos] = useState<{ content: string; activeForm?: string; status: "pending" | "in_progress" | "completed" }[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<{ requestId: string; questions: any[] } | null>(null);
  // Frontend message queue. Persisted in localStorage so it survives reloads
  // and isn't shared with the broken server-side queue. Each project gets
  // its own list keyed by `pipilot:queue:<projectId>`.
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  // ── Multi-session support ──
  // Each project can have multiple chat sessions. The active one is
  // remembered in localStorage so reloading the IDE returns you to the
  // same conversation. Default session id is `agent-<projectId>`.
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const currentSessionIdRef = useRef<string>("");
  currentSessionIdRef.current = currentSessionId;
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const contextRef = useRef<WorkspaceContext | undefined>(workspaceContext);
  const checkpointManagerRef = useRef<CheckpointManager | undefined>(checkpointManager);
  const projectIdRef = useRef(projectId);
  const queueRef = useRef<string[]>([]);
  messagesRef.current = messages;
  contextRef.current = workspaceContext;
  checkpointManagerRef.current = checkpointManager;
  projectIdRef.current = projectId;
  queueRef.current = messageQueue;

  // ── Queue persistence ──
  const queueKey = (pid: string | undefined) => `pipilot:queue:${pid || "default"}`;

  // Load queue from localStorage when project changes
  useEffect(() => {
    if (!projectId) { setMessageQueue([]); return; }
    try {
      const raw = localStorage.getItem(queueKey(projectId));
      setMessageQueue(raw ? JSON.parse(raw) : []);
    } catch {
      setMessageQueue([]);
    }
  }, [projectId]);

  // Persist queue to localStorage on every change
  useEffect(() => {
    if (!projectId) return;
    try {
      if (messageQueue.length > 0) {
        localStorage.setItem(queueKey(projectId), JSON.stringify(messageQueue));
      } else {
        localStorage.removeItem(queueKey(projectId));
      }
    } catch {}
  }, [messageQueue, projectId]);

  // ── Active session resolution ──
  // When the project changes, restore the last-active session from
  // localStorage. If none, use the default `agent-<projectId>`.
  // Also ensure the chatSessions row exists so the picker has something
  // to show even before the user sends a message.
  const sessionPrefKey = (pid: string) => `pipilot:active-session:${pid}`;
  useEffect(() => {
    if (!projectId) { setCurrentSessionId(""); return; }
    let nextId = `agent-${projectId}`;
    try {
      const stored = localStorage.getItem(sessionPrefKey(projectId));
      if (stored) nextId = stored;
    } catch {}
    setCurrentSessionId(nextId);
    // Ensure a chatSessions row exists for this id, then signal readiness
    (async () => {
      try {
        const existing = await db.chatSessions.get(nextId);
        if (!existing) {
          await db.chatSessions.put({
            id: nextId,
            name: "New Chat",
            projectId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      } catch {}
      // Signal that the chat session is ready for the new project.
      // The Generate-with-AI flow in WelcomePage listens for this
      // before auto-sending the prompt.
      window.dispatchEvent(new CustomEvent("pipilot:chat-session-ready", {
        detail: { projectId, sessionId: nextId },
      }));
    })();
  }, [projectId]);

  // Load messages from IndexedDB when session changes.
  // Uses a version counter so rapid switches discard stale loads.
  const loadVersionRef = useRef(0);
  const loadingSessionRef = useRef<string>("");
  useEffect(() => {
    if (!currentSessionId) { setMessages([]); return; }
    // Bump version — any in-flight load with an older version is discarded
    const version = ++loadVersionRef.current;
    loadingSessionRef.current = currentSessionId;
    // Clear immediately so stale messages from prev session can't leak
    setMessages([]);
    const sid = currentSessionId;
    db.chatMessages
      .where("sessionId")
      .equals(sid)
      .sortBy("timestamp")
      .then((dbMsgs) => {
        // Discard if a newer load was started
        if (loadVersionRef.current !== version) return;
        setMessages(dbMsgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
          parts: m.parts ? JSON.parse(m.parts) : undefined,
          tool_call_id: m.tool_call_id,
          reverted: m.reverted || undefined,
        })));
      })
      .catch(() => {});
  }, [currentSessionId]);

  // ── Detect interrupted stream after page refresh ──
  // On page refresh the server aborts the running agent and preserves the
  // event buffer. When the client reloads, it fetches the buffer via
  // /api/agent/replay and rebuilds the last assistant message with full
  // text + tool pills, then marks it as interrupted. The user sees exactly
  // what the agent was doing and can continue with a follow-up message.
  useEffect(() => {
    if (!projectId || isStreaming) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/agent/replay?projectId=${encodeURIComponent(projectId)}`);
        const data = await res.json();
        // Only process if there are buffered events and the stream is NOT
        // still active (we aborted it on disconnect). Also skip if we've
        // already processed this buffer (check if the last assistant msg
        // already has content from IDB persistence).
        if (cancelled || !data.events || data.events.length === 0 || data.isActive) return;

        // Check the IDB-loaded messages — if the last assistant message
        // already looks complete (not streaming, has content), the IDB
        // save captured the state and we don't need the buffer.
        const currentMsgs = messagesRef.current;
        const lastAssistant = [...currentMsgs].reverse().find((m) => m.role === "assistant");
        if (lastAssistant && !lastAssistant.streaming && lastAssistant.content) return;

        console.log(`[agent] Rebuilding interrupted stream from ${data.events.length} buffered events`);

        // Rebuild the assistant message from the buffer events
        let content = "";
        const toolCalls: any[] = [];
        const parts: any[] = [];
        const toolIdSet = new Set<string>();

        for (const event of data.events) {
          switch (event.type) {
            case "text":
              if (event.data) {
                content += event.data;
                const lastPart = parts[parts.length - 1];
                if (lastPart && lastPart.type === "text") {
                  lastPart.content = (lastPart.content || "") + event.data;
                } else {
                  parts.push({ type: "text", content: event.data });
                }
              }
              break;
            case "tool_use": {
              const toolId = event.id || `buf-${toolCalls.length}`;
              if (toolIdSet.has(toolId)) {
                // Update existing with richer input
                const existing = toolCalls.find((tc) => tc.id === toolId);
                if (existing && event.input) {
                  existing.arguments = JSON.stringify(event.input);
                }
                break;
              }
              toolIdSet.add(toolId);
              let cleanInput = event.input;
              if (cleanInput && typeof cleanInput === "object") {
                cleanInput = { ...cleanInput };
                for (const key of ["file_path", "path", "command"]) {
                  if (typeof cleanInput[key] === "string") {
                    cleanInput[key] = cleanInput[key]
                      .replace(/^.*[\/\\]workspaces[\/\\][^\/\\]+[\/\\]/, "")
                      .replace(/\\/g, "/");
                  }
                }
              }
              toolCalls.push({
                id: toolId,
                name: event.name || "Tool",
                arguments: cleanInput ? JSON.stringify(cleanInput) : "{}",
                status: "running" as const,
              });
              parts.push({ type: "tool" as const, toolCallId: toolId });
              break;
            }
            case "tool_result": {
              let resultText = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
              if (resultText) {
                resultText = resultText.replace(/[A-Z]:\\[^\s]*?workspaces[\\\/][^\\\/\s]+[\\\/]/g, "");
                resultText = resultText.replace(/\/[^\s]*?workspaces\/[^\/\s]+\//g, "");
              }
              const tc = toolCalls.find((t) => t.id === event.tool_use_id);
              if (tc) {
                tc.result = (resultText || "").substring(0, 2000);
                tc.status = "done";
              }
              break;
            }
          }
        }

        if (!content && toolCalls.length === 0) return;

        // Append an interruption notice so the user knows what happened
        content += "\n\n---\n*Stream interrupted by page refresh. The agent's work up to this point is shown above. Send a follow-up message to continue.*";

        setMessages((prev) => {
          // Find the last assistant message and replace its content with
          // the rebuilt buffer data (authoritative, has full tool pills)
          const lastIdx = prev.map((m) => m.role).lastIndexOf("assistant");
          if (lastIdx >= 0) {
            const updated = [...prev];
            updated[lastIdx] = {
              ...updated[lastIdx],
              content,
              toolCalls,
              parts,
              streaming: false,
            };
            return updated;
          }
          // No assistant message — create one with the rebuilt content
          return [...prev, {
            id: `interrupted-${Date.now()}`,
            role: "assistant" as const,
            content,
            streaming: false,
            timestamp: new Date(),
            toolCalls,
            parts,
          }];
        });
      } catch (err) {
        console.warn("[agent] Replay check failed:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist messages to IndexedDB — including streaming messages so partial
  // responses survive page refreshes or interrupted streams. Debounced at
  // 500ms during streaming (frequent small updates) and 1500ms when idle.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!projectId || !currentSessionId || messages.length === 0) return;
    // Capture the version at schedule time — if it changes before timeout fires,
    // the save is stale and should be skipped
    const saveVersion = loadVersionRef.current;
    clearTimeout(saveTimeoutRef.current);
    const hasStreaming = messages.some((m) => m.streaming);
    const delay = hasStreaming ? 500 : 1500;
    saveTimeoutRef.current = setTimeout(() => {
      // Skip if session switched since this save was scheduled
      if (loadVersionRef.current !== saveVersion) return;
      const sessionId = currentSessionIdRef.current;
      if (!sessionId) return;
      // Save ALL messages including currently-streaming ones. For a
      // streaming message we snapshot its current content/parts/toolCalls
      // so that if the stream is interrupted, the partial response is
      // still available after reload.
      const toSave = messages.filter((m) => m.content || m.toolCalls?.length || m.parts?.length);
      if (toSave.length === 0) return;
      db.chatMessages
        .where("sessionId")
        .equals(sessionId)
        .delete()
        .then(() => {
          return db.chatMessages.bulkPut(
            toSave.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : undefined,
              parts: m.parts ? JSON.stringify(m.parts) : undefined,
              tool_call_id: m.tool_call_id,
              sessionId,
              timestamp: m.timestamp,
              reverted: m.reverted || undefined,
            }))
          );
        })
        .catch(console.error);
    }, delay);
  }, [messages, projectId, currentSessionId]);

  const sendMessage = useCallback(async (userContent: string) => {
    if (!userContent.trim()) return;

    // Block sending if no real project is active
    if (!projectIdRef.current || projectIdRef.current === "default-project") return;

    // If agent is busy, push to the LOCAL queue (server-side queue is disabled
    // because it kept piling up duplicates). The queue auto-drains when the
    // current stream completes — see the `done` SSE event handler below.
    if (isStreaming) {
      setMessageQueue((prev) => [...prev, userContent]);
      return;
    }

    setIsStreaming(true);

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: userContent,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // ── AI session title generation ──
    // If this is the first user message in the current session, ask the
    // a0 LLM to generate a short descriptive title and update the session.
    // Runs in the background — never blocks the agent request.
    const sidForTitle = currentSessionIdRef.current;
    if (sidForTitle && messagesRef.current.length === 0) {
      (async () => {
        try {
          const session = await db.chatSessions.get(sidForTitle);
          if (!session || session.name === "New Chat" || !session.name) {
            const { generateChatTitle } = await import("@/lib/a0llm");
            const title = await generateChatTitle(userContent);
            if (title) {
              await db.chatSessions.update(sidForTitle, { name: title, updatedAt: new Date() });
            }
          }
        } catch {}
      })();
    }

    const assistantId = generateId();
    setMessages((prev) => [...prev, {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
      timestamp: new Date(),
      toolCalls: [],
      parts: [],
    }]);

    // Create checkpoint in background — never blocks the thinking bubble
    // or the POST to the agent. If it fails, streaming still proceeds.
    // Respects the checkpointsEnabled setting.
    const checkpointsOn = (() => { try { return localStorage.getItem("pipilot:checkpointsEnabled") !== "false"; } catch { return true; } })();
    if (checkpointManagerRef.current && checkpointsOn) {
      checkpointManagerRef.current
        .createCheckpoint(
          `Before: ${userContent.slice(0, 50)}`,
          `before-${userMsg.id}`
        )
        .catch(() => {});
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const pid = projectIdRef.current || "";

      // Build system prompt with workspace context
      const ctx = contextRef.current;
      // Send project context + design guide to the agent server
      const designGuide = `## DESIGN GUIDE

Create distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

Before coding, commit to a BOLD aesthetic direction:
- Pick a clear tone: brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful, editorial/magazine, brutalist, art deco, soft/pastel, industrial — execute with precision.
- What makes this UNFORGETTABLE? What's the one thing someone will remember?

**Typography**: Choose fonts that are beautiful, unique, and interesting. NEVER use Inter, Roboto, Arial, system fonts. Pick distinctive, characterful fonts. Pair a display font with a refined body font.

**Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.

**Motion**: Prioritize high-impact moments — one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Hover states that surprise. Scroll-triggered animations.

**Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.

**Backgrounds & Depth**: Create atmosphere — gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, grain overlays. Never flat solid color backgrounds alone.

**Images**: Use \`https://api.a0.dev/assets/image?text={url-encoded description}&aspect={16:9|1:1|9:16}\` for ALL images. Only 3 aspect ratios: 16:9, 1:1, 9:16. Description must be specific and vivid. Use on every page — hero, cards, profiles.

**Icons**: Lucide CDN (\`<script src="https://unpkg.com/lucide@latest"></script>\`) for UI icons. Simple Icons for brand/social icons. NEVER use emojis as icons.

**Content**: Real, specific content — actual names, prices, dates, descriptions. NEVER lorem ipsum. Complete all pages and sections fully.

NEVER use generic AI aesthetics. No design should be the same. Vary between light/dark, different fonts, different aesthetics. Match implementation complexity to the vision — maximalist designs need elaborate code, minimalist designs need precision and restraint.`;

      // Build open-tabs context: tells the agent which files the user is
      // currently looking at so it can prioritize them without being told.
      let openTabsBlock = "";
      if (ctx?.openTabs && ctx.openTabs.length > 0) {
        const activeLabel = ctx.openTabs[0];
        const others = ctx.openTabs.slice(1);
        openTabsBlock = `\n\nOpen editor tabs (${ctx.openTabs.length}):\n` +
          `  Active: ${activeLabel}\n` +
          (others.length > 0 ? others.map((t) => `  - ${t}`).join("\n") : "");
      }

      const baseSystemPrompt = ctx
        ? `Project: ${ctx.projectType}\nFile tree:\n${ctx.fileTree}${openTabsBlock}\n\n${designGuide}`
        : designGuide;

      // Context compaction is handled server-side by the Agent SDK's
      // built-in /compact command. The server auto-triggers it when the
      // conversation gets long. No client-side summarization needed.
      const systemPrompt = baseSystemPrompt;

      // POST to agent server. `mode` controls whether the agent runs in
      // normal build mode or in plan-only mode (research + plan, no edits).
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userContent, systemPrompt, projectId: pid, mode }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Agent server error: ${res.status}`);
      }

      // Parse SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case "text":
                // Primary text source — streamed, deduplicated by server
                if (event.data) {
                  setMessages((prev) => prev.map((m) => {
                    if (m.id !== assistantId) return m;
                    const parts = [...(m.parts || [])];
                    const lastPart = parts[parts.length - 1];
                    if (lastPart && lastPart.type === "text") {
                      parts[parts.length - 1] = { ...lastPart, content: (lastPart.content || "") + event.data };
                    } else {
                      parts.push({ type: "text", content: event.data });
                    }
                    return { ...m, content: m.content + event.data, parts };
                  }));

                  // Detect terminal command marker in streamed text
                  const fullContent = (messagesRef.current.find(m => m.id === assistantId)?.content || "") + event.data;
                  const termMatch = fullContent.match(/__TERMINAL_CMD__(.+?)__END_TERMINAL_CMD__/);
                  if (termMatch && !(globalThis as any).__terminalCmdSent?.[termMatch[1]]) {
                    if (!(globalThis as any).__terminalCmdSent) (globalThis as any).__terminalCmdSent = {};
                    (globalThis as any).__terminalCmdSent[termMatch[1]] = true;
                    const cmd = termMatch[1];
                    window.dispatchEvent(new CustomEvent("pipilot:open-terminal"));
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent("pipilot:terminal-send", { detail: { command: cmd } }));
                    }, 1000);
                  }
                }
                break;

              case "assistant":
              case "compact_boundary":
                // The SDK compacted the conversation history. Show a brief
                // shimmer so the user knows context was optimized.
                setIsOptimizingContext(true);
                setTimeout(() => setIsOptimizingContext(false), 1500);
                console.log("[chat] conversation compacted by SDK",
                  event.compact_metadata ? `(${event.compact_metadata.pre_tokens} tokens before)` : "");
                break;

              case "content_block_start":
              case "content_block_delta":
              case "user":
              case "system":
              case "heartbeat":
              case "start":
              case "status":
              case "log":
              case "stdout":
                // Ignore — assistant/content_block would duplicate streamed text
                // user/system are context messages, not display content
                break;

              case "tool_use": {
                const toolId = event.id || generateId();
                // Sanitize file paths — strip workspace prefix for clean display
                let cleanInput = event.input;
                if (cleanInput && typeof cleanInput === "object") {
                  cleanInput = { ...cleanInput };
                  for (const key of ["file_path", "path", "command"]) {
                    if (typeof cleanInput[key] === "string") {
                      // Strip workspace paths like C:\Users\...\workspaces\projectId\
                      cleanInput[key] = cleanInput[key]
                        .replace(/^.*[\/\\]workspaces[\/\\][^\/\\]+[\/\\]/, "")
                        .replace(/\\/g, "/");
                    }
                  }
                }
                const toolArgs = cleanInput ? JSON.stringify(cleanInput) : "{}";

                // Capture TodoWrite events for the todo panel
                if (event.name === "TodoWrite" && event.input?.todos) {
                  setTodos(event.input.todos);
                }

                setMessages((prev) => prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const toolCalls = [...(m.toolCalls || [])];

                  // Merge if same ID exists (stream_event sends name first, assistant sends input later)
                  const existingIdx = toolCalls.findIndex(tc => tc.id === toolId);
                  if (existingIdx >= 0) {
                    // Update with richer data (input)
                    if (event.input) {
                      toolCalls[existingIdx] = { ...toolCalls[existingIdx], arguments: toolArgs };
                    }
                  } else {
                    toolCalls.push({
                      id: toolId,
                      name: event.name || "Tool",
                      arguments: toolArgs,
                      status: "running" as const,
                    });
                    // Also add tool part for interleaved rendering
                    const parts = [...(m.parts || [])];
                    parts.push({ type: "tool" as const, toolCallId: toolId });
                    return { ...m, toolCalls, parts };
                  }
                  return { ...m, toolCalls };
                }));
                break;
              }

              case "tool_result": {
                let resultText = typeof event.result === "string"
                  ? event.result
                  : JSON.stringify(event.result);
                // Sanitize workspace paths in results
                if (resultText) {
                  resultText = resultText.replace(/[A-Z]:\\[^\s]*?workspaces[\\\/][^\\\/\s]+[\\\/]/g, "");
                  resultText = resultText.replace(/\/[^\s]*?workspaces\/[^\/\s]+\//g, "");
                }
                const truncResult = resultText?.substring(0, 2000) || "";

                setMessages((prev) => prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const toolCalls = [...(m.toolCalls || [])];
                  const toolId = event.tool_use_id || generateId();

                  // Find the tool_use pill that was already created
                  const matchIdx = toolCalls.findIndex(tc => tc.id === toolId);
                  if (matchIdx >= 0) {
                    // Update existing pill with result
                    toolCalls[matchIdx] = { ...toolCalls[matchIdx], status: "done" as const, result: truncResult };
                    return { ...m, toolCalls };
                  } else {
                    // No tool_use was received — create pill from result (fallback)
                    const { name: toolName, desc: toolDesc } = inferToolFromResult(resultText || "");
                    toolCalls.push({
                      id: toolId,
                      name: toolName,
                      arguments: JSON.stringify({ description: toolDesc }),
                      status: "done" as const,
                      result: truncResult,
                    });
                    const parts = [...(m.parts || [])];
                    parts.push({ type: "tool" as const, toolCallId: toolId });
                    return { ...m, toolCalls, parts };
                  }
                }));
                break;
              }

              case "files_changed":
                break;

              case "queued":
                // Message was queued because agent is busy
                break;

              case "queued_next":
                // Server says there's a queued message to process next
                if (event.prompt) {
                  setTimeout(() => sendMessage(event.prompt), 1000);
                }
                break;

              case "result":
                // Final result — typewriter animate if no text was streamed
                if (event.result && typeof event.result === "string") {
                  const currentContent = messagesRef.current.find(m => m.id === assistantId)?.content || "";
                  if (!currentContent) {
                    const text = event.result;
                    const chunkSize = 3;
                    const delay = 15;
                    for (let i = 0; i < text.length; i += chunkSize) {
                      const chunk = text.slice(i, i + chunkSize);
                      setMessages((prev) => prev.map((m) => {
                        if (m.id !== assistantId) return m;
                        const parts = [...(m.parts || [])];
                        const lastPart = parts[parts.length - 1];
                        if (lastPart && lastPart.type === "text") {
                          parts[parts.length - 1] = { ...lastPart, content: (lastPart.content || "") + chunk };
                        } else {
                          parts.push({ type: "text", content: chunk });
                        }
                        return { ...m, content: m.content + chunk, parts };
                      }));
                      await new Promise(r => setTimeout(r, delay));
                    }
                  }
                }
                // Append cost if available
                if (event.cost !== undefined && event.cost > 0) {
                  const costStr = `\n\n---\n*Cost: $${event.cost.toFixed(4)}*`;
                  setMessages((prev) => prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + costStr } : m
                  ));
                }
                break;

              case "ask_user": {
                // Agent is asking a question — show it and collect answer
                setPendingQuestion({
                  requestId: event.requestId,
                  questions: event.questions,
                });
                break;
              }

              case "terminal_command": {
                // Legacy SSE-based terminal command (kept for compat)
                const cmd = event.command;
                if (cmd) {
                  window.dispatchEvent(new CustomEvent("pipilot:open-terminal"));
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent("pipilot:terminal-send", { detail: { command: cmd } }));
                  }, 1000);
                }
                break;
              }

              case "complete":
                // Stream done
                break;

              case "error":
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantId ? {
                    ...m,
                    content: m.content + `\n\nError: ${event.message}`,
                  } : m
                ));
                break;
            }
          } catch {
            // skip malformed events
          }
        }
      }

      // Mark as done
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, streaming: false } : m
      ));

      // Create checkpoint after (respects setting)
      if (checkpointManagerRef.current && checkpointsOn) {
        try {
          await checkpointManagerRef.current.createCheckpoint(
            `After: ${userContent.slice(0, 50)}`,
            userMsg.id
          );
        } catch {}
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? {
            ...m,
            content: m.content || `Error: ${err.message || "Agent request failed"}`,
            streaming: false,
          } : m
        ));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming, mode]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  // ── Queue actions ──
  const removeFromQueue = useCallback((index: number) => {
    setMessageQueue((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearQueue = useCallback(() => {
    setMessageQueue([]);
  }, []);

  // ── Auto-drain the queue when streaming completes ──
  // When isStreaming flips to false and there's something in the queue,
  // pop the head and send it. The recursive sendMessage call handles the
  // streaming flag, so the chain self-perpetuates until the queue is empty.
  const drainingRef = useRef(false);
  useEffect(() => {
    if (isStreaming) return;
    if (messageQueue.length === 0) return;
    if (drainingRef.current) return;
    drainingRef.current = true;
    // Pop the first message and send it. Defer one tick so React commits
    // the state update before sendMessage reads it.
    const next = messageQueue[0];
    setMessageQueue((prev) => prev.slice(1));
    setTimeout(() => {
      drainingRef.current = false;
      sendMessage(next);
    }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, messageQueue]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    // Also clear any queued messages — the user explicitly chose a clean slate.
    setMessageQueue([]);
    const pid = projectIdRef.current;
    const sid = currentSessionIdRef.current;
    if (sid) {
      db.chatMessages.where("sessionId").equals(sid).delete().catch(console.error);
      // Drop the cached conversation summary too
      import("@/lib/conversationSummary").then((m) => m.clearConversationSummaryCache(sid)).catch(() => {});
    }
    if (pid) {
      try { localStorage.removeItem(queueKey(pid)); } catch {}
    }
  }, []);

  // ── Multi-session management ──
  const createSession = useCallback(async (name?: string): Promise<string> => {
    const pid = projectIdRef.current;
    if (!pid) return "";
    const id = `agent-${pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();
    await db.chatSessions.put({
      id,
      name: name || "New Chat",
      projectId: pid,
      createdAt: now,
      updatedAt: now,
    });
    // Switch to it immediately. Persist as the active session.
    setCurrentSessionId(id);
    try { localStorage.setItem(sessionPrefKey(pid), id); } catch {}
    setMessages([]);
    return id;
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    const pid = projectIdRef.current;
    if (!pid || !sessionId) return;
    setCurrentSessionId(sessionId);
    try { localStorage.setItem(sessionPrefKey(pid), sessionId); } catch {}
  }, []);

  const renameSession = useCallback(async (sessionId: string, name: string) => {
    try {
      await db.chatSessions.update(sessionId, { name, updatedAt: new Date() });
    } catch {}
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    const pid = projectIdRef.current;
    if (!pid || !sessionId) return;
    // Don't allow deleting the last remaining session — wipe it instead.
    const allForProject = await db.chatSessions.where("projectId").equals(pid).toArray();
    if (allForProject.length <= 1) {
      // Just clear messages for the current session
      await db.chatMessages.where("sessionId").equals(sessionId).delete().catch(() => {});
      setMessages([]);
      return;
    }
    try {
      await db.chatMessages.where("sessionId").equals(sessionId).delete();
      await db.chatSessions.delete(sessionId);
    } catch {}
    // If we deleted the active session, switch to another one
    if (currentSessionIdRef.current === sessionId) {
      const next = allForProject.find((s) => s.id !== sessionId);
      if (next) switchSession(next.id);
    }
  }, [switchSession]);

  const deleteMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  /**
   * Revert the project state back to when the user sent `messageId`:
   *   1. Capture the original user-message content (so the chat input can
   *      be prefilled and the user can re-send / edit it)
   *   2. Restore the disk snapshot taken right before that message
   *   3. Mark that message and everything after it as `reverted: true`
   *      (messages are kept for redo support, just rendered dimmed)
   *
   * Returns the original message content so the caller can prefill it
   * into the chat input.
   */
  const revertToMessage = useCallback(async (messageId: string): Promise<string | null> => {
    if (!checkpointManagerRef.current) return null;

    // 1. Find the user message in the current list and capture its content
    const target = messagesRef.current.find((m) => m.id === messageId);
    const originalContent = target?.content || null;

    // 2. Find + restore the "before" checkpoint
    const checkpointId = await checkpointManagerRef.current.findCheckpointBeforeMessage(messageId);
    if (checkpointId) {
      try {
        await checkpointManagerRef.current.restoreToCheckpoint(checkpointId);
      } catch (err) {
        console.error("[revert] checkpoint restore failed:", err);
      }
    } else {
      console.warn("[revert] no checkpoint found for message", messageId, "— input will still be prefilled");
    }

    // 3. Mark messages from this point onward as reverted (keep them in state).
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx < 0) return prev;
      return prev.map((m, i) => (i >= idx ? { ...m, reverted: true } : m));
    });

    return originalContent;
  }, []);

  /**
   * Redo: un-revert messages from `messageId` onward (restore them to visible).
   * Also restores the checkpoint associated with the LAST assistant message
   * before the next reverted block, so the file state matches.
   */
  const redoToMessage = useCallback(async (messageId: string) => {
    // Find the target message — it should be a user message that starts a reverted block
    const target = messagesRef.current.find((m) => m.id === messageId);
    if (!target) return;

    // Find the last assistant message in the block that we're un-reverting,
    // so we can restore files to match that state. Walk forward from messageId
    // until we hit a non-reverted message or the end.
    const msgs = messagesRef.current;
    const startIdx = msgs.findIndex((m) => m.id === messageId);
    if (startIdx < 0) return;

    // Find the next user message that is ALSO reverted — that's where the next
    // checkpoint boundary would be. Un-revert everything up to (but not including) it.
    let endIdx = msgs.length;
    for (let i = startIdx + 1; i < msgs.length; i++) {
      if (msgs[i].role === "user" && msgs[i].reverted) {
        endIdx = i;
        break;
      }
    }

    // Try to restore the checkpoint that belongs to the end boundary
    // (i.e., the checkpoint taken before endIdx's user message, which is the
    // state AFTER the block we're un-reverting completed).
    if (checkpointManagerRef.current && endIdx < msgs.length) {
      const cpId = await checkpointManagerRef.current.findCheckpointBeforeMessage(msgs[endIdx].id);
      if (cpId) {
        try {
          await checkpointManagerRef.current.restoreToCheckpoint(cpId);
        } catch (err) {
          console.error("[redo] checkpoint restore failed:", err);
        }
      }
    } else if (checkpointManagerRef.current) {
      // Un-reverting to the very end — restore the latest checkpoint
      // by finding the last assistant message's checkpoint
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant" && m.checkpointId);
      if (lastAssistant?.checkpointId) {
        try {
          await checkpointManagerRef.current.restoreToCheckpoint(lastAssistant.checkpointId);
        } catch (err) {
          console.error("[redo] checkpoint restore failed:", err);
        }
      }
    }

    // Un-revert the messages in range [startIdx, endIdx)
    setMessages((prev) => {
      const idSet = new Set(prev.slice(startIdx, endIdx).map((m) => m.id));
      return prev.map((m) => (idSet.has(m.id) ? { ...m, reverted: undefined } : m));
    });
  }, []);

  const answerQuestion = useCallback(async (requestId: string, answers: Record<string, string>) => {
    try {
      await fetch("/api/agent/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          answer: { questions: pendingQuestion?.questions, answers },
        }),
      });
      setPendingQuestion(null);
    } catch (err) {
      console.error("Failed to send answer:", err);
    }
  }, [pendingQuestion]);

  // Continue an interrupted session — clears the flag and sends a continuation
  const continueInterrupted = useCallback((messageId: string) => {
    setMessages((prev) => prev.map(m => m.id === messageId ? { ...m, interrupted: false } : m));
    sendMessage("Continue where you left off. Check what's been done and keep building.");
  }, [sendMessage]);

  // Dismiss the interruption marker (called when user chooses "Tell PiPilot something else")
  // The user-supplied message is sent normally via sendMessage by the UI.
  const dismissInterruption = useCallback((messageId: string) => {
    setMessages((prev) => prev.map(m => m.id === messageId ? { ...m, interrupted: false } : m));
  }, []);

  return {
    messages,
    isStreaming,
    mode,
    setMode,
    sendMessage,
    stopStreaming,
    clearMessages,
    deleteMessage,
    revertToMessage,
    redoToMessage,
    todos,
    pendingQuestion,
    answerQuestion,
    continueInterrupted,
    dismissInterruption,
    messageQueue,
    removeFromQueue,
    clearQueue,
    // Status
    isOptimizingContext,
    // Multi-session
    currentSessionId,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
  };
}
