(() => {
  const { bus } = window.PiPilot;

  const MENUS = {
    file: [
      { label: 'Open Folder…', shortcut: 'Ctrl+O', event: 'menu:file:open-folder' },
      { label: 'Clone Repo…', event: 'modal:clone-repo' },
      { label: 'New File', shortcut: 'Ctrl+N', event: 'menu:file:new-file' },
      { label: 'New Window', disabled: true },
      { separator: true },
      { label: 'Save', shortcut: 'Ctrl+S', event: 'menu:file:save' },
      { label: 'Save All', shortcut: 'Ctrl+Shift+S', event: 'menu:file:save-all' },
      { separator: true },
      { label: 'Auto Save', event: 'menu:file:toggle-autosave' },
      { separator: true },
      { label: 'Close Folder', event: 'menu:file:close-folder' },
    ],
    edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', event: 'menu:edit:undo' },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', event: 'menu:edit:redo' },
      { separator: true },
      { label: 'Cut', shortcut: 'Ctrl+X', event: 'menu:edit:cut' },
      { label: 'Copy', shortcut: 'Ctrl+C', event: 'menu:edit:copy' },
      { label: 'Paste', shortcut: 'Ctrl+V', event: 'menu:edit:paste' },
      { separator: true },
      { label: 'Find', shortcut: 'Ctrl+F', disabled: true },
      { label: 'Replace', shortcut: 'Ctrl+H', event: 'menu:edit:replace' },
    ],
    view: [
      { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', event: 'menu:view:toggle-sidebar' },
      { label: 'Toggle Terminal', shortcut: 'Ctrl+`', event: 'menu:view:toggle-terminal' },
      { label: 'Toggle Chat', shortcut: 'Ctrl+I', event: 'menu:view:toggle-chat' },
      { label: 'Toggle Problems', shortcut: 'Ctrl+Shift+M', event: 'menu:view:toggle-problems' },
      { label: 'Toggle Status Bar', event: 'menu:view:toggle-statusbar' },
      { label: 'Command Palette', shortcut: 'Ctrl+Shift+P', disabled: true },
      { separator: true },
      { label: 'Zen Mode', event: 'menu:view:zen' },
    ],
    go: [
      { label: 'Go to File…', shortcut: 'Ctrl+P', event: 'menu:go:file' },
      { label: 'Go to Line…', shortcut: 'Ctrl+G', event: 'menu:go:line' },
      { label: 'Go to Symbol…', shortcut: 'Ctrl+Shift+O', event: 'menu:go:symbol' },
    ],
    run: [
      { label: 'Start Dev Server', event: 'devserver:start' },
      { label: 'Stop', event: 'devserver:stop' },
      { label: 'Restart', event: 'devserver:restart' },
    ],
    help: [
      { label: 'Welcome', event: 'menu:help:welcome' },
      { label: 'Get Started', event: 'menu:help:getting-started' },
      { separator: true },
      { label: 'Documentation', event: 'menu:help:docs' },
      { label: 'Keyboard Shortcuts', event: 'menu:help:shortcuts' },
      { label: 'About', event: 'menu:help:about' },
    ],
  };

  let openMenuKey = null;
  let openMenuButton = null;

  // Toggle states for checkable menu items
  const toggleStates = {};
  bus.on('menu:state:update', ({ key, value }) => { toggleStates[key] = value; });

  function closeDropdown() {
    const root = $('#menu-dropdown-root');
    if (root) root.innerHTML = '';
    openMenuKey = null;
    if (openMenuButton) openMenuButton.classList.remove('open');
    openMenuButton = null;
  }

  function renderDropdown(key, button) {
    const items = MENUS[key];
    if (!items) return;
    closeDropdown();

    const root = $('#menu-dropdown-root');
    if (!root) return;

    const rect = button.getBoundingClientRect();
    const dropdown = h('div', { class: 'menu-dropdown', style: { top: `${rect.bottom + 2}px`, left: `${rect.left}px` } });

    for (const item of items) {
      if (item.separator) {
        dropdown.appendChild(h('div', { class: 'menu-dropdown-separator' }));
        continue;
      }
      const row = h(
        'div',
        {
          class: 'menu-dropdown-item' + (item.disabled ? ' disabled' : ''),
          onclick: () => {
            if (item.disabled) return;
            closeDropdown();
            if (item.event) bus.emit(item.event);
          },
        },
        h('span', { class: 'menu-dropdown-item-icon' }, item.event && toggleStates[item.event] ? '✓' : (item.icon || '')),
        h('span', { class: 'menu-dropdown-item-label' }, item.label),
        item.shortcut ? h('span', { class: 'menu-dropdown-item-shortcut' }, item.shortcut) : null
      );
      dropdown.appendChild(row);
    }

    root.appendChild(dropdown);
    openMenuKey = key;
    openMenuButton = button;
    button.classList.add('open');
  }

  function onMenuItemClick(e) {
    const btn = e.currentTarget;
    const key = btn.dataset.menu;
    if (openMenuKey === key) {
      closeDropdown();
    } else {
      renderDropdown(key, btn);
    }
  }

  function onMenuItemHover(e) {
    if (openMenuKey == null) return;
    const btn = e.currentTarget;
    const key = btn.dataset.menu;
    if (key !== openMenuKey) renderDropdown(key, btn);
  }

  function onDocClick(e) {
    if (openMenuKey == null) return;
    if (e.target.closest('.menu-dropdown')) return;
    if (e.target.closest('.menu-item[data-menu]')) return;
    closeDropdown();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && openMenuKey != null) {
      closeDropdown();
      e.stopPropagation();
    }
  }

  function init() {
    const items = $$('.menu-item[data-menu]');
    items.forEach(btn => {
      btn.addEventListener('click', onMenuItemClick);
      btn.addEventListener('mouseenter', onMenuItemHover);
    });
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKeyDown);

    // Window controls (frameless window)
    const api = window.electronAPI;
    $('#win-minimize')?.addEventListener('click', () => api?.window?.minimize());
    $('#win-maximize')?.addEventListener('click', () => api?.window?.maximize());
    $('#win-close')?.addEventListener('click', () => api?.window?.close());

    // Chat panel toggle in titlebar
    const chatToggle = document.getElementById('titlebar-chat-toggle');
    if (chatToggle) {
      chatToggle.addEventListener('click', () => {
        console.log('[titlebar] chat toggle clicked');
        bus.emit('menu:view:toggle-chat');
        // Sync icon after a tick (let the handler run)
        setTimeout(() => {
          const root = document.getElementById('ide-root');
          if (root) chatToggle.classList.toggle('active', !root.classList.contains('chat-collapsed'));
        }, 50);
      });
      // Sync icon state whenever class changes on ide-root
      const ideRoot = document.getElementById('ide-root');
      if (ideRoot) {
        new MutationObserver(() => {
          chatToggle.classList.toggle('active', !ideRoot.classList.contains('chat-collapsed'));
        }).observe(ideRoot, { attributes: true, attributeFilter: ['class'] });
        chatToggle.classList.toggle('active', !ideRoot.classList.contains('chat-collapsed'));
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
