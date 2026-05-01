(() => {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  const XTERM_JS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js';
  const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';
  const FIT_JS = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js';
  const LINKS_JS = 'https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js';

  // Per-theme xterm palettes. ANSI colors are theme-authentic; the rest
  // (background, foreground, cursor, selection) get derived from CSS vars
  // at apply-time so a custom theme without an entry here still looks right.
  const ANSI_BY_THEME = {
    'midnight': {
      black: '#16161a', red: '#e5534b', green: '#56d364', yellow: '#e5a639',
      blue: '#6cb6ff',  magenta: '#d2a8ff', cyan: '#76e4f7', white: '#b0b0b8',
      brightBlack: '#42424a', brightRed: '#ff6e66', brightGreen: '#7ee787',
      brightYellow: '#ffc060', brightBlue: '#9ecbff', brightMagenta: '#e2c8ff',
      brightCyan: '#9aedfe', brightWhite: '#d9d9de',
    },
    'carbon': {
      black: '#0d0f12', red: '#ff5b5b', green: '#55e0a4', yellow: '#ffaa33',
      blue: '#7fb6ff',  magenta: '#c792ea', cyan: '#00d8ff', white: '#c0c5cc',
      brightBlack: '#404550', brightRed: '#ff7878', brightGreen: '#7eecbb',
      brightYellow: '#ffc15c', brightBlue: '#a3cbff', brightMagenta: '#dab0f4',
      brightCyan: '#5fe6ff', brightWhite: '#e6eaf0',
    },
    'dracula': {
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9',  magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
    'github-dark': {
      black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff',  magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
      brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
    },
    'solarized-dark': {
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2',  magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
      brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
    'solarized-light': {
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2',  magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
      brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  };

  function readVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch { return fallback; }
  }
  function rgbaWithAlpha(hex, alpha) {
    const m = /^#?([a-f0-9]{6})$/i.exec(hex || '');
    if (!m) return `rgba(255,107,53,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function paletteForTheme(themeId) {
    const ansi = ANSI_BY_THEME[themeId] || ANSI_BY_THEME.midnight;
    const bg     = readVar('--bg',          '#16161a');
    const fg     = readVar('--text',        '#b0b0b8');
    const accent = readVar('--accent',      '#FF6B35');
    return {
      background: bg,
      foreground: fg,
      cursor: accent,
      cursorAccent: bg,
      selectionBackground: rgbaWithAlpha(accent, 0.3),
      ...ansi,
    };
  }

  // Live mutable palette — replaced when theme changes; new terminals
  // grab the current value, existing terminals get pushed to.
  let THEME = paletteForTheme(document.documentElement.getAttribute('data-theme') || 'midnight');

  let cssInjected = false;
  let libPromise = null;
  let profilesPromise = null;
  let selectedProfileId = null;

  const terminals = [];
  let activeId = null;
  let host = null;
  let tabsEl = null;
  let stackEl = null;
  let profilePickerEl = null;
  let profilePickerBtn = null;
  let initialized = false;

  function injectCss() {
    if (cssInjected) return;
    if (!document.querySelector(`link[href="${XTERM_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = XTERM_CSS;
      document.head.appendChild(link);
    }
    if (!document.getElementById('terminal-inline-styles')) {
      const st = document.createElement('style');
      st.id = 'terminal-inline-styles';
      st.textContent = `
        .terminal-root { display: flex; flex-direction: column; height: 100%; width: 100%; background: #16161a; position: relative; }
        .terminal-inner-tabs { display: flex; align-items: center; height: 28px; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 var(--space-2); gap: var(--space-1); overflow-x: auto; }
        .terminal-inner-tabs.hidden { display: none; }
        .term-tab { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: var(--radius-sm); font-size: var(--fs-xs); color: var(--text-mid); cursor: pointer; white-space: nowrap; border: 1px solid transparent; }
        .term-tab:hover { background: var(--surface-alt); color: var(--text); }
        .term-tab.active { background: var(--surface-raised); color: var(--text-strong); border-color: var(--border); }
        .term-tab .close { opacity: 0.6; font-size: 13px; line-height: 1; padding: 0 2px; border-radius: 3px; }
        .term-tab .close:hover { opacity: 1; background: var(--border-hover); }
        .terminal-stack { flex: 1; position: relative; min-height: 0; }
        .xterm-host { position: absolute; inset: 0; padding: 0; background: #16161a; display: none; overflow: hidden; }
        .xterm-host.active { display: block; }
        .xterm-host .xterm { height: 100% !important; width: 100% !important; padding: 6px 8px; box-sizing: border-box; }
        .xterm-host .xterm-viewport, .xterm-host .xterm-screen { height: 100% !important; width: 100% !important; }
        .xterm-host .xterm-viewport { background-color: #16161a !important; }
        .terminal-profile-picker { position: absolute; top: 2px; right: 6px; z-index: 4; }
        .terminal-profile-picker button { font-size: var(--fs-xs); color: var(--text-mid); background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 2px 8px; height: 22px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
        .terminal-profile-picker button:hover { color: var(--text); background: var(--surface-raised); }
        .terminal-profile-menu { position: absolute; top: 26px; right: 0; min-width: 180px; background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 4px; display: none; flex-direction: column; gap: 1px; z-index: 10; }
        .terminal-profile-menu.open { display: flex; }
        .terminal-profile-menu .item { text-align: left; padding: 6px 10px; border-radius: var(--radius-sm); font-size: var(--fs-sm); color: var(--text); cursor: pointer; }
        .terminal-profile-menu .item:hover { background: var(--surface-alt); }
        .terminal-profile-menu .item.checked { color: var(--accent); }
        .terminal-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: var(--fs-sm); }
      `;
      document.head.appendChild(st);
    }
    cssInjected = true;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', reject);
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.dataset.src = src;
      el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve(); });
      el.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
      document.head.appendChild(el);
    });
  }

  function loadLibs() {
    if (libPromise) return libPromise;
    injectCss();
    libPromise = loadScript(XTERM_JS)
      .then(() => Promise.all([loadScript(FIT_JS), loadScript(LINKS_JS)]))
      .then(() => {
        if (!window.Terminal) throw new Error('Terminal global not available');
        return true;
      });
    return libPromise;
  }

  function ensureHost() {
    if (host) return host;
    host = document.getElementById('terminal-pane');
    if (!host) return null;
    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'terminal-root';

    tabsEl = document.createElement('div');
    tabsEl.className = 'terminal-inner-tabs hidden';

    stackEl = document.createElement('div');
    stackEl.className = 'terminal-stack';
    const empty = document.createElement('div');
    empty.className = 'terminal-empty';
    empty.textContent = 'No terminal session';
    empty.dataset.empty = '1';
    stackEl.appendChild(empty);

    profilePickerEl = document.createElement('div');
    profilePickerEl.className = 'terminal-profile-picker';
    profilePickerBtn = document.createElement('button');
    profilePickerBtn.type = 'button';
    profilePickerBtn.title = 'Select shell for new terminals';
    profilePickerBtn.innerHTML = '<span class="lbl">Shell</span><span class="chev">▾</span>';
    const menu = document.createElement('div');
    menu.className = 'terminal-profile-menu';
    profilePickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
      if (menu.classList.contains('open')) populateProfileMenu(menu);
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    profilePickerEl.appendChild(profilePickerBtn);
    profilePickerEl.appendChild(menu);

    root.appendChild(tabsEl);
    root.appendChild(stackEl);
    root.appendChild(profilePickerEl);
    host.appendChild(root);
    return host;
  }

  async function getProfiles() {
    if (!profilesPromise) {
      profilesPromise = api.terminal.profiles().catch(err => {
        console.error('[terminal] profiles failed', err);
        return [];
      });
    }
    return profilesPromise;
  }

  async function populateProfileMenu(menu) {
    menu.innerHTML = '<div class="item" data-loading="1" style="color:var(--text-dim)">Loading…</div>';
    const profiles = await getProfiles();
    menu.innerHTML = '';
    if (!profiles.length) {
      const empty = document.createElement('div');
      empty.className = 'item';
      empty.textContent = 'No shells detected';
      menu.appendChild(empty);
      return;
    }
    const currentId = selectedProfileId || (profiles.find(p => p.default)?.id) || profiles[0].id;
    for (const p of profiles) {
      const item = document.createElement('div');
      item.className = 'item' + (p.id === currentId ? ' checked' : '');
      item.textContent = p.name + (p.default ? ' (default)' : '');
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedProfileId = p.id;
        updateProfileLabel(p.name);
        menu.classList.remove('open');
        createNew({ profileId: p.id });
      });
      menu.appendChild(item);
    }
  }

  function updateProfileLabel(name) {
    if (!profilePickerBtn) return;
    const lbl = profilePickerBtn.querySelector('.lbl');
    if (lbl) lbl.textContent = name || 'Shell';
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    if (terminals.length <= 1) {
      tabsEl.classList.add('hidden');
      return;
    }
    tabsEl.classList.remove('hidden');
    terminals.forEach((t) => {
      const tab = document.createElement('div');
      tab.className = 'term-tab' + (t.id === activeId ? ' active' : '');
      tab.title = t.profileName + ' — pid ' + (t.pid || '?');
      const lbl = document.createElement('span');
      lbl.textContent = t.profileName;
      tab.appendChild(lbl);
      const close = document.createElement('span');
      close.className = 'close';
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTerminal(t.id);
      });
      tab.appendChild(close);
      tab.addEventListener('click', () => setActive(t.id));
      tabsEl.appendChild(tab);
    });
  }

  function setActive(id) {
    activeId = id;
    for (const t of terminals) {
      t.div.classList.toggle('active', t.id === id);
    }
    renderTabs();
    const active = terminals.find(t => t.id === id);
    if (active) {
      requestAnimationFrame(() => {
        try { active.fit.fit(); } catch {}
        try { active.term.focus(); } catch {}
        try { api.terminal.resize(active.id, active.term.cols, active.term.rows); } catch {}
      });
    }
  }

  function removeEmptyPlaceholder() {
    if (!stackEl) return;
    const empty = stackEl.querySelector('[data-empty="1"]');
    if (empty) empty.remove();
  }

  function addEmptyPlaceholderIfNone() {
    if (!stackEl || terminals.length) return;
    if (stackEl.querySelector('[data-empty="1"]')) return;
    const empty = document.createElement('div');
    empty.className = 'terminal-empty';
    empty.textContent = 'No terminal session';
    empty.dataset.empty = '1';
    stackEl.appendChild(empty);
  }

  async function createNew(opts = {}) {
    ensureHost();
    if (!host) return null;
    try {
      await loadLibs();
    } catch (err) {
      console.error('[terminal] failed to load xterm', err);
      return null;
    }
    const { Terminal } = window;
    const FitAddon = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
    const WebLinksAddon = (window.WebLinksAddon && window.WebLinksAddon.WebLinksAddon) || window.WebLinksAddon;

    const div = document.createElement('div');
    div.className = 'xterm-host';
    removeEmptyPlaceholder();
    stackEl.appendChild(div);

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, Cascadia Code, monospace',
      fontSize: state.settings?.terminalFontSize || 13,
      theme: THEME,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    try {
      term.loadAddon(new WebLinksAddon((e, url) => {
        e.preventDefault();
        window.electronAPI?.shell?.openExternal?.(url);
      }));
    } catch {}
    term.open(div);
    try { fit.fit(); } catch {}

    const cwd = opts.cwd || state.projectPath || undefined;
    const profileId = opts.profileId || selectedProfileId || state.settings?.terminalProfile || undefined;

    let created;
    try {
      created = await api.terminal.create({
        profileId,
        cwd,
        cols: term.cols,
        rows: term.rows,
      });
    } catch (err) {
      console.error('[terminal] create failed', err);
      term.write(`\r\n\x1b[31m[Failed to create terminal: ${String(err && err.message || err)}]\x1b[0m\r\n`);
      return null;
    }

    const profiles = await getProfiles();
    const profile = profiles.find(p => p.id === created.profileId) || { name: created.profileId || 'shell' };

    const entry = {
      id: created.id,
      pid: created.pid,
      profileId: created.profileId,
      profileName: profile.name || 'shell',
      term, fit, div,
      dataOff: null, exitOff: null, disposeData: null,
      resizeObserver: null,
      destroyed: false,
    };

    const writeClipboard = async (text) => {
      try {
        if (api?.clipboard?.writeText) api.clipboard.writeText(text);
        else if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      } catch {}
    };
    const readClipboard = async () => {
      try {
        if (api?.clipboard?.readText) return api.clipboard.readText();
        if (navigator?.clipboard?.readText) return await navigator.clipboard.readText();
      } catch {}
      return '';
    };

    const doCopySelection = async () => {
      try {
        const sel = term.getSelection?.() || '';
        const text = String(sel || '').replace(/\r\n/g, '\n');
        if (text) await writeClipboard(text);
      } catch {}
    };
    const doPaste = async () => {
      const text = await readClipboard();
      if (!text) return;
      try { api.terminal.write(created.id, text); } catch {}
    };

    // Keyboard shortcuts: VS Code-like behavior.
    try {
      term.attachCustomKeyEventHandler((ev) => {
        const key = (ev.key || '').toLowerCase();
        const ctrlOrMeta = !!(ev.ctrlKey || ev.metaKey);

        // Copy selection: Ctrl+C only when there is a selection; otherwise allow SIGINT.
        if (ctrlOrMeta && key === 'c') {
          if (term.hasSelection && term.hasSelection()) {
            doCopySelection();
            return false;
          }
          return true;
        }

        // Paste: Ctrl+V or Shift+Insert
        if ((ctrlOrMeta && key === 'v') || (ev.shiftKey && ev.key === 'Insert')) {
          doPaste();
          return false;
        }

        return true;
      });
    } catch {}

    // Context menu (right click): Copy/Paste.
    try {
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hasSel = !!(term.hasSelection && term.hasSelection());
        const items = [
          ...(hasSel ? [{ label: 'Copy', icon: '⎘', action: () => doCopySelection() }] : []),
          { label: 'Paste', icon: '⎀', action: () => doPaste() },
        ];
        bus.emit('contextmenu:show', { x: e.clientX, y: e.clientY, items, target: { kind: 'terminal', id: created.id } });
      });
    } catch {}

    // Detect localhost URLs in terminal output and show "Open in Preview" button
    let urlBanner = null;
    const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))[^\s\x1b]*/g;

    function showPreviewBanner(url) {
      if (urlBanner && urlBanner.dataset.url === url) return;
      if (urlBanner) urlBanner.remove();
      urlBanner = document.createElement('div');
      urlBanner.className = 'terminal-preview-banner';
      urlBanner.dataset.url = url;
      urlBanner.innerHTML = `
        <span class="terminal-preview-url">${url.replace(/</g, '&lt;')}</span>
        <button class="terminal-preview-btn" data-action="preview">Open in Preview</button>
        <button class="terminal-preview-btn secondary" data-action="browser">Open in Browser</button>
        <button class="terminal-preview-close">&times;</button>
      `;
      urlBanner.querySelector('[data-action="preview"]').addEventListener('click', () => {
        bus.emit('devserver:open-url', url);
      });
      urlBanner.querySelector('[data-action="browser"]').addEventListener('click', () => {
        window.electronAPI?.shell?.openExternal?.(url);
      });
      urlBanner.querySelector('.terminal-preview-close').addEventListener('click', () => {
        urlBanner.remove(); urlBanner = null;
      });
      div.style.position = 'relative';
      div.appendChild(urlBanner);
    }

    entry.dataOff = api.terminal.onData(created.id, (data) => {
      try { term.write(data); } catch {}
      // Check for localhost URLs
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // strip ANSI codes
      const matches = clean.match(URL_RE);
      if (matches) showPreviewBanner(matches[matches.length - 1]);
    });
    entry.exitOff = api.terminal.onExit(created.id, (code) => {
      try { term.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`); } catch {}
    });
    entry.disposeData = term.onData((data) => {
      if (entry.destroyed) return;
      api.terminal.write(created.id, data);
    });

    const applyFit = () => {
      if (entry.destroyed) return;
      try {
        fit.fit();
        api.terminal.resize(created.id, term.cols, term.rows);
      } catch {}
    };
    const debouncedFit = window.PiPilot.debounce(applyFit, 60);

    try {
      entry.resizeObserver = new ResizeObserver(() => debouncedFit());
      entry.resizeObserver.observe(div);
    } catch {}
    window.addEventListener('resize', debouncedFit);
    entry._winResize = debouncedFit;

    terminals.push(entry);
    setActive(entry.id);
    if (!selectedProfileId) selectedProfileId = entry.profileId;
    updateProfileLabel(entry.profileName);
    bus.emit('terminal:created', { id: entry.id, profileId: entry.profileId });

    return entry;
  }

  // Live-apply terminalFontSize changes from Settings to every open terminal.
  bus.on('settings:changed', (p) => {
    if (!p || p.key !== 'terminalFontSize') return;
    const size = Number(p.value) || 13;
    for (const entry of terminals) {
      try { entry.term.options.fontSize = size; entry.fit && entry.fit.fit && entry.fit.fit(); } catch {}
    }
  });

  // Live-apply theme changes — recolor the xterm palette + xterm host bg.
  bus.on('theme:applied', (p) => {
    THEME = paletteForTheme(p?.id || 'midnight');
    for (const entry of terminals) {
      try { entry.term.options.theme = THEME; } catch {}
      try { if (entry.div) entry.div.style.background = THEME.background; } catch {}
    }
    // Update the host shell's hardcoded bg in the inline style block too,
    // so the gap around terminals matches the theme.
    const styleEl = document.getElementById('terminal-inline-styles');
    if (styleEl) {
      const bg = THEME.background;
      styleEl.textContent = styleEl.textContent
        .replace(/background:\s*#16161a/g, `background: ${bg}`)
        .replace(/background-color:\s*#16161a/g, `background-color: ${bg}`);
    }
  });

  function closeTerminal(id) {
    const idx = terminals.findIndex(t => t.id === id);
    if (idx < 0) return;
    const entry = terminals[idx];
    entry.destroyed = true;
    try { entry.dataOff && entry.dataOff(); } catch {}
    try { entry.exitOff && entry.exitOff(); } catch {}
    try { entry.disposeData && entry.disposeData.dispose && entry.disposeData.dispose(); } catch {}
    try { entry.resizeObserver && entry.resizeObserver.disconnect(); } catch {}
    try { window.removeEventListener('resize', entry._winResize); } catch {}
    try { api.terminal.destroy(id); } catch {}
    try { entry.term.dispose(); } catch {}
    try { entry.div.remove(); } catch {}
    terminals.splice(idx, 1);
    if (activeId === id) {
      const next = terminals[idx] || terminals[idx - 1] || terminals[0];
      activeId = next ? next.id : null;
    }
    if (!terminals.length) {
      addEmptyPlaceholderIfNone();
      renderTabs();
    } else {
      setActive(activeId);
    }
    bus.emit('terminal:closed', { id });
  }

  function closeActive() {
    if (activeId) closeTerminal(activeId);
  }

  function closeAll() {
    // Copy list since closeTerminal mutates terminals
    const ids = terminals.map(t => t.id);
    ids.forEach(id => closeTerminal(id));
  }

  function getActive() {
    return terminals.find(t => t.id === activeId) || null;
  }

  function list() {
    return terminals.map(t => ({ id: t.id, pid: t.pid, profileId: t.profileId, profileName: t.profileName, active: t.id === activeId }));
  }

  function activateTerminalTab() {
    const panel = document.getElementById('bottom-panel');
    if (panel && panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
    }
    document.querySelectorAll('.bottom-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bottom === 'terminal');
    });
    document.querySelectorAll('.bottom-pane').forEach(p => {
      p.classList.toggle('active', p.id === 'terminal-pane');
    });
    const active = getActive();
    if (active) {
      requestAnimationFrame(() => {
        try { active.fit.fit(); } catch {}
        try { active.term.focus(); } catch {}
      });
    }
  }

  function toggleTerminalPanel() {
    const panel = document.getElementById('bottom-panel');
    if (!panel) return;
    const hidden = panel.classList.contains('hidden');
    const isTerminalTabActive = document.querySelector('.bottom-tab.active')?.dataset.bottom === 'terminal';
    if (hidden || !isTerminalTabActive) {
      panel.classList.remove('hidden');
      activateTerminalTab();
      if (!terminals.length) createNew();
    } else {
      panel.classList.add('hidden');
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    ensureHost();

    // Global copy/paste fallback for the terminal:
    // - Ctrl+C copies selection if present; otherwise let shell receive SIGINT.
    // - Ctrl+V / Shift+Insert paste clipboard.
    // Only intercept when the terminal itself (or its container) has focus.
    document.addEventListener('keydown', async (e) => {
      const active = getActive();
      if (!active) return;
      const terminalTabActive = document.querySelector('.bottom-tab.active')?.dataset.bottom === 'terminal';
      if (!terminalTabActive) return;

      // Only handle copy/paste when focus is inside the terminal panel itself
      const termPanel = document.getElementById('terminal-pane');
      if (!termPanel || !termPanel.contains(document.activeElement)) return;

      const ctrlOrMeta = !!(e.ctrlKey || e.metaKey);
      const key = String(e.key || '').toLowerCase();

      if (ctrlOrMeta && key === 'c') {
        try {
          if (active.term?.hasSelection && active.term.hasSelection()) {
            const text = active.term.getSelection?.() || '';
            if (text) {
              try { api?.clipboard?.writeText?.(text); } catch {}
              e.preventDefault();
              e.stopPropagation();
            }
          }
        } catch {}
        return;
      }

      if ((ctrlOrMeta && key === 'v') || (e.shiftKey && e.key === 'Insert')) {
        try {
          const clip = (api?.clipboard?.readText ? api.clipboard.readText() : (navigator?.clipboard?.readText ? await navigator.clipboard.readText() : ''));
          if (clip) {
            api.terminal.write(active.id, clip);
            e.preventDefault();
            e.stopPropagation();
          }
        } catch {}
      }
    }, true);

    getProfiles().then(profiles => {
      const def = profiles.find(p => p.default) || profiles[0];
      if (def) {
        selectedProfileId = def.id;
        updateProfileLabel(def.name);
      }
    });

    const newBtn = document.getElementById('terminal-new');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        activateTerminalTab();
        createNew();
      });
    }

    bus.on('project:opened', ({ path } = {}) => {
      // Switching projects: kill any running terminals and create a fresh one in the new cwd.
      closeAll();
      createNew({ cwd: path || state.projectPath || undefined });
    });
    bus.on('project:closed', () => {
      // Ensure processes don't linger if a project is closed.
      closeAll();
    });
    bus.on('terminal:new', (opts) => createNew(opts || {}));
    bus.on('menu:toggle-terminal', () => toggleTerminalPanel());
    bus.on('panel:switch:bottom', (which) => {
      if (which === 'terminal') {
        const active = getActive();
        if (active) {
          requestAnimationFrame(() => {
            try { active.fit.fit(); } catch {}
            try { active.term.focus(); } catch {}
          });
        } else if (state.projectPath) {
          createNew();
        }
      }
    });

    if (state.projectPath && !terminals.length) {
      createNew();
    }
  }

  window.PiPilot.terminal = {
    createNew,
    closeActive,
    closeAll,
    getActive,
    list,
    toggle: toggleTerminalPanel,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
