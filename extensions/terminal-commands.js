// PiPilot IDE Extension: Terminal Command Palette
// mod+shift+t opens a floating command palette with project scripts,
// common commands, search/filter, and recent command history.

(function (PiPilot, bus, api, state, db) {

  var DB_KEY = 'terminal-commands:recent';
  var MAX_RECENT = 20;
  var overlayEl = null;
  var paletteEl = null;
  var inputEl = null;
  var listEl = null;
  var selectedIdx = -1;
  var currentItems = [];

  function getRecent() {
    var raw = db.get(DB_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
  }

  function saveRecent(list) {
    db.set(DB_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  }

  function addRecent(cmd) {
    var list = getRecent();
    // Remove duplicate
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] === cmd) list.splice(i, 1);
    }
    list.unshift(cmd);
    saveRecent(list);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Styles ──
  var style = document.createElement('style');
  style.textContent = '\
.tcmd-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; justify-content:center; padding-top:15vh; }\
.tcmd-palette { background:var(--surface,#1e1e26); border:1px solid var(--border,#333); border-radius:8px; width:480px; max-height:400px; display:flex; flex-direction:column; box-shadow:0 8px 32px rgba(0,0,0,0.5); font-family:var(--font-sans); overflow:hidden; }\
.tcmd-input { background:var(--bg,#141417); border:none; border-bottom:1px solid var(--border,#333); padding:12px 16px; color:var(--text,#ccc); font-size:14px; outline:none; font-family:var(--font-sans); }\
.tcmd-input::placeholder { color:var(--text-dim,#666); }\
.tcmd-list { overflow-y:auto; flex:1; padding:4px 0; }\
.tcmd-item { padding:8px 16px; cursor:pointer; display:flex; align-items:center; gap:10px; font-size:13px; color:var(--text,#ccc); }\
.tcmd-item:hover, .tcmd-item.selected { background:var(--accent,#6c8cff)22; }\
.tcmd-item.selected { background:var(--accent,#6c8cff)33; }\
.tcmd-item-icon { font-size:14px; width:20px; text-align:center; flex-shrink:0; }\
.tcmd-item-text { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\
.tcmd-item-badge { font-size:10px; padding:2px 6px; border-radius:3px; background:var(--border,#333); color:var(--text-dim,#888); }\
.tcmd-section { padding:6px 16px 4px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-dim,#666); font-weight:600; }\
.tcmd-empty { padding:24px 16px; text-align:center; color:var(--text-dim,#666); font-size:13px; }\
';
  document.head.appendChild(style);

  // ── Common commands ──
  var COMMON_COMMANDS = [
    { cmd: 'npm install', icon: '\uD83D\uDCE6', badge: 'npm' },
    { cmd: 'npm run dev', icon: '\u25B6', badge: 'npm' },
    { cmd: 'npm run build', icon: '\uD83D\uDD28', badge: 'npm' },
    { cmd: 'npm test', icon: '\uD83E\uDDEA', badge: 'npm' },
    { cmd: 'npm run lint', icon: '\uD83D\uDD0D', badge: 'npm' },
    { cmd: 'npx tsc --noEmit', icon: '\u2713', badge: 'ts' },
    { cmd: 'git status', icon: '\uD83D\uDCCB', badge: 'git' },
    { cmd: 'git pull', icon: '\u2B07', badge: 'git' },
    { cmd: 'git push', icon: '\u2B06', badge: 'git' },
    { cmd: 'git log --oneline -10', icon: '\uD83D\uDCC4', badge: 'git' },
    { cmd: 'git diff', icon: '\u00B1', badge: 'git' },
    { cmd: 'git stash', icon: '\uD83D\uDCE5', badge: 'git' },
    { cmd: 'git stash pop', icon: '\uD83D\uDCE4', badge: 'git' }
  ];

  // ── Run command ──
  function runCommand(cmd) {
    addRecent(cmd);
    closePalette();

    if (api && api.terminal) {
      try {
        var term = api.terminal.create({ cwd: state && state.projectPath ? state.projectPath : undefined });
        if (term && term.id !== undefined) {
          setTimeout(function () {
            api.terminal.write(term.id, cmd + '\n');
          }, 200);
        }
      } catch (e) {
        console.warn('[ext:terminal-commands] terminal error:', e);
      }
    }

    if (bus && bus.emit) {
      bus.emit('toast:show', { message: 'Running: ' + cmd, type: 'info' });
    }
  }

  // ── Build items list ──
  function buildItems(filter, scripts) {
    var items = [];
    var filterLower = (filter || '').toLowerCase();

    // Recent commands
    var recent = getRecent();
    if (recent.length > 0) {
      var recentFiltered = [];
      for (var r = 0; r < recent.length; r++) {
        if (!filterLower || recent[r].toLowerCase().indexOf(filterLower) !== -1) {
          recentFiltered.push({ cmd: recent[r], icon: '\uD83D\uDD52', badge: 'recent', section: 'Recent' });
        }
      }
      items = items.concat(recentFiltered.slice(0, 5));
    }

    // Package.json scripts
    if (scripts) {
      var scriptKeys = Object.keys(scripts);
      for (var s = 0; s < scriptKeys.length; s++) {
        var cmd = 'npm run ' + scriptKeys[s];
        if (!filterLower || cmd.toLowerCase().indexOf(filterLower) !== -1 || scriptKeys[s].toLowerCase().indexOf(filterLower) !== -1) {
          items.push({ cmd: cmd, icon: '\u25B6', badge: 'script', section: 'Scripts', detail: scripts[scriptKeys[s]] });
        }
      }
    }

    // Common commands
    for (var c = 0; c < COMMON_COMMANDS.length; c++) {
      var cc = COMMON_COMMANDS[c];
      if (!filterLower || cc.cmd.toLowerCase().indexOf(filterLower) !== -1) {
        // Skip if already in list
        var dupe = false;
        for (var d = 0; d < items.length; d++) {
          if (items[d].cmd === cc.cmd) { dupe = true; break; }
        }
        if (!dupe) {
          items.push({ cmd: cc.cmd, icon: cc.icon, badge: cc.badge, section: 'Common' });
        }
      }
    }

    // If filter looks like a raw command, add option to run it directly
    if (filterLower && filterLower.length > 2) {
      var hasExact = false;
      for (var x = 0; x < items.length; x++) {
        if (items[x].cmd.toLowerCase() === filterLower) { hasExact = true; break; }
      }
      if (!hasExact) {
        items.push({ cmd: filter, icon: '\u276F', badge: 'custom', section: 'Run Custom' });
      }
    }

    return items;
  }

  // ── Render list ──
  function renderList(items) {
    if (!listEl) return;
    listEl.innerHTML = '';
    currentItems = items;
    selectedIdx = items.length > 0 ? 0 : -1;

    if (items.length === 0) {
      listEl.innerHTML = '<div class="tcmd-empty">No commands found. Type a command to run it.</div>';
      return;
    }

    var lastSection = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.section && item.section !== lastSection) {
        lastSection = item.section;
        var sectionEl = document.createElement('div');
        sectionEl.className = 'tcmd-section';
        sectionEl.textContent = lastSection;
        listEl.appendChild(sectionEl);
      }

      var el = document.createElement('div');
      el.className = 'tcmd-item' + (i === selectedIdx ? ' selected' : '');
      el.setAttribute('data-idx', i);
      el.innerHTML = '<span class="tcmd-item-icon">' + (item.icon || '') + '</span>' +
        '<span class="tcmd-item-text">' + escapeHtml(item.cmd) + '</span>' +
        '<span class="tcmd-item-badge">' + escapeHtml(item.badge || '') + '</span>';
      if (item.detail) {
        el.title = item.detail;
      }

      (function (idx) {
        el.addEventListener('click', function () {
          runCommand(currentItems[idx].cmd);
        });
      })(i);

      listEl.appendChild(el);
    }
  }

  function updateSelection() {
    if (!listEl) return;
    var all = listEl.querySelectorAll('.tcmd-item');
    for (var i = 0; i < all.length; i++) {
      var idx = parseInt(all[i].getAttribute('data-idx'), 10);
      if (idx === selectedIdx) {
        all[i].classList.add('selected');
        all[i].scrollIntoView({ block: 'nearest' });
      } else {
        all[i].classList.remove('selected');
      }
    }
  }

  // ── Open/close palette ──
  var cachedScripts = null;

  function openPalette() {
    if (overlayEl) { closePalette(); return; }

    overlayEl = document.createElement('div');
    overlayEl.className = 'tcmd-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) closePalette();
    });

    paletteEl = document.createElement('div');
    paletteEl.className = 'tcmd-palette';

    inputEl = document.createElement('input');
    inputEl.className = 'tcmd-input';
    inputEl.placeholder = 'Type a command or search...';
    inputEl.setAttribute('spellcheck', 'false');
    paletteEl.appendChild(inputEl);

    listEl = document.createElement('div');
    listEl.className = 'tcmd-list';
    paletteEl.appendChild(listEl);

    overlayEl.appendChild(paletteEl);
    document.body.appendChild(overlayEl);

    inputEl.focus();

    // Load scripts from package.json
    var projectPath = state && state.projectPath;
    if (projectPath && !cachedScripts) {
      api.files.read(projectPath + '/package.json').then(function (res) {
        try {
          var pkg = JSON.parse(res.content);
          cachedScripts = pkg.scripts || {};
        } catch (e) { cachedScripts = {}; }
        renderList(buildItems('', cachedScripts));
      }).catch(function () {
        cachedScripts = {};
        renderList(buildItems('', cachedScripts));
      });
    } else {
      renderList(buildItems('', cachedScripts || {}));
    }

    // Input handlers
    inputEl.addEventListener('input', function () {
      renderList(buildItems(inputEl.value, cachedScripts || {}));
    });

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedIdx < currentItems.length - 1) { selectedIdx++; updateSelection(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedIdx > 0) { selectedIdx--; updateSelection(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIdx >= 0 && selectedIdx < currentItems.length) {
          runCommand(currentItems[selectedIdx].cmd);
        } else if (inputEl.value.trim()) {
          runCommand(inputEl.value.trim());
        }
      }
    });
  }

  function closePalette() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    paletteEl = null;
    inputEl = null;
    listEl = null;
    selectedIdx = -1;
    currentItems = [];
  }

  // ── Register shortcut ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+t', function () {
      openPalette();
    });
  }

  console.log('[ext:terminal-commands] loaded');
})(PiPilot, bus, api, state, db);
