// PiPilot IDE — Context menu (Phase 6)
(function () {
  const bus = window.PiPilot?.bus;

  function ensureStyles() {
    if (document.getElementById('contextmenu-styles')) return;
    const style = document.createElement('style');
    style.id = 'contextmenu-styles';
    style.textContent = `
      .context-menu {
        position: fixed;
        min-width: 200px;
        max-width: 320px;
        padding: var(--space-1);
        background: var(--surface-raised);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow-lg);
        z-index: 1100;
        display: flex;
        flex-direction: column;
        gap: 1px;
        animation: context-menu-in 0.1s ease-out;
      }
      @keyframes context-menu-in {
        from { opacity: 0; transform: translateY(-2px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .context-menu-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 6px 10px;
        font-size: var(--fs-sm);
        color: var(--text);
        border-radius: var(--radius-sm);
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }
      .context-menu-item.focus,
      .context-menu-item:hover:not(.disabled) {
        background: var(--accent);
        color: #1a1a1a;
      }
      .context-menu-item.disabled {
        color: var(--text-dim);
        cursor: default;
        pointer-events: none;
      }
      .context-menu-item.danger { color: var(--error); }
      .context-menu-item.danger.focus,
      .context-menu-item.danger:hover:not(.disabled) {
        background: var(--error);
        color: #fff;
      }
      .context-menu-item-icon {
        width: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-dim);
        flex-shrink: 0;
      }
      .context-menu-item.focus .context-menu-item-icon,
      .context-menu-item:hover .context-menu-item-icon { color: inherit; }
      .context-menu-item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
      .context-menu-item-shortcut {
        font-size: var(--fs-xs);
        color: var(--text-dim);
        font-family: var(--font-mono);
        margin-left: var(--space-4);
      }
      .context-menu-item.focus .context-menu-item-shortcut,
      .context-menu-item:hover .context-menu-item-shortcut { color: inherit; opacity: 0.8; }
      .context-menu-separator {
        height: 1px;
        background: var(--border);
        margin: var(--space-1) 2px;
      }
    `;
    document.head.appendChild(style);
  }

  let current = null;

  function getRoot() {
    let root = document.getElementById('context-menu-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'context-menu-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function hide() {
    if (!current) return;
    const prev = current;
    current = null;
    try { prev.onClose && prev.onClose(); } catch (e) { console.error(e); }
    prev.el.remove();
    document.removeEventListener('mousedown', prev.outside, true);
    document.removeEventListener('keydown', prev.onKey, true);
    window.removeEventListener('blur', prev.hide);
    window.removeEventListener('resize', prev.hide);
  }

  function show({ x = 0, y = 0, items = [], onClose } = {}) {
    ensureStyles();
    hide();
    const root = getRoot();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');

    const interactiveIndices = [];

    items.forEach((item, idx) => {
      if (!item) return;
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        return;
      }
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      if (item.disabled) el.classList.add('disabled');
      if (item.danger) el.classList.add('danger');
      el.setAttribute('role', 'menuitem');
      el.dataset.index = String(idx);

      const iconEl = document.createElement('span');
      iconEl.className = 'context-menu-item-icon';
      iconEl.textContent = item.icon || '';
      el.appendChild(iconEl);

      const label = document.createElement('span');
      label.className = 'context-menu-item-label';
      label.textContent = item.label || '';
      el.appendChild(label);

      if (item.shortcut) {
        const sc = document.createElement('span');
        sc.className = 'context-menu-item-shortcut';
        sc.textContent = item.shortcut;
        el.appendChild(sc);
      }

      if (!item.disabled) {
        interactiveIndices.push(idx);
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          try { item.onClick && item.onClick(e); } catch (err) { console.error(err); }
          hide();
        });
        el.addEventListener('mouseenter', () => setFocus(idx));
      }

      menu.appendChild(el);
    });

    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.visibility = 'hidden';
    root.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    let left = x;
    let top = y;
    if (left + rect.width > vw - margin) left = Math.max(margin, vw - rect.width - margin);
    if (top + rect.height > vh - margin) top = Math.max(margin, vh - rect.height - margin);
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = 'visible';

    let focusIndex = -1;
    function setFocus(idx) {
      focusIndex = idx;
      menu.querySelectorAll('.context-menu-item').forEach(n => n.classList.remove('focus'));
      if (idx < 0) return;
      const el = menu.querySelector(`.context-menu-item[data-index="${idx}"]`);
      if (el) el.classList.add('focus');
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); hide(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!interactiveIndices.length) return;
        const cur = interactiveIndices.indexOf(focusIndex);
        const next = interactiveIndices[(cur + 1) % interactiveIndices.length];
        setFocus(next);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!interactiveIndices.length) return;
        const cur = interactiveIndices.indexOf(focusIndex);
        const prev = interactiveIndices[(cur - 1 + interactiveIndices.length) % interactiveIndices.length];
        setFocus(prev);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (focusIndex < 0) return;
        const item = items[focusIndex];
        if (item && !item.disabled) {
          e.preventDefault();
          try { item.onClick && item.onClick(e); } catch (err) { console.error(err); }
          hide();
        }
      }
    }

    function outside(e) {
      if (!menu.contains(e.target)) hide();
    }

    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);

    current = { el: menu, onClose, outside, onKey, hide };
    return { hide };
  }

  // Block native browser context menu globally so right-clicks only show our menu.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.contextMenu = { show, hide };

  if (bus) {
    bus.on('contextmenu:show', (payload) => {
      if (!payload) return;
      show(payload);
    });
    bus.on('contextmenu:hide', hide);
  }
})();
