# PiPilot IDE — Tool Execution Architecture

> How the AI calls tools, the client executes them, and results flow back.
> A reference for anyone building a vibe-coding platform with an OpenAI-compatible API.

---

## Overview

```
User types "Build a landing page"
  → Client sends messages + tool definitions to OpenAI-compatible API
  → API (Kilo) generates text + native tool_calls (e.g. create_file)
  → Server streams tool_calls as SSE deltas to client
  → Client executes tool on IndexedDB (file created in browser)
  → Client sends tool result back to API in next request
  → API sees the result, continues generating (more tools or final text)
  → Loop repeats until API says "stop"
```

---

## 1. The Request

The client sends a standard OpenAI chat completion request with `tools` and `stream: true`:

```json
POST /api/chat/completions
{
  "messages": [
    { "role": "system", "content": "You are PiPilot, an AI coding assistant..." },
    { "role": "user", "content": "Build a landing page" }
  ],
  "stream": true,
  "max_tokens": 16384,
  "temperature": 0.7,
  "direct_kilo": true,
  "max_steps": 100,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "create_file",
        "description": "Create a new file with content.",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "content": { "type": "string" }
          },
          "required": ["path"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "edit_file",
        "description": "Edit a file via search/replace or full rewrite.",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "search": { "type": "string" },
            "replace": { "type": "string" },
            "newContent": { "type": "string" }
          },
          "required": ["path"]
        }
      }
    }
    // ... read_file, delete_file, list_files, search_files, deploy_site
  ]
}
```

**Key**: The `tools` array uses the standard OpenAI function calling format. Any OpenAI-compatible API (Kilo, OpenRouter, Anthropic via proxy, etc.) understands this.

---

## 2. Server-Side (Direct Kilo Mode)

The server receives the request and calls the LLM API directly:

```
Client → Server → Kilo (OpenAI-compatible API)
```

### Server Loop (simplified):

```typescript
for (let step = 0; step < maxSteps; step++) {
  // Call the LLM with streaming
  const response = await fetch(LLM_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: "kilo-auto/free",
      messages: kiloMessages,   // full conversation history
      tools: allTools,           // built-in + client tools
      stream: true,
    }),
  });

  // Read the SSE stream, collect text + tool_calls
  let textContent = "";
  let toolCalls = [];

  for await (const chunk of parseSSE(response.body)) {
    const delta = chunk.choices[0].delta;

    // Text → pipe directly to client SSE stream
    if (delta.content) {
      textContent += delta.content;
      res.write(sseChunk({ content: delta.content }));
    }

    // Tool call deltas → collect
    if (delta.tool_calls) {
      // Accumulate tool call ID, name, arguments
      collectToolCallDeltas(delta.tool_calls, toolCalls);
    }
  }

  const finishReason = chunk.choices[0].finish_reason;

  if (finishReason === "tool_calls") {
    // Separate built-in tools (web_search, image_gen) from client tools (create_file)
    const builtinCalls = toolCalls.filter(tc => isBuiltinTool(tc));
    const clientCalls = toolCalls.filter(tc => isClientTool(tc));

    // Execute built-in tools server-side
    for (const tc of builtinCalls) {
      const result = await executeServerTool(tc);
      kiloMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }

    // Stream client tool calls to the browser for client-side execution
    if (clientCalls.length > 0) {
      // Stream each tool call as OpenAI-format deltas
      for (const tc of clientCalls) {
        res.write(sseChunk({ tool_calls: [{ id: tc.id, function: { name, arguments } }] }));
      }
      // End with finish_reason: "tool_calls"
      res.write(sseChunk({}, "tool_calls"));
      res.write("data: [DONE]\n\n");
      return; // Client will execute and send results back
    }

    // Only built-in tools → continue loop with results
    continue;
  }

  // Normal stop → done
  res.write(sseChunk({}, "stop"));
  res.write("data: [DONE]\n\n");
  return;
}
```

### Key Concepts:

1. **Built-in tools** (web_search, image_generation) execute **server-side** — the client never sees them
2. **Client tools** (create_file, edit_file) are **streamed to the client** as `tool_calls` deltas
3. When client tools are needed, the stream ends with `finish_reason: "tool_calls"` — the client must execute them and send results back

---

## 3. Client-Side SSE Consumer

The client reads the SSE stream and handles three types of data:

```typescript
async function consumeStream(response) {
  const reader = response.body.getReader();
  let fullText = "";
  let nativeToolCalls = [];
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Parse SSE lines: "data: {...}\n\n"
    for (const line of parseSSELines(value)) {
      if (line === "data: [DONE]") break;

      const chunk = JSON.parse(line.slice(6));
      const delta = chunk.choices[0].delta;
      const reason = chunk.choices[0].finish_reason;

      if (reason) finishReason = reason;

      // 1. Text content → display in chat bubble
      if (delta.content) {
        fullText += delta.content;
        updateChatUI(delta.content);
      }

      // 2. Tool call deltas → accumulate
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          accumulateToolCall(nativeToolCalls, tc);
        }
      }
    }
  }

  return { fullText, nativeToolCalls, finishReason };
}
```

---

## 4. Client-Side Tool Execution Loop

After consuming the stream, the client checks for tool calls and executes them:

```typescript
async function runChatLoop(apiMessages) {
  const MAX_ROUNDS = 100;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 1. Send request to server
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ messages: apiMessages, tools: FILE_TOOLS, stream: true }),
    });

    // 2. Consume the SSE stream
    const result = await consumeStream(response);

    // 3. Check for tool calls
    const toolCalls = result.nativeToolCalls;

    if (toolCalls.length === 0) {
      // No tools → AI is done, break the loop
      break;
    }

    // 4. Add the assistant message with tool_calls to conversation
    apiMessages.push({
      role: "assistant",
      content: result.cleanText || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    });

    // 5. Execute each tool call locally
    for (const tc of toolCalls) {
      let toolResult;
      try {
        toolResult = await executeTool(tc.name, tc.args);
        // e.g. create_file writes to IndexedDB → file appears in editor
      } catch (err) {
        toolResult = `Error: ${err.message}`;
      }

      // 6. Add tool result to conversation (OpenAI format)
      apiMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResult,
      });
    }

    // 7. Loop back → send updated messages to API
    //    The API sees the tool results and can call more tools or respond with text
  }
}
```

---

## 5. Tool Executor (IndexedDB Operations)

Each tool maps to an IndexedDB operation:

```typescript
async function executeTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "create_file":
      // Write file to IndexedDB → UI auto-updates via Dexie live query
      await db.files.put({
        id: args.path,
        name: extractFileName(args.path),
        type: "file",
        content: args.content,
        projectId: activeProjectId,  // CRITICAL: scope to current project
        // ...
      });
      return `✓ File created: ${args.path}`;

    case "edit_file":
      const file = await db.files.get(args.path);
      // Verify projectId matches (prevent cross-project edits)
      if (file.projectId !== activeProjectId) throw new Error("Wrong project");
      // Apply search/replace or full content replacement
      const updated = args.search
        ? file.content.replace(args.search, args.replace)
        : args.newContent;
      await db.files.update(args.path, { content: updated });
      return `✓ File edited: ${args.path}`;

    case "read_file":
      const f = await db.files.get(args.path);
      return f.content;  // AI sees the file content

    case "deploy_site":
      const result = await deploySite(activeProjectId, projectName);
      return `✓ Deployed at: ${result.url}`;

    // ... delete_file, list_files, search_files
  }
}
```

### Why IndexedDB?
- Files persist across page reloads
- `useLiveQuery` from Dexie auto-updates the React UI when DB changes
- No server needed for file operations — everything runs in the browser
- Each project is isolated by `projectId`

---

## 6. Message Format (OpenAI Tool Calling Protocol)

The entire flow uses the standard OpenAI tool calling format:

### Assistant calls a tool:
```json
{
  "role": "assistant",
  "content": "I'll create the landing page now.",
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "create_file",
        "arguments": "{\"path\": \"index.html\", \"content\": \"<html>...</html>\"}"
      }
    }
  ]
}
```

### Client sends tool result:
```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "✓ File created: index.html (45 lines, 1234 chars)"
}
```

### Then the AI continues:
```json
{
  "role": "assistant",
  "content": "Now I'll create the styles."
  // ... more tool_calls
}
```

---

## 7. The Complete Flow Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Browser    │     │   Server     │     │  LLM (Kilo) │
│  (React UI) │     │  (Proxy)     │     │             │
└──────┬──────┘     └──────┬───────┘     └──────┬──────┘
       │                    │                     │
  1.   │─── POST messages ──→                     │
       │    + tools array   │─── POST to LLM ────→│
       │                    │                     │
       │                    │←── SSE stream ──────│
  2.   │←── SSE text chunks │    (text + tool     │
       │    (display in UI) │     call deltas)    │
       │                    │                     │
       │←── SSE tool_calls ─│                     │
       │    finish_reason:  │                     │
       │    "tool_calls"    │                     │
       │                    │                     │
  3.   │── Execute locally  │                     │
       │   (IndexedDB ops)  │                     │
       │   File appears in  │                     │
       │   editor instantly │                     │
       │                    │                     │
  4.   │─── POST messages ──→                     │
       │    + tool results  │─── POST to LLM ────→│
       │    (role: "tool")  │    (sees results)   │
       │                    │                     │
       │                    │←── SSE stream ──────│
  5.   │←── More text/tools │    (continues)      │
       │                    │                     │
       │    ... repeat until finish_reason: "stop" │
       │                    │                     │
  6.   │←── finish_reason:  │                     │
       │    "stop"          │                     │
       │                    │                     │
       │   Chat complete.   │                     │
       │   Files are in     │                     │
       │   the editor.      │                     │
```

---

## 8. How to Build Your Own

### Minimum requirements:

1. **An OpenAI-compatible API** that supports:
   - `tools` parameter with function definitions
   - `stream: true` with SSE
   - `finish_reason: "tool_calls"` in streamed responses
   - `role: "tool"` messages with `tool_call_id`

2. **A browser-based file system** (IndexedDB, OPFS, or in-memory):
   - Store files with path as key
   - React to changes (Dexie live queries, or state updates)

3. **An SSE stream consumer** that handles both text and tool_call deltas

4. **A tool execution loop** that:
   - Parses tool calls from the stream
   - Executes them locally
   - Sends results back as `role: "tool"` messages
   - Loops until `finish_reason: "stop"`

### Compatible APIs:
- OpenAI (GPT-4, GPT-4o)
- Anthropic Claude (via OpenAI-compatible proxy)
- Google Gemini (via OpenAI-compatible proxy)
- Kilo Gateway (used by PiPilot)
- OpenRouter
- Any API following the OpenAI chat completions spec

### Key gotchas:
- **Tool call arguments come as a string**, not parsed JSON — you must `JSON.parse(tc.function.arguments)`
- **Tool call deltas are incremental** — arguments stream in fragments, you must concatenate them
- **`finish_reason: "tool_calls"`** means the stream is paused, not done — you must execute and continue
- **Always include `tool_call_id`** in the tool result message — the API uses it to match results to calls
- **Scope tools by project/user** — prevent cross-project file operations with guards on every DB operation
