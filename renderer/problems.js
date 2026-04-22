(() => {
  const { bus } = window.PiPilot;

  const $ = (sel, root = document) => root.querySelector(sel);

  const state = {
    query: '',
    show: { error: true, warning: true, info: true },
    collapsed: new Set(),
    lastPayload: { items: [], counts: { errors: 0, warnings: 0, total: 0 }, byFile: {}, error: null },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function normSeverity(sev) {
    if (sev === 'error' || sev === 1) return 'error';
    if (sev === 'warning' || sev === 2) return 'warning';
    return 'info';
  }

  function fileBasename(p) {
    const s = String(p || '');
    const parts = s.split(/[/\\]/g);
    return parts[parts.length - 1] || s;
  }

  function normText(s) {
    return String(s || '').toLowerCase();
  }

  function matchesQuery(it, query) {
    if (!query) return true;
    const q = normText(query);
    const p = normText(it.path || it.file || '');
    const m = normText(it.message || '');
    const c = normText(it.code || '');
    return p.includes(q) || m.includes(q) || c.includes(q);
  }

  function severityLabel(sev) {
    if (sev === 'error') return 'Error';
    if (sev === 'warning') return 'Warning';
    return 'Info';
  }

  function toggleCollapse(path) {
    if (!path) return;
    if (state.collapsed.has(path)) state.collapsed.delete(path);
    else state.collapsed.add(path);
    updateProblemsList();
  }

  function setFilter(sev, value) {
    state.show[sev] = !!value;
    updateProblemsList();
  }

  function renderProblems(payload) {
    const pane = $('#problems-pane');
    if (!pane) return;

    state.lastPayload = payload || state.lastPayload;

    const itemsRaw = Array.isArray(payload?.items) ? payload.items : [];
    const counts = payload?.counts || { errors: 0, warnings: 0, total: 0 };
    const errorText = payload?.error || null;

    // Filter
    const items = itemsRaw
      .filter((it) => state.show[normSeverity(it.severity)])
      .filter((it) => matchesQuery(it, state.query));

    pane.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'problems-header';
    header.innerHTML = `
      <div class="problems-summary">
        <span class="problems-chip problems-chip-error" title="Errors">${counts.errors || 0}</span>
        <span class="problems-chip problems-chip-warn" title="Warnings">${counts.warnings || 0}</span>
        <span class="problems-chip problems-chip-total" title="Shown">${items.length} Shown</span>
      </div>
      <div class="problems-controls">
        <input class="problems-search" type="text" placeholder="Search problems" value="${escapeHtml(state.query)}" />
        <button class="problems-toggle" data-sev="error" aria-pressed="${state.show.error}">${state.show.error ? 'Errors' : 'Errors'}</button>
        <button class="problems-toggle" data-sev="warning" aria-pressed="${state.show.warning}">${state.show.warning ? 'Warnings' : 'Warnings'}</button>
        <button class="problems-toggle" data-sev="info" aria-pressed="${state.show.info}">${state.show.info ? 'Info' : 'Info'}</button>
      </div>
    `;
    pane.appendChild(header);

    // Wire header controls
    const search = $('.problems-search', header);
    if (search) {
      // Restore focus + cursor position after re-render
      if (state.query) {
        search.value = state.query;
        requestAnimationFrame(() => {
          search.focus();
          search.setSelectionRange(state.query.length, state.query.length);
        });
      }
      search.addEventListener('input', () => {
        state.query = search.value || '';
        // Only update the list, not the header (avoids focus loss)
        updateProblemsList(pane);
      });
    }
    header.querySelectorAll('.problems-toggle[data-sev]')?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const sev = btn.dataset.sev;
        setFilter(sev, !state.show[sev]);
      });
    });

    if (errorText) {
      const banner = document.createElement('div');
      banner.className = 'problems-banner';
      banner.textContent = errorText;
      pane.appendChild(banner);
    }

    // Container for the list (replaced by updateProblemsList)
    const listContainer = document.createElement('div');
    listContainer.id = 'problems-list-container';
    pane.appendChild(listContainer);
    updateProblemsList(pane);
  }

  // Rebuild only the list portion (preserves header + search focus)
  function updateProblemsList(pane) {
    if (!pane) pane = $('#problems-pane');
    if (!pane) return;
    const container = pane.querySelector('#problems-list-container');
    if (!container) return;
    container.innerHTML = '';

    const payload = state.lastPayload;
    const itemsRaw = Array.isArray(payload?.items) ? payload.items : [];
    const items = itemsRaw
      .filter((it) => state.show[normSeverity(it.severity)])
      .filter((it) => matchesQuery(it, state.query));

    // Update shown count
    const shownChip = pane.querySelector('.problems-chip-total');
    if (shownChip) shownChip.textContent = items.length + ' Shown';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = state.query ? 'No matching problems' : 'No problems detected';
      container.appendChild(empty);
      return;
    }

    // Group by file
    const groups = new Map();
    for (const it of items) {
      const p = it.path || it.file || '';
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(it);
    }

    const list = document.createElement('div');
    list.className = 'problems-list';

    for (const [filePath, groupItems] of groups) {
      const collapsed = state.collapsed.has(filePath);
      const group = document.createElement('div');
      group.className = 'problems-group';

      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'problems-group-title';
      title.innerHTML = `
        <span class="problems-caret">${collapsed ? '&#9656;' : '&#9662;'}</span>
        <span class="problems-file">${escapeHtml(fileBasename(filePath))}</span>
        <span class="problems-file-path">${escapeHtml(filePath)}</span>
        <span class="problems-file-count">${groupItems.length}</span>
      `;
      title.addEventListener('click', () => { toggleCollapse(filePath); updateProblemsList(pane); });
      group.appendChild(title);

      if (collapsed) {
        list.appendChild(group);
        continue;
      }

      const ul = document.createElement('div');
      ul.className = 'problems-items';

      for (const it of groupItems) {
        const sev = normSeverity(it.severity);
        const row = Number.isFinite(it.row) ? it.row : (Number.isFinite(it.line) ? (it.line - 1) : 0);
        const col = Number.isFinite(it.col) ? it.col : (Number.isFinite(it.startCol) ? it.startCol : 0);
        const line = row + 1;
        const column = col + 1;

        const item = document.createElement('button');
        item.type = 'button';
        item.className = `problem-item problem-${sev}`;
        const code = it.code ? `<span class="problem-code">${escapeHtml(it.code)}</span>` : '';
        item.innerHTML = `
          <span class="problem-dot"></span>
          <span class="problem-msg">${escapeHtml(it.message || '')}</span>
          ${code}
          <span class="problem-sev">${severityLabel(sev)}</span>
          <span class="problem-loc">${line}:${column}</span>
          <button class="problem-ai-fix" title="Fix with AI">✨ AI Fix</button>
        `;

        item.querySelector('.problem-ai-fix')?.addEventListener('click', (e) => {
          e.stopPropagation();
          // Open the file at the error location
          bus.emit('file:open', { path: filePath, line, col: column });
          // Show chat panel and send the problem to AI
          const root = document.getElementById('ide-root');
          if (root) root.classList.remove('chat-collapsed');
          const prompt = `Fix this ${sev} in \`${fileBasename(filePath)}\` at line ${line}:\n\n**${it.code || sev}**: ${it.message}\n\nFile: \`${filePath}\``;
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
              detail: { prefill: prompt, submit: true },
            }));
          }, 300);
        });

        item.addEventListener('click', () => {
          bus.emit('file:open', { path: filePath, line, col: column });
        });

        ul.appendChild(item);
      }

      group.appendChild(ul);
      list.appendChild(group);
    }

    container.appendChild(list);
  }

  function init() {
    bus.on('problems:updated', (payload) => renderProblems(payload));
    bus.on('project:closed', () => renderProblems({ items: [], counts: { errors: 0, warnings: 0, total: 0 } }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
