// PiPilot IDE Extension: Git Blame Inline
// Shows git blame annotation at end of current line as dim text.
// Updates when cursor moves. Shows author + relative time in status bar.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (!editor) return;

  // ── Styles ──
  var style = document.createElement('style');
  style.textContent = '\
.git-blame-ghost { \
  position: absolute; \
  right: 0; \
  pointer-events: none; \
  color: var(--text-dim, #555); \
  opacity: 0.5; \
  font-size: 11px; \
  font-style: italic; \
  font-family: var(--font-mono, monospace); \
  white-space: nowrap; \
  padding-left: 24px; \
}\
';
  document.head.appendChild(style);

  // ── Status bar item ──
  var statusBar = document.querySelector('.status-right');
  var statusItem = null;
  if (statusBar) {
    statusItem = document.createElement('span');
    statusItem.className = 'status-item';
    statusItem.style.cssText = 'font-size:10px;color:var(--text-dim);font-family:var(--font-mono);cursor:default;';
    statusItem.title = 'Git blame';
    statusBar.insertBefore(statusItem, statusBar.firstChild);
  }

  // ── Blame cache ──
  var blameCache = {};
  var currentFile = null;
  var ghostWidget = null;
  var lastRow = -1;

  function relativeTime(dateStr) {
    if (!dateStr) return '';
    var now = Date.now();
    var then = new Date(dateStr).getTime();
    if (isNaN(then)) return dateStr;
    var diff = Math.floor((now - then) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
    if (diff < 31536000) return Math.floor(diff / 2592000) + 'mo ago';
    return Math.floor(diff / 31536000) + 'y ago';
  }

  function removeGhost() {
    if (ghostWidget) {
      try { ghostWidget.remove(); } catch (e) {}
      ghostWidget = null;
    }
  }

  function showGhost(row, text) {
    removeGhost();
    var session = editor.getSession();
    if (!session) return;
    var renderer = editor.renderer;
    if (!renderer) return;

    var lineEl = renderer.$textLayer.element;
    if (!lineEl) return;

    // Create ghost element
    ghostWidget = document.createElement('span');
    ghostWidget.className = 'git-blame-ghost';
    ghostWidget.textContent = text;
    ghostWidget.dataset.row = row;

    // Position on the correct line using Ace's line elements
    var config = renderer.layerConfig;
    if (!config) return;
    var lineHeight = config.lineHeight || 18;
    var firstRow = config.firstRow || 0;
    var y = (row - firstRow) * lineHeight;

    ghostWidget.style.position = 'absolute';
    ghostWidget.style.top = y + 'px';
    ghostWidget.style.right = '16px';
    ghostWidget.style.height = lineHeight + 'px';
    ghostWidget.style.lineHeight = lineHeight + 'px';

    lineEl.parentNode.appendChild(ghostWidget);
  }

  function fetchBlame(filePath) {
    if (!filePath || !state.projectPath) return;
    if (blameCache[filePath]) return;

    // Use git log to get per-line blame data
    // We run git blame via terminal or api.git.log as a workaround
    // Since there's no direct blame API, we'll use git log for the file
    // and parse commit info. For a real blame we'd need line-by-line data.
    // Approach: run git blame via api.terminal or just use git log commits.

    // Store a pending flag
    blameCache[filePath] = { loading: true, lines: {} };

    // Try to get blame data by running git blame command
    if (api.terminal && api.terminal.create) {
      var blameLines = [];
      var termId = null;
      api.terminal.create({ cwd: state.projectPath }).then(function (term) {
        termId = term.id;
        var output = '';
        api.terminal.onData(termId, function (data) {
          output += data;
        });
        // Use a relative path
        var rel = filePath;
        if (rel.indexOf(state.projectPath) === 0) {
          rel = rel.substring(state.projectPath.length).replace(/^[/\\]/, '');
        }
        api.terminal.write(termId, 'git blame --porcelain "' + rel.replace(/\\/g, '/') + '" 2>/dev/null && echo "___BLAME_DONE___"\n');

        // Parse after a delay
        setTimeout(function () {
          parseBlameOutput(filePath, output);
          try { api.terminal.destroy(termId); } catch (e) {}
        }, 2000);
      }).catch(function () {
        blameCache[filePath] = { loading: false, lines: {} };
      });
    } else {
      // Fallback: use git log for file
      if (api.git && api.git.log) {
        api.git.log(state.projectPath, { limit: 50, file: filePath }).then(function (resp) {
          var commits = resp && resp.commits ? resp.commits : (Array.isArray(resp) ? resp : []);
          blameCache[filePath] = { loading: false, lines: {}, lastCommit: commits[0] || null };
          updateBlameDisplay();
        }).catch(function () {
          blameCache[filePath] = { loading: false, lines: {} };
        });
      }
    }
  }

  function parseBlameOutput(filePath, output) {
    var lines = output.split('\n');
    var cache = { loading: false, lines: {} };
    var currentHash = '';
    var authors = {};
    var times = {};
    var lineNum = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === '___BLAME_DONE___') break;

      // Line format in porcelain: <hash> <orig-line> <final-line> [<num-lines>]
      var hashMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
      if (hashMatch) {
        currentHash = hashMatch[1];
        lineNum = parseInt(hashMatch[3], 10);
        continue;
      }

      if (line.indexOf('author ') === 0) {
        authors[currentHash] = line.substring(7);
      }
      if (line.indexOf('author-time ') === 0) {
        var ts = parseInt(line.substring(12), 10);
        times[currentHash] = new Date(ts * 1000).toISOString();
      }
      if (line.indexOf('\t') === 0 && currentHash) {
        // This is the content line - record blame for this line number
        cache.lines[lineNum] = {
          hash: currentHash,
          author: authors[currentHash] || 'Unknown',
          time: times[currentHash] || ''
        };
      }
    }

    blameCache[filePath] = cache;
    updateBlameDisplay();
  }

  function updateBlameDisplay() {
    var filePath = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    if (!filePath) { removeGhost(); return; }

    var row = editor.getCursorPosition().row;
    var lineNum = row + 1;
    var cache = blameCache[filePath];

    if (!cache || cache.loading) {
      removeGhost();
      if (statusItem) statusItem.textContent = '';
      return;
    }

    var info = cache.lines[lineNum];
    if (info) {
      var text = info.author + ', ' + relativeTime(info.time);
      showGhost(row, text);
      if (statusItem) statusItem.textContent = '\u{1F464} ' + info.author;
    } else if (cache.lastCommit) {
      // Fallback: show last commit info
      var c = cache.lastCommit;
      var author = c.author || c.authorName || 'Unknown';
      var time = c.date || c.authorDate || '';
      var text = author + ', ' + relativeTime(time);
      showGhost(row, text);
      if (statusItem) statusItem.textContent = author;
    } else {
      removeGhost();
      if (statusItem) statusItem.textContent = '';
    }
  }

  // ── Event Handlers ──
  var debounceTimer = null;

  editor.selection.on('changeCursor', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      var row = editor.getCursorPosition().row;
      if (row !== lastRow) {
        lastRow = row;
        updateBlameDisplay();
      }
    }, 150);
  });

  // On scroll, reposition ghost
  editor.renderer.on('afterRender', function () {
    if (ghostWidget) {
      var row = parseInt(ghostWidget.dataset.row, 10);
      var config = editor.renderer.layerConfig;
      if (config) {
        var lineHeight = config.lineHeight || 18;
        var firstRow = config.firstRow || 0;
        var y = (row - firstRow) * lineHeight;
        ghostWidget.style.top = y + 'px';
      }
    }
  });

  bus.on('editor:active-changed', function () {
    removeGhost();
    lastRow = -1;
    var filePath = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    if (filePath && !blameCache[filePath]) {
      fetchBlame(filePath);
    } else {
      updateBlameDisplay();
    }
  });

  // Initial load
  setTimeout(function () {
    var filePath = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    if (filePath) fetchBlame(filePath);
  }, 1000);

  console.log('[ext:git-blame-inline] Git Blame Inline extension loaded');
})(PiPilot, bus, api, state, db);
