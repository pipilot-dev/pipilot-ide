/**
 * Inline AI completion provider for Monaco editor.
 * Powered by the a0 LLM API (no key required).
 */

import type * as Monaco from "monaco-editor";
import type { IDisposable } from "monaco-editor";

const A0_LLM_URL = "https://api.a0.dev/ai/llm";
const DEBUG = typeof window !== "undefined" && localStorage.getItem("pipilot:debug-inline-ai") === "1";

function dlog(...args: any[]) {
  if (DEBUG) console.log("[inline-ai]", ...args);
}

// LRU-ish cache: cursor-context hash → completion
const completionCache = new Map<string, string>();
const CACHE_MAX = 100;

function hashContext(language: string, before: string, after: string): string {
  return `${language}::${before.slice(-200)}::${after.slice(0, 50)}`;
}

function clipBeforeCursor(text: string, maxLines = 80, maxChars = 4000): string {
  const lines = text.split("\n");
  const recent = lines.slice(-maxLines).join("\n");
  return recent.length > maxChars ? recent.slice(-maxChars) : recent;
}

function clipAfterCursor(text: string, maxLines = 30, maxChars = 1500): string {
  const lines = text.split("\n");
  const next = lines.slice(0, maxLines).join("\n");
  return next.length > maxChars ? next.slice(0, maxChars) : next;
}

function buildSystemPrompt(language: string): string {
  return `You are an expert ${language || "code"} autocomplete engine. The user shows you code with a <CURSOR> marker. Output ONLY the raw text that should be inserted at <CURSOR> — nothing more, nothing less.

Strict rules:
- Output ONLY the insertion text, NEVER repeat any text from before or after the cursor
- No markdown, no code fences, no language tag, no commentary, no explanations
- Continue naturally from the cursor — match indentation and style
- Keep completions short and useful (1-15 lines, prefer shorter)
- If completing the current line, output only the rest of that line
- Whitespace before the insertion (spaces/tabs) is part of the output if the cursor is at a fresh column`;
}

function cleanCompletion(raw: string, before: string, after: string): string {
  let text = raw;

  // Strip markdown code fences if model added them
  text = text.replace(/^```[a-zA-Z0-9]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "");

  // Trim trailing whitespace only (preserve leading whitespace which may be intentional)
  text = text.replace(/\s+$/, "");

  // If model echoed the entire `before` (common failure mode), strip it
  if (text.length > before.length && text.startsWith(before)) {
    text = text.slice(before.length);
  } else {
    // Try a smaller overlap from the end of `before`
    const tailCheck = before.slice(-50);
    if (tailCheck && text.startsWith(tailCheck)) {
      text = text.slice(tailCheck.length);
    }
  }

  // If completion ends with text that already exists in `after`, strip the overlap
  if (after) {
    const afterHead = after.slice(0, 30);
    if (afterHead && text.endsWith(afterHead)) {
      text = text.slice(0, text.length - afterHead.length);
    }
  }

  return text;
}

async function fetchCompletion(
  language: string,
  before: string,
  after: string,
  signal: AbortSignal,
): Promise<string> {
  const cacheKey = hashContext(language, before, after);
  const cached = completionCache.get(cacheKey);
  if (cached !== undefined) {
    dlog("cache hit", cached.slice(0, 60));
    return cached;
  }

  const res = await fetch(A0_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: buildSystemPrompt(language) },
        { role: "user", content: `${before}<CURSOR>${after}` },
      ],
    }),
    signal,
  });

  if (!res.ok) throw new Error(`a0 ${res.status}`);
  const data = await res.json();
  const completion = cleanCompletion(data.completion || "", before, after);

  // Update cache
  if (completionCache.size >= CACHE_MAX) {
    const firstKey = completionCache.keys().next().value;
    if (firstKey) completionCache.delete(firstKey);
  }
  completionCache.set(cacheKey, completion);

  dlog("fetched", completion.slice(0, 60));
  return completion;
}

// Module-level guard so we only register once globally even if multiple
// editor instances mount (each tab switch creates a new Monaco editor).
let globalRegistration: IDisposable | null = null;

/**
 * Register the inline completion provider with Monaco.
 * Idempotent — safe to call from every editor mount; only the first call
 * actually registers, subsequent calls are no-ops.
 */
export function registerInlineAI(monaco: typeof import("monaco-editor")): IDisposable {
  if (globalRegistration) {
    dlog("already registered, skipping");
    return globalRegistration;
  }
  const langs = [
    "typescript", "javascript", "typescriptreact", "javascriptreact",
    "html", "css", "scss", "less", "json", "jsonc",
    "markdown", "python", "go", "rust", "java", "cpp", "c", "csharp",
    "php", "ruby", "shell", "yaml", "toml", "sql", "xml", "vue", "svelte",
    "plaintext",
  ];

  const disposables: IDisposable[] = [];

  const provider: Monaco.languages.InlineCompletionsProvider = {
    // Identifying metadata so we don't conflict with built-in providers
    groupId: "pipilot.ai",
    displayName: "PiPilot AI",
    debounceDelayMs: 350,

    provideInlineCompletions: async (model, position, context, token) => {
      dlog("provideInlineCompletions called", {
        lang: model.getLanguageId(),
        line: position.lineNumber,
        col: position.column,
        triggerKind: context.triggerKind,
      });

      // Per-call abort controller (no global state, no race conditions)
      const ctrl = new AbortController();

      // Hook up Monaco's cancellation token to our AbortController
      const cancelSub = token.onCancellationRequested(() => {
        try { ctrl.abort(); } catch {}
      });

      try {
        const offset = model.getOffsetAt(position);
        const fullText = model.getValue();
        const before = clipBeforeCursor(fullText.slice(0, offset));
        const after = clipAfterCursor(fullText.slice(offset));

        // Skip if there's nothing meaningful before cursor
        if (before.trim().length < 2) {
          dlog("skip — too little context");
          return { items: [] };
        }

        if (token.isCancellationRequested) {
          return { items: [] };
        }

        const langId = model.getLanguageId() || "code";
        const completion = await fetchCompletion(langId, before, after, ctrl.signal);

        if (token.isCancellationRequested || !completion || !completion.trim()) {
          dlog("empty or cancelled");
          return { items: [] };
        }

        dlog("returning completion", completion.slice(0, 80));

        return {
          items: [
            {
              insertText: completion,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            },
          ],
        };
      } catch (err: any) {
        if (err?.name === "AbortError") {
          dlog("aborted");
          return { items: [] };
        }
        dlog("error", err);
        return { items: [] };
      } finally {
        try { cancelSub.dispose(); } catch {}
      }
    },

    // REQUIRED in monaco-editor 0.55+
    disposeInlineCompletions: () => {
      // No-op: nothing to clean up per-completion
    },
  };

  for (const lang of langs) {
    try {
      const d = monaco.languages.registerInlineCompletionsProvider(lang, provider);
      disposables.push(d);
    } catch (err) {
      dlog(`failed to register for ${lang}`, err);
    }
  }

  dlog(`registered for ${disposables.length} languages`);

  globalRegistration = {
    dispose() {
      for (const d of disposables) {
        try { d.dispose(); } catch {}
      }
      globalRegistration = null;
    },
  };
  return globalRegistration;
}
