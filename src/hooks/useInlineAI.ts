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

// Same OpenAI-compatible endpoint that useChat uses
const LLM_URL = "https://the3rdacademy.com/api/chat/completions";
const LLM_MODEL = "kilo-auto/free";
const DEBUG = typeof window !== "undefined" && localStorage.getItem("pipilot:debug-inline-ai") === "1";
const CACHE_SIZE = 10;
// Aggressive Cursor-like timings
const KEYSTROKE_DEBOUNCE = 80;   // Trigger after 80ms of no typing (was 500ms interval)
const STOP_AFTER_IDLE = 800;     // Stop background work after 800ms idle (was 1500)
const MAX_OUTPUT_TOKENS = 100;   // Short snippets = faster generation
const CONTEXT_LINES_BEFORE = 30; // Smaller prompt = faster (was 80)
const CONTEXT_LINES_AFTER = 10;  // (was 30)
const CONTEXT_CHARS_BEFORE = 1500; // (was 4000)
const CONTEXT_CHARS_AFTER = 600;   // (was 1500)

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
let debouncedFetchTimer: number | undefined;
let stopIdleTimeoutId: number | undefined;
let inFlightAbort: AbortController | null = null;
let activeProjectInfo: { language: string } = { language: "code" };

// ─── Helpers ─────────────────────────────────────────────────────
function clipBefore(text: string, maxLines = CONTEXT_LINES_BEFORE, maxChars = CONTEXT_CHARS_BEFORE): string {
  const lines = text.split("\n");
  const recent = lines.slice(-maxLines).join("\n");
  return recent.length > maxChars ? recent.slice(-maxChars) : recent;
}

function clipAfter(text: string, maxLines = CONTEXT_LINES_AFTER, maxChars = CONTEXT_CHARS_AFTER): string {
  const lines = text.split("\n");
  const next = lines.slice(0, maxLines).join("\n");
  return next.length > maxChars ? next.slice(0, maxChars) : next;
}

function buildSystemPrompt(language: string): string {
  // Kept ultra-short for low latency. Every token in the system prompt
  // costs latency on every request. ASCII-only to avoid UTF-8 issues
  // with HTTP middleboxes.
  return `You are a ${language} code completion engine. Output ONLY the raw code to insert at <|cursor|>. No markdown, no fences, no commentary, no echoing existing text. Keep it short, usually 1-3 lines. Empty response if unsure.`;
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
    const res = await fetch(LLM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer unused",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt(language) },
          { role: "user", content: `${before}<|cursor|>${after}` },
        ],
        temperature: 0,         // deterministic — no random sampling cost
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
        direct_kilo: true,
      }),
      signal,
    });

    if (!res.ok) {
      dlog("fetch error", res.status);
      return;
    }

    const data = await res.json();
    // OpenAI-compatible response: { choices: [{ message: { content } }] }
    let raw = (data.choices?.[0]?.message?.content || "").toString();
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

function scheduleFetch() {
  // Debounced — kicks off a fetch KEYSTROKE_DEBOUNCE ms after the last keystroke.
  // This is what makes Cursor feel instant: no fixed-interval delay, the fetch
  // starts the moment the user stops typing.
  if (debouncedFetchTimer !== undefined) clearTimeout(debouncedFetchTimer);
  debouncedFetchTimer = window.setTimeout(() => {
    debouncedFetchTimer = undefined;
    fetchSuggestion();
  }, KEYSTROKE_DEBOUNCE);

  // Idle watchdog: cancel pending requests if user stops interacting entirely
  if (stopIdleTimeoutId !== undefined) clearTimeout(stopIdleTimeoutId);
  stopIdleTimeoutId = window.setTimeout(() => {
    if (inFlightAbort) {
      try { inFlightAbort.abort(); } catch {}
      inFlightAbort = null;
    }
  }, STOP_AFTER_IDLE);
}

function stopFetching() {
  if (debouncedFetchTimer !== undefined) {
    clearTimeout(debouncedFetchTimer);
    debouncedFetchTimer = undefined;
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

      // Filter cache for entries relevant to current position. With the
      // debounced fetcher, the user may have typed 1-2 more chars between
      // when the request was issued and the response arrived, so allow
      // up to 8 columns of drift on the same line.
      const relevant = cache.filter((s) => {
        if (s.range.startLineNumber !== position.lineNumber) return false;
        if (Math.abs(s.range.startColumn - position.column) > 8) return false;
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

  // Trigger debounced fetch whenever the user types
  disposables.push(
    editor.onDidChangeModelContent(() => {
      scheduleFetch();
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
