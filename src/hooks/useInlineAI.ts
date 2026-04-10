/**
 * Inline AI completion provider for Monaco editor.
 * Powered by the a0 LLM API (no key required).
 *
 * Behavior:
 * - Triggers on cursor movement / typing after a debounce
 * - Sends file context (code before cursor + a bit after) to a0 LLM
 * - Returns ghost-text completion that user accepts with Tab
 * - Cancels in-flight requests when user keeps typing
 */

import type { editor, languages, IDisposable } from "monaco-editor";

const A0_LLM_URL = "https://api.a0.dev/ai/llm";

// Cache: cursor-context hash → completion (avoids duplicate API calls)
const completionCache = new Map<string, string>();
const CACHE_MAX = 100;

function hashContext(language: string, before: string, after: string): string {
  // Use last 200 chars of before + first 50 of after for cache key
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
  return `You are an expert ${language || "code"} autocomplete engine. The user shows you code with a CURSOR marker. Output ONLY the code that should be inserted at the CURSOR — nothing else.

Strict rules:
- Output ONLY raw code, no markdown, no fences, no language tag, no commentary
- Do NOT repeat code that already exists before or after the cursor
- Continue naturally from the cursor position — match indentation and style
- Keep completions short and useful (1-30 lines, prefer shorter)
- If the surrounding code suggests the next obvious line, complete just that line
- If a function body or block is being written, you may complete it
- Never output explanations, just the code to insert`;
}

function buildUserPrompt(before: string, after: string): string {
  return `${before}<CURSOR>${after}`;
}

function cleanCompletion(raw: string, before: string, after: string): string {
  let text = raw;

  // Strip code fences if model added them
  text = text.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/\n?```\s*$/, "");

  // Strip leading/trailing whitespace but preserve internal
  text = text.replace(/^\n+/, "").replace(/\s+$/, "");

  // Remove the entire "before" if model echoed it
  if (text.startsWith(before)) {
    text = text.slice(before.length);
  }

  // If completion already starts with the next character that exists in `after`,
  // it's likely duplicating. Trim the overlap.
  if (after && text.endsWith(after.slice(0, 20))) {
    text = text.slice(0, text.length - Math.min(after.length, 20));
  }

  return text;
}

let abortController: AbortController | null = null;

async function fetchCompletion(language: string, before: string, after: string, signal: AbortSignal): Promise<string> {
  const cacheKey = hashContext(language, before, after);
  const cached = completionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildUserPrompt(before, after);

  const res = await fetch(A0_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal,
  });

  if (!res.ok) throw new Error(`a0 ${res.status}`);
  const data = await res.json();
  const completion = cleanCompletion(data.completion || "", before, after);

  // Cache result (LRU-ish — drop oldest when full)
  if (completionCache.size >= CACHE_MAX) {
    const firstKey = completionCache.keys().next().value;
    if (firstKey) completionCache.delete(firstKey);
  }
  completionCache.set(cacheKey, completion);

  return completion;
}

/**
 * Register the inline completion provider with Monaco.
 * Call this once after editor mount. Returns a disposable.
 */
export function registerInlineAI(monaco: typeof import("monaco-editor")): IDisposable {
  // Common languages we'll provide completions for
  const languages = [
    "typescript", "javascript", "typescriptreact", "javascriptreact",
    "html", "css", "json", "markdown", "python", "go", "rust", "java",
  ];

  const disposables: IDisposable[] = [];

  for (const lang of languages) {
    const d = monaco.languages.registerInlineCompletionsProvider(lang, {
      async provideInlineCompletions(model, position, _context, token) {
        // Cancel any in-flight request
        if (abortController) {
          try { abortController.abort(); } catch {}
        }
        abortController = new AbortController();

        const offset = model.getOffsetAt(position);
        const fullText = model.getValue();
        const before = clipBeforeCursor(fullText.slice(0, offset));
        const after = clipAfterCursor(fullText.slice(offset));

        // Skip if there's nothing meaningful before cursor
        if (before.trim().length < 2) {
          return { items: [] };
        }

        // Check if cancellation is requested before making the call
        if (token.isCancellationRequested) {
          return { items: [] };
        }

        try {
          // Listen for cancellation from monaco
          const cancelHandler = () => {
            try { abortController?.abort(); } catch {}
          };
          token.onCancellationRequested(cancelHandler);

          const completion = await fetchCompletion(lang, before, after, abortController.signal);

          if (token.isCancellationRequested || !completion) {
            return { items: [] };
          }

          return {
            items: [
              {
                insertText: completion,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              },
            ],
          };
        } catch (err: any) {
          if (err?.name === "AbortError") {
            return { items: [] };
          }
          // Silently fail — don't disrupt typing
          return { items: [] };
        }
      },
      freeInlineCompletions() {
        // No-op: nothing to clean up per-completion
      },
    });
    disposables.push(d);
  }

  return {
    dispose() {
      for (const d of disposables) {
        try { d.dispose(); } catch {}
      }
      if (abortController) {
        try { abortController.abort(); } catch {}
      }
    },
  };
}
