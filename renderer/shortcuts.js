// PiPilot IDE — Global keyboard shortcuts (Phase 6)

(function () {
  const bus = window.PiPilot.bus;
  const api = window.electronAPI;

  let isMac = false;
  api.getPlatform().then(p => { isMac = p === 'darwin'; });

  function normalizeKey(e) {
    const parts = [];
    if (e.metaKey) parts.push('meta');
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    let k = e.key.toLowerCase();
    if (k === ' ') k = 'space';
    if (k === 'control' || k === 'meta' || k === 'shift' || k === 'alt') return null;
    parts.push(k);
    return parts.join('+');
  }

  function matchSpec(spec, e) {
    const want = spec.toLowerCase();
    const want2 = want.replace('mod', isMac ? 'meta' : 'ctrl');
    const got = normalizeKey(e);
    if (!got) return false;
    return got === want2;
  }

  const registry = [];

  function register(key, handler, opts = {}) {
    registry.push({ key, handler, opts });
    return () => {
      const idx = registry.findIndex(r => r.key === key && r.handler === handler);
      if (idx >= 0) registry.splice(idx, 1);
    };
  }

  function isInMonaco(target) {
    if (!target) return false;
    let el = target;
    while (el) {
      if (el.classList && el.classList.contains('monaco-editor')) return true;
      el = el.parentElement;
    }
    return false;
  }

  // Shortcuts that always fire (even from Monaco)
  const ALWAYS_FIRE = new Set([
    'mod+s', 'mod+shift+s',
    'mod+`', 'mod+b', 'mod+i',
    'mod+,', 'mod+shift+f', 'mod+shift+g', 'mod+shift+e', 'mod+shift+x',
    'mod+p', 'mod+shift+p', 'esc',
  ]);

  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const inMonaco = isInMonaco(target);
    for (const { key, handler } of registry) {
      if (matchSpec(key, e)) {
        if (inMonaco && !ALWAYS_FIRE.has(key.toLowerCase())) continue;
        e.preventDefault();
        try { handler(e); } catch (err) { console.error('shortcut handler error', err); }
        return;
      }
    }
  });

  // Default shortcuts
  async function openFolderShortcut() {
    const p = await api.pickFolder();
    if (p) window.PiPilot.openProject?.(p);
  }

  function closeActiveTab() {
    const ed = window.PiPilot.editor;
    const f = ed && ed.getActiveFile && ed.getActiveFile();
    if (f && ed.closeFile) ed.closeFile(f.path || f);
  }

  register('mod+s', () => bus.emit('menu:save'));
  register('mod+shift+s', () => bus.emit('menu:save-all'));
  register('mod+o', openFolderShortcut);
  register('mod+n', () => bus.emit('menu:new-file'));
  register('mod+w', closeActiveTab);
  register('mod+p', () => bus.emit('palette:quick-open'));
  register('mod+shift+p', () => bus.emit('palette:command'));
  register('mod+`', () => bus.emit('menu:toggle-terminal'));
  register('mod+b', () => bus.emit('menu:toggle-sidebar'));
  register('mod+i', () => { bus.emit('menu:toggle-chat'); window.PiPilot.chat?.focus(); });
  register('mod+enter', () => bus.emit('chat:send'));
  register('mod+,', () => bus.emit('modal:settings'));
  register('mod+shift+f', () => bus.emit('panel:switch', 'search'));
  register('mod+shift+g', () => bus.emit('panel:switch', 'git'));
  register('mod+shift+e', () => bus.emit('panel:switch', 'explorer'));
  register('mod+shift+x', () => bus.emit('panel:switch', 'extensions'));
  register('mod+shift+m', () => bus.emit('bottom:show', 'problems'));
  register('mod+j', () => bus.emit('menu:toggle-terminal'));
  register('esc', () => bus.emit('shortcut:escape'));

  bus.on('shortcuts:help', () => {
    const list = [
      ['Save', 'Mod+S'],
      ['Save All', 'Mod+Shift+S'],
      ['Open Folder', 'Mod+O'],
      ['New File', 'Mod+N'],
      ['Close Tab', 'Mod+W'],
      ['Quick Open', 'Mod+P'],
      ['Command Palette', 'Mod+Shift+P'],
      ['Toggle Terminal', 'Mod+`'],
      ['Toggle Sidebar', 'Mod+B'],
      ['Toggle / Focus Chat', 'Mod+I'],
      ['Send Chat Message', 'Mod+Enter'],
      ['Settings', 'Mod+,'],
      ['Search in Files', 'Mod+Shift+F'],
      ['Source Control', 'Mod+Shift+G'],
      ['Explorer', 'Mod+Shift+E'],
      ['Extensions', 'Mod+Shift+X'],
    ];
    if (window.PiPilot.modal?.show) {
      const card = document.createElement('div');
      card.innerHTML = `
        <h2 style="font-size:var(--fs-lg);color:var(--text-strong);margin-bottom:12px;">Keyboard Shortcuts</h2>
        <table style="width:100%;font-size:var(--fs-sm);border-collapse:collapse;">
          ${list.map(([n, k]) => `<tr>
            <td style="padding:4px 8px;border-bottom:1px solid var(--border);">${n}</td>
            <td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;"><kbd>${k.replace('Mod', isMac ? '⌘' : 'Ctrl')}</kbd></td>
          </tr>`).join('')}
        </table>`;
      window.PiPilot.modal.show(card, { title: 'Keyboard Shortcuts', width: 480 });
    }
  });

  window.PiPilot.shortcuts = {
    register,
    list() { return registry.slice(); },
  };
})();
