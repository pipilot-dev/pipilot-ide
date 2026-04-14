/**
 * Codestral bridge — abstracts Codestral AI completion operations between:
 *   - Web mode: HTTP fetch + SSE parsing to Express endpoints
 *   - Tauri mode: HTTP fetch + SSE parsing (Codestral is an external API,
 *     so both modes use HTTP — but Tauri mode still goes through invoke
 *     to let the Rust backend handle API keys securely)
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface CodestralBridge {
  fim(opts: { prefix: string; suffix: string; language?: string }): Promise<string>;
  chat(opts: { messages: any[] }): Promise<string>;
}

// ── SSE helper: parse an SSE response stream into concatenated text ──

async function parseSSE(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let result = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          // FIM responses
          const fimText = parsed?.choices?.[0]?.delta?.content
            ?? parsed?.choices?.[0]?.text;
          // Chat responses
          const chatText = parsed?.choices?.[0]?.delta?.content
            ?? parsed?.choices?.[0]?.message?.content;
          result += fimText || chatText || "";
        } catch {
          // skip malformed JSON chunks
        }
      }
    }
  }

  return result;
}

// ── Tauri IPC bridge ──
// Codestral is an external API — in Tauri mode we still use invoke so the
// Rust backend can manage API keys securely and proxy the request.

function createTauriBridge(): CodestralBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async fim(opts) {
      await init();
      return invoke("codestralFim", {
        prefix: opts.prefix,
        suffix: opts.suffix,
        language: opts.language ?? null,
      });
    },

    async chat(opts) {
      await init();
      return invoke("codestralChat", { messages: opts.messages });
    },
  };
}

// ── HTTP + SSE bridge (existing web mode) ──

function createWebBridge(): CodestralBridge {
  return {
    async fim(opts) {
      const res = await fetch("/api/codestral/fim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: opts.prefix,
          suffix: opts.suffix,
          language: opts.language,
        }),
      });
      if (!res.ok) throw new Error("Codestral FIM request failed");
      return parseSSE(res);
    },

    async chat(opts) {
      const res = await fetch("/api/codestral/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: opts.messages }),
      });
      if (!res.ok) throw new Error("Codestral chat request failed");
      return parseSSE(res);
    },
  };
}

// ── Export the appropriate bridge ──

export const codestralBridge: CodestralBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
