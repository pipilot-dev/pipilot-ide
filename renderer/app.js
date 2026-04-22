(() => {
  const { bus, state, api } = window.PiPilot;

  const LAYOUT_KEY = 'pipilot:layout';
  const LAST_PROJECT_KEY = 'pipilot:last-project';

  function basename(p) {
    if (!p) return '';
    const norm = String(p).replace(/[\\/]+$/, '');
    const parts = norm.split(/[\\/]/);
    return parts[parts.length - 1] || norm;
  }

  function sameProjectPath(a, b) {
    const na = String(a || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
    const nb = String(b || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
    return !!na && na === nb;
  }

  function saveLayout() {
    const root = $('#ide-root');
    if (!root) return;
    let prev = null;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) prev = JSON.parse(raw);
    } catch {}
    const chatCollapsed = root.classList.contains('chat-collapsed');
    const layout = {
      gridTemplateColumns: root.style.gridTemplateColumns || '',
      gridTemplateColumnsExpanded: (!chatCollapsed ? (root.style.gridTemplateColumns || '') : (prev?.gridTemplateColumnsExpanded || '')),
      bottomHeight: $('#bottom-panel')?.style.height || '',
      sideCollapsed: root.classList.contains('side-collapsed'),
      chatCollapsed,
      bottomCollapsed: $('#main-area')?.classList.contains('bottom-collapsed') || false,
      statusbarHidden: root.classList.contains('statusbar-hidden'),
      bottomRows: $('#main-area')?.style.gridTemplateRows || '',
    };
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
  }

  function restoreLayout() {
    const root = $('#ide-root');
    if (!root) return;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const layout = JSON.parse(raw);
      // Prefer restoring the expanded columns when chat is not collapsed.
      const cols = (!layout.chatCollapsed && layout.gridTemplateColumnsExpanded)
        ? layout.gridTemplateColumnsExpanded
        : layout.gridTemplateColumns;
      if (cols) root.style.gridTemplateColumns = cols;
      if (layout.bottomHeight) {
        const bp = $('#bottom-panel');
        const main = $('#main-area');
        if (bp && main) {
          main.style.gridTemplateRows = `auto auto 1fr 4px ${layout.bottomHeight}`;
        }
      }
      if (layout.sideCollapsed) root.classList.add('side-collapsed');
      if (layout.chatCollapsed) root.classList.add('chat-collapsed');
      if (layout.bottomCollapsed) $('#main-area')?.classList.add('bottom-collapsed');
      if (layout.statusbarHidden) root.classList.add('statusbar-hidden');
      if (layout.bottomRows) {
        const main = $('#main-area');
        if (main) main.style.gridTemplateRows = layout.bottomRows;
      }
    } catch {}
  }

  async function openProject(projectPath) {
    if (!projectPath) return;

    // Switching projects should clear old project state (tabs, sidebar, terminals, etc.).
    if (state.projectPath && !sameProjectPath(state.projectPath, projectPath)) {
      bus.emit('project:closed', { path: state.projectPath, name: state.projectName });
      state.openFiles = [];
      state.activeFile = null;
    }

    const name = basename(projectPath);
    state.projectPath = projectPath;
    state.projectName = name;

    $('#welcome-screen')?.classList.add('hidden');
    $('#ide-root')?.classList.remove('hidden');

    const nameEl = $('#project-name');
    if (nameEl) nameEl.textContent = name;

    try { await api.recentProjects.add({ path: projectPath, name }); } catch {}
    try { localStorage.setItem(LAST_PROJECT_KEY, projectPath); } catch {}

    restoreLayout();
    bus.emit('project:opened', { path: projectPath, name });
  }

  function closeProject() {
    const prev = { path: state.projectPath, name: state.projectName };
    state.projectPath = null;
    state.projectName = null;
    state.openFiles = [];
    state.activeFile = null;

    $('#ide-root')?.classList.add('hidden');
    $('#welcome-screen')?.classList.remove('hidden');

    try { localStorage.removeItem(LAST_PROJECT_KEY); } catch {}
    bus.emit('project:closed', prev);
  }

  window.PiPilot.openProject = openProject;
  window.PiPilot.closeProject = closeProject;

  function wireActivityBar() {
    const btns = $$('#activity-bar .activity-btn[data-panel]');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        if (panel === 'chat') {
          // Chat is a right-side panel; treat it like a toggle (same as Ctrl+I).
          bus.emit('menu:toggle-chat');
          return;
        }

        const root = $('#ide-root');
        const sideCollapsed = !!root?.classList.contains('side-collapsed');
        const wasActive = btn.classList.contains('active');

        // If clicking the active item while the sidebar is open, collapse the sidebar.
        if (wasActive && !sideCollapsed) {
          toggleSidebar();
          btns.forEach(b => b.classList.remove('active'));
          return;
        }

        // Otherwise, ensure sidebar is open and switch panels.
        if (sideCollapsed) toggleSidebar();
        btns.forEach(b => b.classList.toggle('active', b === btn));
        bus.emit('panel:switch', panel);
        saveLayout();
      });
    });

    $('#open-settings')?.addEventListener('click', () => bus.emit('modal:settings'));
  }

  // ── Activity badge: Source Control change count ───────────────────────
  let gitBadgeTimer = null;

  async function updateGitActivityBadge() {
    const badge = $('#git-activity-badge');
    if (!badge) return;

    if (!state.projectPath) {
      badge.textContent = '';
      badge.classList.add('hidden');
      return;
    }

    try {
      const r = await api.git.status(state.projectPath);
      if (!r || r.ok === false) throw new Error(r?.error || 'git status failed');
      const s = r.status || r;
      const files = Array.isArray(s.files) ? s.files : [];
      const count = files.length;
      if (count > 0) {
        badge.textContent = String(Math.min(count, 99));
        badge.classList.remove('hidden');
      } else {
        badge.textContent = '';
        badge.classList.add('hidden');
      }
    } catch {
      badge.textContent = '';
      badge.classList.add('hidden');
    }
  }

  function startGitBadgePolling() {
    if (gitBadgeTimer) return;
    updateGitActivityBadge();
    gitBadgeTimer = setInterval(updateGitActivityBadge, 4000);
  }

  function stopGitBadgePolling() {
    if (gitBadgeTimer) clearInterval(gitBadgeTimer);
    gitBadgeTimer = null;
    updateGitActivityBadge();
  }

  function revealChatPanel() {
    // Make sure the chat panel is visible (not hidden + not collapsed) and focus it.
    $('#chat-panel')?.classList.remove('hidden');
    $('#ide-root')?.classList.remove('chat-collapsed');
    saveLayout();
    window.PiPilot?.chat?.focus?.();
  }

  function wireProjectSwitcher() {
    const switcher = $('#project-switcher');
    if (!switcher) return;
    let dropdownOpen = false;
    let dropdownEl = null;

    function closeDropdown() {
      if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; }
      dropdownOpen = false;
    }

    async function showDropdown() {
      closeDropdown();
      dropdownOpen = true;

      dropdownEl = document.createElement('div');
      dropdownEl.style.cssText = 'position:absolute;top:100%;left:0;z-index:10000;min-width:280px;max-width:400px;max-height:360px;overflow-y:auto;background:var(--surface-raised,var(--surface));border:1px solid var(--border);border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,0.5);padding:4px 0;';

      // Header
      const hdr = document.createElement('div');
      hdr.style.cssText = 'padding:8px 12px;font-family:var(--font-mono);font-size:9px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;color:var(--text-dim);border-bottom:1px solid var(--border);';
      hdr.textContent = '// projects';
      dropdownEl.appendChild(hdr);

      // Current project
      if (state.projectPath) {
        const cur = document.createElement('div');
        cur.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:12px;color:var(--accent);border-bottom:1px solid var(--border);background:rgba(255,107,53,0.06);border-left:2px solid var(--accent);';
        cur.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(state.projectName || basename(state.projectPath))}</span>`;
        dropdownEl.appendChild(cur);
      }

      // Recent projects
      let recents = [];
      try { recents = (await api.recentProjects.get()) || []; } catch {}
      recents = recents.filter(r => r.path !== state.projectPath).slice(0, 8);

      if (recents.length) {
        recents.forEach(item => {
          const row = document.createElement('button');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;background:transparent;border:none;text-align:left;font-size:12px;color:var(--text);cursor:pointer;transition:background 0.1s;';
          const name = item.name || basename(item.path);
          row.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><div style="flex:1;min-width:0;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</div><div style="font-size:9px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.path)}</div></div>`;
          row.addEventListener('mouseenter', () => { row.style.background = 'var(--surface-alt)'; });
          row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
          row.addEventListener('click', () => { closeDropdown(); openProject(item.path); });
          dropdownEl.appendChild(row);
        });
      }

      // Separator
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
      dropdownEl.appendChild(sep);

      // Open folder
      const openBtn = document.createElement('button');
      openBtn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;background:transparent;border:none;text-align:left;font-size:12px;color:var(--info);cursor:pointer;transition:background 0.1s;';
      openBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Open Folder…';
      openBtn.addEventListener('mouseenter', () => { openBtn.style.background = 'var(--surface-alt)'; });
      openBtn.addEventListener('mouseleave', () => { openBtn.style.background = 'transparent'; });
      openBtn.addEventListener('click', async () => { closeDropdown(); try { const p = await api.pickFolder(); if (p) openProject(p); } catch {} });
      dropdownEl.appendChild(openBtn);

      // Close project
      const closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;background:transparent;border:none;text-align:left;font-size:12px;color:var(--error);cursor:pointer;transition:background 0.1s;';
      closeBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Close Project';
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(229,83,75,0.08)'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; });
      closeBtn.addEventListener('click', () => { closeDropdown(); closeProject(); });
      dropdownEl.appendChild(closeBtn);

      // Position relative to the switcher button
      switcher.style.position = 'relative';
      switcher.appendChild(dropdownEl);
    }

    switcher.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdownOpen) closeDropdown();
      else showDropdown();
    });

    document.addEventListener('click', (e) => {
      if (dropdownOpen && dropdownEl && !dropdownEl.contains(e.target) && !switcher.contains(e.target)) {
        closeDropdown();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdownOpen) closeDropdown();
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function wireBottomPanel() {
    const tabs = $$('.bottom-tab[data-bottom]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const key = tab.dataset.bottom;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        $$('.bottom-pane').forEach(p => {
          p.classList.toggle('active', p.id === `${key}-pane`);
        });
        $('#main-area')?.classList.remove('bottom-collapsed');
        saveLayout();
        bus.emit('bottom:switch', key);
      });
    });

    $('#bottom-close')?.addEventListener('click', () => {
      const main = $('#main-area');
      if (!main) return;
      main.style.gridTemplateRows = '';
      main.classList.add('bottom-collapsed');
      saveLayout();
    });

    $('#terminal-new')?.addEventListener('click', () => bus.emit('terminal:new'));
  }

  function toggleSidebar() {
    const root = $('#ide-root');
    if (!root) return;

    const wasCollapsed = root.classList.contains('side-collapsed');
    const chatCollapsed = root.classList.contains('chat-collapsed');

    const looksCollapsedCols = (cols) => {
      const c = String(cols || '');
      return c.startsWith('var(--activity-w) 0 0 1fr');
    };

    if (wasCollapsed) {
      // Expanding: restore last known expanded columns if we have them.
      let expanded = '';
      try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        if (raw) {
          const prev = JSON.parse(raw);
          expanded = prev?.gridTemplateColumnsSideExpanded || prev?.gridTemplateColumnsExpanded || prev?.gridTemplateColumns || '';
        }
      } catch {}

      // Guard: sometimes the stored value is actually a collapsed template.
      if (looksCollapsedCols(expanded)) expanded = '';

      root.classList.remove('side-collapsed');
      if (chatCollapsed) {
        // Keep chat collapsed; only restore the side panel columns.
        root.style.gridTemplateColumns = 'var(--activity-w) var(--side-panel-w) 4px 1fr 0 0';
      } else {
        if (expanded) root.style.gridTemplateColumns = expanded;
        else root.style.gridTemplateColumns = '';
      }
    } else {
      // Collapsing: preserve expanded sizes and explicitly zero out side columns.
      if (root.style.gridTemplateColumns && !looksCollapsedCols(root.style.gridTemplateColumns)) {
        try {
          const raw = localStorage.getItem(LAYOUT_KEY);
          const prev = raw ? JSON.parse(raw) : {};
          prev.gridTemplateColumnsSideExpanded = root.style.gridTemplateColumns;
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(prev));
        } catch {}
      }

      root.classList.add('side-collapsed');
      root.style.gridTemplateColumns = chatCollapsed
        ? 'var(--activity-w) 0 0 1fr 0 0'
        : 'var(--activity-w) 0 0 1fr 4px var(--chat-panel-w)';
    }

    saveLayout();
  }
  function toggleChat() {
    const root = $('#ide-root');
    if (!root) return;

    const wasCollapsed = root.classList.contains('chat-collapsed');
    console.log('[app] toggleChat, wasCollapsed=', wasCollapsed);

    if (wasCollapsed) {
      // EXPANDING — show chat panel
      root.classList.remove('chat-collapsed');
      // Force a known-good expanded grid (clears any stale inline style)
      const sideCollapsed = root.classList.contains('side-collapsed');
      root.style.gridTemplateColumns = sideCollapsed
        ? 'var(--activity-w) 0 0 1fr 4px var(--chat-panel-w)'
        : 'var(--activity-w) var(--side-panel-w) 4px 1fr 4px var(--chat-panel-w)';
    } else {
      // COLLAPSING — hide chat panel
      root.classList.add('chat-collapsed');
      const sideCollapsed = root.classList.contains('side-collapsed');
      root.style.gridTemplateColumns = sideCollapsed
        ? 'var(--activity-w) 0 0 1fr 0 0'
        : 'var(--activity-w) var(--side-panel-w) 4px 1fr 0 0';
    }

    saveLayout();
  }
  function toggleTerminal() {
    const main = $('#main-area');
    if (!main) return;
    const isCollapsed = main.classList.contains('bottom-collapsed');
    const termTab = $('.bottom-tab[data-bottom="terminal"]');
    const termActive = termTab?.classList.contains('active');
    const focusedInTerm = document.activeElement?.closest('#terminal-pane');

    if (isCollapsed) {
      // Closed → open on Terminal tab and focus it
      main.classList.remove('bottom-collapsed');
      termTab?.click();
      bus.emit('terminal:focus');
    } else if (!termActive) {
      // Open but on another tab → switch to Terminal and focus
      termTab?.click();
      bus.emit('terminal:focus');
    } else if (!focusedInTerm) {
      // Terminal tab active but focus elsewhere → focus terminal
      bus.emit('terminal:focus');
    } else {
      // Terminal open & focused → close
      main.style.gridTemplateRows = '';
      main.classList.add('bottom-collapsed');
    }
    saveLayout();
  }

  function toggleStatusbar() {
    $('#ide-root')?.classList.toggle('statusbar-hidden');
    saveLayout();
  }

  function setupVerticalResizer(el, which) {
    if (!el) return;
    let dragging = false;
    let startX = 0;
    let startCols = '';
    let startActivity = 0, startSide = 0, startChat = 0;

    const onDown = (e) => {
      dragging = true;
      startX = e.clientX;
      const root = $('#ide-root');
      if (!root) return;
      const cs = getComputedStyle(root);
      const cols = cs.gridTemplateColumns.split(' ').map(parseFloat);
      startActivity = cols[0];
      startSide = cols[1];
      startChat = cols[5];
      el.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const root = $('#ide-root');
      if (!root) return;
      const dx = e.clientX - startX;
      if (which === 'side') {
        const newSide = Math.max(160, Math.min(640, startSide + dx));
        root.style.gridTemplateColumns = `${startActivity}px ${newSide}px 4px 1fr 4px ${startChat}px`;
      } else {
        const newChat = Math.max(240, Math.min(720, startChat - dx));
        root.style.gridTemplateColumns = `${startActivity}px ${startSide}px 4px 1fr 4px ${newChat}px`;
      }
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      document.body.style.cursor = '';
      saveLayout();
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function setupHorizontalResizer(el) {
    if (!el) return;
    let dragging = false;
    let startY = 0;
    let startHeight = 0;

    const onDown = (e) => {
      dragging = true;
      startY = e.clientY;
      const bp = $('#bottom-panel');
      if (!bp) return;
      startHeight = bp.getBoundingClientRect().height;
      el.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const main = $('#main-area');
      if (!main) return;
      const dy = startY - e.clientY;
      const newH = Math.max(80, Math.min(700, startHeight + dy));
      main.style.gridTemplateRows = `auto auto 1fr 4px ${newH}px`;
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      document.body.style.cursor = '';
      saveLayout();
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function wireResizers() {
    setupVerticalResizer($('#resizer-side'), 'side');
    setupVerticalResizer($('#resizer-chat'), 'chat');
    setupHorizontalResizer($('#resizer-bottom'));
  }

  function wireMenuEvents() {
    if (!api || !api.onMenu) return;
    const map = {
      'open-folder': 'menu:file:open-folder',
      'new-file': 'menu:file:new-file',
      'save': 'menu:file:save',
      'save-all': 'menu:file:save-all',
      'toggle-sidebar': 'menu:view:toggle-sidebar',
      'toggle-terminal': 'menu:view:toggle-terminal',
      'toggle-chat': 'menu:view:toggle-chat',
    };
    for (const [evt, busEvt] of Object.entries(map)) {
      try { api.onMenu(evt, (...args) => bus.emit(busEvt, args[0])); } catch {}
    }
  }

  function wireBusHandlers() {
    bus.on('menu:view:toggle-sidebar', toggleSidebar);
    bus.on('menu:view:toggle-terminal', toggleTerminal);
    bus.on('menu:view:toggle-chat', toggleChat);
    bus.on('menu:view:toggle-statusbar', toggleStatusbar);

    // Mirror shortcut-style events (emitted by shortcuts.js + other modules)
    bus.on('menu:toggle-sidebar', toggleSidebar);
    bus.on('menu:toggle-terminal', toggleTerminal);
    bus.on('menu:toggle-chat', toggleChat);
    bus.on('menu:toggle-statusbar', toggleStatusbar);

    // Bottom-panel helpers — jump directly to a specific tab
    bus.on('bottom:show', (key) => {
      const main = $('#main-area');
      if (!main) return;
      main.classList.remove('bottom-collapsed');
      const tab = $(`.bottom-tab[data-bottom="${key}"]`);
      tab?.click();
      saveLayout();
    });
    bus.on('bottom:hide', () => {
      $('#main-area')?.classList.add('bottom-collapsed');
      saveLayout();
    });

    bus.on('menu:view:toggle-problems', () => bus.emit('bottom:show', 'problems'));
    bus.on('chat:reveal', revealChatPanel);
    bus.on('panel:switch', (panel) => {
      // Special activity-bar buttons that don't just change the sidebar.
      if (panel === 'chat') revealChatPanel();

      // Any normal panel switch should ensure the sidebar is visible.
      if (panel && panel !== 'chat') {
        const root = $('#ide-root');
        if (root?.classList.contains('side-collapsed')) toggleSidebar();
      }
    });
    bus.on('menu:view:zen', () => {
      const root = $('#ide-root');
      if (!root) return;
      const isZen = root.classList.toggle('side-collapsed');
      root.classList.toggle('chat-collapsed', isZen);
      root.classList.toggle('statusbar-hidden', isZen);
      $('#main-area')?.classList.toggle('bottom-collapsed', isZen);
      saveLayout();
    });

    // Auto Save toggle
    let autoSaveEnabled = true;
    let autoSaveTimer = null;
    // Set initial checkmark state
    bus.emit('menu:state:update', { key: 'menu:file:toggle-autosave', value: true });
    bus.on('menu:file:toggle-autosave', () => {
      autoSaveEnabled = !autoSaveEnabled;
      bus.emit('menu:state:update', { key: 'menu:file:toggle-autosave', value: autoSaveEnabled });
      bus.emit('toast:show', { type: 'ok', message: `Auto Save ${autoSaveEnabled ? 'enabled' : 'disabled'}` });
    });
    bus.on('editor:dirty-changed', ({ path, dirty }) => {
      if (!autoSaveEnabled || !dirty) return;
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        window.PiPilot?.editor?.saveFile?.(path);
      }, 1000);
    });

    bus.on('menu:file:open-folder', async () => {
      try {
        const p = await api.pickFolder();
        if (p) openProject(p);
      } catch {}
    });

    bus.on('menu:file:new-file', async () => {
      if (!state.projectPath) {
        bus.emit('toast:show', { type: 'info', message: 'Open a folder first' });
        return;
      }
      try {
        // Delegate to explorer module if present (keeps UI + validation consistent)
        if (window.PiPilot?.sidebar?.createEntry) {
          await window.PiPilot.sidebar.createEntry(state.projectPath, 'file');
          return;
        }

        const promptFn = window.PiPilot?.modal?.prompt
          ? (opts) => window.PiPilot.modal.prompt(opts)
          : async ({ title, label, defaultValue }) => window.prompt(title || label || 'Enter file name:', defaultValue || '');

        const name = await promptFn({
          title: 'New File',
          label: 'Enter file name',
          placeholder: 'file-name.txt',
        });
        if (!name || !String(name).trim()) return;

        const trimmed = String(name).trim();
        const target = state.projectPath + '/' + trimmed;
        await api.files.write(target, '');
        bus.emit('file:open', { path: target });
        bus.emit('toast:show', { type: 'ok', message: 'File created' });
      } catch (err) {
        bus.emit('toast:show', { type: 'error', message: 'Create failed: ' + (err?.message || err) });
      }
    });

    bus.on('menu:file:close-folder', () => closeProject());

    bus.on('project:opened', () => startGitBadgePolling());
    bus.on('project:closed', () => stopGitBadgePolling());

    // ── Search index: start on project open, show progress in status bar ──
    let removeIndexProgress = null;
    const indexStatusEl = document.getElementById('status-search-index');

    bus.on('project:opened', () => {
      if (!state.projectPath || !api.searchIndex) return;
      // Delay search indexing so tree + UI loads first (2s stagger)
      setTimeout(() => {
        if (state.projectPath) api.searchIndex.start(state.projectPath);
      }, 2000);

      if (removeIndexProgress) removeIndexProgress();
      if (indexStatusEl) {
        indexStatusEl.style.display = '';
        indexStatusEl.classList.add('indexing');
        const label = indexStatusEl.querySelector('.status-index-label');
        const bar = indexStatusEl.querySelector('.status-index-bar');
        if (label) label.textContent = 'Search: starting';
        if (bar) bar.style.width = '0%';
      }

      removeIndexProgress = api.searchIndex.onProgress((p) => {
        if (!indexStatusEl) return;
        const label = indexStatusEl.querySelector('.status-index-label');
        const bar = indexStatusEl.querySelector('.status-index-bar');

        if (p.phase === 'indexing') {
          indexStatusEl.style.display = '';
          indexStatusEl.classList.add('indexing');
          if (label) label.textContent = `Search: indexing ${p.pct}%`;
          if (bar) bar.style.width = `${p.pct}%`;
        } else if (p.phase === 'updating') {
          indexStatusEl.style.display = '';
          indexStatusEl.classList.add('indexing');
          if (label) label.textContent = `Search: updating ${p.filesProcessed}/${p.filesTotal}`;
          if (bar) bar.style.width = `${p.pct}%`;
        } else if (p.phase === 'ready') {
          indexStatusEl.classList.remove('indexing');
          if (label) label.textContent = 'Search: ready';
          if (bar) bar.style.width = '100%';
          indexStatusEl.style.display = '';
          bus.emit('toast:show', { type: 'ok', message: `Search index ready — ${p.filesTotal} files` });
          // Keep visible showing "ready" state
        }
      });
    });

    bus.on('project:closed', () => {
      if (removeIndexProgress) { removeIndexProgress(); removeIndexProgress = null; }
      if (indexStatusEl) indexStatusEl.style.display = 'none';
    });

    // Forward file change events to search index for live updates
    bus.on('file:external-change', (evt) => {
      if (state.projectPath && api.searchIndex && evt?.path) {
        api.searchIndex.fileChanged(state.projectPath, evt);
      }
    });

    // Best-effort: refresh badge after git panel operations.
    bus.on('panel:switch', (panel) => {
      if (panel === 'git') updateGitActivityBadge();
    });
  }

  async function boot() {
    wireActivityBar();
    wireProjectSwitcher();
    wireBottomPanel();
    wireResizers();
    wireMenuEvents();
    wireBusHandlers();

    let lastProject = null;
    try { lastProject = localStorage.getItem(LAST_PROJECT_KEY); } catch {}

    if (lastProject) {
      try {
        const stat = await api.files.stat(lastProject);
        if (stat && stat.exists !== false) {
          openProject(lastProject);
          return;
        }
      } catch {}
    }

    $('#ide-root')?.classList.add('hidden');
    $('#welcome-screen')?.classList.remove('hidden');
  }

  // ── Extension loader: load all enabled extensions on startup ──
  async function loadExtensions() {
    if (!api.extensions?.loadAll) return;
    try {
      const result = await api.extensions.loadAll();
      if (!result?.ok || !result.extensions?.length) return;
      for (const ext of result.extensions) {
        try {
          // Each extension gets its own scoped DB instance + all PiPilot APIs
          const db = window.PiPilot.extDB?.forExtension(ext.id) || null;
          const fn = new Function('PiPilot', 'bus', 'api', 'state', 'db', ext.code);
          fn(window.PiPilot, window.PiPilot.bus, window.electronAPI, window.PiPilot.state, db);
          console.log(`[extensions] Loaded: ${ext.manifest?.name || ext.id}`);
        } catch (err) {
          console.error(`[extensions] Failed to load ${ext.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[extensions] loadAll failed:', err);
    }
  }
  // Load extensions after a short delay so core modules are ready
  setTimeout(loadExtensions, 1000);

  // ── Global external link handler ──
  // All <a href="http(s)://..."> clicks open in default browser instead of Electron
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    // Only intercept external URLs (http/https)
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      window.electronAPI?.shell?.openExternal?.(href);
    }
  }, true); // capture phase

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
