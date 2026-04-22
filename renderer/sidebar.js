// PiPilot IDE — Sidebar (file explorer, search, placeholders)

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;
  const debounce = window.PiPilot.debounce;

  const root = document.getElementById('side-panel-inner');
  if (!root) return;

  let activePanel = 'explorer';
  let treeData = null;
  let expanded = new Set();
  let filterText = '';
  let watchDispose = null;
  let isLinked = false;

  // Multi-select state
  const selectedPaths = new Set();
  let lastClickedPath = null;
  let allVisiblePaths = []; // flat list for shift-click range select

  const refresh = debounce(async () => {
    await loadTree();
    if (activePanel === 'explorer') renderExplorer();
  }, 200);

  function basename(p) {
    if (!p) return '';
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  function extOf(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  const ICON_COLORS = {
    js: '#f1dd35', jsx: '#f1dd35', mjs: '#f1dd35', cjs: '#f1dd35',
    ts: '#3178c6', tsx: '#3178c6',
    json: '#cbcb41', jsonc: '#cbcb41',
    md: '#6cb6ff', mdx: '#6cb6ff',
    css: '#6cb6ff', scss: '#cf649a', sass: '#cf649a', less: '#1d365d',
    html: '#e34c26', htm: '#e34c26',
    py: '#3572a5', go: '#00add8', rs: '#dea584',
    rb: '#cc342d', php: '#787cb5',
    java: '#b07219', kt: '#a97bff', swift: '#ffac45',
    c: '#a8b9cc', h: '#a8b9cc', cpp: '#f34b7d', hpp: '#f34b7d',
    sh: '#89e051', bash: '#89e051', zsh: '#89e051',
    yml: '#cb171e', yaml: '#cb171e', toml: '#9c4221',
    sql: '#e38c00',
    vue: '#41b883', svelte: '#ff3e00',
    png: '#a074c4', jpg: '#a074c4', jpeg: '#a074c4', gif: '#a074c4', svg: '#ffb13b',
    lock: '#6b6b76',
    env: '#e5a639',
    gitignore: '#f54d27',
  };

  function fileIcon(name) {
    const ext = extOf(name);
    const color = ICON_COLORS[ext] || 'var(--text-dim)';
    return `<svg class="file-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2h6l4 4v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1"/><path d="M9 2v4h4" stroke="${color}" stroke-width="1" fill="none"/></svg>`;
  }

  function folderIcon(open) {
    const color = 'var(--accent-light)';
    if (open) {
      return `<svg class="folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V6H2.5L1.5 4z" fill="${color}" fill-opacity="0.35"/><path d="M2.5 6h11.5l-1.5 6.5a1 1 0 0 1-1 .8H2a1 1 0 0 1-1-1L2 6.5z" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="0.75"/></svg>`;
    }
    return `<svg class="folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="0.75"/></svg>`;
  }

  function chevron() {
    return `<svg class="tree-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M3 2l4 3-4 3V2z" fill="currentColor"/></svg>`;
  }

  async function checkLinked(projectPath) {
    try {
      const s = await api.files.stat(projectPath + '/.git');
      return !!(s && s.exists && s.isDir);
    } catch {
      return false;
    }
  }

  async function loadTree() {
    if (!state.projectPath) {
      treeData = null;
      return;
    }
    try {
      treeData = await api.files.tree(state.projectPath);
      isLinked = await checkLinked(state.projectPath);
    } catch (e) {
      console.error('files.tree failed', e);
      treeData = null;
    }
  }

  function matchesFilter(name) {
    if (!filterText) return true;
    return name.toLowerCase().includes(filterText.toLowerCase());
  }

  function nodeContainsMatch(node) {
    if (!filterText) return true;
    if (matchesFilter(node.name)) return true;
    if (node.type === 'dir' && node.children) {
      return node.children.some(nodeContainsMatch);
    }
    return false;
  }

  function renderTreeNode(node, depth) {
    if (filterText && !nodeContainsMatch(node)) return null;

    // Track visible paths for shift-click range select
    allVisiblePaths.push(node.path);

    const isDir = node.type === 'dir';
    const isExpanded = isDir && (filterText ? true : expanded.has(node.path));
    const isSelected = selectedPaths.has(node.path);
    const isActive = state.activeFile === node.path;
    const row = h('div', {
      class: 'tree-node' + (isActive ? ' active' : '') + (isSelected ? ' selected' : ''),
      dataset: { path: node.path, type: node.type },
      style: { paddingLeft: (6 + depth * 10) + 'px' },
      draggable: 'true',
    });

    const chev = h('span', {
      class: 'tree-chevron' + (isExpanded ? ' expanded' : ''),
      style: { visibility: isDir ? 'visible' : 'hidden' },
      html: isDir ? chevron() : '',
    });
    row.appendChild(chev);

    const iconWrap = h('span', {
      class: 'tree-icon',
      html: isDir ? folderIcon(isExpanded) : fileIcon(node.name),
    });
    row.appendChild(iconWrap);

    const label = h('span', { class: 'tree-label' }, node.name);
    row.appendChild(label);

    // Heavy dir indicator — folders-only, opens in OS explorer
    if (isDir && node.heavy) {
      const badge = h('span', { style: 'margin-left:auto;font-size:8px;color:var(--text-dim);opacity:0.4;font-family:var(--font-mono);' }, '↗');
      badge.title = 'Heavy folder — folders only, double-click to open in file explorer';
      row.appendChild(badge);
    } else if (isDir && node.lazy && !node._loaded) {
      const badge = h('span', { class: 'tree-lazy-badge', style: 'margin-left:auto;font-size:9px;color:var(--text-dim);opacity:0.5;' });
      row.appendChild(badge);
    }

    row.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isDir) {
        if (e.ctrlKey || e.metaKey) {
          if (selectedPaths.has(node.path)) selectedPaths.delete(node.path);
          else selectedPaths.add(node.path);
          lastClickedPath = node.path;
          renderExplorer();
          return;
        }
        selectedPaths.clear();
        if (expanded.has(node.path)) {
          expanded.delete(node.path);
          renderExplorer();
        } else {
          // Lazy load: fetch children on first expand
          if (node.lazy && !node._loaded) {
            row.style.opacity = '0.5';
            try {
              const children = await api.files.listDir(node.path);
              node.children = children || [];
              node._loaded = true;
            } catch {
              node.children = [];
              node._loaded = true;
            }
            row.style.opacity = '';
          }
          expanded.add(node.path);
          renderExplorer();
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: toggle selection of this file
        if (selectedPaths.has(node.path)) selectedPaths.delete(node.path);
        else selectedPaths.add(node.path);
        lastClickedPath = node.path;
        renderExplorer();
      } else if (e.shiftKey && lastClickedPath) {
        // Shift+click: range select from lastClickedPath to this one
        const startIdx = allVisiblePaths.indexOf(lastClickedPath);
        const endIdx = allVisiblePaths.indexOf(node.path);
        if (startIdx >= 0 && endIdx >= 0) {
          const lo = Math.min(startIdx, endIdx);
          const hi = Math.max(startIdx, endIdx);
          for (let i = lo; i <= hi; i++) selectedPaths.add(allVisiblePaths[i]);
        }
        renderExplorer();
      } else {
        // Normal click: clear multi-select, open file
        selectedPaths.clear();
        lastClickedPath = node.path;
        bus.emit('file:open', { path: node.path });
      }
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTreeContextMenu(e, node);
    });

    // Double-click heavy dirs to open in OS file explorer
    if (isDir && node.heavy) {
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        api.shell?.showItemInFolder?.(node.path) || api.files?.openInExplorer?.(node.path);
      });
    }

    // Drag & drop
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/pipilot-path', node.path);
      e.dataTransfer.effectAllowed = 'move';
    });
    if (isDir) {
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        const src = e.dataTransfer.getData('application/pipilot-path');
        if (!src || src === node.path) return;
        const name = basename(src);
        const dest = node.path + '/' + name;
        if (dest === src) return;
        try {
          await api.files.rename(src, dest);
          bus.emit('toast:show', { type: 'ok', message: `Moved ${name}` });
          await loadTree();
          renderExplorer();
        } catch (err) {
          bus.emit('toast:show', { type: 'error', message: 'Move failed: ' + err.message });
        }
      });
    }

    const container = h('div', { class: 'tree-item' }, row);

    if (isDir && isExpanded && node.children && node.children.length) {
      const kids = h('div', { class: 'tree-children' });
      for (const c of node.children) {
        const el = renderTreeNode(c, depth + 1);
        if (el) kids.appendChild(el);
      }
      container.appendChild(kids);
    }

    return container;
  }

  function showTreeContextMenu(e, node) {
    const isDir = node.type === 'dir';
    const multiCount = selectedPaths.size;
    const isMulti = multiCount > 1 && selectedPaths.has(node.path);
    const items = [];

    if (isMulti) {
      // Multi-select context menu
      items.push({ label: `Open ${multiCount} Selected`, onClick: () => {
        for (const p of selectedPaths) bus.emit('file:open', { path: p });
      }});
      items.push({ type: 'separator' });
      items.push({ label: `Delete ${multiCount} Selected`, onClick: () => deleteSelectedFiles() });
      items.push({ type: 'separator' });
      items.push({ label: 'Copy Paths', onClick: () => {
        navigator.clipboard.writeText([...selectedPaths].join('\n')).catch(() => {});
        bus.emit('toast:show', { type: 'info', message: `${multiCount} paths copied` });
      }});
      items.push({ label: 'Copy Relative Paths', onClick: () => {
        const rel = [...selectedPaths].map(p =>
          state.projectPath && p.startsWith(state.projectPath)
            ? p.slice(state.projectPath.length + 1) : p
        );
        navigator.clipboard.writeText(rel.join('\n')).catch(() => {});
        bus.emit('toast:show', { type: 'info', message: `${multiCount} relative paths copied` });
      }});
      items.push({ type: 'separator' });
      items.push({ label: 'Download as ZIP', onClick: () => downloadSelectedAsZip() });
      items.push({ type: 'separator' });
      items.push({ label: 'Select All (Ctrl+A)', onClick: () => {
        selectedPaths.clear();
        allVisiblePaths.forEach(p => selectedPaths.add(p));
        renderExplorer();
      }});
      items.push({ label: 'Select None', onClick: () => { selectedPaths.clear(); renderExplorer(); } });
    } else {
      // Single item context menu
      if (isDir) {
        items.push({ label: 'New File', onClick: () => createEntry(node.path, 'file') });
        items.push({ label: 'New Folder', onClick: () => createEntry(node.path, 'dir') });
        items.push({ type: 'separator' });
      }
      items.push({ label: 'Rename', onClick: () => renameEntry(node) });
      items.push({ label: 'Delete', onClick: () => deleteEntry(node) });
      items.push({ type: 'separator' });
      items.push({ label: 'Reveal in File Manager', onClick: () => api.shell.showItemInFolder(node.path) });
      items.push({ label: 'Copy Path', onClick: () => {
        navigator.clipboard.writeText(node.path).catch(() => {});
        bus.emit('toast:show', { type: 'info', message: 'Path copied' });
      }});
      items.push({ label: 'Copy Relative Path', onClick: () => {
        const rel = state.projectPath && node.path.startsWith(state.projectPath)
          ? node.path.slice(state.projectPath.length + 1)
          : node.path;
        navigator.clipboard.writeText(rel).catch(() => {});
        bus.emit('toast:show', { type: 'info', message: 'Relative path copied' });
      }});
    }

    bus.emit('contextmenu:show', { x: e.clientX, y: e.clientY, items, target: node });
  }

  async function createEntry(parentPath, kind) {
    const promptFn = window.PiPilot?.modal?.prompt
      ? (opts) => window.PiPilot.modal.prompt(opts)
      : async ({ title, label, defaultValue }) => window.prompt(title || label || 'Enter name:', defaultValue || '');

    const name = await promptFn({
      title: `New ${kind === 'dir' ? 'Folder' : 'File'}`,
      label: `Enter ${kind === 'dir' ? 'folder' : 'file'} name`,
      placeholder: kind === 'dir' ? 'folder-name' : 'file-name.txt',
    });
    if (!name || !String(name).trim()) return;
    const trimmed = String(name).trim();
    const target = parentPath + '/' + trimmed;
    try {
      if (kind === 'dir') {
        await api.files.mkdir(target);
      } else {
        await api.files.write(target, '');
      }
      expanded.add(parentPath);
      await loadTree();
      renderExplorer();
      if (kind === 'file') bus.emit('file:open', { path: target });
    } catch (err) {
      bus.emit('toast:show', { type: 'error', message: 'Create failed: ' + err.message });
    }
  }

  async function renameEntry(node) {
    const promptFn = window.PiPilot?.modal?.prompt
      ? (opts) => window.PiPilot.modal.prompt(opts)
      : async ({ title, defaultValue }) => window.prompt(title || 'Rename to:', defaultValue || '');

    const newName = await promptFn({
      title: 'Rename',
      label: 'Rename to',
      defaultValue: node.name,
      placeholder: node.name,
      confirmText: 'Rename',
    });
    if (!newName || !String(newName).trim() || String(newName).trim() === node.name) return;
    const trimmed = String(newName).trim();
    const parent = node.path.slice(0, node.path.length - node.name.length - 1);
    const dest = parent + '/' + trimmed;
    try {
      await api.files.rename(node.path, dest);
      bus.emit('file:renamed', { from: node.path, to: dest });
      await loadTree();
      renderExplorer();
    } catch (err) {
      bus.emit('toast:show', { type: 'error', message: 'Rename failed: ' + err.message });
    }
  }

  async function deleteEntry(node) {
    if (!window.confirm(`Delete ${node.name}?`)) return;
    try {
      await api.files.delete(node.path);
      bus.emit('file:deleted', { path: node.path });
      await loadTree();
      renderExplorer();
    } catch (err) {
      bus.emit('toast:show', { type: 'error', message: 'Delete failed: ' + err.message });
    }
  }

  async function deleteSelectedFiles() {
    const count = selectedPaths.size;
    if (!count) return;
    if (!confirm(`Delete ${count} item${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    for (const p of selectedPaths) {
      try { await api.files.delete(p); } catch {}
    }
    selectedPaths.clear();
    await loadTree(); renderExplorer();
    bus.emit('toast:show', { type: 'ok', message: `Deleted ${count} items` });
  }

  async function downloadSelectedAsZip() {
    const paths = [...selectedPaths];
    if (!paths.length) return;
    // Show save dialog so user picks where to download
    const defaultName = (state.projectName || 'export') + '.zip';
    const savePath = await api.pickSavePath?.({ defaultPath: defaultName, filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] });
    if (!savePath) return; // user cancelled
    bus.emit('toast:show', { type: 'info', message: `Zipping ${paths.length} items…` });
    try {
      const result = await api.files.zip(paths, state.projectPath, savePath);
      if (!result?.ok) throw new Error('Zip failed');
      const sizeKB = Math.round((result.size || 0) / 1024);
      bus.emit('toast:show', { type: 'ok', message: `ZIP saved (${sizeKB} KB)` });
    } catch (err) {
      bus.emit('toast:show', { type: 'error', message: 'ZIP failed: ' + (err.message || err) });
    }
  }

  function renderExplorer() {
    root.innerHTML = '';
    if (!state.projectPath) {
      root.appendChild(h('div', { class: 'panel-empty' }, 'No project open'));
      return;
    }

    const header = h('div', { class: 'panel-header' },
      h('div', { class: 'panel-title' },
        h('span', { class: 'panel-title-text' }, state.projectName || basename(state.projectPath)),
        isLinked ? h('span', { class: 'badge badge-ok' }, 'LINKED') : null
      )
    );
    root.appendChild(header);

    const actions = h('div', { class: 'panel-actions' },
      h('button', {
        class: 'icon-btn', title: 'New File',
        onClick: () => createEntry(state.projectPath, 'file'),
      }, h('span', { html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/><path d="M8 8v4M6 10h4" stroke-linecap="round"/></svg>' })),
      h('button', {
        class: 'icon-btn', title: 'New Folder',
        onClick: () => createEntry(state.projectPath, 'dir'),
      }, h('span', { html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h4l1 1.5h7V13H2z"/><path d="M8 8v4M6 10h4" stroke-linecap="round"/></svg>' })),
      h('button', {
        class: 'icon-btn', title: 'Refresh',
        onClick: async () => { await loadTree(); renderExplorer(); },
      }, h('span', { html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8a6 6 0 1 0 2-4.5"/><path d="M2 2v3h3"/></svg>' })),
      h('button', {
        class: 'icon-btn', title: 'Collapse All',
        onClick: () => { expanded.clear(); renderExplorer(); },
      }, h('span', { html: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6l4 4 4-4"/></svg>' })),
    );
    root.appendChild(actions);

    const search = h('div', { class: 'panel-search' },
      h('input', {
        type: 'text', class: 'panel-search-input',
        placeholder: 'filter files...',
        value: filterText,
        oninput: (e) => { filterText = e.target.value; renderExplorer(); refocusFilter(); },
      })
    );
    root.appendChild(search);

    allVisiblePaths = []; // reset for shift-click range tracking
    const tree = h('div', { class: 'file-tree' });
    if (treeData && treeData.children && treeData.children.length) {
      for (const c of treeData.children) {
        const el = renderTreeNode(c, 0);
        if (el) tree.appendChild(el);
      }
    } else {
      tree.appendChild(h('div', { class: 'panel-empty' }, 'Empty project'));
    }
    root.appendChild(tree);

    // Root-level drop target / context menu
    tree.addEventListener('contextmenu', (e) => {
      if (e.target !== tree) return;
      e.preventDefault();
      bus.emit('contextmenu:show', {
        x: e.clientX, y: e.clientY,
        items: [
          { label: 'New File', onClick: () => createEntry(state.projectPath, 'file') },
          { label: 'New Folder', onClick: () => createEntry(state.projectPath, 'dir') },
          { type: 'separator' },
          { label: 'Refresh', onClick: async () => { await loadTree(); renderExplorer(); } },
          { label: 'Reveal in File Manager', onClick: () => api.shell.showItemInFolder(state.projectPath) },
        ],
      });
    });
    tree.addEventListener('dragover', (e) => {
      if (e.target === tree) { e.preventDefault(); }
    });
    tree.addEventListener('drop', async (e) => {
      if (e.target !== tree) return;
      e.preventDefault();
      const src = e.dataTransfer.getData('application/pipilot-path');
      if (!src) return;
      const name = basename(src);
      const dest = state.projectPath + '/' + name;
      if (dest === src) return;
      try {
        await api.files.rename(src, dest);
        await loadTree();
        renderExplorer();
      } catch (err) {
        bus.emit('toast:show', { type: 'error', message: 'Move failed: ' + err.message });
      }
    });
  }

  function refocusFilter() {
    const input = root.querySelector('.panel-search-input');
    if (input) {
      input.focus();
      const val = input.value;
      input.setSelectionRange(val.length, val.length);
    }
  }

  // ---------- Search panel ----------
  let searchState = {
    query: '',
    replace: '',
    caseSensitive: false,
    regex: false,
    results: [],
    running: false,
  };

  const runSearch = debounce(async () => {
    if (!state.projectPath || !searchState.query) {
      searchState.results = [];
      renderSearchResults();
      return;
    }
    searchState.running = true;
    renderSearchResults();
    try {
      const results = await api.files.search(state.projectPath, searchState.query, {
        caseSensitive: searchState.caseSensitive,
        regex: searchState.regex,
      });
      searchState.results = results || [];
    } catch (e) {
      searchState.results = [];
      bus.emit('toast:show', { type: 'error', message: 'Search failed: ' + e.message });
    } finally {
      searchState.running = false;
      renderSearchResults();
    }
  }, 280);

  function renderSearch() {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'panel-header' },
      h('div', { class: 'panel-title' },
        h('span', { class: 'panel-title-text' }, 'Search')
      )
    ));

    const input = h('input', {
      type: 'text', class: 'panel-search-input',
      placeholder: 'Search in project...',
      value: searchState.query,
      oninput: (e) => { searchState.query = e.target.value; runSearch(); },
    });
    root.appendChild(h('div', { class: 'panel-search' }, input));

    root.appendChild(h('div', { class: 'panel-actions search-opts' },
      h('button', {
        class: 'icon-btn' + (searchState.caseSensitive ? ' toggled' : ''),
        title: 'Match Case',
        onClick: () => { searchState.caseSensitive = !searchState.caseSensitive; renderSearch(); runSearch(); restoreSearchFocus(); },
      }, 'Aa'),
      h('button', {
        class: 'icon-btn' + (searchState.regex ? ' toggled' : ''),
        title: 'Use Regex',
        onClick: () => { searchState.regex = !searchState.regex; renderSearch(); runSearch(); restoreSearchFocus(); },
      }, '.*'),
    ));

    // Replace row
    const replaceWrap = h('div', { class: 'panel-search', style: { display: 'flex', gap: '4px' } });
    const replaceInput = h('input', {
      type: 'text', class: 'panel-search-input',
      placeholder: 'Replace...',
      value: searchState.replace,
      oninput: (e) => { searchState.replace = e.target.value; },
      style: { flex: '1' },
    });
    const replaceAllBtn = h('button', {
      class: 'icon-btn',
      title: 'Replace All in Project',
      style: { flexShrink: '0', fontSize: '10px', padding: '2px 6px' },
      onClick: async () => {
        if (!searchState.query || !state.projectPath) return;
        if (!searchState.results.length) return;
        const grouped = new Map();
        for (const r of searchState.results) {
          if (!grouped.has(r.file)) grouped.set(r.file, []);
          grouped.get(r.file).push(r);
        }
        let replaced = 0;
        for (const [file] of grouped) {
          try {
            const data = await api.files.read(file);
            const content = data && data.content != null ? data.content : '';
            let newContent;
            if (searchState.regex) {
              const flags = searchState.caseSensitive ? 'g' : 'gi';
              newContent = content.replace(new RegExp(searchState.query, flags), searchState.replace);
            } else {
              const escaped = searchState.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const flags = searchState.caseSensitive ? 'g' : 'gi';
              newContent = content.replace(new RegExp(escaped, flags), searchState.replace);
            }
            if (newContent !== content) {
              await api.files.write(file, newContent);
              replaced++;
            }
          } catch {}
        }
        bus.emit('toast:show', { type: 'ok', message: `Replaced in ${replaced} file${replaced === 1 ? '' : 's'}` });
        runSearch();
      },
    }, 'Replace All');
    replaceWrap.appendChild(replaceInput);
    replaceWrap.appendChild(replaceAllBtn);
    root.appendChild(replaceWrap);

    // Search index progress bar (visible during indexing)
    const indexProgressWrap = h('div', { class: 'search-index-progress hidden', id: 'search-index-progress' });
    root.appendChild(indexProgressWrap);

    root.appendChild(h('div', { class: 'search-results', id: 'search-results' }));
    renderSearchResults();
    updateSearchIndexProgress(); // show if currently indexing
    input.focus();
    const v = input.value;
    try { input.setSelectionRange(v.length, v.length); } catch {}
  }

  function restoreSearchFocus() {
    const input = root.querySelector('.panel-search-input');
    if (input) input.focus();
  }

  function renderSearchResults() {
    const container = document.getElementById('search-results');
    if (!container) return;
    container.innerHTML = '';
    if (searchState.running) {
      container.appendChild(h('div', { class: 'panel-empty' }, 'Searching...'));
      return;
    }
    if (!searchState.query) {
      container.appendChild(h('div', { class: 'panel-empty' }, 'Type to search'));
      return;
    }
    if (!searchState.results.length) {
      container.appendChild(h('div', { class: 'panel-empty' }, 'No results'));
      return;
    }

    const grouped = new Map();
    for (const r of searchState.results) {
      if (!grouped.has(r.file)) grouped.set(r.file, []);
      grouped.get(r.file).push(r);
    }

    container.appendChild(h('div', { class: 'search-summary' },
      `${searchState.results.length} result${searchState.results.length === 1 ? '' : 's'} in ${grouped.size} file${grouped.size === 1 ? '' : 's'}`
    ));

    for (const [file, hits] of grouped) {
      const rel = state.projectPath && file.startsWith(state.projectPath)
        ? file.slice(state.projectPath.length + 1) : file;
      const group = h('div', { class: 'search-group' });
      group.appendChild(h('div', { class: 'search-file' },
        h('span', { class: 'tree-icon', html: fileIcon(basename(file)) }),
        h('span', { class: 'search-file-path' }, rel),
        h('span', { class: 'search-file-count' }, String(hits.length))
      ));
      for (const hit of hits) {
        const row = h('div', { class: 'search-hit' },
          h('span', { class: 'search-hit-line' }, String(hit.line)),
          h('span', { class: 'search-hit-preview' }, hit.preview.trim())
        );
        row.addEventListener('click', () => {
          bus.emit('file:open', { path: hit.file, line: hit.line, col: hit.col });
        });
        group.appendChild(row);
      }
      container.appendChild(group);
    }
  }

  // ---------- Search index progress in search panel ----------
  let lastIndexProgress = null;

  function updateSearchIndexProgress() {
    const el = document.getElementById('search-index-progress');
    if (!el) return;
    const p = lastIndexProgress;
    if (!p || p.phase === 'ready') {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    const pct = p.pct || 0;
    const label = p.phase === 'updating'
      ? `Updating... ${pct}%`
      : `Indexing... ${pct}%`;
    const sub = `${p.filesProcessed || 0} of ${p.filesTotal || 0} files`;
    el.innerHTML = `
      <div class="idx-progress-label">${label}</div>
      <div class="idx-progress-track"><div class="idx-progress-fill" style="width:${pct}%"></div></div>
      <div class="idx-progress-sub">${sub}</div>
    `;
  }

  if (api.searchIndex?.onProgress) {
    api.searchIndex.onProgress((p) => {
      lastIndexProgress = p;
      if (activePanel === 'search') updateSearchIndexProgress();
    });
  }

  // ---------- Placeholders ----------
  function renderPlaceholder(title, subtitle) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'panel-header' },
      h('div', { class: 'panel-title' },
        h('span', { class: 'panel-title-text' }, title)
      )
    ));
    root.appendChild(h('div', { class: 'panel-placeholder' },
      h('div', { class: 'panel-placeholder-title' }, 'Coming up...'),
      h('div', { class: 'panel-placeholder-sub' }, subtitle)
    ));
  }

  // ---------- Panel switching ----------
  function renderPanel() {
    // Tag the container with the active panel so panels.js refresh handlers
    // can tell whether they own the current render.
    root.dataset.panel = activePanel;

    // Delegate to external panel renderers when available (panels.js
    // populates window.PiPilot.panels for git / extensions / checkpoints /
    // deploy). Each renderer takes (containerEl, projectPath).
    const external = window.PiPilot?.panels?.[activePanel];
    if (external && typeof external === 'function') {
      root.innerHTML = '';
      try {
        external(root, state.projectPath);
        return;
      } catch (e) {
        console.error(`panels.${activePanel} render failed`, e);
        // fall through to placeholder
      }
    }

    switch (activePanel) {
      case 'explorer': renderExplorer(); break;
      case 'search': renderSearch(); break;
      case 'chat':
        // Don't waste sidebar space — just surface the chat panel on the right.
        bus.emit('chat:reveal');
        renderExplorer();
        break;
      case 'git': renderPlaceholder('Source Control', 'Open a project to see git status.'); break;
      case 'extensions': renderPlaceholder('Extensions & MCP', 'Loading…'); break;
      case 'deploy': renderPlaceholder('Deploy', 'Loading…'); break;
      default: renderExplorer();
    }
  }

  // ---------- Wire up ----------
  bus.on('panel:switch', (panel) => {
    activePanel = panel || 'explorer';
    renderPanel();
  });

  bus.on('project:opened', async (payload) => {
    if (payload?.path) {
      state.projectPath = payload.path;
      state.projectName = payload.name || basename(payload.path);
    }
    expanded.clear();
    filterText = '';
    await loadTree();
    if (state.projectPath) {
      if (watchDispose) { try { watchDispose(); } catch {} }
      watchDispose = api.files.watch(state.projectPath, (evt) => {
        refresh();
        // Notify editor about external file changes so open tabs stay in sync
        if (evt && evt.type && evt.path) {
          bus.emit('file:external-change', evt);
        }
      });
    }
    if (activePanel === 'explorer') renderExplorer();
  });

  bus.on('project:closed', () => {
    treeData = null;
    state.projectPath = null;
    state.projectName = null;
    expanded.clear();
    if (watchDispose) { try { watchDispose(); } catch {} }
    watchDispose = null;
    renderPanel();
  });

  bus.on('files:refresh', async () => {
    await loadTree();
    renderPanel();
  });

  bus.on('editor:active-changed', () => {
    // Auto-expand parent folders of the active file (like VSCode)
    revealInExplorer(state.activeFile);
    if (activePanel === 'explorer') renderExplorer();
  });

  function revealInExplorer(filePath) {
    if (!filePath || !state.projectPath) return;
    // Walk the tree to find matching nodes and expand their parents
    if (!treeData?.children) return;
    function findAndExpand(node, target) {
      if (!node) return false;
      if (node.path === target) return true;
      if (node.type === 'dir' && node.children) {
        for (const child of node.children) {
          if (findAndExpand(child, target)) {
            expanded.add(node.path);
            return true;
          }
        }
      }
      return false;
    }
    for (const child of treeData.children) {
      findAndExpand(child, filePath);
    }
  }

  // Initial render
  renderPanel();

  // Track whether the file explorer has focus (for keyboard shortcuts)
  let explorerFocused = false;

  root.addEventListener('mousedown', () => { explorerFocused = true; });
  root.addEventListener('focusin', () => { explorerFocused = true; });
  // Lose focus when clicking elsewhere
  document.addEventListener('mousedown', (e) => {
    if (!root.contains(e.target)) explorerFocused = false;
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!explorerFocused || activePanel !== 'explorer') return;
    // Don't intercept if user is typing in an input/textarea
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectedPaths.clear();
      allVisiblePaths.forEach(p => selectedPaths.add(p));
      renderExplorer();
    }
    if (e.key === 'Escape' && selectedPaths.size > 0) {
      e.preventDefault();
      selectedPaths.clear();
      renderExplorer();
    }
    if (e.key === 'Delete' && selectedPaths.size > 0) {
      e.preventDefault();
      deleteSelectedFiles();
    }
  }, true); // capture phase so it fires before Ace

  // Expose a minimal API for other phases
  window.PiPilot.sidebar = {
    refresh: async () => { await loadTree(); renderPanel(); },
    switchPanel: (p) => { activePanel = p; renderPanel(); },
  };
})();
