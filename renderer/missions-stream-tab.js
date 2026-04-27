// PiPilot IDE — Mission Stream Tab
//
// Opens a virtual editor tab that shows a live, chat-like view of a
// running mission's agent stream: text deltas, tool pills, results.
// Subscribes to bus 'mission:event' and replays whatever's already in
// the runner's buffer so it works whether opened mid-run or after.
// Footer holds two utility buttons (no input area, since missions are
// self-driving) — Stop, Open log file.

(function () {
  'use strict';
  if (window.__pipilotMissionsStreamTabLoaded) return;
  window.__pipilotMissionsStreamTabLoaded = true;

  const bus = window.PiPilot && window.PiPilot.bus;
  const api = (window.PiPilot && window.PiPilot.api) || window.electronAPI;
  if (!bus || !api) return;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shortPath(p) {
    if (!p) return '';
    const parts = String(p).replace(/\\/g, '/').split('/');
    return parts.slice(-2).join('/');
  }

  function previewFor(name, input) {
    if (!input || typeof input !== 'object') return '';
    const p = input.file_path || input.filepath || input.path || input.target_file;
    if (p) return shortPath(p);
    if (input.command) return '$ ' + String(input.command).slice(0, 60);
    if (input.pattern) return input.pattern;
    if (input.url) return input.url;
    if (input.query) return '"' + input.query + '"';
    if (input.description) return String(input.description).slice(0, 60);
    return '';
  }

  // Small status SVGs.
  const SVG = {
    spin: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>',
    ok: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    err: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>',
  };

  // Inject styles once.
  if (!document.getElementById('pp-mst-styles')) {
    const s = document.createElement('style');
    s.id = 'pp-mst-styles';
    s.textContent = `
.pp-mst { display:flex; flex-direction:column; height:100%; background:var(--bg, #16161a); color:var(--text); font-family:var(--font-sans); }
.pp-mst-head { padding:12px 16px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:6px; flex-shrink:0; }
.pp-mst-row1 { display:flex; align-items:center; gap:10px; }
.pp-mst-status { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--text-mid); font-family:var(--font-mono); padding:3px 9px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); }
.pp-mst-status.running { color:var(--info,#6cb6ff); border-color:rgba(108,182,255,0.3); background:rgba(108,182,255,0.08); }
.pp-mst-status.success { color:var(--ok,#62c167); border-color:rgba(98,193,103,0.3); background:rgba(98,193,103,0.08); }
.pp-mst-status.error, .pp-mst-status.timeout { color:var(--error,#e5534b); border-color:rgba(229,83,75,0.3); background:rgba(229,83,75,0.08); }
.pp-mst-status svg { width:11px; height:11px; }
.pp-mst-status.running svg { animation:pp-mst-spin 1s linear infinite; }
@keyframes pp-mst-spin { to { transform:rotate(360deg); } }
.pp-mst-name { flex:1; font-size:14px; font-weight:600; color:var(--text-strong); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pp-mst-meta { font-size:11px; color:var(--text-dim); font-family:var(--font-mono); display:flex; gap:10px; flex-wrap:wrap; }

.pp-mst-body { flex:1; overflow-y:auto; padding:14px 18px; display:flex; flex-direction:column; gap:10px; }
.pp-mst-empty { color:var(--text-dim); font-size:12px; text-align:center; padding:30px 12px; }
.pp-mst-text { font-size:13px; line-height:1.65; color:var(--text); word-wrap:break-word; user-select:text; -webkit-user-select:text; }
.pp-mst-text[data-streaming="1"] { white-space:pre-wrap; }
.pp-mst-text p { margin:0 0 8px; }
.pp-mst-text p:last-child { margin-bottom:0; }
.pp-mst-text strong { color:var(--text-strong); font-weight:600; }
.pp-mst-text em { color:var(--text-strong); font-style:italic; }
.pp-mst-text a { color:var(--info); text-decoration:none; border-bottom:1px dotted rgba(108,182,255,0.4); }
.pp-mst-text a:hover { color:#8ec6ff; border-bottom-color:#8ec6ff; }
.pp-mst-text code { background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:3px; font-family:var(--font-mono); font-size:12px; color:var(--accent-light,#ffb38a); }
.pp-mst-text pre { position:relative; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); padding:10px 12px; border-radius:5px; margin:8px 0; overflow-x:auto; font-family:var(--font-mono); font-size:11.5px; line-height:1.55; }
.pp-mst-text pre code { background:none; padding:0; color:var(--text-strong); font-size:inherit; }
.pp-mst-text h1, .pp-mst-text h2, .pp-mst-text h3, .pp-mst-text h4 { color:var(--text-strong); font-weight:600; margin:10px 0 6px; line-height:1.35; }
.pp-mst-text h1 { font-size:17px; }
.pp-mst-text h2 { font-size:15px; }
.pp-mst-text h3, .pp-mst-text h4 { font-size:13.5px; }
.pp-mst-text ul, .pp-mst-text ol { margin:4px 0 8px; padding-left:22px; }
.pp-mst-text li { margin:2px 0; }
.pp-mst-text blockquote { border-left:2px solid var(--accent); padding:2px 0 2px 10px; margin:6px 0; color:var(--text-mid); }
.pp-mst-text table { border-collapse:collapse; margin:8px 0; font-size:12px; }
.pp-mst-text th, .pp-mst-text td { border:1px solid var(--border); padding:5px 8px; }
.pp-mst-text th { background:rgba(255,255,255,0.04); font-weight:600; color:var(--text-strong); }
.pp-mst-copy { position:absolute; top:6px; right:6px; background:rgba(20,20,26,0.9); border:1px solid rgba(255,255,255,0.1); color:var(--text-dim); cursor:pointer; padding:3px 8px; border-radius:4px; font-size:10.5px; font-family:var(--font-sans); transition:all 0.15s; opacity:0; }
.pp-mst-text pre:hover .pp-mst-copy { opacity:1; }
.pp-mst-copy:hover { color:var(--accent-light,#ffb38a); border-color:rgba(255,107,53,0.3); background:rgba(255,107,53,0.1); }
.pp-mst-copy.copied { color:var(--ok,#62c167); border-color:rgba(98,193,103,0.3); background:rgba(98,193,103,0.1); }
.pp-mst, .pp-mst-pill, .pp-mst-meta, .pp-mst-name, .pp-mst-pill-name, .pp-mst-pill-preview { user-select:text; -webkit-user-select:text; }

.pp-mst-pill { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border-radius:6px; background:rgba(0,0,0,0.25); border:1px solid var(--border); font-size:11.5px; align-self:flex-start; max-width:100%; }
.pp-mst-pill.running { border-color:rgba(255,107,53,0.3); background:rgba(255,107,53,0.06); }
.pp-mst-pill.success { border-color:rgba(98,193,103,0.25); }
.pp-mst-pill.error { border-color:rgba(229,83,75,0.35); background:rgba(229,83,75,0.06); }
.pp-mst-pill-icon { width:14px; height:14px; display:flex; align-items:center; justify-content:center; color:var(--text-mid); flex-shrink:0; }
.pp-mst-pill.running .pp-mst-pill-icon { color:var(--info,#6cb6ff); }
.pp-mst-pill.running .pp-mst-pill-icon svg { animation:pp-mst-spin 1s linear infinite; }
.pp-mst-pill.success .pp-mst-pill-icon { color:var(--ok,#62c167); }
.pp-mst-pill.error .pp-mst-pill-icon { color:var(--error,#e5534b); }
.pp-mst-pill-name { font-weight:500; color:var(--text-strong); font-family:var(--font-mono); font-size:11px; }
.pp-mst-pill-sep { color:var(--text-dim); }
.pp-mst-pill-preview { color:var(--text-mid); font-family:var(--font-mono); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:480px; }
.pp-mst-pill-clickable { cursor:pointer; }
.pp-mst-pill-clickable:hover { border-color:rgba(255,107,53,0.45); background:rgba(255,107,53,0.07); }
.pp-mst-pill-clickable:hover .pp-mst-pill-name { color:var(--accent-light,#ffb38a); }
.pp-mst-pill-open { color:var(--text-dim); font-size:13px; margin-left:auto; padding-left:6px; opacity:0.6; transition:all 0.15s; }
.pp-mst-pill-clickable:hover .pp-mst-pill-open { color:var(--accent-light,#ffb38a); opacity:1; transform:translateY(-1px); }

.pp-mst-event-time { font-size:10px; color:var(--text-dim); font-family:var(--font-mono); margin-right:6px; opacity:0.6; }

/* Streaming indicator — same look as the chat panel's working dots
   + shimmer text. Lives at the bottom of pp-mst-body while the
   agent is running, hidden when status is terminal. */
.pp-mst-stream { display:none; align-items:center; gap:3px; padding:8px 2px 2px; }
.pp-mst.is-running .pp-mst-stream { display:flex; }
.pp-mst-stream .pp-mst-dot { width:6px; height:6px; border-radius:50%; background:var(--info,#6cb6ff); animation:pp-mst-pulse 1.4s ease-in-out infinite; display:inline-block; flex-shrink:0; }
.pp-mst-stream .pp-mst-dot:nth-child(2) { animation-delay:0.2s; }
.pp-mst-stream .pp-mst-dot:nth-child(3) { animation-delay:0.4s; }
@keyframes pp-mst-pulse {
  0%, 80%, 100% { opacity:0.3; transform:scale(0.8); }
  40% { opacity:1; transform:scale(1.2); }
}
.pp-mst-stream-text {
  font-size:11px; font-weight:500; margin-left:6px; letter-spacing:0.05em;
  background: linear-gradient(90deg, var(--text,#b0b0b8) 0%, var(--text,#b0b0b8) 30%, var(--accent,#FF6B35) 50%, var(--text,#b0b0b8) 70%, var(--text,#b0b0b8) 100%);
  background-size:200% 100%;
  -webkit-background-clip:text; background-clip:text;
  -webkit-text-fill-color:transparent; color:transparent;
  animation:pp-mst-shimmer 2s linear infinite;
}
@keyframes pp-mst-shimmer { from { background-position:200% 0; } to { background-position:-200% 0; } }

.pp-mst-foot { padding:8px 14px; border-top:1px solid var(--border); display:flex; align-items:center; gap:6px; flex-shrink:0; background:var(--surface,#1c1c21); flex-wrap:wrap; }
.pp-mst-foot-spacer { flex:1; }
.pp-mst-input-row { display:flex; align-items:flex-end; gap:8px; padding:10px 14px 12px; border-top:1px solid var(--border); background:var(--surface,#1c1c21); flex-shrink:0; }
.pp-mst-input { flex:1; resize:none; background:rgba(0,0,0,0.25); border:1px solid var(--border); border-radius:8px; padding:9px 12px; color:var(--text-strong); font-family:var(--font-sans); font-size:13px; line-height:1.5; outline:none; transition:border-color 0.15s; min-height:38px; max-height:160px; }
.pp-mst-input:focus { border-color:var(--accent); }
.pp-mst-input::placeholder { color:var(--text-dim); }
.pp-mst-send { align-self:flex-end; }
.pp-mst-queue { padding:6px 14px 8px; border-top:1px dashed rgba(108,182,255,0.3); background:rgba(108,182,255,0.05); font-size:11px; color:var(--info,#6cb6ff); font-family:var(--font-mono); display:flex; align-items:center; gap:6px; }
.pp-mst-queue strong { color:var(--info,#6cb6ff); font-weight:600; }
.pp-mst-msg { padding:8px 12px; margin:6px 0; border-radius:8px; font-size:13px; line-height:1.55; max-width:78%; align-self:flex-end; background:rgba(255,107,53,0.12); border:1px solid rgba(255,107,53,0.28); color:var(--text-strong); }
.pp-mst-msg.user { align-self:flex-end; }
.pp-mst-msg-head { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:var(--accent-light,#ffb38a); font-family:var(--font-mono); margin-bottom:3px; opacity:0.7; }
.pp-mst-btn { background:transparent; border:1px solid var(--border); color:var(--text-mid); padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer; transition:all 0.15s; font-family:var(--font-sans); display:flex; align-items:center; gap:6px; }
.pp-mst-btn:hover { background:rgba(255,255,255,0.05); color:var(--text-strong); border-color:rgba(255,255,255,0.18); }
.pp-mst-btn.danger:hover { background:rgba(229,83,75,0.12); color:var(--error); border-color:rgba(229,83,75,0.4); }
.pp-mst-btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.pp-mst-btn.primary:hover { background:var(--accent-hover); }
.pp-mst-btn:disabled { opacity:0.4; cursor:not-allowed; }
`;
    document.head.appendChild(s);
  }

  // Track open tabs by mission id so re-clicks just focus the existing one.
  const openTabs = new Map();   // missionId -> { tabId, container, listEl, dispose }

  function tabIdFor(missionId) {
    return 'pipilot://mission/' + missionId;
  }

  function openMissionTab(mission) {
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) {
      bus.emit('toast:show', { type: 'warn', message: 'Editor not ready' });
      return;
    }
    const tabId = tabIdFor(mission.id);

    // openTabs may be stale: the user can close the editor tab without
    // our subscriptions being disposed (closeFile only fires unmount,
    // not a delete on our Map). Reconcile against the editor's source
    // of truth before short-circuiting.
    const liveInEditor = editor.isVirtualTab && editor.isVirtualTab(tabId);
    if (openTabs.has(mission.id) && !liveInEditor) {
      // Stale entry — clean it up so the next openVirtualTab actually
      // mounts a fresh view.
      try { openTabs.get(mission.id).dispose?.(); } catch {}
      openTabs.delete(mission.id);
    }
    if (openTabs.has(mission.id) && liveInEditor) {
      // Genuinely already open — pass a no-op mount so editor just
      // switches focus to it.
      editor.openVirtualTab({ id: tabId, name: 'Mission · ' + mission.name, mount: () => {} });
      return;
    }

    editor.openVirtualTab({
      id: tabId,
      name: 'Mission · ' + mission.name,
      icon: '⚡',
      // Return value becomes the editor's unmount handler — fires
      // whenever the user closes this tab. We use it to release
      // event subscriptions and drop the openTabs entry so the next
      // open mounts a fresh view.
      mount: (container) => {
        try {
          return mountStreamView(container, mission);
        } catch (err) {
          console.error('[missions-stream-tab] mount failed:', err);
          container.innerHTML = `<div style="padding:24px;color:var(--error,#e5534b);font-family:var(--font-mono);font-size:12px;">Failed to mount mission view:<br/>${escapeHtml(err?.stack || err?.message || String(err))}</div>`;
          return () => {};
        }
      },
    });
  }

  function mountStreamView(container, mission) {
    container.style.cssText = 'width:100%;height:100%;background:var(--bg,#16161a);overflow:hidden;display:flex;flex-direction:column;';
    const root = document.createElement('div');
    root.className = 'pp-mst';
    root.innerHTML = `
      <div class="pp-mst-head">
        <div class="pp-mst-row1">
          <div class="pp-mst-status running" data-role="status">${SVG.spin} <span data-role="status-label">running</span></div>
          <div class="pp-mst-name">${escapeHtml(mission.name)}</div>
        </div>
        <div class="pp-mst-meta">
          <span data-role="target"></span>
          <span data-role="duration"></span>
          <span data-role="tool-count"></span>
        </div>
      </div>
      <div class="pp-mst-body" data-role="body">
        <div class="pp-mst-empty" data-role="empty">Waiting for the agent to begin…</div>
      </div>
      <div class="pp-mst-stream" data-role="stream">
        <span class="pp-mst-dot"></span><span class="pp-mst-dot"></span><span class="pp-mst-dot"></span>
        <span class="pp-mst-stream-text" data-role="stream-text">Working...</span>
      </div>
      <div class="pp-mst-foot">
        <button class="pp-mst-btn danger" data-act="stop">⏹ Stop</button>
        <button class="pp-mst-btn" data-act="log">📄 Log</button>
        <button class="pp-mst-btn" data-act="edit">⚙ Edit</button>
        <button class="pp-mst-btn" data-act="rerun">↻ Run again</button>
      </div>
      <div class="pp-mst-input-row">
        <textarea
          class="pp-mst-input"
          data-role="input"
          rows="1"
          placeholder="Reply to this mission…"></textarea>
        <button class="pp-mst-btn primary pp-mst-send" data-act="send">Send</button>
      </div>
      <div class="pp-mst-queue" data-role="queue" hidden></div>
    `;
    container.appendChild(root);

    const body = root.querySelector('[data-role="body"]');
    const empty = root.querySelector('[data-role="empty"]');
    const statusEl = root.querySelector('[data-role="status"]');
    const statusLabel = root.querySelector('[data-role="status-label"]');
    const targetEl = root.querySelector('[data-role="target"]');
    const durEl = root.querySelector('[data-role="duration"]');
    const toolCountEl = root.querySelector('[data-role="tool-count"]');
    const stopBtn = root.querySelector('[data-act="stop"]');
    const rerunBtn = root.querySelector('[data-act="rerun"]');

    targetEl.textContent = mission.target?.kind === 'cloud'
      ? '☁ ' + (mission.target.repo || '') + (mission.target.branch ? '@' + mission.target.branch : '')
      : '📁 ' + shortPath(mission.target?.projectPath || '');

    let toolCount = 0;
    let activeTextEl = null;     // current streaming text block we're appending into
    let toolElById = new Map();  // tool_use_id -> pill el
    let durationTimer = null;
    const startedAt = Date.now();

    function tickDuration() {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      durEl.textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    }
    durationTimer = setInterval(tickDuration, 1000);
    tickDuration();

    const streamTextEl = root.querySelector('[data-role="stream-text"]');
    function setStatus(state, label) {
      statusEl.classList.remove('running', 'success', 'error', 'timeout', 'stopped', 'skipped', 'preparing');
      const visualClass = state === 'success' ? 'success'
        : state === 'running' || state === 'preparing' ? 'running'
        : state === 'timeout' ? 'timeout'
        : 'error';
      statusEl.classList.add(visualClass);
      const icon = (state === 'running' || state === 'preparing') ? SVG.spin
        : state === 'success' ? SVG.ok : SVG.err;
      statusEl.innerHTML = `${icon} <span data-role="status-label">${escapeHtml(label || state)}</span>`;
      stopBtn.disabled = state !== 'running' && state !== 'preparing';
      rerunBtn.disabled = state === 'running' || state === 'preparing';
      // Toggle the chat-panel-style streaming indicator at the
      // bottom of the body while a turn is in flight.
      const isLive = state === 'running' || state === 'preparing';
      root.classList.toggle('is-running', isLive);
      if (streamTextEl) {
        streamTextEl.textContent = state === 'preparing' ? 'Preparing workspace...' : 'Working...';
      }
    }

    function renderMd(s) {
      if (!s) return '';
      try { return window.marked?.parse ? window.marked.parse(s, { breaks: true, gfm: true }) : escapeHtml(s); }
      catch { return escapeHtml(s); }
    }
    function attachCopyButtons(el) {
      el.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.pp-mst-copy')) return;
        const btn = document.createElement('button');
        btn.className = 'pp-mst-copy';
        btn.type = 'button';
        btn.textContent = 'Copy';
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
          try { await navigator.clipboard.writeText(code); btn.textContent = 'Copied'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1200); }
          catch { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); }
        });
        pre.appendChild(btn);
      });
    }
    // Live markdown rendering — same approach the chat panel uses.
    // Every text_delta accumulates into dataset.text and re-renders
    // the WHOLE block as markdown. Cheap enough for streaming because
    // the block typically stays under a few KB; render is rAF-throttled
    // so we never reflow more than once per frame.
    let _renderRaf = null;
    function flushMd(el) {
      _renderRaf = null;
      if (!el || !el.isConnected) return;
      el.innerHTML = renderMd(el.dataset.text || '');
      attachCopyButtons(el);
    }
    function scheduleMd(el) {
      if (_renderRaf) return;
      _renderRaf = requestAnimationFrame(() => flushMd(el));
    }
    function appendStreamingText(text, kind) {
      if (!text) return;
      if (empty) empty.style.display = 'none';
      if (!activeTextEl) {
        activeTextEl = document.createElement('div');
        activeTextEl.className = 'pp-mst-text';
        activeTextEl.dataset.streaming = '1';
        activeTextEl.dataset.text = '';
        body.appendChild(activeTextEl);
      }
      if (kind === 'delta') {
        activeTextEl.dataset.text = (activeTextEl.dataset.text || '') + text;
        scheduleMd(activeTextEl);
      } else {
        // Final block — replace with canonical body and render once
        // immediately (no rAF defer, so the next event lands on a
        // settled DOM).
        activeTextEl.dataset.text = text;
        flushMd(activeTextEl);
        delete activeTextEl.dataset.streaming;
      }
      scrollToBottom();
    }

    function appendToolCall(call) {
      if (empty) empty.style.display = 'none';
      activeTextEl = null;
      const pill = document.createElement('div');
      pill.className = 'pp-mst-pill running';
      pill.dataset.toolId = call.id || ('t-' + Math.random().toString(36).slice(2));
      // File-mutating tools get a clickable pill — opens the file in
      // a structured viewer (BugBot findings, etc.) or in the editor.
      const path = call.input?.file_path || call.input?.filepath || call.input?.path || call.input?.target_file;
      const fileTools = new Set(['Write','Edit','MultiEdit','create_file','edit_file','write_file','edit_file_patch']);
      const baseToolName = (call.name || '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
      const isFileTool = fileTools.has(call.name) || fileTools.has(baseToolName);
      if (path && isFileTool) {
        pill.classList.add('pp-mst-pill-clickable');
        pill.dataset.filePath = path;
        pill.title = 'Open ' + path;
      }
      pill.innerHTML = `
        <span class="pp-mst-pill-icon">${SVG.spin}</span>
        <span class="pp-mst-pill-name">${escapeHtml(call.name || 'tool')}</span>
        ${call.input ? `<span class="pp-mst-pill-sep">·</span><span class="pp-mst-pill-preview">${escapeHtml(previewFor(call.name, call.input))}</span>` : ''}
        ${path && isFileTool ? `<span class="pp-mst-pill-open" aria-hidden="true">↗</span>` : ''}
      `;
      if (path && isFileTool) {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          openWrittenFile(path, mission);
        });
      }
      body.appendChild(pill);
      toolElById.set(pill.dataset.toolId, pill);
      toolCount++;
      toolCountEl.textContent = toolCount + ' tool call' + (toolCount === 1 ? '' : 's');
      scrollToBottom();
    }

    function markToolResult(toolUseId, isError) {
      const pill = toolElById.get(toolUseId);
      if (!pill) return;
      pill.classList.remove('running');
      pill.classList.add(isError ? 'error' : 'success');
      const iconSpan = pill.querySelector('.pp-mst-pill-icon');
      if (iconSpan) iconSpan.innerHTML = isError ? SVG.err : SVG.ok;
    }

    function appendError(message) {
      const div = document.createElement('div');
      div.className = 'pp-mst-pill error';
      div.innerHTML = `<span class="pp-mst-pill-icon">${SVG.err}</span><span class="pp-mst-pill-preview">${escapeHtml(message || 'Error')}</span>`;
      body.appendChild(div);
      scrollToBottom();
    }

    function scrollToBottom() {
      // Throttle via rAF to avoid layout thrash on rapid deltas.
      if (scrollToBottom._raf) return;
      scrollToBottom._raf = requestAnimationFrame(() => {
        scrollToBottom._raf = null;
        body.scrollTop = body.scrollHeight;
      });
    }

    function applyEvent(evt) {
      if (!evt) return;
      switch (evt.type) {
        case 'text_delta':  appendStreamingText(evt.text || '', 'delta'); break;
        case 'text':        appendStreamingText(evt.text || '', 'final'); break;
        case 'tool_call':
          // Close any in-flight text element so subsequent text starts
          // a fresh block instead of mashing into the prior one.
          activeTextEl = null;
          appendToolCall(evt);
          break;
        case 'tool_result': markToolResult(evt.toolUseId, evt.isError); break;
        case 'error':       activeTextEl = null; appendError(evt.message); break;
        case 'thinking':    /* skip — streamed reasoning isn't surfaced */ break;
        case 'block_stop':
          // Force the current text block to close so the next event
          // starts cleanly. Harmless for tool blocks.
          activeTextEl = null;
          break;
      }
    }

    // Initial-state resolution. Synchronous first pass uses whatever
    // the runner has cached locally; an async second pass reaches out
    // to main for the authoritative buffer (covers post-reload replay)
    // and reapplies any newer events. Mount stays synchronous so its
    // return-value-as-unmount contract with the editor is preserved.
    const localBuf = window.PiPilot?.missions?.runner?.getBuffer?.(mission.id);
    const isRunningNow = !!window.PiPilot?.missions?.runner?.isRunning?.(mission.id);
    let appliedFromBuf = false;
    if (localBuf && (localBuf.events?.length || localBuf.status)) {
      for (const evt of localBuf.events) applyEvent(evt);
      appliedFromBuf = true;
      if (localBuf.status && localBuf.status !== 'running') {
        setStatus(localBuf.status, localBuf.status);
        clearInterval(durationTimer);
      } else if (localBuf.startedAt) {
        const realStart = localBuf.startedAt;
        tickDuration = () => {
          const s = Math.floor((Date.now() - realStart) / 1000);
          durEl.textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        };
        tickDuration();
      }
    }
    // Async tail: ask main for authoritative state. Three layers, in
    // priority order:
    //   1. main's live in-flight buffer (running OR just-finished
    //      within the 10-min retention window)
    //   2. disk: load the latest persisted run file from
    //      <userData>/missions-runs/<id>/<startedAt>.jsonl
    //   3. mission.lastRunStatus on the saved record (handled in the
    //      sync fallthrough below)
    let asyncFilled = false;
    const replay = (events, status, startedAt) => {
      // Wipe any placeholder we put in earlier.
      body.innerHTML = '<div class="pp-mst-empty" data-role="empty" style="display:none;"></div>';
      for (const evt of events || []) applyEvent(evt);
      if (status && status !== 'running') {
        setStatus(status, status);
        clearInterval(durationTimer);
      } else if (startedAt) {
        const realStart = startedAt;
        tickDuration = () => {
          const s = Math.floor((Date.now() - realStart) / 1000);
          durEl.textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        };
        tickDuration();
        setStatus('running', 'running');
      }
    };
    (async () => {
      try {
        const st = await api.missions.getState(mission.id);
        if (st?.ok && !appliedFromBuf && (st.events?.length || st.running)) {
          asyncFilled = true;
          replay(st.events, st.running ? 'running' : st.status, st.startedAt);
          return;
        }
        if (!appliedFromBuf && !asyncFilled) {
          // Fall back to disk — load most recent run.
          const r = await api.missions.loadRun(mission.id);
          if (r?.ok && (r.events?.length || r.end)) {
            asyncFilled = true;
            const status = r.end?.status || (r.meta ? 'success' : null);
            const startedAt = r.meta?.startedAt;
            // If duration was recorded in the end record, freeze it
            // on the duration label.
            if (r.end?.durationMs && durEl) durEl.textContent = (r.end.durationMs / 1000).toFixed(1) + 's';
            replay(r.events, status, startedAt);
          }
        }
      } catch (err) {
        console.warn('[missions-stream] state fetch failed', err);
      }
    })();
    if (!appliedFromBuf && !isRunningNow) {
      const last = mission.lastRunStatus;
      if (last) {
        setStatus(last, last);
        clearInterval(durationTimer);
        durEl.textContent = '';
        if (mission.lastRunMessage) {
          const msg = document.createElement('div');
          msg.className = 'pp-mst-pill ' + (last === 'success' ? 'success' : 'error');
          msg.innerHTML = `<span class="pp-mst-pill-icon">${last === 'success' ? SVG.ok : SVG.err}</span><span class="pp-mst-pill-preview">${escapeHtml(mission.lastRunMessage)}</span>`;
          body.appendChild(msg);
          if (empty) empty.style.display = 'none';
        }
      } else {
        // Never run.
        setStatus('idle', 'never');
        clearInterval(durationTimer);
        durEl.textContent = '';
        if (empty) empty.textContent = 'This mission hasn\'t run yet. Click Run again to fire it.';
      }
    }

    // Subscribe to live events.
    const offEvent = bus.on('mission:event', (payload) => {
      if (payload?.missionId !== mission.id) return;
      applyEvent(payload.evt);
    });
    const offEnd = bus.on('mission:end', (payload) => {
      if (payload?.missionId !== mission.id) return;
      setStatus(payload.status, payload.status);
      clearInterval(durationTimer);
      if (payload.durationMs) durEl.textContent = (payload.durationMs / 1000).toFixed(1) + 's';
    });
    // Catch terminal events that come from MAIN (e.g. clone failures
    // that abort the mission before the renderer ever sees a stream).
    // missions:status fires with { state: 'idle', status: 'error', summary }
    // from fireMission's early-return path.
    const offQueued = api.missions.onQueued?.((payload) => {
      if (payload?.missionId !== mission.id) return;
      updateQueue(payload.queueLength || 0);
    }) || (() => {});
    const offTurnEnd = api.missions.onTurnEnd?.((payload) => {
      if (payload?.missionId !== mission.id) return;
      // Between turns: reset the in-flight text element + clear queue
      // visually (it'll be repopulated by the next missions:queued
      // payload if more remain).
      activeTextEl = null;
      updateQueue(0);
    }) || (() => {});

    const offStatus = api.missions.onStatus((payload) => {
      if (payload?.id !== mission.id) return;
      if (payload.state === 'preparing') {
        setStatus('preparing', 'preparing');
        return;
      }
      if (payload.state === 'running') {
        setStatus('running', 'running');
        return;
      }
      if (payload.state === 'idle' && payload.status) {
        setStatus(payload.status, payload.status);
        clearInterval(durationTimer);
        if (payload.summary && body && empty?.style.display !== 'none') {
          const msg = document.createElement('div');
          msg.className = 'pp-mst-pill ' + (payload.status === 'success' ? 'success' : 'error');
          msg.innerHTML = `<span class="pp-mst-pill-icon">${payload.status === 'success' ? SVG.ok : SVG.err}</span><span class="pp-mst-pill-preview">${escapeHtml(payload.summary)}</span>`;
          body.appendChild(msg);
          if (empty) empty.style.display = 'none';
        }
      }
    });

    // Footer actions
    stopBtn.addEventListener('click', () => {
      window.PiPilot?.missions?.runner?.stopMission?.(mission.id);
    });
    root.querySelector('[data-act="rerun"]').addEventListener('click', async () => {
      const r = await api.missions.run(mission.id, window.PiPilot?.state?.projectPath || null, true);
      if (!r?.ok) bus.emit('toast:show', { type: 'warn', message: 'Could not start: ' + (r?.error || 'unknown') });
      // Reset view for the new run.
      body.innerHTML = '<div class="pp-mst-empty" data-role="empty">Waiting for the agent to begin…</div>';
      toolElById.clear();
      toolCount = 0;
      toolCountEl.textContent = '';
      setStatus('running', 'running');
      durationTimer = setInterval(tickDuration, 1000);
    });
    root.querySelector('[data-act="edit"]').addEventListener('click', () => {
      window.PiPilot?.missions?.openEditor?.(mission);
    });
    root.querySelector('[data-act="log"]').addEventListener('click', () => openMissionLog(mission));

    // ── Follow-up message input ───────────────────────────────────
    const inputEl = root.querySelector('[data-role="input"]');
    const sendBtn = root.querySelector('[data-act="send"]');
    const queueEl = root.querySelector('[data-role="queue"]');
    function autoGrow() {
      if (!inputEl) return;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(160, inputEl.scrollHeight) + 'px';
    }
    inputEl?.addEventListener('input', autoGrow);
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollowUp(); }
    });
    sendBtn?.addEventListener('click', sendFollowUp);
    async function sendFollowUp() {
      const text = (inputEl?.value || '').trim();
      if (!text) return;
      // Optimistic render of the user message at the bottom of the body.
      activeTextEl = null;
      if (empty) empty.style.display = 'none';
      const msg = document.createElement('div');
      msg.className = 'pp-mst-msg user';
      msg.innerHTML = `<div class="pp-mst-msg-head">You</div><div></div>`;
      msg.lastElementChild.textContent = text;
      body.appendChild(msg);
      scrollToBottom();
      inputEl.value = '';
      autoGrow();
      try {
        const r = await api.missions.sendMessage(mission.id, text, window.PiPilot?.state?.projectPath || null);
        if (!r?.ok) {
          bus.emit('toast:show', { type: 'warn', message: r?.error || 'Could not send message' });
        } else if (r.queued) {
          updateQueue(r.queueLength);
        }
      } catch (err) {
        bus.emit('toast:show', { type: 'warn', message: 'Send failed: ' + (err?.message || err) });
      }
    }
    function updateQueue(n) {
      if (!queueEl) return;
      if (!n) { queueEl.hidden = true; queueEl.textContent = ''; return; }
      queueEl.hidden = false;
      queueEl.innerHTML = `<strong>${n}</strong> message${n === 1 ? '' : 's'} queued — will send when current turn ends`;
    }

    const dispose = () => {
      try { offEvent(); } catch {}
      try { offEnd(); } catch {}
      try { offStatus && offStatus(); } catch {}
      try { offQueued && offQueued(); } catch {}
      try { offTurnEnd && offTurnEnd(); } catch {}
      clearInterval(durationTimer);
      openTabs.delete(mission.id);
    };
    openTabs.set(mission.id, { tabId: tabIdFor(mission.id), dispose });
    // Returned to editor.openVirtualTab as the doc.unmount handler so
    // closing the tab tears down our subscriptions automatically.
    return dispose;
  }

  // ── Mission log viewer ─────────────────────────────────────────
  // Cloud missions write their log to <userData>/missions.log.md;
  // local missions write to <projectPath>/.pipilot/missions.log.md.
  // The renderer can't open files outside the open project via the
  // normal editor.openFile path, so we use the missions:read-log IPC
  // (which knows both possible locations) and render the content in
  // a virtual tab. Hovering over the mission section in the log
  // shows everything: status, target, trigger, tool count, duration,
  // final agent text.
  async function openMissionLog(mission) {
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab || !api.missions?.readLog) {
      bus.emit('toast:show', { type: 'warn', message: 'Cannot open log' });
      return;
    }
    const projectPath = mission.target?.kind === 'local'
      ? mission.target.projectPath
      : (window.PiPilot?.state?.projectPath || null);
    let combined = '';
    let files = [];
    try {
      const r = await api.missions.readLog(projectPath);
      files = r?.files || [];
      if (!files.length) {
        bus.emit('toast:show', { type: 'info', message: 'Log file does not exist yet — run the mission first.' });
        return;
      }
      // Filter content per-mission so the tab shows only entries that
      // belong to this mission's name (the log is shared across all
      // missions in that scope). Each block starts with "## <iso> —
      // <mission name> [<status>]".
      for (const f of files) {
        const blocks = f.content.split(/(?=^## \d{4}-\d{2}-\d{2}T)/m);
        const matching = blocks.filter(b => {
          const head = b.split('\n', 1)[0];
          return head.includes('— ' + mission.name + ' [') ||
                 head.includes('- ' + mission.name + ' [');
        });
        if (matching.length) {
          combined += `\n\n<!-- from ${f.file} -->\n` + matching.join('\n') + '\n';
        }
      }
      if (!combined.trim()) {
        // No mission-specific entries — show the full log so the user
        // can find what they're looking for.
        combined = files.map(f => `<!-- ${f.file} -->\n` + f.content).join('\n\n---\n\n');
      }
    } catch (err) {
      bus.emit('toast:show', { type: 'warn', message: 'Could not read log: ' + (err?.message || err) });
      return;
    }

    const tabId = 'pipilot://mission-log/' + mission.id;
    editor.openVirtualTab({
      id: tabId,
      name: 'Log · ' + mission.name,
      icon: '📄',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;background:var(--bg,#16161a);overflow:auto;display:flex;flex-direction:column;';
        const head = document.createElement('div');
        head.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
        head.innerHTML = `
          <div style="font-size:13px;font-weight:600;color:var(--text-strong);">Mission log — ${escapeHtml(mission.name)}</div>
          <div style="display:flex;gap:8px;">
            <button class="pp-mst-btn" data-act="reveal">📂 Reveal in folder</button>
            <button class="pp-mst-btn" data-act="raw">📝 Raw markdown</button>
            <button class="pp-mst-btn" data-act="refresh">↻ Refresh</button>
          </div>`;
        container.appendChild(head);
        const body = document.createElement('div');
        body.className = 'pp-mst-log md-body';
        body.style.cssText = 'flex:1;margin:0;padding:18px 24px;font-family:var(--font-sans);font-size:13px;line-height:1.65;color:var(--text);overflow:auto;';
        const renderMarkdown = (md) => {
          if (window.marked?.parse) {
            try { return window.marked.parse(md, { breaks: true, gfm: true }); } catch {}
          }
          return '<pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:11.5px;">' + escapeHtml(md) + '</pre>';
        };
        let showRaw = false;
        const setContent = (md) => {
          body.innerHTML = showRaw
            ? '<pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:11.5px;line-height:1.55;">' + escapeHtml(md) + '</pre>'
            : renderMarkdown(md);
        };
        setContent(combined.trim() || '(empty)');
        container.appendChild(body);
        head.querySelector('[data-act="refresh"]').addEventListener('click', async () => {
          try {
            const r = await api.missions.readLog(projectPath);
            const fresh = (r?.files || []).map(f => `<!-- ${f.file} -->\n` + f.content).join('\n\n---\n\n');
            setContent(fresh.trim() || '(empty)');
          } catch {}
        });
        head.querySelector('[data-act="raw"]').addEventListener('click', (e) => {
          showRaw = !showRaw;
          e.currentTarget.textContent = showRaw ? '🎨 Rendered' : '📝 Raw markdown';
          // Re-render whatever is currently shown.
          const curr = body.dataset._md || combined.trim();
          setContent(curr);
        });
        body.dataset._md = combined.trim();
        head.querySelector('[data-act="reveal"]').addEventListener('click', () => {
          const target = files[0]?.file;
          if (target && api.shell?.showItemInFolder) {
            api.shell.showItemInFolder(target);
          }
        });
        return () => {};
      },
    });
  }

  // ── Open a file written by a mission ────────────────────────────
  // Routes:
  //   - .pipilot/bug-findings.jsonl → structured BugBot viewer
  //   - .jsonl  → generic JSONL table viewer
  //   - .json / .md / source — open in editor
  async function openWrittenFile(filePath, mission) {
    const sep = (filePath.includes('\\') ? '\\' : '/');
    const baseName = filePath.split(/[\\/]/).pop();

    // Resolve absolute path. For local missions it's projectPath +
    // path; for cloud it's workDir (the scratch clone). We ask main
    // for the latest workDir so cloud missions just work.
    let absPath = filePath;
    const isAbs = /^([a-zA-Z]:\\|\/|\\\\)/.test(filePath);
    if (!isAbs) {
      let workDir = mission.target?.kind === 'local' ? mission.target.projectPath : null;
      if (!workDir) {
        try {
          const st = await api.missions.getState(mission.id);
          if (st?.workDir) workDir = st.workDir;
        } catch {}
      }
      if (workDir) {
        const trimmed = filePath.replace(/^[.\\/]+/, '');
        absPath = workDir.replace(/[\\/]+$/, '') + sep + trimmed;
      }
    }

    // BugBot findings → structured viewer
    if (baseName === 'bug-findings.jsonl' || /\.bug-findings\.jsonl$/.test(baseName)) {
      return openBugFindingsTab(absPath, mission);
    }
    // Other JSONL → generic table viewer
    if (baseName.endsWith('.jsonl')) {
      return openJsonlTab(absPath, mission);
    }
    // JSON → pretty-printed
    if (baseName.endsWith('.json')) {
      return openJsonTab(absPath, mission);
    }
    // Anything else → editor
    try {
      const editor = window.PiPilot?.editor;
      if (editor?.openFile) await editor.openFile(absPath);
    } catch (err) {
      bus.emit('toast:show', { type: 'warn', message: 'Could not open file: ' + (err?.message || err) });
    }
  }

  // Generic helper: open a virtual tab and render arbitrary content
  // into it. Returns the container so callers can keep populating
  // asynchronously.
  function openVirtualReadonlyTab({ id, name, icon = '📋' }, render) {
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return null;
    editor.openVirtualTab({
      id,
      name,
      icon,
      mount: (container) => {
        try { render(container); } catch (err) {
          container.innerHTML = `<div style="padding:24px;color:var(--error);font-family:var(--font-mono);font-size:12px;">Render failed: ${escapeHtml(err?.message || String(err))}</div>`;
        }
        return () => {};
      },
    });
  }

  // ── BugBot findings viewer ─────────────────────────────────────
  // Reads the JSONL, groups by file path, sorts by severity (errors
  // first), renders each finding as a card with severity dot, line:col
  // anchor (clickable → jumps to the file), code label, and message.
  async function openBugFindingsTab(absPath, mission) {
    const id = 'pipilot://bugbot-findings/' + (mission.id || 'global') + ':' + absPath;
    openVirtualReadonlyTab({ id, name: 'Bug findings · ' + (mission?.name || 'BugBot'), icon: '🐛' }, async (container) => {
      container.style.cssText = 'width:100%;height:100%;background:var(--bg,#16161a);overflow:hidden;display:flex;flex-direction:column;';
      container.innerHTML = `
        <div class="pp-bf-head">
          <div>
            <div class="pp-bf-title">🐛 Bug findings</div>
            <div class="pp-bf-sub" data-role="sub">Loading…</div>
          </div>
          <div class="pp-bf-actions">
            <button class="pp-mst-btn" data-act="reveal">📂 Reveal file</button>
            <button class="pp-mst-btn" data-act="reload">↻ Reload</button>
          </div>
        </div>
        <div class="pp-bf-body" data-role="body"></div>
      `;
      const sub = container.querySelector('[data-role="sub"]');
      const bodyEl = container.querySelector('[data-role="body"]');

      async function load() {
        bodyEl.innerHTML = `<div class="pp-bf-empty">Reading…</div>`;
        let raw = '';
        try {
          const r = await api.files.read(absPath);
          raw = r?.content || (typeof r === 'string' ? r : '');
        } catch (err) {
          bodyEl.innerHTML = `<div class="pp-bf-empty">Couldn't read file: ${escapeHtml(err?.message || String(err))}</div>`;
          return;
        }
        if (!raw.trim()) {
          bodyEl.innerHTML = `<div class="pp-bf-empty">Findings file exists but is empty.</div>`;
          sub.textContent = '0 findings';
          return;
        }
        const items = [];
        for (const line of raw.split(/\r?\n/)) {
          const t = line.trim(); if (!t) continue;
          try {
            const o = JSON.parse(t);
            if (o && o.path && o.message) items.push(o);
          } catch {}
        }
        if (!items.length) {
          bodyEl.innerHTML = `<div class="pp-bf-empty">File is JSONL but no valid finding records.</div>`;
          return;
        }
        const sevOrder = { error: 0, warning: 1, info: 2 };
        const groups = new Map();
        for (const it of items) {
          const list = groups.get(it.path) || [];
          list.push(it);
          groups.set(it.path, list);
        }
        for (const list of groups.values()) {
          list.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9) || (a.line || 0) - (b.line || 0));
        }
        const counts = {
          error: items.filter(i => i.severity === 'error').length,
          warning: items.filter(i => i.severity === 'warning').length,
          info: items.filter(i => i.severity === 'info').length,
        };
        sub.innerHTML = `<span class="pp-bf-pill err">${counts.error} error${counts.error === 1 ? '' : 's'}</span> · <span class="pp-bf-pill warn">${counts.warning} warning${counts.warning === 1 ? '' : 's'}</span> · <span class="pp-bf-pill info">${counts.info} info</span> · ${items.length} total in ${groups.size} file${groups.size === 1 ? '' : 's'}`;
        bodyEl.innerHTML = '';
        for (const [filePath, list] of groups.entries()) {
          const group = document.createElement('div');
          group.className = 'pp-bf-group';
          const errN = list.filter(i => i.severity === 'error').length;
          const warnN = list.filter(i => i.severity === 'warning').length;
          group.innerHTML = `
            <div class="pp-bf-group-head">
              <span class="pp-bf-file" data-act="open-file" data-path="${escapeHtml(filePath)}">${escapeHtml(filePath)}</span>
              <span class="pp-bf-group-counts">${errN ? `<span class="pp-bf-pill err">${errN}E</span>` : ''}${warnN ? `<span class="pp-bf-pill warn">${warnN}W</span>` : ''}<span class="pp-bf-pill total">${list.length}</span></span>
            </div>
            <div class="pp-bf-items"></div>
          `;
          const itemsHost = group.querySelector('.pp-bf-items');
          for (const it of list) {
            const card = document.createElement('div');
            card.className = 'pp-bf-card sev-' + (it.severity || 'info');
            card.innerHTML = `
              <span class="pp-bf-sev-dot"></span>
              <div class="pp-bf-card-body">
                <div class="pp-bf-card-head">
                  <span class="pp-bf-loc" data-act="open-line" data-path="${escapeHtml(it.path)}" data-line="${it.line || 1}">${escapeHtml(filePath.split(/[\\/]/).pop())}:${it.line || 1}${it.column ? ':' + it.column : ''}</span>
                  ${it.code ? `<span class="pp-bf-code">${escapeHtml(it.code)}</span>` : ''}
                </div>
                <div class="pp-bf-msg">${escapeHtml(it.message || '')}</div>
              </div>`;
            itemsHost.appendChild(card);
          }
          bodyEl.appendChild(group);
        }
        // Wire click → jump to file
        bodyEl.querySelectorAll('[data-act="open-file"]').forEach(el => {
          el.addEventListener('click', () => {
            tryOpenFromMission(el.dataset.path, null, mission);
          });
        });
        bodyEl.querySelectorAll('[data-act="open-line"]').forEach(el => {
          el.addEventListener('click', () => {
            const line = parseInt(el.dataset.line || '1', 10);
            tryOpenFromMission(el.dataset.path, line, mission);
          });
        });
      }
      container.querySelector('[data-act="reload"]').addEventListener('click', load);
      container.querySelector('[data-act="reveal"]').addEventListener('click', () => {
        try { api.shell?.showItemInFolder?.(absPath); } catch {}
      });
      load();
    });
  }

  async function tryOpenFromMission(filePath, line, mission) {
    if (!filePath) return;
    const isAbs = /^([a-zA-Z]:\\|\/|\\\\)/.test(filePath);
    let abs = filePath;
    if (!isAbs) {
      let workDir = mission.target?.kind === 'local' ? mission.target.projectPath : null;
      if (!workDir) {
        try { const st = await api.missions.getState(mission.id); if (st?.workDir) workDir = st.workDir; } catch {}
      }
      if (workDir) {
        const sep = workDir.includes('\\') ? '\\' : '/';
        abs = workDir.replace(/[\\/]+$/, '') + sep + filePath.replace(/^[.\\/]+/, '');
      }
    }
    try {
      const editor = window.PiPilot?.editor;
      if (editor?.openFile) await editor.openFile(abs, { line: line || undefined });
    } catch (err) {
      bus.emit('toast:show', { type: 'warn', message: 'Could not open: ' + (err?.message || err) });
    }
  }

  // ── Generic JSONL table viewer ─────────────────────────────────
  async function openJsonlTab(absPath, mission) {
    const id = 'pipilot://jsonl/' + (mission.id || 'g') + ':' + absPath;
    openVirtualReadonlyTab({ id, name: absPath.split(/[\\/]/).pop(), icon: '📋' }, async (container) => {
      // Flex column so the header doesn't push content off-screen
      // and the table area scrolls independently.
      container.style.cssText = 'width:100%;height:100%;background:var(--bg,#16161a);display:flex;flex-direction:column;overflow:hidden;';
      container.innerHTML = `
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--text-mid);font-family:var(--font-mono);flex-shrink:0;" data-role="head">Loading ${escapeHtml(absPath)}…</div>
        <div style="flex:1;overflow:auto;padding:10px 16px;font-family:var(--font-mono);font-size:11.5px;" data-role="body"></div>
      `;
      const head = container.querySelector('[data-role="head"]');
      const bodyEl = container.querySelector('[data-role="body"]');
      let raw = '';
      try {
        const r = await api.files.read(absPath);
        raw = r?.content || (typeof r === 'string' ? r : '');
      } catch (err) {
        bodyEl.innerHTML = `<div style="color:var(--error);">Read failed: ${escapeHtml(err?.message || String(err))}</div>`;
        return;
      }
      const rows = [];
      const cols = new Set();
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim(); if (!t) continue;
        try { const o = JSON.parse(t); rows.push(o); Object.keys(o || {}).forEach(k => cols.add(k)); } catch {}
      }
      const colList = Array.from(cols);
      if (!rows.length) { bodyEl.innerHTML = `<div style="color:var(--text-dim);">Empty or unparseable JSONL.</div>`; return; }
      head.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'} · ${colList.length} columns · ${absPath}`;
      const headRow = '<tr>' + colList.map(c => `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);color:var(--text-mid);font-weight:600;position:sticky;top:0;background:var(--bg,#16161a);">${escapeHtml(c)}</th>`).join('') + '</tr>';
      const bodyRows = rows.map(r => '<tr>' + colList.map(c => `<td style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top;color:var(--text);max-width:380px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(typeof r[c] === 'object' ? JSON.stringify(r[c]) : (r[c] ?? ''))}</td>`).join('') + '</tr>').join('');
      bodyEl.innerHTML = `<table style="width:100%;border-collapse:collapse;">${headRow}${bodyRows}</table>`;
    });
  }

  // ── JSON viewer (pretty-print + copy) ─────────────────────────
  async function openJsonTab(absPath, mission) {
    const id = 'pipilot://json/' + (mission.id || 'g') + ':' + absPath;
    openVirtualReadonlyTab({ id, name: absPath.split(/[\\/]/).pop(), icon: '🧾' }, async (container) => {
      container.style.cssText = 'width:100%;height:100%;background:var(--bg,#16161a);display:flex;flex-direction:column;overflow:hidden;';
      container.innerHTML = `
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--text-mid);font-family:var(--font-mono);flex-shrink:0;">${escapeHtml(absPath)}</div>
        <div style="flex:1;overflow:auto;padding:14px 18px;" data-role="body"></div>
      `;
      const bodyEl = container.querySelector('[data-role="body"]');
      let raw = '';
      try {
        const r = await api.files.read(absPath);
        raw = r?.content || (typeof r === 'string' ? r : '');
      } catch (err) {
        bodyEl.innerHTML = `<div style="color:var(--error);">Read failed: ${escapeHtml(err?.message || String(err))}</div>`;
        return;
      }
      let pretty = raw;
      try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch {}
      bodyEl.innerHTML = `<pre style="margin:0;white-space:pre-wrap;word-wrap:break-word;font-family:var(--font-mono);font-size:11.5px;line-height:1.55;color:var(--text);">${escapeHtml(pretty)}</pre>`;
    });
  }

  // ── BugBot findings viewer styles ──────────────────────────────
  if (!document.getElementById('pp-bf-styles')) {
    const s = document.createElement('style');
    s.id = 'pp-bf-styles';
    s.textContent = `
.pp-bf-head { padding:14px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:14px; flex-shrink:0; }
.pp-bf-title { font-size:14px; font-weight:600; color:var(--text-strong); }
.pp-bf-sub { font-size:11.5px; color:var(--text-mid); margin-top:3px; font-family:var(--font-mono); }
.pp-bf-actions { display:flex; gap:6px; }
.pp-bf-body { flex:1; overflow:auto; padding:14px 18px 24px; display:flex; flex-direction:column; gap:14px; }
.pp-bf-empty { text-align:center; color:var(--text-dim); padding:30px 12px; font-size:12px; }
.pp-bf-pill { display:inline-block; padding:1px 7px; border-radius:9px; font-size:10px; font-family:var(--font-mono); font-weight:500; letter-spacing:0.04em; vertical-align:1px; margin:0 2px; }
.pp-bf-pill.err { background:rgba(229,83,75,0.12); color:var(--error,#e5534b); border:1px solid rgba(229,83,75,0.32); }
.pp-bf-pill.warn { background:rgba(224,160,74,0.12); color:#e0a04a; border:1px solid rgba(224,160,74,0.32); }
.pp-bf-pill.info { background:rgba(108,182,255,0.12); color:var(--info,#6cb6ff); border:1px solid rgba(108,182,255,0.32); }
.pp-bf-pill.total { background:rgba(255,255,255,0.06); color:var(--text-mid); border:1px solid rgba(255,255,255,0.12); }
.pp-bf-group { background:var(--surface,#1c1c21); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.pp-bf-group-head { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(255,255,255,0.02); border-bottom:1px solid var(--border); }
.pp-bf-file { font-family:var(--font-mono); font-size:12px; color:var(--text-strong); cursor:pointer; transition:color 0.12s; }
.pp-bf-file:hover { color:var(--accent-light,#ffb38a); text-decoration:underline; }
.pp-bf-group-counts { display:flex; align-items:center; gap:4px; }
.pp-bf-items { display:flex; flex-direction:column; }
.pp-bf-card { display:flex; gap:10px; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.04); align-items:flex-start; }
.pp-bf-card:last-child { border-bottom:none; }
.pp-bf-sev-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:6px; }
.pp-bf-card.sev-error .pp-bf-sev-dot { background:var(--error,#e5534b); box-shadow:0 0 0 3px rgba(229,83,75,0.15); }
.pp-bf-card.sev-warning .pp-bf-sev-dot { background:#e0a04a; box-shadow:0 0 0 3px rgba(224,160,74,0.15); }
.pp-bf-card.sev-info .pp-bf-sev-dot { background:var(--info,#6cb6ff); box-shadow:0 0 0 3px rgba(108,182,255,0.15); }
.pp-bf-card-body { flex:1; min-width:0; }
.pp-bf-card-head { display:flex; align-items:center; gap:8px; margin-bottom:3px; }
.pp-bf-loc { font-family:var(--font-mono); font-size:11px; color:var(--accent-light,#ffb38a); cursor:pointer; }
.pp-bf-loc:hover { text-decoration:underline; }
.pp-bf-code { font-family:var(--font-mono); font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(255,255,255,0.06); color:var(--text-mid); letter-spacing:0.04em; }
.pp-bf-msg { font-size:12.5px; line-height:1.55; color:var(--text); user-select:text; }
`;
    document.head.appendChild(s);
  }

  // Public API
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.missions = window.PiPilot.missions || {};
  window.PiPilot.missions.openStreamTab = openMissionTab;
  window.PiPilot.missions.openLog = openMissionLog;
  window.PiPilot.missions.openWrittenFile = openWrittenFile;
})();
