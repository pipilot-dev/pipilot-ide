/**
 * Inline AI completion provider for Monaco editor.
 * Powered by the a0 LLM API (no key required).
 *
 * Architecture (based on Spencer Porter's "Building Copilot On The Web" pattern):
 *
 *   The naive approach — calling the LLM inside provideInlineCompletions
 *   and awaiting the response — does not work. Monaco aggressively cancels
 *   in-flight providers when the cursor moves, and by the time a 500ms+
 *   API response arrives, the position is stale.
 *
 *   The correct pattern: decouple fetching from serving.
 *
 *   1. A background interval (every 500ms while typing) fetches a fresh
 *      completion from the LLM and adds it to a small FIFO cache.
 *   2. provideInlineCompletions returns SYNCHRONOUSLY from that cache,
 *      filtering for entries that are still relevant to the current cursor.
 *   3. After each successful fetch, we trigger Monaco to re-query so the
 *      newly-cached suggestion shows up immediately.
 */

import type * as Monaco from "monaco-editor";
import type { IDisposable, editor as MonacoEditor, Position, IRange } from "monaco-editor";

const A0_LLM_URL = "https://api.a0.dev/ai/llm";
const DEBUG = typeof window !== "undefined" && localStorage.getItem("pipilot:debug-inline-ai") === "1";
const CACHE_SIZE = 10;
const FETCH_INTERVAL = 500;
const STOP_AFTER_IDLE = 1500;

function dlog(...args: any[]) {
  if (DEBUG) console.log("[inline-ai]", ...args);
}

interface CachedSuggestion {
  insertText: string;
  range: IRange;
}

// ─── Module state (single global instance) ───────────────────────
let registered = false;
let activeEditor: MonacoEditor.IStandaloneCodeEditor | null = null;
const cache: CachedSuggestion[] = [];
let fetchIntervalId: number | undefined;
let stopIdleTimeoutId: number | undefined;
let inFlightAbort: AbortController | null = null;
let activeProjectInfo: { language: string } = { language: "code" };

// ─── Helpers ─────────────────────────────────────────────────────
function clipBefore(text: string, maxLines = 80, maxChars = 4000): string {
  const lines = text.split("\n");
  const recent = lines.slice(-maxLines).join("\n");
  return recent.length > maxChars ? recent.slice(-maxChars) : recent;
}

function clipAfter(text: string, maxLines = 30, maxChars = 1500): string {
  const lines = text.split("\n");
  const next = lines.slice(0, maxLines).join("\n");
  return next.length > maxChars ? next.slice(0, maxChars) : next;
}

function buildSystemPrompt(language: string): string {
  return `## Task: Code Completion

### Language: ${language}

### Instructions:
- You are a world-class coding assistant.
- Given the current text and the cursor position, provide ONLY the code that should be inserted at the cursor.
- The suggestion must be based on the current text, especially the text before the cursor.
- This is not a conversation — do not ask questions or prompt for additional information.

### Strict Rules:
- NEVER include any markdown in the response — no code fences, no language tags.
- Never include annotations like "# Suggestion:" or "// completion:".
- Newlines should be used after { [ ( and before } ] ), with proper indentation matching the current line.
- Never suggest a newline after a space or newline.
- The suggestion must START with characters that fit naturally where the cursor is.
- Only ever return the code snippet itself.
- Do NOT return code that is already present in the current text.
- Do not return anything that is not valid code.
- If you have no suggestion, return an empty string.`;
}

class CompletionFormatter {
  private completion = "";
  private original = "";
  private normalised = "";
  private model: MonacoEditor.ITextModel;
  private position: Position;
  private monaco: typeof Monaco;
  private lineText: string;
  private textAfter: string;
  private charBefore: string;
  private charAfter: string;

  constructor(monaco: typeof Monaco, model: MonacoEditor.ITextModel, position: Position) {
    this.monaco = monaco;
    this.model = model;
    this.position = position;
    this.lineText = model.getLineContent(position.lineNumber);
    const fullRange = model.getFullModelRange();
    const tail = new monaco.Range(
      position.lineNumber,
      position.column,
      fullRange.endLineNumber,
      fullRange.endColumn,
    );
    this.textAfter = model.getValueInRange(tail);
    this.charBefore = this.lineText[position.column - 2] ?? "";
    this.charAfter = this.lineText[position.column - 1] ?? "";
  }

  private stripMarkdown(): this {
    this.completion = this.completion.replace(/```[a-zA-Z0-9]*\r?\n?/g, "");
    this.completion = this.completion.replace(/\r?\n?```/g, "");
    this.completion = this.completion.replace(/^# ?Suggestions?: ?/gim, "");
    this.completion = this.completion.replace(/^\/\/ ?Suggestions?: ?/gim, "");
    return this;
  }

  private removeOverlapWithBefore(): this {
    // If the completion starts with text already present immediately before
    // the cursor, strip the overlap.
    const beforeRange = new this.monaco.Range(1, 1, this.position.lineNumber, this.position.column);
    const before = this.model.getValueInRange(beforeRange);
    const compTrimmed = this.completion;
    const max = Math.min(compTrimmed.length, before.length);
    let overlap = 0;
    for (let len = 1; len <= max; len++) {
      if (before.endsWith(compTrimmed.slice(0, len))) overlap = len;
    }
    if (overlap > 0) this.completion = this.completion.slice(overlap);
    return this;
  }

  private removeOverlapWithAfter(): this {
    if (!this.textAfter) return this;
    const max = Math.min(this.completion.length, 50);
    for (let len = max; len > 0; len--) {
      if (this.completion.endsWith(this.textAfter.slice(0, len))) {
        this.completion = this.completion.slice(0, this.completion.length - len);
        return this;
      }
    }
    return this;
  }

  private trimTrailingWhitespace(): this {
    this.completion = this.completion.replace(/\s+$/, "");
    return this;
  }

  private balanceBrackets(): this {
    // If completion has unbalanced closing brackets, trim them
    const opens = ["(", "[", "{"];
    const closes = [")", "]", "}"];
    let result = "";
    const stack: string[] = [];
    for (const ch of this.completion) {
      if (opens.includes(ch)) {
        stack.push(ch);
        result += ch;
      } else if (closes.includes(ch)) {
        const openIdx = closes.indexOf(ch);
        if (stack.length && stack[stack.length - 1] === opens[openIdx]) {
          stack.pop();
          result += ch;
        } else {
          // Unbalanced — stop here
          break;
        }
      } else {
        result += ch;
      }
    }
    this.completion = result;
    return this;
  }

  private buildRange(): IRange {
    const newlines = (this.completion.match(/\n/g) || []).length;
    const lines = this.completion.split("\n");
    const lastLineLen = lines[lines.length - 1].length;
    return {
      startLineNumber: this.position.lineNumber,
      startColumn: this.position.column,
      endLineNumber: this.position.lineNumber + newlines,
      endColumn: newlines === 0 ? this.position.column + lastLineLen : lastLineLen + 1,
    };
  }

  format(rawCompletion: string): { insertText: string; range: IRange } | null {
    this.original = rawCompletion;
    this.normalised = rawCompletion.trim();
    this.completion = rawCompletion;

    this.stripMarkdown()
      .removeOverlapWithBefore()
      .removeOverlapWithAfter()
      .balanceBrackets()
      .trimTrailingWhitespace();

    if (!this.completion || !this.completion.trim()) return null;

    return {
      insertText: this.completion,
      range: this.buildRange(),
    };
  }
}

// ─── LLM fetch ───────────────────────────────────────────────────
async function fetchSuggestion(): Promise<void> {
  const editor = activeEditor;
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const position = editor.getPosition();
  if (!position) return;

  const offset = model.getOffsetAt(position);
  const fullText = model.getValue();
  const before = clipBefore(fullText.slice(0, offset));
  const after = clipAfter(fullText.slice(offset));

  if (before.trim().length < 2) {
    dlog("skip — too little context");
    return;
  }

  // Cancel any in-flight request before starting a new one
  if (inFlightAbort) {
    try { inFlightAbort.abort(); } catch {}
  }
  inFlightAbort = new AbortController();
  const signal = inFlightAbort.signal;

  const language = model.getLanguageId() || "code";
  activeProjectInfo.language = language;

  try {
    dlog("fetching", { language, beforeLen: before.length });
    const res = await fetch(A0_LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: buildSystemPrompt(language) },
          { role: "user", content: `${before}<|cursor|>${after}` },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      dlog("fetch error", res.status);
      return;
    }

    const data = await res.json();
    let raw = (data.completion || "").toString();
    if (!raw.trim()) {
      dlog("empty response");
      return;
    }

    // Remove the <|cursor|> marker if model echoed it
    raw = raw.replace(/<\|cursor\|>/g, "");

    // Re-check current position — if user typed since we started, recompute
    const currentPos = editor.getPosition();
    if (!currentPos) return;

    // Add to cache with the position the request was made for
    const newSuggestion: CachedSuggestion = {
      insertText: raw,
      range: {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber + (raw.match(/\n/g) || []).length,
        endColumn: position.column + raw.length,
      },
    };
    cache.push(newSuggestion);
    if (cache.length > CACHE_SIZE) cache.shift();

    dlog("cached", { count: cache.length, preview: raw.slice(0, 60) });

    // Tell Monaco to re-query so the new cached suggestion shows up
    try {
      editor.trigger("pipilot-ai", "editor.action.inlineSuggest.trigger", {});
    } catch (err) {
      dlog("trigger error", err);
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      dlog("aborted");
      return;
    }
    dlog("fetch threw", err);
  }
}

function startFetching() {
  if (fetchIntervalId === undefined) {
    dlog("starting fetch interval");
    fetchSuggestion(); // immediate
    fetchIntervalId = window.setInterval(fetchSuggestion, FETCH_INTERVAL);
  }
  // Reset the idle stop timer
  if (stopIdleTimeoutId !== undefined) clearTimeout(stopIdleTimeoutId);
  stopIdleTimeoutId = window.setTimeout(() => {
    if (fetchIntervalId !== undefined) {
      dlog("idle — stopping fetch interval");
      clearInterval(fetchIntervalId);
      fetchIntervalId = undefined;
    }
  }, STOP_AFTER_IDLE);
}

function stopFetching() {
  if (fetchIntervalId !== undefined) {
    clearInterval(fetchIntervalId);
    fetchIntervalId = undefined;
  }
  if (stopIdleTimeoutId !== undefined) {
    clearTimeout(stopIdleTimeoutId);
    stopIdleTimeoutId = undefined;
  }
  if (inFlightAbort) {
    try { inFlightAbort.abort(); } catch {}
    inFlightAbort = null;
  }
}

// ─── Provider registration ──────────────────────────────────────
const REGISTERED_LANGS = [
  "typescript", "javascript", "typescriptreact", "javascriptreact",
  "html", "css", "scss", "less", "json", "jsonc",
  "markdown", "python", "go", "rust", "java", "cpp", "c", "csharp",
  "php", "ruby", "shell", "yaml", "toml", "sql", "xml", "vue", "svelte",
  "plaintext",
];

function registerProvider(monaco: typeof Monaco) {
  if (registered) return;
  registered = true;

  const provider: Monaco.languages.InlineCompletionsProvider = {
    groupId: "pipilot.ai",
    displayName: "PiPilot AI",

    provideInlineCompletions: (model, position, _context, _token) => {
      // SYNCHRONOUS — no awaits, just filter the cache
      dlog("provideInlineCompletions", {
        line: position.lineNumber,
        col: position.column,
        cacheSize: cache.length,
      });

      // Filter cache for entries relevant to current position
      const relevant = cache.filter((s) => {
        // Same line, and the suggestion was made within ~3 columns of cursor
        if (s.range.startLineNumber !== position.lineNumber) return false;
        if (Math.abs(s.range.startColumn - position.column) > 3) return false;
        return true;
      });

      // Don't suggest if char before cursor is something weird (only after letters/nums/whitespace)
      const charBeforeIdx = position.column - 2;
      if (charBeforeIdx >= 0) {
        const lineText = model.getLineContent(position.lineNumber);
        const charBefore = lineText[charBeforeIdx] ?? "";
        if (charBefore && !/[a-zA-Z0-9_\s.({[]/.test(charBefore)) {
          dlog("skip — bad char before cursor", charBefore);
          return { items: [] };
        }
      }

      // Format each cached suggestion
      const items = relevant
        .map((s) => {
          const formatted = new CompletionFormatter(monaco, model, position).format(s.insertText);
          return formatted;
        })
        .filter((s): s is { insertText: string; range: IRange } => s !== null && s.insertText.length > 0);

      dlog("returning", items.length, "items");
      return { items };
    },

    disposeInlineCompletions: () => {
      // No-op
    },
  };

  for (const lang of REGISTERED_LANGS) {
    try {
      monaco.languages.registerInlineCompletionsProvider(lang, provider);
    } catch (err) {
      dlog("register failed", lang, err);
    }
  }

  dlog(`registered for ${REGISTERED_LANGS.length} languages`);
}

/**
 * Public entry point — call from editor mount.
 * Registers the provider once globally and attaches change listeners
 * to the given editor so the background fetcher knows when to run.
 */
export function setupInlineAI(
  monaco: typeof import("monaco-editor"),
  editor: MonacoEditor.IStandaloneCodeEditor,
): IDisposable {
  registerProvider(monaco);

  // Mark this as the active editor
  activeEditor = editor;
  dlog("attached to editor");

  const disposables: IDisposable[] = [];

  // Trigger background fetching whenever the user types
  disposables.push(
    editor.onDidChangeModelContent(() => {
      // Clear cache on content change so stale suggestions don't surface
      // (but we keep recent ones — only clear if a long time has passed
      //  or if cursor moved far). Simpler: invalidate by position in the
      //  filter step, which we already do.
      startFetching();
    }),
  );

  // Switch active editor when this one gains focus
  disposables.push(
    editor.onDidFocusEditorWidget(() => {
      activeEditor = editor;
      dlog("editor focused");
    }),
  );

  // Clean up when editor is disposed
  disposables.push(
    editor.onDidDispose(() => {
      if (activeEditor === editor) {
        activeEditor = null;
        stopFetching();
      }
      for (const d of disposables) {
        try { d.dispose(); } catch {}
      }
    }),
  );

  return {
    dispose() {
      for (const d of disposables) {
        try { d.dispose(); } catch {}
      }
      if (activeEditor === editor) {
        activeEditor = null;
        stopFetching();
      }
    },
  };
}
