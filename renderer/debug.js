// PiPilot IDE — Node debugger UI (Phase 1).
// Owns:
//   • Ace gutter breakpoints (click to toggle, persisted to localStorage)
//   • The Debug bottom-panel (controls / call stack / scopes / console)
//   • A single active CDP session via PiPilot.api.debug
//
// Scope is intentionally narrow — Node only, single file, no launch.json,
// no conditional breakpoints. Adding multiple sessions / browser targets
// later means lifting `state.session` to a Map keyed by sessionId.

(() => {
  const api = window.PiPilot?.api;
  const bus = window.PiPilot?.bus;
  if (!api || !bus || !api.debug) return;

  const BP_KEY = 'pipilot.debug.breakpoints'; // { [filePath]: number[] }
  const SELECTED_CONFIG_KEY = 'pipilot.debug.selectedConfig';
  const state = {
    breakpoints: loadBreakpoints(),
    session: null,           // { id, script } when a debug run is active
    paused: null,            // { callFrames, hitBreakpoints } when paused
    activeFrame: 0,
    activeMarkerId: null,    // ace marker for the current pause line
    activeMarkerSession: null,
    configs: [],             // launch.json configurations[]
    selectedConfig: null,    // name of currently selected config, or null = "Debug File"
    launchJsonPath: null,
  };

  // ── Breakpoint persistence ──────────────────────────────────────────
  function loadBreakpoints() {
    try { return JSON.parse(localStorage.getItem(BP_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function saveBreakpoints() {
    try { localStorage.setItem(BP_KEY, JSON.stringify(state.breakpoints)); } catch {}
  }
  function bpsForFile(filePath) {
    return Array.from(new Set(state.breakpoints[filePath] || [])).sort((a, b) => a - b);
  }
  function setBpsForFile(filePath, lines) {
    if (!lines || !lines.length) delete state.breakpoints[filePath];
    else state.breakpoints[filePath] = Array.from(new Set(lines)).sort((a, b) => a - b);
    saveBreakpoints();
    if (state.session) {
      api.debug.setBreakpoints(state.session.id, filePath, bpsForFile(filePath)).catch(() => {});
    }
  }

  // ── launch.json (.vscode) ───────────────────────────────────────────
  // Tolerant JSONC parser — strips // and /* */ comments and trailing
  // commas. Good enough for hand-edited config files; not a full spec
  // implementation. Fails to JSON.parse silently and the user sees the
  // raw error in the console pane.
  function stripJsonc(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      const c2 = src[i + 1];
      // String literal — copy verbatim, respect escapes
      if (c === '"') {
        out += c; i++;
        while (i < n) {
          out += src[i];
          if (src[i] === '\\' && i + 1 < n) { out += src[i + 1]; i += 2; continue; }
          if (src[i] === '"') { i++; break; }
          i++;
        }
        continue;
      }
      // Line comment
      if (c === '/' && c2 === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      // Block comment
      if (c === '/' && c2 === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      out += c; i++;
    }
    // Trailing commas before } or ]
    out = out.replace(/,(\s*[}\]])/g, '$1');
    return out;
  }

  async function loadLaunchJson() {
    state.configs = [];
    state.launchJsonPath = null;
    const projectPath = window.PiPilot?.state?.projectPath;
    if (!projectPath || !api.files?.read) { renderConfigPicker(); return; }
    const launchPath = projectPath.replace(/[\\/]+$/, '') + '/.vscode/launch.json';
    try {
      const stat = await api.files.stat?.(launchPath);
      if (!stat || stat.exists === false) { renderConfigPicker(); return; }
    } catch { renderConfigPicker(); return; }
    try {
      const r = await api.files.read(launchPath);
      const raw = r?.content ?? r?.data ?? r;
      if (typeof raw !== 'string') { renderConfigPicker(); return; }
      const parsed = JSON.parse(stripJsonc(raw));
      const configs = Array.isArray(parsed?.configurations) ? parsed.configurations : [];
      // Only Node-ish configs are runnable today. Show the rest disabled.
      state.configs = configs.filter(c => c && typeof c.name === 'string');
      state.launchJsonPath = launchPath;
      const saved = localStorage.getItem(SELECTED_CONFIG_KEY);
      if (saved && state.configs.some(c => c.name === saved)) state.selectedConfig = saved;
      else state.selectedConfig = state.configs[0]?.name || null;
    } catch (err) {
      pushConsole('error', `launch.json parse failed: ${err.message}`);
    }
    renderConfigPicker();
  }

  // VS Code-style variable substitution. Supports the subset that's
  // meaningful inside an editor session — no task vars, no input vars.
  function substituteVars(value, ctx) {
    if (Array.isArray(value)) return value.map(v => substituteVars(v, ctx));
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) out[k] = substituteVars(value[k], ctx);
      return out;
    }
    if (typeof value !== 'string') return value;
    return value.replace(/\$\{([^}]+)\}/g, (_m, key) => {
      if (key === 'workspaceFolder' || key === 'workspaceRoot') return ctx.workspace || '';
      if (key === 'workspaceFolderBasename') return (ctx.workspace || '').split(/[\\/]/).pop() || '';
      if (key === 'file') return ctx.file || '';
      if (key === 'fileBasename') return (ctx.file || '').split(/[\\/]/).pop() || '';
      if (key === 'fileBasenameNoExtension') {
        const b = (ctx.file || '').split(/[\\/]/).pop() || '';
        return b.replace(/\.[^.]+$/, '');
      }
      if (key === 'fileDirname') {
        const f = ctx.file || ''; const i = Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\'));
        return i >= 0 ? f.slice(0, i) : '';
      }
      if (key === 'fileExtname') { const m = /\.[^.]+$/.exec(ctx.file || ''); return m ? m[0] : ''; }
      if (key === 'cwd') return ctx.workspace || '';
      if (key === 'pathSeparator') return navigator.platform.startsWith('Win') ? '\\' : '/';
      if (key.startsWith('env:')) return ctx.env?.[key.slice(4)] || '';
      return '';
    });
  }

  function resolveConfig(cfg, ctx) {
    const r = substituteVars(cfg, ctx);
    return {
      name: r.name,
      type: r.type || 'node',
      script: r.program || ctx.file,
      cwd: r.cwd || ctx.workspace,
      args: Array.isArray(r.args) ? r.args : [],
      env: { ...(r.env || {}) },
      runtimeExecutable: r.runtimeExecutable || null,
      runtimeArgs: Array.isArray(r.runtimeArgs) ? r.runtimeArgs : [],
    };
  }

  // ── Ace gutter wiring ───────────────────────────────────────────────
  injectStyles();
  bus.on('ace:ready', wireGutter);
  bus.on('editor:active', () => { setTimeout(refreshGutterMarkers, 0); });
  bus.on('file:opened', () => { setTimeout(refreshGutterMarkers, 0); });
  // Some surfaces emit a generic "file changed" — covers tab switch
  bus.on('editor:changed', () => { setTimeout(refreshGutterMarkers, 0); });
  bus.on('project:opened', loadLaunchJson);
  bus.on('project:loaded', loadLaunchJson);
  // Re-read when the user saves launch.json so picker stays current.
  bus.on('file:saved', (p) => {
    if (typeof p === 'string' && /\.vscode[\\/]launch\.json$/i.test(p)) loadLaunchJson();
    else if (p?.path && /\.vscode[\\/]launch\.json$/i.test(p.path)) loadLaunchJson();
  });
  setTimeout(loadLaunchJson, 800);

  function wireGutter(editor) {
    if (!editor || editor._dbgGutterWired) return;
    editor._dbgGutterWired = true;
    editor.on('guttermousedown', (e) => {
      const target = e.domEvent?.target;
      // Ignore clicks on the fold widgets
      if (target && target.className && /ace_fold-widget/.test(target.className)) return;
      const row = e.getDocumentPosition().row;
      const filePath = window.PiPilot?.editor?.getActiveFile?.();
      if (!filePath || filePath.startsWith('browser-tab://') || filePath.startsWith('pipilot-')) return;
      toggleBreakpoint(filePath, row + 1);
      e.stop();
    });
    setTimeout(refreshGutterMarkers, 0);
  }

  function toggleBreakpoint(filePath, line) {
    const lines = bpsForFile(filePath);
    const idx = lines.indexOf(line);
    if (idx >= 0) lines.splice(idx, 1);
    else lines.push(line);
    setBpsForFile(filePath, lines);
    refreshGutterMarkers();
  }

  function refreshGutterMarkers() {
    const editor = window.PiPilot?.editor?.getAce?.();
    const filePath = window.PiPilot?.editor?.getActiveFile?.();
    if (!editor || !filePath) return;
    const session = editor.session;
    // Clear our own breakpoint classes from every line, then re-stamp.
    const total = session.getLength();
    for (let r = 0; r < total; r++) session.removeGutterDecoration(r, 'dbg-breakpoint');
    for (const line of bpsForFile(filePath)) {
      session.addGutterDecoration(line - 1, 'dbg-breakpoint');
    }
    refreshActiveLineMarker();
  }

  function refreshActiveLineMarker() {
    const editor = window.PiPilot?.editor?.getAce?.();
    if (!editor) return;
    const session = editor.session;
    if (state.activeMarkerSession && state.activeMarkerId != null) {
      try { state.activeMarkerSession.removeMarker(state.activeMarkerId); } catch {}
      state.activeMarkerId = null;
      state.activeMarkerSession = null;
    }
    const frame = state.paused?.callFrames?.[state.activeFrame];
    if (!frame || !frame.filePath) return;
    const filePath = window.PiPilot?.editor?.getActiveFile?.();
    if (!filePath || normalize(filePath) !== normalize(frame.filePath)) return;
    const Range = window.ace?.require?.('ace/range')?.Range;
    if (!Range) return;
    const row = frame.line - 1;
    const range = new Range(row, 0, row, 1);
    const id = session.addMarker(range, 'dbg-active-line', 'fullLine');
    state.activeMarkerId = id;
    state.activeMarkerSession = session;
    try { editor.scrollToLine(row, true, true); } catch {}
  }

  function normalize(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }

  // ── Debug session lifecycle ─────────────────────────────────────────
  async function startDebug(script) {
    if (state.session) {
      pushConsole('warn', 'A debug session is already running. Stop it first.');
      return;
    }
    const activeFile = window.PiPilot?.editor?.getActiveFile?.();
    const workspace = window.PiPilot?.state?.projectPath || '';
    const ctx = { file: activeFile || '', workspace, env: {} };

    let opts;
    const cfg = state.selectedConfig
      ? state.configs.find(c => c.name === state.selectedConfig)
      : null;

    if (cfg) {
      const resolved = resolveConfig(cfg, ctx);
      if (cfg.type && !/node|pwa-node/i.test(cfg.type)) {
        pushConsole('error', `Configuration "${cfg.name}" has unsupported type "${cfg.type}". Only node is supported in this build.`);
        revealPanel();
        return;
      }
      if (!resolved.script) {
        pushConsole('error', `Configuration "${cfg.name}" has no program/file to debug.`);
        revealPanel();
        return;
      }
      opts = {
        script: resolved.script,
        cwd: resolved.cwd,
        args: resolved.args,
        env: resolved.env,
        runtimeExecutable: resolved.runtimeExecutable,
        runtimeArgs: resolved.runtimeArgs,
      };
      pushConsole('info', `Launching "${cfg.name}": ${opts.script}${opts.args.length ? ' ' + opts.args.join(' ') : ''}`);
    } else {
      const target = script || (activeFile && /\.(m?js|cjs|ts)$/i.test(activeFile) ? activeFile : null);
      if (!target) {
        pushConsole('error', 'Open a .js / .mjs / .cjs file to debug, or add a configuration to .vscode/launch.json.');
        revealPanel();
        return;
      }
      opts = { script: target };
      pushConsole('info', `Launching: node --inspect-brk ${target}`);
    }

    revealPanel();
    setStatus('starting');
    let r;
    try { r = await api.debug.start(opts); }
    catch (err) { pushConsole('error', String(err?.message || err)); setStatus('idle'); return; }
    if (!r?.ok) { pushConsole('error', r?.error || 'failed to start'); setStatus('idle'); return; }
    state.session = { id: r.sessionId, script: opts.script, port: r.port, pid: r.pid };
    setStatus('running');
    // Push existing breakpoints for this file once we know we're attached.
    setTimeout(() => {
      if (!state.session) return;
      for (const [file, lines] of Object.entries(state.breakpoints)) {
        if (lines && lines.length) {
          api.debug.setBreakpoints(state.session.id, file, lines).catch(() => {});
        }
      }
    }, 250);
    renderPanel();
  }

  async function stopDebug() {
    if (!state.session) return;
    const id = state.session.id;
    state.session = null;
    state.paused = null;
    state.activeFrame = 0;
    refreshActiveLineMarker();
    setStatus('idle');
    renderPanel();
    try { await api.debug.stop(id); } catch {}
  }

  api.debug.onEvent((evt) => {
    if (!evt || !evt.sessionId) return;
    if (!state.session || evt.sessionId !== state.session.id) return;
    const { type, payload } = evt;
    if (type === 'attached') { setStatus('running'); pushConsole('info', `Inspector attached`); }
    else if (type === 'paused') {
      state.paused = payload;
      state.activeFrame = 0;
      setStatus('paused');
      const frame = payload.callFrames?.[0];
      if (frame?.filePath) {
        const open = window.PiPilot?.files?.openFile || window.PiPilot?.editor?.openFile;
        if (typeof open === 'function') {
          try { open(frame.filePath, { line: frame.line }); } catch {}
        }
      }
      renderPanel();
      setTimeout(refreshActiveLineMarker, 50);
    } else if (type === 'resumed') {
      state.paused = null;
      setStatus('running');
      refreshActiveLineMarker();
      renderPanel();
    } else if (type === 'output') {
      pushConsole(payload.stream === 'stderr' ? 'error' : 'log', payload.text, /*raw*/ true);
    } else if (type === 'console') {
      pushConsole(payload.level || 'log', payload.text);
    } else if (type === 'exception') {
      pushConsole('error', `${payload.text}: ${payload.message}`);
    } else if (type === 'exit') {
      pushConsole('info', `Process exited (code=${payload.code}, signal=${payload.signal || 'none'})`);
      state.session = null;
      state.paused = null;
      refreshActiveLineMarker();
      setStatus('idle');
      renderPanel();
    } else if (type === 'error') {
      pushConsole('error', payload.message || 'debug error');
    } else if (type === 'detached') {
      pushConsole('info', 'Inspector detached');
    }
  });

  // ── Panel UI ────────────────────────────────────────────────────────
  let panelEl = null;
  let consoleEl = null;
  let stackEl = null;
  let scopesEl = null;
  let statusEl = null;
  let runBtn = null;

  function ensurePanel() {
    let pane = document.getElementById('debug-pane');
    if (!pane) {
      // Inject the bottom-tab button + pane next to the existing ones.
      const tabsRow = document.querySelector('.bottom-tabs');
      const content = document.querySelector('.bottom-content');
      if (!tabsRow || !content) return null;
      const btn = document.createElement('button');
      btn.className = 'bottom-tab';
      btn.dataset.bottom = 'debug';
      btn.textContent = 'Debug';
      const spacer = tabsRow.querySelector('.bottom-tabs-spacer');
      tabsRow.insertBefore(btn, spacer || null);
      btn.addEventListener('click', () => {
        document.querySelectorAll('.bottom-tab').forEach(t => t.classList.toggle('active', t === btn));
        document.querySelectorAll('.bottom-pane').forEach(p => p.classList.toggle('active', p.id === 'debug-pane'));
        document.getElementById('main-area')?.classList.remove('bottom-collapsed');
      });
      pane = document.createElement('div');
      pane.id = 'debug-pane';
      pane.className = 'bottom-pane';
      content.appendChild(pane);
    }
    if (!pane._mounted) {
      pane.innerHTML = `
        <div class="dbg-root">
          <div class="dbg-toolbar">
            <button class="dbg-btn dbg-btn-primary" data-act="run"   title="Debug current file (F5)">▶ Debug File</button>
            <select class="dbg-config-picker" data-config-picker title="Debug configuration (.vscode/launch.json)"></select>
            <button class="dbg-btn dbg-btn-link" data-act="open-launch" title="Open .vscode/launch.json">⚙</button>
            <span class="dbg-sep"></span>
            <button class="dbg-btn" data-act="continue"  title="Continue (F5)" disabled>⏵</button>
            <button class="dbg-btn" data-act="stepOver"  title="Step Over (F10)" disabled>⤼</button>
            <button class="dbg-btn" data-act="stepInto"  title="Step Into (F11)" disabled>↘</button>
            <button class="dbg-btn" data-act="stepOut"   title="Step Out (Shift+F11)" disabled>↗</button>
            <button class="dbg-btn" data-act="pause"     title="Pause" disabled>⏸</button>
            <button class="dbg-btn dbg-btn-stop" data-act="stop" title="Stop (Shift+F5)" disabled>■</button>
            <span class="dbg-status" data-status>idle</span>
          </div>
          <div class="dbg-body">
            <div class="dbg-col dbg-col-stack">
              <div class="dbg-col-h">Call Stack</div>
              <div class="dbg-list" data-stack><div class="dbg-empty">Not paused</div></div>
            </div>
            <div class="dbg-col dbg-col-scopes">
              <div class="dbg-col-h">Scopes</div>
              <div class="dbg-list" data-scopes><div class="dbg-empty">No active frame</div></div>
            </div>
            <div class="dbg-col dbg-col-console">
              <div class="dbg-col-h">Console</div>
              <div class="dbg-console" data-console></div>
              <div class="dbg-input-row">
                <input type="text" class="dbg-input" placeholder="Evaluate in current frame…" />
                <button class="dbg-btn dbg-btn-eval">Run</button>
              </div>
            </div>
          </div>
        </div>`;
      pane._mounted = true;
    }
    panelEl  = pane;
    statusEl = pane.querySelector('[data-status]');
    consoleEl= pane.querySelector('[data-console]');
    stackEl  = pane.querySelector('[data-stack]');
    scopesEl = pane.querySelector('[data-scopes]');
    runBtn   = pane.querySelector('[data-act="run"]');
    pane.querySelectorAll('[data-act]').forEach((b) => {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', () => onAction(b.dataset.act));
    });
    const picker = pane.querySelector('[data-config-picker]');
    if (picker && !picker._wired) {
      picker._wired = true;
      picker.addEventListener('change', () => {
        const v = picker.value;
        state.selectedConfig = v === '__file__' ? null : v;
        try { localStorage.setItem(SELECTED_CONFIG_KEY, state.selectedConfig || ''); } catch {}
        const cfg = state.selectedConfig ? state.configs.find(c => c.name === state.selectedConfig) : null;
        if (runBtn) runBtn.textContent = cfg ? `▶ ${cfg.name}` : '▶ Debug File';
      });
    }
    renderConfigPicker();
    const inp = pane.querySelector('.dbg-input');
    const evalBtn = pane.querySelector('.dbg-btn-eval');
    if (inp && !inp._wired) {
      inp._wired = true;
      const run = async () => {
        const expr = inp.value.trim();
        if (!expr) return;
        inp.value = '';
        pushConsole('eval', expr);
        await runEval(expr);
      };
      evalBtn?.addEventListener('click', run);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    }
    return pane;
  }

  function onAction(act) {
    if (act === 'run')         return startDebug();
    if (act === 'stop')        return stopDebug();
    if (act === 'open-launch') return openLaunchJson();
    if (!state.session) return;
    if (act === 'continue') return api.debug.continue(state.session.id);
    if (act === 'stepOver') return api.debug.stepOver(state.session.id);
    if (act === 'stepInto') return api.debug.stepInto(state.session.id);
    if (act === 'stepOut')  return api.debug.stepOut(state.session.id);
    if (act === 'pause')    return api.debug.pause(state.session.id);
  }

  function renderConfigPicker() {
    const picker = panelEl?.querySelector('[data-config-picker]');
    if (!picker) return;
    const opts = ['<option value="__file__">Active file</option>']
      .concat(state.configs.map(c => `<option value="${escapeHtml(c.name)}"${c.name === state.selectedConfig ? ' selected' : ''}>${escapeHtml(c.name)}</option>`));
    picker.innerHTML = opts.join('');
    picker.value = state.selectedConfig || '__file__';
    picker.style.display = state.configs.length ? '' : 'none';
    if (runBtn) {
      const cfg = state.selectedConfig ? state.configs.find(c => c.name === state.selectedConfig) : null;
      runBtn.textContent = cfg ? `▶ ${cfg.name}` : '▶ Debug File';
    }
  }

  async function openLaunchJson() {
    const projectPath = window.PiPilot?.state?.projectPath;
    if (!projectPath) return;
    const launchPath = projectPath.replace(/[\\/]+$/, '') + '/.vscode/launch.json';
    try {
      const stat = await api.files.stat?.(launchPath);
      if (!stat || stat.exists === false) {
        // Seed with a sensible default that points at the active file.
        const seed = JSON.stringify({
          version: '0.2.0',
          configurations: [
            {
              type: 'node',
              request: 'launch',
              name: 'Debug Active File',
              program: '${file}',
              cwd: '${workspaceFolder}',
              args: [],
              env: {},
            },
          ],
        }, null, 2);
        await api.files.mkdir?.(projectPath.replace(/[\\/]+$/, '') + '/.vscode');
        await api.files.write(launchPath, seed);
      }
    } catch (err) {
      pushConsole('error', `failed to ensure launch.json: ${err.message}`);
    }
    const open = window.PiPilot?.files?.openFile || window.PiPilot?.editor?.openFile;
    if (typeof open === 'function') { try { open(launchPath); } catch {} }
    setTimeout(loadLaunchJson, 600);
  }

  async function runEval(expression) {
    if (!state.session) {
      pushConsole('error', 'No active debug session.');
      return;
    }
    const frame = state.paused?.callFrames?.[state.activeFrame];
    const r = await api.debug.eval(state.session.id, expression, frame?.callFrameId);
    if (!r?.ok) { pushConsole('error', r?.error || 'eval failed'); return; }
    if (r.exceptionDetails) {
      pushConsole('error', r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'exception');
      return;
    }
    const v = r.result || {};
    pushConsole('result', v.description ?? (v.value === undefined ? 'undefined' : JSON.stringify(v.value)));
  }

  function setStatus(s) {
    ensurePanel();
    if (statusEl) {
      statusEl.textContent = s;
      statusEl.dataset.s = s;
    }
    const enabled = state.session != null;
    const paused = !!state.paused;
    setBtn('continue', enabled && paused);
    setBtn('stepOver', enabled && paused);
    setBtn('stepInto', enabled && paused);
    setBtn('stepOut',  enabled && paused);
    setBtn('pause',    enabled && !paused);
    setBtn('stop',     enabled);
    if (runBtn) runBtn.disabled = enabled;
  }
  function setBtn(act, on) {
    const b = panelEl?.querySelector(`[data-act="${act}"]`);
    if (b) b.disabled = !on;
  }

  function renderPanel() {
    ensurePanel();
    renderStack();
    renderScopes();
  }

  function renderStack() {
    if (!stackEl) return;
    const frames = state.paused?.callFrames || [];
    if (!frames.length) { stackEl.innerHTML = '<div class="dbg-empty">Not paused</div>'; return; }
    stackEl.innerHTML = frames.map((f, i) => `
      <div class="dbg-frame ${i === state.activeFrame ? 'active' : ''}" data-frame="${i}">
        <div class="dbg-frame-name">${escapeHtml(f.functionName)}</div>
        <div class="dbg-frame-loc">${escapeHtml(shortPath(f.filePath || f.url))}:${f.line}</div>
      </div>
    `).join('');
    stackEl.querySelectorAll('.dbg-frame').forEach((el) => {
      el.addEventListener('click', () => {
        state.activeFrame = +el.dataset.frame;
        const f = frames[state.activeFrame];
        if (f?.filePath) {
          const open = window.PiPilot?.files?.openFile || window.PiPilot?.editor?.openFile;
          if (typeof open === 'function') { try { open(f.filePath, { line: f.line }); } catch {} }
        }
        renderStack();
        renderScopes();
        setTimeout(refreshActiveLineMarker, 50);
      });
    });
  }

  async function renderScopes() {
    if (!scopesEl) return;
    const frame = state.paused?.callFrames?.[state.activeFrame];
    if (!frame) { scopesEl.innerHTML = '<div class="dbg-empty">No active frame</div>'; return; }
    const groups = (frame.scopeChain || []).filter(s => s.objectId);
    if (!groups.length) { scopesEl.innerHTML = '<div class="dbg-empty">No scopes</div>'; return; }
    scopesEl.innerHTML = groups.map((s, i) => `
      <details class="dbg-scope" ${i === 0 ? 'open' : ''} data-obj="${s.objectId}">
        <summary>${escapeHtml(s.type)}${s.name ? ' · ' + escapeHtml(s.name) : ''}</summary>
        <div class="dbg-scope-body" data-loaded="0"><div class="dbg-empty">Loading…</div></div>
      </details>
    `).join('');
    scopesEl.querySelectorAll('details.dbg-scope').forEach((d) => {
      d.addEventListener('toggle', () => loadScope(d));
      if (d.open) loadScope(d);
    });
  }

  async function loadScope(detailsEl) {
    if (!detailsEl.open) return;
    const body = detailsEl.querySelector('.dbg-scope-body');
    if (!body || body.dataset.loaded === '1') return;
    body.dataset.loaded = '1';
    const objectId = detailsEl.dataset.obj;
    const r = await api.debug.getProperties(state.session.id, objectId);
    if (!r?.ok) { body.innerHTML = `<div class="dbg-empty">${escapeHtml(r?.error || 'failed')}</div>`; return; }
    const props = (r.properties || []).filter(p => p.value);
    if (!props.length) { body.innerHTML = '<div class="dbg-empty">empty</div>'; return; }
    body.innerHTML = props.map((p) => `
      <div class="dbg-prop">
        <span class="dbg-prop-name">${escapeHtml(p.name)}</span>
        <span class="dbg-prop-val ${p.value.type}">${escapeHtml(formatValue(p.value))}</span>
      </div>
    `).join('');
  }

  function formatValue(v) {
    if (!v) return '';
    if (v.type === 'string') return JSON.stringify(v.value ?? v.description ?? '');
    if (v.type === 'undefined') return 'undefined';
    if (v.value !== undefined) return String(v.value);
    return v.description || v.type;
  }

  function pushConsole(level, text, raw = false) {
    ensurePanel();
    if (!consoleEl) return;
    const div = document.createElement('div');
    div.className = `dbg-line dbg-${level}`;
    if (raw) {
      div.textContent = text;
      div.style.whiteSpace = 'pre-wrap';
    } else {
      div.textContent = text;
    }
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    while (consoleEl.childElementCount > 800) consoleEl.removeChild(consoleEl.firstChild);
  }

  function shortPath(p) {
    if (!p) return '(anonymous)';
    const norm = String(p).replace(/\\/g, '/');
    const parts = norm.split('/');
    if (parts.length <= 3) return norm;
    return '…/' + parts.slice(-3).join('/');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function revealPanel() {
    ensurePanel();
    document.querySelectorAll('.bottom-tab').forEach(t => t.classList.toggle('active', t.dataset.bottom === 'debug'));
    document.querySelectorAll('.bottom-pane').forEach(p => p.classList.toggle('active', p.id === 'debug-pane'));
    document.getElementById('main-area')?.classList.remove('bottom-collapsed');
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'F5' && !e.shiftKey) {
      e.preventDefault();
      if (state.session && state.paused) api.debug.continue(state.session.id);
      else if (!state.session) startDebug();
    } else if (e.key === 'F5' && e.shiftKey) {
      e.preventDefault(); stopDebug();
    } else if (e.key === 'F10' && state.session && state.paused) {
      e.preventDefault(); api.debug.stepOver(state.session.id);
    } else if (e.key === 'F11' && state.session && state.paused) {
      e.preventDefault();
      if (e.shiftKey) api.debug.stepOut(state.session.id);
      else api.debug.stepInto(state.session.id);
    } else if (e.key === 'F9') {
      e.preventDefault();
      const editor = window.PiPilot?.editor?.getAce?.();
      const file = window.PiPilot?.editor?.getActiveFile?.();
      if (editor && file) {
        const row = editor.getCursorPosition().row;
        toggleBreakpoint(file, row + 1);
      }
    }
  });

  // ── Styles ──────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('debug-styles')) return;
    const st = document.createElement('style');
    st.id = 'debug-styles';
    st.textContent = `
      .ace_gutter-cell.dbg-breakpoint { position: relative; }
      .ace_gutter-cell.dbg-breakpoint::before {
        content: ''; position: absolute; left: 4px; top: 50%; transform: translateY(-50%);
        width: 9px; height: 9px; border-radius: 50%; background: #e5534b;
        box-shadow: 0 0 4px rgba(229,83,75,0.6);
      }
      .ace_marker-layer .dbg-active-line {
        position: absolute; z-index: 4;
        background: rgba(229,166,57,0.18);
        border-left: 3px solid #e5a639;
      }
      #debug-pane { display: none; flex-direction: column; height: 100%; min-height: 0; }
      #debug-pane.active { display: flex; }
      .dbg-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: 12px; }
      .dbg-toolbar {
        display: flex; align-items: center; gap: 4px; padding: 6px 10px;
        border-bottom: 1px solid var(--border); background: var(--surface); flex: 0 0 auto;
      }
      .dbg-btn {
        all: unset; cursor: pointer; padding: 3px 9px; font-size: 12px;
        color: var(--text-mid); border-radius: 4px; transition: background 120ms, color 120ms;
        font-variant-numeric: tabular-nums;
      }
      .dbg-btn:hover:not(:disabled) { background: var(--surface-alt); color: var(--text); }
      .dbg-btn:disabled { opacity: 0.35; cursor: default; }
      .dbg-btn-primary { color: var(--accent); font-weight: 600; }
      .dbg-btn-primary:hover:not(:disabled) { background: rgba(255,107,53,0.1); }
      .dbg-btn-stop { color: #e5534b; }
      .dbg-btn-stop:hover:not(:disabled) { background: rgba(229,83,75,0.12); }
      .dbg-btn-link { color: var(--text-dim); font-size: 13px; padding: 3px 6px; }
      .dbg-config-picker {
        background: var(--bg); color: var(--text); border: 1px solid var(--border);
        font-size: 11.5px; padding: 3px 8px; border-radius: 4px; margin-left: 4px;
        font-family: var(--font-sans); cursor: pointer; min-width: 130px;
      }
      .dbg-config-picker:focus { outline: none; border-color: var(--accent); }
      .dbg-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
      .dbg-status {
        margin-left: auto; font-size: 11px; color: var(--text-dim);
        padding: 2px 8px; border-radius: 999px; background: var(--surface-alt);
        text-transform: uppercase; letter-spacing: 0.04em; font-weight: 500;
      }
      .dbg-status[data-s="running"] { color: #56d364; }
      .dbg-status[data-s="paused"]  { color: #e5a639; }
      .dbg-status[data-s="starting"] { color: #6cb6ff; }
      .dbg-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px 280px 1fr; gap: 0; }
      .dbg-col { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); }
      .dbg-col:last-child { border-right: 0; }
      .dbg-col-h {
        padding: 5px 10px; font-size: 10.5px; color: var(--text-dim);
        text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
        border-bottom: 1px solid var(--border); background: var(--surface);
      }
      .dbg-list, .dbg-console { flex: 1; min-height: 0; overflow: auto; padding: 4px; }
      .dbg-empty { color: var(--text-dim); font-size: 11.5px; padding: 14px 12px; text-align: center; font-style: italic; }
      .dbg-frame { padding: 6px 10px; cursor: pointer; border-radius: 4px; }
      .dbg-frame:hover { background: var(--surface-alt); }
      .dbg-frame.active { background: rgba(255,107,53,0.12); border-left: 2px solid var(--accent); padding-left: 8px; }
      .dbg-frame-name { font-size: 12px; color: var(--text); font-weight: 500; }
      .dbg-frame-loc { font-size: 10.5px; color: var(--text-dim); margin-top: 1px; font-variant-numeric: tabular-nums; }
      .dbg-scope { padding: 2px 8px; }
      .dbg-scope summary {
        cursor: pointer; font-size: 11.5px; color: var(--text); font-weight: 500;
        padding: 4px 4px; list-style: none; user-select: none;
      }
      .dbg-scope summary::before {
        content: '▸'; display: inline-block; width: 12px; color: var(--text-dim);
        transition: transform 120ms;
      }
      .dbg-scope[open] summary::before { transform: rotate(90deg); }
      .dbg-scope-body { padding: 2px 0 6px 14px; }
      .dbg-prop { display: flex; gap: 8px; padding: 1px 4px; font-size: 11.5px; line-height: 1.5; }
      .dbg-prop-name { color: #b392f0; flex: 0 0 auto; }
      .dbg-prop-val { color: var(--text-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dbg-prop-val.string { color: #56d364; }
      .dbg-prop-val.number, .dbg-prop-val.boolean { color: #e5a639; }
      .dbg-prop-val.undefined, .dbg-prop-val.object { color: var(--text-dim); }
      .dbg-line { font-family: var(--font-mono, ui-monospace, Consolas, monospace); font-size: 11.5px; padding: 1px 6px; line-height: 1.55; }
      .dbg-line.dbg-error  { color: #e5534b; }
      .dbg-line.dbg-warn   { color: #e5a639; }
      .dbg-line.dbg-info   { color: #6cb6ff; }
      .dbg-line.dbg-eval   { color: var(--text-dim); }
      .dbg-line.dbg-eval::before { content: '› '; color: var(--accent); }
      .dbg-line.dbg-result { color: var(--text-strong); }
      .dbg-line.dbg-result::before { content: '‹ '; color: var(--text-dim); }
      .dbg-input-row {
        display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--border);
        background: var(--surface); flex: 0 0 auto;
      }
      .dbg-input {
        flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--border);
        color: var(--text); font: inherit; font-size: 11.5px; padding: 4px 8px;
        border-radius: 4px; font-family: var(--font-mono, ui-monospace, Consolas, monospace);
      }
      .dbg-input:focus { outline: none; border-color: var(--accent); }
      .dbg-btn-eval { background: var(--accent); color: #fff; padding: 4px 12px; }
      .dbg-btn-eval:hover { background: var(--accent); opacity: 0.9; }
    `;
    document.head.appendChild(st);
  }

  // Public API
  window.PiPilot.debug = {
    start: startDebug,
    stop: stopDebug,
    toggleBreakpoint,
    listBreakpoints: () => ({ ...state.breakpoints }),
    reveal: revealPanel,
  };
})();
