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
// Mutable runtime config — overridable via configureInlineAI()
const config = {
  enabled: true,                  // master switch
  keystrokeDebounce: 80,          // ms of no typing before fetch fires
  stopAfterIdle: 800,             // ms of inactivity before pending requests cancel
  smallFileLineLimit: 200,        // tier threshold (lines)
  smallFileCharLimit: 8000,       // tier threshold (chars)
  smallFileMaxTokens: 400,        // generation cap for small files
  largeFileMaxTokens: 100,        // generation cap for large files
  contextLinesBefore: 30,         // clipped window — lines before cursor
  contextLinesAfter: 10,          // clipped window — lines after cursor
  contextCharsBefore: 1500,       // clipped window — chars before cursor
  contextCharsAfter: 600,         // clipped window — chars after cursor
};

/**
 * Update runtime configuration. Call from any React component that has
 * access to the user's settings (e.g. EditorArea on every render).
 */
export function configureInlineAI(overrides: Partial<typeof config>) {
  Object.assign(config, overrides);
}

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
// Set of input hashes currently in-flight or recently fetched.
// We do NOT abort in-flight requests — they're allowed to complete and
// populate the cache. We just dedupe to avoid spamming the same input.
const inFlightHashes = new Set<string>();
const recentlyFetched = new Map<string, number>(); // hash → timestamp
const RECENT_TTL_MS = 4000;
let activeProjectInfo: { language: string } = { language: "code" };

// ─── Helpers ─────────────────────────────────────────────────────
function clipBefore(text: string): string {
  const lines = text.split("\n");
  const recent = lines.slice(-config.contextLinesBefore).join("\n");
  return recent.length > config.contextCharsBefore ? recent.slice(-config.contextCharsBefore) : recent;
}

function clipAfter(text: string): string {
  const lines = text.split("\n");
  const next = lines.slice(0, config.contextLinesAfter).join("\n");
  return next.length > config.contextCharsAfter ? next.slice(0, config.contextCharsAfter) : next;
}

function buildSystemPrompt(language: string, isFullFile: boolean): string {
  // ASCII-only to avoid UTF-8 issues with HTTP middleboxes.
  if (isFullFile) {
    // Full-file context: model knows the whole file, can implement full
    // functions / methods / blocks. Allow longer completions.
    return `You are a ${language} code completion engine. The user shows you a full source file with a <|cursor|> marker. Output ONLY the raw code to insert at the cursor — nothing more. Use the surrounding code (imports, other functions, types) to write a contextually correct completion. If the cursor is inside an empty function body, implement the whole body. If it's mid-line, complete just that line. No markdown, no code fences, no commentary, no echoing existing text. Empty response if unsure.`;
  }
  // Clipped context: keep completions short for speed.
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
    // the cursor, strip the overlap. But only if there's meaningful content
    // left after the strip, otherwise keep the original.
    const beforeRange = new this.monaco.Range(1, 1, this.position.lineNumber, this.position.column);
    const before = this.model.getValueInRange(beforeRange);
    const max = Math.min(this.completion.length, before.length);
    let overlap = 0;
    for (let len = 1; len <= max; len++) {
      if (before.endsWith(this.completion.slice(0, len))) overlap = len;
    }
    if (overlap > 0) {
      const stripped = this.completion.slice(overlap);
      // Only apply if there's still substantial content left
      if (stripped.trim().length >= 2) {
        this.completion = stripped;
      }
      // Otherwise leave the completion as-is — Monaco will handle the
      // mismatch between range and current text by simply not showing it
      // OR by using its own diff. Worst case: nothing shows. Best case:
      // we keep a useful longer suggestion that extends beyond the overlap.
    }
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
    // For inline ghost text we want a ZERO-WIDTH range at the cursor.
    // Monaco interprets non-zero-width ranges as REPLACEMENT, so a span
    // that goes past the cursor would tell Monaco to overwrite real text.
    // The insertText itself can contain \n and Monaco renders it as
    // multi-line ghost text from the insertion point.
    return {
      startLineNumber: this.position.lineNumber,
      startColumn: this.position.column,
      endLineNumber: this.position.lineNumber,
      endColumn: this.position.column,
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

// Hash function for deduping fetch inputs
function hashInput(language: string, before: string, after: string): string {
  // Use the last 80 chars of before + first 30 of after for a reasonable
  // dedup window — small typing changes still hit the same hash.
  return `${language}::${before.slice(-80)}::${after.slice(0, 30)}`;
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
  const totalLines = model.getLineCount();

  // Decide: full file or clipped window?
  const useFullFile =
    totalLines <= config.smallFileLineLimit &&
    fullText.length <= config.smallFileCharLimit;

  let before: string;
  let after: string;
  if (useFullFile) {
    before = fullText.slice(0, offset);
    after = fullText.slice(offset);
  } else {
    before = clipBefore(fullText.slice(0, offset));
    after = clipAfter(fullText.slice(offset));
  }

  if (before.trim().length < 2) {
    dlog("skip - too little context");
    return;
  }

  const language = model.getLanguageId() || "code";
  activeProjectInfo.language = language;

  // Dedupe: skip if this exact input is already in-flight or was fetched recently
  const hash = hashInput(language, before, after);
  if (inFlightHashes.has(hash)) {
    dlog("skip - in-flight");
    return;
  }
  const recent = recentlyFetched.get(hash);
  if (recent && Date.now() - recent < RECENT_TTL_MS) {
    dlog("skip - recently fetched");
    return;
  }

  // Capture the position the request was issued for, so the cached
  // suggestion is anchored there even if the cursor moves later.
  const issuedAt = { line: position.lineNumber, col: position.column };
  inFlightHashes.add(hash);

  try {
    dlog("fetching", {
      language,
      mode: useFullFile ? "full-file" : "clipped",
      lines: totalLines,
      chars: fullText.length,
    });
    const res = await fetch(LLM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer unused",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt(language, useFullFile) },
          { role: "user", content: `${before}<|cursor|>${after}` },
        ],
        temperature: 0,
        max_tokens: useFullFile ? config.smallFileMaxTokens : config.largeFileMaxTokens,
        stream: false,
        direct_kilo: true,
      }),
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

    // Add to cache, anchored at the position the request was issued for
    const newSuggestion: CachedSuggestion = {
      insertText: raw,
      range: {
        startLineNumber: issuedAt.line,
        startColumn: issuedAt.col,
        endLineNumber: issuedAt.line + (raw.match(/\n/g) || []).length,
        endColumn: issuedAt.col + raw.length,
      },
    };
    cache.push(newSuggestion);
    if (cache.length > CACHE_SIZE) cache.shift();

    dlog("cached", { count: cache.length, preview: raw.slice(0, 60) });

    // Tell Monaco to re-query so the new cached suggestion shows up.
    // Use both methods for compatibility — different Monaco versions
    // accept different invocation styles.
    try {
      const action = editor.getAction("editor.action.inlineSuggest.trigger");
      if (action) {
        action.run();
        dlog("triggered via action");
      } else {
        editor.trigger("pipilot-ai", "editor.action.inlineSuggest.trigger", {});
        dlog("triggered via editor.trigger");
      }
    } catch (err) {
      dlog("trigger error", err);
    }
  } catch (err: any) {
    dlog("fetch threw", err?.message || err);
  } finally {
    inFlightHashes.delete(hash);
    recentlyFetched.set(hash, Date.now());
    // GC stale entries
    if (recentlyFetched.size > 50) {
      const cutoff = Date.now() - RECENT_TTL_MS;
      for (const [k, t] of recentlyFetched.entries()) {
        if (t < cutoff) recentlyFetched.delete(k);
      }
    }
  }
}

function scheduleFetch() {
  // Bail entirely if disabled via settings
  if (!config.enabled) return;
  // Debounced — kicks off a fetch after `keystrokeDebounce` ms of no
  // typing. The dedup-by-hash inside fetchSuggestion ensures we never
  // re-fetch the same input, and in-flight requests are NEVER aborted —
  // they're allowed to complete and populate the cache.
  if (debouncedFetchTimer !== undefined) clearTimeout(debouncedFetchTimer);
  debouncedFetchTimer = window.setTimeout(() => {
    debouncedFetchTimer = undefined;
    fetchSuggestion();
  }, config.keystrokeDebounce);
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

      // Filter cache for entries relevant to current position. Allow up
      // to 12 columns of drift on the same line (the user may have typed
      // a few chars while waiting for the response). Prefer the MOST
      // RECENT cached entries by reversing.
      const relevant = [...cache]
        .reverse()
        .filter((s) => {
          if (s.range.startLineNumber !== position.lineNumber) return false;
          if (Math.abs(s.range.startColumn - position.column) > 12) return false;
          return true;
        })
        .slice(0, 3); // Top 3 most-recent matches

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
