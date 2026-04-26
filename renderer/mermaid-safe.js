// PiPilot IDE — Defensive mermaid renderer
//
// Mermaid 10's render() injects a fallback "💣 Syntax error in text" SVG
// directly into <body> when parsing fails — it bypasses our .catch()
// because the error is rendered as a SIDE EFFECT, not just thrown. This
// utility wraps mermaid with three layers of defense:
//
//   1. Initialise mermaid with `suppressErrorRendering: true` so the
//      error bomb never paints into the document.
//   2. Run `mermaid.parse(src)` first — throws cleanly on invalid syntax.
//      We never call render() on bad input.
//   3. Wrap render() in try/catch + a render scratch container that's
//      removed before any errored output can be appended to <body>.
//
// On failure, returns a small note element the caller can drop into the
// document showing "⚠ Diagram has invalid syntax" + the original source
// as a fenced code block so the user can fix it.

(function () {
  'use strict';
  if (window.__pipilotMermaidSafeLoaded) return;
  window.__pipilotMermaidSafeLoaded = true;

  let initialised = false;
  function ensureMermaidConfig() {
    if (initialised || !window.mermaid) return;
    initialised = true;
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        suppressErrorRendering: true,    // mermaid 10.4+
        logLevel: 'fatal',               // silence non-fatal warnings
        // Per-renderer defaults that are safe for our IDE chrome:
        flowchart: { useMaxWidth: true, htmlLabels: true },
        sequence:  { useMaxWidth: true },
      });
    } catch (err) {
      console.warn('[mermaid-safe] initialize failed:', err);
    }
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // Build a small inline note for the user when mermaid can't render.
  // Includes the error message + the original source in a styled box so
  // the offending diagram can be fixed without round-tripping the file.
  // ctx (optional): { filePath, label } — when filePath is present,
  // the "Ask AI to fix" button sends a prompt that targets that file
  // directly so the agent can edit it. Without filePath, the prompt
  // ships the broken source as a code block and asks the agent to
  // produce a corrected version inline.
  function buildErrorNote(src, errMsg, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'pp-mermaid-error';
    const cleanErr = String(errMsg || 'Mermaid could not parse this diagram.').split('\n').slice(0, 4).join(' ');
    wrap.innerHTML = `
      <div class="pp-mermaid-error-head">
        <span class="pp-mermaid-error-icon">⚠</span>
        <span class="pp-mermaid-error-title">Diagram has invalid syntax</span>
        <button class="pp-mermaid-error-fix" type="button" title="Send the broken diagram to the AI chat for repair">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/><path d="M11 4l-2 6 6-2-2 6 6-2-2 6"/></svg>
          <span>Fix with AI</span>
        </button>
      </div>
      <div class="pp-mermaid-error-msg">${escHtml(cleanErr)}</div>
      <details class="pp-mermaid-error-src">
        <summary>Show diagram source</summary>
        <pre><code>${escHtml(src)}</code></pre>
      </details>
    `;
    const fixBtn = wrap.querySelector('.pp-mermaid-error-fix');
    if (fixBtn) {
      fixBtn.addEventListener('click', () => sendFixPromptToChat(src, cleanErr, ctx || {}));
    }
    return wrap;
  }

  // Build a chat prompt and shoot it at the AI chat input. We use the
  // existing pipilot:focus-chat-input pattern other parts of the IDE
  // use so the chat panel reveals + the input prefills + auto-submits.
  function sendFixPromptToChat(src, errMsg, ctx) {
    try {
      const lines = ['Fix this broken Mermaid diagram so it parses cleanly.'];
      if (ctx.filePath) {
        lines.push('');
        lines.push(`The diagram lives in \`${ctx.filePath}\`. Open the file, find the \`\`\`mermaid block whose source matches the snippet below, replace it with a working version, and save.`);
      } else if (ctx.label) {
        lines.push(`Context: ${ctx.label}`);
      }
      lines.push('');
      lines.push(`Parser error: ${errMsg}`);
      lines.push('');
      lines.push('Broken source:');
      lines.push('```mermaid');
      lines.push(String(src || '').trim());
      lines.push('```');
      lines.push('');
      lines.push('Return the corrected diagram. Keep the same intent — same nodes, edges, layout direction — just make the syntax valid. Use simple shapes, avoid edge labels with special chars, prefer subgraph blocks over nested groups when in doubt.');
      lines.push('');
      lines.push('Before fixing, look up the current Mermaid syntax for this diagram type — call `mcp__context7__resolve-library-id` with `mermaid` and then `mcp__context7__query-docs` for the relevant section, OR use the `mcp__deepwiki__*` tools to fetch the latest mermaid-js/mermaid docs. The parser changes between releases (v9 → v10 → v11), so confirm the syntax is valid in the current version before returning.');
      const prompt = lines.join('\n');
      // Reveal the chat panel just in case it's collapsed.
      try {
        const root = document.getElementById('ide-root');
        if (root) root.classList.remove('chat-collapsed');
      } catch {}
      // Slight delay so any panel-open animation finishes first.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
          detail: { prefill: prompt, submit: true },
        }));
      }, 120);
    } catch (err) {
      console.warn('[mermaid-safe] fix-prompt dispatch failed', err);
    }
  }

  // Inject styles once.
  if (!document.getElementById('pp-mermaid-safe-styles')) {
    const s = document.createElement('style');
    s.id = 'pp-mermaid-safe-styles';
    s.textContent = `
.pp-mermaid-error {
  margin: 8px 0;
  padding: 10px 12px;
  background: rgba(229,83,75,0.07);
  border: 1px solid rgba(229,83,75,0.28);
  border-radius: 6px;
  font-family: var(--font-sans, system-ui);
  font-size: 12.5px;
  color: var(--text, #b0b0b8);
}
.pp-mermaid-error-head {
  display: flex; align-items: center; gap: 8px;
  font-weight: 500;
  color: var(--error, #e5534b);
}
.pp-mermaid-error-icon { font-size: 14px; line-height: 1; }
.pp-mermaid-error-title { letter-spacing: 0.01em; flex: 1; }
.pp-mermaid-error-fix {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(255,107,53,0.12);
  border: 1px solid rgba(255,107,53,0.35);
  color: var(--accent-light, #ffb38a);
  padding: 3px 9px;
  border-radius: 5px;
  font-size: 11px;
  font-family: var(--font-sans, system-ui);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  flex-shrink: 0;
}
.pp-mermaid-error-fix:hover {
  background: rgba(255,107,53,0.22);
  border-color: rgba(255,107,53,0.55);
  transform: translateY(-1px);
}
.pp-mermaid-error-fix:active { transform: translateY(0); }
.pp-mermaid-error-fix svg { color: var(--accent, #ff6b35); }
.pp-mermaid-error-msg {
  margin-top: 4px;
  color: var(--text-mid, #8a8a94);
  font-size: 12px;
}
.pp-mermaid-error-src {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-dim, #6b6b76);
}
.pp-mermaid-error-src summary {
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}
.pp-mermaid-error-src summary:hover { color: var(--text); }
.pp-mermaid-error-src pre {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 4px;
  overflow-x: auto;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 11px;
  color: var(--text-strong, #d9d9de);
  white-space: pre;
  max-height: 200px;
}
`;
    document.head.appendChild(s);
  }

  // Renders one mermaid diagram safely. Returns either:
  //   { ok: true, html, svgEl }  — rendered SVG markup ready to inject
  //   { ok: false, errorNode }   — a styled error note ready to inject
  // ctx (optional): { filePath, label } — passed to error-note builder
  // so the "Fix with AI" button can target the source file directly.
  async function renderSafe(src, idHint, ctx) {
    ensureMermaidConfig();
    if (!window.mermaid) return { ok: false, errorNode: buildErrorNote(src, 'Mermaid library not loaded', ctx) };
    const text = String(src || '').trim();
    if (!text) return { ok: false, errorNode: buildErrorNote('', 'Empty diagram', ctx) };

    // Layer 2 — pre-validate. mermaid.parse throws on invalid syntax with
    // a clean message; never reaches render() so no bomb SVG can leak.
    try {
      const r = window.mermaid.parse(text, { suppressErrors: false });
      if (r && typeof r.then === 'function') await r;
    } catch (err) {
      return { ok: false, errorNode: buildErrorNote(text, err?.str || err?.message || 'Invalid mermaid syntax', ctx) };
    }

    // Layer 3 — render in try/catch with an isolated scratch ID. If
    // anything goes wrong despite parse() succeeding, surface as note.
    const id = (idHint || 'mmd') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    try {
      const out = await window.mermaid.render(id, text);
      if (!out || !out.svg) throw new Error('Mermaid produced no SVG output');
      return { ok: true, html: out.svg };
    } catch (err) {
      try { document.querySelectorAll('[id^="d' + id + '"]').forEach(el => el.remove()); } catch {}
      return { ok: false, errorNode: buildErrorNote(text, err?.message || 'Mermaid render failed', ctx) };
    }
  }

  // Convenience: render `src` and replace `targetEl`'s content with either
  // the SVG or the error note. Returns the final inserted node so callers
  // can wire export-menus etc. ctx is forwarded to renderSafe so error
  // notes know which file the diagram came from.
  async function renderInto(targetEl, src, idHint, ctx) {
    if (!targetEl) return null;
    const r = await renderSafe(src, idHint, ctx);
    if (r.ok) {
      targetEl.innerHTML = r.html;
      const svgEl = targetEl.querySelector('svg');
      return svgEl;
    }
    targetEl.innerHTML = '';
    targetEl.appendChild(r.errorNode);
    return r.errorNode;
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.mermaidSafe = { renderSafe, renderInto, buildErrorNote, ensureMermaidConfig };
})();
