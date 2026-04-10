import { useState, useCallback, useRef, useEffect } from "react";
import { db } from "@/lib/db";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";

export type ChatMode = "chat" | "agent" | "claude-agent";

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status: "pending" | "running" | "done" | "error";
}

export interface BuiltinToolStatus {
  name: string;
  type: "tool_start" | "tool_done";
  arguments?: Record<string, unknown>;
}

export interface MessagePart {
  type: "text" | "tool";
  content?: string;       // for text parts
  toolCallId?: string;    // for tool parts — references toolCalls[] by id
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  streaming?: boolean;
  timestamp: Date;
  toolCalls?: ToolCallInfo[];
  builtinToolStatuses?: BuiltinToolStatus[];
  tool_call_id?: string;
  checkpointId?: string;
  parts?: MessagePart[];  // ordered sequence of text chunks and tool calls
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// Known file tools that we execute client-side
const LOCAL_TOOL_NAMES = new Set([
  "read_file", "list_files", "edit_file", "create_file",
  "delete_file", "search_files", "get_file_info", "deploy_site",
  "rename_file", "copy_file", "batch_create_files", "get_project_tree",
  "screenshot_preview",
  "preview_click", "preview_scroll", "preview_type", "preview_find_elements",
  "run_script",
]);

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

// OpenAI-format tool definitions sent to the server
// Only core coding tools — keep this lean for faster LLM responses
const FILE_TOOLS = [
  { type: "function", function: { name: "read_file", description: "Read file contents. Path must be relative, NO leading slash.", parameters: { type: "object", properties: { path: { type: "string" }, startLine: { type: "number" }, endLine: { type: "number" } }, required: ["path"] } } },
  { type: "function", function: { name: "list_files", description: "List files in directory. Use '' for root.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "create_file", description: "Create file with content. Parent dirs auto-created.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "edit_file", description: "Edit file via search/replace or full rewrite (newContent).", parameters: { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" }, newContent: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "delete_file", description: "Delete file or directory.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "batch_create_files", description: "Create multiple files at once. Much faster than individual creates.", parameters: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }, required: ["files"] } } },
  { type: "function", function: { name: "get_project_tree", description: "Visual tree of entire project with line counts.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "search_files", description: "Search files by name or content.", parameters: { type: "object", properties: { query: { type: "string" }, searchContents: { type: "boolean" } }, required: ["query"] } } },
  // { type: "function", function: { name: "rename_file", description: "Rename/move file.", parameters: { type: "object", properties: { oldPath: { type: "string" }, newPath: { type: "string" } }, required: ["oldPath", "newPath"] } } },
  // { type: "function", function: { name: "copy_file", description: "Copy file.", parameters: { type: "object", properties: { srcPath: { type: "string" }, destPath: { type: "string" } }, required: ["srcPath", "destPath"] } } },
  // { type: "function", function: { name: "deploy_site", description: "Deploy to live URL.", parameters: { type: "object", properties: { slug: { type: "string" } }, required: [] } } },
  // { type: "function", function: { name: "screenshot_preview", description: "Screenshot the preview.", parameters: { type: "object", properties: {}, required: [] } } },
  // { type: "function", function: { name: "preview_click", description: "Click element in preview.", parameters: { type: "object", properties: { selector: { type: "string" }, x: { type: "number" }, y: { type: "number" } }, required: [] } } },
  // { type: "function", function: { name: "preview_scroll", description: "Scroll preview.", parameters: { type: "object", properties: { direction: { type: "string" }, amount: { type: "number" } }, required: ["direction"] } } },
  // { type: "function", function: { name: "preview_type", description: "Type into preview input.", parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" }, clear: { type: "boolean" }, pressEnter: { type: "boolean" } }, required: ["selector", "text"] } } },
  // { type: "function", function: { name: "preview_find_elements", description: "Find interactive elements in preview.", parameters: { type: "object", properties: { type: { type: "string" } }, required: [] } } },
  { type: "function", function: { name: "run_script", description: "Execute JS/Node.js code and return output. Use console.log().", parameters: { type: "object", properties: { code: { type: "string" }, timeout: { type: "number", description: "Seconds (default 3)" } }, required: ["code"] } } },
];

export interface WorkspaceContext {
  fileTree: string;
  projectType: string;
  dependencies: string;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildToolDescriptions(): string {
  return `
Available file tools (call using <tool_call> tags):
1. **read_file** - Read file contents. Params: { "path": "file path", "startLine": number, "endLine": number }. Max 150 lines default.
2. **create_file** - Create a new file. Params: { "path": "file path", "content": "full file content" }. Parent dirs auto-created.
3. **edit_file** - Edit a file. Params: { "path": "file path", "search": "exact old text", "replace": "new text" } OR { "path": "file path", "newContent": "full new content" }.
4. **delete_file** - Delete a file. Params: { "path": "file path" }.
5. **list_files** - List directory. Params: { "path": "dir path" }.
6. **search_files** - Search files. Params: { "query": "search text", "searchContents": true/false, "path": "optional dir" }.`;
}

function buildSystemPrompt(ctx?: WorkspaceContext): string {
  const projectInfo = ctx
    ? `
## CURRENT PROJECT

**Stack:** ${ctx.projectType}
**Key dependencies:** ${ctx.dependencies}

**File tree:**
\`\`\`
${ctx.fileTree}
\`\`\`
`
    : "";

  // Detect project type from context
  const isCloud = ctx?.projectType?.includes("E2B Cloud") || ctx?.projectType?.includes("Cloud");
  const isNodebox = ctx?.projectType?.includes("Nodebox");
  const isViteReact = ctx?.projectType?.includes("Vite") || ctx?.fileTree?.includes("vite.config");
  const isNextjs = ctx?.projectType?.includes("Next") || ctx?.fileTree?.includes("next.config");
  const isExpress = ctx?.fileTree?.includes("express") || ctx?.fileTree?.includes("server.js");
  const isNodeProject = isCloud || isNodebox || isViteReact || isNextjs;

  // Build stack section based on project type
  let stackSection: string;

  if (isViteReact) {
    stackSection = `## STACK

This is a **Vite + React** project with a Node.js runtime.
- **DO NOT** delete existing Vite/React files or switch to vanilla HTML
- Build with **React components** using JSX in \`.jsx\`/\`.tsx\` files
- The entry point is \`src/main.jsx\` → \`src/App.jsx\`
- Use \`import\`/\`export\` ES module syntax
- Install packages by adding them to \`package.json\` dependencies — the runtime installs them automatically
- For styling: use CSS modules, inline styles, or add Tailwind CSS to the project
- The dev server runs with HMR — changes appear instantly in the preview
- Create components in \`src/components/\`, pages in \`src/pages/\`, etc.
- Use React hooks (useState, useEffect, useRef, etc.) for state management
- **IMPORTANT:** Keep the \`vite.config.js\` — it has server settings for the preview to work`;
  } else if (isNextjs) {
    stackSection = `## STACK

This is a **Next.js** project (App Router) with a Node.js runtime.
- **DO NOT** delete existing Next.js files or switch to vanilla HTML
- Build with **React Server Components** and Client Components (\`'use client'\`)
- Pages go in \`app/\` directory: \`app/page.jsx\`, \`app/about/page.jsx\`, etc.
- Layouts go in \`app/layout.jsx\`
- API routes go in \`app/api/route.js\`
- Use \`import\`/\`export\` ES module syntax
- Install packages by adding them to \`package.json\` dependencies
- Next.js handles routing automatically based on the file structure
- **IMPORTANT:** Keep \`next.config.mjs\` — it has settings for the preview to work`;
  } else if (isExpress && isNodeProject) {
    stackSection = `## STACK

This is an **Express.js** project with a Node.js runtime.
- **DO NOT** switch to vanilla HTML — this is a server-side project
- The entry point is \`server.js\` — it runs an Express server
- Serve static files from \`public/\` directory
- Create API routes with \`app.get()\`, \`app.post()\`, etc.
- Install packages by adding them to \`package.json\` dependencies
- The server listens on port 3000`;
  } else if (isNodeProject) {
    stackSection = `## STACK

This is a **Node.js** project.
- Build with JavaScript/Node.js
- Use \`require()\` for CommonJS or \`import\` for ES modules
- Install packages by adding them to \`package.json\` dependencies
- The runtime installs dependencies automatically`;
  } else {
    stackSection = `## STACK

The default stack is **HTML + CSS + JavaScript** with the **Tailwind CSS CDN** for styling.
- All projects start with \`index.html\`, \`styles.css\`, and \`app.js\`
- Use \`<script src="https://cdn.tailwindcss.com"></script>\` in the HTML head for Tailwind
- Use vanilla JavaScript — no frameworks, no build step, no npm
- The preview updates live as files are created/edited
- You can also build projects using **multiple JS files** organized by feature (e.g. \`router.js\`, \`api.js\`, \`components.js\`, \`utils.js\`)
- For data-heavy apps, create a separate \`data.js\` file with all content/data arrays`;
  }

  // Routing section — only for static projects
  const routingSection = isNodeProject ? "" : `
## ROUTING & MULTI-PAGE ARCHITECTURE (CRITICAL)

Build real, multi-page apps using **hash-based routing** — not single static pages.`;

  return `You are PiPilot, an expert AI software engineer in a browser IDE with file tools and live preview.${isNodeProject ? " Node.js runtime available." : ""}
${projectInfo}
${stackSection}
${!isNodeProject ? `
## ROUTING (static projects only)
Build multi-page apps with hash routing: \`#/\`, \`#/about\`, \`#/product/{slug}\`. Listen to \`hashchange\`. Create reusable render functions (renderNavbar, renderCard, etc.). Always include detail pages for listings.` : ""}

## TOOLS

File paths are **relative, NO leading slash**: \`"app.js"\` ✅ \`"/app.js"\` ❌. Root = \`""\`.

**Files:** create_file, edit_file (search/replace or newContent), read_file, delete_file, list_files, search_files, batch_create_files (use for 2+ files), rename_file, copy_file, get_project_tree
**Preview:** screenshot_preview (verify UI visually), preview_find_elements, preview_click, preview_scroll, preview_type
**Other:** deploy_site${isNodeProject ? "" : " (to puter.site)"}, run_script (test logic/APIs, can fs.readFileSync but NEVER fs.writeFileSync — use create_file/edit_file for writes)

## DESIGN

Create distinctive, production-grade interfaces. NEVER generic "AI slop" aesthetics. Commit to a BOLD aesthetic direction.
- **Typography**: Distinctive, characterful fonts. NEVER Inter/Roboto/Arial. Pair display + body fonts.
- **Color**: Cohesive palette with CSS variables. Dominant colors + sharp accents.
- **Motion**: Staggered fadeIn on load (animation-delay), hover surprises, scroll-triggered animations.
- **Layout**: Unexpected compositions — asymmetry, overlap, grid-breaking, generous negative space.
- **Depth**: Gradient meshes, noise textures, shadows, grain overlays. Never flat solid backgrounds.
- **Images**: \`https://api.a0.dev/assets/image?text={url-encoded description}&aspect={16:9|1:1|9:16}\`. Every page.
- **Icons**: Lucide CDN for UI, Simple Icons for brands. No emojis.
- **Content**: Real names, prices, dates. No lorem ipsum. Complete all pages fully.
No design should be the same. Vary fonts, themes, aesthetics. Match complexity to vision.

## RULES (STRICT)

1. NEVER paste code in chat — use file tools only. Keep chat to 1 sentence max.
2. **EXACTLY ONE tool call per response. NEVER call 2+ tools at once.** After each tool call, stop and let it execute. Then continue in the next step.
3. read_file before edit_file. Never guess at content.
4. Build one file at a time: index.html → styles.css → app.js. User sees each file appear live.
5. Build complete, polished, production-quality apps with real content.
6. For new projects: DON'T read existing files first. Just start creating. Use get_project_tree only if editing existing code.
7. **NEVER use run_script with fs.writeFileSync.** All file writes MUST use create_file or edit_file so changes sync to the IDE. run_script can read files with fs.readFileSync but writing bypasses the IDE and preview.`;
}

// ─── AI SDK Provider ────────────────────────────────────────────────────────

const provider = createOpenAICompatible({
  name: "pipilot",
  baseURL: "https://the3rdacademy.com/api",
  apiKey: "unused",
  transformRequestBody: (body: Record<string, any>) => ({
    ...body,
    direct_kilo: true,
  }),
});

// ─── AI SDK Tool Definitions ────────────────────────────────────────────────

const MAX_TOOL_RESULT = 12000; // ~3000 tokens — generous context for file reads

function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT) return result;
  const truncated = result.slice(0, MAX_TOOL_RESULT);
  const lines = result.split("\n").length;
  return truncated + `\n\n[Truncated — ${result.length} chars, ${lines} lines total. Use read_file with startLine/endLine for specific sections.]`;
}

function buildAITools(executor: ToolExecutor) {
  // Wrapper that executes a tool and truncates the result
  const exec = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await executor(name, args);
    return truncateToolResult(result);
  };

  return {
    read_file: tool({
      description: "Read file contents. Path must be relative, NO leading slash.",
      parameters: z.object({
        path: z.string(),
        startLine: z.number().optional(),
        endLine: z.number().optional(),
      }),
      execute: async (args) => exec("read_file", args),
    }),
    list_files: tool({
      description: "List files in directory. Use '' for root.",
      parameters: z.object({ path: z.string().default("") }),
      execute: async (args) => exec("list_files", { ...args, path: args.path ?? "" }),
    }),
    create_file: tool({
      description: "Create file with content. Parent dirs auto-created.",
      parameters: z.object({ path: z.string(), content: z.string().optional() }),
      execute: async (args) => exec("create_file", args),
    }),
    edit_file: tool({
      description: "Edit file via search/replace or full rewrite (newContent).",
      parameters: z.object({
        path: z.string(),
        search: z.string().optional(),
        replace: z.string().optional(),
        newContent: z.string().optional(),
      }),
      execute: async (args) => exec("edit_file", args),
    }),
    delete_file: tool({
      description: "Delete file or directory.",
      parameters: z.object({ path: z.string() }),
      execute: async (args) => exec("delete_file", args),
    }),
    batch_create_files: tool({
      description: "Create multiple files at once. Much faster than individual creates.",
      parameters: z.object({
        files: z.union([
          z.array(z.object({ path: z.string(), content: z.string() })),
          z.string(), // LLM sometimes sends stringified JSON
        ]),
      }),
      execute: async (args) => {
        // Handle case where LLM sends files as a JSON string instead of array
        let files = args.files;
        if (typeof files === "string") {
          try { files = JSON.parse(files); } catch { return "Error: invalid files JSON"; }
        }
        return exec("batch_create_files", { files });
      },
    }),
    get_project_tree: tool({
      description: "Visual tree of entire project with line counts.",
      parameters: z.object({}),
      execute: async () => exec("get_project_tree", {}),
    }),
    search_files: tool({
      description: "Search files by name or content.",
      parameters: z.object({
        query: z.string(),
        searchContents: z.boolean().optional(),
      }),
      execute: async (args) => exec("search_files", args),
    }),
    run_script: tool({
      description: "Execute JS/Node.js code and return output. Use console.log(). Can read files with fs.readFileSync. NEVER use fs.writeFileSync — use create_file/edit_file tools for writes so changes sync to the IDE.",
      parameters: z.object({
        code: z.string(),
        timeout: z.number().optional(),
      }),
      execute: async (args) => exec("run_script", args),
    }),
  };
}

// ─── Checkpoint Manager Interface ────────────────────────────────────────────

export interface CheckpointManager {
  createCheckpoint: (label: string, messageId?: string) => Promise<void>;
  restoreToCheckpoint: (id: string) => Promise<void>;
  findCheckpointBeforeMessage: (messageId: string) => Promise<string | null>;
}

// ─── useChat Hook ────────────────────────────────────────────────────────────

export function useChat(
  toolExecutor?: ToolExecutor,
  workspaceContext?: WorkspaceContext,
  checkpointManager?: CheckpointManager,
  projectId?: string
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<ChatMode>("agent");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const contextRef = useRef<WorkspaceContext | undefined>(workspaceContext);
  const checkpointManagerRef = useRef<CheckpointManager | undefined>(checkpointManager);
  const projectIdRef = useRef(projectId);
  contextRef.current = workspaceContext;
  checkpointManagerRef.current = checkpointManager;
  projectIdRef.current = projectId;
  messagesRef.current = messages;

  // Load messages from IndexedDB on project change
  useEffect(() => {
    if (!projectId) return;
    const sessionId = `chat-${projectId}`;
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
          builtinToolStatuses: m.builtinToolStatuses ? JSON.parse(m.builtinToolStatuses) : undefined,
          tool_call_id: m.tool_call_id,
        }));
        setMessages(loaded);
      })
      .catch(console.error);
  }, [projectId]);

  // Persist messages to IndexedDB whenever they change
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!projectId || messages.length === 0) return;
    // Debounce saves to avoid thrashing during streaming
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const sessionId = `chat-${projectId}`;
      const nonStreamingMsgs = messages.filter((m) => !m.streaming);
      if (nonStreamingMsgs.length === 0) return;
      // Clear old messages for this session and write new ones
      db.chatMessages
        .where("sessionId")
        .equals(sessionId)
        .delete()
        .then(() =>
          db.chatMessages.bulkPut(
            nonStreamingMsgs.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              sessionId,
              timestamp: m.timestamp,
              toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : undefined,
              builtinToolStatuses: m.builtinToolStatuses ? JSON.stringify(m.builtinToolStatuses) : undefined,
              tool_call_id: m.tool_call_id,
            }))
          )
        )
        .catch(console.error);
    }, 1000);
  }, [messages, projectId]);

  const sendMessage = useCallback(
    async (userContent: string) => {
      if (!userContent.trim() || isStreaming) return;

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: userContent,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Create a "before" checkpoint capturing file state BEFORE this message's AI actions
        if (checkpointManagerRef.current) {
          const beforeLabel = `Before: ${userContent.slice(0, 50)}${userContent.length > 50 ? "..." : ""}`;
          try {
            await checkpointManagerRef.current.createCheckpoint(beforeLabel, `before-${userMsg.id}`);
          } catch (e) {
            console.error("Failed to create before-checkpoint:", e);
          }
        }

        // Build conversation history — keep last 10 messages to limit token usage
        // AI SDK handles tool results internally within each step
        const MAX_CONTEXT_MESSAGES = 10;
        const allMessages = [...messagesRef.current, userMsg];
        let conversationMessages = allMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, i, arr) => {
            let content = m.content;
            // Truncate old assistant messages (not the latest) to save tokens
            if (m.role === "assistant" && i < arr.length - 2 && content.length > 500) {
              content = content.slice(0, 500) + "\n[...truncated]";
            }
            return { role: m.role as "user" | "assistant", content };
          });

        // Trim old messages but always keep at least the latest user message
        if (conversationMessages.length > MAX_CONTEXT_MESSAGES) {
          conversationMessages = conversationMessages.slice(-MAX_CONTEXT_MESSAGES);
        }

        const assistantId = generateId();
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            streaming: true,
            timestamp: new Date(),
            toolCalls: [],
            builtinToolStatuses: [],
          },
        ]);

        const maxSteps = mode === "agent" ? 50 : 10;
        const aiTools = toolExecutor ? buildAITools(toolExecutor) : undefined;

        const result = streamText({
          model: provider("kilo-auto/free"),
          system: buildSystemPrompt(contextRef.current),
          messages: conversationMessages,
          tools: aiTools,
          stopWhen: stepCountIs(maxSteps),
          abortSignal: controller.signal,
          maxOutputTokens: 16384,
          temperature: 0.7,

          onChunk({ chunk }) {
            if (chunk.type === "text-delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + chunk.textDelta }
                    : m
                )
              );
            }
          },

          experimental_onToolCallStart({ toolCall }) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: [
                        ...(m.toolCalls || []),
                        {
                          id: toolCall.toolCallId,
                          name: toolCall.toolName,
                          arguments: JSON.stringify(toolCall.input),
                          status: "running" as const,
                        },
                      ],
                    }
                  : m
              )
            );
          },

          experimental_onToolCallFinish({ toolCall, success, ...rest }) {
            const resultStr = success
              ? typeof (rest as any).output === "string"
                ? (rest as any).output
                : JSON.stringify((rest as any).output)
              : `Error: ${(rest as any).error instanceof Error ? (rest as any).error.message : "Tool execution failed"}`;
            const status = success ? "done" as const : "error" as const;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: m.toolCalls?.map((tc) =>
                        tc.id === toolCall.toolCallId
                          ? { ...tc, status, result: resultStr }
                          : tc
                      ),
                    }
                  : m
              )
            );
          },

          onStepFinish({ text }) {
            // After each step, update the displayed content with the full text so far
            if (text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: text } : m
                )
              );
            }
          },
        });

        // Wait for the stream to complete
        const finalText = await result.text;

        // Mark streaming as done with the final text
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: finalText, streaming: false }
              : m
          )
        );

        // After the chat loop completes, create a checkpoint tied to this user message
        if (checkpointManagerRef.current) {
          const label = `After: ${userContent.slice(0, 50)}${userContent.length > 50 ? "..." : ""}`;
          try {
            await checkpointManagerRef.current.createCheckpoint(label, userMsg.id);
          } catch (e) {
            console.error("Failed to create checkpoint after chat:", e);
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          setMessages((prev) => {
            // Try to update the last assistant message if it exists and is streaming
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
              return prev.map((m) =>
                m.id === lastMsg.id
                  ? { ...m, content: m.content || `Error: ${errMsg}`, streaming: false }
                  : m
              );
            }
            return [
              ...prev,
              { id: generateId(), role: "assistant", content: `Error: ${errMsg}`, streaming: false, timestamp: new Date() },
            ];
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, mode, toolExecutor]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    const pid = projectIdRef.current;
    if (pid) {
      db.chatMessages.where("sessionId").equals(`chat-${pid}`).delete().catch(console.error);
    }
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    // Only delete if the message exists in current (project-scoped) messages
    const exists = messagesRef.current.some((m) => m.id === messageId);
    if (!exists) return;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    const pid = projectIdRef.current;
    if (pid) {
      // Delete from DB, scoped by session
      db.chatMessages.get(messageId).then((msg) => {
        if (msg && msg.sessionId === `chat-${pid}`) {
          db.chatMessages.delete(messageId).catch(console.error);
        }
      }).catch(console.error);
    }
  }, []);

  /**
   * Revert conversation to the state before a given user message was sent.
   * 1. Find the checkpoint created BEFORE that user message.
   * 2. Restore the file state from that checkpoint.
   * 3. Delete all messages after that point from both UI and DB.
   */
  const revertToMessage = useCallback(
    async (messageId: string) => {
      const mgr = checkpointManagerRef.current;
      if (!mgr) return;

      const currentMessages = messagesRef.current;
      const msgIndex = currentMessages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      // Find the checkpoint created before this user message
      const checkpointId = await mgr.findCheckpointBeforeMessage(messageId);

      if (checkpointId) {
        try {
          await mgr.restoreToCheckpoint(checkpointId);
        } catch (e) {
          console.error("Failed to restore checkpoint:", e);
          return;
        }
      }

      // Get the message content before removing
      const targetMsg = currentMessages[msgIndex];

      // Get IDs of messages to remove (everything from this point onward)
      const removedIds = currentMessages.slice(msgIndex).map((m) => m.id);

      // Remove from UI
      setMessages((prev) => prev.slice(0, msgIndex));

      // Remove from DB (scoped by project session)
      const pid = projectIdRef.current;
      if (pid && removedIds.length > 0) {
        db.chatMessages
          .where("sessionId")
          .equals(`chat-${pid}`)
          .and((m) => removedIds.includes(m.id))
          .delete()
          .catch(console.error);
      }

      // Return the user message content so the caller can prefill the input
      return targetMsg.content;
    },
    []
  );

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
  };
}
