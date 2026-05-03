// PiPilot IDE — VS Code-style hover documentation service
//
// Hover any identifier in the editor → after a short delay, a tooltip
// appears with rich documentation backed by Codestral. Looks and behaves
// like VS Code's hover:
//   • Code-block header with the kind + signature
//   • Markdown summary paragraph
//   • Param / returns / see / examples sections rendered cleanly
//   • Links are clickable, code spans monospaced and accent-colored
//   • Pinnable: hover over the popup itself to keep it open
//   • Cancellable: leaving the hover region or scrolling dismisses it
//
// The service:
//   1. Listens to mousemove on the Ace editor (debounced 350ms).
//   2. Resolves the word at the cursor + the leading comment block above
//      its declaration.
//   3. Asks the Codestral client for a structured describe result, using
//      the existing comment as ground truth when present.
//   4. Renders into a single floating <div> reused across hovers.
//
// Speed:
//   • In-memory + IndexedDB cache from the client → instant repeat hits.
//   • Skeleton UI shows immediately on the second cache miss; the API
//     call streams in afterward.
//   • Aborts on rapid re-hover so we don't pay for stale lookups.

(function () {
  'use strict';
  if (window.__pipilotDocsHoverLoaded) return;
  window.__pipilotDocsHoverLoaded = true;

  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  const HOVER_DELAY_MS = 350;
  const HIDE_DELAY_MS = 200;

  let popup = null;            // the floating tooltip element
  let pinned = false;          // mouse currently over popup → keep open
  let hoverTimer = null;
  let hideTimer = null;
  let lastWord = null;
  let lastEditor = null;
  let activeRequest = null;    // { abort: () => void } for cancellation

  // The diagnostic peek (ace-ai.js) takes priority over our docs hover —
  // it has the Quick Fix button and is shown immediately on hover, while
  // our popup is debounced 350ms. If the user is over an error squiggle
  // we never want to cover the Quick Fix UI with a docs popup.
  function isDiagPeekVisible() {
    const el = document.querySelector('.pp-hover-peek');
    if (!el) return false;
    // offsetParent === null means display:none or detached; either way, hidden.
    return el.offsetParent !== null;
  }

  // ── Tooltip element & styles ──────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('pp-doc-hover-styles')) return;
    const s = document.createElement('style');
    s.id = 'pp-doc-hover-styles';
    s.textContent = `
.pp-hover {
  position: fixed; z-index: 9999;
  max-width: 720px; min-width: 240px;
  max-height: 460px; overflow: auto;
  background: #1c1c21; color: #d9d9de;
  border: 1px solid #2e2e35;
  border-radius: 6px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4);
  font-family: var(--font-sans, "Plus Jakarta Sans", system-ui, sans-serif);
  font-size: 13px; line-height: 1.55;
  opacity: 0; transform: translateY(-2px);
  transition: opacity 0.12s ease, transform 0.12s ease;
  pointer-events: auto;
  user-select: text;
}
.pp-hover.show { opacity: 1; transform: translateY(0); }
.pp-hover-head {
  padding: 10px 14px;
  background: #16161a;
  border-bottom: 1px solid #2e2e35;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  line-height: 1.5;
  color: #d9d9de;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 6px 6px 0 0;
}
.pp-hover-kind {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 6px;
  border-radius: 3px;
  background: rgba(108,140,255,0.12);
  color: #6cb6ff;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.08em;
  vertical-align: middle;
}
.pp-hover-body { padding: 10px 14px; }
.pp-hover-body p { margin: 0 0 8px; }
.pp-hover-body p:last-child { margin-bottom: 0; }
.pp-hover-body code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); font-size: 11.5px; color: #FF8C61; }
.pp-hover-body pre { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); padding: 8px 10px; border-radius: 4px; overflow: auto; margin: 6px 0; }
.pp-hover-body pre code { background: none; color: #d9d9de; padding: 0; font-size: 11.5px; }
.pp-hover-body a { color: #6cb6ff; text-decoration: none; border-bottom: 1px dotted rgba(108,182,255,0.4); }
.pp-hover-body a:hover { color: #8ec6ff; border-bottom-color: #8ec6ff; }
.pp-hover-section { margin-top: 10px; padding-top: 10px; border-top: 1px solid #2e2e35; }
.pp-hover-section-title {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8a8a94;
  margin-bottom: 6px;
}
.pp-hover-param {
  display: grid;
  grid-template-columns: auto auto 1fr;
  column-gap: 8px;
  align-items: baseline;
  margin: 3px 0;
  font-size: 12.5px;
}
.pp-hover-param-name {
  font-family: var(--font-mono);
  color: #FF8C61;
  font-weight: 500;
}
.pp-hover-param-type {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #b392f0;
  background: rgba(179,146,240,0.08);
  padding: 0 5px;
  border-radius: 3px;
}
.pp-hover-param-desc { color: #b0b0b8; }
.pp-hover-skeleton {
  display: flex; flex-direction: column; gap: 7px;
  padding: 14px;
}
.pp-hover-skeleton-bar {
  height: 8px; border-radius: 3px;
  background: linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.10), rgba(255,255,255,0.05));
  background-size: 200% 100%;
  animation: pp-shimmer 1.2s infinite linear;
}
.pp-hover-skeleton-bar:nth-child(1) { width: 60%; }
.pp-hover-skeleton-bar:nth-child(2) { width: 92%; }
.pp-hover-skeleton-bar:nth-child(3) { width: 80%; }
.pp-hover-skeleton-bar:nth-child(4) { width: 50%; }
@keyframes pp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.pp-hover-error { color: #e5534b; font-size: 12px; }
.pp-hover::-webkit-scrollbar { width: 8px; }
.pp-hover::-webkit-scrollbar-thumb { background: #2e2e35; border-radius: 4px; }

/* Inline images (e.g. @preview icons in JSDoc) */
.pp-hover-img {
  max-width: 32px; max-height: 32px;
  vertical-align: middle;
  margin: 0 4px;
  border-radius: 3px;
  background: rgba(255,255,255,0.04);
  padding: 2px;
}

/* JSDoc-style tag rows — matches VS Code's @-tag layout */
.pp-hover-tags { padding: 6px 14px 10px; display: flex; flex-direction: column; gap: 4px; }
.pp-hover-tag-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12.5px;
  line-height: 1.55;
}
.pp-hover-tag-name {
  font-family: var(--font-mono, monospace);
  color: #6cb6ff;
  font-weight: 500;
  white-space: nowrap;
}
.pp-hover-tag-sep {
  color: #6b6b76;
  flex-shrink: 0;
}
.pp-hover-tag-value {
  flex: 1;
  min-width: 0;
  color: #b0b0b8;
  word-break: break-word;
}
.pp-hover-tag-value code { font-size: 11.5px; }
.pp-hover-tag-value a { color: #6cb6ff; }

/* Attribution footer — quiet branding, sits under all sections. */
.pp-hover-footer {
  margin-top: 6px;
  padding: 8px 14px 10px;
  border-top: 1px solid #2e2e35;
  text-align: right;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: #6b6b76;
}
.pp-hover-footer a {
  color: #8a8a94;
  text-decoration: none;
  border-bottom: none;
  transition: color 0.15s ease;
}
.pp-hover-footer a:hover { color: #FF8C61; }
`;
    document.head.appendChild(s);
  }

  function ensurePopup() {
    if (popup) return popup;
    ensureStyles();
    popup = document.createElement('div');
    popup.className = 'pp-hover';
    popup.style.display = 'none';
    popup.addEventListener('mouseenter', () => { pinned = true; clearTimeout(hideTimer); });
    popup.addEventListener('mouseleave', () => { pinned = false; scheduleHide(); });
    document.body.appendChild(popup);
    return popup;
  }

  function showPopup(html, x, y) {
    const el = ensurePopup();
    el.innerHTML = html;
    const wasShown = el.style.display === 'block';
    if (!wasShown) {
      // Hide while we measure to avoid a one-frame flash at the previous
      // (or default 0,0) position before we apply the new coordinates.
      el.style.visibility = 'hidden';
      el.style.display = 'block';
    }
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = x;
      let top = y + 22; // a touch below the cursor
      if (left + rect.width > vw - 8) left = Math.max(8, vw - rect.width - 8);
      if (top + rect.height > vh - 8) top = Math.max(8, y - rect.height - 12); // flip above
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.visibility = 'visible';
      el.classList.add('show');
    });
  }

  function hidePopup() {
    if (!popup) return;
    popup.classList.remove('show');
    setTimeout(() => { if (popup && !pinned) popup.style.display = 'none'; }, 120);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!pinned) hidePopup(); }, HIDE_DELAY_MS);
  }

  // ── Markdown → safe HTML (compact subset) ────────────────────────
  // We intentionally use a tiny renderer rather than pulling marked.js
  // here — the AI output is constrained to short paragraphs + inline
  // formatting + fenced code, so the surface area is small. Anything
  // beyond this (tables, images) renders as plain text, which is fine.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function mdInline(s) {
    let out = escapeHtml(s);
    // Inline code
    out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    // Bold / italic
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>');
    // Markdown image ![alt](url) — only http(s) or data: URLs to keep it safe
    out = out.replace(/!\[([^\]]*)\]\((https?:[^)\s]+|data:image\/[^)]+)\)/g, (_, alt, url) =>
      `<img src="${url}" alt="${escapeHtml(alt)}" class="pp-hover-img" />`);
    // Markdown link [text](url) — links must be http(s) or local-ref
    out = out.replace(/\[([^\]]+)\]\((https?:[^)]+|#[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bare URLs
    out = out.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return out;
  }
  function mdRender(text) {
    if (!text) return '';
    const lines = String(text).split(/\n/);
    let html = '';
    let inFence = false;
    let fenceLang = '';
    let fenceBuf = [];
    let para = [];
    const flushPara = () => {
      if (para.length) {
        html += '<p>' + para.map(mdInline).join('<br/>') + '</p>';
        para = [];
      }
    };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const fenceMatch = line.match(/^```(\w*)\s*$/);
      if (fenceMatch) {
        if (inFence) {
          html += '<pre><code>' + escapeHtml(fenceBuf.join('\n')) + '</code></pre>';
          inFence = false; fenceBuf = []; fenceLang = '';
        } else {
          flushPara();
          inFence = true; fenceLang = fenceMatch[1];
        }
        continue;
      }
      if (inFence) { fenceBuf.push(raw); continue; }
      if (!line.trim()) { flushPara(); continue; }
      para.push(line);
    }
    if (inFence) html += '<pre><code>' + escapeHtml(fenceBuf.join('\n')) + '</code></pre>';
    flushPara();
    return html;
  }

  // ── Result → HTML ────────────────────────────────────────────────
  function renderResult(symbol, result) {
    if (!result) return '<div class="pp-hover-skeleton"><div class="pp-hover-skeleton-bar"></div><div class="pp-hover-skeleton-bar"></div><div class="pp-hover-skeleton-bar"></div></div>';
    const kindLabel = result.kind && result.kind !== 'unknown' ? `<span class="pp-hover-kind">${escapeHtml(result.kind)}</span>` : '';
    const sigText = (result.signature || symbol || '').trim();
    const head = sigText
      ? `<div class="pp-hover-head">${kindLabel}${escapeHtml(sigText)}</div>`
      : '';
    let body = '';
    if (result.summary) body += '<div class="pp-hover-body">' + mdRender(result.summary) + '</div>';
    // Params section
    if (Array.isArray(result.params) && result.params.length) {
      body += '<div class="pp-hover-section"><div class="pp-hover-section-title">Parameters</div>';
      for (const p of result.params) {
        body += '<div class="pp-hover-param">' +
          `<span class="pp-hover-param-name">${escapeHtml(p.name || '')}</span>` +
          (p.type ? `<span class="pp-hover-param-type">${escapeHtml(p.type)}</span>` : '<span></span>') +
          `<span class="pp-hover-param-desc">${mdInline(p.desc || '')}</span>` +
          '</div>';
      }
      body += '</div>';
    }
    // Returns
    if (result.returns && (result.returns.type || result.returns.desc)) {
      body += '<div class="pp-hover-section"><div class="pp-hover-section-title">Returns</div>';
      body += '<div class="pp-hover-param">' +
        '<span></span>' +
        (result.returns.type ? `<span class="pp-hover-param-type">${escapeHtml(result.returns.type)}</span>` : '<span></span>') +
        `<span class="pp-hover-param-desc">${mdInline(result.returns.desc || '')}</span>` +
        '</div></div>';
    }
    // Generic JSDoc-style tags (VS Code-style row layout)
    if (Array.isArray(result.tags) && result.tags.length) {
      // Skip tags that duplicate the already-rendered sections.
      const SKIP = new Set(['param', 'parameter', 'arg', 'argument', 'return', 'returns', 'see', 'example']);
      const visible = result.tags.filter(t => t && t.name && !SKIP.has(String(t.name).toLowerCase()));
      if (visible.length) {
        body += '<div class="pp-hover-section pp-hover-tags">';
        for (const t of visible) {
          const hasValue = t.value !== undefined && t.value !== null && String(t.value).trim() !== '';
          body += '<div class="pp-hover-tag-row">';
          body += `<span class="pp-hover-tag-name">@${escapeHtml(t.name)}</span>`;
          if (hasValue) {
            body += '<span class="pp-hover-tag-sep">—</span>';
            body += `<span class="pp-hover-tag-value">${mdInline(String(t.value))}</span>`;
          }
          body += '</div>';
        }
        body += '</div>';
      }
    }
    // See / examples
    if (Array.isArray(result.see) && result.see.length) {
      body += '<div class="pp-hover-section"><div class="pp-hover-section-title">See also</div><div class="pp-hover-body" style="padding:0;">';
      for (const s of result.see) body += '<p>' + mdInline(String(s)) + '</p>';
      body += '</div></div>';
    }
    if (Array.isArray(result.examples) && result.examples.length) {
      body += '<div class="pp-hover-section"><div class="pp-hover-section-title">Example</div><div class="pp-hover-body" style="padding:0;">';
      for (const ex of result.examples) body += '<pre><code>' + escapeHtml(String(ex)) + '</code></pre>';
      body += '</div></div>';
    }
    const footer = '<div class="pp-hover-footer"><a href="https://pipilot.dev/products/ide/features/jsdocs" target="_blank" rel="noopener">JSDocs by PiPilot</a></div>';
    return head + (body || '<div class="pp-hover-body"><em>No documentation available.</em></div>') + footer;
  }

  function renderSkeleton() {
    return '<div class="pp-hover-skeleton">'
      + '<div class="pp-hover-skeleton-bar"></div>'
      + '<div class="pp-hover-skeleton-bar"></div>'
      + '<div class="pp-hover-skeleton-bar"></div>'
      + '<div class="pp-hover-skeleton-bar"></div>'
      + '</div>';
  }

  // ── Symbol + comment extraction ──────────────────────────────────
  function getWordAt(session, row, col) {
    const line = session.getLine(row);
    if (!line) return null;
    const re = /[A-Za-z_$#][A-Za-z0-9_$]*/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (col >= m.index && col <= m.index + m[0].length) return { word: m[0], start: m.index, end: m.index + m[0].length };
    }
    return null;
  }

  function extractContext(session, row, lookBehind = 60, lookAhead = 60) {
    const start = Math.max(0, row - lookBehind);
    const end = Math.min(session.getLength(), row + lookAhead);
    let out = '';
    for (let r = start; r < end; r++) out += session.getLine(r) + '\n';
    return out;
  }

  // Walk upward from `row`, skipping blank lines, and capture a leading
  // comment block. Recognises //, #, --, /* */, """ ... """, ''' ... '''.
  function extractLeadingComment(session, row) {
    let r = row - 1;
    // Skip blank lines
    while (r >= 0 && !session.getLine(r).trim()) r--;
    if (r < 0) return '';
    const lines = [];
    // Block comment ending? */ ... /*
    if (session.getLine(r).trim().endsWith('*/')) {
      while (r >= 0) {
        const l = session.getLine(r);
        lines.unshift(l);
        if (l.trim().startsWith('/*') || l.trim().startsWith('/**')) break;
        r--;
      }
      return lines.join('\n');
    }
    // Triple-string block? """ or '''
    const tripleMatch = session.getLine(r).match(/^\s*("""|''')\s*$/);
    if (tripleMatch) {
      const quote = tripleMatch[1];
      lines.unshift(session.getLine(r));
      r--;
      while (r >= 0) {
        const l = session.getLine(r);
        lines.unshift(l);
        if (l.trim().endsWith(quote) || l.trim().startsWith(quote)) break;
        r--;
      }
      return lines.join('\n');
    }
    // Line-comment styles: //, #, --, ///, ;;
    const LINE_RE = /^\s*(\/\/\/?|#'?|--|;;)/;
    while (r >= 0 && LINE_RE.test(session.getLine(r))) {
      lines.unshift(session.getLine(r));
      r--;
    }
    return lines.join('\n').trim();
  }

  // ── Core flow ────────────────────────────────────────────────────
  async function showHover(editor, screenX, screenY, row, col) {
    // Diagnostic peek wins — never compete for the same screen real estate.
    if (isDiagPeekVisible()) { hidePopup(); return; }
    const session = editor.getSession();
    const wordInfo = getWordAt(session, row, col);
    if (!wordInfo) { hidePopup(); return; }
    if (wordInfo.word.length < 2 || /^(true|false|null|undefined|if|else|for|while|do|return|var|let|const|function|class|new|typeof|instanceof|in|of|this)$/.test(wordInfo.word)) {
      hidePopup();
      return;
    }

    const docs = window.PiPilot?.docs;
    if (!docs?.client?.describeSymbol || !docs?.profiles?.getProfile) { hidePopup(); return; }

    const filePath = state.activeFile || '';
    const profile = docs.profiles.getProfile(filePath);
    if (!profile) { hidePopup(); return; }

    // Cache key uses the word's start column (not the cursor column) so
    // sub-pixel mouse jiggle within the same symbol keeps the same key,
    // and we early-return instead of re-rendering on every mousemove.
    const key = filePath + '|' + wordInfo.word + '|' + row + ':' + wordInfo.start;
    if (key === lastWord && popup && popup.style.display === 'block') return;
    lastWord = key;

    const useSiteContext = extractContext(session, row);
    const leading = extractLeadingComment(session, row);
    // Show skeleton immediately so the user feels the response.
    showPopup(renderSkeleton(), screenX, screenY);

    // Cancel any prior request.
    if (activeRequest && activeRequest.abort) activeRequest.abort();
    const controller = new AbortController();
    activeRequest = controller;

    // Resolve the symbol so the AI sees the actual declaration (local or
    // imported) instead of guessing from usage. Best-effort — if the
    // resolver returns null we fall back to use-site-only context.
    let resolved = null;
    if (docs.resolver?.resolveSymbol) {
      try {
        resolved = await docs.resolver.resolveSymbol({
          symbol: wordInfo.word,
          filePath,
          sessionText: session.getValue(),
        });
      } catch {}
      if (controller.signal.aborted || lastWord !== key) return;
    }

    let enrichedContext = `## Use site (${filePath}:${row + 1})\n${useSiteContext}`;
    if (resolved && resolved.definitionText) {
      enrichedContext += `\n\n## Definition (${resolved.kind} — ${resolved.sourceFile}:${resolved.sourceLine})\n${resolved.definitionText}`;
    }

    const result = await docs.client.describeSymbol({
      symbol: wordInfo.word,
      context: enrichedContext,
      language: profile.language,
      existingDoc: leading || '',
      signal: controller.signal,
    }).catch(() => null);

    if (controller.signal.aborted) return;
    if (lastWord !== key) return; // user moved on — ignore stale result
    if (isDiagPeekVisible()) { hidePopup(); return; } // diag peek won the race
    if (!result) { hidePopup(); return; }
    showPopup(renderResult(wordInfo.word, result), screenX, screenY);
  }

  // ── Wire to Ace ──────────────────────────────────────────────────
  function attach(editor) {
    if (!editor || lastEditor === editor) return;
    lastEditor = editor;
    const container = editor.container;
    if (!container) return;

    container.addEventListener('mousemove', (e) => {
      clearTimeout(hoverTimer);
      // Don't fire while user is selecting / dragging
      if (e.buttons) return;
      // Defer to the diagnostic peek when it's already visible — the
      // quick-fix UI must not get covered by our docs popup.
      if (isDiagPeekVisible()) {
        hidePopup();
        return;
      }
      hoverTimer = setTimeout(() => {
        if (isDiagPeekVisible()) { hidePopup(); return; }
        const pos = editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
        if (!pos) return;
        showHover(editor, e.clientX, e.clientY, pos.row, pos.column);
      }, HOVER_DELAY_MS);
    });

    container.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      scheduleHide();
    });

    // Dismiss on scroll, edit, or session swap
    editor.on('changeSession', () => { lastWord = null; hidePopup(); });
    editor.on('change', () => { hidePopup(); });
    editor.session && editor.session.on && editor.session.on('changeScrollTop', () => { hidePopup(); });

    // Escape to dismiss
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePopup();
    });
  }

  bus.on('ace:ready', attach);
})();
