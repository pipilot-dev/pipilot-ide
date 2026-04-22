// PiPilot IDE Extension: TODO Explorer
// Sidebar panel that scans project files for TODO/FIXME/HACK/XXX comments.

(function (PiPilot, bus, api, state, db) {

  var PANEL_ID = 'todos';
  var PANEL_NAME = 'TODOs';
  var PATTERN = 'TODO|FIXME|HACK|XXX';
  var ICON_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="14" height="2" rx="1" fill="currentColor" opacity="0.7"/><rect x="3" y="9" width="14" height="2" rx="1" fill="currentColor" opacity="0.7"/><rect x="3" y="14" width="14" height="2" rx="1" fill="currentColor" opacity="0.7"/><rect x="3" y="4" width="2" height="2" rx="1" fill="currentColor"/><rect x="3" y="9" width="2" height="2" rx="1" fill="currentColor"/><rect x="3" y="14" width="2" height="2" rx="1" fill="currentColor"/></svg>';

  var todoData = {}; // { file: [{line, col, text, tag}] }
  var totalCount = 0;
  var panelEl = null;
  var badgeEl = null;
  var isLoading = false;

  function toast(message, type) {
    if (bus && bus.emit) {
      bus.emit('toast:show', { message: message, type: type || 'info' });
    }
  }

  // Get current project path
  function getProjectPath() {
    if (state && state.projectPath) return state.projectPath;
    if (PiPilot && PiPilot.project && PiPilot.project.getPath) return PiPilot.project.getPath();
    // Try to infer from active file
    var file = PiPilot.editor && PiPilot.editor.getActiveFile
      ? PiPilot.editor.getActiveFile()
      : null;
    if (file) {
      // Go up to find project root (naive: strip last path segments)
      var parts = file.replace(/\\/g, '/').split('/');
      if (parts.length > 2) {
        // Return parent of src/ or just strip filename
        return parts.slice(0, -1).join('/');
      }
    }
    return '.';
  }

  // Register the sidebar panel
  function registerPanel() {
    // Find the activity bar
    var activityBar = document.querySelector('.activity-bar');
    var sidebarContainer = document.querySelector('.sidebar');

    if (!activityBar || !sidebarContainer) {
      // Retry after a delay if DOM not ready
      setTimeout(registerPanel, 1000);
      return;
    }

    // Create activity bar button
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.id = 'activity-btn-' + PANEL_ID;
    btn.title = PANEL_NAME;
    btn.innerHTML = ICON_SVG;
    btn.style.cssText = 'position:relative;';

    // Badge
    badgeEl = document.createElement('span');
    badgeEl.className = 'todo-badge';
    badgeEl.style.cssText = 'position:absolute;top:2px;right:2px;background:#e06c75;color:#fff;font-size:9px;font-weight:700;border-radius:50%;min-width:14px;height:14px;line-height:14px;text-align:center;padding:0 3px;display:none;font-family:var(--font-mono);';
    btn.appendChild(badgeEl);

    btn.addEventListener('click', function () {
      togglePanel();
    });

    activityBar.appendChild(btn);

    // Create panel content
    panelEl = document.createElement('div');
    panelEl.id = 'sidebar-panel-' + PANEL_ID;
    panelEl.className = 'sidebar-panel';
    panelEl.style.cssText = 'display:none;flex-direction:column;height:100%;overflow:hidden;';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border, #333);flex-shrink:0;';

    var title = document.createElement('span');
    title.style.cssText = 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim, #888);';
    title.textContent = 'TODO Explorer';

    var refreshBtn = document.createElement('button');
    refreshBtn.style.cssText = 'background:none;border:none;color:var(--text-dim, #888);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:3px;';
    refreshBtn.textContent = '\u21BB'; // ↻
    refreshBtn.title = 'Refresh';
    refreshBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      scanTodos();
    });

    header.appendChild(title);
    header.appendChild(refreshBtn);
    panelEl.appendChild(header);

    // Content area
    var content = document.createElement('div');
    content.id = 'todo-explorer-content';
    content.style.cssText = 'overflow-y:auto;flex:1;padding:4px 0;';
    panelEl.appendChild(content);

    sidebarContainer.appendChild(panelEl);
  }

  function togglePanel() {
    if (!panelEl) return;

    // Hide all other sidebar panels
    var panels = document.querySelectorAll('.sidebar-panel');
    var buttons = document.querySelectorAll('.activity-btn');
    var wasVisible = panelEl.style.display !== 'none';

    for (var i = 0; i < panels.length; i++) {
      panels[i].style.display = 'none';
    }
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].classList.remove('active');
    }

    if (!wasVisible) {
      panelEl.style.display = 'flex';
      var btn = document.getElementById('activity-btn-' + PANEL_ID);
      if (btn) btn.classList.add('active');

      // Ensure sidebar is visible
      var sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.style.display = '';

      // Scan if empty
      if (totalCount === 0 && !isLoading) {
        scanTodos();
      }
    } else {
      // Close sidebar if this was the only panel
      var sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.style.display = 'none';
    }
  }

  function updateBadge() {
    if (!badgeEl) return;
    if (totalCount > 0) {
      badgeEl.textContent = totalCount > 99 ? '99+' : totalCount;
      badgeEl.style.display = 'block';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  function renderResults() {
    var content = document.getElementById('todo-explorer-content');
    if (!content) return;

    if (isLoading) {
      content.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-dim,#888);font-size:12px;">Scanning files...</div>';
      return;
    }

    var files = Object.keys(todoData);
    if (files.length === 0) {
      content.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-dim,#888);font-size:12px;">No TODOs found</div>';
      return;
    }

    var html = '';
    for (var fi = 0; fi < files.length; fi++) {
      var file = files[fi];
      var items = todoData[file];
      var shortFile = file.replace(/\\/g, '/');
      // Show only last 2-3 path segments
      var segments = shortFile.split('/');
      var display = segments.length > 3
        ? segments.slice(-3).join('/')
        : shortFile;

      html += '<div class="todo-file-group" style="margin-bottom:2px;">';
      html += '<div class="todo-file-header" data-file="' + file + '" style="padding:4px 12px;font-size:11px;font-weight:600;color:var(--text, #ccc);cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none;">';
      html += '<span style="font-size:10px;color:var(--text-dim);">\u25B6</span>';
      html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + file + '">' + escapeHtml(display) + '</span>';
      html += '<span style="font-size:10px;color:var(--text-dim);background:var(--bg-hover, #2a2a2a);border-radius:8px;padding:1px 6px;">' + items.length + '</span>';
      html += '</div>';
      html += '<div class="todo-file-items" data-file-items="' + file + '" style="display:none;">';

      for (var ii = 0; ii < items.length; ii++) {
        var item = items[ii];
        var tagColor = getTagColor(item.tag);
        html += '<div class="todo-item" data-path="' + file + '" data-line="' + item.line + '" style="padding:3px 12px 3px 28px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:6px;color:var(--text-dim, #999);" onmouseover="this.style.background=\'var(--bg-hover, #2a2a2a)\'" onmouseout="this.style.background=\'none\'">';
        html += '<span style="font-size:9px;font-weight:700;color:' + tagColor + ';min-width:36px;">' + escapeHtml(item.tag) + '</span>';
        html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(item.text) + '">' + escapeHtml(item.text) + '</span>';
        html += '<span style="font-size:10px;color:var(--text-dim);opacity:0.6;">:' + item.line + '</span>';
        html += '</div>';
      }

      html += '</div></div>';
    }

    content.innerHTML = html;

    // Attach click handlers for file headers (toggle collapse)
    var headers = content.querySelectorAll('.todo-file-header');
    for (var hi = 0; hi < headers.length; hi++) {
      (function (header) {
        header.addEventListener('click', function () {
          var file = header.getAttribute('data-file');
          var itemsEl = content.querySelector('[data-file-items="' + file + '"]');
          var arrow = header.querySelector('span');
          if (itemsEl) {
            if (itemsEl.style.display === 'none') {
              itemsEl.style.display = 'block';
              if (arrow) arrow.textContent = '\u25BC'; // ▼
            } else {
              itemsEl.style.display = 'none';
              if (arrow) arrow.textContent = '\u25B6'; // ▶
            }
          }
        });
      })(headers[hi]);
    }

    // Attach click handlers for todo items
    var todoItems = content.querySelectorAll('.todo-item');
    for (var ti = 0; ti < todoItems.length; ti++) {
      (function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var path = el.getAttribute('data-path');
          var line = parseInt(el.getAttribute('data-line'), 10);
          if (path && PiPilot.editor && PiPilot.editor.openFile) {
            PiPilot.editor.openFile(path, { line: line, col: 0 });
          }
        });
      })(todoItems[ti]);
    }

    // Auto-expand first file
    if (headers.length > 0) {
      headers[0].click();
    }
  }

  function getTagColor(tag) {
    switch (tag) {
      case 'TODO': return '#61afef';
      case 'FIXME': return '#e06c75';
      case 'HACK': return '#e5c07b';
      case 'XXX': return '#c678dd';
      default: return '#abb2bf';
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function scanTodos() {
    if (!api || !api.files || !api.files.search) {
      toast('File search API not available', 'error');
      return;
    }

    isLoading = true;
    renderResults();

    var projectPath = getProjectPath();

    try {
      var result = api.files.search(projectPath, PATTERN, {
        regex: true,
        includePattern: '*.{js,jsx,ts,tsx,css,scss,html,vue,svelte,py,rb,go,rs,java,c,cpp,h,hpp,md,txt}',
        maxResults: 500
      });

      // Handle both promise and sync results
      if (result && typeof result.then === 'function') {
        result.then(function (data) {
          processSearchResults(data);
        }).catch(function (err) {
          isLoading = false;
          todoData = {};
          totalCount = 0;
          updateBadge();
          renderResults();
          toast('TODO scan failed: ' + (err.message || err), 'error');
        });
      } else {
        processSearchResults(result);
      }
    } catch (err) {
      isLoading = false;
      todoData = {};
      totalCount = 0;
      updateBadge();
      renderResults();
      toast('TODO scan error: ' + (err.message || err), 'error');
    }
  }

  function processSearchResults(data) {
    isLoading = false;
    todoData = {};
    totalCount = 0;

    if (!data) {
      updateBadge();
      renderResults();
      return;
    }

    // Normalize data format — could be array of matches or {results: [...]}
    var matches = Array.isArray(data) ? data : (data.results || data.matches || []);

    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var file = m.file || m.path || m.filePath || '';
      var line = m.line || m.lineNumber || m.row || 0;
      var text = m.text || m.content || m.match || '';

      // Extract the tag
      var tagMatch = text.match(/(TODO|FIXME|HACK|XXX)/);
      var tag = tagMatch ? tagMatch[1] : 'TODO';

      // Clean up text
      var cleanText = text.trim();
      // Remove leading comment chars
      cleanText = cleanText.replace(/^[\s]*(?:\/\/|\/\*|\*|#|--|%)\s*/, '');
      // Trim to just the relevant part after the tag
      var tagIdx = cleanText.indexOf(tag);
      if (tagIdx !== -1) {
        cleanText = cleanText.substring(tagIdx + tag.length).replace(/^[\s:]+/, '');
      }
      if (!cleanText) cleanText = '(no description)';

      if (!todoData[file]) todoData[file] = [];
      todoData[file].push({
        line: line,
        text: cleanText,
        tag: tag
      });
      totalCount++;
    }

    updateBadge();
    renderResults();
  }

  // Initialize
  registerPanel();

  // Rescan on file save
  if (bus && bus.on) {
    bus.on('file:saved', function () {
      // Debounce rescan
      clearTimeout(scanTodos._timer);
      scanTodos._timer = setTimeout(scanTodos, 2000);
    });
  }

  console.log('[ext:todo-explorer] TODO Explorer loaded');
})(PiPilot, bus, api, state, typeof db !== 'undefined' ? db : null);
