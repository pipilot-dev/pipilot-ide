// PiPilot IDE Extension: Multi-Cursor Bookmarks
// mod+shift+b to bookmark current cursor position(s).
// Sidebar panel lists bookmarks grouped by file. Persists in db.

(function (PiPilot, bus, api, state, db) {

  var DB_KEY = 'bookmarks:list';
  var PANEL_ID = 'bookmarks';
  var PANEL_NAME = 'Bookmarks';
  var ICON_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3h10v14l-5-3.5L5 17V3z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';

  var panelEl = null;
  var badgeEl = null;
  var statusItem = null;

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getBaseName(path) {
    if (!path) return '';
    var parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || path;
  }

  function shortenPath(path) {
    if (!path) return '';
    var norm = path.replace(/\\/g, '/');
    // Show last 2 segments
    var parts = norm.split('/');
    if (parts.length > 2) return '.../' + parts.slice(-2).join('/');
    return norm;
  }

  // ── DB operations ──
  function getBookmarks() {
    var raw = db.get(DB_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
  }

  function saveBookmarks(list) {
    db.set(DB_KEY, JSON.stringify(list));
  }

  function addBookmark(bm) {
    var list = getBookmarks();
    // Deduplicate by file+line
    for (var i = 0; i < list.length; i++) {
      if (list[i].file === bm.file && list[i].line === bm.line) {
        return false; // already exists
      }
    }
    bm.id = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    bm.createdAt = Date.now();
    list.push(bm);
    saveBookmarks(list);
    return true;
  }

  function removeBookmark(id) {
    var list = getBookmarks();
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].id === id) {
        list.splice(i, 1);
      }
    }
    saveBookmarks(list);
  }

  // ── Styles ──
  var style = document.createElement('style');
  style.textContent = '\
.bm-wrap { display:flex; flex-direction:column; height:100%; background:var(--bg,#141417); color:var(--text,#b0b0b8); font-family:var(--font-sans); }\
.bm-header { display:flex; align-items:center; padding:10px 12px; gap:8px; border-bottom:1px solid var(--border,#2e2e35); flex-shrink:0; }\
.bm-header-title { font-weight:600; font-size:13px; flex:1; }\
.bm-header-btn { background:none; border:none; color:var(--text-dim,#888); cursor:pointer; font-size:13px; padding:2px 6px; border-radius:3px; }\
.bm-header-btn:hover { background:var(--surface-alt,#2a2a33); color:var(--text,#ccc); }\
.bm-list { flex:1; overflow-y:auto; padding:4px 0; }\
.bm-group { margin-bottom:4px; }\
.bm-group-header { padding:6px 12px; font-size:11px; font-weight:600; color:var(--text-dim,#888); cursor:pointer; display:flex; align-items:center; gap:6px; }\
.bm-group-header:hover { color:var(--text,#ccc); }\
.bm-group-arrow { font-size:10px; transition:transform 0.2s; }\
.bm-group-arrow.collapsed { transform:rotate(-90deg); }\
.bm-item { padding:5px 12px 5px 24px; cursor:pointer; display:flex; align-items:center; gap:8px; font-size:12px; }\
.bm-item:hover { background:var(--surface-alt,#232329); }\
.bm-item-line { color:var(--accent,#6c8cff); font-family:var(--font-mono,monospace); font-size:11px; min-width:32px; }\
.bm-item-preview { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--font-mono,monospace); font-size:11px; color:var(--text-dim,#888); }\
.bm-item-del { background:none; border:none; color:var(--text-dim,#555); cursor:pointer; font-size:14px; padding:0 4px; line-height:1; opacity:0; }\
.bm-item:hover .bm-item-del { opacity:1; }\
.bm-item-del:hover { color:#e55; }\
.bm-empty { padding:24px 12px; text-align:center; color:var(--text-dim,#555); font-size:12px; }\
.bm-status { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; font-size:11px; color:var(--text-dim,#888); margin-left:6px; cursor:default; }\
';
  document.head.appendChild(style);

  // ── Status bar ──
  var statusBar = document.querySelector('.status-right');
  if (statusBar) {
    statusItem = document.createElement('span');
    statusItem.className = 'bm-status';
    statusItem.title = 'Bookmarks';
    updateStatusCount();
    statusBar.insertBefore(statusItem, statusBar.firstChild);
  }

  function updateStatusCount() {
    if (!statusItem) return;
    var count = getBookmarks().length;
    statusItem.innerHTML = '\uD83D\uDD16 ' + count;
    statusItem.title = count + ' bookmark' + (count !== 1 ? 's' : '');
  }

  function updateBadge() {
    if (!badgeEl) return;
    var count = getBookmarks().length;
    if (count > 0) {
      badgeEl.textContent = count > 99 ? '99+' : count;
      badgeEl.style.display = 'block';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  // ── Activity bar + sidebar panel ──
  function registerPanel() {
    var activityBar = document.querySelector('.activity-bar');
    var sidebarContainer = document.querySelector('.sidebar');

    if (!activityBar || !sidebarContainer) {
      setTimeout(registerPanel, 1000);
      return;
    }

    // Activity bar button
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.id = 'activity-btn-' + PANEL_ID;
    btn.title = PANEL_NAME;
    btn.innerHTML = ICON_SVG;
    btn.style.cssText = 'position:relative;';

    badgeEl = document.createElement('span');
    badgeEl.style.cssText = 'position:absolute;top:2px;right:2px;background:#6c8cff;color:#fff;font-size:9px;font-weight:700;border-radius:50%;min-width:14px;height:14px;line-height:14px;text-align:center;padding:0 3px;display:none;font-family:var(--font-mono);';
    btn.appendChild(badgeEl);

    btn.addEventListener('click', function () { togglePanel(); });
    activityBar.appendChild(btn);

    // Panel
    panelEl = document.createElement('div');
    panelEl.id = 'sidebar-panel-' + PANEL_ID;
    panelEl.className = 'sidebar-panel';
    panelEl.style.cssText = 'display:none;flex-direction:column;height:100%;overflow:hidden;';
    sidebarContainer.appendChild(panelEl);

    updateBadge();
  }

  function togglePanel() {
    if (!panelEl) return;

    var panels = document.querySelectorAll('.sidebar-panel');
    var buttons = document.querySelectorAll('.activity-btn');
    var wasVisible = panelEl.style.display !== 'none';

    for (var i = 0; i < panels.length; i++) panels[i].style.display = 'none';
    for (var j = 0; j < buttons.length; j++) buttons[j].classList.remove('active');

    if (!wasVisible) {
      panelEl.style.display = 'flex';
      var btn = document.getElementById('activity-btn-' + PANEL_ID);
      if (btn) btn.classList.add('active');
      var sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.style.display = '';
      renderBookmarks();
    } else {
      var sidebar2 = document.querySelector('.sidebar');
      if (sidebar2) sidebar2.style.display = 'none';
    }
  }

  // ── Render bookmarks list ──
  function renderBookmarks() {
    if (!panelEl) return;
    panelEl.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'bm-wrap';

    // Header
    var header = document.createElement('div');
    header.className = 'bm-header';

    var title = document.createElement('span');
    title.className = 'bm-header-title';
    title.textContent = 'Bookmarks';
    header.appendChild(title);

    var clearBtn = document.createElement('button');
    clearBtn.className = 'bm-header-btn';
    clearBtn.title = 'Clear all bookmarks';
    clearBtn.textContent = '\uD83D\uDDD1';
    clearBtn.addEventListener('click', function () {
      saveBookmarks([]);
      renderBookmarks();
      updateStatusCount();
      updateBadge();
    });
    header.appendChild(clearBtn);

    wrap.appendChild(header);

    // List
    var listEl = document.createElement('div');
    listEl.className = 'bm-list';

    var bookmarks = getBookmarks();
    if (bookmarks.length === 0) {
      listEl.innerHTML = '<div class="bm-empty">No bookmarks yet.<br><br>Press <kbd style="background:var(--surface,#2a2a33);padding:2px 6px;border-radius:3px;font-size:11px;">Ctrl+Shift+B</kbd> to bookmark cursor position.</div>';
    } else {
      // Group by file
      var groups = {};
      var groupOrder = [];
      for (var i = 0; i < bookmarks.length; i++) {
        var bm = bookmarks[i];
        var file = bm.file || '(unknown)';
        if (!groups[file]) {
          groups[file] = [];
          groupOrder.push(file);
        }
        groups[file].push(bm);
      }

      for (var g = 0; g < groupOrder.length; g++) {
        var filePath = groupOrder[g];
        var items = groups[filePath];

        // Sort by line number
        items.sort(function (a, b) { return (a.line || 0) - (b.line || 0); });

        var groupEl = document.createElement('div');
        groupEl.className = 'bm-group';

        var groupHeader = document.createElement('div');
        groupHeader.className = 'bm-group-header';
        groupHeader.innerHTML = '<span class="bm-group-arrow">\u25BC</span> ' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(getBaseName(filePath)) + '</span>' +
          '<span style="font-size:10px;opacity:0.5;">' + items.length + '</span>';
        groupHeader.title = filePath;

        var itemsContainer = document.createElement('div');

        (function (container, arrow) {
          groupHeader.addEventListener('click', function () {
            var collapsed = container.style.display === 'none';
            container.style.display = collapsed ? '' : 'none';
            arrow.classList.toggle('collapsed', !collapsed);
          });
        })(itemsContainer, groupHeader.querySelector('.bm-group-arrow'));

        groupEl.appendChild(groupHeader);

        for (var b = 0; b < items.length; b++) {
          var bm2 = items[b];

          var itemEl = document.createElement('div');
          itemEl.className = 'bm-item';

          var lineNum = document.createElement('span');
          lineNum.className = 'bm-item-line';
          lineNum.textContent = 'L' + ((bm2.line || 0) + 1);
          itemEl.appendChild(lineNum);

          var preview = document.createElement('span');
          preview.className = 'bm-item-preview';
          preview.textContent = bm2.preview || '';
          itemEl.appendChild(preview);

          var delBtn = document.createElement('button');
          delBtn.className = 'bm-item-del';
          delBtn.innerHTML = '\u00D7';
          delBtn.title = 'Remove bookmark';

          (function (id) {
            delBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              removeBookmark(id);
              renderBookmarks();
              updateStatusCount();
              updateBadge();
            });
          })(bm2.id);

          itemEl.appendChild(delBtn);

          (function (fp, line, col) {
            itemEl.addEventListener('click', function () {
              if (PiPilot.editor && PiPilot.editor.openFile) {
                PiPilot.editor.openFile(fp, { line: line, col: col || 0 });
              }
            });
          })(bm2.file, bm2.line, bm2.col);

          itemsContainer.appendChild(itemEl);
        }

        groupEl.appendChild(itemsContainer);
        listEl.appendChild(groupEl);
      }
    }

    wrap.appendChild(listEl);
    panelEl.appendChild(wrap);
  }

  // ── Bookmark current cursor(s) ──
  function bookmarkCursors() {
    var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
    if (!ace) {
      if (bus && bus.emit) bus.emit('toast:show', { message: 'No editor available', type: 'warn' });
      return;
    }

    var session = ace.getSession();
    if (!session) return;

    var filePath = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    if (!filePath) {
      if (bus && bus.emit) bus.emit('toast:show', { message: 'No file open', type: 'warn' });
      return;
    }

    // Get all cursor positions (multi-cursor support)
    var selection = ace.getSelection();
    var ranges = [];

    if (selection && selection.getAllRanges) {
      ranges = selection.getAllRanges();
    }

    if (ranges.length === 0) {
      // Fallback to single cursor
      var pos = ace.getCursorPosition();
      if (pos) {
        ranges = [{ start: pos, end: pos }];
      }
    }

    var added = 0;
    for (var i = 0; i < ranges.length; i++) {
      var row = ranges[i].start ? ranges[i].start.row : 0;
      var col = ranges[i].start ? ranges[i].start.column : 0;

      var lineContent = session.getLine(row) || '';
      var preview = lineContent.trim().substring(0, 80);

      var result = addBookmark({
        file: filePath,
        line: row,
        col: col,
        preview: preview
      });

      if (result) added++;
    }

    updateStatusCount();
    updateBadge();

    // Re-render panel if visible
    if (panelEl && panelEl.style.display !== 'none') {
      renderBookmarks();
    }

    if (bus && bus.emit) {
      if (added > 0) {
        bus.emit('toast:show', {
          message: 'Added ' + added + ' bookmark' + (added !== 1 ? 's' : ''),
          type: 'ok'
        });
      } else {
        bus.emit('toast:show', { message: 'Bookmark already exists at this position', type: 'info' });
      }
    }
  }

  // ── Register shortcut ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+b', function () {
      bookmarkCursors();
    });
  }

  // ── Register panel ──
  registerPanel();

  // ── Also register as PiPilot panel ──
  if (PiPilot.panels) {
    PiPilot.panels[PANEL_ID] = function (container) {
      panelEl = container;
      renderBookmarks();
    };
  }

  console.log('[ext:multi-cursor-bookmarks] loaded');
})(PiPilot, bus, api, state, db);
