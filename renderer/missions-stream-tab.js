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
.pp-mst-text { font-size:13px; line-height:1.65; color:var(--text); white-space:pre-wrap; word-wrap:break-word; }
.pp-mst-text code { background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:3px; font-family:var(--font-mono); font-size:12px; color:var(--accent-light,#ffb38a); }
.pp-mst-text pre { background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); padding:8px 10px; border-radius:4px; margin:6px 0; overflow-x:auto; font-family:var(--font-mono); font-size:11.5px; }

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

.pp-mst-event-time { font-size:10px; color:var(--text-dim); font-family:var(--font-mono); margin-right:6px; opacity:0.6; }

.pp-mst-foot { padding:10px 16px; border-top:1px solid var(--border); display:flex; align-items:center; gap:8px; flex-shrink:0; background:var(--surface,#1c1c21); }
.pp-mst-foot-spacer { flex:1; }
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

    // If a tab is already mounted, just focus it.
    if (openTabs.has(mission.id)) {
      editor.openVirtualTab({ id: tabId, name: 'Mission · ' + mission.name, mount: () => {} });
      return;
    }

    editor.openVirtualTab({
      id: tabId,
      name: 'Mission · ' + mission.name,
      icon: '⚡',
      mount: (container) => {
        mountStreamView(container, mission);
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
      <div class="pp-mst-foot">
        <button class="pp-mst-btn danger" data-act="stop">⏹ Stop mission</button>
        <button class="pp-mst-btn" data-act="log">📄 Open log file</button>
        <div class="pp-mst-foot-spacer"></div>
        <button class="pp-mst-btn" data-act="edit">⚙ Edit mission</button>
        <button class="pp-mst-btn primary" data-act="rerun">↻ Run again</button>
      </div>
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

    function setStatus(state, label) {
      statusEl.classList.remove('running', 'success', 'error', 'timeout', 'stopped', 'skipped');
      // Map outcome status names to visual classes (success/error/etc).
      const visualClass = state === 'success' ? 'success'
        : state === 'running' ? 'running'
        : state === 'timeout' ? 'timeout'
        : 'error';
      statusEl.classList.add(visualClass);
      const icon = state === 'running' ? SVG.spin : (state === 'success' ? SVG.ok : SVG.err);
      statusEl.innerHTML = `${icon} <span data-role="status-label">${escapeHtml(label || state)}</span>`;
      stopBtn.disabled = state !== 'running';
      rerunBtn.disabled = state === 'running';
    }

    function appendTextDelta(text) {
      if (!text) return;
      if (empty) empty.style.display = 'none';
      if (!activeTextEl) {
        activeTextEl = document.createElement('div');
        activeTextEl.className = 'pp-mst-text';
        body.appendChild(activeTextEl);
      }
      activeTextEl.textContent += text;
      scrollToBottom();
    }

    function appendToolCall(call) {
      if (empty) empty.style.display = 'none';
      activeTextEl = null;   // close any open text block
      const pill = document.createElement('div');
      pill.className = 'pp-mst-pill running';
      pill.dataset.toolId = call.id || ('t-' + Math.random().toString(36).slice(2));
      pill.innerHTML = `
        <span class="pp-mst-pill-icon">${SVG.spin}</span>
        <span class="pp-mst-pill-name">${escapeHtml(call.name || 'tool')}</span>
        ${call.input ? `<span class="pp-mst-pill-sep">·</span><span class="pp-mst-pill-preview">${escapeHtml(previewFor(call.name, call.input))}</span>` : ''}
      `;
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
        case 'text':       appendTextDelta(evt.text || ''); break;
        case 'tool_call':  appendToolCall(evt); break;
        case 'tool_result': markToolResult(evt.toolUseId, evt.isError); break;
        case 'error':      appendError(evt.message); break;
        case 'thinking':   /* skip — streamed reasoning isn't surfaced */ break;
      }
    }

    // Replay buffered events (when the tab opens mid-run or after end).
    const buf = window.PiPilot?.missions?.runner?.getBuffer?.(mission.id);
    if (buf) {
      for (const evt of buf.events) applyEvent(evt);
      if (buf.status && buf.status !== 'running') {
        setStatus(buf.status, buf.status);
        clearInterval(durationTimer);
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
    root.querySelector('[data-act="log"]').addEventListener('click', async () => {
      const logPath = mission.target?.kind === 'local' && mission.target.projectPath
        ? mission.target.projectPath + (mission.target.projectPath.includes('\\') ? '\\' : '/') + '.pipilot' + (mission.target.projectPath.includes('\\') ? '\\' : '/') + 'missions.log.md'
        : null;
      if (logPath && api.files?.read) {
        try {
          // Open via the editor's normal openFile flow.
          window.PiPilot?.editor?.openFile?.(logPath);
        } catch (err) {
          bus.emit('toast:show', { type: 'warn', message: 'Log not yet written' });
        }
      } else {
        bus.emit('toast:show', { type: 'info', message: 'Log lives in user data for cloud missions' });
      }
    });

    openTabs.set(mission.id, {
      tabId: tabIdFor(mission.id),
      dispose: () => {
        try { offEvent(); } catch {}
        try { offEnd(); } catch {}
        clearInterval(durationTimer);
        openTabs.delete(mission.id);
      },
    });
  }

  // Public API
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.missions = window.PiPilot.missions || {};
  window.PiPilot.missions.openStreamTab = openMissionTab;
})();
