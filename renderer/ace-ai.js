// PiPilot IDE — Ace Editor AI integrations (Codestral)
//   1. Ghost-text inline completions via FIM
//   2. Hover peek on diagnostic squiggles
//   3. Quick fix menu (lightbulb / Ctrl+.)
//   4. Inline chat widget (Ctrl+I) with diff preview
//   5. Context menu (right-click)
//   6. Go to Definition (Ctrl+Click on imports)
//   7. Keybindings (Tab/Escape for ghost, Ctrl+I, Ctrl+., Alt+F8)
//
// Waits for bus.on('ace:ready', editor => ...) then wires everything up.
// Diagnostics data comes from ace-editor.js via bus.on('ace:diagnostics-updated', map).

(function () {
  'use strict';

  const bus = window.PiPilot.bus;
  const api = window.electronAPI;
  const state = window.PiPilot.state;

  let editor = null;
  let enabled = true;
  let diagnosticsMap = {}; // { [filePath]: [ { row, startCol, endCol, message, severity, source, code, fixes? } ] }

  // ---------- Utility ----------
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function stableHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function stripCodeFence(text, language) {
    if (!text) return '';
    const trimmed = text.trim();
    const m = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
    return m ? m[1] : trimmed;
  }

  function getActivePath() {
    return state?.activeFile || state?.activePath || '';
  }

  function detectLanguage(path) {
    if (!path) return 'plaintext';
    const ext = path.split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
      html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown',
      sh: 'bash', yml: 'yaml', yaml: 'yaml', sql: 'sql', c: 'c', cpp: 'cpp',
    };
    return map[ext] || ext;
  }

  // ============================================================
  //  CSS INJECTION
  // ============================================================
  function injectStyles() {
    if (document.getElementById('ace-ai-styles')) return;
    const css = `
/* Ghost text overlay */
.ace_ghost-text {
  color: var(--text-dim, rgba(160,160,170,0.5)) !important;
  font-style: italic;
  pointer-events: none;
  white-space: pre;
  position: absolute;
  z-index: 10;
  font-family: var(--font-mono, 'Fira Code', 'Cascadia Code', monospace);
  font-size: inherit;
  line-height: inherit;
}
/* Ghost text accept/reject buttons */
.pp-ghost-actions {
  position: absolute; z-index: 11;
  display: none; gap: 4px;
  pointer-events: auto;
}
.pp-ghost-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 3px;
  font-size: 10px; font-family: var(--font-mono, monospace);
  cursor: pointer; border: 1px solid var(--border, #2e2e35);
  transition: background 0.1s;
}
.pp-ghost-btn.accept {
  background: rgba(86,211,100,0.12); color: var(--ok, #56d364);
  border-color: rgba(86,211,100,0.25);
}
.pp-ghost-btn.accept:hover { background: rgba(86,211,100,0.25); }
.pp-ghost-btn.reject {
  background: var(--surface-alt, #232329); color: var(--text-dim, #6b6b76);
}
.pp-ghost-btn.reject:hover { background: var(--border, #2e2e35); color: var(--text-mid, #8a8a94); }
.pp-ghost-btn kbd {
  font-family: var(--font-mono, monospace); font-size: 9px;
  padding: 0 4px; border-radius: 2px;
  background: var(--bg, #16161a); border: 1px solid var(--border, #2e2e35);
  color: var(--text-dim, #6b6b76);
}

/* Diagnostic markers */
.pp-marker-error   { position: absolute; z-index: 3; border-bottom: 2px wavy var(--error, #e5484d); }
.pp-marker-warning { position: absolute; z-index: 3; border-bottom: 2px wavy var(--warn, #e5a84a); }
.pp-marker-info    { position: absolute; z-index: 3; border-bottom: 2px wavy var(--info, #4a90e5); }

/* Hover peek */
/* VSCode-style diagnostic hover peek */
.pp-hover-peek {
  position: absolute; z-index: 100; display: none;
  background: var(--surface, #252830);
  border: 1px solid var(--border, #3d4048);
  border-radius: 3px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.45);
  min-width: 320px; max-width: 560px;
  font-size: 13px; color: var(--text, #cccccc);
  font-family: var(--font-sans, -apple-system, system-ui, sans-serif);
  overflow: hidden;
}
.pp-hover-peek.severity-error { border-left: 3px solid var(--error, #e5484d); }
.pp-hover-peek.severity-warning { border-left: 3px solid var(--warn, #e5a639); }
.pp-hover-peek.severity-info { border-left: 3px solid var(--info, #4a90e5); }
.pp-hover-peek-body { padding: 8px 12px; line-height: 1.5; }
.pp-hover-peek-msg { display: flex; gap: 8px; align-items: flex-start; }
.pp-hover-peek-icon { font-size: 14px; line-height: 1.2; flex-shrink: 0; margin-top: 1px; }
.pp-hover-peek-text { flex: 1; word-break: break-word; color: var(--text, #cccccc); }
.pp-hover-peek-code {
  font-family: var(--font-mono, monospace);
  color: var(--text-dim, #8b949e);
  font-size: 11px; margin-top: 3px;
}
.pp-hover-peek-actions {
  display: flex; gap: 0; padding: 0;
  border-top: 1px solid var(--border, #3d4048);
  background: var(--bg, #1a1d23);
}
.pp-hover-peek-btn {
  background: transparent; color: var(--info, #58a6ff);
  border: 0; padding: 6px 12px; font-size: 12px;
  cursor: pointer; font-family: inherit;
  border-right: 1px solid var(--border, #3d4048);
  transition: background 0.1s;
  white-space: nowrap;
}
.pp-hover-peek-btn:last-child { border-right: 0; }
.pp-hover-peek-btn:hover { background: rgba(88,166,255,0.1); }
.pp-hover-peek-btn.accent { color: var(--accent, #FF6B35); }
.pp-hover-peek-btn.accent:hover { background: rgba(255,107,53,0.1); }
.pp-hover-peek-kbd { opacity: 0.5; margin-left: 6px; font-size: 10px; font-family: var(--font-mono, monospace); }

/* Quick fix menu */
.pp-qf-menu {
  position: absolute; z-index: 101; display: none;
  background: var(--surface, #252830);
  border: 1px solid var(--border, #3d4048);
  border-radius: 4px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  padding: 4px 0; min-width: 260px;
  font-size: 12px; color: var(--text-strong, #e7e7ea);
}
.pp-qf-header {
  padding: 4px 12px; color: var(--text-dim, #9ca3af);
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
}
.pp-qf-item {
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  padding: 5px 12px; cursor: pointer;
}
.pp-qf-item:hover { background: var(--accent-bg, #094771); }
.pp-qf-item.disabled { opacity: 0.4; cursor: not-allowed; }
.pp-qf-item.disabled:hover { background: transparent; }

/* Context menu */
.pp-ctx-menu {
  position: absolute; z-index: 101; display: none;
  background: var(--surface, #252830);
  border: 1px solid var(--border, #3d4048);
  border-radius: 4px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  padding: 4px 0; min-width: 260px;
  font-size: 12px; color: var(--text-strong, #e7e7ea);
}
.pp-ctx-item {
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  padding: 5px 12px; cursor: pointer;
}
.pp-ctx-item:hover { background: var(--accent-bg, #094771); }
.pp-ctx-item.disabled { opacity: 0.4; cursor: not-allowed; }
.pp-ctx-item.disabled:hover { background: transparent; }
.pp-ctx-hint {
  color: var(--text-dim, #9ca3af);
  font-size: 10px; font-family: var(--font-mono, monospace);
}
.pp-ctx-sep { height: 1px; background: var(--border, #3d4048); margin: 4px 0; }

/* Inline chat widget */
.pp-inline-chat {
  background: var(--surface, #1e1f26);
  border: 1px solid var(--border, #3d4048);
  border-radius: 6px;
  padding: 8px; margin: 4px 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  font-family: var(--font-sans, system-ui, sans-serif);
}
.pp-inline-chat-header {
  font-size: 10px; color: var(--text-dim, #9ca3af);
  margin-bottom: 6px; display: flex; justify-content: space-between;
}
.pp-inline-chat-input {
  width: 100%;
  background: var(--bg, #0f1014);
  color: var(--text-strong, #e7e7ea);
  border: 1px solid var(--border, #3d4048);
  border-radius: 4px; padding: 6px 8px;
  font-size: 12px; outline: none;
  font-family: var(--font-sans, system-ui, sans-serif);
  box-sizing: border-box;
}
.pp-inline-chat-input:focus { border-color: var(--accent, #7f77dd); }
.pp-inline-chat-actions { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
.pp-inline-chat-btn {
  background: var(--surface-alt, #3d4048);
  color: var(--text-strong, #e7e7ea);
  border: 0; border-radius: 4px; padding: 3px 10px;
  font-size: 11px; cursor: pointer;
}
.pp-inline-chat-btn.primary { background: var(--accent, #7f77dd); color: white; }
.pp-inline-chat-btn:hover { filter: brightness(1.1); }

/* Diff preview */
.pp-diff {
  font-family: var(--font-mono, monospace);
  font-size: 11px; margin-top: 6px;
  background: var(--bg, #0f1014);
  border-radius: 4px; padding: 6px 8px;
  max-height: 140px; overflow: auto;
  white-space: pre;
  border: 0.5px solid var(--border-dim, #2a2d35);
}
.pp-diff-add { background: rgba(60,190,120,0.12); color: var(--ok, #7fdca1); display: block; }
.pp-diff-del { background: rgba(220,80,80,0.12); color: var(--error, #e88a8a); display: block; text-decoration: line-through; }

/* Spinner */
.pp-ai-spinner {
  display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid var(--accent, #7f77dd); border-right-color: transparent;
  animation: pp-spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px;
}
@keyframes pp-spin { to { transform: rotate(360deg); } }

/* Kbd badge */
.pp-kbd {
  background: var(--surface-alt, #3d4048); border-radius: 3px;
  padding: 0 4px; font-size: 10px; font-family: var(--font-mono, monospace);
}

/* Symbol hover tooltip (VSCode 2012+ standard) */
.pp-symbol-hover {
  position: absolute; z-index: 99; display: none;
  background: var(--surface, #1c1c21); border: 1px solid var(--border, #2e2e35);
  border-radius: 3px; box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  max-width: 560px; min-width: 320px; font-size: 13px;
  color: var(--text, #b0b0b8); pointer-events: none;
  overflow: hidden;
}
.pp-symbol-hover-sig-block {
  padding: 6px 10px;
  background: var(--bg, #16161a);
  font-family: var(--font-mono, 'Cascadia Code', 'JetBrains Mono', monospace);
  font-size: 12px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
  border-bottom: 1px solid var(--border, #2e2e35);
}
.pp-symbol-hover-sig-block .sh-keyword { color: #FF8C61; }
.pp-symbol-hover-sig-block .sh-fn { color: #e5a639; }
.pp-symbol-hover-sig-block .sh-type { color: #6cb6ff; }
.pp-symbol-hover-sig-block .sh-param { color: #d9d9de; }
.pp-symbol-hover-sig-block .sh-punct { color: #8a8a94; }
.pp-symbol-hover-sig-block .sh-string { color: #56d364; }
.pp-symbol-hover-doc-block {
  padding: 6px 10px;
  font-size: 12px; line-height: 1.6;
  color: var(--text, #b0b0b8);
  font-family: var(--font-sans, system-ui, sans-serif);
}
.pp-symbol-hover-doc-block .sh-param-name {
  font-family: var(--font-mono, monospace); color: var(--accent, #FF6B35);
  font-weight: 500;
}
.pp-symbol-hover-doc-block .sh-param-desc { color: var(--text-mid, #8a8a94); }
.pp-symbol-hover-doc-block p { margin: 0 0 4px; }
.pp-symbol-hover-doc-block p:last-child { margin-bottom: 0; }
.pp-symbol-hover-doc-block code {
  font-family: var(--font-mono, monospace); font-size: 11px;
  background: var(--bg, #16161a); padding: 1px 4px; border-radius: 2px;
}

/* Outline panel */
.outline-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; cursor: pointer; font-size: 11px;
  transition: background 0.1s;
}
.outline-row:hover { background: var(--surface-alt, #232329); }
.outline-icon {
  width: 16px; text-align: center; font-weight: 700;
  font-family: var(--font-mono, monospace); font-size: 11px; flex-shrink: 0;
}
.outline-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; color: var(--text, #b0b0b8);
  font-family: var(--font-mono, monospace);
}
.outline-kind {
  font-size: 9px; color: var(--text-dim, #6b6b76);
  text-transform: uppercase; letter-spacing: 0.06em; flex-shrink: 0;
}
.outline-line {
  font-size: 9px; color: var(--text-faint, #42424a);
  font-family: var(--font-mono, monospace); flex-shrink: 0;
}

/* Floating selection action bar */
.pp-sel-actions {
  position: absolute; z-index: 95;
  display: none;
  background: var(--surface, #1c1c21);
  border: 1px solid var(--border, #2e2e35);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.45);
  padding: 3px;
  gap: 2px;
}
.pp-sel-actions.visible {
  display: inline-flex;
  animation: pp-sel-fade-in 0.12s ease-out;
}
@keyframes pp-sel-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.pp-sel-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border: none; border-radius: 4px;
  background: transparent; color: var(--text-mid, #8a8a94);
  font-family: var(--font-mono, monospace); font-size: 10px;
  cursor: pointer; transition: background 0.1s, color 0.1s;
  white-space: nowrap;
}
.pp-sel-btn:hover {
  background: var(--surface-alt, #232329);
  color: var(--text-strong, #e7e7ea);
}
.pp-sel-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
.pp-sel-btn.accent { color: var(--accent, #FF6B35); }
.pp-sel-btn.accent:hover { background: rgba(255,107,53,0.1); }
.pp-sel-sep { width: 1px; background: var(--border, #2e2e35); margin: 2px 0; align-self: stretch; }
`;
    const s = document.createElement('style');
    s.id = 'ace-ai-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ============================================================
  //  GHOST TEXT (FIM inline completions)
  // ============================================================
  let ghostEl = null;
  let currentGhost = null;
  let ghostTimer = null;
  let lastRequestId = null;
  const recentlyFetched = new Map();
  const RECENT_TTL = 25000;

  let lastKeyWasTrigger = false; // Track if last key was Enter/Space for fast trigger

  function initGhostText() {
    ghostEl = document.createElement('div');
    ghostEl.className = 'ace_ghost-text';
    ghostEl.style.display = 'none';
    editor.container.appendChild(ghostEl);

    // Attach session-level listeners (must re-attach on session change)
    function wireSession(session) {
      session.on('change', () => {
        if (ghostMutating) return; // ignore spacer insert/remove
        clearGhost();
        // Use shorter delay if the last key was Enter/Space (trigger keys)
        if (lastKeyWasTrigger) {
          lastKeyWasTrigger = false;
          scheduleGhostFast();
        } else {
          scheduleGhost();
        }
      });
      session.on('changeScrollTop', () => { if (currentGhost) positionGhost(); });
    }
    wireSession(editor.session);

    // Re-wire when editor switches session (tab switch)
    editor.on('changeSession', (e) => {
      clearGhost();
      if (e.session) wireSession(e.session);
    });

    // Detect trigger keys: Enter, Space, semicolon, closing brace/paren
    editor.container.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === ';' || e.key === '}' || e.key === ')') {
        lastKeyWasTrigger = true;
      } else {
        lastKeyWasTrigger = false;
      }
    }, true); // capture phase so it fires before Ace processes the key

    editor.selection.on('changeCursor', () => {
      if (currentGhost) {
        const c = editor.getCursorPosition();
        if (c.row !== currentGhost.row || c.column !== currentGhost.col) clearGhost();
      }
    });
    editor.renderer.on('afterRender', () => { if (currentGhost) { positionGhost(); positionGhostActions(); } });
  }

  let ghostSpacerLines = 0; // number of empty lines inserted as spacer
  let ghostSpacerRow = -1;  // row after which spacer lines were inserted
  let ghostMutating = false; // guard to prevent change events during spacer insert/remove

  function clearGhost() {
    // Remove spacer empty lines
    if (ghostSpacerLines > 0 && ghostSpacerRow >= 0) {
      const startRow = ghostSpacerRow + 1;
      const endRow = startRow + ghostSpacerLines;
      ghostMutating = true;
      try { editor.session.doc.removeFullLines(startRow, endRow - 1); } catch {}
      ghostMutating = false;
      ghostSpacerLines = 0;
      ghostSpacerRow = -1;
    }
    currentGhost = null;
    if (ghostEl) { ghostEl.style.display = 'none'; ghostEl.textContent = ''; }
    if (ghostActionsEl) ghostActionsEl.style.display = 'none';
  }

  function positionGhost() {
    if (!currentGhost || !ghostEl) return;
    const p = editor.renderer.textToScreenCoordinates(currentGhost.row, currentGhost.col);
    const r = editor.container.getBoundingClientRect();
    ghostEl.style.left = (p.pageX - r.left - window.scrollX) + 'px';
    ghostEl.style.top = (p.pageY - r.top - window.scrollY) + 'px';
    ghostEl.style.display = 'block';
  }

  let ghostActionsEl = null;

  function showGhost(text, row, col) {
    currentGhost = { text, row, col };
    ghostEl.textContent = text;
    positionGhost();
    showGhostActions();

    // For multi-line ghost text, insert empty lines to make room
    const extraLines = text.split('\n').length - 1;
    if (extraLines > 0) {
      const blanks = new Array(extraLines).fill('');
      ghostMutating = true;
      editor.session.doc.insertMergedLines({ row: row + 1, column: 0 }, ['', ...blanks]);
      ghostMutating = false;
      ghostSpacerLines = extraLines;
      ghostSpacerRow = row;
    } else {
      ghostSpacerLines = 0;
      ghostSpacerRow = -1;
    }
  }

  function showGhostActions() {
    if (!ghostActionsEl) {
      ghostActionsEl = document.createElement('div');
      ghostActionsEl.className = 'pp-ghost-actions';
      editor.container.appendChild(ghostActionsEl);
      ghostActionsEl.innerHTML = `
        <button class="pp-ghost-btn accept" title="Accept completion">
          <span>Accept</span><kbd>Tab</kbd>
        </button>
        <button class="pp-ghost-btn reject" title="Dismiss">
          <span>Dismiss</span><kbd>Esc</kbd>
        </button>
      `;
      ghostActionsEl.querySelector('.accept').addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (currentGhost) {
          const { text, row, col } = currentGhost;
          const hadSpacerLines = ghostSpacerLines;
          const spacerRow = ghostSpacerRow;
          clearGhost();
          editor.session.insert({ row, column: col }, text);
        }
      });
      ghostActionsEl.querySelector('.reject').addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        clearGhost();
      });
    }
    ghostActionsEl.style.display = 'flex';
    positionGhostActions();
  }

  function positionGhostActions() {
    if (!ghostActionsEl || !currentGhost) return;
    const p = editor.renderer.textToScreenCoordinates(currentGhost.row, currentGhost.col);
    const r = editor.container.getBoundingClientRect();
    const left = Math.max(0, p.pageX - r.left - window.scrollX);
    const top = p.pageY - r.top - window.scrollY + editor.renderer.lineHeight + 2;
    ghostActionsEl.style.left = left + 'px';
    ghostActionsEl.style.top = top + 'px';
  }

  function scheduleGhostFast() {
    if (!enabled) return;
    clearTimeout(ghostTimer);
    ghostTimer = setTimeout(requestGhost, 50); // Fast trigger for Enter/Space
  }

  function scheduleGhost() {
    if (!enabled) return;
    clearTimeout(ghostTimer);
    ghostTimer = setTimeout(requestGhost, 180);
  }

  // Context window config (matches Vite useInlineAI.ts)
  const FIM_CONFIG = {
    smallFileLineLimit: 200,
    smallFileCharLimit: 8000,
    smallFileMaxTokens: 400,
    largeFileMaxTokens: 100,
    contextLinesBefore: 30,
    contextLinesAfter: 10,
    contextCharsBefore: 1500,
    contextCharsAfter: 600,
  };

  function clipBefore(text) {
    const lines = text.split('\n');
    const recent = lines.slice(-FIM_CONFIG.contextLinesBefore).join('\n');
    return recent.length > FIM_CONFIG.contextCharsBefore ? recent.slice(-FIM_CONFIG.contextCharsBefore) : recent;
  }
  function clipAfter(text) {
    const lines = text.split('\n');
    const next = lines.slice(0, FIM_CONFIG.contextLinesAfter).join('\n');
    return next.length > FIM_CONFIG.contextCharsAfter ? next.slice(0, FIM_CONFIG.contextCharsAfter) : next;
  }

  // Clean raw completion (strip markdown, remove overlap, balance brackets)
  function cleanCompletion(raw, beforeText, afterText) {
    let c = raw;
    // Strip preamble text ("Here's the rewritten code:", "Sure, here's...", etc.)
    c = c.replace(/^[\s\S]*?(?:here(?:'s| is)(?: the)?[\s\S]*?:?\s*\n)/i, '');
    c = c.replace(/^[\s\S]*?(?:sure[,.]?\s*)/i, '');
    // Strip markdown code fences (```language\n...\n```)
    const fenceMatch = c.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n\s*```/);
    if (fenceMatch) {
      c = fenceMatch[1]; // extract content inside fences
    } else {
      c = c.replace(/```[a-zA-Z0-9]*\r?\n?/g, '').replace(/\r?\n?```/g, '');
    }
    c = c.replace(/<\|cursor\|>/g, '');
    // Strip leading/trailing explanation lines
    c = c.replace(/^\/\/\s*(Suggestion|Note|Explanation):.*\n?/gim, '');
    // Remove overlap with text before cursor
    const maxBefore = Math.min(c.length, beforeText.length);
    let overlapBefore = 0;
    for (let len = 1; len <= maxBefore; len++) {
      if (beforeText.endsWith(c.slice(0, len))) overlapBefore = len;
    }
    if (overlapBefore > 0) {
      const stripped = c.slice(overlapBefore);
      if (stripped.trim().length >= 2) c = stripped;
    }
    // Remove overlap with text after cursor
    const maxAfter = Math.min(c.length, 50);
    for (let len = maxAfter; len > 0; len--) {
      if (c.endsWith(afterText.slice(0, len))) {
        c = c.slice(0, c.length - len);
        break;
      }
    }
    // Balance brackets
    const opens = ['(', '[', '{'], closes = [')', ']', '}'];
    let result = '';
    const stack = [];
    for (const ch of c) {
      if (opens.includes(ch)) { stack.push(ch); result += ch; }
      else if (closes.includes(ch)) {
        const oi = closes.indexOf(ch);
        if (stack.length && stack[stack.length - 1] === opens[oi]) { stack.pop(); result += ch; }
        else break; // unbalanced
      } else result += ch;
    }
    return result.replace(/\s+$/, '');
  }

  async function requestGhost() {
    if (!enabled || !editor) return;
    const cursor = editor.getCursorPosition();
    const session = editor.session;
    const line = session.getLine(cursor.row);
    const prefix = line.slice(0, cursor.column);

    // Trigger at end of line, empty lines (after Enter), or lines with content
    const isEndOfLine = cursor.column >= line.trimEnd().length;
    const isNewLine = line.trim().length === 0 && cursor.row > 0;
    const hasContent = prefix.trim().length >= 2;
    if (!isEndOfLine && !isNewLine) return clearGhost();
    if (!hasContent && !isNewLine) return clearGhost();

    // Build full text and decide: full file or clipped window (matches Vite)
    const totalLines = session.getLength();
    const fullText = session.getValue();
    const offset = session.doc.positionToIndex(cursor);

    const useFullFile = totalLines <= FIM_CONFIG.smallFileLineLimit &&
                        fullText.length <= FIM_CONFIG.smallFileCharLimit;

    let before, after;
    if (useFullFile) {
      before = fullText.slice(0, offset);
      after = fullText.slice(offset);
    } else {
      before = clipBefore(fullText.slice(0, offset));
      after = clipAfter(fullText.slice(offset));
    }

    if (before.trim().length < 2) return clearGhost();

    const language = detectLanguage(getActivePath());
    const hash = stableHash(language + '::' + before.slice(-80) + '::' + after.slice(0, 30));
    const recentTs = recentlyFetched.get(hash);
    if (recentTs && (Date.now() - recentTs) < RECENT_TTL) return;

    const requestId = 'fim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    lastRequestId = requestId;

    try {
      // Try Codestral FIM first (purpose-built for code completion)
      let raw = '';
      const maxTokens = useFullFile ? FIM_CONFIG.smallFileMaxTokens : FIM_CONFIG.largeFileMaxTokens;

      try {
        const res = await api.codestral.fim({
          prefix: before,
          suffix: after,
          language,
          maxTokens,
          temperature: 0,
          stop: ['\n\n\n', '```'],
          requestId,
        });
        if (res?.ok && lastRequestId === requestId) {
          raw = (res.text || '').toString();
        }
      } catch {}

      // Fallback: chat endpoint with <|cursor|> marker (matches Vite)
      if (!raw.trim() && lastRequestId === requestId) {
        try {
          const systemPrompt = useFullFile
            ? `You are a ${language} code completion engine. The user shows you a full source file with a <|cursor|> marker. Output ONLY the raw code to insert at the cursor. No markdown, no code fences, no commentary. Empty response if unsure.`
            : `You are a ${language} code completion engine. Output ONLY the raw code to insert at <|cursor|>. No markdown, no fences, no commentary. Keep it short, usually 1-3 lines. Empty response if unsure.`;

          const chatRes = await api.codestral.chat({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `${before}<|cursor|>${after}` },
            ],
            maxTokens,
            temperature: 0,
          });
          if (chatRes?.text && lastRequestId === requestId) {
            raw = chatRes.text;
          }
        } catch {}
      }

      if (!raw.trim() || lastRequestId !== requestId) return;

      // Clean the completion (strip markdown, remove overlaps, balance brackets)
      const cleaned = cleanCompletion(raw, before, after);
      if (!cleaned) return;

      // Verify cursor hasn't moved
      const c = editor.getCursorPosition();
      if (c.row !== cursor.row || c.column !== cursor.column) return;

      showGhost(cleaned, cursor.row, cursor.column);
    } finally {
      recentlyFetched.set(hash, Date.now());
      if (recentlyFetched.size > 80) {
        const cutoff = Date.now() - RECENT_TTL;
        for (const [k, t] of recentlyFetched.entries()) {
          if (t < cutoff) recentlyFetched.delete(k);
        }
      }
    }
  }

  // ============================================================
  //  HOVER PEEK
  // ============================================================
  let peekEl = null;
  let peekDiag = null;
  let peekHideTimer = null;
  let peekLocked = false;

  function initHoverPeek() {
    peekEl = document.createElement('div');
    peekEl.className = 'pp-hover-peek';
    document.body.appendChild(peekEl);

    peekEl.addEventListener('mouseenter', () => { peekLocked = true; clearTimeout(peekHideTimer); });
    peekEl.addEventListener('mouseleave', () => { peekLocked = false; hidePeek(); });

    editor.container.addEventListener('mousemove', (e) => {
      const tp = editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
      const path = getActivePath();
      const diags = diagnosticsMap[path] || [];

      // Priority 1: exact squiggle range hit
      let hit = diags.find(d =>
        tp.row === d.row && tp.column >= d.startCol && tp.column <= Math.max(d.endCol, d.startCol + 3)
      );
      // Priority 2: anywhere on a diagnostic line (like hovering the gutter icon)
      if (!hit) {
        hit = diags.find(d => tp.row === d.row);
      }

      if (hit) {
        if (peekDiag !== hit) showPeek(hit, e.clientX, e.clientY);
        else clearTimeout(peekHideTimer);
      } else {
        hidePeek();
      }
    });

    editor.container.addEventListener('mouseleave', () => hidePeek());

    // Also show peek when hovering gutter annotations (the ✕ / ⚠ icons)
    editor.on('guttermousedown', (e) => {
      const row = e.getDocumentPosition().row;
      const path = getActivePath();
      const diags = diagnosticsMap[path] || [];
      const hit = diags.find(d => d.row === row);
      if (hit) {
        e.stop();
        const rect = editor.container.getBoundingClientRect();
        showPeek(hit, rect.left + 60, e.clientY || (rect.top + row * editor.renderer.lineHeight));
      }
    });
  }

  function hidePeek(immediate) {
    if (peekLocked && !immediate) return;
    clearTimeout(peekHideTimer);
    peekHideTimer = setTimeout(() => {
      if (peekEl) peekEl.style.display = 'none';
      peekDiag = null;
    }, immediate ? 0 : 120);
  }

  function showPeek(diag, x, y) {
    if (!peekEl) return;
    peekDiag = diag;
    clearTimeout(peekHideTimer);

    const sev = diag.severity || 'error';
    const icon = sev === 'error' ? '⊗' : sev === 'warning' ? '△' : 'ⓘ';
    const color = sev === 'error' ? 'var(--error, #e5484d)'
      : sev === 'warning' ? 'var(--warn, #e5a639)' : 'var(--info, #4a90e5)';
    const hasFixes = diag.fixes?.length > 0;
    const sourceCode = [diag.source, diag.code].filter(Boolean).join('(') + (diag.code ? ')' : '');

    // Set severity class for left border color
    peekEl.className = 'pp-hover-peek severity-' + sev;

    peekEl.innerHTML = `
      <div class="pp-hover-peek-body">
        <div class="pp-hover-peek-msg">
          <span class="pp-hover-peek-icon" style="color:${color};">${icon}</span>
          <div class="pp-hover-peek-text">
            ${esc(diag.message)}
            ${sourceCode ? `<div class="pp-hover-peek-code">${esc(sourceCode)}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="pp-hover-peek-actions">
        <button class="pp-hover-peek-btn" data-a="view">View Problem<span class="pp-hover-peek-kbd">Alt+F8</span></button>
        <button class="pp-hover-peek-btn" data-a="qf">Quick Fix...<span class="pp-hover-peek-kbd">Ctrl+.</span></button>
        <button class="pp-hover-peek-btn accent" data-a="ai">✨ Fix<span class="pp-hover-peek-kbd">Ctrl+I</span></button>
      </div>`;

    peekEl.querySelectorAll('.pp-hover-peek-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const a = btn.dataset.a;
        hidePeek(true);
        if (a === 'view') {
          // Jump to problem and show it in the Problems panel
          editor.gotoLine(diag.row + 1, diag.startCol, true);
          bus.emit('bottom:show', 'problems');
        } else if (a === 'qf') {
          if (hasFixes) {
            showQuickFix(diag, x, y);
          } else {
            // No fixes available — open inline chat as fallback
            openInlineChat({ prefillPrompt: 'Fix this: ' + diag.message, row: diag.row, autoSend: true });
          }
        } else if (a === 'ai') {
          // Send to chat panel and auto-submit
          const filePath = getActivePath();
          const fileName = filePath ? filePath.split(/[/\\]/).pop() : 'file';
          const prompt = `Fix this ${sev} in \`${fileName}\` at line ${diag.row + 1}:\n\n**${sourceCode || sev}**: ${diag.message}`;
          document.getElementById('ide-root')?.classList.remove('chat-collapsed');
          bus.emit('menu:view:toggle-chat'); // ensure visible
          setTimeout(() => {
            // Only toggle if currently hidden
            const root = document.getElementById('ide-root');
            if (root?.classList.contains('chat-collapsed')) {
              bus.emit('menu:view:toggle-chat');
            }
            window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
              detail: { prefill: prompt, submit: true },
            }));
          }, 100);
        }
      };
    });

    peekEl.style.display = 'block';
    // Position: below the line, aligned left (like VSCode)
    const editorRect = editor.container.getBoundingClientRect();
    const lineCoords = editor.renderer.textToScreenCoordinates(diag.row, diag.startCol || 0);
    const r = peekEl.getBoundingClientRect();
    let left = Math.max(editorRect.left + 4, Math.min(lineCoords.pageX - 20, editorRect.right - r.width - 4));
    let top = lineCoords.pageY + editor.renderer.lineHeight + 4;
    // If too close to bottom, show above
    if (top + r.height > window.innerHeight - 20) {
      top = lineCoords.pageY - r.height - 4;
    }
    peekEl.style.left = left + 'px';
    peekEl.style.top = top + 'px';
  }

  // ============================================================
  //  QUICK FIX MENU
  // ============================================================
  let qfMenuEl = null;

  function initQuickFix() {
    qfMenuEl = document.createElement('div');
    qfMenuEl.className = 'pp-qf-menu';
    document.body.appendChild(qfMenuEl);
  }

  function hideQuickFix() {
    if (qfMenuEl) qfMenuEl.style.display = 'none';
    peekLocked = false;
  }

  function showQuickFix(diag, x, y) {
    if (!qfMenuEl || !diag) return;
    peekLocked = true;
    qfMenuEl.innerHTML = '<div class="pp-qf-header">Quick Fix</div>';

    const fixes = diag.fixes || [];
    fixes.forEach(fix => {
      const item = document.createElement('div');
      item.className = 'pp-qf-item';
      item.innerHTML = '<span>\uD83D\uDCA1 ' + esc(fix.title) + '</span>';
      item.onclick = () => {
        hideQuickFix();
        hidePeek(true);
        if (typeof fix.apply === 'function') {
          fix.apply();
        } else if (fix.replacement != null) {
          // Apply a text replacement fix
          const range = ace.require('ace/range').Range;
          editor.session.replace(
            new range(fix.startRow ?? diag.row, fix.startCol ?? diag.startCol,
                      fix.endRow ?? diag.row, fix.endCol ?? diag.endCol),
            fix.replacement
          );
        }
        bus.emit('toast:show', { message: 'Applied: ' + fix.title, type: 'success' });
      };
      qfMenuEl.appendChild(item);
    });

    // Always add "Fix with AI" option
    const aiItem = document.createElement('div');
    aiItem.className = 'pp-qf-item';
    aiItem.style.borderTop = '1px solid var(--border, #3d4048)';
    aiItem.innerHTML = '<span style="color:var(--accent-secondary, #b4a7ff);">Fix with AI...</span>';
    aiItem.onclick = () => {
      hideQuickFix();
      hidePeek(true);
      openInlineChat({ prefillPrompt: 'Fix: ' + diag.message, row: diag.row });
    };
    qfMenuEl.appendChild(aiItem);

    qfMenuEl.style.display = 'block';
    const r = qfMenuEl.getBoundingClientRect();
    qfMenuEl.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    qfMenuEl.style.top = (y + 10) + 'px';
  }

  // ============================================================
  //  INLINE CHAT WIDGET (Ctrl+I)
  // ============================================================
  let currentChatWidget = null;

  function closeInlineChat() {
    if (!currentChatWidget) return;
    try {
      if (editor.session.widgetManager) {
        editor.session.widgetManager.removeLineWidget(currentChatWidget);
      }
    } catch (e) { /* ignore */ }
    currentChatWidget = null;
    editor.focus();
  }

  function openInlineChat({ prefillPrompt = '', row = null, autoSend = false } = {}) {
    closeInlineChat();

    // Ensure line widget manager exists
    if (!editor.session.widgetManager) {
      const LineWidgets = ace.require('ace/line_widgets').LineWidgets;
      editor.session.widgetManager = new LineWidgets(editor.session);
      editor.session.widgetManager.attach(editor);
    }

    const sel = editor.getSelectionRange();
    const hasSel = !sel.isEmpty();
    const targetRow = row ?? sel.end.row;
    const selText = hasSel ? editor.getSelectedText() : '';
    const language = detectLanguage(getActivePath());

    const wrap = document.createElement('div');
    wrap.className = 'pp-inline-chat';
    wrap.innerHTML = `
      <div class="pp-inline-chat-header">
        <span>Ask PiPilot${hasSel ? ' \u00B7 ' + selText.split('\\n').length + ' lines selected' : ''}</span>
        <span><span class="pp-kbd">Enter</span> generate \u00B7 <span class="pp-kbd">Esc</span> close</span>
      </div>
      <input class="pp-inline-chat-input" placeholder="e.g. convert to arrow function, add error handling, explain..." />
      <div class="pp-inline-chat-actions"></div>`;

    const input = wrap.querySelector('.pp-inline-chat-input');
    const actions = wrap.querySelector('.pp-inline-chat-actions');
    input.value = prefillPrompt;

    const widget = { row: targetRow, fixedWidth: true, coverGutter: true, el: wrap };
    editor.session.widgetManager.addLineWidget(widget);
    currentChatWidget = widget;
    setTimeout(() => { input.focus(); input.select(); }, 30);

    let generated = null;
    let activeHandle = null;

    function makeBtn(text, cls, fn) {
      const b = document.createElement('button');
      b.className = 'pp-inline-chat-btn ' + cls;
      b.textContent = text;
      b.onclick = fn;
      return b;
    }

    async function generate() {
      const userPrompt = input.value.trim();
      if (!userPrompt) return;

      actions.innerHTML = '<span class="pp-ai-spinner"></span><span style="color:var(--text-dim,#9ca3af);font-size:11px;">Generating...</span>';
      generated = '';

      // Remove old diff if present
      const oldDiff = wrap.querySelector('.pp-diff');
      if (oldDiff) oldDiff.remove();

      const sys = 'You are a precise code editor. The user will request a change to a ' +
        (language || 'code') + ' snippet. Return ONLY the rewritten code that replaces the selection \u2014 no explanations, no surrounding prose, no markdown fences.';
      const userMsg = selText
        ? 'Request: ' + userPrompt + '\n\nSelected code:\n' + selText
        : 'Request: ' + userPrompt + '\n\nContext file: ' + getActivePath();

      const handle = api.codestral.chatStream({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.2,
        maxTokens: 2048,
      }, (evt) => {
        if (evt.type === 'text') {
          generated += evt.text;
          // Live preview: show accumulated text
          showDiffPreview(wrap, actions, selText, generated);
        } else if (evt.type === 'error') {
          actions.innerHTML = '';
          actions.appendChild(document.createTextNode('Error: ' + (evt.message || 'Unknown')));
          actions.appendChild(makeBtn('Retry', '', generate));
          actions.appendChild(makeBtn('Close', '', closeInlineChat));
        } else if (evt.type === 'done') {
          handle.dispose();
          activeHandle = null;
          if (generated) {
            generated = stripCodeFence(generated, language);
            showDiffPreview(wrap, actions, selText, generated);
            actions.innerHTML = '';
            actions.appendChild(makeBtn('Accept', 'primary', accept));
            actions.appendChild(makeBtn('Regenerate', '', generate));
            actions.appendChild(makeBtn('Discard', '', closeInlineChat));
          }
          // Reflow widget
          try { editor.session.widgetManager.onWidgetChanged(widget); } catch (e) { /* ignore */ }
        }
      });
      activeHandle = handle;
    }

    function showDiffPreview(container, actionsEl, original, replacement) {
      let diff = container.querySelector('.pp-diff');
      if (!diff) {
        diff = document.createElement('div');
        diff.className = 'pp-diff';
        container.insertBefore(diff, actionsEl);
      }
      diff.innerHTML = '';
      if (original) {
        original.split('\n').forEach(l => {
          const d = document.createElement('span');
          d.className = 'pp-diff-del';
          d.textContent = '- ' + l;
          diff.appendChild(d);
        });
      }
      replacement.split('\n').forEach(l => {
        const a = document.createElement('span');
        a.className = 'pp-diff-add';
        a.textContent = '+ ' + l;
        diff.appendChild(a);
      });
      diff.scrollTop = diff.scrollHeight;
    }

    function accept() {
      if (!generated) return;
      const cleaned = stripCodeFence(generated, language);
      if (hasSel) {
        editor.session.replace(sel, cleaned);
      } else {
        editor.session.insert({ row: targetRow, column: 0 }, cleaned + '\n');
      }
      closeInlineChat();
      bus.emit('toast:show', { message: 'Applied edit', type: 'success' });
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); }
      if (e.key === 'Escape') { e.preventDefault(); closeInlineChat(); }
      e.stopPropagation(); // Don't let Ace steal keystrokes
    });

    // Auto-generate if prefilled
    if (prefillPrompt && autoSend) setTimeout(generate, 100);
    else if (prefillPrompt) setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  // ============================================================
  //  CONTEXT MENU
  // ============================================================
  let ctxMenuEl = null;

  function initContextMenu() {
    ctxMenuEl = document.createElement('div');
    ctxMenuEl.className = 'pp-ctx-menu';
    document.body.appendChild(ctxMenuEl);

    // Dismiss on click outside
    document.addEventListener('click', (e) => {
      if (ctxMenuEl && !ctxMenuEl.contains(e.target)) hideCtx();
      if (qfMenuEl && !qfMenuEl.contains(e.target)) hideQuickFix();
    });

    editor.container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const selText = editor.getSelectedText();
      const hasSel = selText.length > 0;

      ctxMenuEl.innerHTML = '';
      const filePath = getActivePath();
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      const isRunnable = ['js', 'mjs', 'cjs'].includes(ext);

      const items = [];
      if (isRunnable) {
        items.push({
          label: '▶ Run',
          hint: 'node',
          run: () => runActiveFileInTerminal(),
        });
        items.push('sep');
      }
      items.push(
        { label: 'Inline Chat', hint: 'Ctrl+I', run: () => openInlineChat() },
        { label: 'Add to Chat', disabled: !hasSel, run: () => addToChat() },
        { label: 'Quick Fix', hint: 'Ctrl+.', run: () => editor.execCommand('quickFix') },
        'sep',
      );
      items.push(...[
        { label: 'Cut', hint: 'Ctrl+X', disabled: !hasSel, run: async () => {
          try { await navigator.clipboard.writeText(selText); editor.session.replace(editor.getSelectionRange(), ''); } catch (err) { /* ignore */ }
        }},
        { label: 'Copy', hint: 'Ctrl+C', disabled: !hasSel, run: async () => {
          try { await navigator.clipboard.writeText(selText); } catch (err) { /* ignore */ }
        }},
        { label: 'Paste', hint: 'Ctrl+V', run: async () => {
          try { editor.insert(await navigator.clipboard.readText()); } catch (err) { /* ignore */ }
        }},
        'sep',
        { label: 'Find', hint: 'Ctrl+F', run: () => editor.execCommand('find') },
        { label: 'Go to Line', hint: 'Ctrl+G', run: () => editor.execCommand('gotoline') },
        { label: 'Next Problem', hint: 'Alt+F8', run: () => editor.execCommand('nextProblem') },
      ]);

      // Allow extensions to inject context menu items
      const extItems = [];
      bus.emit('editor:context-menu', { items: extItems, hasSelection: hasSel, selectedText: selText, filePath: getActivePath() });
      if (extItems.length) {
        items.push('sep');
        extItems.forEach(function (ei) { items.push(ei); });
      }

      items.forEach(item => {
        if (item === 'sep') {
          const s = document.createElement('div');
          s.className = 'pp-ctx-sep';
          ctxMenuEl.appendChild(s);
          return;
        }
        const row = document.createElement('div');
        row.className = 'pp-ctx-item' + (item.disabled ? ' disabled' : '');
        row.innerHTML = '<span>' + esc(item.label) + '</span>' +
          (item.hint ? '<span class="pp-ctx-hint">' + item.hint + '</span>' : '');
        if (!item.disabled) row.onclick = () => { hideCtx(); item.run(); };
        ctxMenuEl.appendChild(row);
      });

      ctxMenuEl.style.display = 'block';
      const r = ctxMenuEl.getBoundingClientRect();
      ctxMenuEl.style.left = Math.min(e.clientX, window.innerWidth - r.width - 8) + 'px';
      ctxMenuEl.style.top = Math.min(e.clientY, window.innerHeight - r.height - 8) + 'px';
    });
  }

  function hideCtx() {
    if (ctxMenuEl) ctxMenuEl.style.display = 'none';
  }

  // ============================================================
  //  ADD TO CHAT
  // ============================================================
  function addToChat() {
    if (!editor) return;
    const selText = editor.getSelectedText();
    const filePath = getActivePath();
    const language = detectLanguage(filePath);
    const relPath = filePath && state.projectPath
      ? filePath.replace(state.projectPath + '/', '').replace(state.projectPath + '\\', '')
      : filePath;
    const fileRef = relPath ? '@' + relPath : '';
    const snippet = selText || editor.getValue();
    const fence = '```' + language + '\n' + snippet + '\n```';
    const prompt = selText
      ? 'From ' + fileRef + '\n\n' + fence + '\n\n'
      : fileRef + '\n\n';

    document.getElementById('chat-panel')?.classList.remove('hidden');
    bus.emit('chat:focus-with-prompt', prompt);
    bus.emit('toast:show', { message: 'Added to chat', type: 'success' });
  }

  // ============================================================
  //  RUN ACTIVE FILE IN TERMINAL  (right-click → Run on .js/.mjs/.cjs)
  // ============================================================
  // Opens (or reveals) the bottom terminal panel, spawns a fresh terminal
  // tab rooted at the project, and writes "node <relativePath>" into its
  // stdin. The terminal is a normal pty session so output streams live —
  // user can Ctrl+C, scroll, run again, etc.
  function runActiveFileInTerminal() {
    const filePath = getActivePath();
    if (!filePath) return;
    const projectPath = state.projectPath;
    if (!projectPath) {
      bus.emit('toast:show', { message: 'Open a project first', type: 'warn' });
      return;
    }
    // Compute path relative to project root, normalised to forward slashes.
    const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const root = norm(projectPath);
    const fp = norm(filePath);
    let relPath = fp;
    if (fp.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      relPath = fp.slice(root.length + 1);
    }
    // Quote if path has spaces — node handles either, but quoting is safer.
    const arg = /\s/.test(relPath) ? `"${relPath}"` : relPath;
    const cmd = `node ${arg}`;

    // The terminal-panel module listens for 'terminal:new' and creates a
    // tab; once it's ready it broadcasts 'terminal:created' with the id.
    // Subscribe ONCE, then write the command after a short delay so the
    // shell has printed its prompt and won't eat the keystrokes.
    const off = bus.on('terminal:created', ({ id }) => {
      off();
      setTimeout(() => {
        try { api.terminal.write(id, cmd + '\r'); } catch (err) {
          console.error('terminal write failed:', err);
        }
      }, 250);
    });

    bus.emit('bottom:show', 'terminal');
    bus.emit('terminal:new', { cwd: projectPath });
    bus.emit('toast:show', { message: 'Running: ' + cmd, type: 'info' });
  }

  // ============================================================
  //  GO TO DEFINITION (Ctrl+Click on import paths)
  // ============================================================
  function initGoToDefinition() {
    editor.container.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      const pos = editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
      const line = editor.session.getLine(pos.row);
      if (!line) return;

      // Find quoted string under cursor
      const quotes = ['"', "'", '`'];
      let start = -1, end = -1, quote = null;
      for (let i = pos.column; i >= 0; i--) {
        if (quotes.includes(line[i])) { start = i + 1; quote = line[i]; break; }
      }
      if (start < 0 || !quote) return;
      for (let i = pos.column; i < line.length; i++) {
        if (line[i] === quote) { end = i; break; }
      }
      if (end < 0) return;

      const importPath = line.slice(start, end);
      if (!importPath || importPath.length < 2) return;

      // Only handle relative paths (./foo, ../bar)
      if (!importPath.startsWith('.')) return;

      const currentFile = getActivePath();
      if (!currentFile) return;

      // Resolve relative to current file's directory
      const dir = currentFile.replace(/[\\/][^\\/]+$/, '');
      let resolved = dir + '/' + importPath;

      // Normalize path separators
      resolved = resolved.replace(/\\/g, '/');

      // Try common extensions
      const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss'];
      const indexFiles = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

      bus.emit('file:try-open', {
        basePath: resolved,
        extensions,
        indexFiles,
        fallback: importPath,
      });
    });
  }

  // ============================================================
  //  KEYBINDINGS
  // ============================================================
  function registerKeybindings() {
    // Tab: accept ghost text
    editor.commands.addCommand({
      name: 'acceptGhost',
      bindKey: { win: 'Tab', mac: 'Tab' },
      exec: (ed) => {
        if (!currentGhost) return false;
        const { text, row, col } = currentGhost;
        clearGhost();
        ed.session.insert({ row, column: col }, text);
        return true;
      },
      readOnly: true,
    });

    // Escape: dismiss ghost text / close inline chat
    editor.commands.addCommand({
      name: 'dismissGhostOrChat',
      bindKey: { win: 'Esc', mac: 'Esc' },
      exec: () => {
        if (currentGhost) { clearGhost(); return true; }
        if (currentChatWidget) { closeInlineChat(); return true; }
        return false;
      },
    });

    // Ctrl+I: open inline chat
    editor.commands.addCommand({
      name: 'inlineChat',
      bindKey: { win: 'Ctrl-I', mac: 'Cmd-I' },
      exec: () => openInlineChat(),
    });

    // Ctrl+.: quick fix at cursor
    editor.commands.addCommand({
      name: 'quickFix',
      bindKey: { win: 'Ctrl-.', mac: 'Cmd-.' },
      exec: () => {
        const c = editor.getCursorPosition();
        const path = getActivePath();
        const diags = (diagnosticsMap[path] || []).filter(d => d.row === c.row);
        const target = diags.find(d => c.column >= d.startCol && c.column <= d.endCol) || diags[0];
        if (!target) {
          bus.emit('toast:show', { message: 'No quick fixes available', type: 'info' });
          return;
        }
        const coords = editor.renderer.textToScreenCoordinates(target.row, target.startCol);
        showQuickFix(target, coords.pageX, coords.pageY);
      },
    });

    // Alt+F8: next problem
    editor.commands.addCommand({
      name: 'nextProblem',
      bindKey: { win: 'Alt-F8', mac: 'Alt-F8' },
      exec: () => {
        const all = [];
        for (const [p, ds] of Object.entries(diagnosticsMap)) {
          for (const d of ds) all.push({ ...d, path: p });
        }
        if (!all.length) {
          bus.emit('toast:show', { message: 'No problems found', type: 'info' });
          return;
        }
        const c = editor.getCursorPosition();
        const cur = getActivePath();
        const next = all.find(d => d.path === cur && d.row > c.row) ||
                     all.find(d => d.path !== cur) ||
                     all[0];
        if (next.path !== cur) {
          bus.emit('file:open', next.path);
        }
        editor.gotoLine(next.row + 1, next.startCol, true);
      },
    });
  }

  // ============================================================
  //  SYMBOL HOVER (VSCode-style type info on hover)
  // ============================================================
  let symbolHoverEl = null;
  let symbolHoverTimer = null;

  function initSymbolHover() {
    symbolHoverEl = document.createElement('div');
    symbolHoverEl.className = 'pp-symbol-hover';
    document.body.appendChild(symbolHoverEl);

    editor.container.addEventListener('mousemove', (e) => {
      clearTimeout(symbolHoverTimer);
      if (peekEl && peekEl.style.display !== 'none') return;

      symbolHoverTimer = setTimeout(() => {
        const tp = editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
        const session = editor.session;
        if (!session) return;
        const line = session.getLine(tp.row);
        if (!line) return;

        // Find word under cursor (also handles JSX tag names: <Button> → "Button")
        let word = null;
        // Standard word detection
        const wordRe = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
        let match;
        while ((match = wordRe.exec(line)) !== null) {
          if (tp.column >= match.index && tp.column <= match.index + match[0].length) {
            word = match[0]; break;
          }
        }
        // JSX tag detection: if inside < >, extract tag name
        if (!word) {
          const jsxMatch = line.match(/<\/?([A-Z][a-zA-Z0-9_]*)/g);
          if (jsxMatch) {
            for (const m of jsxMatch) {
              const tagName = m.replace(/^<\/?/, '');
              const idx = line.indexOf(m);
              const tagStart = idx + m.length - tagName.length;
              if (tp.column >= tagStart && tp.column <= tagStart + tagName.length) {
                word = tagName; break;
              }
            }
          }
        }

        // Skip keywords, very short words, and common tokens
        const KEYWORDS = new Set(['if','else','for','while','do','switch','case','break','continue','return','throw','try','catch','finally','new','delete','typeof','instanceof','void','in','of','let','const','var','function','class','import','export','default','from','as','async','await','yield','this','super','extends','implements','static','get','set','true','false','null','undefined']);
        if (!word || word.length < 2 || KEYWORDS.has(word)) { symbolHoverEl.style.display = 'none'; return; }

        const info = findSymbolInfo(session, word, tp.row);
        if (!info) { symbolHoverEl.style.display = 'none'; return; }

        // Build VSCode-style hover: signature block + doc block
        let html = `<div class="pp-symbol-hover-sig-block">${highlightSignature(info.signature)}</div>`;
        if (info.doc) {
          html += `<div class="pp-symbol-hover-doc-block">${renderJSDoc(info.doc)}</div>`;
        }
        symbolHoverEl.innerHTML = html;
        symbolHoverEl.style.display = 'block';
        const rect = symbolHoverEl.getBoundingClientRect();
        const left = Math.max(8, Math.min(e.clientX - 20, window.innerWidth - rect.width - 8));
        let top = e.clientY - rect.height - 8;
        if (top < 8) top = e.clientY + 20;
        symbolHoverEl.style.left = left + 'px';
        symbolHoverEl.style.top = top + 'px';
      }, 350);
    });

    editor.container.addEventListener('mouseleave', () => {
      clearTimeout(symbolHoverTimer);
      if (symbolHoverEl) symbolHoverEl.style.display = 'none';
    });
    editor.container.addEventListener('mousedown', () => {
      if (symbolHoverEl) symbolHoverEl.style.display = 'none';
    });
  }

  // Syntax-highlight a signature line (like VSCode's hover)
  function highlightSignature(sig) {
    // Tokenize the signature into spans with classes
    const KEYWORDS = /^(function|class|interface|type|const|let|var|async|await|export|default|return|extends|implements|import|from|new|enum|static|get|set|abstract|readonly|declare|namespace|module)$/;
    const TYPES = /^(string|number|boolean|void|any|never|null|undefined|object|unknown|bigint|symbol|Array|Promise|Record|Map|Set|Partial|Required|Readonly|Pick|Omit)$/;
    const tokens = sig.match(/[a-zA-Z_$][a-zA-Z0-9_$]*|'[^']*'|"[^"]*"|`[^`]*`|[{}()\[\]:;,=<>|&?.!]+|\s+|./g) || [sig];
    let html = '';
    let prevWasKeyword = false;
    for (const t of tokens) {
      if (/^\s+$/.test(t)) {
        html += t;
        continue;
      }
      if (KEYWORDS.test(t)) {
        html += `<span class="sh-keyword">${esc(t)}</span>`;
        prevWasKeyword = true;
        continue;
      }
      if (TYPES.test(t)) {
        html += `<span class="sh-type">${esc(t)}</span>`;
        prevWasKeyword = false;
        continue;
      }
      if (/^['"`]/.test(t)) {
        html += `<span class="sh-string">${esc(t)}</span>`;
        prevWasKeyword = false;
        continue;
      }
      if (/^[{}()\[\]:;,=<>|&?.!]+$/.test(t)) {
        html += `<span class="sh-punct">${esc(t)}</span>`;
        prevWasKeyword = false;
        continue;
      }
      // Identifier — color as function name if it follows a keyword like 'function', 'class', etc.
      if (/^[a-zA-Z_$]/.test(t)) {
        if (prevWasKeyword) {
          html += `<span class="sh-fn">${esc(t)}</span>`;
        } else {
          html += `<span class="sh-param">${esc(t)}</span>`;
        }
        prevWasKeyword = false;
        continue;
      }
      html += esc(t);
      prevWasKeyword = false;
    }
    return html;
  }

  // Render JSDoc comment as HTML (handles @param, @returns, @description, etc.)
  function renderJSDoc(raw) {
    const lines = raw.split('\n');
    let description = [];
    const params = [];
    let returns = null;
    let deprecated = false;
    let example = null;
    let current = 'desc';

    for (const line of lines) {
      const trimmed = line.trim();
      const paramMatch = trimmed.match(/^@param\s+\{([^}]*)\}\s+(\w+)\s*[-–—]?\s*(.*)/);
      if (paramMatch) {
        params.push({ type: paramMatch[1], name: paramMatch[2], desc: paramMatch[3] });
        current = 'param';
        continue;
      }
      const paramSimple = trimmed.match(/^@param\s+(\w+)\s*[-–—]?\s*(.*)/);
      if (paramSimple) {
        params.push({ type: null, name: paramSimple[1], desc: paramSimple[2] });
        current = 'param';
        continue;
      }
      const returnsMatch = trimmed.match(/^@returns?\s+\{([^}]*)\}\s*(.*)/);
      if (returnsMatch) {
        returns = { type: returnsMatch[1], desc: returnsMatch[2] };
        current = 'returns';
        continue;
      }
      const returnsSimple = trimmed.match(/^@returns?\s+(.*)/);
      if (returnsSimple) {
        returns = { type: null, desc: returnsSimple[1] };
        current = 'returns';
        continue;
      }
      if (trimmed.startsWith('@deprecated')) { deprecated = true; continue; }
      if (trimmed.startsWith('@example')) { example = ''; current = 'example'; continue; }
      if (trimmed.startsWith('@')) continue; // skip unknown tags

      if (current === 'example') { example += (example ? '\n' : '') + line; continue; }
      if (current === 'param' && params.length && trimmed && !trimmed.startsWith('@')) {
        params[params.length - 1].desc += ' ' + trimmed;
        continue;
      }
      if (trimmed) description.push(trimmed);
    }

    let html = '';
    if (deprecated) {
      html += '<p style="color:var(--warn,#e5a639);"><em>@deprecated</em></p>';
    }
    if (description.length) {
      html += `<p>${esc(description.join(' '))}</p>`;
    }
    if (params.length) {
      for (const p of params) {
        html += `<p><span class="sh-param-name">@param</span> `;
        if (p.type) html += `<code>${esc(p.type)}</code> `;
        html += `<span class="sh-param-name">${esc(p.name)}</span>`;
        if (p.desc) html += ` <span class="sh-param-desc">— ${esc(p.desc)}</span>`;
        html += '</p>';
      }
    }
    if (returns) {
      html += `<p><span class="sh-param-name">@returns</span> `;
      if (returns.type) html += `<code>${esc(returns.type)}</code> `;
      if (returns.desc) html += `<span class="sh-param-desc">${esc(returns.desc)}</span>`;
      html += '</p>';
    }
    if (example) {
      html += `<p><span class="sh-param-name">@example</span></p><pre style="margin:2px 0;padding:4px 6px;background:var(--bg);border-radius:2px;font-size:11px;overflow-x:auto;"><code>${esc(example.trim())}</code></pre>`;
    }
    return html || '<p style="color:var(--text-dim);">(no documentation)</p>';
  }

  function findSymbolInfo(session, word, hoverRow) {
    const totalLines = session.getLength();
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let bestMatch = null;
    let bestDistance = Infinity;

    for (let r = 0; r < totalLines; r++) {
      const line = session.getLine(r);
      let kind = null;

      // function foo(params): ReturnType
      if (new RegExp(`\\bfunction\\s+${escaped}\\s*[(<]`).test(line) ||
          new RegExp(`\\bfunction\\s+${escaped}\\s*$`).test(line)) {
        kind = 'function';
      }
      // const/let/var foo = ... (arrow, function, or value)
      else if (new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*[:=]`).test(line)) {
        // Distinguish: is it an arrow/function or a plain value?
        const isFunc = /=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)/.test(line);
        kind = isFunc ? 'function' : (line.includes('var ') ? 'var' : 'const');
      }
      // class Foo
      else if (new RegExp(`\\bclass\\s+${escaped}\\b`).test(line)) { kind = 'class'; }
      // interface Foo
      else if (new RegExp(`\\binterface\\s+${escaped}\\b`).test(line)) { kind = 'interface'; }
      // type Foo =
      else if (new RegExp(`\\btype\\s+${escaped}\\s*[=<]`).test(line)) { kind = 'type'; }
      // enum Foo
      else if (new RegExp(`\\benum\\s+${escaped}\\b`).test(line)) { kind = 'enum'; }
      // import { Foo } from '...'
      else if (new RegExp(`import\\s+.*\\b${escaped}\\b.*from\\s+['"]`).test(line)) {
        const importMatch = line.match(/from\s+['"]([^'"]+)['"]/);
        // For imports, try cross-file lookup (Tier 2)
        const fromPath = importMatch ? importMatch[1] : null;
        const crossFile = fromPath ? findCrossFileSymbol(session, word, fromPath) : null;
        if (crossFile) return crossFile;
        return { kind: 'import', signature: line.trim(), doc: null, row: r };
      }

      if (kind) {
        // Skip if hover is ON the declaration line itself (avoid self-reference)
        // But allow if hoverRow is undefined (called from outline etc.)
        if (hoverRow !== undefined && r === hoverRow) continue;

        // Pick the closest match to the hover row (nearest declaration wins for shadowing)
        const dist = hoverRow !== undefined ? Math.abs(r - hoverRow) : r;
        if (dist < bestDistance) {
          bestDistance = dist;
          bestMatch = { kind, row: r };
        }
      }
    }

    if (!bestMatch) {
      // Check if it's a parameter: scan the line containing hoverRow for (paramName: Type)
      if (hoverRow !== undefined) {
        return findParameterInfo(session, word, hoverRow);
      }
      return null;
    }

    const sig = collectSignature(session, bestMatch.row);
    const doc = getDocComment(session, bestMatch.row);
    return { kind: bestMatch.kind, signature: sig, doc, row: bestMatch.row };
  }

  // Find parameter info — when hovering a function parameter
  function findParameterInfo(session, word, hoverRow) {
    // Walk upward to find the function declaration this parameter belongs to
    for (let r = hoverRow; r >= Math.max(0, hoverRow - 20); r--) {
      const line = session.getLine(r);
      const funcMatch = line.match(/(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\())/);
      if (funcMatch) {
        // Collect the full signature to find the param
        const sig = collectSignature(session, r);
        // Check if our word appears as a parameter
        const paramRe = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:,)\\s]`);
        if (paramRe.test(sig)) {
          // Extract the param's type annotation if present
          const typeMatch = sig.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^,)]+)`));
          const typeStr = typeMatch ? typeMatch[1].trim() : 'any';
          return {
            kind: 'parameter',
            signature: `(parameter) ${word}: ${typeStr}`,
            doc: null,
            row: r,
          };
        }
      }
    }
    return null;
  }

  // Cross-file symbol lookup (Tier 2) — resolve import and search the target file
  function findCrossFileSymbol(session, word, fromPath) {
    if (!fromPath || !fromPath.startsWith('.')) return null;
    const api = window.electronAPI;
    if (!api?.files?.read) return null;
    const activePath = getActivePath();
    if (!activePath) return null;

    // Resolve the import path
    const dir = activePath.substring(0, activePath.lastIndexOf('/'));
    const sep = activePath.includes('\\') ? '\\' : '/';
    const parts = (dir + '/' + fromPath).replace(/\\/g, '/').split('/');
    const stack = [];
    for (const p of parts) { if (!p || p === '.') continue; if (p === '..') stack.pop(); else stack.push(p); }
    const basePath = stack.join(sep);

    // Try extensions
    const candidates = [basePath, basePath + '.ts', basePath + '.tsx', basePath + '.js', basePath + '.jsx',
                        basePath + sep + 'index.ts', basePath + sep + 'index.tsx', basePath + sep + 'index.js'];

    // This is async but we need sync result — use a cached approach
    // For now, just indicate it's imported (full cross-file will be async Tier 2+)
    return null; // TODO: async cross-file lookup
  }

  // Collect full signature (may span multiple lines for long param lists)
  function collectSignature(session, startRow) {
    let sig = session.getLine(startRow).trim();
    // Remove trailing { and everything after
    sig = sig.replace(/\{[\s\S]*$/, '').trim();
    // If line ends with ( or , it continues — grab next lines
    let r = startRow;
    let parens = 0;
    for (let i = 0; i < sig.length; i++) {
      if (sig[i] === '(') parens++;
      if (sig[i] === ')') parens--;
    }
    while (parens > 0 && r < startRow + 6 && r < session.getLength() - 1) {
      r++;
      const nextLine = session.getLine(r).trim().replace(/\{[\s\S]*$/, '').trim();
      sig += ' ' + nextLine;
      for (let i = 0; i < nextLine.length; i++) {
        if (nextLine[i] === '(') parens++;
        if (nextLine[i] === ')') parens--;
      }
    }
    return sig.replace(/\s+/g, ' ').trim();
  }

  function getDocComment(session, row) {
    if (row <= 0) return null;
    // Look backwards for /** ... */ or // comment
    let r = row - 1;
    let endLine = session.getLine(r).trim();

    // Skip blank lines
    while (r >= 0 && !endLine) {
      r--;
      endLine = session.getLine(r).trim();
    }
    if (r < 0) return null;

    // Multi-line JSDoc: /** ... */
    if (endLine.endsWith('*/')) {
      const lines = [];
      for (; r >= Math.max(0, row - 20); r--) {
        const l = session.getLine(r).trim();
        lines.unshift(l);
        if (l.startsWith('/**') || l.startsWith('/*')) break;
      }
      const raw = lines.join('\n')
        .replace(/^\/\*\*?\s*/, '')
        .replace(/\*\/\s*$/, '')
        .replace(/^\s*\*\s?/gm, '')
        .trim();
      return raw || null;
    }

    // Single-line // comments (collect consecutive)
    if (endLine.startsWith('//')) {
      const lines = [];
      for (; r >= 0; r--) {
        const l = session.getLine(r).trim();
        if (l.startsWith('//')) {
          lines.unshift(l.replace(/^\/\/\s?/, ''));
        } else break;
      }
      return lines.join('\n').trim() || null;
    }

    return null;
  }

  // ============================================================
  //  SYMBOL OUTLINE (VSCode-style sidebar panel)
  // ============================================================
  function parseSymbols(session) {
    const symbols = [];
    const totalLines = session.getLength();
    for (let r = 0; r < totalLines; r++) {
      const line = session.getLine(r);

      // function foo(...)
      const funcMatch = line.match(/^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        symbols.push({ name: funcMatch[1], kind: 'function', icon: 'ƒ', row: r, col: line.indexOf(funcMatch[1]) });
        continue;
      }

      // const foo = (...) => / const foo = function
      const arrowMatch = line.match(/^\s*(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)/);
      if (arrowMatch) {
        symbols.push({ name: arrowMatch[1], kind: 'function', icon: 'ƒ', row: r, col: line.indexOf(arrowMatch[1]) });
        continue;
      }

      // class Foo
      const classMatch = line.match(/^\s*(?:export\s+(?:default\s+)?)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: 'class', icon: 'C', row: r, col: line.indexOf(classMatch[1]) });
        continue;
      }

      // interface Foo
      const ifaceMatch = line.match(/^\s*(?:export\s+)?interface\s+(\w+)/);
      if (ifaceMatch) {
        symbols.push({ name: ifaceMatch[1], kind: 'interface', icon: 'I', row: r, col: line.indexOf(ifaceMatch[1]) });
        continue;
      }

      // type Foo =
      const typeMatch = line.match(/^\s*(?:export\s+)?type\s+(\w+)\s*=/);
      if (typeMatch) {
        symbols.push({ name: typeMatch[1], kind: 'type', icon: 'T', row: r, col: line.indexOf(typeMatch[1]) });
        continue;
      }

      // method: foo(...) { inside class
      const methodMatch = line.match(/^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
      if (methodMatch && methodMatch[1] !== 'if' && methodMatch[1] !== 'for' && methodMatch[1] !== 'while' && methodMatch[1] !== 'switch' && methodMatch[1] !== 'catch') {
        symbols.push({ name: methodMatch[1], kind: 'method', icon: 'm', row: r, col: line.indexOf(methodMatch[1]) });
        continue;
      }

      // export default
      const exportDefault = line.match(/^\s*export\s+default\s+(\w+)/);
      if (exportDefault && !funcMatch && !classMatch) {
        symbols.push({ name: exportDefault[1], kind: 'export', icon: '→', row: r, col: line.indexOf(exportDefault[1]) });
        continue;
      }
    }
    return symbols;
  }

  function renderOutlinePanel(container) {
    if (!editor || !container) return;
    const session = editor.session;
    if (!session) { container.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:11px;">No file open</div>'; return; }
    const symbols = parseSymbols(session);
    if (!symbols.length) {
      container.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:11px;">No symbols found</div>';
      return;
    }

    const ICON_COLORS = {
      'function': 'var(--accent, #FF6B35)',
      'class': 'var(--info, #6cb6ff)',
      'interface': 'var(--info, #6cb6ff)',
      'type': 'var(--warn, #e5a639)',
      'method': 'var(--ok, #56d364)',
      'export': 'var(--accent, #FF6B35)',
    };

    container.innerHTML = '';
    symbols.forEach(s => {
      const row = document.createElement('div');
      row.className = 'outline-row';
      row.innerHTML = `
        <span class="outline-icon" style="color:${ICON_COLORS[s.kind] || 'var(--text-dim)'}">${esc(s.icon)}</span>
        <span class="outline-name">${esc(s.name)}</span>
        <span class="outline-kind">${esc(s.kind)}</span>
        <span class="outline-line">${s.row + 1}</span>
      `;
      row.addEventListener('click', () => {
        editor.gotoLine(s.row + 1, s.col, true);
        editor.focus();
      });
      container.appendChild(row);
    });
  }

  // ============================================================
  //  BOOT
  // ============================================================
  // ============================================================
  //  FLOATING SELECTION ACTIONS (shown when user selects code)
  // ============================================================
  let selActionsEl = null;
  let selActionsHideTimer = null;

  function initSelectionActions() {
    selActionsEl = document.createElement('div');
    selActionsEl.className = 'pp-sel-actions';
    document.body.appendChild(selActionsEl);

    const CHAT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const SPARKLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';
    const WAND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 4-1 1M9 20l-1 1M2 12h2M20 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M12 2v2M12 20v2M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/><line x1="9" y1="15" x2="15" y2="9"/></svg>';

    selActionsEl.innerHTML = `
      <button class="pp-sel-btn" data-action="chat" title="Add selection to Chat">${CHAT_ICON}<span>Add to Chat</span></button>
      <div class="pp-sel-sep"></div>
      <button class="pp-sel-btn" data-action="inline" title="Open Inline Chat (Ctrl+I)">${SPARKLE_ICON}<span>Inline Chat</span></button>
      <div class="pp-sel-sep"></div>
      <button class="pp-sel-btn accent" data-action="enhance" title="Enhance this code with AI">${WAND_ICON}<span>Enhance</span></button>
    `;

    // Wire button clicks — use mousedown (not click) to fire BEFORE
    // the editor's mousedown clears the selection
    selActionsEl.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent editor from stealing focus / clearing selection
      e.stopPropagation();
      const btn = e.target.closest('.pp-sel-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      // Capture selection text NOW before anything clears it
      const selText = editor.getSelectedText();
      const selRange = editor.getSelectionRange();
      hideSelActions();
      if (action === 'chat') {
        addToChat();
      } else if (action === 'inline') {
        openInlineChat();
      } else if (action === 'enhance') {
        if (!selText) return;
        openInlineChat({ prefillPrompt: 'Enhance and improve this code — make it cleaner, more efficient, and follow best practices', autoSend: true });
      }
    });

    // Show on mouseup after selection (most reliable trigger)
    editor.container.addEventListener('mouseup', () => {
      clearTimeout(selActionsHideTimer);
      selActionsHideTimer = setTimeout(() => {
        const sel = editor.getSelectionRange();
        if (!sel.isEmpty()) showSelActions();
      }, 150);
    });

    // Also show on keyboard selection (shift+arrow)
    editor.selection.on('changeSelection', () => {
      clearTimeout(selActionsHideTimer);
      selActionsHideTimer = setTimeout(() => {
        const sel = editor.getSelectionRange();
        if (sel.isEmpty()) hideSelActions();
        else showSelActions();
      }, 300);
    });

    // Hide on click (new cursor position clears selection)
    editor.container.addEventListener('mousedown', (e) => {
      if (selActionsEl.contains(e.target)) return; // clicking the bar itself
      hideSelActions();
    });

    // Hide on blur, escape, typing
    editor.on('blur', () => hideSelActions());
    editor.session.on('change', () => hideSelActions());
    editor.on('changeSession', () => hideSelActions());
  }

  function showSelActions() {
    if (!selActionsEl || !editor) return;
    const sel = editor.getSelectionRange();
    if (sel.isEmpty()) return;

    // Position above the end of the selection
    const endPos = editor.renderer.textToScreenCoordinates(sel.end.row, sel.end.column);
    const editorRect = editor.container.getBoundingClientRect();

    selActionsEl.classList.add('visible');
    const barRect = selActionsEl.getBoundingClientRect();
    let left = endPos.pageX - barRect.width / 2;
    let top = endPos.pageY - barRect.height - 8;

    // Clamp to viewport
    left = Math.max(editorRect.left + 4, Math.min(left, editorRect.right - barRect.width - 4));
    if (top < editorRect.top) top = endPos.pageY + 20; // below if no room above

    selActionsEl.style.left = left + 'px';
    selActionsEl.style.top = top + 'px';
  }

  function hideSelActions() {
    if (selActionsEl) selActionsEl.classList.remove('visible');
  }

  function init(ed) {
    editor = ed;
    injectStyles();
    initGhostText();
    initHoverPeek();
    initSymbolHover();
    initSelectionActions();
    initQuickFix();
    initContextMenu();
    initGoToDefinition();
    registerKeybindings();

    // Update outline when file changes
    let outlineTimer = null;
    function scheduleOutline() {
      clearTimeout(outlineTimer);
      outlineTimer = setTimeout(() => {
        const container = document.getElementById('outline-panel-content');
        if (container) renderOutlinePanel(container);
      }, 500);
    }
    editor.on('changeSession', scheduleOutline);
    editor.session.on('change', scheduleOutline);
    editor.on('changeSession', (e) => {
      if (e.session) e.session.on('change', scheduleOutline);
    });

    // Initial outline render
    setTimeout(scheduleOutline, 100);

    console.log('[ace-ai] AI integrations initialized');
  }

  // Listen for Ace editor ready
  bus.on('ace:ready', (ed) => {
    if (editor) return; // already initialized
    init(ed);
  });

  // Listen for diagnostics updates from ace-editor.js
  bus.on('ace:diagnostics-updated', (map) => {
    diagnosticsMap = map || {};
  });

  // Export public API
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.editorAi = {
    addToChat: () => addToChat(),
    openInlineChat: (opts) => openInlineChat(opts),
    closeInlineChat: () => closeInlineChat(),
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
    renderOutline: (container) => renderOutlinePanel(container),
    parseSymbols: () => editor ? parseSymbols(editor.session) : [],
  };

  // Global event bridge for inline chat (from other UI components)
  window.addEventListener('pipilot:inline-chat', (e) => {
    const detail = (e && e.detail) || {};
    if (!editor) return;
    openInlineChat({ row: detail.row, prefillPrompt: detail.prompt || '' });
  });

  // Expose ghost mutation flag so editor dirty tracking can ignore spacer changes
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.isGhostMutating = () => ghostMutating;
})();
