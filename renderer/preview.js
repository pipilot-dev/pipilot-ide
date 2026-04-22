// PiPilot IDE — Preview Panel (opens as editor tab, like Vite's DevServerPreview)

(() => {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  const PREVIEW_TAB_ID = '__preview__';

  let currentServerId = null;
  let currentUrl = '';
  let serverStatus = 'idle';
  let serverPort = null;
  let history = [];
  let historyIdx = -1;
  let responsiveMode = 'desktop';
  let logUnsub = null;
  let pollTimer = null;
  let mountedContainer = null;
  let showConsole = false;
  let consoleEntries = []; // { level, text, source, time }

  function esc(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function openPreviewTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;

    editor.openVirtualTab({
      id: PREVIEW_TAB_ID,
      name: 'Preview',
      icon: '🌐',
      mount: (container) => {
        mountedContainer = container;
        container.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:var(--bg);';
        renderInto(container);
      },
    });
  }

  function renderInto(container) {
    if (!container) container = mountedContainer;
    if (!container) return;
    container.innerHTML = '';

    // ── Navbar ──
    const nav = document.createElement('div');
    nav.className = 'preview-nav';
    nav.innerHTML = `
      <button class="preview-nav-btn" id="prev-back" title="Back" ${historyIdx <= 0 ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button class="preview-nav-btn" id="prev-fwd" title="Forward" ${historyIdx >= history.length - 1 ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </button>
      <button class="preview-nav-btn" id="prev-refresh" title="Refresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/><path d="M21 3v6h-6"/></svg>
      </button>
      <input class="preview-url-bar" id="prev-url" type="text" value="${esc(currentUrl)}" placeholder="http://localhost:..." />
      ${serverPort ? `<span class="preview-port-badge">:${serverPort}</span>` : ''}
      <button class="preview-nav-btn" id="prev-copy" title="Copy URL">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="preview-nav-btn" id="prev-open" title="Open in browser">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
      </button>
      ${serverStatus === 'running' ? `<button class="preview-nav-btn preview-stop-btn" id="prev-stop" title="Stop server"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>` : ''}
      <button class="preview-nav-btn ${showConsole ? 'active' : ''}" id="prev-console-toggle" title="Toggle Console">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2"/><path d="M13 14h4"/></svg>
        ${consoleEntries.filter(e => e.level === 'error').length ? `<span class="preview-console-badge error">${consoleEntries.filter(e => e.level === 'error').length}</span>` : ''}
        ${!consoleEntries.filter(e => e.level === 'error').length && consoleEntries.filter(e => e.level === 'warn').length ? `<span class="preview-console-badge warn">${consoleEntries.filter(e => e.level === 'warn').length}</span>` : ''}
      </button>
    `;
    container.appendChild(nav);

    // ── Responsive toolbar ──
    if (serverStatus === 'running') {
      const toolbar = document.createElement('div');
      toolbar.className = 'preview-responsive-bar';
      ['desktop', 'tablet', 'mobile'].forEach(mode => {
        const icons = {
          desktop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
          tablet: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
          mobile: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
        };
        const btn = document.createElement('button');
        btn.className = 'preview-resp-btn' + (responsiveMode === mode ? ' active' : '');
        btn.title = mode.charAt(0).toUpperCase() + mode.slice(1);
        btn.innerHTML = icons[mode];
        btn.addEventListener('click', () => { responsiveMode = mode; renderInto(); });
        toolbar.appendChild(btn);
      });
      container.appendChild(toolbar);
    }

    // ── Content ──
    const content = document.createElement('div');
    content.className = 'preview-content';

    if ((serverStatus === 'idle' || serverStatus === 'stopped') && !currentUrl) {
      content.innerHTML = `
        <div class="preview-empty">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="0.8" opacity="0.4"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
          <p style="font-size:13px;color:var(--text-mid);">No preview running</p>
          <p style="font-size:11px;color:var(--text-dim);">Start the dev server, paste a URL, or open a local HTML file</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
            <button class="preview-start-btn" id="prev-start">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Start Dev Server
            </button>
            <button class="preview-start-btn" id="prev-open-file" style="background:var(--surface-alt);color:var(--text);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
              Open HTML File
            </button>
          </div>
        </div>`;
    } else if (serverStatus === 'installing') {
      content.innerHTML = `<div class="preview-empty"><div class="preview-spinner"></div><p style="color:var(--text-mid);font-size:12px;">Installing dependencies...</p></div>`;
    } else if (serverStatus === 'starting') {
      content.innerHTML = `<div class="preview-empty"><div class="preview-spinner"></div><p style="color:var(--text-mid);font-size:12px;">Starting dev server...</p></div>`;
    } else if (serverStatus === 'error') {
      content.innerHTML = `<div class="preview-empty"><p style="color:var(--error);font-size:12px;">Dev server failed to start</p><button class="preview-start-btn" id="prev-start"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/><path d="M21 3v6h-6"/></svg> Retry</button></div>`;
    } else if (currentUrl && (serverStatus === 'idle' || serverStatus === 'stopped')) {
      // Browsing mode: show any URL in iframe without a server
      const wrapper = document.createElement('div');
      wrapper.className = 'preview-iframe-wrap';
      wrapper.style.width = '100%';
      const iframe = document.createElement('iframe');
      iframe.className = 'preview-iframe';
      iframe.src = currentUrl;
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
      wrapper.appendChild(iframe);
      content.appendChild(wrapper);
    } else if (serverStatus === 'running' && currentUrl) {
      const widths = { desktop: '100%', tablet: '768px', mobile: '280px' };
      const wrapper = document.createElement('div');
      if (responsiveMode === 'mobile') {
        // Build realistic iPhone frame
        wrapper.className = 'preview-iphone-frame';
        wrapper.innerHTML = `
          <div class="iphone-notch"><div class="iphone-dynamic-island"></div></div>
          <div class="iphone-btn iphone-btn-power"></div>
          <div class="iphone-btn iphone-btn-vol-up"></div>
          <div class="iphone-btn iphone-btn-vol-down"></div>
          <div class="iphone-btn iphone-btn-silent"></div>
          <div class="iphone-screen"></div>
          <div class="iphone-home-bar"></div>
        `;
        const screen = wrapper.querySelector('.iphone-screen');
        const iframe = document.createElement('iframe');
        iframe.className = 'preview-iframe';
        iframe.src = currentUrl;
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
        screen.appendChild(iframe);
      } else {
        wrapper.className = 'preview-iframe-wrap';
        wrapper.style.width = widths[responsiveMode];
        const iframe = document.createElement('iframe');
        iframe.className = 'preview-iframe';
        iframe.src = currentUrl;
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
        wrapper.appendChild(iframe);
      }

      // Inject console hook into the iframe (whichever branch created it)
      const iframe = wrapper.querySelector('.preview-iframe');
      if (iframe) iframe.addEventListener('load', () => {
        try {
          const iframeWin = iframe.contentWindow;
          if (!iframeWin) return;
          const script = iframeWin.document.createElement('script');
          script.textContent = `
            (function() {
              var orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
              function hook(level) {
                return function() {
                  orig[level].apply(console, arguments);
                  try {
                    var text = Array.from(arguments).map(function(a) {
                      if (typeof a === 'string') return a;
                      try { return JSON.stringify(a); } catch { return String(a); }
                    }).join(' ');
                    window.parent.postMessage({ __pipilot_console: true, level: level, text: text }, '*');
                  } catch(e) {}
                };
              }
              console.log = hook('log');
              console.warn = hook('warn');
              console.error = hook('error');
              console.info = hook('info');
              window.addEventListener('error', function(e) {
                window.parent.postMessage({ __pipilot_console: true, level: 'error', text: e.message + ' at ' + (e.filename || '') + ':' + (e.lineno || '') }, '*');
              });
              window.addEventListener('unhandledrejection', function(e) {
                window.parent.postMessage({ __pipilot_console: true, level: 'error', text: 'Unhandled rejection: ' + (e.reason?.message || e.reason || '') }, '*');
              });
            })();
          `;
          iframeWin.document.head.appendChild(script);
        } catch (e) { /* cross-origin — can't inject */ }
      });

      content.appendChild(wrapper);
    }

    container.appendChild(content);

    // ── Console panel (below content) ──
    if (showConsole) {
      const consolePanel = document.createElement('div');
      consolePanel.className = 'preview-console';

      const consoleHeader = document.createElement('div');
      consoleHeader.className = 'preview-console-header';
      consoleHeader.innerHTML = `
        <span class="preview-console-title">Console</span>
        <span class="preview-console-counts">
          ${consoleEntries.filter(e => e.level === 'error').length ? `<span style="color:var(--error)">${consoleEntries.filter(e => e.level === 'error').length} errors</span>` : ''}
          ${consoleEntries.filter(e => e.level === 'warn').length ? `<span style="color:var(--warn)">${consoleEntries.filter(e => e.level === 'warn').length} warnings</span>` : ''}
        </span>
        <button class="preview-console-clear" id="prev-console-clear" title="Clear">Clear</button>
      `;
      consolePanel.appendChild(consoleHeader);

      const consoleBody = document.createElement('div');
      consoleBody.className = 'preview-console-body';
      if (!consoleEntries.length) {
        consoleBody.innerHTML = '<div class="preview-console-empty">No console output</div>';
      } else {
        for (const entry of consoleEntries) {
          const row = document.createElement('div');
          row.className = 'preview-console-entry preview-console-' + (entry.level || 'log');
          const time = entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
          row.innerHTML = `
            <span class="preview-console-time">${esc(time)}</span>
            <span class="preview-console-source">${esc(entry.source || '')}</span>
            <span class="preview-console-text">${esc(entry.text || '')}</span>
          `;
          consoleBody.appendChild(row);
        }
        // Auto-scroll to bottom
        requestAnimationFrame(() => { consoleBody.scrollTop = consoleBody.scrollHeight; });
      }
      consolePanel.appendChild(consoleBody);
      container.appendChild(consolePanel);

      container.querySelector('#prev-console-clear')?.addEventListener('click', () => {
        consoleEntries = [];
        renderInto();
      });
    }

    // ── Wire ──
    container.querySelector('#prev-start')?.addEventListener('click', startServer);
    container.querySelector('#prev-stop')?.addEventListener('click', stopServer);
    container.querySelector('#prev-open-file')?.addEventListener('click', async () => {
      try {
        const filePath = await api.pickFile?.({ filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
        if (filePath) {
          // Start static server for the directory containing the file
          const dir = filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
          const fileName = filePath.replace(/\\/g, '/').split('/').pop();
          const result = await api.devServer.startStatic(dir || state.projectPath);
          if (result?.ok) {
            isStaticServer = true;
            serverPort = result.port;
            serverStatus = 'running';
            navigateTo(`http://localhost:${result.port}/${fileName}`);
          } else {
            bus.emit('toast:show', { type: 'error', message: result?.error || 'Failed to start static server' });
          }
        }
      } catch (err) {
        bus.emit('toast:show', { type: 'error', message: 'Open failed: ' + (err?.message || err) });
      }
    });
    container.querySelector('#prev-console-toggle')?.addEventListener('click', () => {
      showConsole = !showConsole;
      renderInto();
    });
    container.querySelector('#prev-refresh')?.addEventListener('click', () => {
      const iframe = container.querySelector('.preview-iframe');
      if (iframe) { iframe.src = ''; setTimeout(() => { iframe.src = currentUrl; }, 50); }
    });
    container.querySelector('#prev-back')?.addEventListener('click', () => {
      if (historyIdx > 0) { historyIdx--; currentUrl = history[historyIdx]; renderInto(); }
    });
    container.querySelector('#prev-fwd')?.addEventListener('click', () => {
      if (historyIdx < history.length - 1) { historyIdx++; currentUrl = history[historyIdx]; renderInto(); }
    });
    container.querySelector('#prev-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigateTo(e.target.value);
    });
    container.querySelector('#prev-copy')?.addEventListener('click', () => {
      if (currentUrl) { navigator.clipboard.writeText(currentUrl); bus.emit('toast:show', { type: 'info', message: 'URL copied' }); }
    });
    container.querySelector('#prev-open')?.addEventListener('click', () => {
      if (currentUrl) api.shell?.openExternal?.(currentUrl);
    });
  }

  function navigateTo(url) {
    let u = (url || '').trim();
    if (!u) return;
    if (!u.startsWith('http')) u = 'http://' + u;
    currentUrl = u;
    history = history.slice(0, historyIdx + 1);
    history.push(u);
    historyIdx = history.length - 1;
    renderInto();
  }

  let projectType = null; // 'dev-server' | 'static' | 'none'
  let isStaticServer = false;

  async function startServer() {
    if (!state.projectPath) return;
    serverStatus = 'starting';
    renderInto();

    try {
      // Detect project type first
      const detected = await api.devServer.detectType(state.projectPath);
      projectType = detected?.type || 'none';

      if (projectType === 'none') {
        serverStatus = 'idle';
        renderInto();
        bus.emit('toast:show', { type: 'info', message: 'No index.html or dev script found — nothing to preview' });
        return;
      }

      if (projectType === 'static') {
        // Static project — use built-in HTTP server
        const result = await api.devServer.startStatic(state.projectPath);
        if (!result?.ok) {
          serverStatus = 'error'; renderInto();
          bus.emit('toast:show', { type: 'error', message: result?.error || 'Static server failed' });
          return;
        }
        isStaticServer = true;
        serverPort = result.port;
        serverStatus = 'running';
        navigateTo(result.url);
        bus.emit('toast:show', { type: 'ok', message: `Static preview on :${result.port}` });
        return;
      }

      // Dev server project — start the dev command
      const result = await api.devServer.start(state.projectPath);
      if (!result?.ok) { serverStatus = 'error'; renderInto(); return; }
      currentServerId = result.id;
      isStaticServer = false;
      let attempts = 0;
      pollTimer = setInterval(async () => {
        attempts++;
        try {
          const s = await api.devServer.status(currentServerId);
          if (s?.port || s?.server?.port) {
            clearInterval(pollTimer); pollTimer = null;
            serverPort = s.port || s.server?.port;
            serverStatus = 'running';
            navigateTo(`http://localhost:${serverPort}`);
            bus.emit('toast:show', { type: 'ok', message: `Dev server running on :${serverPort}` });
            if (logUnsub) try { logUnsub(); } catch {}
            try {
              logUnsub = api.devServer.onLog(currentServerId, (log) => {
                const level = (log.level || log.source === 'stderr') ? 'warn' : 'log';
                addConsoleEntry(level, log.text || log.data || '', 'server');
              });
            } catch {}
          } else if (s?.server?.status === 'installing' || s?.status === 'installing') {
            if (serverStatus !== 'installing') { serverStatus = 'installing'; renderInto(); }
          } else if (s?.server?.status === 'error' || s?.server?.status === 'exited' || s?.status === 'error') {
            clearInterval(pollTimer); pollTimer = null;
            serverStatus = 'error'; renderInto();
          } else if (attempts > 60) {
            clearInterval(pollTimer); pollTimer = null;
            serverStatus = 'error'; renderInto();
            bus.emit('toast:show', { type: 'error', message: 'Dev server timed out (2 min)' });
          }
        } catch {}
      }, 2000);
    } catch (err) {
      serverStatus = 'error'; renderInto();
      bus.emit('toast:show', { type: 'error', message: err?.message || 'Failed to start' });
    }
  }

  async function stopServer() {
    if (isStaticServer && state.projectPath) {
      try { await api.devServer.stopStatic(state.projectPath); } catch {}
    } else if (currentServerId) {
      try { await api.devServer.stop(currentServerId); } catch {}
    }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (logUnsub) try { logUnsub(); } catch {}
    serverStatus = 'stopped'; currentUrl = ''; serverPort = null;
    currentServerId = null; isStaticServer = false;
    renderInto();
  }

  // ── Status bar button ──
  function initStatusBarButton() {
    const statusRight = document.querySelector('.status-right');
    if (!statusRight) return;
    const btn = document.createElement('button');
    btn.className = 'status-item status-btn';
    btn.id = 'status-preview';
    btn.title = 'Open Preview';
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg> Preview`;
    btn.addEventListener('click', openPreviewTab);
    const encoding = statusRight.querySelector('#status-encoding');
    if (encoding) statusRight.insertBefore(btn, encoding);
    else statusRight.appendChild(btn);
  }

  // ── CSS ──
  function injectStyles() {
    if (document.getElementById('preview-styles')) return;
    const s = document.createElement('style');
    s.id = 'preview-styles';
    s.textContent = `
.preview-nav {
  display: flex; align-items: center; gap: 2px;
  padding: 4px 8px; height: 34px; box-sizing: border-box;
  background: var(--surface); border-bottom: 1px solid var(--border);
  -webkit-app-region: no-drag;
}
.preview-nav-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: none; border-radius: 4px;
  background: transparent; color: var(--text-mid); cursor: pointer; flex-shrink: 0;
}
.preview-nav-btn:hover { background: var(--surface-alt); color: var(--text); }
.preview-nav-btn:disabled { opacity: 0.3; cursor: default; pointer-events: none; }
.preview-stop-btn { color: var(--error); }
.preview-stop-btn:hover { background: rgba(229,72,77,0.1); }
.preview-url-bar {
  flex: 1; min-width: 0; padding: 4px 8px; font-size: 11px;
  font-family: var(--font-mono); background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 12px; outline: none;
  height: 24px; box-sizing: border-box;
}
.preview-url-bar:focus { border-color: var(--accent); }
.preview-port-badge {
  font-size: 10px; font-family: var(--font-mono); color: var(--accent);
  padding: 2px 6px; background: rgba(255,107,53,0.1); border-radius: 8px;
  flex-shrink: 0;
}
.preview-responsive-bar {
  display: flex; align-items: center; gap: 2px;
  padding: 2px 8px; height: 26px; box-sizing: border-box;
  background: var(--bg); border-bottom: 1px solid var(--border);
}
.preview-resp-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 22px; border: 1px solid transparent; border-radius: 3px;
  background: transparent; color: var(--text-dim); cursor: pointer;
}
.preview-resp-btn:hover { background: var(--surface-alt); color: var(--text); }
.preview-resp-btn.active { background: var(--surface-alt); color: var(--accent); border-color: var(--accent); }
.preview-content {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 0; overflow: auto;
  background: #1a1a1a;
}
.preview-empty {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  color: var(--text-dim); font-size: 12px; padding: 40px;
}
.preview-start-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 20px; font-size: 12px; font-weight: 500;
  background: var(--accent); color: white; border: none;
  border-radius: 6px; cursor: pointer; transition: filter 0.15s;
}
.preview-start-btn:hover { filter: brightness(1.15); }
.preview-spinner {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--accent);
  animation: prev-spin 0.8s linear infinite;
}
@keyframes prev-spin { to { transform: rotate(360deg); } }
.preview-iframe-wrap {
  margin: 0 auto; height: 100%; position: relative;
  background: white; overflow: hidden;
}
.preview-iframe {
  width: 100%; height: 100%; border: none; background: white;
}
/* Realistic iPhone frame */
.preview-iphone-frame {
  position: relative; width: 280px; margin: 8px auto;
  background: #1a1a1e;
  border: 2px solid #3a3a40;
  border-radius: 44px;
  padding: 6px 8px 10px;
  box-shadow:
    0 0 0 1px #0a0a0c,
    0 12px 48px rgba(0,0,0,0.6),
    inset 0 0 0 1px rgba(255,255,255,0.05),
    inset 0 1px 0 rgba(255,255,255,0.08);
  height: calc(100% - 16px);
  display: flex; flex-direction: column;
}
/* Dynamic Island */
.iphone-notch {
  display: flex; justify-content: center; padding: 3px 0 3px; z-index: 2;
}
.iphone-dynamic-island {
  width: 72px; height: 16px; background: #000;
  border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06);
}
/* Side buttons */
.iphone-btn {
  position: absolute; background: #2a2a2e; border-radius: 2px;
}
.iphone-btn-power {
  right: -4px; top: 100px; width: 3px; height: 56px;
  border-radius: 0 2px 2px 0;
  box-shadow: 1px 0 2px rgba(0,0,0,0.4);
}
.iphone-btn-vol-up {
  left: -4px; top: 80px; width: 3px; height: 28px;
  border-radius: 2px 0 0 2px;
  box-shadow: -1px 0 2px rgba(0,0,0,0.4);
}
.iphone-btn-vol-down {
  left: -4px; top: 116px; width: 3px; height: 28px;
  border-radius: 2px 0 0 2px;
  box-shadow: -1px 0 2px rgba(0,0,0,0.4);
}
.iphone-btn-silent {
  left: -4px; top: 56px; width: 3px; height: 16px;
  border-radius: 2px 0 0 2px;
  box-shadow: -1px 0 2px rgba(0,0,0,0.4);
}
/* Screen */
.iphone-screen {
  flex: 1; min-height: 0; overflow: hidden;
  border-radius: 32px; background: #000;
  position: relative;
}
.iphone-screen .preview-iframe {
  width: 100%; height: 100%; border: none;
  border-radius: 32px; background: white;
}
/* Home indicator bar */
.iphone-home-bar {
  display: flex; justify-content: center; padding: 6px 0 2px;
}
.iphone-home-bar::after {
  content: ''; display: block;
  width: 96px; height: 4px; background: #555;
  border-radius: 2px;
}
#status-preview { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
#status-preview:hover { color: var(--accent); }
/* Console panel */
.preview-console {
  border-top: 1px solid var(--border); background: var(--bg);
  display: flex; flex-direction: column; min-height: 120px; max-height: 240px;
}
.preview-console-header {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px; background: var(--surface);
  border-bottom: 1px solid var(--border); font-size: 10px;
}
.preview-console-title {
  font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-mid); font-size: 10px;
}
.preview-console-counts { display: flex; gap: 8px; font-size: 10px; flex: 1; }
.preview-console-clear {
  background: transparent; border: none; color: var(--text-dim);
  font-size: 10px; cursor: pointer; padding: 2px 6px; border-radius: 3px;
}
.preview-console-clear:hover { background: var(--surface-alt); color: var(--text); }
.preview-console-body {
  flex: 1; overflow-y: auto; font-family: var(--font-mono);
  font-size: 11px; padding: 4px 0;
}
.preview-console-empty { padding: 12px; color: var(--text-dim); text-align: center; font-size: 11px; }
.preview-console-entry {
  display: flex; gap: 8px; padding: 2px 10px; line-height: 1.5;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.preview-console-entry:hover { background: rgba(255,255,255,0.02); }
.preview-console-time { color: var(--text-dim); flex-shrink: 0; width: 60px; font-size: 10px; }
.preview-console-source { color: var(--text-dim); flex-shrink: 0; width: 48px; font-size: 9px; text-transform: uppercase; }
.preview-console-text { flex: 1; min-width: 0; word-break: break-word; color: var(--text); }
.preview-console-warn .preview-console-text { color: var(--warn); }
.preview-console-error .preview-console-text { color: var(--error); }
.preview-console-info .preview-console-text { color: var(--info); }
/* Console badge on toggle button */
.preview-console-badge {
  position: absolute; top: 2px; right: 2px;
  min-width: 12px; height: 12px; padding: 0 3px;
  font-size: 8px; font-weight: 700; line-height: 12px; text-align: center;
  border-radius: 6px; color: white;
}
.preview-console-badge.error { background: var(--error); }
.preview-console-badge.warn { background: var(--warn); }
.preview-nav-btn { position: relative; } /* for badge positioning */
.preview-nav-btn.active { background: var(--surface-alt); color: var(--accent); }
    `;
    document.head.appendChild(s);
  }

  // ── Init ──
  function addConsoleEntry(level, text, source) {
    consoleEntries.push({ level, text, source, time: Date.now() });
    if (consoleEntries.length > 500) consoleEntries = consoleEntries.slice(-400);
    // Update badge without full re-render (just the badge + console if open)
    if (mountedContainer) {
      const badge = mountedContainer.querySelector('#prev-console-toggle');
      if (badge) {
        const errs = consoleEntries.filter(e => e.level === 'error').length;
        const warns = consoleEntries.filter(e => e.level === 'warn').length;
        const existing = badge.querySelector('.preview-console-badge');
        if (existing) existing.remove();
        if (errs) badge.insertAdjacentHTML('beforeend', `<span class="preview-console-badge error">${errs}</span>`);
        else if (warns) badge.insertAdjacentHTML('beforeend', `<span class="preview-console-badge warn">${warns}</span>`);
      }
      // If console is open, append the new entry
      if (showConsole) {
        const body = mountedContainer.querySelector('.preview-console-body');
        if (body) {
          const empty = body.querySelector('.preview-console-empty');
          if (empty) empty.remove();
          const entry = consoleEntries[consoleEntries.length - 1];
          const row = document.createElement('div');
          row.className = 'preview-console-entry preview-console-' + (entry.level || 'log');
          const time = new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          row.innerHTML = `<span class="preview-console-time">${esc(time)}</span><span class="preview-console-source">${esc(entry.source || '')}</span><span class="preview-console-text">${esc(entry.text || '')}</span>`;
          body.appendChild(row);
          body.scrollTop = body.scrollHeight;
        }
      }
    }
  }

  // Listen for iframe console messages
  window.addEventListener('message', (e) => {
    if (e.data?.__pipilot_console) {
      addConsoleEntry(e.data.level || 'log', e.data.text || '', 'runtime');
    }
  });

  function init() {
    injectStyles();
    initStatusBarButton();

    bus.on('devserver:start', () => { openPreviewTab(); if (serverStatus !== 'running') startServer(); });

    // Open a URL in the preview tab (from terminal localhost detection)
    bus.on('devserver:open-url', (url) => {
      openPreviewTab();
      serverStatus = 'running';
      const portMatch = url.match(/:(\d+)/);
      if (portMatch) serverPort = parseInt(portMatch[1]);
      navigateTo(url);
    });
    bus.on('devserver:stop', stopServer);
    bus.on('devserver:restart', async () => { await stopServer(); startServer(); });

    bus.on('project:opened', async () => {
      serverStatus = 'idle'; currentUrl = ''; serverPort = null;
      try {
        const list = await api.devServer.list();
        if (list?.length) {
          for (const s of list) {
            if (s.port && s.status === 'running') {
              currentServerId = s.id; serverPort = s.port; serverStatus = 'running';
              currentUrl = `http://localhost:${s.port}`;
              history = [currentUrl]; historyIdx = 0;
              break;
            }
          }
        }
      } catch {}
    });

    bus.on('project:closed', stopServer);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
