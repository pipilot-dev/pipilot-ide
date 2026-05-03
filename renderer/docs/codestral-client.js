// PiPilot IDE — Codestral-backed documentation service
//
// Two operations:
//   describeSymbol({ symbol, context, language, kind, signal })
//     → Promise<{ kind, signature, summary, params, returns, see, examples, raw }>
//     Used by the hover service.
//
//   generateDocBlock({ language, signature, body, signal })
//     → Promise<{ summary, params, returns }>
//     Used by the doc generator.
//
// Speed strategy:
//   1. In-memory LRU (instant repeat hits within session).
//   2. IndexedDB persistent cache (~10-30ms, survives reloads).
//   3. Single in-flight de-dupe — if two hovers fire on the same symbol
//      back-to-back, only one API call is made.
//   4. AbortSignal support — caller can cancel as the user moves away.
//
// Prompt strategy:
//   The model is told to output a SINGLE JSON object. A tolerant extractor
//   handles fenced output, leading prose, and trailing whitespace. If the
//   JSON is malformed we surface { summary: rawText } so the user still
//   sees something.

(function () {
  'use strict';

  const api = window.electronAPI;
  if (!api?.codestral?.chat) {
    console.warn('[docs/codestral] api.codestral.chat unavailable');
    return;
  }

  // ── Hash helpers ──────────────────────────────────────────────────
  // Fast non-crypto hash; collisions don't matter — at worst we miss a
  // cache entry. Uses FNV-1a over UTF-16 code units.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // ── In-memory LRU cache ───────────────────────────────────────────
  const MEM_LIMIT = 200;
  const memCache = new Map();
  function memGet(k) {
    if (!memCache.has(k)) return null;
    const v = memCache.get(k);
    memCache.delete(k); memCache.set(k, v); // refresh recency
    return v;
  }
  function memSet(k, v) {
    if (memCache.has(k)) memCache.delete(k);
    memCache.set(k, v);
    if (memCache.size > MEM_LIMIT) {
      const oldest = memCache.keys().next().value;
      memCache.delete(oldest);
    }
  }

  // ── IndexedDB persistent cache ────────────────────────────────────
  const DB_NAME = 'pipilot-doc-cache';
  const DB_VERSION = 1;
  const STORE = 'entries';
  const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) {
            d.createObjectStore(STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null); // degrade silently
      } catch { resolve(null); }
    });
    return dbPromise;
  }
  async function dbGet(key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => {
          const row = r.result;
          if (!row) return resolve(null);
          if (Date.now() - row.ts > TTL_MS) return resolve(null);
          resolve(row.value);
        };
        r.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  async function dbSet(key, value) {
    const db = await openDB();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, value, ts: Date.now() });
    } catch {}
  }

  // ── Single-flight registry for in-progress requests ──────────────
  const inflight = new Map();

  // ── JSON extractor — tolerant to fences, prose prefix, trailing junk ──
  function extractJson(raw) {
    if (!raw) return null;
    let s = String(raw).trim();
    // Strip ```json / ``` fences
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    // Find first balanced JSON object
    let depth = 0, start = -1, inString = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (c === '\\') { i++; continue; }
        if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; continue; }
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          const body = s.slice(start, i + 1);
          try { return JSON.parse(body); } catch {}
          // Repair attempt: strip trailing commas
          try { return JSON.parse(body.replace(/,(\s*[}\]])/g, '$1')); } catch {}
          return null;
        }
      }
    }
    return null;
  }

  // ── Prompts ──────────────────────────────────────────────────────
  function describePrompt({ symbol, context, language, kind, existingDoc }) {
    const sys = `You are a precise code documentation engine. You analyze a symbol from a ${language} source file and produce structured documentation that mirrors what an IDE language server hover would show. You ALWAYS respond with ONE valid JSON object and nothing else — no prose, no markdown fences.`;
    const existingBlock = existingDoc && existingDoc.trim() ? `\n## Existing comments (developer's intent — ground truth)
\`\`\`
${existingDoc.trim()}
\`\`\`
The developer already wrote the comment above. Treat it as authoritative — do NOT contradict it. Expand it into a full structured response, filling in details (types, params, examples) from the source code. If a detail conflicts, defer to the comment.\n` : '';
    const user = `## Symbol
\`${symbol}\`${kind ? `  (likely a ${kind})` : ''}
${existingBlock}
## Surrounding source (${language})
\`\`\`${language.toLowerCase()}
${context}
\`\`\`

## Task
Return a JSON object with this exact shape:

\`\`\`
{
  "kind": "function" | "method" | "class" | "interface" | "type" | "variable" | "constant" | "module" | "property" | "enum" | "macro" | "trait" | "struct" | "component" | "icon" | "hook" | "unknown",
  "signature": "single-line type signature as it would appear in code (or empty string if unknown)",
  "summary": "one short paragraph (≤ 3 sentences) explaining what the symbol does or represents — clear, plain English",
  "params": [{ "name": "...", "type": "...", "desc": "..." }],
  "returns": { "type": "...", "desc": "..." },
  "see": ["url-or-symbol-reference", ...],
  "examples": ["short code snippet without language fences", ...],
  "tags": [
    { "name": "component" },
    { "name": "name", "value": "ArrowRight" },
    { "name": "description", "value": "Lucide SVG icon component, renders SVG Element with children." },
    { "name": "preview", "value": "![icon](https://lucide.dev/icons/arrow-right.svg) https://lucide.dev/icons/arrow-right" },
    { "name": "deprecated", "value": "since 2.0 — use Foo instead" },
    { "name": "since", "value": "1.4.0" }
  ]
}
\`\`\`

Rules:
- If a field doesn't apply (e.g. \`returns\` for a class), set it to null or [].
- \`signature\` must be one line and use ${language} syntax.
- \`summary\` must be specific to THIS symbol, not generic.
- Never invent details that aren't supported by the source.
- If the symbol is from a well-known external library, you may include canonical \`@see\` links.
- **Tags**: extract ALL JSDoc/docstring tags present in the existing comments — \`@component\`, \`@name\`, \`@description\`, \`@preview\`, \`@deprecated\`, \`@since\`, \`@version\`, \`@author\`, \`@template\`, \`@throws\`, \`@async\`, etc. Put each as one entry in \`tags\`. Tags that DON'T have a value (like \`@component\`, \`@async\`) should omit the \`value\` field. \`@param\` and \`@returns\` are already covered by the dedicated arrays — DON'T duplicate them in \`tags\`.
- For \`@preview\` of icon libraries: the value should embed the icon as markdown image (\`![alt](url)\`) followed by a space and a link.
- For Lucide icon imports (\`lucide-react\`, \`lucide-react-native\`): infer kind="icon", include \`@component\`, \`@name\`, \`@description\`, \`@preview\` (https://lucide.dev/icons/<kebab-name>.svg), \`@see\` (https://lucide.dev/guide/packages/lucide-react), and a \`props\` param.
- Output MUST be the JSON object only.`;
    return [
      { role: 'system', content: sys },
      { role: 'user',   content: user },
    ];
  }

  function generateBlockPrompt({ language, signature, body, existingDoc }) {
    const sys = `You write precise function/class documentation for ${language} code. You ALWAYS respond with ONE valid JSON object — no prose, no markdown fences.`;
    const existingBlock = existingDoc && existingDoc.trim() ? `\n## Existing comments (developer's intent — preserve and enrich)
\`\`\`
${existingDoc.trim()}
\`\`\`
Use the existing comment as the ground-truth intent. Your output must NOT contradict it. Treat it as the seed for the summary; expand it into a full doc block by adding precise param/return descriptions inferred from the body.\n` : '';
    const user = `## Signature
\`\`\`${language.toLowerCase()}
${signature}
\`\`\`
${existingBlock}
## Body (best-effort context)
\`\`\`${language.toLowerCase()}
${body}
\`\`\`

Return JSON:
\`\`\`
{
  "summary": "one-sentence description of what this does",
  "params": [{ "name": "...", "type": "...", "desc": "one short sentence" }],
  "returns": { "type": "...", "desc": "what it returns and why" } | null,
  "throws": [{ "type": "...", "desc": "..." }],
  "examples": ["short snippet"]
}
\`\`\`

Rules:
- Param names must match the signature exactly.
- Types must match the source language's idioms.
- summary is one short sentence.
- Output MUST be the JSON object only.`;
    return [
      { role: 'system', content: sys },
      { role: 'user',   content: user },
    ];
  }

  // ── Public API ────────────────────────────────────────────────────
  async function describeSymbol({ symbol, context, language, kind, existingDoc, signal } = {}) {
    if (!symbol || !language) return null;
    const ctx = (context || '').slice(0, 6000); // cap context to keep tokens bounded
    const doc = (existingDoc || '').slice(0, 2000);
    const key = 'desc:' + fnv1a(language + '|' + symbol + '|' + fnv1a(ctx) + '|' + fnv1a(doc));

    // Memory hit
    const mem = memGet(key);
    if (mem) return mem;
    // IDB hit
    const persisted = await dbGet(key);
    if (persisted) { memSet(key, persisted); return persisted; }
    // De-dupe in-flight
    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
      try {
        const messages = describePrompt({ symbol, context: ctx, language, kind, existingDoc: doc });
        const resp = await api.codestral.chat({ messages, temperature: 0.2, maxTokens: 700 });
        if (resp && resp.ok === false) throw new Error(resp.error || 'codestral chat failed');
        const raw = resp?.text || resp?.content || resp?.choices?.[0]?.message?.content || '';
        const parsed = extractJson(raw) || { kind: kind || 'unknown', summary: String(raw).trim().slice(0, 1200) };
        const result = { ...parsed, raw };
        memSet(key, result);
        dbSet(key, result).catch(() => {});
        return result;
      } catch (err) {
        if (signal?.aborted) return null;
        return { kind: 'unknown', summary: '_(failed to fetch documentation: ' + (err?.message || err) + ')_', error: true };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  async function generateDocBlock({ language, signature, body, existingDoc, signal } = {}) {
    if (!language || !signature) return null;
    const cappedBody = (body || '').slice(0, 4000);
    const doc = (existingDoc || '').slice(0, 2000);
    const key = 'gen:' + fnv1a(language + '|' + signature + '|' + fnv1a(cappedBody) + '|' + fnv1a(doc));
    const mem = memGet(key); if (mem) return mem;
    const persisted = await dbGet(key);
    if (persisted) { memSet(key, persisted); return persisted; }
    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
      try {
        const messages = generateBlockPrompt({ language, signature, body: cappedBody, existingDoc: doc });
        const resp = await api.codestral.chat({ messages, temperature: 0.2, maxTokens: 600 });
        if (resp && resp.ok === false) throw new Error(resp.error || 'codestral chat failed');
        const raw = resp?.text || resp?.content || resp?.choices?.[0]?.message?.content || '';
        const parsed = extractJson(raw);
        if (!parsed) return { summary: String(raw).trim().slice(0, 400), params: [], returns: null };
        memSet(key, parsed);
        dbSet(key, parsed).catch(() => {});
        return parsed;
      } catch (err) {
        if (signal?.aborted) return null;
        return { summary: '_(generation failed: ' + (err?.message || err) + ')_', params: [], returns: null, error: true };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  function clearCache() {
    memCache.clear();
    openDB().then(db => {
      if (!db) return;
      try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch {}
    });
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.docs = window.PiPilot.docs || {};
  window.PiPilot.docs.client = { describeSymbol, generateDocBlock, clearCache };
})();
