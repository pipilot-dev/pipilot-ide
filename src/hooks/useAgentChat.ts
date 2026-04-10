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
  projectId?: string
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<ChatMode>("claude-agent");
  const [todos, setTodos] = useState<{ content: string; activeForm?: string; status: "pending" | "in_progress" | "completed" }[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<{ requestId: string; questions: any[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const contextRef = useRef<WorkspaceContext | undefined>(workspaceContext);
  const checkpointManagerRef = useRef<CheckpointManager | undefined>(checkpointManager);
  const projectIdRef = useRef(projectId);
  messagesRef.current = messages;
  contextRef.current = workspaceContext;
  checkpointManagerRef.current = checkpointManager;
  projectIdRef.current = projectId;

  // Load messages from IndexedDB on project change (same as useChat)
  useEffect(() => {
    if (!projectId) return;
    const sessionId = `agent-${projectId}`;
    db.chatMessages
      .where("sessionId")
      .equals(sessionId)
      .sortBy("timestamp")
      .then((dbMsgs) => {
        const loaded: ChatMessage[] = dbMsgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
          tool_call_id: m.tool_call_id,
        }));
        setMessages(loaded);
      })
      .catch(console.error);
  }, [projectId]);

  // On mount — replay buffered events and auto-resume the session
  const hasResumedRef = useRef(false);
  useEffect(() => {
    if (!projectId || hasResumedRef.current) return;
    hasResumedRef.current = true;

    async function checkAndResume() {
      try {
        const res = await fetch(`/api/agent/replay?projectId=${encodeURIComponent(projectId)}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.events && data.events.length > 0) {
          // Replay buffered events as a resumed message
          const resumeId = generateId();
          const replayParts: any[] = [];
          const replayToolCalls: any[] = [];
          let replayContent = "";

          for (const event of data.events) {
            if (event.type === "text" && event.data) {
              replayContent += event.data;
              const lastPart = replayParts[replayParts.length - 1];
              if (lastPart && lastPart.type === "text") {
                lastPart.content = (lastPart.content || "") + event.data;
              } else {
                replayParts.push({ type: "text", content: event.data });
              }
            } else if (event.type === "tool_use") {
              const toolId = event.id || generateId();
              replayToolCalls.push({
                id: toolId,
                name: event.name || "Tool",
                arguments: event.input ? JSON.stringify(event.input) : "{}",
                status: "done" as const,
              });
              replayParts.push({ type: "tool", toolCallId: toolId });
            } else if (event.type === "tool_result") {
              const tc = replayToolCalls.find((t: any) => t.id === event.tool_use_id);
              if (tc) tc.result = event.result?.substring(0, 2000);
            }
          }

          if (replayContent || replayToolCalls.length > 0) {
            setMessages((prev) => [...prev, {
              id: resumeId,
              role: "assistant" as const,
              content: replayContent || "(Resumed session)",
              timestamp: new Date(),
              toolCalls: replayToolCalls,
              parts: replayParts,
            }]);
          }
        }

        // Always auto-continue if agent is not currently active
        // This resumes the most recent session with continue: true on the server
        if (!data.isActive) {
          setIsStreaming(true);
          setTimeout(() => {
            sendMessage("Continue where you left off. Check what's been done and keep building.");
          }, 1500);
        }
      } catch {}
    }

    checkAndResume();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist messages to IndexedDB (debounced, same as useChat)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!projectId || messages.length === 0) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const sessionId = `agent-${projectId}`;
      const nonStreamingMsgs = messages.filter((m) => !m.streaming);
      if (nonStreamingMsgs.length === 0) return;
      db.chatMessages
        .where("sessionId")
        .equals(sessionId)
        .delete()
        .then(() => {
          return db.chatMessages.bulkPut(
            nonStreamingMsgs.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : undefined,
              tool_call_id: m.tool_call_id,
              sessionId,
              timestamp: m.timestamp,
            }))
          );
        })
        .catch(console.error);
    }, 1000);
  }, [messages, projectId]);

  const sendMessage = useCallback(async (userContent: string) => {
    if (!userContent.trim()) return;

    // If agent is busy, queue the message on the server
    if (isStreaming) {
      const pid = projectIdRef.current || "";
      try {
        await fetch("/api/agent/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: pid, prompt: userContent }),
        });
        // Show the queued message in chat
        setMessages((prev) => [...prev, {
          id: generateId(),
          role: "user" as const,
          content: userContent + "\n\n*(queued — will run after current task)*",
          timestamp: new Date(),
        }]);
      } catch {}
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

    // Create checkpoint before
    if (checkpointManagerRef.current) {
      try {
        await checkpointManagerRef.current.createCheckpoint(
          `Before: ${userContent.slice(0, 50)}`,
          `before-${userMsg.id}`
        );
      } catch {}
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

      const systemPrompt = ctx
        ? `Project: ${ctx.projectType}\nFile tree:\n${ctx.fileTree}\n\n${designGuide}`
        : designGuide;

      // POST to agent server
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userContent, systemPrompt, projectId: pid }),
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
                    // Build parts: append to last text part or create new one
                    const parts = [...(m.parts || [])];
                    const lastPart = parts[parts.length - 1];
                    if (lastPart && lastPart.type === "text") {
                      parts[parts.length - 1] = { ...lastPart, content: (lastPart.content || "") + event.data };
                    } else {
                      parts.push({ type: "text", content: event.data });
                    }
                    return { ...m, content: m.content + event.data, parts };
                  }));
                }
                break;

              case "assistant":
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

      // Create checkpoint after
      if (checkpointManagerRef.current) {
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
  }, [isStreaming]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    const pid = projectIdRef.current;
    if (pid) {
      db.chatMessages.where("sessionId").equals(`agent-${pid}`).delete().catch(console.error);
    }
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  const revertToMessage = useCallback(async (messageId: string) => {
    if (!checkpointManagerRef.current) return;
    const checkpointId = await checkpointManagerRef.current.findCheckpointBeforeMessage(messageId);
    if (checkpointId) {
      await checkpointManagerRef.current.restoreToCheckpoint(checkpointId);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        return idx >= 0 ? prev.slice(0, idx) : prev;
      });
    }
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
    todos,
    pendingQuestion,
    answerQuestion,
  };
}
