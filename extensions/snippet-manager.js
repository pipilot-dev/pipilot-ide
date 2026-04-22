// PiPilot IDE Extension: Snippet Manager
// Sidebar panel with activity bar button. Save, list, search, insert, delete snippets.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;

  var DB_KEY = 'snippets:list';

  // ── Helpers ──
  function getSnippets() {
    var raw = db.get(DB_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
  }

  function saveSnippets(list) {
    db.set(DB_KEY, JSON.stringify(list));
  }

  function getFileLanguage(filePath) {
    if (!filePath) return 'text';
    var ext = filePath.split('.').pop().toLowerCase();
    var map = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
      html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown',
      sh: 'bash', yml: 'yaml', yaml: 'yaml', sql: 'sql', c: 'c', cpp: 'cpp',
      cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin'
    };
    return map[ext] || ext;
  }

  function timeAgo(ts) {
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Styles ──
  var style = document.createElement('style');
  style.textContent = '\
.snip-wrap { display:flex; flex-direction:column; height:100%; background:var(--bg,#141417); color:var(--text,#b0b0b8); font-family:var(--font-sans); }\
.snip-header { display:flex; align-items:center; padding:10px 12px; gap:8px; border-bottom:1px solid var(--border,#2e2e35); }\
.snip-header-title { font-weight:600; font-size:13px; flex:1; }\
.snip-search { width:100%; padding:6px 10px; background:var(--input-bg,#1c1c21); color:var(--text,#b0b0b8); border:1px solid var(--border,#2e2e35); border-radius:4px; font-size:12px; outline:none; margin:8px 12px; box-sizing:border-box; }\
.snip-search:focus { border-color:var(--accent,#6c8cff); }\
.snip-list { flex:1; overflow-y:auto; padding:4px 0; }\
.snip-item { padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--border,#2e2e35); }\
.snip-item:hover { background:var(--surface-alt,#232329); }\
.snip-item-name { font-size:12px; font-weight:500; margin-bottom:2px; display:flex; justify-content:space-between; align-items:center; }\
.snip-item-meta { font-size:10px; color:var(--text-dim,#555); }\
.snip-item-preview { font-size:10px; color:var(--text-dim,#555); font-family:var(--font-mono); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }\
.snip-item-del { background:none; border:none; color:var(--text-dim,#555); cursor:pointer; font-size:14px; padding:0 4px; line-height:1; }\
.snip-item-del:hover { color:#e55; }\
.snip-empty { padding:24px 12px; text-align:center; color:var(--text-dim,#555); font-size:12px; }\
.snip-save-btn { margin:8px 12px; padding:6px 0; background:var(--accent,#6c8cff); color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-weight:500; }\
.snip-save-btn:hover { opacity:0.9; }\
.snip-save-btn:disabled { opacity:0.4; cursor:default; }\
';
  document.head.appendChild(style);

  // ── Panel renderer ──
  var currentFilter = '';

  PiPilot.panels.snippets = function (container) {
    container.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'snip-wrap';

    // Header
    var header = document.createElement('div');
    header.className = 'snip-header';
    header.innerHTML = '<span class="snip-header-title">Snippets</span>';
    wrap.appendChild(header);

    // Save button
    var saveBtn = document.createElement('button');
    saveBtn.className = 'snip-save-btn';
    saveBtn.textContent = 'Save Selection as Snippet';
    saveBtn.addEventListener('click', function () {
      var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
      if (!ace) return;
      var sel = ace.getSelectedText();
      if (!sel || !sel.trim()) {
        bus.emit('toast:show', { message: 'Select code first', type: 'warn' });
        return;
      }

      var name = prompt('Snippet name:');
      if (!name || !name.trim()) return;

      var filePath = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
      var lang = getFileLanguage(filePath);

      var snippets = getSnippets();
      snippets.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        name: name.trim(),
        language: lang,
        code: sel,
        createdAt: Date.now()
      });
      saveSnippets(snippets);
      renderList();
      bus.emit('toast:show', { message: 'Snippet saved', type: 'ok' });
    });
    wrap.appendChild(saveBtn);

    // Search
    var search = document.createElement('input');
    search.className = 'snip-search';
    search.type = 'text';
    search.placeholder = 'Search snippets...';
    search.value = currentFilter;
    search.addEventListener('input', function () {
      currentFilter = search.value;
      renderList();
    });
    wrap.appendChild(search);

    // List container
    var listEl = document.createElement('div');
    listEl.className = 'snip-list';
    wrap.appendChild(listEl);

    function renderList() {
      listEl.innerHTML = '';
      var snippets = getSnippets();
      var filter = currentFilter.toLowerCase();

      var filtered = snippets.filter(function (s) {
        if (!filter) return true;
        return s.name.toLowerCase().indexOf(filter) !== -1 ||
               s.language.toLowerCase().indexOf(filter) !== -1 ||
               s.code.toLowerCase().indexOf(filter) !== -1;
      });

      if (filtered.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'snip-empty';
        empty.textContent = snippets.length === 0 ? 'No snippets yet. Select code and click "Save Selection".' : 'No matches.';
        listEl.appendChild(empty);
        return;
      }

      for (var i = 0; i < filtered.length; i++) {
        (function (snippet) {
          var item = document.createElement('div');
          item.className = 'snip-item';

          var nameRow = document.createElement('div');
          nameRow.className = 'snip-item-name';

          var nameSpan = document.createElement('span');
          nameSpan.textContent = snippet.name;
          nameRow.appendChild(nameSpan);

          var delBtn = document.createElement('button');
          delBtn.className = 'snip-item-del';
          delBtn.title = 'Delete snippet';
          delBtn.innerHTML = '&times;';
          delBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var snippets = getSnippets().filter(function (s) { return s.id !== snippet.id; });
            saveSnippets(snippets);
            renderList();
            bus.emit('toast:show', { message: 'Snippet deleted', type: 'ok' });
          });
          nameRow.appendChild(delBtn);

          item.appendChild(nameRow);

          var meta = document.createElement('div');
          meta.className = 'snip-item-meta';
          meta.textContent = snippet.language + ' \u00B7 ' + timeAgo(snippet.createdAt);
          item.appendChild(meta);

          var preview = document.createElement('div');
          preview.className = 'snip-item-preview';
          preview.textContent = snippet.code.split('\n')[0].substring(0, 80);
          item.appendChild(preview);

          item.addEventListener('click', function () {
            var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
            if (!ace) {
              bus.emit('toast:show', { message: 'No editor open', type: 'warn' });
              return;
            }
            ace.insert(snippet.code);
            ace.focus();
            bus.emit('toast:show', { message: 'Snippet inserted', type: 'ok' });
          });

          listEl.appendChild(item);
        })(filtered[i]);
      }
    }

    renderList();
    container.appendChild(wrap);
  };

  // ── Activity bar button ──
  var actBar = document.getElementById('activity-bar');
  if (actBar) {
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.dataset.panel = 'snippets';
    btn.title = 'Snippets';
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12L12 12"/><circle cx="18" cy="18" r="3"/><path d="M15.88 15.88L12 12"/><line x1="6" y1="18" x2="18" y2="6"/></svg>';
    btn.addEventListener('click', function () { bus.emit('panel:switch', 'snippets'); });
    actBar.insertBefore(btn, actBar.lastElementChild);
  }

  console.log('[ext:snippet-manager] Snippet Manager extension loaded');
})(PiPilot, bus, api, state, db);
