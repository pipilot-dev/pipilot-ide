// PiPilot IDE — AI Chat panel (Phase 4 renderer)
// Streams Claude Agent SDK events via electronAPI.agent.send.

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;
  const chatDB = window.PiPilot.chatDB;

  let markedReady = false;
  let markedLoading = null;
  function loadMarked() {
    if (markedReady || window.marked) { markedReady = true; return Promise.resolve(); }
    if (markedLoading) return markedLoading;
    markedLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
      s.onload = () => {
        if (window.marked && window.marked.setOptions) {
          window.marked.setOptions({ breaks: true, gfm: true });
        }
        markedReady = true;
        // Also load Mermaid for diagram rendering
        if (!window.mermaid) {
          const m = document.createElement('script');
          m.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
          m.onload = () => {
            if (window.mermaid) window.mermaid.initialize({ startOnLoad: false, theme: 'dark' });
          };
          document.head.appendChild(m);
        }
        resolve();
      };
      s.onerror = () => { markedReady = false; resolve(); };
      document.head.appendChild(s);
    });
    return markedLoading;
  }

  function injectStyles() {
    if (document.getElementById('chat-inline-styles')) return;
    const css = `
.chat-auth-banner {
  display: flex; align-items: center; gap: 12px;
  margin: 10px 12px 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  color: var(--text);
  font-size: 12px;
}
.chat-auth-banner-icon {
  width: 30px; height: 30px; flex-shrink: 0;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  display: grid; place-items: center; color: var(--text-strong);
}
.chat-auth-banner-text {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
}
.chat-auth-banner-text strong { font-size: 12px; color: var(--text-strong); font-weight: 600; }
.chat-auth-banner-text span { font-size: 11px; color: var(--text-mid); line-height: 1.4; }
.chat-auth-banner-btn {
  padding: 6px 12px; border-radius: 5px;
  background: var(--text-strong); color: var(--bg);
  border: 0; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
  transition: background 100ms;
}
.chat-auth-banner-btn:hover { background: white; }

.msg { margin: 0 14px 20px; display: flex; gap: 8px; animation: fadeInMsg 0.3s ease-out; }
@keyframes fadeInMsg { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.msg-user { flex-direction: row; align-items: flex-start; }
.msg-user .msg-avatar {
  width: 14px; padding-top: 4px; color: var(--text-mid); flex-shrink: 0; display: flex; justify-content: center;
}
.msg-user .msg-content { flex: 1; min-width: 0; }
.msg-user .msg-bubble {
  padding: 10px 14px; background: var(--surface);
  border: 1px solid var(--border); border-left: 2px solid var(--accent);
  border-radius: 4px; color: var(--text); font-size: var(--fs-sm);
  white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;
  max-width: 100%; overflow: hidden;
}
.msg-user .msg-bubble.truncated { cursor: pointer; }
.msg-user .msg-bubble .show-more-link {
  color: var(--accent); font-size: 10px; cursor: pointer; margin-left: 4px;
  font-family: var(--font-mono); letter-spacing: 0.04em;
}
.msg-user .msg-time {
  font-size: 9px; color: var(--text-dim); font-family: var(--font-mono);
  letter-spacing: 0.05em; margin-top: 4px; padding-left: 2px;
}
.msg-assistant { flex-direction: row; align-items: flex-start; }
.msg-assistant .msg-avatar {
  width: 14px; padding-top: 4px; color: var(--accent); flex-shrink: 0; display: flex; justify-content: center;
}
.msg-assistant .msg-body-wrap { flex: 1; min-width: 0; }
.msg-assistant .md-body { font-size: var(--fs-sm); color: var(--text); line-height: 1.6; }
.md-body p { margin: 0 0 8px; }
.md-body p:last-child { margin-bottom: 0; }
.md-body h1, .md-body h2, .md-body h3 { color: var(--text-strong); margin: 14px 0 6px; font-weight: 600; }
.md-body h1 { font-size: var(--fs-lg); }
.md-body h2 { font-size: var(--fs-md); }
.md-body h3 { font-size: var(--fs-base); }
.md-body ul, .md-body ol { margin: 0 0 8px 20px; }
.md-body li { margin: 2px 0; }
.md-body a { color: var(--info); }
.md-body code:not(pre code) {
  background: var(--surface-alt); padding: 1px 5px; border-radius: 3px;
  font-family: var(--font-mono); font-size: 12px; color: var(--accent-light);
}
.md-body pre {
  background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 10px 12px; margin: 8px 0;
  overflow-x: auto; position: relative;
}
.md-body pre code { font-family: var(--font-mono); font-size: 12px; color: var(--text-strong); }
.md-body pre .copy-code-btn {
  position: absolute; top: 4px; right: 4px; padding: 3px 8px; font-size: 10px;
  background: var(--surface-raised); color: var(--text-mid); border: 1px solid var(--border);
  border-radius: 3px; cursor: pointer; opacity: 0; transition: opacity var(--t);
}
.md-body pre:hover .copy-code-btn { opacity: 1; }
.md-body pre .copy-code-btn:hover { color: var(--accent); border-color: var(--accent); }
.md-body blockquote {
  border-left: 3px solid var(--border); padding-left: 10px; color: var(--text-mid); margin: 6px 0;
}
/* Tables — wrapped in scroll container to prevent horizontal overflow */
.md-body table { border-collapse: collapse; margin: 6px 0; font-size: 12px; width: max-content; min-width: 100%; }
.md-body th, .md-body td { border: 1px solid var(--border); padding: 4px 8px; white-space: nowrap; }
.md-body th { background: var(--surface-alt); font-weight: 600; }
.md-body td { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: normal; word-break: break-word; }

/* Images — constrained to max 1024px, wrapped in scroll container if wider than message */
.md-body img {
  max-width: min(1024px, 100%); max-height: 1024px;
  height: auto; border-radius: 4px; display: block; margin: 6px 0;
  cursor: pointer;
}

/* Scroll wrappers for overflowing content */
.md-table-wrap {
  overflow-x: auto; margin: 6px 0;
  border: 1px solid var(--border); border-radius: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) var(--scrollbar-track-bg);
  color-scheme: dark;
}
.md-table-wrap::-webkit-scrollbar,
.md-img-wrap::-webkit-scrollbar,
.md-body pre::-webkit-scrollbar,
.mermaid-container::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}
.md-table-wrap::-webkit-scrollbar-track,
.md-img-wrap::-webkit-scrollbar-track,
.md-body pre::-webkit-scrollbar-track,
.mermaid-container::-webkit-scrollbar-track {
  background: var(--scrollbar-track-bg);
}
.md-table-wrap::-webkit-scrollbar-thumb,
.md-img-wrap::-webkit-scrollbar-thumb,
.md-body pre::-webkit-scrollbar-thumb,
.mermaid-container::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 5px;
}
.md-table-wrap::-webkit-scrollbar-thumb:hover,
.md-img-wrap::-webkit-scrollbar-thumb:hover,
.md-body pre::-webkit-scrollbar-thumb:hover,
.mermaid-container::-webkit-scrollbar-thumb:hover {
  background: var(--border-hover);
}
.md-table-wrap::-webkit-scrollbar-corner,
.md-img-wrap::-webkit-scrollbar-corner,
.md-body pre::-webkit-scrollbar-corner,
.mermaid-container::-webkit-scrollbar-corner {
  background: var(--scrollbar-track-bg);
}
.md-table-wrap table { margin: 0; border: none; }
.md-table-wrap th:first-child, .md-table-wrap td:first-child { border-left: none; }
.md-table-wrap th:last-child, .md-table-wrap td:last-child { border-right: none; }
.md-table-wrap tr:first-child th { border-top: none; }
.md-table-wrap tr:last-child td { border-bottom: none; }

.md-img-wrap {
  overflow-x: auto; margin: 6px 0; max-width: 100%;
  scrollbar-width: thin;
  scrollbar-color: var(--border) var(--scrollbar-track-bg);
  color-scheme: dark;
}
.md-img-wrap img { margin: 0; }

/* Mermaid diagrams */
.mermaid-container {
  margin: 8px 0; padding: 12px; background: var(--surface-alt);
  border: 1px solid var(--border); border-radius: 4px;
  overflow-x: auto; text-align: center;
  scrollbar-color: var(--border) var(--scrollbar-track-bg);
  color-scheme: dark;
}
.mermaid-container svg { max-width: 100%; height: auto; }

.md-body pre {
  scrollbar-color: var(--border) var(--scrollbar-track-bg);
  color-scheme: dark;
}

/* Safe region — prevent content from overflowing message container */
.msg-body-wrap, .msg-content { overflow: hidden; }
.md-body { overflow-wrap: break-word; word-break: break-word; overflow: hidden; }

/* ── Tool Pill (matches Vite ToolCallCard exactly) ───────────────────── */
.tool-pill {
  overflow: hidden; margin: 6px 0;
  background: transparent; border: 1px solid var(--border);
  border-radius: 4px; transition: border-color 0.2s ease;
}
.tool-pill:hover { background: rgba(16,16,21,0.5); }
.tool-pill.running { border-color: var(--accent-line, rgba(255,107,53,0.25)); }
.tool-pill.error { border-color: rgba(229,83,75,0.35); }
.tool-pill.expanded { display: flex; flex-direction: column; }

/* ── Bash description sits ABOVE the head row ── */
.tool-pill-bash-desc {
  padding: 4px 10px 0; font-size: 10px; color: var(--text-mid);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Head row: [status] [icon] LABEL / summary ... [chevron] ── */
.tool-pill-head {
  display: flex; align-items: center; gap: 2px;
  padding: 6px 10px;
  font-family: var(--font-mono); font-size: 10px;
  border: none; background: transparent; width: 100%; cursor: pointer;
  transition: background 0.15s; text-align: left;
}
/* Reduced top padding when bash description is present */
.tool-pill-bash-desc + .tool-pill-head { padding-top: 3px; padding-bottom: 6px; }
.tool-pill.expanded .tool-pill-head { border-bottom: 1px solid var(--border); }
.tool-pill-head:hover { background: rgba(16,16,21,0.5); }

/* Status icon */
.tool-pill-status {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; flex-shrink: 0; margin-right: 2px;
}
.tool-pill-status.running { color: var(--info, #6cb6ff); }
.tool-pill-status.running svg { animation: tool-spin 1s linear infinite; }
@keyframes tool-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.tool-pill-status.success { color: var(--ok); }
.tool-pill-status.error { color: var(--error); }
.tool-pill-status.mcp { color: var(--info); }

/* Tool icon */
.tool-pill-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; flex-shrink: 0; color: var(--text-dim);
  margin-right: 2px;
}
.tool-pill-icon svg { width: 12px; height: 12px; }

/* Tool label (uppercase) */
.tool-pill-label {
  color: var(--text-mid); font-weight: 500; font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.08em; flex-shrink: 0;
  margin-right: 2px;
}

/* Separator slash */
.tool-pill-sep {
  color: var(--text-faint); flex-shrink: 0; font-size: 10px;
  margin: 0 2px;
}

/* Summary (accent color, truncated to fill remaining space) */
.tool-pill-summary {
  color: var(--accent); font-family: var(--font-mono); font-size: 10px;
  font-weight: 400; letter-spacing: 0.02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}
/* Deep link: clickable file path in tool pill */
.tool-pill-deeplink {
  cursor: pointer;
  border-bottom: 1px dotted rgba(255,107,53,0.3);
  transition: color 0.15s, border-bottom-color 0.15s;
}
.tool-pill-deeplink:hover {
  border-bottom-color: var(--accent);
  text-decoration: none;
}

/* Chevron */
.tool-pill-chevron {
  color: var(--text-faint); margin-left: auto; flex-shrink: 0;
}
.tool-pill.expanded .tool-pill-chevron { transform: rotate(90deg); }

/* Skip button */
.tool-pill-skip {
  margin-left: auto; flex-shrink: 0; padding: 1px 6px;
  font-size: 8px; font-family: var(--font-mono); font-weight: 700;
  color: var(--warn); background: rgba(229,166,57,0.12);
  border: 1px solid rgba(229,166,57,0.25); border-radius: 3px;
  cursor: pointer; letter-spacing: 0.06em; text-transform: uppercase;
}
.tool-pill-skip:hover { background: rgba(229,166,57,0.2); }

/* Elapsed time chip */
.tool-pill-elapsed {
  color: var(--text-dim); font-size: 9px; font-family: var(--font-mono);
  flex-shrink: 0; margin: 0 4px;
}

/* ── Expanded body ── */
.tool-pill-body {
  padding: 10px 12px; background: rgba(16,16,21,0.5);
  border-top: 1px solid var(--border);
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-mid);
}
.tool-pill-sec { margin-bottom: 10px; }
.tool-pill-sec-label {
  font-family: var(--font-sans); font-size: 9px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-faint); margin-bottom: 6px;
}
.tool-pill-pre {
  margin: 0; padding: 10px; border-radius: 4px;
  background: var(--bg); border: 1px solid var(--border);
  font-family: var(--font-mono); font-size: 11px; line-height: 1.6;
  overflow-x: auto; white-space: pre-wrap; word-break: break-word;
  max-height: 240px; overflow-y: auto; color: var(--text-mid);
}
.tool-pill-result-wrap {
  max-height: 200px; overflow-y: auto;
}
.tool-pill-body .section-label {
  color: var(--text-faint); font-size: 9px; text-transform: uppercase;
  letter-spacing: 0.08em; margin-bottom: 4px; font-family: var(--font-sans); font-weight: 500;
}
.tool-pill-body .result-ok { color: var(--text-mid); }
.tool-pill-body .result-err { color: var(--error); }

/* MCP tool accent */
.tool-pill.kind-mcp { border-color: rgba(108,182,255,0.25); }
.tool-pill.kind-mcp .tool-pill-icon { color: var(--info); }

.thinking-card {
  margin: 6px 0; padding: 6px 10px; background: rgba(138,138,148,0.08);
  border-left: 2px solid var(--text-faint); color: var(--text-mid);
  font-style: italic; font-size: 12px; border-radius: 3px; white-space: pre-wrap;
}

.error-box {
  margin: 8px 0; padding: 8px 12px; background: rgba(229,83,75,0.1);
  border-left: 2px solid var(--error); color: var(--error);
  border-radius: 3px; font-size: 12px;
}

.msg-footer {
  font-size: 10px; color: var(--text-dim); margin-top: 6px;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
}
.msg-footer .footer-sep { color: var(--text-faint); margin: 0 2px; }
.msg-footer .footer-subtype {
  font-weight: 500; letter-spacing: 0.4px; text-transform: uppercase;
  padding: 1px 6px; border-radius: 3px; font-size: 9px;
}
.msg-footer .footer-ok { background: rgba(86,211,100,0.12); color: var(--ok); }
.msg-footer .footer-err { background: rgba(229,83,75,0.15); color: var(--error); }
.msg-footer .footer-warn { background: rgba(229,166,57,0.15); color: var(--warn); }

.boundary {
  display: flex; align-items: center; gap: 10px; margin: 14px 0; color: var(--text-faint);
}
.boundary-line { flex: 1; height: 1px; background: var(--border); }
.boundary-label {
  font-size: 10px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--text-dim);
}

/* ── @ Attach Menu (Vite-style editorial) ────────────────────────────── */
.at-menu {
  margin: 0 10px 4px; overflow: hidden;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 4px; box-shadow: 0 -8px 32px rgba(0,0,0,0.6);
  max-height: 320px; display: flex; flex-direction: column; z-index: 10000;
}
.at-menu-header {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-bottom: 1px solid var(--border);
  background: var(--surface-alt); flex-shrink: 0;
}
.at-menu-header .at-icon { color: var(--accent); display: flex; }
.at-menu-header .at-label {
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent);
}
.at-menu-header .at-sublabel {
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-dim);
}
.at-menu-header .at-count {
  margin-left: auto; font-family: var(--font-mono); font-size: 9px;
  color: var(--text-faint); letter-spacing: 0.05em;
}
.at-menu-search {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.at-menu-search svg { color: var(--text-dim); flex-shrink: 0; }
.at-menu-search input {
  flex: 1; background: transparent; border: none; outline: none;
  font-family: var(--font-mono); font-size: 12px; color: var(--text);
  caret-color: var(--accent); letter-spacing: 0.01em;
}
.at-menu-search .at-clear {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; background: transparent; border: none;
  color: var(--text-dim); cursor: pointer; border-radius: 2px;
}
.at-menu-search .at-clear:hover { color: var(--text); }
.at-menu-search kbd {
  padding: 2px 6px; font-family: var(--font-mono); font-size: 9px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 2px;
  color: var(--text-dim); flex-shrink: 0;
}
.at-menu-list { flex: 1; overflow-y: auto; padding: 4px 0; min-height: 0; }
.at-menu-empty {
  padding: 24px 16px; text-align: center; font-family: var(--font-mono);
  font-size: 10px; color: var(--text-dim);
}
.at-menu-empty .at-empty-label {
  font-size: 9px; letter-spacing: 0.18em; color: var(--text-faint); margin-bottom: 6px;
}
.at-menu-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 14px;
  background: transparent; border: none; border-left: 2px solid transparent;
  cursor: pointer; font-family: var(--font-mono); font-size: 11px;
  color: var(--text-mid); width: 100%; text-align: left; transition: background 0.1s;
}
.at-menu-item:hover, .at-menu-item.selected {
  background: var(--surface-alt); border-left-color: var(--accent);
}
.at-menu-item.selected { color: var(--text); }
.at-menu-item.selected .at-file-icon { color: var(--accent); }
.at-menu-item.attached { opacity: 0.5; cursor: not-allowed; }
.at-file-icon { color: var(--text-dim); flex-shrink: 0; display: flex; }
.at-file-path {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-family: var(--font-mono); font-size: 10px;
}
.at-file-lines {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); flex-shrink: 0;
  display: flex; align-items: center; gap: 3px;
}
.at-file-lines.over-limit { color: var(--warn); }
.at-attached-badge {
  font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--accent); padding: 1px 6px;
  border: 1px solid rgba(255,107,53,0.25); border-radius: 2px; flex-shrink: 0;
}
.at-menu-footer {
  display: flex; align-items: center; gap: 14px;
  padding: 8px 14px; border-top: 1px solid var(--border);
  background: var(--surface-alt); font-family: var(--font-mono);
  font-size: 9px; color: var(--text-dim); letter-spacing: 0.05em;
  text-transform: uppercase; flex-shrink: 0;
}
.at-menu-footer kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; padding: 1px 5px; background: var(--bg);
  border: 1px solid var(--border); border-radius: 2px;
  font-family: var(--font-mono); font-size: 9px; color: var(--text-mid);
}

.attachment-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  background: var(--surface-raised); border: 1px solid var(--border);
  border-radius: 12px; font-size: 11px; color: var(--text); margin: 2px 4px 2px 0;
}
.attachment-chip .x { cursor: pointer; color: var(--text-dim); }
.attachment-chip .x:hover { color: var(--error); }

/* ── Todo Panel ──────────────────────────────────────────────────────── */
.chat-todo-panel {
  border-top: 1px solid var(--border); background: var(--surface);
  max-height: 180px; overflow-y: auto; flex-shrink: 0;
}
.chat-todo-panel.collapsed { max-height: 44px; overflow: hidden; }
.chat-todo-panel.collapsed .chat-todo-list { display: none; }
.chat-todo-header {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid var(--border); cursor: pointer; user-select: none;
}
.chat-todo-header .todo-chevron {
  margin-left: 6px; color: var(--text-faint); font-size: 10px;
  transition: transform var(--t);
}
.chat-todo-panel.collapsed .chat-todo-header .todo-chevron { transform: rotate(-90deg); }
.chat-todo-header .todo-label {
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent);
}
.chat-todo-header .todo-count {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-dim);
  margin-left: auto;
}
.chat-todo-list { padding: 4px 0; }
.chat-todo-item {
  display: flex; align-items: center; gap: 8px; padding: 5px 12px;
  font-size: 11px; color: var(--text-mid);
}
.chat-todo-item .todo-status {
  width: 12px; height: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
}
.chat-todo-item.completed { color: var(--text-dim); text-decoration: line-through; }
.chat-todo-item.in_progress { color: var(--accent); }
.chat-todo-item .todo-spinner { animation: tool-spin 1s linear infinite; }

/* ── Queue Panel ─────────────────────────────────────────────────────── */
.chat-queue-panel {
  border-top: 1px solid var(--border); background: var(--surface); flex-shrink: 0;
}
.chat-queue-panel.collapsed { max-height: 44px; overflow: hidden; }
.chat-queue-panel.collapsed .chat-queue-item { display: none; }
.chat-queue-header {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.chat-queue-header.clickable { cursor: pointer; user-select: none; }
.chat-queue-header .queue-chevron {
  font-size: 10px; color: var(--text-dim); transition: transform 0.15s;
}
.chat-queue-header .queue-count {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-dim);
}
.chat-queue-header .queue-clear:hover { color: var(--error); }
.chat-queue-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  font-size: 11px; color: var(--text-mid); border-bottom: 1px solid var(--border);
}
.chat-queue-item:first-child { color: var(--accent); }
.chat-queue-item .queue-text {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.chat-queue-item .queue-remove {
  flex-shrink: 0; cursor: pointer; color: var(--text-dim); background: none; border: none; font-size: 14px;
}
.chat-queue-item .queue-remove:hover { color: var(--error); }
.tool-pill-body .section-label {
  color: var(--text-faint); font-size: 9px; text-transform: uppercase;
  letter-spacing: 0.08em; margin-bottom: 4px; font-family: var(--font-sans); font-weight: 500;
}
/* ── Ask Question Dialog ─────────────────────────────────────────────── */
.chat-ask-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; z-index: 10000;
  animation: askFadeIn 0.2s ease-out;
}
@keyframes askFadeIn { from { opacity: 0; } to { opacity: 1; } }
.tool-pill-sec { margin-bottom: 10px; }
.tool-pill-sec-label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-bottom: 6px;
}
.tool-pill-pre {
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.6;
  overflow-x: auto;
  color: var(--text-mid);
}
.chat-ask-dialog {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  width: 420px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
  animation: askSlideIn 0.2s ease-out;
}
@keyframes askSlideIn { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
.chat-ask-header {
  padding: 16px 16px 12px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px;
}
.chat-ask-header .ask-label {
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent);
}
.chat-ask-body { padding: 16px; }
.chat-ask-question { margin-bottom: 16px; }
.chat-ask-question .ask-q-text {
  font-size: 13px; color: var(--text-strong); margin-bottom: 10px; line-height: 1.5;
}
.chat-ask-option {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 4px; margin-bottom: 4px;
  cursor: pointer; font-size: 12px; color: var(--text); transition: border-color 0.15s;
}
.chat-ask-option:hover { border-color: var(--accent); }
.chat-ask-option.selected { border-color: var(--accent); background: rgba(255,107,53,0.08); }
.chat-ask-option input { accent-color: var(--accent); margin-top: 2px; }
.chat-ask-option .ask-opt-label { font-weight: 600; color: var(--text-strong); }
.chat-ask-option .ask-opt-desc {
  display: block; margin-top: 2px;
  font-size: 11px; line-height: 1.35;
  color: var(--text-dim);
}
.chat-ask-text-input {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg); color: var(--text);
  font-size: 12px; margin-top: 8px; outline: none;
}
.chat-ask-text-input:focus { border-color: var(--accent); }
.chat-ask-footer {
  padding: 12px 16px; border-top: 1px solid var(--border);
  display: flex; justify-content: flex-end; gap: 8px;
}
.chat-ask-submit {
  padding: 8px 16px; border-radius: 6px; border: none;
  background: var(--accent); color: #fff; font-size: 12px;
  font-weight: 600; cursor: pointer; transition: opacity 0.15s;
}
.chat-ask-submit:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Rich Tool Body Views ────────────────────────────────────────────── */
.tool-rich-file-header {
  font-family: var(--font-mono); font-size: 10px; color: var(--accent);
  padding: 2px 0 6px; letter-spacing: 0.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tool-meta-line {
  font-family: var(--font-mono); font-size: 10px; color: var(--text-dim);
  padding: 2px 0;
}

/* ── Diff View (Edit tool) ───────────────────────────────────────────── */
.tool-diff {
  border: 1px solid var(--border); border-radius: 3px; overflow: hidden;
  font-family: var(--font-mono); font-size: 11px; line-height: 1.6;
}
.diff-line {
  display: flex; padding: 0 8px; min-height: 20px;
}
.diff-sign {
  width: 16px; flex-shrink: 0; text-align: center; user-select: none;
  font-weight: 600;
}
.diff-text {
  flex: 1; white-space: pre-wrap; word-break: break-all; min-width: 0;
}
.diff-del {
  background: rgba(229,83,75,0.12); color: var(--error);
}
.diff-del .diff-sign { color: var(--error); }
.diff-add {
  background: rgba(86,211,100,0.10); color: var(--ok);
}
.diff-add .diff-sign { color: var(--ok); }
.diff-meta {
  background: rgba(108,182,255,0.08); color: var(--info);
}
.diff-meta .diff-sign { color: var(--info); }

/* ── Code Block (Write/Read tools) ───────────────────────────────────── */
.tool-code-block {
  border: 1px solid var(--border); border-radius: 3px; overflow: hidden;
  font-family: var(--font-mono); font-size: 11px; line-height: 1.55;
  max-height: 280px; overflow-y: auto;
}
.code-line {
  display: flex; min-height: 18px;
}
.code-ln {
  width: 32px; flex-shrink: 0; text-align: right; padding-right: 8px;
  color: var(--text-faint); user-select: none; font-size: 10px;
}
.code-text {
  flex: 1; white-space: pre-wrap; word-break: break-all; min-width: 0;
  color: var(--text);
}
.code-trunc {
  color: var(--text-dim); font-style: italic;
}
.code-trunc .code-ln { color: var(--text-dim); }

/* ── Bash Tool ───────────────────────────────────────────────────────── */
.tool-bash-desc {
  font-size: 10px; color: var(--text-mid); padding-bottom: 4px;
}
.tool-bash-cmd {
  font-family: var(--font-mono); font-size: 11px; color: var(--text-strong);
  padding: 6px 8px; background: var(--bg); border-radius: 3px;
  border: 1px solid var(--border); overflow: hidden; text-overflow: ellipsis;
}
.bash-prompt { color: var(--ok); font-weight: 600; margin-right: 6px; }
.tool-bash-output {
  font-family: var(--font-mono); font-size: 10px; color: var(--text-mid);
  line-height: 1.5; padding: 6px 8px; background: var(--bg);
  border: 1px solid var(--border); border-radius: 3px;
  max-height: 200px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
  margin-top: 6px;
}

/* ── Session Dropdown ────────────────────────────────────────────────── */
.chat-dropdown {
  position: absolute; left: 8px; top: 44px; z-index: 9000;
  background: var(--surface-raised); border: 1px solid var(--border);
  border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  min-width: 260px; max-width: 340px; max-height: 360px; overflow-y: auto;
}
.chat-dropdown.hidden { display: none; }
.dropdown-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 6px; border-bottom: 1px solid var(--border);
}
.dropdown-label {
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-dim);
}
.dropdown-count {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-faint);
}
.dropdown-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  cursor: pointer; font-size: 12px; color: var(--text); transition: background 0.12s;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.dropdown-item:hover { background: var(--accent-dim, rgba(255,107,53,0.06)); }
.dropdown-item.active {
  background: var(--accent-dim, rgba(255,107,53,0.08));
  border-left: 2px solid var(--accent);
}
.dropdown-item-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px;
}
.dropdown-item-time {
  font-size: 9px; color: var(--text-mid); font-family: var(--font-mono);
  white-space: nowrap; flex-shrink: 0;
}
.dropdown-action {
  background: var(--surface-alt); border: 1px solid var(--border); color: var(--text-dim);
  cursor: pointer; padding: 3px 5px; border-radius: 6px;
  display: none; align-items: center; justify-content: center;
  width: 22px; height: 22px; transition: all 0.15s; flex-shrink: 0;
}
.dropdown-item:hover .dropdown-action { display: inline-flex; }
.dropdown-action:hover { color: var(--text); background: var(--border); border-color: var(--border-hover); }
.dropdown-action.delete-action:hover { color: var(--error); background: rgba(229,83,75,0.12); border-color: rgba(229,83,75,0.35); }
.dropdown-new-btn {
  display: block; width: 100%; padding: 10px 12px; text-align: left;
  background: none; border: none; border-top: 1px solid var(--border);
  color: var(--accent); font-size: 12px; font-family: var(--font-mono);
  cursor: pointer; letter-spacing: 0.04em;
}
.dropdown-new-btn:hover { background: var(--accent-dim, rgba(255,107,53,0.06)); }
.dropdown-rename-input {
  flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--accent);
  border-radius: 3px; color: var(--text); font-size: 12px; padding: 2px 6px;
  outline: none;
}


/* ── Slash Commands Popup ────────────────────────────────────────────── */
.chat-slash-popup {
  position: absolute; bottom: 100%; left: 0; right: 0; z-index: 9500;
  background: var(--surface-raised); border: 1px solid var(--border);
  border-radius: 6px 6px 0 0; box-shadow: 0 -4px 24px rgba(0,0,0,0.35);
  max-height: 280px; overflow-y: auto;
}
.chat-slash-popup.hidden { display: none; }
.slash-header {
  padding: 8px 12px 4px; font-family: var(--font-mono); font-size: 9px;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.slash-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  cursor: pointer; transition: background 0.12s;
}
.slash-item:hover, .slash-item.active {
  background: var(--accent-dim, rgba(255,107,53,0.08));
}
.slash-icon { font-size: 16px; width: 24px; text-align: center; flex-shrink: 0; }
.slash-label {
  font-family: var(--font-mono); font-size: 12px; font-weight: 600;
  color: var(--accent); min-width: 80px;
}
.slash-desc { font-size: 11px; color: var(--text-mid); }

/* ── Scroll FAB ──────────────────────────────────────────────────────── */
.chat-scroll-fab {
  position: absolute; bottom: 200px; right: 16px; z-index: 8000;
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--surface-raised); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  transition: opacity 0.2s, transform 0.2s;
  color: var(--text-mid);
}
.chat-scroll-fab:hover { color: var(--accent); border-color: var(--accent); transform: scale(1.1); }
.chat-scroll-fab.hidden { opacity: 0; pointer-events: none; transform: translateY(8px); }

/* ── Compact Indicator ───────────────────────────────────────────────── */
.chat-compact-indicator {
  display: flex; align-items: center; gap: 8px; padding: 6px 14px;
  background: rgba(108,182,255,0.06); border-top: 1px solid rgba(108,182,255,0.15);
  font-size: 11px; color: var(--info);
}
.chat-compact-indicator.hidden { display: none; }
.compact-spin { animation: tool-spin 1s linear infinite; }
@keyframes compactShimmer {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}
.compact-shimmer { animation: compactShimmer 1.5s ease-in-out infinite; }

/* ── Sub-Agent Card ──────────────────────────────────────────────────── */
.tool-pill.kind-subagent { border-color: rgba(138,92,246,0.3); }
.tool-pill.kind-subagent .tool-pill-icon { color: #8a5cf6; }
.subagent-bar {
  display: flex; align-items: center; gap: 6px; padding: 4px 0;
}
.subagent-progress {
  flex: 1; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden;
}
.subagent-progress-fill {
  height: 100%; background: #8a5cf6; border-radius: 2px;
  transition: width 0.4s ease; width: 0%;
}
.subagent-elapsed {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-faint);
  min-width: 36px; text-align: right;
}
.subagent-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 6px; border-radius: 3px; font-size: 9px;
  font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase;
}
.subagent-badge.running { background: rgba(108,182,255,0.12); color: var(--info); }
.subagent-badge.done { background: rgba(86,211,100,0.12); color: var(--ok); }

/* ── Sequential Thinking Card ────────────────────────────────────────── */
.thinking-seq-card {
  margin: 6px 0; border: 1px solid rgba(138,138,148,0.15);
  border-radius: 4px; overflow: hidden;
}
.thinking-seq-head {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  cursor: pointer; font-size: 11px; color: var(--text-mid);
  background: rgba(138,138,148,0.04);
}
.thinking-seq-head:hover { background: rgba(138,138,148,0.08); }
.thinking-seq-icon { display: inline-flex; color: var(--accent); }
.thinking-seq-label { font-family: var(--font-mono); font-size: 10px; font-weight: 500; }
.thinking-seq-chevron { margin-left: auto; font-size: 10px; color: var(--text-faint); transition: transform 0.15s; }
.thinking-seq-card.expanded .thinking-seq-chevron { transform: rotate(90deg); }
.thinking-seq-body {
  padding: 8px 12px; border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-mid);
  max-height: 300px; overflow-y: auto; display: none;
  line-height: 1.5;
}
.thinking-seq-body p { margin: 4px 0; }
.thinking-seq-body ul, .thinking-seq-body ol { margin: 4px 0; padding-left: 20px; }
.thinking-seq-body li { margin: 2px 0; }
.thinking-seq-body code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
.thinking-seq-body pre { background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 6px 0; }
.thinking-seq-body pre code { background: none; padding: 0; }
.thinking-seq-body strong { color: var(--text); }
.thinking-seq-body h1, .thinking-seq-body h2, .thinking-seq-body h3 { font-size: 12px; font-weight: 600; color: var(--text); margin: 6px 0 2px; }
.thinking-seq-body blockquote { border-left: 2px solid var(--accent); padding-left: 8px; margin: 4px 0; color: var(--text-dim); }
.thinking-seq-card.expanded .thinking-seq-body { display: block; }

/* ── Terminal Command Card ───────────────────────────────────────────── */
.tool-pill.kind-terminal { border-color: rgba(86,211,100,0.25); }
.tool-pill.kind-terminal .tool-pill-icon { color: var(--ok); }

/* ── Subagent (Agent/Task) Card ─────────────────────────────────────── */
.subagent-card {
  margin: 6px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface);
  transition: border-color 0.3s;
}
.subagent-card.running { border-color: rgba(108,182,255,0.35); }
.subagent-card.error { border-color: rgba(229,83,75,0.25); }
.subagent-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  background: transparent;
  border: none;
  text-align: left;
}
.subagent-head:hover { background: rgba(16,16,21,0.3); }
.subagent-card.expanded .subagent-head { border-bottom: 1px solid var(--border); }
/* Vite-style 28x28 status badge */
.subagent-head .subagent-status-badge {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.subagent-card.running .subagent-status-badge { background: rgba(108,182,255,0.12); color: var(--info); }
.subagent-card.running .subagent-status-badge svg { animation: tool-spin 1s linear infinite; }
.subagent-card:not(.running):not(.error) .subagent-status-badge { background: rgba(86,211,100,0.1); color: var(--ok); }
.subagent-card.error .subagent-status-badge { background: rgba(229,83,75,0.1); color: var(--error); }
.subagent-head .subagent-info { flex: 1; min-width: 0; }
.subagent-head .subagent-status-text {
  font-family: var(--font-mono); font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px;
}
.subagent-card.running .subagent-status-text { color: var(--info); }
.subagent-card:not(.running):not(.error) .subagent-status-text { color: var(--ok); }
.subagent-card.error .subagent-status-text { color: var(--error); }
.subagent-head .subagent-desc {
  font-size: 12px; color: var(--text); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.subagent-head .subagent-timer {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-dim); flex-shrink: 0;
}
/* Progress bar (Vite-style animated gradient) */
.subagent-progress-bar {
  height: 2px; background: var(--border); overflow: hidden;
}
.subagent-progress-bar .subagent-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--info), var(--accent));
  animation: subagent-progress 2s ease-in-out infinite;
}
@keyframes subagent-progress { 0% { width: 0%; margin-left: 0; } 50% { width: 60%; margin-left: 20%; } 100% { width: 0%; margin-left: 100%; } }
/* Collapsed summary — clickable to expand full response */
.subagent-collapsed {
  padding: 0 12px 10px 48px; font-size: 11px; color: var(--text-mid);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: all 0.2s ease;
}
.subagent-collapsed:hover { color: var(--text); }
.subagent-collapsed.md-body { font-size: 12px; line-height: 1.55; }
.subagent-collapsed.md-body pre { max-height: 200px; overflow: auto; }
.subagent-collapsed.md-body p:first-child { margin-top: 0; }
.subagent-child-count {
  padding: 0 12px 8px 48px; font-size: 9px; color: var(--text-dim); font-family: var(--font-mono);
}

.subagent-body {
  padding: 10px 10px 12px;
  background: rgba(16,16,21,0.5);
}
.subagent-actions-head {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.subagent-actions-chevron { margin-left: auto; color: var(--text-faint); }
.subagent-actions-list {
  display: none;
  padding-left: 12px;
  border-left: 1px solid var(--border);
}
.subagent-card.actions-expanded .subagent-actions-list { display: block; }

/* Compact child action rows (small SVG icon + 6-char name + summary) */
.subagent-child {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 6px; border-radius: 3px;
  background: var(--bg); font-family: var(--font-mono); font-size: 10px;
  margin-bottom: 2px;
}
.subagent-child-status {
  width: 10px; height: 10px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-faint);
}
.subagent-child-status svg { width: 10px; height: 10px; }
.subagent-child.running .subagent-child-status { color: var(--info); }
.subagent-child.running .subagent-child-status svg { animation: tool-spin 1s linear infinite; }
.subagent-child.done .subagent-child-status { color: var(--ok); }
.subagent-child.error .subagent-child-status { color: var(--error); }
.subagent-child-label {
  color: var(--text-dim); font-size: 8px; width: 36px; flex-shrink: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.subagent-child-summary {
  color: var(--text-mid); flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.subagent-collapsed {
  padding: 0 12px 8px 48px;
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.terminal-actions {
  display: flex; gap: 6px; padding: 6px 0 2px;
}
.terminal-action-btn {
  padding: 3px 10px; border-radius: 3px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text-mid); font-size: 10px;
  cursor: pointer; font-family: var(--font-mono); transition: border-color 0.12s;
}
.terminal-action-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── Skip Tool Button ────────────────────────────────────────────────── */
.tool-skip-btn {
  padding: 2px 8px; border-radius: 3px; border: 1px solid var(--border);
  background: var(--surface); color: var(--warn); font-size: 9px;
  cursor: pointer; font-family: var(--font-mono); letter-spacing: 0.06em;
  text-transform: uppercase; margin-left: 8px; transition: border-color 0.12s;
}
.tool-skip-btn:hover { border-color: var(--warn); background: rgba(229,166,57,0.08); }

/* ── Interruption Banner ─────────────────────────────────────────────── */
.interruption-banner {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  margin: 8px 0; background: rgba(229,166,57,0.08);
  border: 1px solid rgba(229,166,57,0.2); border-radius: 4px;
}
.interruption-text {
  flex: 1; font-size: 12px; color: var(--warn); font-weight: 500;
}
.interruption-btn {
  padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 11px;
  cursor: pointer; font-family: var(--font-mono); transition: border-color 0.12s;
}
.interruption-btn:hover { border-color: var(--accent); color: var(--accent); }
.interruption-btn.primary {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.interruption-btn.primary:hover { opacity: 0.85; }

/* ── Checkpoint Separator ────────────────────────────────────────────── */
.checkpoint-sep {
  display: flex; align-items: center; gap: 8px; margin: 16px 14px 8px;
  color: var(--text-faint);
}
.checkpoint-line { flex: 1; height: 1px; background: var(--border); }
.checkpoint-dot {
  width: 5px; height: 5px; border-radius: 50%; background: var(--border);
}

/* ── Welcome Empty State ─────────────────────────────────────────────── */
.chat-welcome-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 24px; text-align: center; gap: 20px; min-height: 200px;
}
.welcome-logo {
  font-size: 28px; color: var(--accent); opacity: 0.7;
}
.welcome-heading {
  font-size: 15px; font-weight: 600; color: var(--text-strong);
  letter-spacing: -0.02em;
}
.welcome-sub {
  font-size: 11px; color: var(--text-dim); max-width: 260px; line-height: 1.5;
}
.welcome-suggestions {
  display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 300px;
}
.welcome-suggestion {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer; transition: border-color 0.15s, background 0.15s;
  text-align: left;
}
.welcome-suggestion:hover {
  border-color: var(--accent); background: rgba(255,107,53,0.04);
}
.welcome-suggestion-num {
  font-family: var(--font-mono); font-size: 10px; color: var(--accent);
  font-weight: 600; width: 16px; flex-shrink: 0;
}
.welcome-suggestion-text {
  font-size: 11px; color: var(--text-mid);
}

/* ── Editor Context Pill ─────────────────────────────────────────────── */
.chat-editor-context { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 4px; }
.chat-editor-context:empty { display: none; }
.editor-ctx-pill {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  background: rgba(108,182,255,0.08); border: 1px solid rgba(108,182,255,0.15);
  border-radius: 12px; font-size: 10px; color: var(--info);
  font-family: var(--font-mono);
}
.editor-ctx-pill .ctx-x {
  cursor: pointer; color: var(--text-faint); font-size: 12px;
  margin-left: 2px;
}
.editor-ctx-pill .ctx-x:hover { color: var(--error); }

/* ── Drag & Drop Overlay ─────────────────────────────────────────────── */
.compose-dragover {
  outline: 2px dashed var(--accent) !important;
  outline-offset: -2px;
  background: rgba(255,107,53,0.04) !important;
}
.compose-dragover::after {
  content: 'Drop files here';
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--accent); font-family: var(--font-mono);
  letter-spacing: 0.06em; pointer-events: none;
  background: rgba(255,107,53,0.04);
}

/* ── Load Older Messages ─────────────────────────────────────────────── */
.load-older-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 16px; margin: 8px auto; border: 1px solid var(--border);
  border-radius: 4px; background: var(--surface); color: var(--text-dim);
  font-size: 11px; font-family: var(--font-mono); cursor: pointer;
  transition: border-color 0.12s, color 0.12s;
}
.load-older-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── Message Counter ─────────────────────────────────────────────────── */
.chat-msg-counter {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-faint);
  letter-spacing: 0.08em; padding: 1px 5px; border-radius: 3px;
  background: rgba(255,255,255,0.03);
}
.chat-msg-counter:empty { display: none; }
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'chat-inline-styles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  // ---------- State ----------
  let currentSessionId = null;
  let activeStream = null;
  let messages = []; // current session messages (in-memory mirror)
  let attachments = []; // [{ path, name }]
  let currentAssistantEl = null;
  let userScrolledUp = false;
  let todos = []; // [{ id, content, status: 'pending'|'in_progress'|'completed' }]
  let messageQueue = []; // queued messages when agent is busy
  let pendingQuestion = null; // { toolUseId, questions: [{ question, options?, allowText? }] }
  let isSending = false;
  let firstUserMessageSent = false; // for title generation
  let currentAssistantMsgId = null; // IndexedDB message id for current streaming assistant msg
  let currentAssistantBlocks = []; // accumulated blocks for current assistant message
  let userMessageCount = 0; // total user messages in current session
  let renderedMessageCount = 0; // how many history msgs currently rendered
  let allHistoryMessages = []; // full history for load-older
  let slashActiveIdx = -1; // active index in slash popup
  let draftSaveTimer = null; // debounce timer for draft persistence
  let sequentialThinkingCount = 0; // counter for sequential thinking cards

  // ---------- Collapsible panel state ----------
  let todoCollapsed = false;
  let queueCollapsed = false;
  function panelKey(which) {
    return state.projectPath ? `pipilot:chatpanel:${which}:${state.projectPath}` : null;
  }
  function loadPanelState() {
    try {
      const tk = panelKey('todo');
      const qk = panelKey('queue');
      if (tk) todoCollapsed = localStorage.getItem(tk) === '1';
      if (qk) queueCollapsed = localStorage.getItem(qk) === '1';
    } catch {}
  }
  function savePanelState() {
    try {
      const tk = panelKey('todo');
      const qk = panelKey('queue');
      if (tk) localStorage.setItem(tk, todoCollapsed ? '1' : '0');
      if (qk) localStorage.setItem(qk, queueCollapsed ? '1' : '0');
    } catch {}
  }

  // ---------- DOM refs ----------
  const messagesEl = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const stopBtn = document.getElementById('chat-stop');
  const attachBtn = document.getElementById('chat-attach');
  const uploadBtn = document.getElementById('chat-upload');
  const settingsBtn = document.getElementById('chat-settings');
  const attachmentsEl = document.getElementById('chat-attachments');
  const chatPanel = document.getElementById('chat-panel');
  const sessionBtn = document.getElementById('chat-session-btn');
  const sessionTitleEl = document.getElementById('chat-session-title');
  const sessionDropdown = document.getElementById('chat-session-dropdown');
  const modeBtn = document.getElementById('chat-mode-btn');
  const modeLabelEl = document.getElementById('chat-mode-label');
  const modeDropdown = document.getElementById('chat-mode-dropdown');
  const effortBtn = document.getElementById('chat-effort-btn');
  const effortLabelEl = document.getElementById('chat-effort-label');
  const effortDropdown = document.getElementById('chat-effort-dropdown');
  const clearBtn = document.getElementById('chat-clear');
  const scrollFab = document.getElementById('chat-scroll-fab');
  const compactIndicator = document.getElementById('chat-compact-indicator');
  const slashPopup = document.getElementById('chat-slash-popup');
  const composeBox = document.getElementById('chat-compose-box');
  const editorContextEl = document.getElementById('chat-editor-context');
  const msgCounterEl = document.getElementById('chat-msg-counter');

  // ---------- Helpers ----------
  function scrollToBottom(force) {
    if (!messagesEl) return;
    if (force || !userScrolledUp) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // Feature #4: Scroll FAB
  if (messagesEl) {
    messagesEl.addEventListener('scroll', () => {
      const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
      userScrolledUp = !nearBottom;
      if (scrollFab) scrollFab.classList.toggle('hidden', nearBottom);
    });
  }
  if (scrollFab) {
    scrollFab.addEventListener('click', () => scrollToBottom(true));
  }

  function hideWelcome() {
    const w = messagesEl ? messagesEl.querySelector('.chat-welcome-state') : null;
    if (w && w.parentNode) w.remove();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderMarkdown(text) {
    if (window.marked && window.marked.parse) {
      try { return window.marked.parse(text); } catch { return escapeHtml(text); }
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  // Make inline `code` spans that look like file paths clickable (deep links)
  function attachFileDeepLinks(root) {
    root.querySelectorAll('code').forEach(code => {
      // Skip code blocks (inside <pre>)
      if (code.closest('pre')) return;
      const text = code.textContent || '';
      if (isFilePath(text)) {
        code.classList.add('deeplink-path');
        code.title = `Open ${text} in editor`;
        code.style.cursor = 'pointer';
        code.style.borderBottom = '1px dashed var(--accent-line, rgba(255,107,53,0.3))';
        code.addEventListener('click', (e) => { e.stopPropagation(); openFileInEditor(text); });
        code.addEventListener('mouseenter', () => { code.style.color = 'var(--accent)'; code.style.borderBottomColor = 'var(--accent)'; });
        code.addEventListener('mouseleave', () => { code.style.color = ''; code.style.borderBottomColor = 'var(--accent-line, rgba(255,107,53,0.3))'; });
      }
    });
  }

  // Wrap tables and large images in scroll containers to prevent overflow
  function wrapOverflowingContent(root) {
    // Wrap tables
    root.querySelectorAll('table').forEach(table => {
      if (table.closest('.md-table-wrap')) return; // already wrapped
      const wrapper = document.createElement('div');
      wrapper.className = 'md-table-wrap';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
    // Wrap images and constrain size
    root.querySelectorAll('img').forEach(img => {
      if (img.closest('.md-img-wrap')) return;
      // On load, check if image needs scroll wrapper
      const onLoad = () => {
        if (img.naturalWidth > 1024) {
          img.style.width = '1024px';
          img.style.height = 'auto';
        }
        // Wrap in scroll container if still wider than parent
        const parent = img.parentElement;
        if (parent && img.offsetWidth > parent.offsetWidth) {
          const wrapper = document.createElement('div');
          wrapper.className = 'md-img-wrap';
          parent.insertBefore(wrapper, img);
          wrapper.appendChild(img);
        }
      };
      if (img.complete) onLoad();
      else img.addEventListener('load', onLoad);
      // Click to open full size
      img.addEventListener('click', () => {
        window.electronAPI?.shell?.openExternal?.(img.src);
      });
      // Right-click context menu: copy image
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        bus.emit('contextmenu:show', {
          x: e.clientX, y: e.clientY,
          items: [
            { label: 'Copy Image', onClick: async () => {
              try {
                const resp = await fetch(img.src);
                const blob = await resp.blob();
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                bus.emit('toast:show', { type: 'ok', message: 'Image copied' });
              } catch { bus.emit('toast:show', { type: 'error', message: 'Failed to copy image' }); }
            }},
            { label: 'Open in Browser', onClick: () => { window.electronAPI?.shell?.openExternal?.(img.src); }},
            { label: 'Copy Image URL', onClick: () => {
              navigator.clipboard.writeText(img.src).catch(() => {});
              bus.emit('toast:show', { type: 'info', message: 'URL copied' });
            }},
          ],
        });
      });
    });
  }

  // Render Mermaid diagrams in code blocks
  function renderMermaidBlocks(root) {
    if (!window.mermaid || !window.PiPilot?.mermaidSafe) return;
    root.querySelectorAll('pre code.language-mermaid, pre code.language-mmd').forEach(code => {
      const pre = code.closest('pre');
      if (!pre || pre.dataset.mermaidRendered) return;
      pre.dataset.mermaidRendered = '1';
      const src = code.textContent || '';
      if (!src.trim()) return;
      const container = document.createElement('div');
      container.className = 'mermaid-container';
      pre.replaceWith(container);
      // Defensive renderer — invalid mermaid never paints into the doc;
      // we get back either an SVG element or a styled error note.
      window.PiPilot.mermaidSafe.renderInto(container, src, 'chat-mmd').then(node => {
        if (node && node.tagName === 'svg' && window.PiPilot?.diagramExport?.attachExportMenu) {
          window.PiPilot.diagramExport.attachExportMenu(node, 'chat-diagram');
        }
      });
    });
  }

  function attachCopyButtons(root) {
    root.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.copy-code-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-code-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const code = pre.querySelector('code')?.innerText || pre.innerText || '';
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
        } catch {}
      });
      pre.appendChild(btn);
    });
  }

  function relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Feature #21: Message counter
  function updateMsgCounter() {
    if (msgCounterEl) {
      msgCounterEl.textContent = userMessageCount > 0 ? String(userMessageCount).padStart(2, '0') : '';
    }
  }

  // Feature #16: Welcome empty state
  function showWelcomeState() {
    if (!messagesEl) return;
    hideWelcome();
    const suggestions = [
      { num: '01', text: 'Build a React dashboard with charts', prompt: 'Build me a complete React dashboard with interactive charts and data visualization' },
      { num: '02', text: 'Fix the bugs in my project', prompt: 'Find and fix all the bugs in this project' },
      { num: '03', text: 'Explain how the codebase works', prompt: 'Explain the architecture and how this codebase works' },
      { num: '04', text: 'Refactor for better performance', prompt: 'Refactor the codebase for better performance and cleaner code' },
    ];
    const el = document.createElement('div');
    el.className = 'chat-welcome-state';
    el.innerHTML = `
      <div class="welcome-logo">
        <img src="public/icon.png" alt="PiPilot" width="48" height="48" style="border-radius:10px;" />
      </div>
      <div class="welcome-heading">What shall we build?</div>
      <div class="welcome-sub">Describe what you want and the agent will read, write, and run code for you.</div>
      <div class="welcome-suggestions">
        ${suggestions.map(s => `
          <div class="welcome-suggestion" data-prompt="${escapeHtml(s.prompt)}">
            <span class="welcome-suggestion-num">${s.num}</span>
            <span class="welcome-suggestion-text">${escapeHtml(s.text)}</span>
          </div>
        `).join('')}
      </div>
    `;
    el.querySelectorAll('.welcome-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        if (inputEl && prompt) {
          inputEl.value = prompt;
          inputEl.focus();
          autoResize();
        }
      });
    });
    messagesEl.appendChild(el);
  }

  // Feature #15: User message truncation
  function truncateText(text, maxWords) {
    const words = text.split(/\s+/);
    if (words.length <= maxWords) return { text, truncated: false };
    return { text: words.slice(0, maxWords).join(' '), truncated: true };
  }

  function renderTruncatableText(container, fullText, previewText) {
    if (!container) return;
    let expanded = false;
    const repaint = () => {
      container.textContent = expanded ? fullText + ' ' : previewText + '... ';
      const link = document.createElement('span');
      link.className = 'show-more-link';
      link.textContent = expanded ? 'Show Less' : 'Show More';
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        repaint();
      });
      container.appendChild(link);
    };
    repaint();
  }

  // Feature #14: Checkpoint separator
  function appendCheckpointSep(checkpointId) {
    if (!messagesEl) return;
    const existing = messagesEl.lastElementChild;
    if (existing && existing.classList.contains('checkpoint-sep')) return;
    const sep = document.createElement('div');
    sep.className = 'checkpoint-sep';
    if (checkpointId) sep.dataset.checkpointId = checkpointId;
    sep.innerHTML = '<span class="checkpoint-line"></span><span class="checkpoint-dot"></span><span class="checkpoint-line"></span>';
    messagesEl.appendChild(sep);
  }

  function appendUserMessage(text) {
    hideWelcome();
    // Feature #14: Add checkpoint separator between turns
    if (messagesEl && messagesEl.lastElementChild &&
        (messagesEl.lastElementChild.classList.contains('msg-assistant') ||
         messagesEl.lastElementChild.classList.contains('checkpoint-sep') === false)) {
      const lastMsg = messagesEl.lastElementChild;
      if (lastMsg && lastMsg.classList.contains('msg-assistant')) {
        appendCheckpointSep();
      }
    }
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-user';
    wrap.dataset.timestamp = String(Date.now());
    // User avatar
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    wrap.appendChild(avatar);
    // Content wrapper
    const content = document.createElement('div');
    content.className = 'msg-content';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    // Feature #15: truncate long messages
    const { text: displayText, truncated } = truncateText(text, 35);
    if (truncated) {
      bubble.classList.add('truncated');
      renderTruncatableText(bubble, text, displayText);
    } else {
      bubble.textContent = text;
    }
    content.appendChild(bubble);
    if (attachments.length) {
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:4px;padding-left:2px;';
      meta.textContent = attachments.map(a => a.name || a.path).join(' · ');
      content.appendChild(meta);
    }

    // ── Double-click to edit & resend ──
    bubble.addEventListener('dblclick', () => {
      if (bubble.querySelector('.msg-edit-area')) return; // already editing
      bubble.innerHTML = '';
      const editArea = document.createElement('textarea');
      editArea.className = 'msg-edit-area';
      editArea.value = text;
      editArea.rows = Math.min(Math.max(text.split('\n').length, 2), 8);
      bubble.appendChild(editArea);
      const editBar = document.createElement('div');
      editBar.className = 'msg-edit-bar';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'msg-edit-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bubble.innerHTML = '';
        bubble.textContent = text;
      });
      const resendBtn = document.createElement('button');
      resendBtn.className = 'msg-edit-send';
      resendBtn.textContent = 'Resend';
      resendBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newText = editArea.value.trim();
        if (!newText) return;

        // Abort any in-flight agent run that was responding to the old prompt,
        // otherwise sendMessage() would just queue the new text.
        if (activeStream && activeStream.stop) {
          try { activeStream.stop(); } catch {}
        }
        isSending = false;
        setSending(false);
        bus.emit('agent:status', 'ready');

        // Drop the edited message + everything after it from IndexedDB. The DB
        // helper uses strictly-greater comparison, so subtract 1ms to include
        // the edited message itself.
        const ts = Number(wrap.dataset.timestamp);
        if (ts && chatDB && currentSessionId) {
          try { await chatDB.deleteMessagesAfter(currentSessionId, ts - 1); } catch {}
        }

        // Remove the edited message + every DOM node after it (including any
        // partially-streamed assistant reply to the old prompt).
        const allMsgs = Array.from(messagesEl.children);
        let hit = false;
        for (const node of allMsgs) {
          if (node === wrap) hit = true;
          if (hit) node.remove();
        }
        currentAssistantEl = null;
        currentAssistantBlocks = [];

        // Send the edited text as a fresh message.
        inputEl.value = newText;
        sendMessage();
      });
      editBar.appendChild(cancelBtn);
      editBar.appendChild(resendBtn);
      bubble.appendChild(editBar);
      editArea.focus();
      editArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); resendBtn.click(); }
        if (e.key === 'Escape') cancelBtn.click();
      });
    });

    // ── Action buttons (copy, delete, revert) ──
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    // Copy
    const COPY_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const CHECK_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.innerHTML = CHECK_SVG;
        copyBtn.style.color = 'var(--ok)';
        setTimeout(() => { copyBtn.innerHTML = COPY_SVG; copyBtn.style.color = ''; }, 1500);
      } catch {}
    });
    actions.appendChild(copyBtn);
    // Edit (pencil — same as double-click)
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.title = 'Edit & resend';
    editBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); bubble.dispatchEvent(new MouseEvent('dblclick')); });
    actions.appendChild(editBtn);
    // Revert (undo — revert to this checkpoint)
    const revertBtn = document.createElement('button');
    revertBtn.className = 'msg-action-btn';
    revertBtn.title = 'Revert to this point';
    revertBtn.style.color = 'var(--info)';
    revertBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    revertBtn.addEventListener('click', async (e) => {
      e.stopPropagation();

      // Find the checkpoint ID stamped on this user message
      const cpId = wrap.dataset.checkpointId || null;

      // Restore project files from checkpoint if available
      if (cpId && state.projectPath && api.checkpoints?.restore) {
        revertBtn.disabled = true;
        revertBtn.style.opacity = '0.4';
        try {
          const result = await api.checkpoints.restore(state.projectPath, cpId);
          if (result?.ok) {
            bus.emit('files:refresh');
            bus.emit('toast:show', { message: 'Project files reverted to checkpoint', type: 'ok' });
          } else {
            bus.emit('toast:show', { message: 'Restore failed: ' + (result?.error || 'unknown'), type: 'error' });
            revertBtn.disabled = false;
            revertBtn.style.opacity = '';
            return;
          }
        } catch (err) {
          bus.emit('toast:show', { message: 'Restore failed: ' + err.message, type: 'error' });
          revertBtn.disabled = false;
          revertBtn.style.opacity = '';
          return;
        }
      } else {
        bus.emit('toast:show', { message: 'No checkpoint found — removed messages only', type: 'warn' });
      }

      // Delete messages after this point from IndexedDB
      const ts = Number(wrap.dataset.timestamp);
      if (ts && chatDB && currentSessionId) {
        try { await chatDB.deleteMessagesAfter(currentSessionId, ts); } catch {}
      }

      // Remove all messages after this one from the UI
      let found = false;
      const allMsgs = Array.from(messagesEl.children);
      for (const el of allMsgs) {
        if (found) el.remove();
        if (el === wrap) found = true;
      }
      const nextSib = wrap.nextElementSibling;
      if (nextSib && nextSib.classList.contains('checkpoint-sep')) nextSib.remove();
      currentAssistantEl = null;
    });
    actions.appendChild(revertBtn);
    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'msg-action-btn msg-action-delete';
    deleteBtn.title = 'Delete message';
    deleteBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.style.transition = 'opacity 0.2s, height 0.2s';
      wrap.style.opacity = '0';
      setTimeout(() => wrap.remove(), 200);
    });
    actions.appendChild(deleteBtn);
    content.appendChild(actions);
    // Timestamp
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    content.appendChild(timeEl);
    wrap.appendChild(content);
    messagesEl.appendChild(wrap);
    scrollToBottom(true);
  }

  function ensureAssistantMessage() {
    if (currentAssistantEl) return currentAssistantEl;
    hideWelcome();
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-assistant';
    // AI avatar (sparkle icon)
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';
    wrap.appendChild(avatar);
    // Body wrapper (holds md-body + tool pills + streaming indicator)
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'msg-body-wrap';
    const body = document.createElement('div');
    body.className = 'md-body';
    body.dataset.text = '';
    bodyWrap.appendChild(body);
    // Streaming indicator (3 pulsing dots + shimmer text)
    const streamingEl = document.createElement('div');
    streamingEl.className = 'msg-streaming-indicator';
    streamingEl.innerHTML = `<span class="stream-dot"></span><span class="stream-dot"></span><span class="stream-dot"></span><span class="stream-shimmer-text">Working...</span>`;
    bodyWrap.appendChild(streamingEl);
    wrap.appendChild(bodyWrap);
    messagesEl.appendChild(wrap);
    currentAssistantEl = wrap;
    scrollToBottom();
    return wrap;
  }

  /** Get the .msg-body-wrap inside currentAssistantEl (or the el itself as fallback). */
  function getBodyWrap(el) {
    return (el || currentAssistantEl)?.querySelector('.msg-body-wrap') || el || currentAssistantEl;
  }

  /** Get or create the LAST .md-body in the body-wrap (after any tool pills). */
  function getActiveBody(wrap) {
    const bw = getBodyWrap(wrap);
    const streamEl = bw.querySelector('.msg-streaming-indicator');
    const bodies = bw.querySelectorAll('.md-body');
    const lastBody = bodies[bodies.length - 1];
    const pills = bw.querySelectorAll('.tool-pill');
    const lastPill = pills[pills.length - 1];
    if (lastPill && lastBody && lastPill.compareDocumentPosition(lastBody) & Node.DOCUMENT_POSITION_PRECEDING) {
      const newBody = document.createElement('div');
      newBody.className = 'md-body';
      newBody.dataset.text = '';
      if (streamEl) bw.insertBefore(newBody, streamEl);
      else bw.appendChild(newBody);
      return newBody;
    }
    return lastBody;
  }

  // Feature #7: Deep-linked file paths
  // attachFileLinks removed — replaced by attachFileDeepLinks which properly resolves paths

  function appendAssistantText(text) {
    const wrap = ensureAssistantMessage();
    // Defensive extractor: when the model regresses to a text-format
    // tool call (`<mcp__pipilot__reason>{json}</tool_call>` or
    // similar), pull each match out of the chunk, route the JSON's
    // `thought` field through addCotStep, and let the normal text
    // pipeline see only the leftover prose. Same treatment for any
    // `<reasoning>...{json}...</reasoning>` envelope wrapping JSON
    // instead of plain markdown — unwrap to just the thought content.
    const sanitised = extractMalformedReasoningCalls(text, wrap);
    // Strip <reasoning>...</reasoning> regions and stream them into the CoT
    // panel; only the surrounding non-reasoning prose hits the markdown body.
    const cleanText = feedReasoningParser(wrap, sanitised);
    if (cleanText) writeCleanTextToBody(wrap, cleanText);
    scrollToBottom();
  }

  // Look for known-bad reasoning emissions in a streamed text chunk
  // and route them into the Chain of Thought UI synchronously.
  // Returns the chunk with each match removed.
  //
  // Patterns we accept:
  //   <mcp__pipilot__reason>{json}</tool_call>
  //   <mcp__pipilot__reason>{json}</mcp__pipilot__reason>
  //   <tool_use name="mcp__pipilot__reason">{json}</tool_use>
  //   <reason>{json}</reason>
  //
  // The JSON is optionally wrapped in a code fence — we strip ``` if
  // present. We extract the `thought` field, fall back to `text`, and
  // last-resort use the entire JSON if neither is present.
  const MALFORMED_REASON_RES = [
    /<mcp__pipilot__reason\s*>([\s\S]*?)<\/(?:tool_call|mcp__pipilot__reason)>/g,
    /<tool_use\s+name=["']mcp__pipilot__reason["']\s*>([\s\S]*?)<\/tool_use>/g,
    /<reason\s*>([\s\S]*?)<\/reason>/g,
  ];
  function extractMalformedReasoningCalls(chunk, wrap) {
    if (!chunk || chunk.indexOf('<') === -1) return chunk;
    let out = chunk;
    for (const re of MALFORMED_REASON_RES) {
      out = out.replace(re, (_match, payload) => {
        const parsed = parseReasonPayload(payload);
        if (!parsed) return '';   // drop noise
        injectSyntheticReasoningStep(wrap, parsed);
        return '';
      });
    }
    return out;
  }

  function parseReasonPayload(raw) {
    if (!raw) return null;
    // Strip optional ```json fences and surrounding whitespace.
    let s = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    // The model sometimes nests two JSON objects with a stray }} —
    // try the simplest extract first.
    let obj = null;
    try { obj = JSON.parse(s); } catch {}
    if (!obj) {
      // Last resort: pluck the FIRST balanced { … } region.
      const start = s.indexOf('{');
      if (start === -1) return null;
      let depth = 0;
      for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) {
          try { obj = JSON.parse(s.slice(start, i + 1)); } catch {}
          break;
        } }
      }
    }
    if (!obj || typeof obj !== 'object') return null;
    const thought = (typeof obj.thought === 'string' && obj.thought)
      || (typeof obj.text === 'string' && obj.text)
      || JSON.stringify(obj, null, 2);
    return {
      thought,
      kind: typeof obj.kind === 'string' ? obj.kind : null,
      step: typeof obj.step === 'number' ? obj.step : null,
      totalSteps: typeof obj.totalSteps === 'number' ? obj.totalSteps : null,
    };
  }

  function injectSyntheticReasoningStep(wrap, parsed) {
    sequentialThinkingCount++;
    addCotStep(wrap, {
      iconName: 'brain',
      label: '',
      cardLabel: 'Reasoning',
      descriptionHTML: renderMarkdown(parsed.thought || ''),
      toolId: 'synthetic-reason-' + sequentialThinkingCount,
    });
    currentAssistantBlocks.push({
      type: 'thinking',
      text: parsed.thought || '',
    });
  }

  function writeCleanTextToBody(wrap, cleanText) {
    if (!cleanText) return;
    const body = getActiveBody(wrap);
    body.dataset.text = (body.dataset.text || '') + cleanText;
    body.innerHTML = renderMarkdown(body.dataset.text);
    attachCopyButtons(body);
    attachFileDeepLinks(body);
    wrapOverflowingContent(body);
    renderMermaidBlocks(body);
    currentAssistantBlocks.push({ type: 'text', text: cleanText });
  }

  // Drain any chars the reasoning parser has been holding back (waiting on
  // a possible partial tag) into the visible message body. Called when a
  // non-text event arrives so trailing text doesn't get stuck mid-word.
  function flushBufferedTextToBody() {
    if (!currentAssistantEl) return;
    const leftover = flushReasoningParser(currentAssistantEl);
    if (leftover) writeCleanTextToBody(currentAssistantEl, leftover);
  }

  // Stream-end safeguard. If the model wrapped its ENTIRE response inside
  // <reasoning> and never closed it (or closed it but emitted no other
  // text), the chat body would be empty — leaving the user staring at
  // just a "Reasoning" card and a DONE badge with no actual answer.
  // Detect that case here and rescue the response: close the reasoning
  // step and copy its accumulated content into the visible message body.
  function rescueUnclosedReasoning() {
    const wrap = currentAssistantEl;
    if (!wrap) return;
    const stillInReasoning = !!wrap._inReasoning;
    const accum = (wrap._reasoningAccum || '').trim();
    // Close any dangling reasoning step first.
    if (stillInReasoning) finalizeReasoningStep(wrap);
    // If the visible body has any meaningful text already, we're fine.
    const body = wrap.querySelector('.md-body');
    const bodyText = (body && body.dataset && body.dataset.text || '').trim();
    if (bodyText.length >= 5) return;
    // No visible response but we DO have reasoning content — promote it.
    if (accum) {
      writeCleanTextToBody(wrap, accum);
    }
  }

  // ---------- Tool metadata: icon + preview extractor per canonical SDK tool name ----------
  // ── Tool icons, labels, and accent colors (matching Vite ChatMessage.tsx) ──
  const S = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;
  const TOOL_ICONS = {
    // Agent SDK built-in tools
    Bash:           S('<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>'),
    BashOutput:     S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2"/><path d="M13 14h4"/>'),
    KillShell:      S('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    Read:           S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
    Write:          S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6"/>'),
    Edit:           S('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/>'),
    MultiEdit:      S('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/><path d="M15 12h6"/>'),
    Glob:           S('<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 17l9 4 9-4"/><path d="M3 12l9 4 9-4"/>'),
    Grep:           S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    NotebookEdit:   S('<path d="M4 4v16h16V4z"/><path d="M4 9h16M9 4v16"/>'),
    TodoWrite:      S('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    WebFetch:       S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'),
    WebSearch:      S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6M11 8v6"/>'),
    Task:           S('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
    TaskCreate:     S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10h4M8 14h6"/><path d="M16 3v4"/>'),
    TaskUpdate:     S('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    Agent:          S('<circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/><path d="m12 14 2 2-2 2"/>'),
    SubAgent:       S('<circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/><circle cx="18" cy="8" r="2"/>'),
    ExitPlanMode:   S('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    EnterPlanMode:  S('<path d="M2 3h7a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-7a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h8z"/>'),
    AskUserQuestion:S('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/>'),
    ToolSearch:     S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>'),
    run_in_terminal:S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2"/><path d="M13 14h4"/>'),
    // PiPilot custom MCP tools
    get_diagnostics:      S('<path d="M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2 2 6.5 2 12s4.5 10 10 10z"/><path d="M12 6v6l4 2"/>'),
    project_context:      S('<path d="M3 3h7l2 2h9v14H3z"/><path d="M7 13h10M7 17h6"/>'),
    update_project_context:S('<path d="M3 3h7l2 2h9v14H3z"/><path d="M12 11v6M9 14h6"/>'),
    frontend_design_guide:S('<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>'),
    search_codebase:      S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/>'),
    screenshot_preview:   S('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
    generate_image:       S('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
    get_working_directory:S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 11h18"/>'),
    project_memory:       S('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/><circle cx="12" cy="11" r="1.5" fill="currentColor"/>'),
    run_code:             S('<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>'),
    edit_file_patch:      S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 14l2 2 4-4"/>'),
    fetch_url:            S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/><path d="M16 8l4-4M20 4h-3M20 4v3"/>'),
    // Embedded browser tools (browser_use)
    browser_open:         S('<circle cx="12" cy="12" r="9"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z"/>'),
    browser_navigate:     S('<circle cx="12" cy="12" r="9"/><polyline points="9 7 16 12 9 17"/>'),
    browser_back:         S('<polyline points="15 18 9 12 15 6"/>'),
    browser_forward:      S('<polyline points="9 18 15 12 9 6"/>'),
    browser_reload:       S('<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>'),
    browser_close_tab:    S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    browser_list_tabs:    S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    browser_url:          S('<circle cx="12" cy="12" r="9"/><path d="M9 8h6v8H9z"/>'),
    browser_title:        S('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    browser_observe:      S('<circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>'),
    browser_snapshot:     S('<path d="M3 3h7l2 2h9v14H3z"/><path d="M7 13h10M7 17h6"/>'),
    browser_console_log:  S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2"/><path d="M13 14h4"/>'),
    browser_click:        S('<path d="M9 3l3 8 3-3 5 5-3 3 8 3-9 4z"/>'),
    browser_click_ref:    S('<path d="M9 3l3 8 3-3 5 5-3 3 8 3-9 4z"/><circle cx="18" cy="6" r="2"/>'),
    browser_type:         S('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 12h10M7 16h6"/>'),
    browser_fill_ref:     S('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 12h6"/><circle cx="18" cy="9" r="2"/>'),
    browser_press_key:    S('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M11 10v4M15 10v4M19 10v4"/>'),
    browser_scroll:       S('<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4M10 9l2 2 2-2"/>'),
    browser_get_text:     S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>'),
    browser_get_html:     S('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    browser_wait_for:     S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    browser_eval:         S('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><path d="M11 14l2 -8"/>'),
    browser_summary:      S('<path d="M3 5h18M3 10h18M3 15h12M3 20h8"/>'),
    browser_hover:        S('<path d="M5 5l6 17 2-7 7-2z"/>'),
    browser_drag:         S('<circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/><path d="M3 12h18M12 3v18"/>'),
    browser_scroll_to:    S('<path d="M12 3v14M5 12l7 7 7-7"/>'),
    browser_upload:       S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
    browser_wait_load:    S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'),
    browser_set_viewport: S('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 20h8M12 18v2"/>'),
    browser_reset_viewport:S('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 20h8M12 18v2"/><path d="M19 9l-3 3 3 3"/>'),
    browser_cookies_get:  S('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1"/><circle cx="14" cy="13" r="1"/><circle cx="10" cy="15" r="1"/><circle cx="15" cy="8" r="1"/>'),
    browser_pdf:          S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 14h.01M11 14h2"/>'),
    /* RETIRED — coordinate-input + game-bot pill icons. Re-enable in lockstep with the matching tools.
    browser_click_at:     S('<path d="M3 3l7 17 2-7 7-2z"/><path d="M16 16l5 5"/>'),
    browser_mouse_move:   S('<path d="M5 5l4 13 2-5 5-2z"/><path d="M3 12h2M19 12h2M12 3v2M12 19v2"/>'),
    browser_drag_at:      S('<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 8l8 8" stroke-dasharray="2 2"/>'),
    browser_poll_until:   S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><circle cx="20" cy="6" r="2" fill="currentColor"/>'),
    browser_sample:       S('<path d="M3 17l5-7 4 5 4-9 5 11"/>'),
    browser_run_script:   S('<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/><circle cx="20" cy="6" r="2" fill="currentColor"/>'),
    browser_stop_script:  S('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
    browser_script_status:S('<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>'),
    browser_update_script_state: S('<polygon points="5 3 19 12 5 21 5 3"/><path d="M14 12h6M17 9v6"/>'),
    */
    // Default
    default:        S('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  };

  // Friendly display names for tools
  const TOOL_LABELS = {
    Bash: 'Terminal', BashOutput: 'Terminal Output', KillShell: 'Kill Shell',
    Read: 'Read File', Write: 'Write File', Edit: 'Edit File', MultiEdit: 'Multi Edit',
    Glob: 'Find Files', Grep: 'Search Content', NotebookEdit: 'Notebook Edit',
    TodoWrite: 'Todo List', WebFetch: 'Web Fetch', WebSearch: 'Web Search',
    Task: 'Task', TaskCreate: 'Create Task', TaskUpdate: 'Update Task',
    Agent: 'Agent', SubAgent: 'Sub-Agent', ExitPlanMode: 'Exit Plan', EnterPlanMode: 'Plan Mode',
    AskUserQuestion: 'Ask User', ToolSearch: 'Tool Search', run_in_terminal: 'Run Command',
    // PiPilot MCP tools
    get_diagnostics: 'Diagnostics', project_context: 'Project Context',
    update_project_context: 'Update Context', frontend_design_guide: 'Design Guide',
    search_codebase: 'Search Codebase', screenshot_preview: 'Screenshot',
    generate_image: 'Generate Image', project_memory: 'Memory',
    edit_file_patch: 'Patch File', fetch_url: 'Fetch URL', run_code: 'Run Code',
    get_working_directory: 'Working Directory',
    // Embedded browser tools
    browser_open: 'Browser · Open',
    browser_navigate: 'Browser · Navigate',
    browser_back: 'Browser · Back',
    browser_forward: 'Browser · Forward',
    browser_reload: 'Browser · Reload',
    browser_close_tab: 'Browser · Close Tab',
    browser_list_tabs: 'Browser · List Tabs',
    browser_url: 'Browser · URL',
    browser_title: 'Browser · Title',
    browser_observe: 'Browser · Observe',
    browser_snapshot: 'Browser · Snapshot',
    browser_console_log: 'Browser · Console',
    browser_click: 'Browser · Click',
    browser_click_ref: 'Browser · Click',
    browser_type: 'Browser · Type',
    browser_fill_ref: 'Browser · Fill',
    browser_press_key: 'Browser · Key',
    browser_scroll: 'Browser · Scroll',
    browser_get_text: 'Browser · Get Text',
    browser_get_html: 'Browser · Get HTML',
    browser_wait_for: 'Browser · Wait',
    browser_eval: 'Browser · Eval',
    browser_summary: 'Browser · Summary',
    browser_hover: 'Browser · Hover',
    browser_drag: 'Browser · Drag',
    browser_scroll_to: 'Browser · Scroll To',
    browser_upload: 'Browser · Upload',
    browser_wait_load: 'Browser · Wait Load',
    browser_set_viewport: 'Browser · Viewport',
    browser_reset_viewport: 'Browser · Reset Viewport',
    browser_cookies_get: 'Browser · Cookies',
    browser_pdf: 'Browser · PDF',
    /* RETIRED — coordinate-input + game-bot pill labels. Re-enable in lockstep with the matching tools.
    browser_click_at: 'Browser · Click @',
    browser_mouse_move: 'Browser · Move',
    browser_drag_at: 'Browser · Drag @',
    browser_poll_until: 'Browser · Poll',
    browser_sample: 'Browser · Sample',
    browser_run_script: 'Browser · Run Bot',
    browser_stop_script: 'Browser · Stop Bot',
    browser_script_status: 'Browser · Bot Status',
    browser_update_script_state: 'Browser · Steer Bot',
    */
  };

  // Accent colors per tool (matching Vite)
  const TOOL_COLORS = {
    get_diagnostics: 'var(--error)', project_context: 'var(--info)',
    update_project_context: 'var(--info)', frontend_design_guide: '#b392f0',
    search_codebase: 'var(--accent)', screenshot_preview: '#56d4dd',
    generate_image: '#56d4dd', project_memory: '#ffd787',
    edit_file_patch: 'var(--accent)', fetch_url: 'var(--info)', run_code: 'var(--ok)',
    get_working_directory: 'var(--text-mid)',
    Read: 'var(--info)', Glob: 'var(--info)', Grep: 'var(--info)', WebSearch: 'var(--info)',
    Write: 'var(--ok)', Edit: 'var(--accent)', MultiEdit: 'var(--accent)',
    Bash: 'var(--text-mid)', run_in_terminal: 'var(--text-mid)',
    Agent: 'var(--accent)', SubAgent: 'var(--accent)',
    TodoWrite: 'var(--ok)', WebFetch: 'var(--info)',
    // Embedded browser — pick a single accent so all browser pills cluster visually
    browser_open: '#56d4dd', browser_navigate: '#56d4dd', browser_observe: '#56d4dd',
    browser_snapshot: '#56d4dd', browser_console_log: '#56d4dd',
    browser_click: '#56d4dd', browser_click_ref: '#56d4dd',
    browser_type: '#56d4dd', browser_fill_ref: '#56d4dd',
    browser_press_key: '#56d4dd', browser_scroll: '#56d4dd',
    browser_get_text: '#56d4dd', browser_get_html: '#56d4dd',
    browser_wait_for: '#56d4dd', browser_eval: '#56d4dd', browser_summary: '#56d4dd',
    browser_back: '#56d4dd', browser_forward: '#56d4dd', browser_reload: '#56d4dd',
    browser_close_tab: '#56d4dd', browser_list_tabs: '#56d4dd',
    browser_url: '#56d4dd', browser_title: '#56d4dd',
    browser_hover: '#56d4dd', browser_drag: '#56d4dd', browser_scroll_to: '#56d4dd',
    browser_upload: '#56d4dd', browser_wait_load: '#56d4dd',
    browser_set_viewport: '#56d4dd', browser_reset_viewport: '#56d4dd',
    browser_cookies_get: '#56d4dd', browser_pdf: '#56d4dd',
    /* RETIRED — coordinate-input + game-bot pill colors. Re-enable in lockstep with the matching tools.
    browser_click_at: '#56d4dd', browser_mouse_move: '#56d4dd',
    browser_drag_at: '#56d4dd', browser_poll_until: '#56d4dd', browser_sample: '#56d4dd',
    browser_run_script: '#56d4dd', browser_stop_script: '#56d4dd', browser_script_status: '#56d4dd',
    browser_update_script_state: '#56d4dd',
    */
  };

  // Normalize MCP tool names: mcp__pipilot__search_codebase → search_codebase
  function normalizeToolName(name) {
    if (!name) return '';
    if (name.startsWith('mcp__pipilot__')) return name.slice('mcp__pipilot__'.length);
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      return parts.length >= 3 ? parts.slice(2).join('__') : name;
    }
    return name;
  }

  function iconFor(name, kind) {
    const n = normalizeToolName(name);
    // Check normalized name first, then original
    if (TOOL_ICONS[n]) return TOOL_ICONS[n];
    if (TOOL_ICONS[name]) return TOOL_ICONS[name];
    // MCP tools get a plug icon
    if (kind === 'mcp_tool_use' || (name && name.startsWith('mcp__'))) {
      return S('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>');
    }
    return TOOL_ICONS.default;
  }
  // ── Path sanitization (matches Vite) ──
  function sanitizePath(p) {
    if (!p || typeof p !== 'string') return '';
    // Normalize: backslashes → forward, collapse double/triple slashes, trim
    let s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim();
    // Strip drive letter duplications like C:/C:/ or /C:/
    s = s.replace(/^\/?[A-Za-z]:\/[A-Za-z]:\//, m => m.slice(m.indexOf(':') + 1));
    // Strip project path prefix to show relative paths
    const pp = (window.PiPilot?.state?.projectPath || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (pp && s.startsWith(pp + '/')) s = s.slice(pp.length + 1);
    else if (pp && s.startsWith(pp)) s = s.slice(pp.length);
    // Remove leading / or ./
    s = s.replace(/^\.?\//, '');
    return s;
  }

  // File tool detection (for clickable deep links)
  const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'read_file', 'edit_file', 'create_file', 'write_file', 'delete_file', 'edit_file_patch']);

  // File path detection in text (for deep linking in markdown)
  const FILE_PATH_RE = /^(?:\.?\/?)?(?:[\w@.-]+\/)*[\w@.-]+\.\w{1,10}$/;
  const KNOWN_EXTS = /\.(tsx?|jsx?|css|scss|html?|json|md|ya?ml|toml|vue|svelte|py|go|rs|rb|php|sh|sql|env|lock|config|mjs|cjs)$/i;
  function isFilePath(text) {
    const t = (text || '').trim();
    if (t.length < 3 || t.length > 200) return false;
    if (!FILE_PATH_RE.test(t)) return false;
    return t.includes('/') || KNOWN_EXTS.test(t);
  }

  function openFileInEditor(filePath) {
    let clean = filePath.trim().replace(/\\/g, '/');
    const pp = (window.PiPilot?.state?.projectPath || '').replace(/\\/g, '/');
    // Strip leading ./
    clean = clean.replace(/^\.\//, '');
    // Check if already absolute
    const isAbsolute = clean.startsWith('/') || /^[a-zA-Z]:/.test(clean);
    const fullPath = isAbsolute ? clean : (pp ? pp + '/' + clean : clean);
    // Normalize to OS separator
    const sep = navigator.platform?.includes('Win') ? '\\' : '/';
    bus.emit('file:open', { path: fullPath.replace(/\//g, sep) });
  }

  function previewFor(name, input) {
    if (!input || typeof input !== 'object') return '';
    const n = normalizeToolName(name);
    const filePath = input.file_path || input.filepath || input.path;
    // File tools — show sanitized path
    if (FILE_TOOLS.has(n) || FILE_TOOLS.has(name)) {
      if (filePath) return sanitizePath(filePath);
    }
    // PiPilot custom tools — show meaningful previews
    if (n === 'get_working_directory') return 'orient';
    if (n === 'get_diagnostics') return input.source ? `source: ${input.source}` : 'all checks';
    if (n === 'search_codebase') return input.query ? `"${input.query}"` : '';
    if (n === 'frontend_design_guide') return input.action || 'scan';
    if (n === 'screenshot_preview') return input.url || '';
    if (n === 'generate_image') return input.description ? input.description.slice(0, 50) : '';
    if (n === 'project_context' || n === 'update_project_context') return 'scan project';
    if (n === 'project_memory') return input.action === 'save' ? `save: ${input.key || ''}` : (input.action || 'read');
    if (n === 'edit_file_patch') return input.filepath ? sanitizePath(input.filepath) : '';
    if (n === 'fetch_url') return input.url ? input.url.replace(/^https?:\/\//, '').slice(0, 60) : '';
    if (n === 'run_code') return input.language ? `${input.language}` : '';
    // Embedded browser tools
    if (n === 'browser_open' || n === 'browser_navigate') {
      const u = input.url || '';
      return u ? u.replace(/^https?:\/\//, '').slice(0, 60) : '';
    }
    if (n === 'browser_observe' || n === 'browser_snapshot' || n === 'browser_summary' || n === 'browser_console_log' ||
        n === 'browser_back' || n === 'browser_forward' || n === 'browser_reload' ||
        n === 'browser_url' || n === 'browser_title' || n === 'browser_list_tabs') {
      // No input worth showing — pill stays clean
      return '';
    }
    if (n === 'browser_close_tab') return input.tabId ? input.tabId.slice(-12) : '';
    if (n === 'browser_click')     return input.selector || '';
    if (n === 'browser_click_ref') return input.ref ? `[ref=${input.ref}]` : '';
    if (n === 'browser_type') {
      const sel = input.selector || '';
      const txt = (input.text || '').slice(0, 40);
      return sel ? `${sel} ← "${txt}"` : `"${txt}"`;
    }
    if (n === 'browser_fill_ref') {
      const ref = input.ref ? `[ref=${input.ref}]` : '';
      const txt = (input.text || '').slice(0, 40);
      return ref ? `${ref} ← "${txt}"` : `"${txt}"`;
    }
    if (n === 'browser_press_key') return input.key || '';
    if (n === 'browser_scroll') {
      if (input.to != null) return `to ${input.to}px`;
      if (input.dy != null) return `${input.dy > 0 ? '↓' : '↑'} ${Math.abs(input.dy)}px`;
      return '';
    }
    if (n === 'browser_get_text' || n === 'browser_get_html') return input.selector || '(whole page)';
    if (n === 'browser_wait_for') return input.selector || '';
    if (n === 'browser_eval') return (input.expression || '').slice(0, 60);
    if (n === 'browser_hover') return input.selector || '';
    if (n === 'browser_drag') return `${input.from || ''} → ${input.to || ''}`;
    if (n === 'browser_scroll_to') return input.selector || '';
    if (n === 'browser_upload') return input.selector ? `${input.selector} (${(input.files || []).length} file${(input.files || []).length === 1 ? '' : 's'})` : '';
    if (n === 'browser_wait_load') return input.idleMs ? `idle ${input.idleMs}ms` : '';
    if (n === 'browser_set_viewport') return `${input.width}×${input.height}`;
    if (n === 'browser_reset_viewport' || n === 'browser_cookies_get') return '';
    if (n === 'browser_pdf') return input.name || '';
    /* RETIRED — coordinate-input + game-bot previewFor cases. Re-enable in lockstep with the matching tools.
    if (n === 'browser_click_at') return `(${input.x}, ${input.y})`;
    if (n === 'browser_mouse_move') return `(${input.x}, ${input.y})`;
    if (n === 'browser_drag_at') return `(${input.x1},${input.y1}) → (${input.x2},${input.y2})`;
    if (n === 'browser_poll_until') return (input.expression || '').slice(0, 50);
    if (n === 'browser_sample') return `${input.durationMs || 3000}ms @ ${input.intervalMs || 100}ms`;
    if (n === 'browser_run_script') return input.name ? `${input.name} (${input.useRaf ? 'rAF' : (input.intervalMs || 100) + 'ms'})` : '';
    if (n === 'browser_stop_script') return input.name || '';
    if (n === 'browser_script_status') return input.name || '(list all)';
    if (n === 'browser_update_script_state') return input.name ? `${input.name}: ${Object.keys(input.patch || {}).join(', ').slice(0, 40)}` : '';
    */
    // Bash — show $ command (Vite style)
    if (name === 'Bash' || name === 'BashOutput') {
      const cmd = input.command || input.bash_id || '';
      return cmd ? `$ ${cmd.slice(0, 80)}` : '';
    }
    if (name === 'run_in_terminal') return input.command ? `$ ${input.command.slice(0, 80)}` : '';
    // Search
    if (name === 'Glob' || name === 'Grep') return input.pattern || '';
    if (name === 'WebFetch' || name === 'WebSearch') return input.url || input.query || '';
    // Agent/Task
    if (name === 'Agent' || name === 'Task' || name === 'SubAgent') return input.description || input.prompt?.slice(0, 60) || '';
    if (name === 'TodoWrite') return `${(input.todos || []).length} item(s)`;
    if (name === 'AskUserQuestion') return input.question?.header || input.question || '';
    // Content preview
    if (input.content && typeof input.content === 'string') return input.content.slice(0, 50) + (input.content.length > 50 ? '…' : '');
    if (input.oldPath) return `${sanitizePath(input.oldPath)} → ${sanitizePath(input.newPath)}`;
    if (input.query) return `"${input.query}"`;
    if (Array.isArray(input.files)) return `${input.files.length} files`;
    if (input.description) return input.description;
    for (const v of Object.values(input)) {
      if (typeof v === 'string' && v.length && v.length < 100) return v;
    }
    return '';
  }

  // Check if a tool pill should have a clickable deep link
  function getDeepLinkPath(name, input) {
    if (!input) return null;
    const n = normalizeToolName(name);
    const filePath = input.file_path || input.filepath || input.path;
    if ((FILE_TOOLS.has(n) || FILE_TOOLS.has(name)) && filePath) return filePath;
    return null;
  }
  function friendlyName(name, kind, serverName) {
    const n = normalizeToolName(name);
    // Check our label map first
    if (TOOL_LABELS[n]) return TOOL_LABELS[n];
    if (TOOL_LABELS[name]) return TOOL_LABELS[name];
    // MCP tools: show server·tool format
    if (kind === 'mcp_tool_use' && name && name.startsWith('mcp__')) {
      const parts = name.split('__');
      if (parts.length >= 3) {
        const server = parts[1];
        const tool = parts.slice(2).join('_');
        // For our own tools, just show the tool name prettified
        if (server === 'pipilot') return tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `${server}·${tool}`;
      }
    }
    if (serverName) return `${serverName}·${name}`;
    // Fallback: prettify the name
    return (name || 'tool').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Status icon SVGs (matching Vite ToolCallCard)
  const STATUS_SVGS = {
    running: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>',
    success: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    pending: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  };

  // ---------- Rich tool input/output renderers ----------
  function renderToolInput(name, input) {
    const frag = document.createDocumentFragment();
    if (!input || typeof input !== 'object') {
      const sec = document.createElement('div');
      sec.className = 'section';
      sec.innerHTML = `<div class="section-label">Input</div>`;
      sec.appendChild(document.createTextNode(String(input)));
      frag.appendChild(sec);
      return frag;
    }

    const filePath = input.file_path || input.path || '';

    if (name === 'Edit') {
      if (filePath) {
        const header = document.createElement('div');
        header.className = 'tool-rich-file-header';
        header.textContent = filePath;
        frag.appendChild(header);
      }
      const diff = document.createElement('div');
      diff.className = 'tool-diff';
      const oldStr = input.old_string || '';
      const newStr = input.new_string || '';
      const oldLines = oldStr.split('\n');
      const newLines = newStr.split('\n');
      let html = '';
      oldLines.forEach(line => {
        html += `<div class="diff-line diff-del"><span class="diff-sign">-</span><span class="diff-text">${escapeHtml(line)}</span></div>`;
      });
      newLines.forEach(line => {
        html += `<div class="diff-line diff-add"><span class="diff-sign">+</span><span class="diff-text">${escapeHtml(line)}</span></div>`;
      });
      if (input.replace_all) {
        html += `<div class="diff-line diff-meta"><span class="diff-sign">*</span><span class="diff-text">replace_all: true</span></div>`;
      }
      diff.innerHTML = html;
      frag.appendChild(diff);
      return frag;
    }

    if (name === 'Write') {
      if (filePath) {
        const header = document.createElement('div');
        header.className = 'tool-rich-file-header';
        header.textContent = filePath;
        frag.appendChild(header);
      }
      const code = document.createElement('div');
      code.className = 'tool-code-block';
      const content = input.content || '';
      const lines = content.split('\n').slice(0, 80);
      const truncated = content.split('\n').length > 80;
      code.innerHTML = lines.map((line, i) =>
        `<div class="code-line"><span class="code-ln">${i + 1}</span><span class="code-text">${escapeHtml(line)}</span></div>`
      ).join('') + (truncated ? `<div class="code-line code-trunc"><span class="code-ln">...</span><span class="code-text">${content.split('\n').length - 80} more lines</span></div>` : '');
      frag.appendChild(code);
      return frag;
    }

    if (name === 'Bash' || name === 'BashOutput') {
      if (input.description) {
        const desc = document.createElement('div');
        desc.className = 'tool-bash-desc';
        desc.textContent = input.description;
        frag.appendChild(desc);
      }
      const cmd = document.createElement('div');
      cmd.className = 'tool-bash-cmd';
      cmd.innerHTML = `<span class="bash-prompt">$</span> ${escapeHtml(input.command || '')}`;
      frag.appendChild(cmd);
      return frag;
    }

    if (name === 'Read') {
      if (filePath) {
        const header = document.createElement('div');
        header.className = 'tool-rich-file-header';
        header.textContent = filePath;
        frag.appendChild(header);
      }
      if (input.offset || input.limit) {
        const meta = document.createElement('div');
        meta.className = 'tool-meta-line';
        meta.textContent = `lines ${input.offset || 0}--${(input.offset || 0) + (input.limit || '?')}`;
        frag.appendChild(meta);
      }
      return frag;
    }

    if (name === 'Grep' || name === 'Glob') {
      const sec = document.createElement('div');
      sec.className = 'section';
      const pattern = input.pattern || '';
      sec.innerHTML = `<div class="tool-rich-file-header" style="color:var(--accent);">${escapeHtml(pattern)}</div>`;
      if (input.path) {
        const meta = document.createElement('div');
        meta.className = 'tool-meta-line';
        meta.textContent = `in ${input.path}`;
        sec.appendChild(meta);
      }
      frag.appendChild(sec);
      return frag;
    }

    // Feature #11: Terminal command card input
    if (name === 'run_in_terminal') {
      if (input.command) {
        const cmd = document.createElement('div');
        cmd.className = 'tool-bash-cmd';
        cmd.innerHTML = `<span class="bash-prompt">$</span> ${escapeHtml(input.command)}`;
        frag.appendChild(cmd);
      }
      const actions = document.createElement('div');
      actions.className = 'terminal-actions';
      const openBtn = document.createElement('button');
      openBtn.className = 'terminal-action-btn';
      openBtn.textContent = 'Open Shell';
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bus.emit('terminal:open', { command: input.command });
      });
      const runBtn = document.createElement('button');
      runBtn.className = 'terminal-action-btn';
      runBtn.textContent = 'Run Command';
      runBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bus.emit('terminal:run', { command: input.command });
      });
      actions.appendChild(openBtn);
      actions.appendChild(runBtn);
      frag.appendChild(actions);
      return frag;
    }

    // Fallback: JSON
    const sec = document.createElement('div');
    sec.className = 'section';
    sec.innerHTML = `<div class="section-label">Input</div>`;
    const code = document.createElement('div');
    let str;
    try { str = JSON.stringify(input, null, 2); } catch { str = String(input); }
    code.textContent = str.slice(0, 6000);
    sec.appendChild(code);
    frag.appendChild(sec);
    return frag;
  }

  // Strip ANSI escape codes from terminal output
  function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '').replace(/[\x00-\x08\x0e-\x1f]/g, '');
  }

  function renderToolOutput(name, content, isError) {
    const frag = document.createDocumentFragment();
    let text = typeof content === 'string' ? content : (content == null ? '' : JSON.stringify(content));
    // Clean ANSI codes from all tool output
    text = stripAnsi(text);

    if (isError) {
      const sec = document.createElement('div');
      sec.className = 'section';
      sec.innerHTML = `<div class="section-label" style="color:var(--error);">Error</div>`;
      const out = document.createElement('div');
      out.className = 'result-err';
      out.textContent = text.slice(0, 8000);
      sec.appendChild(out);
      frag.appendChild(sec);
      return frag;
    }

    if ((name === 'Bash' || name === 'BashOutput' || name === 'run_in_terminal') && text) {
      const out = document.createElement('div');
      out.className = 'tool-bash-output';
      out.textContent = text.slice(0, 8000) + (text.length > 8000 ? '\n... (truncated)' : '');
      frag.appendChild(out);
      return frag;
    }

    if (name === 'Read' && text && !text.startsWith('{')) {
      const code = document.createElement('div');
      code.className = 'tool-code-block';
      const lines = text.split('\n').slice(0, 60);
      const truncated = text.split('\n').length > 60;
      code.innerHTML = lines.map((line, i) =>
        `<div class="code-line"><span class="code-ln">${i + 1}</span><span class="code-text">${escapeHtml(line)}</span></div>`
      ).join('') + (truncated ? `<div class="code-line code-trunc"><span class="code-ln">...</span><span class="code-text">${text.split('\n').length - 60} more lines</span></div>` : '');
      frag.appendChild(code);
      return frag;
    }

    if (name === 'Edit' && text) {
      const out = document.createElement('div');
      out.className = 'tool-meta-line';
      out.style.color = 'var(--ok)';
      out.textContent = text.length < 200 ? text : text.slice(0, 200) + '...';
      frag.appendChild(out);
      return frag;
    }

    if (name === 'Write' && text) {
      const out = document.createElement('div');
      out.className = 'tool-meta-line';
      out.style.color = 'var(--ok)';
      out.textContent = text.length < 200 ? text : text.slice(0, 200) + '...';
      frag.appendChild(out);
      return frag;
    }

    // Fallback
    const sec = document.createElement('div');
    sec.className = 'section';
    sec.innerHTML = `<div class="section-label">Output</div>`;
    const out = document.createElement('div');
    out.className = 'result-ok';
    out.textContent = text.slice(0, 8000) + (text.length > 8000 ? '\n... (truncated)' : '');
    sec.appendChild(out);
    frag.appendChild(sec);
    return frag;
  }

  // Feature #9: Check if tool is a sub-agent
  function isSubAgentTool(name) {
    return name === 'Agent' || name === 'Task' || name === 'SubAgent';
  }

  function getSubagentCard(root, toolUseId) {
    if (!root || !toolUseId) return null;
    return root.querySelector(`.subagent-card[data-tool-id="${CSS.escape(toolUseId)}"]`);
  }

  function updateSubagentCounts(cardEl) {
    if (!cardEl) return;
    const total = parseInt(cardEl.dataset.childTotal || '0', 10) || 0;
    const done = parseInt(cardEl.dataset.childDone || '0', 10) || 0;
    const headerCount = cardEl.querySelector('.subagent-actions-count');
    if (headerCount) headerCount.textContent = `Agent actions (${total})`;
    const collapsed = cardEl.querySelector('.subagent-collapsed');
    if (collapsed) collapsed.textContent = `${done}/${total} actions completed`;
  }

  // Make a collapsed summary area expandable with full markdown rendering
  function makeExpandableCollapsed(el, fullText) {
    const preview = fullText.split('\n').filter(l => l.trim())[0] || '';
    const truncated = preview.slice(0, 120) + (fullText.length > 120 ? '…' : '');
    el.textContent = truncated;
    el.style.cursor = 'pointer';
    el.title = 'Click to expand full response';
    let isExpanded = false;

    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      isExpanded = !isExpanded;
      if (isExpanded) {
        el.style.whiteSpace = 'normal';
        el.style.overflow = 'visible';
        el.style.maxHeight = '400px';
        el.style.overflowY = 'auto';
        el.style.padding = '8px 12px 10px 48px';
        // Render as markdown
        if (window.marked) {
          try {
            el.innerHTML = window.marked.parse(fullText);
            el.classList.add('md-body');
          } catch {
            el.textContent = fullText;
          }
        } else {
          el.textContent = fullText;
        }
      } else {
        el.style.whiteSpace = '';
        el.style.overflow = '';
        el.style.maxHeight = '';
        el.style.overflowY = '';
        el.style.padding = '';
        el.classList.remove('md-body');
        el.textContent = truncated;
      }
    });
  }

  function toolShortLabel(name) {
    if (!name) return '';
    const clean = String(name).replace(/^mcp__/, '');
    return clean.length > 10 ? clean.slice(0, 10) : clean;
  }

  function appendSubagentChildRow(parentCard, call) {
    const list = parentCard?.querySelector('.subagent-actions-list');
    if (!list) return null;
    const row = document.createElement('div');
    row.className = 'subagent-child running';
    row.dataset.toolId = call.id;
    row.dataset.toolName = call.name || '';

    const shortName = String(call.name || '').replace(/^mcp__/, '').slice(0, 6);
    const summary = previewFor(call.name, call.input) || call.name || '';
    const SMALL_SPINNER = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>';
    row.innerHTML = `
      <span class="subagent-child-status">${SMALL_SPINNER}</span>
      <span class="subagent-child-label">${escapeHtml(shortName)}</span>
      <span class="subagent-child-summary">${escapeHtml(summary)}</span>
    `;
    list.appendChild(row);
    return row;
  }

  // Feature #10: Check if tool is sequential thinking
  function isSequentialThinking(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return lower.includes('sequentialthinking') || lower.includes('sequential_thinking');
  }
  // Our own pipilot reason tool — same routing path as the legacy
  // sequential-thinking MCP, but cleanly typed and always available.
  function isPipilotReason(name) {
    return name === 'mcp__pipilot__reason' || name === 'reason';
  }

  function appendToolCard(call) {
    const wrap = ensureAssistantMessage();
    const isMcp = call.kind === 'mcp_tool_use' || (call.name && call.name.startsWith('mcp__'));
    const isSubAgent = isSubAgentTool(call.name);
    const isSeqThinking = isSequentialThinking(call.name);
    const isReason = isPipilotReason(call.name);
    const isTerminal = call.name === 'run_in_terminal';

    // Sequential-thinking OR our pipilot reason tool → render in CoT.
    if (isSeqThinking || isReason) {
      sequentialThinkingCount++;
      const input = call.input || {};
      const thoughtText = input.thought || '';
      // Single-call reasoning model — one card titled "Reasoning",
      // markdown body inside. Kept the legacy seq-thinking step
      // labels for back-compat with that MCP if a user re-enables it.
      const label = isReason
        ? ''
        : `Thinking ${input.thoughtNumber || sequentialThinkingCount}/${input.totalThoughts || '?'}`;
      addCotStep(wrap, {
        iconName: 'brain',
        label,
        cardLabel: isReason ? 'Reasoning' : undefined,
        descriptionHTML: renderMarkdown(thoughtText),
        toolId: call.id,
      });
      currentAssistantBlocks.push({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
      scrollToBottom();
      return;
    }

    // If this tool call is a child of a sub-agent, nest it under the parent card.
    // (Matches Vite: parentToolUseId -> grouped "Agent actions")
    let targetBw = null;
    let parentCard = null;
    try {
      const baseBw = getBodyWrap(wrap);
      if (call.parentToolUseId) {
        parentCard = getSubagentCard(baseBw, call.parentToolUseId);
        if (parentCard) {
          targetBw = parentCard.querySelector('.subagent-actions-list') || baseBw;
          parentCard.dataset.childTotal = String((parseInt(parentCard.dataset.childTotal || '0', 10) || 0) + 1);
          updateSubagentCounts(parentCard);
        }
      }
      if (!targetBw) {
        const streamEl = baseBw.querySelector('.msg-streaming-indicator');
        targetBw = baseBw;
        // We'll insert before stream indicator later
      }
    } catch {}

    // Vite-style subagent card (container that nests child tool calls)
    if (isSubAgent) {
      const card = document.createElement('div');
      card.className = 'subagent-card running';
      card.dataset.toolId = call.id;
      card.dataset.toolName = call.name || '';
      card.dataset.childTotal = '0';
      card.dataset.childDone = '0';

      const preview = previewFor(call.name, call.input);

      const agentDesc = (call.input && (call.input.description || call.input.prompt?.slice(0, 60))) || 'Sub-agent task';

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'subagent-head';
      head.innerHTML = `
        <div class="subagent-status-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
        </div>
        <div class="subagent-info">
          <div class="subagent-status-text">&#9889; Agent working</div>
          <div class="subagent-desc">${escapeHtml(agentDesc)}</div>
        </div>
        <span class="subagent-timer"></span>
        <span class="tool-pill-chevron">&#9662;</span>
      `;

      // Start elapsed timer
      const startTime = Date.now();
      const timerEl = head.querySelector('.subagent-timer');
      const timerInterval = setInterval(() => {
        const s = Math.floor((Date.now() - startTime) / 1000);
        if (timerEl) timerEl.textContent = s < 60 ? s + 's' : Math.floor(s/60) + 'm ' + (s%60) + 's';
      }, 1000);
      card.dataset.timerInterval = String(timerInterval);

      // Progress bar
      const progressBar = document.createElement('div');
      progressBar.className = 'subagent-progress-bar';
      progressBar.innerHTML = '<div class="subagent-progress-fill"></div>';

      const body = document.createElement('div');
      body.className = 'subagent-body';
      body.style.display = 'none';
      body.innerHTML = `
        <div class="subagent-actions-head">
          <span class="subagent-actions-count">Agent actions (0)</span>
          <span class="subagent-actions-chevron">&#9656;</span>
        </div>
        <div class="subagent-actions-list"></div>
      `;

      const collapsed = document.createElement('div');
      collapsed.className = 'subagent-collapsed';
      collapsed.textContent = '';

      card.appendChild(head);
      card.appendChild(progressBar);
      card.appendChild(body);
      card.appendChild(collapsed);

      const toggle = () => {
        const expanded = card.classList.toggle('expanded');
        body.style.display = expanded ? 'block' : 'none';
        collapsed.style.display = expanded ? 'none' : 'block';
      };
      head.addEventListener('click', toggle);
      body.querySelector('.subagent-actions-head')?.addEventListener('click', () => {
        card.classList.toggle('actions-expanded');
        const list = body.querySelector('.subagent-actions-list');
        if (list) list.style.display = card.classList.contains('actions-expanded') ? 'block' : 'none';
        const chev = body.querySelector('.subagent-actions-chevron');
        if (chev) chev.textContent = card.classList.contains('actions-expanded') ? '▼' : '▶';
      });

      const bw = getBodyWrap(wrap);
      const streamEl = bw.querySelector('.msg-streaming-indicator');
      if (streamEl) bw.insertBefore(card, streamEl);
      else bw.appendChild(card);

      currentAssistantBlocks.push({ type: 'tool_call', id: call.id, name: call.name, input: call.input, parentToolUseId: call.parentToolUseId || null });
      scrollToBottom();
      return;
    }

    // If nested under a subagent, render as a compact action row (Vite-like)
    if (parentCard) {
      appendSubagentChildRow(parentCard, call);
      currentAssistantBlocks.push({ type: 'tool_call', id: call.id, name: call.name, input: call.input, parentToolUseId: call.parentToolUseId || null });
      scrollToBottom();
      return;
    }

    const pill = document.createElement('div');
    let kindClass = '';
    if (isMcp) kindClass = ' kind-mcp';
    else if (isSubAgent) kindClass = ' kind-subagent';
    else if (isTerminal) kindClass = ' kind-terminal';
    pill.className = 'tool-pill running' + kindClass;
    pill.dataset.toolId = call.id;
    pill.dataset.toolName = call.name || '';
    if (isSubAgent) pill.dataset.startTime = String(Date.now());

    const preview = previewFor(call.name, call.input);
    const deepLink = getDeepLinkPath(call.name, call.input);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'tool-pill-head';

    // Feature #9: Sub-agent badge (non-grouped tools)
    let extraHtml = '';
    if (isSubAgent) {
      extraHtml = `<span class="subagent-badge running">running</span>`;
    }

    const toolLabel = friendlyName(call.name, call.kind, call.serverName);
    // Bash: show description above command (matches Vite ToolCallCard)
    const bashDesc = (call.name === 'Bash' || isTerminal) && call.input
      ? (call.input.description || call.input.explanation || null)
      : null;

    if (bashDesc) {
      const desc = document.createElement('div');
      desc.className = 'tool-pill-bash-desc';
      desc.textContent = bashDesc;
      pill.appendChild(desc);
    }

    head.innerHTML = `
      <span class="tool-pill-status ${isMcp ? 'mcp' : 'running'}">${isMcp ? STATUS_SVGS.pending : STATUS_SVGS.running}</span>
      <span class="tool-pill-icon">${iconFor(call.name, call.kind)}</span>
      <span class="tool-pill-label">${escapeHtml(toolLabel)}</span>
      ${extraHtml}
      ${preview ? `<span class="tool-pill-sep">/</span><span class="tool-pill-summary${deepLink ? ' tool-pill-deeplink' : ''}" ${deepLink ? `data-deeplink="${escapeHtml(deepLink)}" title="Open ${escapeHtml(sanitizePath(deepLink))} in editor"` : ''}>${escapeHtml(preview)}</span>` : ''}
      <span class="tool-pill-chevron">&#9656;</span>
    `;
    // Wire deep link click
    if (deepLink) {
      const link = head.querySelector('.tool-pill-deeplink');
      if (link) link.addEventListener('click', (e) => { e.stopPropagation(); openFileInEditor(deepLink); });
    }
    pill.appendChild(head);

    const body = document.createElement('div');
    body.className = 'tool-pill-body';

    // Vite-style sections: Arguments + (later) Result
    const argsSec = document.createElement('div');
    argsSec.className = 'tool-pill-sec';
    argsSec.innerHTML = `<div class="tool-pill-sec-label">Arguments</div>`;
    const argsPre = document.createElement('pre');
    argsPre.className = 'tool-pill-pre';
    try {
      argsPre.textContent = JSON.stringify(call.input || {}, null, 2);
    } catch {
      argsPre.textContent = String(call.input || '');
    }
    argsSec.appendChild(argsPre);
    body.appendChild(argsSec);

    const resSec = document.createElement('div');
    resSec.className = 'tool-pill-sec tool-pill-result-sec';
    resSec.innerHTML = `<div class="tool-pill-sec-label">Result</div>`;
    const resWrap = document.createElement('div');
    resWrap.className = 'tool-pill-result-wrap';
    resSec.appendChild(resWrap);
    body.appendChild(resSec);

    // Feature #9: Sub-agent progress bar
    if (isSubAgent) {
      const bar = document.createElement('div');
      bar.className = 'subagent-bar';
      bar.innerHTML = `
        <div class="subagent-progress"><div class="subagent-progress-fill"></div></div>
        <span class="subagent-elapsed">0s</span>
      `;
      body.appendChild(bar);
    }

    pill.appendChild(body);
    body.style.display = 'none';
    head.addEventListener('click', () => {
      const expanded = pill.classList.toggle('expanded');
      body.style.display = expanded ? 'block' : 'none';
    });

    // Insert either into the main body stream or nested in a subagent
    const baseBw = getBodyWrap(wrap);
    if (targetBw && targetBw !== baseBw) {
      targetBw.appendChild(pill);
    } else {
      const streamEl = baseBw.querySelector('.msg-streaming-indicator');
      if (streamEl) baseBw.insertBefore(pill, streamEl);
      else baseBw.appendChild(pill);
    }

    // Accumulate block for IndexedDB
    currentAssistantBlocks.push({ type: 'tool_call', id: call.id, name: call.name, input: call.input, parentToolUseId: call.parentToolUseId || null });
    scrollToBottom();
  }

  function markToolResult(toolUseId, content, isError) {
    if (!currentAssistantEl) return;

    // Handle sequential thinking — now rendered as a CoT step
    const seqStep = currentAssistantEl.querySelector(`.cot-step[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (seqStep) {
      seqStep.dataset.status = isError ? 'pending' : 'complete';
      currentAssistantBlocks.push({ type: 'tool_result', toolUseId, content, isError });
      return;
    }

    // Subagent card completion (Vite-style update)
    const subCard = currentAssistantEl.querySelector(`.subagent-card[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (subCard) {
      subCard.classList.remove('running');
      if (isError) subCard.classList.add('error');
      // Stop timer
      const tid = subCard.dataset.timerInterval;
      if (tid) { clearInterval(parseInt(tid)); delete subCard.dataset.timerInterval; }
      // Update status badge
      const badge = subCard.querySelector('.subagent-status-badge');
      if (badge) {
        badge.innerHTML = isError
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      }
      // Update status text
      const statusText = subCard.querySelector('.subagent-status-text');
      if (statusText) statusText.textContent = isError ? '✗ Agent failed' : '✓ Agent completed';
      // Remove progress bar
      const progressBar = subCard.querySelector('.subagent-progress-bar');
      if (progressBar) progressBar.remove();
      // Show result summary in collapsed area (clickable to expand)
      const collapsed = subCard.querySelector('.subagent-collapsed');
      if (collapsed && content) {
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        makeExpandableCollapsed(collapsed, text);
      }
      currentAssistantBlocks.push({ type: 'tool_result', toolUseId, content, isError });
      return;
    }

    // Child action row result
    const childRow = currentAssistantEl.querySelector(`.subagent-child[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (childRow) {
      childRow.classList.remove('running');
      childRow.classList.add(isError ? 'error' : 'done');
      const st = childRow.querySelector('.subagent-child-status');
      const SMALL_CHECK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      const SMALL_X = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      if (st) st.innerHTML = isError ? SMALL_X : SMALL_CHECK;

      currentAssistantBlocks.push({ type: 'tool_result', toolUseId, content, isError });

      try {
        const parent = childRow.closest('.subagent-card');
        if (parent) {
          parent.dataset.childDone = String((parseInt(parent.dataset.childDone || '0', 10) || 0) + 1);
          updateSubagentCounts(parent);
        }
      } catch {}
      return;
    }

    const pill = currentAssistantEl.querySelector(`.tool-pill[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (!pill) return;
    pill.classList.remove('running');
    if (isError) pill.classList.add('error');

    // Feature #9: Update sub-agent badge
    if (pill.classList.contains('kind-subagent')) {
      const badge = pill.querySelector('.subagent-badge');
      if (badge) {
        badge.classList.remove('running');
        badge.classList.add('done');
        badge.textContent = isError ? 'error' : 'done';
      }
      const fill = pill.querySelector('.subagent-progress-fill');
      if (fill) fill.style.width = '100%';
    }

    const status = pill.querySelector('.tool-pill-status');
    if (status && !status.classList.contains('mcp')) {
      status.classList.remove('running');
      status.classList.add(isError ? 'error' : 'success');
      status.innerHTML = isError ? STATUS_SVGS.error : STATUS_SVGS.success;
    } else if (status && status.classList.contains('mcp')) {
      status.classList.remove('mcp');
      status.classList.add(isError ? 'error' : 'success');
      status.innerHTML = isError ? STATUS_SVGS.error : STATUS_SVGS.success;
    }

    // Remove skip button if present
    const skipBtn = pill.querySelector('.tool-skip-btn');
    if (skipBtn) skipBtn.remove();

    const body = pill.querySelector('.tool-pill-body');
    if (body) {
      const toolName = pill.dataset.toolName || '';
      const resWrap = body.querySelector('.tool-pill-result-wrap');
      const out = renderToolOutput(toolName, content, isError);
      if (resWrap) {
        resWrap.innerHTML = '';
        resWrap.appendChild(out);
      } else {
        body.appendChild(out);
      }
    }

    // Accumulate block for IndexedDB
    currentAssistantBlocks.push({ type: 'tool_result', toolUseId, content, isError });

    // If this tool is nested under a subagent, mark completion counts
    try {
      const parentCard = pill.closest('.subagent-card');
      if (parentCard) {
        parentCard.dataset.childDone = String((parseInt(parentCard.dataset.childDone || '0', 10) || 0) + 1);
        updateSubagentCounts(parentCard);
      }
    } catch {}
  }

  // ── ChainOfThought helpers ───────────────────────────────────────
  // One CoT block per assistant turn; each thinking/sequential-thinking
  // event becomes a step inside it. Prior step is flipped to "complete"
  // when the next step arrives.
  // Each reasoning event gets its OWN inline CoT card — same flow as tool
  // pills. We never reuse a single big card across an assistant turn, so
  // multi-stage reasoning reads as a sequence of compact pills in the
  // message stream rather than one giant grouped panel.
  function createCotCard(wrap, headerLabel) {
    if (!window.ChainOfThought) return null;
    const bw = getBodyWrap(wrap);
    const streamEl = bw.querySelector('.msg-streaming-indicator');
    const root = ChainOfThought.create({ open: false });
    ChainOfThought.header(root, headerLabel || 'Reasoning');
    const content = ChainOfThought.content(root);
    // Per-card user-toggle flag — auto-open/close on stream boundaries
    // respects this card's manual state without affecting sibling cards.
    root.addEventListener('cot:toggle', () => { root.dataset.userToggled = 'true'; });
    if (streamEl) bw.insertBefore(root, streamEl);
    else bw.appendChild(root);
    return { root, content };
  }

  // ── <reasoning> inline-tag streaming parser ──────────────────────
  // The agent can wrap reasoning in <reasoning>...</reasoning>. We slice
  // those regions out of the streamed text and route them into a single
  // live Chain-of-Thought step that updates token-by-token. Edge cases
  // handled: tags split across chunks (we hold a small tail buffer),
  // multiple reasoning blocks per response, missing close tag (left
  // open until next start or message end). Code-fence detection is
  // intentionally skipped — a literal "<reasoning>" inside a fenced
  // code block will trigger; tell the agent to escape it if needed.
  const REAS_OPEN = '<reasoning>';
  const REAS_CLOSE = '</reasoning>';

  function setCardOpen(root, open) {
    if (!root || root.dataset.userToggled === 'true') return;
    root.dataset.open = String(open);
    const btn = root.querySelector('.cot-header');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }

  function startReasoningStep(wrap) {
    wrap._inReasoning = true;
    wrap._reasoningAccum = '';
    // Empty step label — the card header already says "Reasoning" with a
    // brain icon, so an inner label would just duplicate it visually.
    const step = addCotStep(wrap, { iconName: 'brain', label: '', cardLabel: 'Reasoning' });
    if (!step) return;
    wrap._reasoningStep = step;
    wrap._reasoningRoot = step._cardRoot || null;
    // Reuse / create the description element so live chunks land in one place.
    let descEl = step.body.querySelector('.cot-step-description');
    if (!descEl) {
      descEl = document.createElement('div');
      descEl.className = 'cot-step-description';
      step.body.appendChild(descEl);
    }
    descEl.classList.add('md-body');
    wrap._reasoningDescEl = descEl;
    setCardOpen(wrap._reasoningRoot, true);
  }

  function appendReasoningChunk(wrap, text) {
    if (!text) return;
    wrap._reasoningAccum = (wrap._reasoningAccum || '') + text;
    if (!wrap._reasoningDescEl) return;
    // If the accumulated text starts to look like a JSON envelope
    // (the model emitting {"kind":..., "thought":...} inside the
    // reasoning tag), unwrap it on the fly — render only the
    // `thought` field as markdown. This kicks in only once the JSON
    // looks closeable so we don't fight partial-stream parses.
    let render = wrap._reasoningAccum;
    const trimmed = render.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && typeof obj.thought === 'string') {
          render = obj.thought;
        }
      } catch {}
    }
    // Render reasoning as markdown so headings, bullets, tables, code blocks,
    // and inline code light up exactly like assistant text. Re-rendering on
    // every chunk is fine — partial markdown (mid-fence, mid-list) is what
    // the main message body does too, and it self-corrects as more text
    // arrives. Mark this region so attached helpers (copy buttons, mermaid)
    // can run on the same nodes the main body uses.
    wrap._reasoningDescEl.classList.add('md-body');
    wrap._reasoningDescEl.dataset.text = render;
    wrap._reasoningDescEl.innerHTML = renderMarkdown(render);
    try {
      attachCopyButtons(wrap._reasoningDescEl);
      wrapOverflowingContent(wrap._reasoningDescEl);
    } catch {}
  }

  function finalizeReasoningStep(wrap) {
    wrap._inReasoning = false;
    if (wrap._reasoningStep && wrap._reasoningStep.setStatus) {
      wrap._reasoningStep.setStatus('complete');
    }
    // Persist as a thinking block so history reload renders it via the
    // existing thinking-block code path (no special-case needed there).
    const acc = (wrap._reasoningAccum || '').trim();
    if (acc) currentAssistantBlocks.push({ type: 'thinking', text: acc });
    setCardOpen(wrap._reasoningRoot, false);
    wrap._reasoningStep = null;
    wrap._reasoningRoot = null;
    wrap._reasoningDescEl = null;
    wrap._reasoningAccum = '';
  }

  // Feed one streamed text chunk through the parser. Returns the portion
  // of the chunk that's outside any <reasoning> region — caller renders
  // that as normal markdown.
  // Compute how many trailing chars of `buf` could be the start of `tag`.
  // Returns 0 unless the tail matches a prefix of `tag`. This prevents
  // ordinary text ending in characters like "wor" from being held hostage
  // for the next chunk — only true partial-tag tails are buffered.
  function tailMatchLen(buf, tag) {
    const max = Math.min(tag.length - 1, buf.length);
    for (let n = max; n > 0; n--) {
      if (buf.endsWith(tag.slice(0, n))) return n;
    }
    return 0;
  }

  function feedReasoningParser(wrap, chunk) {
    let buf = (wrap._reasonBuf || '') + (chunk || '');
    let cleanOut = '';
    while (buf.length > 0) {
      if (wrap._inReasoning) {
        const idx = buf.indexOf(REAS_CLOSE);
        if (idx >= 0) {
          appendReasoningChunk(wrap, buf.slice(0, idx));
          finalizeReasoningStep(wrap);
          buf = buf.slice(idx + REAS_CLOSE.length);
          continue;
        }
        const hold = tailMatchLen(buf, REAS_CLOSE);
        const safe = buf.length - hold;
        if (safe > 0) {
          appendReasoningChunk(wrap, buf.slice(0, safe));
          buf = buf.slice(safe);
        }
        break;
      } else {
        const idx = buf.indexOf(REAS_OPEN);
        if (idx >= 0) {
          cleanOut += buf.slice(0, idx);
          buf = buf.slice(idx + REAS_OPEN.length);
          startReasoningStep(wrap);
          continue;
        }
        const hold = tailMatchLen(buf, REAS_OPEN);
        const safe = buf.length - hold;
        if (safe > 0) {
          cleanOut += buf.slice(0, safe);
          buf = buf.slice(safe);
        }
        break;
      }
    }
    wrap._reasonBuf = buf;
    return cleanOut;
  }

  // Flush any held-back tail to the appropriate destination. Call this
  // when a non-text event arrives (tool call, completion, error) so the
  // text that was waiting on a possible partial tag actually displays.
  function flushReasoningParser(wrap) {
    const buf = wrap._reasonBuf;
    if (!buf) return '';
    wrap._reasonBuf = '';
    if (wrap._inReasoning) {
      // Inside a reasoning block — push the leftover to the live step.
      appendReasoningChunk(wrap, buf);
      return '';
    }
    return buf;
  }

  function addCotStep(wrap, opts) {
    // One inline card per call (matches tool-pill cadence).
    const card = createCotCard(wrap, opts.cardLabel || 'Reasoning');
    if (!card) return null;
    const s = ChainOfThought.step(card.content, {
      iconName: opts.iconName || 'brain',
      label: opts.label || '',
      status: 'active',
    });
    if (opts.descriptionHTML) {
      const md = document.createElement('div');
      md.className = 'cot-step-description md-body';
      md.innerHTML = opts.descriptionHTML;
      s.body.appendChild(md);
    } else if (opts.descriptionText) {
      const pre = document.createElement('div');
      pre.className = 'cot-step-description';
      pre.textContent = opts.descriptionText;
      s.body.appendChild(pre);
    }
    if (opts.toolId) s.element.dataset.toolId = opts.toolId;
    s._cardRoot = card.root;
    return s;
  }

  function appendThinking(text) {
    const wrap = ensureAssistantMessage();
    addCotStep(wrap, {
      iconName: 'brain',
      label: 'Reasoning',
      descriptionText: text,
    });
    currentAssistantBlocks.push({ type: 'thinking', text });
    scrollToBottom();
  }

  // ---------- History rendering helpers (restore exact block order) ----------
  function ensureHistoryBody(wrap, afterTool) {
    if (!wrap) return null;
    const bw = wrap.querySelector('.msg-body-wrap') || wrap;
    const bodies = bw.querySelectorAll('.md-body');
    const lastBody = bodies[bodies.length - 1];
    if (!lastBody || afterTool) {
      const body = document.createElement('div');
      body.className = 'md-body';
      body.dataset.text = '';
      bw.appendChild(body);
      return body;
    }
    return lastBody;
  }

  function appendHistoryAssistantText(wrap, text, afterTool) {
    const body = ensureHistoryBody(wrap, afterTool);
    if (!body) return;
    body.dataset.text = (body.dataset.text || '') + (text || '');
    body.innerHTML = renderMarkdown(body.dataset.text);
    attachCopyButtons(body);
    attachFileDeepLinks(body);
    wrapOverflowingContent(body);
    renderMermaidBlocks(body);
  }

  function appendHistoryThinking(wrap, text) {
    // Reuse the same CoT helpers as live rendering so history looks identical.
    const step = addCotStep(wrap, {
      iconName: 'brain',
      label: 'Reasoning',
      descriptionText: text || '',
    });
    if (step && step.setStatus) step.setStatus('complete');
  }

  function appendHistoryToolCall(wrap, call) {
    const bw = wrap.querySelector('.msg-body-wrap') || wrap;
    const name = call?.name || '';
    const id = call?.id || call?.toolUseId || generateId();
    const input = call?.input;
    const parentToolUseId = call?.parentToolUseId || call?.parent_tool_use_id || call?.parent || null;

    // Sequential-thinking tool calls → add as a step in the CoT block
    if (isSequentialThinking(name)) {
      sequentialThinkingCount++;
      const totalSteps = (input && input.totalThoughts) || '?';
      const stepNum = (input && input.thoughtNumber) || sequentialThinkingCount;
      const histThought = (input && (input.thought || input.text)) || '';
      const step = addCotStep(wrap, {
        iconName: 'brain',
        label: `Thinking ${stepNum}/${totalSteps}`,
        descriptionHTML: renderMarkdown(histThought),
        toolId: id,
      });
      if (step && step.setStatus) step.setStatus('complete');
      return;
    }

    const isSubAgent = isSubAgentTool(name);
    const isTerminal = name === 'run_in_terminal';
    const isMcp = call?.kind === 'mcp_tool_use' || (name && name.startsWith('mcp__'));

    // If subagent: render Vite-style subagent card (same as live streaming)
    if (isSubAgent) {
      const card = document.createElement('div');
      card.className = 'subagent-card running';
      card.dataset.toolId = id;
      card.dataset.toolName = name;
      card.dataset.childTotal = '0';
      card.dataset.childDone = '0';

      const agentDesc = (input && (input.description || input.prompt?.slice(0, 60))) || 'Sub-agent task';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'subagent-head';
      head.innerHTML = `
        <div class="subagent-status-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
        </div>
        <div class="subagent-info">
          <div class="subagent-status-text">&#9889; Agent working</div>
          <div class="subagent-desc">${escapeHtml(agentDesc)}</div>
        </div>
        <span class="subagent-timer"></span>
        <span class="tool-pill-chevron">&#9662;</span>
      `;

      const progressBar = document.createElement('div');
      progressBar.className = 'subagent-progress-bar';
      progressBar.innerHTML = '<div class="subagent-progress-fill"></div>';

      const body = document.createElement('div');
      body.className = 'subagent-body';
      body.style.display = 'none';
      body.innerHTML = `
        <div class="subagent-actions-head">
          <span class="subagent-actions-count">Agent actions (0)</span>
          <span class="subagent-actions-chevron">&#9656;</span>
        </div>
        <div class="subagent-actions-list"></div>
      `;

      const collapsed = document.createElement('div');
      collapsed.className = 'subagent-collapsed';
      collapsed.textContent = '';

      card.appendChild(head);
      card.appendChild(progressBar);
      card.appendChild(body);
      card.appendChild(collapsed);

      const toggle = () => {
        const expanded = card.classList.toggle('expanded');
        body.style.display = expanded ? 'block' : 'none';
        collapsed.style.display = expanded ? 'none' : 'block';
      };
      head.addEventListener('click', toggle);
      body.querySelector('.subagent-actions-head')?.addEventListener('click', () => {
        card.classList.toggle('actions-expanded');
        const list = body.querySelector('.subagent-actions-list');
        if (list) list.style.display = card.classList.contains('actions-expanded') ? 'block' : 'none';
        const chev = body.querySelector('.subagent-actions-chevron');
        if (chev) chev.textContent = card.classList.contains('actions-expanded') ? '▼' : '▶';
      });

      bw.appendChild(card);
      return;
    }

    // If child tool call: try to nest under parent subagent card
    if (parentToolUseId) {
      const parent = bw.querySelector(`.subagent-card[data-tool-id="${CSS.escape(parentToolUseId)}"]`);
      const list = parent?.querySelector('.subagent-actions-list');
      if (parent && list) {
        parent.dataset.childTotal = String((parseInt(parent.dataset.childTotal || '0', 10) || 0) + 1);
        updateSubagentCounts(parent);

        const row = document.createElement('div');
        row.className = 'subagent-child running';
        row.dataset.toolId = id;
        row.dataset.toolName = name;
        const shortN = String(name || '').replace(/^mcp__/, '').slice(0, 6);
        const preview = previewFor(name, input) || name || '';
        row.innerHTML = `
          <span class="subagent-child-status"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg></span>
          <span class="subagent-child-label">${escapeHtml(shortN)}</span>
          <span class="subagent-child-summary">${escapeHtml(preview)}</span>
        `;
        list.appendChild(row);
        return;
      }
    }

    let kindClass = '';
    if (isMcp) kindClass = ' kind-mcp';
    else if (isTerminal) kindClass = ' kind-terminal';

    const pill = document.createElement('div');
    pill.className = 'tool-pill running' + kindClass;
    pill.dataset.toolId = id;
    pill.dataset.toolName = name;

    const preview = previewFor(name, input);
    const deepLink = getDeepLinkPath(name, input);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'tool-pill-head';
    const toolLabel = friendlyName(name, call?.kind, call?.serverName);
    const bashDesc = ((name === 'Bash' || isTerminal) && input)
      ? (input.description || input.explanation || null) : null;
    if (bashDesc) {
      const desc = document.createElement('div');
      desc.className = 'tool-pill-bash-desc';
      desc.textContent = bashDesc;
      pill.appendChild(desc);
    }
    head.innerHTML = `
      <span class="tool-pill-status ${isMcp ? 'mcp' : 'running'}">${isMcp ? STATUS_SVGS.pending : STATUS_SVGS.running}</span>
      <span class="tool-pill-icon">${iconFor(name, call?.kind)}</span>
      <span class="tool-pill-label">${escapeHtml(toolLabel)}</span>
      ${preview ? `<span class="tool-pill-sep">/</span><span class="tool-pill-summary${deepLink ? ' tool-pill-deeplink' : ''}" ${deepLink ? `data-deeplink="${escapeHtml(deepLink)}" title="Open ${escapeHtml(sanitizePath(deepLink))} in editor"` : ''}>${escapeHtml(preview)}</span>` : ''}
      <span class="tool-pill-chevron">&#9656;</span>
    `;
    if (deepLink) {
      const link = head.querySelector('.tool-pill-deeplink');
      if (link) link.addEventListener('click', (e) => { e.stopPropagation(); openFileInEditor(deepLink); });
    }
    pill.appendChild(head);

    const body = document.createElement('div');
    body.className = 'tool-pill-body';
    const argsSec = document.createElement('div');
    argsSec.className = 'tool-pill-sec';
    argsSec.innerHTML = `<div class="tool-pill-sec-label">Arguments</div>`;
    const argsPre = document.createElement('pre');
    argsPre.className = 'tool-pill-pre';
    try { argsPre.textContent = JSON.stringify(input || {}, null, 2); } catch { argsPre.textContent = String(input || ''); }
    argsSec.appendChild(argsPre);
    body.appendChild(argsSec);

    const resSec = document.createElement('div');
    resSec.className = 'tool-pill-sec tool-pill-result-sec';
    resSec.innerHTML = `<div class="tool-pill-sec-label">Result</div>`;
    const resWrap = document.createElement('div');
    resWrap.className = 'tool-pill-result-wrap';
    resSec.appendChild(resWrap);
    body.appendChild(resSec);

    pill.appendChild(body);
    body.style.display = 'none';
    head.addEventListener('click', () => {
      const expanded = pill.classList.toggle('expanded');
      body.style.display = expanded ? 'block' : 'none';
    });

    bw.appendChild(pill);
  }

  function applyHistoryToolResult(wrap, toolUseId, content, isError) {
    const bw = wrap.querySelector('.msg-body-wrap') || wrap;

    const seqCard = bw.querySelector(`.thinking-seq-card[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (seqCard) return;

    const subCard = bw.querySelector(`.subagent-card[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (subCard) {
      subCard.classList.remove('running');
      if (isError) subCard.classList.add('error');
      // Update 28×28 status badge
      const badge = subCard.querySelector('.subagent-status-badge');
      if (badge) {
        badge.innerHTML = isError
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      }
      // Update status text
      const statusText = subCard.querySelector('.subagent-status-text');
      if (statusText) statusText.textContent = isError ? '✗ Agent failed' : '✓ Agent completed';
      // Remove progress bar
      const progressBar = subCard.querySelector('.subagent-progress-bar');
      if (progressBar) progressBar.remove();
      // Stop timer
      const tid = subCard.dataset.timerInterval;
      if (tid) { clearInterval(parseInt(tid)); delete subCard.dataset.timerInterval; }
      // Show result summary (clickable to expand)
      const collapsed = subCard.querySelector('.subagent-collapsed');
      if (collapsed && content) {
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        makeExpandableCollapsed(collapsed, text);
      }
      // Fallback: also try old-style .tool-pill-status
      const oldStatus = subCard.querySelector('.tool-pill-status');
      if (oldStatus) {
        oldStatus.classList.remove('running');
        oldStatus.classList.add(isError ? 'error' : 'success');
        oldStatus.innerHTML = isError ? STATUS_SVGS.error : STATUS_SVGS.success;
      }
      return;
    }

    const childRow = bw.querySelector(`.subagent-child[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (childRow) {
      childRow.classList.remove('running');
      childRow.classList.add(isError ? 'error' : 'done');
      const st = childRow.querySelector('.subagent-child-status');
      if (st) st.innerHTML = isError ? STATUS_SVGS.error : STATUS_SVGS.success;

      try {
        const parent = childRow.closest('.subagent-card');
        if (parent) {
          parent.dataset.childDone = String((parseInt(parent.dataset.childDone || '0', 10) || 0) + 1);
          updateSubagentCounts(parent);
        }
      } catch {}
      return;
    }

    const pill = bw.querySelector(`.tool-pill[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (!pill) return;
    pill.classList.remove('running');
    if (isError) pill.classList.add('error');

    const status = pill.querySelector('.tool-pill-status');
    if (status && !status.classList.contains('mcp')) {
      status.classList.remove('running');
      status.classList.add(isError ? 'error' : 'success');
      status.innerHTML = isError ? STATUS_SVGS.error : STATUS_SVGS.success;
    } else if (status && status.classList.contains('mcp')) {
      status.classList.remove('mcp');
      status.classList.add(isError ? 'error' : 'success');
      status.innerHTML = isError ? STATUS_SVGS.error : STATUS_SVGS.success;
    }

    const body = pill.querySelector('.tool-pill-body');
    if (body) {
      const toolName = pill.dataset.toolName || '';
      const resWrap = body.querySelector('.tool-pill-result-wrap');
      const out = renderToolOutput(toolName, content, isError);
      if (resWrap) {
        resWrap.innerHTML = '';
        resWrap.appendChild(out);
      } else {
        body.appendChild(out);
      }
    }

    // Update parent subagent completion counts if nested
    try {
      const parentCard = pill.closest('.subagent-card');
      if (parentCard) {
        parentCard.dataset.childDone = String((parseInt(parentCard.dataset.childDone || '0', 10) || 0) + 1);
        updateSubagentCounts(parentCard);
      }
    } catch {}
  }

  function appendError(text) {
    const wrap = ensureAssistantMessage();
    const streamingEl = wrap.querySelector('.msg-streaming-indicator');
    if (streamingEl) streamingEl.remove();
    const card = document.createElement('div');
    card.className = 'error-box';
    card.textContent = text;
    getBodyWrap(wrap).appendChild(card);
    scrollToBottom();
  }

  // Feature #13: Interruption banner
  function showInterruptionBanner() {
    if (!currentAssistantEl) return;
    const bw = getBodyWrap(currentAssistantEl);
    const existing = bw.querySelector('.interruption-banner');
    if (existing) return;
    const banner = document.createElement('div');
    banner.className = 'interruption-banner';
    banner.innerHTML = `
      <span class="interruption-text">Agent was interrupted</span>
      <button class="interruption-btn primary" data-action="continue">Continue</button>
      <button class="interruption-btn" data-action="new">Send New</button>
    `;
    banner.querySelector('[data-action="continue"]').addEventListener('click', () => {
      banner.remove();
      if (inputEl) {
        inputEl.value = 'Please continue where you left off.';
        sendMessage();
      }
    });
    banner.querySelector('[data-action="new"]').addEventListener('click', () => {
      banner.remove();
      if (inputEl) inputEl.focus();
    });
    bw.appendChild(banner);
    scrollToBottom();
  }

  function finalizeResult(result) {
    if (!currentAssistantEl) return;
    const streamingEl = currentAssistantEl?.querySelector('.msg-streaming-indicator');
    if (streamingEl) streamingEl.remove();
    const footer = document.createElement('div');
    footer.className = 'msg-footer';
    const cost = result && (result.total_cost_usd || result.totalCostUsd);
    const dur = result && (result.duration_ms || result.durationMs);
    const apiDur = result && result.duration_api_ms;
    const turns = result && result.num_turns;
    const subtype = result && result.subtype ? result.subtype : 'done';
    const usage = result && result.usage;
    const parts = [];
    const subMap = {
      'success': { label: 'done', cls: 'ok' },
      'error_during_execution': { label: 'error', cls: 'err' },
      'error_max_turns': { label: 'max turns', cls: 'warn' },
      'error_max_budget_usd': { label: 'max budget', cls: 'warn' },
      'error_max_structured_output_retries': { label: 'max retries', cls: 'warn' },
      'aborted': { label: 'stopped', cls: 'warn' },
      'error': { label: 'error', cls: 'err' },
    };
    const s = subMap[subtype] || { label: subtype, cls: '' };
    parts.push(`<span class="footer-subtype footer-${s.cls}">${escapeHtml(s.label)}</span>`);
    if (turns) parts.push(`<span>${turns} turn${turns === 1 ? '' : 's'}</span>`);
    if (dur) parts.push(`<span>${(dur / 1000).toFixed(1)}s${apiDur ? ` (${(apiDur/1000).toFixed(1)}s api)` : ''}</span>`);
    if (usage && (usage.input_tokens || usage.output_tokens)) {
      const ci = usage.cache_read_input_tokens || 0;
      parts.push(`<span title="input/output${ci ? ' cache read' : ''}">${usage.input_tokens || 0} in ${usage.output_tokens || 0} out${ci ? ` ${ci} cache` : ''}</span>`);
    }
    if (cost && cost > 0) parts.push(`<span>$${cost.toFixed(4)}</span>`);
    if (result && result.permission_denials && result.permission_denials.length) {
      parts.push(`<span class="footer-err">${result.permission_denials.length} denied</span>`);
    }
    footer.innerHTML = parts.join('<span class="footer-sep">&middot;</span>');
    const bw = getBodyWrap(currentAssistantEl);
    bw.appendChild(footer);
    // Timestamp
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.style.cssText = 'font-size:9px;color:var(--text-faint);font-family:var(--font-mono);letter-spacing:0.05em;margin-top:4px;';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bw.appendChild(timeEl);
    // Action buttons (copy + delete)
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const COPY_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const CHECK_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    const assistantEl = currentAssistantEl; // capture ref
    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Copy response';
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const mdBodies = assistantEl?.querySelectorAll('.md-body');
      let textContent = '';
      if (mdBodies) {
        mdBodies.forEach(b => { textContent += (b.dataset.text || b.innerText || '') + '\n'; });
      }
      try {
        await navigator.clipboard.writeText(textContent.trim());
        copyBtn.innerHTML = CHECK_SVG;
        copyBtn.style.color = 'var(--ok)';
        setTimeout(() => { copyBtn.innerHTML = COPY_SVG; copyBtn.style.color = ''; }, 1500);
      } catch {}
    });
    actions.appendChild(copyBtn);
    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'msg-action-btn msg-action-delete';
    deleteBtn.title = 'Delete response';
    deleteBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (assistantEl) {
        assistantEl.style.transition = 'opacity 0.2s';
        assistantEl.style.opacity = '0';
        setTimeout(() => assistantEl.remove(), 200);
      }
    });
    actions.appendChild(deleteBtn);
    bw.appendChild(actions);

    // Save assistant message to IndexedDB
    saveAssistantMessageToDB(result);
  }

  // ---------- IndexedDB persistence helpers ----------
  async function saveUserMessageToDB(text, sentAttachments) {
    if (!chatDB || !currentSessionId) return;
    try {
      await chatDB.addMessage({
        id: `user-${generateId()}`,
        sessionId: currentSessionId,
        role: 'user',
        content: text,
        blocks: [{ type: 'text', text }],
        metadata: {
          attachments: sentAttachments || [],
          mode: state.agentMode,
          effort: state.reasoningEffort || 'medium',
        },
      });
      await chatDB.updateSession(currentSessionId, {});
    } catch (e) {
      console.error('saveUserMessageToDB', e);
    }
  }

  async function saveAssistantMessageToDB(result) {
    if (!chatDB || !currentSessionId) return;
    try {
      const mdBodies = currentAssistantEl?.querySelectorAll('.md-body');
      let fullText = '';
      if (mdBodies) {
        mdBodies.forEach(b => { fullText += (b.dataset.text || '') + '\n'; });
      }
      const msgId = currentAssistantMsgId || `asst-${generateId()}`;
      await chatDB.addMessage({
        id: msgId,
        sessionId: currentSessionId,
        role: 'assistant',
        content: fullText.trim(),
        blocks: currentAssistantBlocks.slice(),
        metadata: {
          result: result ? {
            subtype: result.subtype,
            cost: result.total_cost_usd || result.totalCostUsd,
            duration: result.duration_ms || result.durationMs,
            turns: result.num_turns,
            usage: result.usage,
          } : {},
        },
      });
      await chatDB.updateSession(currentSessionId, {});
    } catch (e) {
      console.error('saveAssistantMessageToDB', e);
    }
  }

  // ---------- Attachments ----------
  function renderAttachments() {
    if (!attachmentsEl) return;
    attachmentsEl.innerHTML = '';
    attachments.forEach((a, idx) => {
      const chip = document.createElement('span');
      chip.className = 'attachment-chip';
      chip.innerHTML = `&#128206; ${escapeHtml(a.name || a.path)} <span class="x">&times;</span>`;
      chip.querySelector('.x').addEventListener('click', () => {
        attachments.splice(idx, 1);
        renderAttachments();
      });
      attachmentsEl.appendChild(chip);
    });
    // Update attach count
    const countEl = document.getElementById('attach-count');
    if (countEl) {
      if (attachments.length > 0) {
        countEl.textContent = attachments.length;
        countEl.classList.remove('hidden');
      } else {
        countEl.classList.add('hidden');
      }
    }
  }

  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      const picked = await api.pickFile({ multi: true });
      if (!picked) return;
      const arr = Array.isArray(picked) ? picked : [picked];
      arr.forEach(p => {
        const name = p.split(/[\\/]/).pop();
        attachments.push({ path: p, name });
      });
      renderAttachments();
    });
  }

  // Feature: Voice input — Groq Whisper (high quality) or Windows native (offline fallback)
  const micBtn = document.getElementById('chat-mic');
  if (micBtn && api.speech) {
    let isRecording = false;
    let mediaRecorder = null;
    let audioChunks = [];
    let useApi = false;
    let removeResultListener = null;

    // Check which backend is available
    api.speech.info().then((info) => { useApi = !!info?.api; });

    function stopRecording() {
      if (!isRecording) return;
      isRecording = false;
      micBtn.classList.remove('mic-active');
      micBtn.title = 'Voice input';

      if (useApi && mediaRecorder) {
        mediaRecorder.stop(); // triggers onstop → transcribe
      } else {
        api.speech.stopNative();
        if (removeResultListener) { removeResultListener(); removeResultListener = null; }
      }
    }

    async function startRecording() {
      if (isRecording) { stopRecording(); return; }

      if (useApi) {
        // ── Whisper API: record mic → auto-stop on silence → transcribe ──
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
          bus.emit('toast:show', { type: 'error', message: 'Microphone access denied' });
          return;
        }

        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          // Cleanup silence detector
          if (silenceRaf) { cancelAnimationFrame(silenceRaf); silenceRaf = null; }
          if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
          stream.getTracks().forEach(t => t.stop());

          if (!audioChunks.length) return;
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          audioChunks = [];

          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            micBtn.classList.add('mic-active');
            micBtn.style.opacity = '0.5';
            micBtn.title = 'Transcribing...';

            const result = await api.speech.transcribe(base64);
            micBtn.style.opacity = '';
            micBtn.classList.remove('mic-active');
            micBtn.title = 'Voice input';

            if (result?.ok && result.text) {
              if (inputEl) {
                const prefix = inputEl.value.length > 0 && !inputEl.value.endsWith(' ') ? ' ' : '';
                inputEl.value += prefix + result.text;
                inputEl.dispatchEvent(new Event('input'));
                inputEl.focus();
              }
            } else if (result?.error) {
              bus.emit('toast:show', { type: 'error', message: 'Transcription failed: ' + result.error });
            }
          };
          reader.readAsDataURL(blob);
        };

        // ── Silence detection via Web Audio API ──
        let audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const dataArr = new Uint8Array(analyser.frequencyBinCount);

        const SILENCE_THRESHOLD = 15;   // volume level below which = silence
        const SILENCE_DURATION = 2000;  // ms of silence before auto-stop
        const MIN_RECORD_TIME = 800;    // don't auto-stop within first 800ms
        let silenceStart = null;
        let recordStart = Date.now();
        let silenceRaf = null;
        let hasSpeech = false;

        function checkSilence() {
          if (!isRecording) return;
          analyser.getByteFrequencyData(dataArr);
          // Average volume level
          let sum = 0;
          for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
          const avg = sum / dataArr.length;

          if (avg > SILENCE_THRESHOLD) {
            hasSpeech = true;
            silenceStart = null;
          } else if (hasSpeech) {
            // Only start counting silence after user has spoken at least once
            if (!silenceStart) silenceStart = Date.now();
            const elapsed = Date.now() - recordStart;
            if (elapsed > MIN_RECORD_TIME && Date.now() - silenceStart > SILENCE_DURATION) {
              // Auto-stop: user stopped talking
              stopRecording();
              return;
            }
          }
          silenceRaf = requestAnimationFrame(checkSilence);
        }

        mediaRecorder.start();
        recordStart = Date.now();
        isRecording = true;
        micBtn.classList.add('mic-active');
        micBtn.title = 'Recording... auto-stops after silence';
        // Start silence detection loop
        silenceRaf = requestAnimationFrame(checkSilence);

      } else {
        // ── Windows native fallback ──
        let finalTranscript = '';
        let insertStart = inputEl ? (inputEl.selectionStart ?? inputEl.value.length) : 0;
        if (inputEl && inputEl.value.length > 0 && !inputEl.value.endsWith(' ')) {
          inputEl.value += ' ';
          insertStart = inputEl.value.length;
        }

        removeResultListener = api.speech.onResult((p) => {
          if (!p) return;
          if (p.type === 'final') {
            finalTranscript += (finalTranscript ? ' ' : '') + p.text;
            if (inputEl) {
              inputEl.value = inputEl.value.slice(0, insertStart) + finalTranscript;
              inputEl.dispatchEvent(new Event('input'));
            }
          } else if (p.type === 'interim' && inputEl) {
            inputEl.value = inputEl.value.slice(0, insertStart) + finalTranscript + (finalTranscript ? ' ' : '') + p.text;
            inputEl.dispatchEvent(new Event('input'));
          } else if (p.type === 'ended' || p.type === 'error') {
            if (p.type === 'error') bus.emit('toast:show', { type: 'error', message: 'Voice error: ' + (p.text || '') });
            stopRecording();
          }
        });

        const result = await api.speech.startNative();
        if (result?.ok) {
          isRecording = true;
          micBtn.classList.add('mic-active');
          micBtn.title = 'Listening... click to stop';
        } else {
          bus.emit('toast:show', { type: 'error', message: 'Voice input failed: ' + (result?.error || 'unknown') });
          if (removeResultListener) { removeResultListener(); removeResultListener = null; }
        }
      }
    }

    micBtn.addEventListener('click', startRecording);

    if (inputEl) {
      inputEl.addEventListener('keydown', (e) => {
        if (isRecording && e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') {
          stopRecording();
        }
      });
    }
  } else if (micBtn) {
    micBtn.style.display = 'none';
  }

  // Feature #19: Drag-and-Drop Upload
  if (composeBox) {
    const insertTextAtCursor = (text) => {
      if (!text || !inputEl) return;
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? inputEl.value.length;
      const before = inputEl.value.slice(0, start);
      const after = inputEl.value.slice(end);
      inputEl.value = before + text + after;
      const nextPos = start + text.length;
      inputEl.selectionStart = inputEl.selectionEnd = nextPos;
      inputEl.dispatchEvent(new Event('input'));
    };

    const toBase64 = (fileOrBlob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read clipboard file'));
      reader.onload = () => {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.readAsDataURL(fileOrBlob);
    });

    const extFromMime = (mime) => {
      const m = String(mime || '').toLowerCase();
      if (m.includes('png')) return 'png';
      if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
      if (m.includes('webp')) return 'webp';
      if (m.includes('gif')) return 'gif';
      if (m.includes('svg')) return 'svg';
      if (m.includes('pdf')) return 'pdf';
      if (m.includes('json')) return 'json';
      if (m.includes('plain')) return 'txt';
      return 'bin';
    };

    const attachFileLike = async (fileLike, suggestedName) => {
      if (!fileLike) return false;
      // Native path available (Explorer drag/drop, etc.)
      if (fileLike.path) {
        const fullPath = fileLike.path;
        const name = (fileLike.name || fullPath.split(/[\\/]/).pop() || 'attachment').trim();
        if (!attachments.some(a => a.path === fullPath)) {
          attachments.push({ path: fullPath, name });
        }
        return true;
      }

      // No path available (clipboard/browser file) -> persist to temp and attach
      try {
        const base64 = await toBase64(fileLike);
        const fallbackName = suggestedName || fileLike.name || `paste-${Date.now()}.${extFromMime(fileLike.type)}`;
        const result = await api.files.saveTemp(fallbackName, base64);
        if (result?.ok && result.path) {
          if (!attachments.some(a => a.path === result.path)) {
            attachments.push({ path: result.path, name: result.name || fallbackName });
          }
          return true;
        }
      } catch (err) {
        bus.emit('toast:show', { type: 'error', message: 'Failed to attach pasted file: ' + (err?.message || 'unknown error') });
      }
      return false;
    };

    composeBox.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      composeBox.classList.add('compose-dragover');
    });
    composeBox.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only remove overlay when actually leaving the compose box (not entering a child)
      if (!composeBox.contains(e.relatedTarget)) {
        composeBox.classList.remove('compose-dragover');
      }
    });
    composeBox.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      composeBox.classList.remove('compose-dragover');

      // 1) In-app drag from sidebar file tree or editor tab
      const pipilotPath = e.dataTransfer?.getData('application/pipilot-path');
      const pipilotTab = e.dataTransfer?.getData('application/pipilot-tab');
      const droppedPath = pipilotPath || pipilotTab;
      if (droppedPath) {
        const name = droppedPath.split(/[/\\]/).pop();
        const alreadyAttached = attachments.some(a => a.path === droppedPath);
        if (!alreadyAttached) {
          attachments.push({ path: droppedPath, name });
          renderAttachments();
        }
        return;
      }

      // 2) Native file drop (from OS file explorer)
      const files = e.dataTransfer?.files;
      if (files && files.length) {
        let attachedAny = false;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          // Works for both path-backed and blob-only file drops
          if (await attachFileLike(f, f.name)) attachedAny = true;
        }
        if (attachedAny) {
          renderAttachments();
          bus.emit('toast:show', { type: 'ok', message: 'File(s) attached' });
        }
        return;
      }

      // 3) Plain text drop (e.g. dragged text selection)
      const text = e.dataTransfer?.getData('text/plain');
      if (text) insertTextAtCursor(text);
    });

    // Paste handler — supports images, files, and text
    const pasteTarget = inputEl || composeBox;
    pasteTarget.addEventListener('paste', async (e) => {
      const cb = e.clipboardData;
      const items = cb ? Array.from(cb.items || []) : [];

      const fileItems = items.filter(it => it.kind === 'file' || String(it.type || '').startsWith('image/'));

      // Get pasted text — try DOM clipboardData first, fall back to Electron clipboard API
      let pastedText = (cb && cb.getData('text/plain')) || '';
      if (!pastedText && !fileItems.length && api.clipboard?.readText) {
        try { pastedText = api.clipboard.readText() || ''; } catch {}
      }

      // If no files, handle plain text paste explicitly for reliability.
      if (!fileItems.length) {
        e.preventDefault();
        if (pastedText) insertTextAtCursor(pastedText);
        return;
      }

      // Mixed/file paste: prevent default, attach files, then insert text if present.
      e.preventDefault();
      let attachedAny = false;
      for (const item of fileItems) {
        const file = item.getAsFile?.();
        if (!file) continue;
        const suggested = file.name || `paste-${Date.now()}.${extFromMime(file.type)}`;
        if (await attachFileLike(file, suggested)) attachedAny = true;
      }

      if (attachedAny) {
        renderAttachments();
        bus.emit('toast:show', { type: 'ok', message: 'Pasted file(s) attached' });
      }
      if (pastedText) insertTextAtCursor(pastedText);
    });
  }

  // ---------- Mode selector (Feature #2) ----------
  function setMode(mode) {
    state.agentMode = mode === 'plan' ? 'plan' : 'agent';
    if (modeLabelEl) {
      modeLabelEl.textContent = state.agentMode === 'plan' ? 'Plan' : 'Agent';
    }
  }

  function renderModeDropdown() {
    if (!modeDropdown) return;
    modeDropdown.innerHTML = `
      <div class="dropdown-item ${state.agentMode === 'agent' ? 'active' : ''}" data-mode="agent">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>
        <div>
          <div style="font-weight:600;font-size:11px;">Agent</div>
          <div style="font-size:9px;color:var(--text-dim);">Reads, writes, runs</div>
        </div>
      </div>
      <div class="dropdown-item ${state.agentMode === 'plan' ? 'active' : ''}" data-mode="plan">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <div>
          <div style="font-weight:600;font-size:11px;">Plan</div>
          <div style="font-size:9px;color:var(--text-dim);">Research only</div>
        </div>
      </div>
    `;
    modeDropdown.querySelectorAll('.dropdown-item[data-mode]').forEach(item => {
      item.addEventListener('click', () => {
        setMode(item.dataset.mode);
        modeDropdown.classList.add('hidden');
        renderModeDropdown();
      });
    });
  }

  if (modeBtn) {
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !modeDropdown.classList.contains('hidden');
      // Close session dropdown
      if (sessionDropdown) sessionDropdown.classList.add('hidden');
      if (effortDropdown) effortDropdown.classList.add('hidden');
      modeDropdown.classList.toggle('hidden', isOpen);
      if (!isOpen) renderModeDropdown();
    });
  }
  setMode(state.settings?.agentDefaultMode === 'plan' ? 'plan' : 'agent');
  bus.on('settings:changed', (p) => { if (p?.key === 'agentDefaultMode') setMode(p.value); });

  // ---------- Reasoning effort selector ----------
  // Five levels — none < low < medium (default) < high < xhigh.
  // Sent with each agent run; main process injects effort-specific prompt.
  const EFFORT_LEVELS = [
    { id: 'none',   label: 'None',    blurb: 'Just act. No thinking.' },
    { id: 'low',    label: 'Low',     blurb: 'Brief reasoning on hard choices only.' },
    { id: 'medium', label: 'Medium',  blurb: 'Reason on complex problems. (default)' },
    { id: 'high',   label: 'High',    blurb: 'Reason before most non-trivial actions.' },
    { id: 'xhigh',  label: 'X-High',  blurb: 'Deep structured reasoning on every task.' },
  ];
  const EFFORT_KEY = 'pipilot:reasoning-effort';

  function setEffort(id) {
    const lvl = EFFORT_LEVELS.find(l => l.id === id) || EFFORT_LEVELS[2];
    state.reasoningEffort = lvl.id;
    if (effortLabelEl) effortLabelEl.textContent = lvl.label;
    // Visual cue: high+ get the accent color so the user sees they've opted into heavier thinking.
    if (effortBtn) {
      effortBtn.classList.toggle('effort-elevated', lvl.id === 'high' || lvl.id === 'xhigh');
      effortBtn.classList.toggle('effort-muted', lvl.id === 'none');
    }
    try { localStorage.setItem(EFFORT_KEY, lvl.id); } catch {}
  }

  function renderEffortDropdown() {
    if (!effortDropdown) return;
    effortDropdown.innerHTML = EFFORT_LEVELS.map(l => `
      <div class="dropdown-item ${state.reasoningEffort === l.id ? 'active' : ''}" data-effort="${l.id}">
        <div>
          <div style="font-weight:600;font-size:11px;">${l.label}</div>
          <div style="font-size:9px;color:var(--text-dim);">${l.blurb}</div>
        </div>
      </div>
    `).join('');
    effortDropdown.querySelectorAll('.dropdown-item[data-effort]').forEach(item => {
      item.addEventListener('click', () => {
        setEffort(item.dataset.effort);
        effortDropdown.classList.add('hidden');
        renderEffortDropdown();
      });
    });
  }

  if (effortBtn) {
    effortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !effortDropdown.classList.contains('hidden');
      if (sessionDropdown) sessionDropdown.classList.add('hidden');
      if (modeDropdown) modeDropdown.classList.add('hidden');
      effortDropdown.classList.toggle('hidden', isOpen);
      if (!isOpen) renderEffortDropdown();
    });
  }
  // Restore last selection or default to medium.
  try { setEffort(localStorage.getItem(EFFORT_KEY) || 'medium'); }
  catch { setEffort('medium'); }

  // ---------- Sessions (Feature #1) ----------
  async function renderSessionDropdown() {
    if (!sessionDropdown || !chatDB) return;
    let sessions = [];
    try {
      sessions = await chatDB.listSessions(state.projectPath);
    } catch {}
    sessionDropdown.innerHTML = `
      <div class="dropdown-header">
        <span class="dropdown-label">// sessions</span>
        <span class="dropdown-count">${String(sessions.length).padStart(2, '0')}</span>
      </div>
      ${sessions.map(s => `
        <div class="dropdown-item ${s.id === currentSessionId ? 'active' : ''}" data-sid="${escapeHtml(s.id)}">
          <span class="dropdown-item-title">${escapeHtml(s.title?.length > 30 ? s.title.slice(0, 30) + '…' : s.title)}</span>
          <span class="dropdown-item-time">${relativeTime(s.updatedAt)}</span>
          <button class="dropdown-action" data-action="rename" data-sid="${escapeHtml(s.id)}" title="Rename"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/></svg></button>
          <button class="dropdown-action delete-action" data-action="delete" data-sid="${escapeHtml(s.id)}" title="Delete"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      `).join('')}
      <button class="dropdown-new-btn" id="dropdown-new-chat">+ New Chat</button>
    `;

    // Wire session click
    sessionDropdown.querySelectorAll('.dropdown-item[data-sid]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.dropdown-action')) return;
        const sid = item.dataset.sid;
        if (sid && sid !== currentSessionId) {
          loadSession(sid);
        }
        sessionDropdown.classList.add('hidden');
      });
    });

    // Wire rename
    sessionDropdown.querySelectorAll('.dropdown-action[data-action="rename"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sid;
        const item = btn.closest('.dropdown-item');
        const titleSpan = item.querySelector('.dropdown-item-title');
        const oldTitle = titleSpan.textContent;
        const input = document.createElement('input');
        input.className = 'dropdown-rename-input';
        input.value = oldTitle;
        titleSpan.replaceWith(input);
        input.focus();
        input.select();
        const finishRename = async () => {
          const newTitle = input.value.trim() || oldTitle;
          if (chatDB) {
            try { await chatDB.updateSession(sid, { title: newTitle }); } catch {}
          }
          if (sid === currentSessionId && sessionTitleEl) {
            sessionTitleEl.textContent = newTitle;
          }
          renderSessionDropdown();
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); finishRename(); }
          if (ev.key === 'Escape') { renderSessionDropdown(); }
        });
        input.addEventListener('blur', finishRename);
      });
    });

    // Wire delete
    sessionDropdown.querySelectorAll('.dropdown-action[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sid;
        if (chatDB) {
          try { await chatDB.deleteSession(sid); } catch {}
        }
        if (sid === currentSessionId) {
          await newSession();
        }
        renderSessionDropdown();
      });
    });

    // Wire new chat
    const newChatBtn = sessionDropdown.querySelector('#dropdown-new-chat');
    if (newChatBtn) {
      newChatBtn.addEventListener('click', async () => {
        sessionDropdown.classList.add('hidden');
        await newSession();
      });
    }
  }

  if (sessionBtn) {
    sessionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !sessionDropdown.classList.contains('hidden');
      // Close mode dropdown
      if (modeDropdown) modeDropdown.classList.add('hidden');
      sessionDropdown.classList.toggle('hidden', isOpen);
      if (!isOpen) renderSessionDropdown();
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (sessionDropdown && !sessionDropdown.classList.contains('hidden') &&
        !sessionDropdown.contains(e.target) && e.target !== sessionBtn && !sessionBtn?.contains(e.target)) {
      sessionDropdown.classList.add('hidden');
    }
    if (modeDropdown && !modeDropdown.classList.contains('hidden') &&
        !modeDropdown.contains(e.target) && e.target !== modeBtn && !modeBtn?.contains(e.target)) {
      modeDropdown.classList.add('hidden');
    }
    if (effortDropdown && !effortDropdown.classList.contains('hidden') &&
        !effortDropdown.contains(e.target) && e.target !== effortBtn && !effortBtn?.contains(e.target)) {
      effortDropdown.classList.add('hidden');
    }
  });

  async function newSession() {
    if (!state.projectPath) return;
    const id = `session-${generateId()}`;
    try {
      if (chatDB) {
        await chatDB.createSession({
          id,
          title: `Chat ${new Date().toLocaleTimeString()}`,
          projectPath: state.projectPath,
        });
      }
      currentSessionId = id;
      messages = [];
      allHistoryMessages = [];
      renderedMessageCount = 0;
      userMessageCount = 0;
      firstUserMessageSent = false;
      sequentialThinkingCount = 0;
      currentAssistantBlocks = [];
      currentAssistantMsgId = null;
      if (messagesEl) messagesEl.innerHTML = '';
      currentAssistantEl = null;
      updateMsgCounter();
      if (sessionTitleEl) sessionTitleEl.textContent = 'New Chat';
      showWelcomeState();
      // Also create server-side session
      try {
        await api.agent.newSession(state.projectPath, `Chat ${new Date().toLocaleTimeString()}`);
      } catch {}
    } catch (e) {
      console.error('newSession', e);
    }
  }

  async function loadSession(sessionId) {
    if (!sessionId) return;
    try {
      currentSessionId = sessionId;
      messages = [];
      currentAssistantEl = null;
      currentAssistantBlocks = [];
      currentAssistantMsgId = null;
      sequentialThinkingCount = 0;
      userMessageCount = 0;
      if (messagesEl) messagesEl.innerHTML = '';

      // Load from IndexedDB
      if (chatDB) {
        const session = await chatDB.getSession(sessionId);
        if (session && sessionTitleEl) {
          sessionTitleEl.textContent = session.title || 'Chat';
        }
        allHistoryMessages = await chatDB.getMessages(sessionId);
        // Feature #17: Only render last 20 messages
        const INITIAL_RENDER = 20;
        const toRender = allHistoryMessages.slice(-INITIAL_RENDER);
        const hasOlder = allHistoryMessages.length > INITIAL_RENDER;

        if (hasOlder) {
          const loadBtn = document.createElement('button');
          loadBtn.className = 'load-older-btn';
          loadBtn.textContent = `Load ${allHistoryMessages.length - INITIAL_RENDER} older messages`;
          loadBtn.addEventListener('click', () => {
            loadBtn.remove();
            const older = allHistoryMessages.slice(0, -INITIAL_RENDER);
            const firstChild = messagesEl.firstChild;
            older.forEach(m => {
              const el = renderHistoryMessage(m, true);
              if (el && firstChild) messagesEl.insertBefore(el, firstChild);
            });
          });
          messagesEl.appendChild(loadBtn);
        }

        toRender.forEach(m => {
          renderHistoryMessage(m);
          if (m.role === 'user') userMessageCount++;
        });
        renderedMessageCount = toRender.length;
        updateMsgCounter();
        if (allHistoryMessages.length === 0) {
          showWelcomeState();
        }
      }

      scrollToBottom(true);
    } catch (e) {
      console.error('loadSession', e);
    }
  }

  const H_COPY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const H_CHECK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
  const H_EDIT = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const H_REVERT = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
  const H_DELETE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  function addHistoryActions(container, textGetter, opts = {}) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    // Look up the .msg ancestor LAZILY — at call sites the container is
    // sometimes not yet attached to its parent, so doing this eagerly
    // returns null and every click handler silently no-ops. Resolving on
    // each click guarantees we get the real ancestor by the time the user
    // can actually click anything.
    const getWrap = () => container.closest('.msg');

    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = H_COPY;
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(textGetter());
        copyBtn.innerHTML = H_CHECK;
        copyBtn.style.color = 'var(--ok)';
        setTimeout(() => { copyBtn.innerHTML = H_COPY; copyBtn.style.color = ''; }, 1500);
      } catch {}
    });
    actions.appendChild(copyBtn);

    // Edit & resend (user messages only) — opens the same inline editor
    // live messages get, with Cancel/Resend. On Resend we drop this user
    // message + everything after it from IDB and the DOM, then send the
    // edited text. Mirrors the live-message dblclick flow.
    if (opts.isUser) {
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-action-btn';
      editBtn.title = 'Edit & resend';
      editBtn.innerHTML = H_EDIT;
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wrap = getWrap();
        if (!wrap) return;
        const bubble = wrap.querySelector('.msg-bubble');
        if (!bubble || bubble.querySelector('.msg-edit-area')) return;
        const text = textGetter();
        bubble.innerHTML = '';
        const editArea = document.createElement('textarea');
        editArea.className = 'msg-edit-area';
        editArea.value = text;
        editArea.rows = Math.min(Math.max(text.split('\n').length, 2), 8);
        bubble.appendChild(editArea);
        const editBar = document.createElement('div');
        editBar.className = 'msg-edit-bar';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'msg-edit-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          bubble.innerHTML = '';
          bubble.textContent = text;
        });
        const resendBtn = document.createElement('button');
        resendBtn.className = 'msg-edit-send';
        resendBtn.textContent = 'Resend';
        resendBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const newText = editArea.value.trim();
          if (!newText) return;
          // Stop any in-flight stream so sendMessage doesn't queue.
          if (activeStream && activeStream.stop) {
            try { activeStream.stop(); } catch {}
          }
          isSending = false;
          setSending(false);
          bus.emit('agent:status', 'ready');
          // Drop this message + everything after it from IDB.
          const ts = Number(wrap.dataset.timestamp);
          if (ts && chatDB && currentSessionId) {
            try { await chatDB.deleteMessagesAfter(currentSessionId, ts - 1); } catch {}
          }
          // Remove this + all later DOM nodes.
          const allMsgs = Array.from(messagesEl.children);
          let hit = false;
          for (const node of allMsgs) {
            if (node === wrap) hit = true;
            if (hit) node.remove();
          }
          currentAssistantEl = null;
          currentAssistantBlocks = [];
          // Send the edited text fresh.
          if (inputEl) inputEl.value = newText;
          sendMessage();
        });
        editBar.appendChild(cancelBtn);
        editBar.appendChild(resendBtn);
        bubble.appendChild(editBar);
        editArea.focus();
        editArea.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); resendBtn.click(); }
          if (ev.key === 'Escape') cancelBtn.click();
        });
      });
      actions.appendChild(editBtn);
    }

    // Revert to this point (optional)
    if (!opts.hideRevert) {
      const revertBtn = document.createElement('button');
      revertBtn.className = 'msg-action-btn';
      revertBtn.title = 'Revert to this point';
      revertBtn.style.color = 'var(--info)';
      revertBtn.innerHTML = H_REVERT;
      revertBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wrap = getWrap();
        if (!wrap) return;

        // Find the checkpoint ID stamped on this user message
        const cpId = wrap.dataset.checkpointId || null;

        // Restore project files from checkpoint if available
        if (cpId && state.projectPath && api.checkpoints?.restore) {
          revertBtn.disabled = true;
          revertBtn.style.opacity = '0.4';
          try {
            const result = await api.checkpoints.restore(state.projectPath, cpId);
            if (result?.ok) {
              bus.emit('files:refresh');
              bus.emit('toast:show', { message: 'Project files reverted to checkpoint', type: 'ok' });
            } else {
              bus.emit('toast:show', { message: 'Restore failed: ' + (result?.error || 'unknown'), type: 'error' });
              revertBtn.disabled = false;
              revertBtn.style.opacity = '';
              return;
            }
          } catch (err) {
            bus.emit('toast:show', { message: 'Restore failed: ' + err.message, type: 'error' });
            revertBtn.disabled = false;
            revertBtn.style.opacity = '';
            return;
          }
        } else {
          bus.emit('toast:show', { message: 'No checkpoint found — removed messages only', type: 'warn' });
        }

        // Delete messages after this point from IndexedDB
        const ts = Number(wrap.dataset.timestamp);
        if (ts && chatDB && currentSessionId) {
          try { await chatDB.deleteMessagesAfter(currentSessionId, ts); } catch {}
        }

        // Remove all messages after this one from the UI
        let found = false;
        const allMsgs = Array.from(messagesEl.children);
        for (const el of allMsgs) {
          if (found) el.remove();
          if (el === wrap) found = true;
        }
        currentAssistantEl = null;
      });
      actions.appendChild(revertBtn);
    }

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'msg-action-btn msg-action-delete';
    deleteBtn.title = 'Delete message';
    deleteBtn.innerHTML = H_DELETE;
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wrap = getWrap();
      if (!wrap) return;
      // Persist the deletion — IndexedDB is the source of truth on session
      // reload. Without this, deleting a message just hides it for this
      // tab and it reappears next time the session loads. chatDB.deleteMessage
      // takes the message id, not (session,timestamp) — so look it up by ts.
      const ts = Number(wrap.dataset.timestamp);
      if (ts && chatDB && currentSessionId) {
        try {
          const msgs = await chatDB.getMessages(currentSessionId);
          const target = msgs.find(m => Number(m.timestamp) === ts);
          if (target && target.id) await chatDB.deleteMessage(target.id);
        } catch {}
      }
      wrap.style.transition = 'opacity 0.2s';
      wrap.style.opacity = '0';
      setTimeout(() => wrap.remove(), 200);
    });
    actions.appendChild(deleteBtn);

    container.appendChild(actions);
  }

  function renderHistoryMessage(m, returnEl) {
    if (m.role === 'user') {
      hideWelcome();
      const wrap = document.createElement('div');
      wrap.className = 'msg msg-user';
      if (m.timestamp) wrap.dataset.timestamp = String(m.timestamp);
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      wrap.appendChild(avatar);
      const content = document.createElement('div');
      content.className = 'msg-content';
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      const text = m.content || (m.blocks && m.blocks[0] && m.blocks[0].text) || '';
      const { text: displayText, truncated } = truncateText(text, 35);
      if (truncated) {
        bubble.classList.add('truncated');
        renderTruncatableText(bubble, text, displayText);
      } else {
        bubble.textContent = text;
      }
      content.appendChild(bubble);
      if (m.timestamp) {
        const timeEl = document.createElement('div');
        timeEl.className = 'msg-time';
        timeEl.textContent = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        content.appendChild(timeEl);
      }
      addHistoryActions(content, () => text, { isUser: true });
      wrap.appendChild(content);
      if (returnEl) return wrap;
      messagesEl.appendChild(wrap);
      return wrap;
    } else if (m.role === 'assistant') {
      hideWelcome();
      const wrap = document.createElement('div');
      wrap.className = 'msg msg-assistant';
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';
      wrap.appendChild(avatar);
      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'msg-body-wrap';

      // Reconstruct assistant message from stored blocks, preserving exact ordering.
      // Blocks come from streaming: {type:'text'|'thinking'|'tool_call'|'tool_result', ...}
      const blocks = Array.isArray(m.blocks) ? m.blocks : [];
      let afterTool = false;
      if (blocks.length) {
        blocks.forEach(b => {
          if (!b || !b.type) return;
          if (b.type === 'text') {
            appendHistoryAssistantText(bodyWrap, b.text || '', afterTool);
            afterTool = false;
            return;
          }
          if (b.type === 'thinking') {
            appendHistoryThinking(bodyWrap, b.text || '');
            afterTool = true;
            return;
          }
          if (b.type === 'tool_call') {
            appendHistoryToolCall(bodyWrap, { id: b.id, name: b.name, input: b.input, kind: b.kind, serverName: b.serverName, parentToolUseId: b.parentToolUseId || null });
            afterTool = true;
            return;
          }
          if (b.type === 'tool_result') {
            applyHistoryToolResult(bodyWrap, b.toolUseId || b.id || b.tool_id || '', b.content, !!b.isError);
            afterTool = true;
            return;
          }
        });
      } else if (m.content) {
        appendHistoryAssistantText(bodyWrap, m.content, false);
      }

      // Mark any remaining "running" pills as completed (history = past = done)
      bodyWrap.querySelectorAll('.tool-pill.running').forEach(pill => {
        pill.classList.remove('running');
        const st = pill.querySelector('.tool-pill-status');
        if (st) { st.classList.remove('running'); st.classList.add('success'); st.innerHTML = STATUS_SVGS.success; }
      });
      bodyWrap.querySelectorAll('.subagent-card.running').forEach(card => {
        card.classList.remove('running');
        const badge = card.querySelector('.subagent-status-badge');
        if (badge) badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        const statusText = card.querySelector('.subagent-status-text');
        if (statusText) statusText.textContent = '✓ Agent completed';
        const progressBar = card.querySelector('.subagent-progress-bar');
        if (progressBar) progressBar.remove();
      });
      bodyWrap.querySelectorAll('.subagent-child.running').forEach(row => {
        row.classList.remove('running');
        row.classList.add('done');
        const st = row.querySelector('.subagent-child-status');
        if (st) st.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      });

      // Footer with metadata
      if (m.metadata && m.metadata.result) {
        const r = m.metadata.result;
        const footer = document.createElement('div');
        footer.className = 'msg-footer';
        const parts = [];
        if (r.subtype) {
          const subMap = {
            'success': { label: 'done', cls: 'ok' },
            'error_during_execution': { label: 'error', cls: 'err' },
            'aborted': { label: 'stopped', cls: 'warn' },
          };
          const s = subMap[r.subtype] || { label: r.subtype, cls: '' };
          parts.push(`<span class="footer-subtype footer-${s.cls}">${escapeHtml(s.label)}</span>`);
        }
        if (r.turns) parts.push(`<span>${r.turns} turn${r.turns === 1 ? '' : 's'}</span>`);
        if (r.duration) parts.push(`<span>${(r.duration / 1000).toFixed(1)}s</span>`);
        if (r.cost && r.cost > 0) parts.push(`<span>$${r.cost.toFixed(4)}</span>`);
        if (parts.length) {
          footer.innerHTML = parts.join('<span class="footer-sep">&middot;</span>');
          bodyWrap.appendChild(footer);
        }
      }
      if (m.timestamp) {
        const timeEl = document.createElement('div');
        timeEl.style.cssText = 'font-size:9px;color:var(--text-faint);font-family:var(--font-mono);letter-spacing:0.05em;margin-top:4px;';
        timeEl.textContent = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        bodyWrap.appendChild(timeEl);
      }
      // Action buttons for assistant history messages
      addHistoryActions(bodyWrap, () => {
        const bodies = bodyWrap.querySelectorAll('.md-body');
        let text = '';
        bodies.forEach(b => { text += (b.dataset.text || b.innerText || '') + '\n'; });
        return text.trim();
      }, { hideRevert: true });

      wrap.appendChild(bodyWrap);
      if (returnEl) return wrap;
      messagesEl.appendChild(wrap);
      return wrap;
    }
    return null;
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => bus.emit('modal:settings'));
  }

  // Feature #3: Clear conversation
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!currentSessionId) return;
      if (chatDB) {
        try { await chatDB.clearMessages(currentSessionId); } catch {}
      }
      messages = [];
      allHistoryMessages = [];
      renderedMessageCount = 0;
      userMessageCount = 0;
      currentAssistantBlocks = [];
      currentAssistantMsgId = null;
      if (messagesEl) messagesEl.innerHTML = '';
      currentAssistantEl = null;
      updateMsgCounter();
      showWelcomeState();
    });
  }

  // ---------- Send ----------
  function setSending(sending) {
    isSending = sending;
    if (sendBtn) sendBtn.classList.toggle('hidden', sending);
    if (stopBtn) stopBtn.classList.toggle('hidden', !sending);
    bus.emit('agent:status', sending ? 'thinking' : 'ready');
    // Tell the main process so it can hold/release the powerSaveBlocker
    // and update the tray indicator.
    try { api.background?.setAgentActive?.(sending); } catch {}
    const dot = document.getElementById('compose-dot');
    const label = document.getElementById('compose-label');
    const sendHint = document.getElementById('compose-send-hint');
    if (dot) {
      dot.style.background = sending ? 'var(--accent)' : 'var(--text-faint)';
      dot.style.boxShadow = sending ? '0 0 6px var(--accent)80' : 'none';
    }
    if (label) {
      label.textContent = sending ? '// streaming' : '// compose';
      label.style.color = sending ? 'var(--accent)' : 'var(--text-dim)';
    }
    if (sendHint) sendHint.classList.toggle('hidden', sending);
  }

  // ---------- a0 LLM title generation ----------
  const A0_LLM_URL = 'https://api.a0.dev/ai/llm';
  async function generateChatTitle(firstMsg) {
    const trimmed = String(firstMsg).trim().slice(0, 1000);
    if (!trimmed) return 'New chat';
    try {
      const res = await fetch(A0_LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [
          { role: 'system', content: 'You generate short titles for chat conversations.\nRules:\n- Return ONLY the title. No quotes, no markdown, no explanation.\n- 2 to 5 words.\n- Title case.\n- No trailing punctuation.\n- Capture the essence of what the user wants to do.' },
          { role: 'user', content: trimmed },
        ] }),
      });
      if (!res.ok) throw new Error('a0 ' + res.status);
      const data = await res.json();
      const title = (data?.completion || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?,;:]+$/g, '').slice(0, 60);
      return title || fallbackTitle(trimmed);
    } catch {
      return fallbackTitle(trimmed);
    }
  }
  function fallbackTitle(s) {
    return s.replace(/[^a-zA-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'New chat';
  }

  // ---------- Queue (localStorage) ----------
  function queueKey() { return state.projectPath ? `pipilot:queue:${state.projectPath}` : null; }
  function loadQueue() {
    const k = queueKey();
    if (!k) return [];
    try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
  }
  function saveQueue() {
    const k = queueKey();
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(messageQueue)); } catch {}
  }
  function renderQueuePanel() {
    const el = document.getElementById('chat-queue-panel');
    if (!el) return;
    if (!messageQueue.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.classList.toggle('collapsed', !!queueCollapsed);
    el.innerHTML = `
      <div class="chat-queue-header clickable" id="chat-queue-header">
        <span class="queue-label">// queue</span>
        <span class="queue-count">${String(messageQueue.length).padStart(2, '0')}</span>
        <span class="queue-chevron">&#9656;</span>
        <button class="queue-clear">clear</button>
      </div>
      ${messageQueue.map((m, i) => `
        <div class="chat-queue-item" data-idx="${i}">
          <span class="queue-text">${escapeHtml(m)}</span>
          <button class="queue-remove" data-idx="${i}">&times;</button>
        </div>
      `).join('')}
    `;
    el.querySelector('#chat-queue-header')?.addEventListener('click', (e) => {
      if (e.target && (e.target.closest('.queue-clear') || e.target.closest('.queue-remove'))) return;
      queueCollapsed = !queueCollapsed;
      savePanelState();
      renderQueuePanel();
    });
    el.querySelector('.queue-clear')?.addEventListener('click', () => {
      messageQueue = []; saveQueue(); renderQueuePanel();
    });
    el.querySelectorAll('.queue-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx);
        messageQueue.splice(idx, 1); saveQueue(); renderQueuePanel();
      });
    });
  }
  function drainQueue() {
    if (!messageQueue.length || isSending) return;
    const next = messageQueue.shift();
    saveQueue(); renderQueuePanel();
    if (next) { inputEl.value = next; sendMessage(); }
  }

  // ---------- Todo Panel ----------
  function renderTodoPanel() {
    const el = document.getElementById('chat-todo-panel');
    if (!el) return;
    if (!todos.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.classList.toggle('collapsed', !!todoCollapsed);
    const done = todos.filter(t => t.status === 'completed').length;
    el.innerHTML = `
      <div class="chat-todo-header">
        <span class="todo-label">// tasks</span>
        <span class="todo-count">${String(done).padStart(2, '0')} / ${String(todos.length).padStart(2, '0')}</span>
        <span class="todo-chevron">&#9656;</span>
      </div>
      <div class="chat-todo-list">
        ${todos.map(t => {
          const cls = t.status === 'completed' ? 'completed' : t.status === 'in_progress' ? 'in_progress' : '';
          const icon = t.status === 'completed'
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : t.status === 'in_progress'
              ? '<svg class="todo-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>'
              : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
          return `<div class="chat-todo-item ${cls}"><span class="todo-status">${icon}</span><span>${escapeHtml(t.content || '')}</span></div>`;
        }).join('')}
      </div>
    `;

    el.querySelector('.chat-todo-header')?.addEventListener('click', () => {
      todoCollapsed = !todoCollapsed;
      savePanelState();
      renderTodoPanel();
    });
  }

  // ---------- Ask User Question Dialog ----------
  function showAskDialog(requestId, questions) {
    pendingQuestion = { requestId, questions };
    const root = document.getElementById('chat-ask-root');
    if (!root) return;

    const normalized = (Array.isArray(questions) ? questions : []).map((q) => {
      if (typeof q === 'string') {
        return { question: q, options: [], multiSelect: false, allowFreeformInput: true };
      }
      const opts = Array.isArray(q?.options) ? q.options : [];
      const normOpts = opts.map((opt) => {
        if (typeof opt === 'string') return { label: opt, description: '' };
        return { label: opt?.label ?? String(opt ?? ''), description: opt?.description ?? '' };
      });
      return {
        header: q?.header || '',
        question: q?.question || q?.prompt || q?.text || q?.header || 'Question',
        options: normOpts,
        multiSelect: !!q?.multiSelect,
        allowFreeformInput: q?.allowFreeformInput !== false,
      };
    });

    const selections = normalized.map(() => ({ selected: new Set(), freeform: '' }));

    function isReady() {
      return normalized.every((q, idx) => {
        const sel = selections[idx];
        const hasSelection = sel.selected.size > 0;
        const hasFreeform = (sel.freeform || '').trim().length > 0;
        if (q.allowFreeformInput) {
          // If freeform allowed, either a selection OR typed input is fine.
          return hasSelection || hasFreeform;
        }
        // If freeform not allowed, must pick from options.
        return hasSelection;
      });
    }

    function render() {
      root.innerHTML = `
        <div class="chat-ask-overlay" id="ask-overlay">
          <div class="chat-ask-dialog">
            <div class="chat-ask-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="var(--accent)"/></svg>
              <span class="ask-label">// question</span>
            </div>
            <div class="chat-ask-body">
              ${normalized.map((q, qi) => `
                <div class="chat-ask-question" data-qi="${qi}">
                  ${q.header ? `<div class="ask-q-text">${escapeHtml(q.header)}</div>` : ''}
                  <div class="ask-q-text">${escapeHtml(q.question || '')}</div>
                  ${(q.options || []).map((opt, oi) => {
                    const isSelected = selections[qi].selected.has(opt.label);
                    const inputType = q.multiSelect ? 'checkbox' : 'radio';
                    return `
                      <label class="chat-ask-option ${isSelected ? 'selected' : ''}">
                        <input type="${inputType}" name="ask-q-${qi}" value="${escapeHtml(opt.label)}" data-qi="${qi}" ${isSelected ? 'checked' : ''} />
                        <span class="ask-opt-label">${escapeHtml(opt.label)}</span>
                        ${opt.description ? `<span class="ask-opt-desc">${escapeHtml(opt.description)}</span>` : ''}
                      </label>
                    `;
                  }).join('')}
                  ${q.allowFreeformInput ? `<input type="text" class="chat-ask-text-input" placeholder="Type your own answer..." data-qi="${qi}" value="${escapeHtml(selections[qi].freeform)}" />` : ''}
                </div>
              `).join('')}
            </div>
            <div class="chat-ask-footer">
              <button class="chat-ask-submit" id="ask-submit" ${isReady() ? '' : 'disabled'}>Submit</button>
            </div>
          </div>
        </div>
      `;

      root.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const qi = parseInt(e.target.dataset.qi);
          const label = e.target.value;
          const q = normalized[qi];
          if (!q) return;
          if (!q.multiSelect) selections[qi].selected.clear();
          if (e.target.checked) selections[qi].selected.add(label);
          else selections[qi].selected.delete(label);
          render();
        });
      });

      root.querySelectorAll('.chat-ask-text-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const qi = parseInt(e.target.dataset.qi);
          selections[qi].freeform = e.target.value;
          const submitBtn = root.querySelector('#ask-submit');
          if (submitBtn) submitBtn.disabled = !isReady();
        });
      });

      root.querySelector('#ask-submit')?.addEventListener('click', () => {
        if (!isReady()) return;

        const answersObj = {};
        normalized.forEach((q, qi) => {
          const sel = selections[qi];
          const picked = Array.from(sel.selected);
          const freeform = (sel.freeform || '').trim();
          const value = freeform ? freeform : (q.multiSelect ? picked.join(', ') : (picked[0] || ''));
          answersObj[q.question] = value;
        });

        try {
          if (api?.agent?.answerQuestion) api.agent.answerQuestion(requestId, answersObj);
        } catch {}
        root.innerHTML = '';
        pendingQuestion = null;
      });
    }
    render();
  }
  function hideAskDialog() {
    const root = document.getElementById('chat-ask-root');
    if (root) root.innerHTML = '';
    pendingQuestion = null;
  }

  // ---------- Feature #5: Slash Commands ----------
  // Two flavors: prompt scaffolds (drop preset text into the input) and
  // actions (intercepted in sendMessage, never reach the agent).
  const SLASH_COMMANDS = [
    { id: 'build', label: '/build', desc: 'Scaffold a new project', icon: '&#128640;', prompt: 'Build me a complete, production-quality ' },
    { id: 'design', label: '/design', desc: 'Create a stunning UI', icon: '&#127912;', prompt: 'Design a beautiful, modern UI for ' },
    { id: 'fix', label: '/fix', desc: 'Fix a bug or issue', icon: '&#128295;', prompt: 'Find and fix the bug in ' },
    { id: 'refactor', label: '/refactor', desc: 'Refactor and improve', icon: '&#9851;&#65039;', prompt: 'Refactor and improve ' },
    { id: 'explain', label: '/explain', desc: 'Explain how code works', icon: '&#128161;', prompt: 'Explain how ' },
    { id: 'deploy', label: '/deploy', desc: 'Deploy the project', icon: '&#127760;', prompt: 'Deploy the current project.' },
    { id: 'search', label: '/search', desc: 'Search files and code', icon: '&#128269;', prompt: 'Search the project for ' },
    { id: 'tree', label: '/tree', desc: 'Show project structure', icon: '&#128193;', prompt: 'Show the complete project file tree.' },
    { id: 'clear', label: '/clear', desc: 'Clear current chat view', icon: '&#129529;', action: true },
    { id: 'new', label: '/new', desc: 'Start a fresh chat session', icon: '&#10010;', action: true },
    { id: 'help', label: '/help', desc: 'Open the in-IDE docs', icon: '&#10067;', action: true },
    { id: 'effort', label: '/effort', desc: 'Set reasoning effort: none|low|medium|high|xhigh', icon: '&#129504;', action: true, takesArgs: true },
    { id: 'mode', label: '/mode', desc: 'Switch agent|plan mode', icon: '&#9881;&#65039;', action: true, takesArgs: true },
    { id: 'file', label: '/file', desc: 'Attach a file by path', icon: '&#128206;', action: true, takesArgs: true },
  ];

  function showSlashPopup(query) {
    if (!slashPopup) return;
    const filtered = query
      ? SLASH_COMMANDS.filter(c => c.id.startsWith(query) || c.label.startsWith('/' + query))
      : SLASH_COMMANDS;
    if (!filtered.length) { hideSlashPopup(); return; }
    slashActiveIdx = 0;
    slashPopup.classList.remove('hidden');
    slashPopup.innerHTML = `
      <div class="slash-header">// commands</div>
      ${filtered.map((c, i) => `
        <div class="slash-item ${i === 0 ? 'active' : ''}" data-idx="${i}" data-cmd-id="${c.id}">
          <span class="slash-icon">${c.icon}</span>
          <span class="slash-label">${c.label}</span>
          <span class="slash-desc">${escapeHtml(c.desc)}</span>
        </div>
      `).join('')}
    `;
    slashPopup.querySelectorAll('.slash-item').forEach(item => {
      item.addEventListener('click', () => {
        const cmdId = item.dataset.cmdId;
        selectSlashCommand(cmdId);
      });
    });
  }

  function hideSlashPopup() {
    if (slashPopup) {
      slashPopup.classList.add('hidden');
      slashPopup.innerHTML = '';
    }
    slashActiveIdx = -1;
  }

  function selectSlashCommand(cmdId) {
    const cmd = SLASH_COMMANDS.find(c => c.id === cmdId);
    if (!cmd || !inputEl) return;
    if (cmd.action) {
      if (cmd.takesArgs) {
        // Drop in `/effort ` so the user can finish the argument; don't fire.
        inputEl.value = cmd.label + ' ';
        inputEl.focus();
        autoResize();
        hideSlashPopup();
        const pos = inputEl.value.length;
        inputEl.setSelectionRange(pos, pos);
      } else {
        inputEl.value = '';
        autoResize();
        hideSlashPopup();
        runSlashAction(cmd.id, '');
      }
      return;
    }
    inputEl.value = cmd.prompt;
    inputEl.focus();
    autoResize();
    hideSlashPopup();
    const pos = cmd.prompt.length;
    inputEl.setSelectionRange(pos, pos);
  }

  // Execute action-style slash commands. Returns true if the input was an action
  // (so sendMessage can short-circuit instead of forwarding to the agent).
  async function runSlashAction(id, args) {
    const trimmed = String(args || '').trim();
    if (id === 'clear') {
      if (messagesEl) messagesEl.innerHTML = '';
      messages = [];
      currentAssistantEl = null;
      currentAssistantBlocks = [];
      currentAssistantMsgId = null;
      sequentialThinkingCount = 0;
      showWelcomeState();
      bus.emit('toast:show', { type: 'ok', message: 'Chat view cleared (history kept)' });
      return true;
    }
    if (id === 'new') {
      try { await newSession(); }
      catch (e) { bus.emit('toast:show', { type: 'error', message: 'Could not start session: ' + (e?.message || e) }); }
      return true;
    }
    if (id === 'help') {
      try {
        const open = window.PiPilot?.help?.open;
        if (typeof open === 'function') open(trimmed || undefined);
        else bus.emit('help:open', trimmed || undefined);
      } catch {}
      return true;
    }
    if (id === 'effort') {
      const want = trimmed.toLowerCase();
      const ok = EFFORT_LEVELS.some(l => l.id === want);
      if (!ok) {
        bus.emit('toast:show', { type: 'warn', message: 'Usage: /effort none|low|medium|high|xhigh' });
        return true;
      }
      setEffort(want);
      bus.emit('toast:show', { type: 'ok', message: 'Reasoning effort: ' + want });
      return true;
    }
    if (id === 'mode') {
      const want = trimmed.toLowerCase();
      if (want !== 'agent' && want !== 'plan') {
        bus.emit('toast:show', { type: 'warn', message: 'Usage: /mode agent|plan' });
        return true;
      }
      setMode(want);
      bus.emit('toast:show', { type: 'ok', message: 'Mode: ' + want });
      return true;
    }
    if (id === 'file') {
      if (!trimmed) {
        bus.emit('toast:show', { type: 'warn', message: 'Usage: /file <relative-or-absolute-path>' });
        return true;
      }
      let full = trimmed;
      if (state.projectPath && !/^([a-zA-Z]:[\\/]|\/)/.test(full)) {
        full = state.projectPath.replace(/[\\/]+$/, '') + '/' + full;
      }
      const name = full.split(/[\\/]/).pop() || full;
      if (!attachments.some(a => a.path === full)) {
        attachments.push({ path: full, name });
        renderAttachments();
        bus.emit('toast:show', { type: 'ok', message: 'Attached: ' + name });
      }
      return true;
    }
    return false;
  }

  // Detect "/<cmd> <args>" at the start of input. Returns { id, args } if it
  // matches an action command, otherwise null.
  function parseActionCommand(text) {
    const m = String(text || '').match(/^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/);
    if (!m) return null;
    const cmd = SLASH_COMMANDS.find(c => c.id === m[1].toLowerCase() && c.action);
    if (!cmd) return null;
    return { id: cmd.id, args: m[2] || '' };
  }

  function handleSlashInput() {
    if (!inputEl) return;
    const val = inputEl.value;
    // Match either `/cmd` or `/cmd <args>` so action commands with arguments
    // (like `/effort high`) keep the popup hidden once the user has typed past
    // the command name — but `/cmd` on its own keeps it open for completion.
    const m = val.match(/^\/([a-zA-Z]*)$/);
    if (m) {
      showSlashPopup(m[1].toLowerCase());
    } else {
      hideSlashPopup();
    }
  }

  function handleSlashKeydown(e) {
    if (!slashPopup || slashPopup.classList.contains('hidden')) return false;
    const items = slashPopup.querySelectorAll('.slash-item');
    if (!items.length) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashActiveIdx = (slashActiveIdx + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === slashActiveIdx));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashActiveIdx = (slashActiveIdx - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === slashActiveIdx));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const active = items[slashActiveIdx];
      if (active) selectSlashCommand(active.dataset.cmdId);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlashPopup();
      return true;
    }
    return false;
  }

  // ---------- Feature #6: Input Draft Persistence ----------
  function draftKey() { return state.projectPath ? `pipilot:draft:${state.projectPath}` : null; }

  function saveDraft() {
    const k = draftKey();
    if (!k || !inputEl) return;
    try {
      if (inputEl.value) {
        localStorage.setItem(k, inputEl.value);
      } else {
        localStorage.removeItem(k);
      }
    } catch {}
  }

  function loadDraft() {
    const k = draftKey();
    if (!k || !inputEl) return;
    try {
      const draft = localStorage.getItem(k);
      if (draft) {
        inputEl.value = draft;
        autoResize();
      }
    } catch {}
  }

  function clearDraft() {
    const k = draftKey();
    if (!k) return;
    try { localStorage.removeItem(k); } catch {}
  }

  // ---------- Feature #8: Context Optimization Shimmer ----------
  function showCompactIndicator() {
    if (compactIndicator) compactIndicator.classList.remove('hidden');
  }
  function hideCompactIndicator() {
    if (compactIndicator) compactIndicator.classList.add('hidden');
  }

  // ---------- Feature #18: Editor Context Pills ----------
  function renderEditorContext() {
    if (!editorContextEl) return;
    const file = state.activeFile;
    if (!file) { editorContextEl.innerHTML = ''; return; }
    const name = file.split(/[\\/]/).pop() || file;
    editorContextEl.innerHTML = `
      <span class="editor-ctx-pill">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        ${escapeHtml(name)}
        <span class="ctx-x">&times;</span>
      </span>
    `;
    editorContextEl.querySelector('.ctx-x')?.addEventListener('click', () => {
      editorContextEl.innerHTML = '';
    });
  }

  // ---------- Conversation persistence (localStorage) ----------
  function convKey() { return state.projectPath ? `pipilot:conv:${state.projectPath}:${currentSessionId}` : null; }
  function saveConversation() {
    const k = convKey();
    if (!k) return;
    try {
      const data = { sessionId: currentSessionId, messages, savedAt: Date.now() };
      localStorage.setItem(k, JSON.stringify(data));
    } catch {}
  }

  // ---------- Send (with queue support + IndexedDB) ----------
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    // Intercept action-style slash commands BEFORE the project-path guard so
    // /help works even when no project is open. Action commands clear the input
    // themselves.
    const action = parseActionCommand(text);
    if (action) {
      hideSlashPopup();
      inputEl.value = '';
      autoResize();
      clearDraft();
      await runSlashAction(action.id, action.args);
      return;
    }

    if (!state.projectPath) {
      bus.emit('toast:show', { message: 'Open a project first', type: 'warn' });
      return;
    }

    // Hide slash popup
    hideSlashPopup();

    // If already streaming, queue the message
    if (isSending) {
      messageQueue.push(text);
      saveQueue();
      renderQueuePanel();
      inputEl.value = '';
      autoResize();
      bus.emit('toast:show', { message: 'Message queued', type: 'ok' });
      return;
    }

    // Create session if needed
    if (!currentSessionId) {
      await newSession();
    }

    inputEl.value = '';
    autoResize();
    clearDraft(); // Feature #6
    appendUserMessage(text);
    userMessageCount++;
    updateMsgCounter(); // Feature #21

    currentAssistantEl = null;
    currentAssistantBlocks = [];
    currentAssistantMsgId = `asst-${generateId()}`;
    sequentialThinkingCount = 0;

    const sentAttachments = attachments.slice();
    attachments = [];
    renderAttachments();

    // Save user message to IndexedDB
    saveUserMessageToDB(text, sentAttachments);

    // Auto-create checkpoint before agent makes changes
    if (state.projectPath && api.checkpoints?.create) {
      try {
        const cpResult = await api.checkpoints.create(state.projectPath, `before-turn-${userMessageCount}`);
        if (cpResult?.ok && cpResult.id) {
          // Tag the user message wrap so the revert button can find the checkpoint
          const userMsgs = messagesEl?.querySelectorAll('.msg-user');
          const lastUserMsg = userMsgs && userMsgs[userMsgs.length - 1];
          if (lastUserMsg) lastUserMsg.dataset.checkpointId = cpResult.id;
        }
      } catch (err) {
        console.warn('[chat] auto-checkpoint failed:', err);
      }
    }

    setSending(true);
    ensureAssistantMessage();

    // Title generation on first message (background, non-blocking)
    if (!firstUserMessageSent && currentSessionId) {
      firstUserMessageSent = true;
      generateChatTitle(text).then(async (title) => {
        if (title && currentSessionId) {
          try {
            if (chatDB) await chatDB.updateSession(currentSessionId, { title });
            if (sessionTitleEl) sessionTitleEl.textContent = title;
          } catch {}
        }
      }).catch(() => {});
    }

    // History context is injected server-side by ipc-agent.js from _pipilot_history.json
    let messageToSend = text;
    // If files are attached, append read instructions so the agent knows to look at them
    if (sentAttachments.length > 0) {
      const fileLines = sentAttachments.map(a => {
        const isImg = a.isImage || /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(a.name || '');
        return isImg
          ? `- Image: ${a.path} (Use the Read tool to view this image)`
          : `- File: ${a.path} (Read this file for reference)`;
      }).join('\n');
      messageToSend += `\n\n[Attached files — read these for context]\n${fileLines}`;
    }

    // Embedded-browser context: if the user has any browser tabs open in the
    // IDE, surface them so the agent can reason about them and act via the
    // mcp__pipilot__browser_* tools (browser_observe, browser_navigate, etc.)
    // without the user having to mention them. Skipped silently when no tabs
    // are open or when the user toggled it off in settings.
    try {
      const browserCtxOff = localStorage.getItem('pipilot.chat.browserContext') === '0';
      if (!browserCtxOff && window.PiPilot?.browser?.listOpenTabs) {
        const tabs = window.PiPilot.browser.listOpenTabs() || [];
        if (tabs.length) {
          const lines = tabs.map(t => {
            const flags = [];
            if (t.active) flags.push('active');
            if (t.mode === 'inc') flags.push('private');
            const flagStr = flags.length ? ` (${flags.join(', ')})` : '';
            const title = (t.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
            return `- tabId: ${t.tabId}${flagStr}\n  url:   ${t.url || ''}\n  title: ${title || '(no title)'}`;
          }).join('\n');
          messageToSend += `\n\n[Embedded browser context — ${tabs.length} tab${tabs.length === 1 ? '' : 's'} currently open]\n${lines}\n\nYou can interact with these via mcp__pipilot__browser_observe / browser_navigate / browser_click_ref / browser_type / browser_press_key. Pass tabId to target a specific tab; omit for the active tab.`;
        }
      }
    } catch (err) { console.warn('[chat] browser-context inject failed:', err); }

    activeStream = api.agent.send({
      sessionId: currentSessionId,
      projectPath: state.projectPath,
      message: messageToSend,
      mode: state.agentMode,
      effort: state.reasoningEffort || 'medium',
      attachments: sentAttachments,
    }, (evt) => {
      handleAgentEvent(evt);
    });
  }

  // Detect file-mutating tool calls in the just-finished turn. We only
  // trigger the wiki updater for source-file writes — skip lockfiles,
  // tests, generated assets, and anything inside .pipilot/wikis/ (the
  // wiki agent's own writes must not re-trigger itself).
  const WIKI_WRITE_TOOLS = new Set([
    'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
    'create_file', 'edit_file', 'write_file', 'edit_file_patch',
  ]);
  const WIKI_SKIP_RE = /(\.test\.|\.spec\.|__tests__|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.|node_modules|\.pipilot[\\/](wikis|sessions|memory)|\.git[\\/])/i;

  function collectChangedFiles(blocks) {
    const files = new Set();
    for (const b of blocks || []) {
      if (b?.type !== 'tool_call') continue;
      // Strip any mcp prefix so both built-in and MCP-wrapped versions
      // hit the same set ("mcp__pipilot__edit_file_patch" → "edit_file_patch").
      const baseName = (b.name || '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
      if (!WIKI_WRITE_TOOLS.has(b.name) && !WIKI_WRITE_TOOLS.has(baseName)) continue;
      const inp = b.input || {};
      // edit_file_patch uses `filepath`; SDK Write/Edit use `file_path`;
      // some tools use `path` / `target_file` / `filePath`.
      const candidate = inp.file_path || inp.filepath || inp.path || inp.target_file || inp.filePath;
      if (typeof candidate === 'string' && candidate && !WIKI_SKIP_RE.test(candidate)) {
        files.add(candidate);
      }
      // MultiEdit: { file_path, edits: [...] }
      if (Array.isArray(inp.files)) {
        for (const f of inp.files) {
          const p = typeof f === 'string' ? f : (f?.path || f?.file_path || f?.filepath);
          if (typeof p === 'string' && p && !WIKI_SKIP_RE.test(p)) files.add(p);
        }
      }
    }
    if (files.size === 0) {
      // Diagnostic: log what tool calls we saw so the user can see why
      // nothing matched (wrong tool name, wrong field, skipped path).
      const seen = (blocks || [])
        .filter(b => b?.type === 'tool_call')
        .map(b => ({ name: b.name, inputKeys: Object.keys(b.input || {}) }));
      if (seen.length) console.log('[wiki-auto-update] no file edits matched. tool_calls=', seen);
    }
    return Array.from(files);
  }

  function lastAssistantTextSummary(blocks) {
    for (let i = (blocks?.length || 0) - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        return b.text.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim().slice(0, 1200);
      }
    }
    return '';
  }

  function maybeQueueWikiUpdate(resultEvt) {
    if (!resultEvt || resultEvt.subtype === 'aborted' || resultEvt.subtype === 'error') return;
    if (state.agentMode === 'plan') return;
    if (!state.projectPath) return;
    const changed = collectChangedFiles(currentAssistantBlocks);
    if (!changed.length) return;
    const summary = lastAssistantTextSummary(currentAssistantBlocks);
    console.log('[wiki-auto-update] queued', { changedFiles: changed, summaryChars: summary.length });
    bus.emit('wiki:auto-update', {
      projectPath: state.projectPath,
      changedFiles: changed,
      summary,
      timestamp: Date.now(),
    });
  }

  function handleAgentEvent(evt) {
    if (!evt) return;
    switch (evt.type) {
      case 'system':
        break;
      case 'init':
      case 'system:init':
        break;
      case 'compact_boundary':
        appendBoundary('Context compacted' + (evt.trigger ? ` (${evt.trigger})` : ''));
        // Feature #8: Compact indicator
        showCompactIndicator();
        setTimeout(hideCompactIndicator, 3000);
        break;
      case 'status':
        bus.emit('agent:status', evt.status || 'ready');
        break;
      case 'hook':
        break;
      case 'auth_status':
        if (evt.error) appendError('Auth: ' + evt.error);
        break;
      case 'tool_progress':
        updateToolProgress(evt.toolUseId, evt.elapsedSeconds);
        break;
      case 'wiki_generating':
        bus.emit('wiki:generating', evt.generating);
        break;
      case 'text':
        appendAssistantText(evt.text || '');
        break;
      case 'text_delta':
        break;
      case 'block_start':
      case 'block_stop':
      case 'message_stop':
      case 'input_delta':
      case 'thinking_delta':
        break;
      case 'tool_call':
        // Flush any text held back by the <reasoning> parser before drawing
        // the tool pill — otherwise the trailing chars of the prior text
        // chunk (e.g. "wor" from "working") stay buffered and never display.
        flushBufferedTextToBody();
        // Notify diagnostics + other listeners when the chat agent
        // edits a file (since chokidar may not be watching yet).
        try {
          const editTools = new Set(['Write','Edit','MultiEdit','NotebookEdit','create_file','edit_file','write_file','edit_file_patch']);
          const baseName = (evt.name || '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
          if (editTools.has(evt.name) || editTools.has(baseName)) {
            const inp = evt.input || {};
            const p = inp.file_path || inp.filepath || inp.path || inp.target_file || null;
            bus.emit('agent:file-edit', { path: p, by: 'chat', tool: evt.name });
          }
        } catch {}
        if (evt.name === 'TodoWrite') {
          try {
            const input = evt.input || {};
            todos = (input.todos || []).map((t, i) => ({
              id: t.id || `todo-${i}`,
              content: t.content || t.description || '',
              status: t.status || 'pending',
            }));
            renderTodoPanel();
          } catch {}
        } else if (evt.name === 'AskUserQuestion') {
          try {
            const input = evt.input || {};
            const questions = input.questions || [{ question: input.question || input.header || 'The agent needs your input' }];
            // Backward compatibility: if the main process didn't intercept with canUseTool yet
            showAskDialog(evt.id, questions);
          } catch {}
        }
        appendToolCard(evt);
        break;
      case 'ask_user':
        try {
          showAskDialog(evt.requestId, evt.questions || []);
        } catch {}
        break;
      case 'tool_result':
        markToolResult(evt.toolUseId, evt.content, evt.isError);
        // Update todos if a TodoWrite result comes back
        if (evt.content && typeof evt.content === 'string' && evt.content.includes('"todos"')) {
          try {
            const parsed = JSON.parse(evt.content);
            if (parsed.todos) {
              todos = parsed.todos.map((t, i) => ({
                id: t.id || `todo-${i}`,
                content: t.content || t.description || '',
                status: t.status || 'pending',
              }));
              renderTodoPanel();
            }
          } catch {}
        }
        break;
      case 'thinking':
        appendThinking(evt.text || '');
        break;
      case 'error':
        flushBufferedTextToBody();
        appendError(evt.message || 'Unknown error');
        isSending = false;
        setSending(false);
        bus.emit('agent:status', 'error');
        hideAskDialog();
        saveConversation();
        // Feature #13: Show interruption banner if no result
        showInterruptionBanner();
        // Save partial assistant message
        saveAssistantMessageToDB(null);
        // Try to drain queue
        setTimeout(drainQueue, 500);
        break;
      case 'result':
        flushBufferedTextToBody();
        rescueUnclosedReasoning();
        finalizeResult(evt);
        bus.emit('wiki:generating', false); // clear wiki generating state
        isSending = false;
        setSending(false);
        if (activeStream && activeStream.dispose) activeStream.dispose();
        activeStream = null;
        hideAskDialog();
        saveConversation();
        currentAssistantEl = null;
        // Trigger background wiki auto-update if the agent made meaningful
        // file changes this turn. Skipped for plan mode and aborted runs.
        try { maybeQueueWikiUpdate(evt); } catch (e) { console.warn('[wiki-auto] queue failed', e); }
        // Auto-drain queue
        setTimeout(drainQueue, 500);
        break;
    }
  }

  function appendBoundary(label) {
    const wrap = ensureAssistantMessage();
    const el = document.createElement('div');
    el.className = 'boundary';
    el.innerHTML = `<span class="boundary-line"></span><span class="boundary-label">${escapeHtml(label)}</span><span class="boundary-line"></span>`;
    getBodyWrap(wrap).appendChild(el);
  }

  function updateToolProgress(toolUseId, elapsed) {
    if (!currentAssistantEl || !toolUseId) return;
    const pill = currentAssistantEl.querySelector(`.tool-pill[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (!pill) {
      // Subagent child rows are compact; no elapsed UI for now.
      return;
    }

    // Update elapsed chip
    let chip = pill.querySelector('.tool-pill-elapsed');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'tool-pill-elapsed';
      chip.style.cssText = 'color:var(--text-dim);font-size:10px;margin:0 6px 0 6px;flex-shrink:0;';
      const status = pill.querySelector('.tool-pill-status');
      if (status) status.parentNode.insertBefore(chip, status);
    }
    chip.textContent = elapsed ? `${elapsed.toFixed(1)}s` : '';

    // Feature #9: Update sub-agent elapsed and progress
    if (pill.classList.contains('kind-subagent')) {
      const elapsedSpan = pill.querySelector('.subagent-elapsed');
      if (elapsedSpan) elapsedSpan.textContent = `${Math.round(elapsed)}s`;
      const fill = pill.querySelector('.subagent-progress-fill');
      if (fill) {
        // Estimate progress (asymptotic approach to 90%)
        const pct = Math.min(90, (1 - Math.exp(-elapsed / 30)) * 100);
        fill.style.width = pct + '%';
      }
    }

    // Feature #12: Skip button after 45s
    if (elapsed > 45 && !pill.querySelector('.tool-skip-btn') && pill.classList.contains('running')) {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'tool-skip-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeStream && activeStream.stop) activeStream.stop();
      });
      const head = pill.querySelector('.tool-pill-head');
      if (head) {
        const chevron = head.querySelector('.tool-pill-chevron');
        if (chevron) head.insertBefore(skipBtn, chevron);
        else head.appendChild(skipBtn);
      }
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (activeStream && activeStream.stop) activeStream.stop();
      isSending = false;
      setSending(false);
      bus.emit('agent:status', 'ready');
    });
  }

  // ---------- Textarea behavior ----------
  function autoResize() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    const h = Math.min(inputEl.scrollHeight, 6 * 22);
    inputEl.style.height = h + 'px';
  }

  if (inputEl) {
    inputEl.addEventListener('input', () => {
      autoResize();
      handleMentionTrigger();
      handleSlashInput(); // Feature #5

      // Feature #6: Draft persistence (debounced)
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(saveDraft, 500);

      const charsEl = document.getElementById('compose-chars');
      if (charsEl) {
        const len = inputEl.value.length;
        if (len > 0) {
          charsEl.textContent = len.toLocaleString();
          charsEl.classList.remove('hidden');
          charsEl.style.color = len > 4000 ? 'var(--warn)' : 'var(--text-dim)';
        } else {
          charsEl.classList.add('hidden');
        }
      }
    });
    inputEl.addEventListener('keydown', (e) => {
      // Feature #5: Slash command keyboard nav
      if (handleSlashKeydown(e)) return;

      // @ menu keyboard nav — handled by the search input inside the menu
      if (atMenuEl && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab' || e.key === 'Escape')) {
        if (atSearchInput) atSearchInput.focus();
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !atMenuEl) {
        e.preventDefault();
        sendMessage();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // ---------- @ Attach Menu (Vite-style editorial) ----------
  let atMenuEl = null;
  let atMenuFiles = null; // [{ name, path, type: 'file'|'dir' }]
  let atMenuStartIdx = -1;
  let atMenuFilter = '';
  let atMenuIndex = 0;
  let atSearchInput = null;
  const MAX_ATTACH_LINES = 500;

  async function ensureAtFiles() {
    if (atMenuFiles || !state.projectPath) return atMenuFiles;
    try {
      const tree = await api.files.tree(state.projectPath);
      const flat = [];
      function walk(node) {
        if (!node) return;
        flat.push({ name: node.name, path: node.path, type: node.type || 'file' });
        if (node.children) node.children.forEach(walk);
      }
      walk(tree);
      atMenuFiles = flat;
    } catch {
      atMenuFiles = [];
    }
    return atMenuFiles;
  }

  function fuzzyMatch(target, query) {
    const tl = target.toLowerCase(), ql = query.toLowerCase();
    if (tl.includes(ql)) return { matches: true, score: 100 + (ql.length / tl.length) * 50 };
    let qi = 0, bonus = 0, lastIdx = -2;
    for (let ti = 0; ti < tl.length && qi < ql.length; ti++) {
      if (tl[ti] === ql[qi]) { if (ti === lastIdx + 1) bonus += 10; lastIdx = ti; qi++; }
    }
    if (qi === ql.length) return { matches: true, score: (ql.length / tl.length) * 40 + bonus };
    return { matches: false, score: 0 };
  }

  function getFilteredAtFiles() {
    const all = atMenuFiles || [];
    const q = atMenuFilter.toLowerCase();
    if (!q) {
      return [...all].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.path.localeCompare(b.path);
      }).slice(0, 12);
    }
    return all.map(f => ({ ...f, ...fuzzyMatch(f.path, q) }))
      .filter(f => f.matches)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  function closeAtMenu() {
    if (atMenuEl) { atMenuEl.remove(); atMenuEl = null; }
    atSearchInput = null;
    atMenuFilter = '';
    atMenuIndex = 0;
  }

  function isAlreadyAttached(filePath) {
    return attachments.some(a => a.path === filePath || a.name === filePath);
  }

  const AT_ICONS = {
    folder: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    file: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    search: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    at: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
    x: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  function atRelPath(p) {
    if (state.projectPath && p.startsWith(state.projectPath)) {
      return p.slice(state.projectPath.length).replace(/^[\\/]+/, '');
    }
    return p;
  }

  function renderAtMenu() {
    const filtered = getFilteredAtFiles();
    const totalCount = (atMenuFiles || []).length;
    const isFirstRender = !atMenuEl;

    if (isFirstRender) {
      atMenuEl = document.createElement('div');
      atMenuEl.className = 'at-menu';
      const compose = chatPanel?.querySelector('.chat-compose');
      if (compose) chatPanel.insertBefore(atMenuEl, compose);
      else chatPanel?.appendChild(atMenuEl);

      // Build static shell (header + search + list container + footer)
      atMenuEl.innerHTML = `
        <div class="at-menu-header">
          <span class="at-icon">${AT_ICONS.at}</span>
          <span class="at-label">/ @</span>
          <span class="at-sublabel">Attach File</span>
          <span class="at-count"></span>
        </div>
        <div class="at-menu-search">
          ${AT_ICONS.search}
          <input type="text" placeholder="search files…" />
          <span class="at-clear-wrap"></span>
          <kbd>ESC</kbd>
        </div>
        <div class="at-menu-list"></div>
        <div class="at-menu-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> attach</span>
        </div>
      `;

      // Wire search input ONCE (persists across re-renders)
      atSearchInput = atMenuEl.querySelector('.at-menu-search input');
      atSearchInput.value = atMenuFilter;
      atSearchInput.addEventListener('input', (e) => {
        atMenuFilter = e.target.value;
        atMenuIndex = 0;
        updateAtMenuList();
      });
      atSearchInput.addEventListener('keydown', (e) => {
        const filteredNow = getFilteredAtFiles();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          atMenuIndex = Math.min(atMenuIndex + 1, filteredNow.length - 1);
          updateAtMenuList();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          atMenuIndex = Math.max(atMenuIndex - 1, 0);
          updateAtMenuList();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const f = filteredNow[atMenuIndex];
          if (f && !isAlreadyAttached(f.path)) selectAtFile(f);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeAtMenu();
          inputEl?.focus();
        }
      });
      setTimeout(() => atSearchInput.focus(), 0);
    }

    // Update count
    const countEl = atMenuEl.querySelector('.at-count');
    if (countEl) countEl.textContent = `${String(filtered.length).padStart(2, '0')} / ${String(totalCount).padStart(2, '0')}`;

    // Update clear button
    const clearWrap = atMenuEl.querySelector('.at-clear-wrap');
    if (clearWrap) {
      if (atMenuFilter) {
        clearWrap.innerHTML = `<button class="at-clear">${AT_ICONS.x}</button>`;
        clearWrap.querySelector('.at-clear')?.addEventListener('click', () => {
          atMenuFilter = '';
          atMenuIndex = 0;
          if (atSearchInput) { atSearchInput.value = ''; atSearchInput.focus(); }
          updateAtMenuList();
        });
      } else {
        clearWrap.innerHTML = '';
      }
    }

    updateAtMenuList();
  }

  function updateAtMenuList() {
    if (!atMenuEl) return;
    const filtered = getFilteredAtFiles();
    const listEl = atMenuEl.querySelector('.at-menu-list');
    if (!listEl) return;

    // Update count
    const totalCount = (atMenuFiles || []).length;
    const countEl = atMenuEl.querySelector('.at-count');
    if (countEl) countEl.textContent = `${String(filtered.length).padStart(2, '0')} / ${String(totalCount).padStart(2, '0')}`;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="at-menu-empty"><div class="at-empty-label">// NO MATCHES</div>${atMenuFilter ? `No files match "${escapeHtml(atMenuFilter)}"` : 'No files in this project'}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((f, idx) => {
      const isFolder = f.type === 'dir' || f.type === 'folder';
      const attached = isAlreadyAttached(f.path);
      const selected = idx === atMenuIndex;
      return `<button class="at-menu-item ${selected ? 'selected' : ''} ${attached ? 'attached' : ''}" data-idx="${idx}" data-path="${escapeHtml(f.path)}" ${attached ? 'disabled' : ''}>
        <span class="at-file-icon">${isFolder ? AT_ICONS.folder : AT_ICONS.file}</span>
        <span class="at-file-path">${escapeHtml(atRelPath(f.path))}</span>
        ${attached ? '<span class="at-attached-badge">attached</span>' : ''}
      </button>`;
    }).join('');

    // Wire item events
    listEl.querySelectorAll('.at-menu-item:not(.attached)').forEach(item => {
      item.addEventListener('click', () => {
        const f = getFilteredAtFiles()[parseInt(item.dataset.idx)];
        if (f) selectAtFile(f);
      });
      item.addEventListener('mouseenter', () => {
        atMenuIndex = parseInt(item.dataset.idx);
        listEl.querySelectorAll('.at-menu-item').forEach((el, i) => el.classList.toggle('selected', i === atMenuIndex));
      });
    });
  }

  function selectAtFile(file) {
    // Add as attachment
    const name = file.name || file.path.split(/[\\/]/).pop();
    attachments.push({ path: file.path, name });
    renderAttachments();
    // Remove the @query from input
    if (atMenuStartIdx >= 0) {
      const val = inputEl.value;
      const before = val.slice(0, atMenuStartIdx);
      const afterAt = val.slice(atMenuStartIdx);
      const spaceIdx = afterAt.indexOf(' ');
      const after = spaceIdx >= 0 ? afterAt.slice(spaceIdx) : '';
      inputEl.value = before + after;
    }
    closeAtMenu();
    inputEl?.focus();
    autoResize();
  }

  function openAtMenu() {
    if (atMenuEl) return; // already open
    ensureAtFiles().then(() => renderAtMenu());
  }

  async function handleMentionTrigger() {
    const val = inputEl.value;
    const cursor = inputEl.selectionStart;
    const before = val.slice(0, cursor);
    const m = before.match(/@([\w./-]*)$/);
    if (!m) { closeAtMenu(); return; }
    atMenuStartIdx = cursor - m[0].length;
    atMenuFilter = m[1] || '';
    atMenuIndex = 0;
    await ensureAtFiles();
    renderAtMenu();
  }

  // Also open via the @ attach button
  if (attachBtn) {
    // Remove old click handler and replace
    const newAttachBtn = attachBtn.cloneNode(true);
    attachBtn.parentNode.replaceChild(newAttachBtn, attachBtn);
    newAttachBtn.addEventListener('click', () => {
      if (atMenuEl) { closeAtMenu(); inputEl?.focus(); }
      else { atMenuStartIdx = inputEl?.selectionStart || 0; openAtMenu(); }
    });
  }

  document.addEventListener('click', (e) => {
    if (atMenuEl && !atMenuEl.contains(e.target) && e.target !== inputEl && !e.target.closest('.compose-action-btn')) {
      closeAtMenu();
    }
  });

  // ---------- Bus events ----------
  bus.on('project:opened', async () => {
    mentionFiles = null;
    messages = [];
    allHistoryMessages = [];
    renderedMessageCount = 0;
    currentSessionId = null;
    firstUserMessageSent = false;
    userMessageCount = 0;
    sequentialThinkingCount = 0;
    currentAssistantBlocks = [];
    currentAssistantMsgId = null;
    todos = [];
    messageQueue = loadQueue();
    if (messagesEl) messagesEl.innerHTML = '';
    currentAssistantEl = null;
    renderTodoPanel();
    renderQueuePanel();
    hideAskDialog();
    updateMsgCounter();
    loadPanelState();
    loadDraft(); // Feature #6
    renderEditorContext(); // Feature #18
    await newSession();
  });

  // Generate a creative "what we did today" diary summary via the a0 LLM.
  // Context budget: ~30k chars input (≈ 7-8k tokens, well under the 10k
  // context window). Output capped to 1000 tokens via maxTokens. Falls
  // back to a deterministic concatenation if the API call fails.
  const A0_DIARY_URL = 'https://api.a0.dev/ai/llm';
  async function generateDiarySummary(msgs) {
    if (!Array.isArray(msgs) || !msgs.length) return null;
    // Pull a compact transcript: user intents + assistant outcomes only,
    // skipping tool noise. Keep most recent 14 turns.
    const transcript = msgs
      .filter(m => (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim())
      .slice(-14)
      .map(m => {
        const role = m.role === 'user' ? 'User' : 'Agent';
        const text = String(m.content).replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim();
        return `${role}: ${text}`;
      })
      .join('\n\n')
      .slice(0, 30000);
    if (!transcript.trim()) return null;
    const system = `You are a developer's session journaler. From a chat transcript, write a SHORT, vivid 2-3 sentence diary entry capturing:
- what was worked on (which file/feature)
- what was achieved or attempted
- where the user left off (next step or blocker)

Voice: first person plural ("we tried…"), warm but precise. No fluff, no greetings, no markdown headers, no bullet points — just plain prose. Max 3 sentences. Don't quote the user verbatim — paraphrase.`;
    try {
      const res = await fetch(A0_DIARY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: transcript },
          ],
          maxTokens: 1000,
          max_tokens: 1000,
          temperature: 0.7,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const out = (data?.completion || data?.content || data?.text || '').trim();
      // Strip surrounding quotes / fences if the model adds them.
      return out.replace(/^["'`]+|["'`]+$/g, '').replace(/^```[a-z]*\s*|\s*```$/g, '').trim() || null;
    } catch {
      return null;
    }
  }

  function fallbackDiarySummary(msgs) {
    const lastUser = msgs.slice().reverse().find(m => m.role === 'user');
    const lastAsst = msgs.slice().reverse().find(m => m.role === 'assistant' && m.content);
    const prompt = lastUser?.content?.trim().slice(0, 160) || '';
    const summary = lastAsst?.content?.trim().slice(0, 220) || '';
    const lines = [];
    if (prompt) lines.push('Last prompt: ' + prompt.replace(/\n+/g, ' '));
    if (summary) lines.push('Agent summary: ' + summary.replace(/\n+/g, ' '));
    return lines.join(' ') || 'Project closed.';
  }

  bus.on('project:closed', (payload) => {
    // Resumption diary: write a brief "what we did" entry before the
    // project unloads, so the next time it's opened the welcome tab can
    // show a Yesterday Card. The summary itself is generated by the a0
    // creative LLM (10k context, 1k tokens out), with a deterministic
    // local fallback when the network is unavailable.
    //
    // Source of truth: chatDB (persisted IndexedDB rows) for the active
    // session — the previous version read a stale `messages` variable
    // that was never populated, so the diary never wrote anything.
    const projectPath = payload?.path || state.projectPath;
    const sessionId = currentSessionId;
    if (projectPath && api.diary?.write && chatDB?.getMessages && sessionId) {
      // Fire-and-forget — must run BEFORE we clear sessionId below.
      (async () => {
        let rows = [];
        try { rows = await chatDB.getMessages(sessionId) || []; } catch {}
        // Reduce to a clean role/content shape the generator + fallback expect.
        const snapshot = rows
          .filter(r => r && (r.role === 'user' || r.role === 'assistant'))
          .map(r => {
            let content = r.content || '';
            // Reconstruct content from blocks if the row only stored blocks.
            if (!content && Array.isArray(r.blocks)) {
              content = r.blocks
                .filter(b => b && b.type === 'text' && b.text)
                .map(b => b.text)
                .join('\n')
                .trim();
            }
            return { role: r.role, content, ts: r.timestamp };
          })
          .filter(m => m.content && m.content.trim());
        if (!snapshot.length) {
          console.log('[diary] skipped — no messages in session', sessionId);
          return;
        }
        const aiSummary = await generateDiarySummary(snapshot);
        const summary = aiSummary || fallbackDiarySummary(snapshot);
        try {
          const r = await api.diary.write(projectPath, {
            summary,
            at: Date.now(),
            meta: { turns: snapshot.length, session: sessionId, source: aiSummary ? 'a0' : 'local' },
          });
          console.log('[diary] wrote entry', r);
        } catch (err) {
          console.warn('[diary] write failed:', err);
        }
      })();
    } else {
      console.log('[diary] skipped — missing prerequisites', {
        hasProject: !!projectPath, hasApi: !!api.diary?.write, hasDB: !!chatDB?.getMessages, hasSession: !!sessionId,
      });
    }

    if (activeStream && activeStream.stop) activeStream.stop();
    activeStream = null;
    currentSessionId = null;
    messages = [];
    allHistoryMessages = [];
    if (messagesEl) messagesEl.innerHTML = '';
  });

  bus.on('chat:focus-with-prompt', (text) => {
    if (chatPanel) chatPanel.classList.remove('hidden');
    if (inputEl) {
      inputEl.value = text || '';
      inputEl.focus();
      autoResize();
    }
  });

  bus.on('chat:attach-file', (detail) => {
    try {
      const p = typeof detail === 'string' ? detail : detail?.path;
      if (!p) return;
      const name = (typeof detail === 'object' && detail?.name)
        ? detail.name
        : String(p).split(/[\\/]/).pop();
      if (!attachments.some((a) => a.path === p)) {
        attachments.push({ path: p, name });
        renderAttachments();
      }
      if (chatPanel) chatPanel.classList.remove('hidden');
    } catch (e) {
      console.error('chat:attach-file', e);
    }
  });

  bus.on('chat:clear-attachments', () => {
    try {
      attachments = [];
      renderAttachments();
    } catch (e) {
      console.error('chat:clear-attachments', e);
    }
  });

  // ---------- Vite-style window events bridge ----------
  // The Vite app dispatches CustomEvents on window (pipilot:attach-file,
  // pipilot:open-chat, pipilot:focus-chat-input, ...). The fiddle renderer
  // historically used the internal bus. We support both for parity.
  window.addEventListener('pipilot:open-chat', () => {
    if (chatPanel) chatPanel.classList.remove('hidden');
  });

  window.addEventListener('pipilot:attach-file', (e) => {
    const detail = (e && e.detail) || {};
    const filePath = typeof detail === 'string' ? detail : detail.filePath;
    if (!filePath) return;
    bus.emit('chat:attach-file', { path: filePath, name: String(filePath).split(/[\\/]/).pop() });
  });

  window.addEventListener('pipilot:clear-attachments', () => {
    bus.emit('chat:clear-attachments');
  });

  window.addEventListener('pipilot:focus-chat-input', (e) => {
    const detail = (e && e.detail) || {};
    const prefill = detail.prefill || '';
    const submit = !!detail.submit;
    if (chatPanel) chatPanel.classList.remove('hidden');
    if (!inputEl) return;
    inputEl.value = prefill;
    inputEl.focus();
    autoResize();
    if (submit) sendMessage();
  });

  window.addEventListener('pipilot:notify', (e) => {
    const d = (e && e.detail) || {};
    const typeMap = { success: 'success', info: 'info', warning: 'warn', error: 'error' };
    const type = typeMap[d.type] || 'info';
    const title = d.title ? String(d.title) + (d.message ? ': ' : '') : '';
    const message = title + (d.message ? String(d.message) : '');
    bus.emit('toast:show', { message, type });
  });

  bus.on('menu:toggle-chat', () => {
    if (chatPanel) chatPanel.classList.toggle('hidden');
  });

  bus.on('chat:send', () => {
    if (document.activeElement === inputEl) sendMessage();
  });

  // Feature #18: Listen for active file changes
  bus.on('editor:active-changed', (detail) => {
    try {
      if (detail && typeof detail.path !== 'undefined') {
        state.activeFile = detail.path || null;
      }
    } catch {}
    renderEditorContext();
  });

  bus.on('editor:active-file', () => {
    renderEditorContext();
  });

  bus.on('file:opened', () => {
    renderEditorContext();
  });

  // ---------- Chat Panel Right-Click Context Menu ----------
  let chatCtxMenu = null;

  function closeChatCtxMenu() {
    if (chatCtxMenu) { chatCtxMenu.remove(); chatCtxMenu = null; }
  }

  // ─── Session transcript builder ─────────────────────────────────────
  // Walks the messages container in DOM order and produces a portable
  // markdown document that mirrors what the user sees in the chat panel:
  // text + tool pills (with paths/args/descriptions) + reasoning blocks
  // + sub-agent cards + result footers, all interleaved in original
  // order. Anyone can read this and reconstruct exactly what happened.

  function _trimMultiline(s, maxLines, maxChars) {
    if (!s) return '';
    let out = String(s);
    if (out.length > maxChars) out = out.slice(0, maxChars) + ' …(truncated)';
    const lines = out.split('\n');
    if (lines.length > maxLines) out = lines.slice(0, maxLines).join('\n') + `\n…(${lines.length - maxLines} more lines)`;
    return out;
  }

  function _detectFenceLang(toolName) {
    const t = String(toolName || '').toLowerCase();
    if (t === 'bash' || t === 'run_in_terminal') return 'bash';
    if (t.includes('json')) return 'json';
    return '';
  }

  function _formatToolPill(pill) {
    const name = pill.dataset.toolName || pill.querySelector('.tool-pill-label')?.textContent?.trim() || 'Tool';
    const summary = pill.querySelector('.tool-pill-summary')?.textContent?.trim() || '';
    const bashDesc = pill.querySelector('.tool-pill-bash-desc')?.textContent?.trim() || '';
    const argsStr = pill.querySelector('.tool-pill-pre')?.textContent?.trim() || '';
    const isError = pill.classList.contains('error');
    const isMcp = pill.classList.contains('kind-mcp');
    const status = isError ? '🔴' : (isMcp ? '🔌' : '🔧');

    // Try to parse args JSON so we can pretty-render specific fields.
    let args = null;
    if (argsStr && argsStr !== '{}') {
      try { args = JSON.parse(argsStr); } catch {}
    }

    const parts = [];
    // Header line — prioritises the most meaningful preview per tool.
    if (bashDesc) {
      parts.push(`**${status} ${name}** — ${bashDesc}`);
    } else if (summary) {
      parts.push(`**${status} ${name}** \`${summary}\``);
    } else {
      parts.push(`**${status} ${name}**`);
    }

    // Body — choose what to inline based on tool kind.
    if (args) {
      const lname = name.toLowerCase();
      // Bash command: show full command on its own line
      if (lname === 'bash' || lname === 'run_in_terminal') {
        if (args.command) {
          parts.push('```bash\n$ ' + _trimMultiline(args.command, 12, 1200) + '\n```');
        }
      }
      // File ops: show path + relevant content
      else if (lname === 'read' || lname === 'view' || lname === 'glob' || lname === 'grep') {
        if (args.file_path && !summary.includes(args.file_path)) parts.push('Path: `' + args.file_path + '`');
        if (args.pattern) parts.push('Pattern: `' + args.pattern + '`');
        if (args.path && !args.file_path) parts.push('Path: `' + args.path + '`');
      }
      else if (lname === 'write') {
        if (args.file_path) parts.push('Wrote: `' + args.file_path + '`');
        if (args.content) {
          const fence = (args.file_path || '').split('.').pop();
          parts.push('```' + (fence || '') + '\n' + _trimMultiline(args.content, 30, 2400) + '\n```');
        }
      }
      else if (lname === 'edit' || lname === 'multiedit' || lname === 'edit_file_patch') {
        if (args.file_path) parts.push('Edited: `' + args.file_path + '`');
        if (args.old_string && args.new_string) {
          parts.push('```diff\n- ' + _trimMultiline(args.old_string, 12, 600).split('\n').join('\n- ')
                   + '\n+ ' + _trimMultiline(args.new_string, 12, 600).split('\n').join('\n+ ') + '\n```');
        } else if (args.searchReplaceBlock) {
          parts.push('```\n' + _trimMultiline(args.searchReplaceBlock, 24, 1600) + '\n```');
        }
      }
      else if (lname === 'websearch' || lname === 'web_search') {
        if (args.query) parts.push('Query: `' + args.query + '`');
      }
      else if (lname === 'webfetch' || lname === 'fetch_url') {
        if (args.url) parts.push('URL: ' + args.url);
      }
      else if (lname === 'todowrite') {
        if (Array.isArray(args.todos)) {
          for (const t of args.todos) {
            const mark = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
            parts.push(`- ${mark} ${t.content || t.description || ''}`);
          }
        }
      }
      // Generic fallback: dump the args as compact JSON (small ones only)
      else if (Object.keys(args).length && JSON.stringify(args).length < 400) {
        const lang = _detectFenceLang(name);
        parts.push('```' + (lang || 'json') + '\n' + JSON.stringify(args, null, 2) + '\n```');
      }
    }
    return parts.join('\n');
  }

  function _formatSubagent(card) {
    const name = card.dataset.toolName || card.querySelector('.subagent-desc')?.textContent?.trim() || 'subagent';
    const status = card.querySelector('.subagent-status-text')?.textContent?.trim() || '';
    const desc = card.querySelector('.subagent-desc')?.textContent?.trim() || '';
    const lines = [`**🤖 Sub-agent** \`${name}\``];
    if (desc && desc !== name) lines.push('Task: ' + desc);
    if (status) lines.push('Status: ' + status);
    return lines.join('\n');
  }

  function _formatReasoning(node) {
    // Support both legacy (.thinking-card / .thinking-seq-card) and the
    // new chain-of-thought UI (.cot with one or more .cot-step).
    if (node.classList.contains('cot')) {
      const steps = node.querySelectorAll('.cot-step');
      if (!steps.length) return '';
      const blocks = [];
      steps.forEach((step) => {
        const label = step.querySelector('.cot-step-label')?.textContent?.trim() || '';
        const desc = step.querySelector('.cot-step-description')?.innerText?.trim() || '';
        const text = [label, desc].filter(Boolean).join(' — ');
        if (text) blocks.push(text);
      });
      if (!blocks.length) return '';
      return '<details>\n<summary>🧠 Reasoning</summary>\n\n' + blocks.join('\n\n') + '\n\n</details>';
    }
    const text = (node.querySelector('.thinking-seq-body')?.innerText
              || node.innerText || '').trim();
    if (!text) return '';
    return '<details>\n<summary>🧠 Thinking</summary>\n\n' + text + '\n\n</details>';
  }

  function _formatFooter(footer) {
    const txt = footer.innerText.replace(/\s+/g, ' ').trim();
    return txt ? '*' + txt + '*' : '';
  }

  function _formatAssistantMessage(wrap) {
    const bodyWrap = wrap.querySelector('.msg-body-wrap') || wrap;
    const out = [];
    for (const node of bodyWrap.children) {
      if (!node || !(node instanceof HTMLElement)) continue;
      // Streaming indicator — skip (it's a UI artifact)
      if (node.classList.contains('msg-streaming-indicator')) continue;
      // Text body
      if (node.classList.contains('md-body')) {
        const text = (node.dataset?.text || node.innerText || '').trim();
        if (text) out.push(text);
        continue;
      }
      // Tool pills
      if (node.classList.contains('tool-pill')) {
        const m = _formatToolPill(node);
        if (m) out.push(m);
        continue;
      }
      // Sub-agent cards
      if (node.classList.contains('subagent-card')) {
        const m = _formatSubagent(node);
        if (m) out.push(m);
        continue;
      }
      // Reasoning (legacy + new CoT)
      if (node.classList.contains('thinking-card') || node.classList.contains('thinking-seq-card') || node.classList.contains('cot')) {
        const m = _formatReasoning(node);
        if (m) out.push(m);
        continue;
      }
      // Footer (cost / turns / duration)
      if (node.classList.contains('msg-footer')) {
        const m = _formatFooter(node);
        if (m) out.push(m);
        continue;
      }
      // Anything else — try to grab innerText so nothing is lost silently
      const fallback = (node.innerText || '').trim();
      if (fallback) out.push(fallback);
    }
    return out.join('\n\n');
  }

  function _formatUserMessage(wrap) {
    const bubble = wrap.querySelector('.msg-bubble');
    const text = (bubble?.dataset?.fullText || bubble?.textContent || '').trim();
    return text ? '> ' + text.split('\n').join('\n> ') : '';
  }

  function buildSessionTranscript({ heading = true } = {}) {
    if (!messagesEl) return '';
    const parts = [];
    if (heading) {
      const project = state.projectPath ? state.projectPath.split(/[\\/]/).pop() : 'session';
      parts.push(`# PiPilot Session — ${project}`);
      parts.push(`*Exported ${new Date().toLocaleString()}*`);
      if (state.projectPath) parts.push(`*Project path: \`${state.projectPath}\`*`);
      if (currentSessionId) parts.push(`*Session id: \`${currentSessionId}\`*`);
      parts.push('---');
    }
    let i = 0;
    for (const msg of messagesEl.children) {
      if (!msg.classList) continue;
      const isUser = msg.classList.contains('msg-user');
      const isAsst = msg.classList.contains('msg-assistant');
      if (!isUser && !isAsst) continue;
      i++;
      if (isUser) {
        parts.push(`## 🧑 You — turn ${i}`);
        parts.push(_formatUserMessage(msg));
      } else {
        parts.push(`## 🤖 Agent — turn ${i}`);
        parts.push(_formatAssistantMessage(msg));
      }
      parts.push('---');
    }
    // Drop trailing separator
    if (parts[parts.length - 1] === '---') parts.pop();
    return parts.join('\n\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
  }

  function buildChatExportJSON() {
    const allEls = messagesEl ? Array.from(messagesEl.children) : [];
    const exported = [];
    for (const el of allEls) {
      if (el.classList.contains('msg-user')) {
        const bubble = el.querySelector('.msg-bubble');
        const time = el.querySelector('.msg-time');
        exported.push({ role: 'user', content: bubble?.textContent || '', timestamp: time?.textContent || '' });
      } else if (el.classList.contains('msg-assistant')) {
        // Walk in DOM order so the export preserves the live interleaving
        // of text + tool calls + reasoning + sub-agent activity.
        const bodyWrap = el.querySelector('.msg-body-wrap') || el;
        const blocks = [];
        for (const node of bodyWrap.children) {
          if (!node || !(node instanceof HTMLElement)) continue;
          if (node.classList.contains('md-body')) {
            const text = (node.dataset?.text || node.innerText || '').trim();
            if (text) blocks.push({ type: 'text', text });
          } else if (node.classList.contains('tool-pill')) {
            const argsStr = node.querySelector('.tool-pill-pre')?.textContent?.trim() || '';
            let input = null;
            try { input = argsStr ? JSON.parse(argsStr) : null; } catch {}
            blocks.push({
              type: 'tool_call',
              name: node.dataset.toolName || '',
              id: node.dataset.toolId || '',
              status: node.classList.contains('error') ? 'error' : (node.classList.contains('running') ? 'running' : 'success'),
              summary: node.querySelector('.tool-pill-summary')?.textContent?.trim() || '',
              description: node.querySelector('.tool-pill-bash-desc')?.textContent?.trim() || '',
              input,
              result: node.querySelector('.tool-pill-result-wrap')?.innerText?.trim().slice(0, 4000) || '',
            });
          } else if (node.classList.contains('subagent-card')) {
            blocks.push({
              type: 'subagent',
              name: node.dataset.toolName || '',
              description: node.querySelector('.subagent-desc')?.textContent?.trim() || '',
              status: node.querySelector('.subagent-status-text')?.textContent?.trim() || '',
            });
          } else if (node.classList.contains('cot') || node.classList.contains('thinking-card') || node.classList.contains('thinking-seq-card')) {
            blocks.push({ type: 'reasoning', text: node.innerText?.trim() || '' });
          } else if (node.classList.contains('msg-footer')) {
            blocks.push({ type: 'footer', text: node.innerText?.replace(/\s+/g, ' ').trim() });
          }
        }
        const time = el.querySelector('.msg-time');
        exported.push({ role: 'assistant', blocks, timestamp: time?.textContent || '' });
      }
    }
    return {
      session: currentSessionId,
      project: state.projectPath,
      exportedAt: new Date().toISOString(),
      schemaVersion: 2,
      messages: exported,
    };
  }

  function showChatCtxMenu(x, y) {
    closeChatCtxMenu();
    const hasMessages = messagesEl && messagesEl.children.length > 0;
    const hasSelection = window.getSelection()?.toString().trim();

    const items = [
      { label: 'New Chat', icon: '⊕', action: () => newSession() },
      { type: 'sep' },
      ...(hasSelection ? [{ label: 'Copy Selection', icon: '⎘', action: () => { try { navigator.clipboard.writeText(window.getSelection().toString()); } catch {} } }] : []),
      { label: 'Copy All Messages', icon: '⎘', disabled: !hasMessages, action: () => {
        const allText = buildSessionTranscript({ heading: false });
        try { navigator.clipboard.writeText(allText); bus.emit('toast:show', { message: 'Copied transcript (' + allText.length + ' chars)', type: 'ok' }); } catch {}
      }},
      { type: 'sep' },
      { label: 'Export Chat as JSON', icon: '↓', disabled: !hasMessages, action: () => {
        const data = buildChatExportJSON();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pipilot-chat-${currentSessionId || 'export'}.json`;
        a.click();
        URL.revokeObjectURL(url);
        bus.emit('toast:show', { message: 'Chat exported', type: 'ok' });
      }},
      { label: 'Export Chat as Markdown', icon: '↓', disabled: !hasMessages, action: () => {
        const text = buildSessionTranscript({ heading: true });
        const blob = new Blob([text], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pipilot-chat-${currentSessionId || 'export'}.md`;
        a.click();
        URL.revokeObjectURL(url);
        bus.emit('toast:show', { message: 'Chat exported as Markdown', type: 'ok' });
      }},
      { type: 'sep' },
      { label: 'Clear Chat', icon: '⌫', disabled: !hasMessages, danger: true, action: () => {
        if (!messagesEl) return;
        messagesEl.innerHTML = '';
        currentAssistantEl = null;
        if (chatDB && currentSessionId) chatDB.clearMessages(currentSessionId);
        showWelcomeState();
        updateMsgCounter();
        bus.emit('toast:show', { message: 'Chat cleared', type: 'ok' });
      }},
      { label: 'Scroll to Bottom', icon: '↓', disabled: !hasMessages, action: () => scrollToBottom(true) },
      { type: 'sep' },
      { label: 'Focus Input', icon: '⌨', action: () => inputEl?.focus() },
    ];

    const menu = document.createElement('div');
    menu.className = 'chat-ctx-menu';
    items.forEach(item => {
      if (item.type === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'chat-ctx-sep';
        menu.appendChild(sep);
        return;
      }
      const row = document.createElement('button');
      row.className = 'chat-ctx-item' + (item.danger ? ' danger' : '');
      row.disabled = !!item.disabled;
      row.innerHTML = `<span class="chat-ctx-icon">${item.icon || ''}</span><span>${escapeHtml(item.label)}</span>`;
      row.addEventListener('click', () => { closeChatCtxMenu(); item.action(); });
      menu.appendChild(row);
    });

    // Position
    const panelRect = chatPanel?.getBoundingClientRect() || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    let left = x - panelRect.left;
    let top = y - panelRect.top;
    menu.style.position = 'absolute';
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.zIndex = '20000';
    chatPanel.appendChild(menu);

    // Clamp to panel bounds after render
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > panelRect.right - 4) menu.style.left = Math.max(0, left - (mr.right - panelRect.right + 8)) + 'px';
      if (mr.bottom > panelRect.bottom - 4) menu.style.top = Math.max(0, top - (mr.bottom - panelRect.bottom + 8)) + 'px';
    });

    chatCtxMenu = menu;
  }

  // Register on chat panel
  chatPanel?.addEventListener('contextmenu', (e) => {
    // Don't override context menu on inputs/textareas — they need
    // the native cut/copy/paste menu.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Defer to the diagram-export menu when right-clicking on rendered
    // mermaid SVGs (or any other inline SVG). Belt-and-suspenders next
    // to the SVG handler's own e.stopPropagation() — covers the brief
    // race where the SVG's listener hasn't attached yet because mermaid
    // is still rendering asynchronously.
    if (e.target.closest('svg')) return;
    e.preventDefault();
    showChatCtxMenu(e.clientX, e.clientY);
  });

  document.addEventListener('click', (e) => {
    if (chatCtxMenu && !chatCtxMenu.contains(e.target)) closeChatCtxMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChatCtxMenu();
  });

  // ---------- Init ----------
  loadMarked().then(() => injectStyles());
  injectStyles();
  showWelcomeState(); // Feature #16
  ensureAuthBanner();
  // Re-evaluate the banner whenever auth state changes (sign-in, sign-out).
  window.addEventListener('pipilot:auth-changed', () => ensureAuthBanner());

  // Auth banner — appears at the top of the chat panel when the user is
  // not signed in. Replaces the input area's "send" affordance with a
  // "Sign in with GitHub" CTA. The editor + everything else stays usable;
  // only AI-driven features wait for auth.
  async function ensureAuthBanner() {
    const status = await window.electronAPI?.auth?.getStatus?.();
    const authed = !!status?.authenticated;
    const panel = document.getElementById('chat-panel') || document.querySelector('.chat-panel');
    if (!panel) return;

    let banner = panel.querySelector('.chat-auth-banner');
    if (authed) {
      if (banner) banner.remove();
      if (inputEl) inputEl.disabled = false;
      return;
    }
    if (banner) return;   // already shown

    banner = document.createElement('div');
    banner.className = 'chat-auth-banner';
    banner.innerHTML = `
      <div class="chat-auth-banner-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-2.13c-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
      </div>
      <div class="chat-auth-banner-text">
        <strong>Sign in to use the AI agent</strong>
        <span>Editing works without an account — chat, inline AI, and agents need a free GitHub login.</span>
      </div>
      <button class="chat-auth-banner-btn" data-action="signin">Sign in</button>
    `;
    banner.querySelector('[data-action="signin"]').addEventListener('click', () => {
      window.PiPilot?.auth?.show?.();
    });
    panel.insertBefore(banner, panel.firstChild);
    if (inputEl) inputEl.disabled = true;
  }

  window.PiPilot.chat = {
    focus() { inputEl?.focus(); },
    sendMessage(text) { if (inputEl) { inputEl.value = text || ''; sendMessage(); } },
    newSession,
    stop() { if (activeStream && activeStream.stop) activeStream.stop(); },
    getCurrentSession() { return currentSessionId; },
    loadSession,
    setEffort,
    getEffort: () => state.reasoningEffort,
    effortLevels: () => EFFORT_LEVELS.map(l => ({ id: l.id, label: l.label })),
  };
})();
