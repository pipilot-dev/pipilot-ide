// PiPilot IDE Extension: Timestamp Converter
// Shows inline annotation when cursor is on a Unix timestamp.
// Right-click "Insert Current Timestamp". Status bar shows current time.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (!editor) return;

  // ── Styles ──
  var style = document.createElement('style');
  style.textContent = '\
.ts-conv-ghost { \
  position: absolute; \
  right: 0; \
  pointer-events: none; \
  color: var(--info, #58a6ff); \
  opacity: 0.65; \
  font-size: 11px; \
  font-family: var(--font-mono, monospace); \
  white-space: nowrap; \
  padding-left: 24px; \
}\
';
  document.head.appendChild(style);

  // ── Status bar clock ──
  var statusBar = document.querySelector('.status-right');
  var clockItem = null;
  if (statusBar) {
    clockItem = document.createElement('span');
    clockItem.className = 'status-item';
    clockItem.style.cssText = 'font-size:10px;color:var(--text-dim);font-family:var(--font-mono);cursor:default;';
    clockItem.title = 'Current time (Timestamp Converter)';
    statusBar.insertBefore(clockItem, statusBar.firstChild);
  }

  function updateClock() {
    if (!clockItem) return;
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    clockItem.textContent = '\u23F0 ' + h + ':' + m + ':' + s;
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ── Ghost annotation ──
  var ghostEl = null;
  var lastRow = -1;

  function removeGhost() {
    if (ghostEl) {
      try { ghostEl.remove(); } catch (e) {}
      ghostEl = null;
    }
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatTimestamp(ts) {
    // ts is in seconds or milliseconds
    var ms = ts;
    if (ts < 1e12) ms = ts * 1000; // seconds -> ms
    var d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    // Sanity check: year between 2000 and 2100
    var yr = d.getFullYear();
    if (yr < 1970 || yr > 2100) return null;
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function extractTimestamp(line) {
    // Find 10 or 13 digit numbers in the line
    var match = line.match(/\b(\d{10}|\d{13})\b/);
    if (!match) return null;
    var num = Number(match[1]);
    var formatted = formatTimestamp(num);
    if (!formatted) return null;
    return formatted;
  }

  function showGhost(row, text) {
    removeGhost();
    var renderer = editor.renderer;
    if (!renderer || !renderer.$textLayer || !renderer.$textLayer.element) return;

    var lineEl = renderer.$textLayer.element;
    var config = renderer.layerConfig;
    if (!config) return;

    ghostEl = document.createElement('div');
    ghostEl.className = 'ts-conv-ghost';
    ghostEl.textContent = '  \u2192 ' + text;
    ghostEl.style.top = ((row - config.firstRow) * config.lineHeight) + 'px';
    ghostEl.style.height = config.lineHeight + 'px';
    ghostEl.style.lineHeight = config.lineHeight + 'px';
    lineEl.appendChild(ghostEl);
  }

  function onCursorChange() {
    var pos = editor.getCursorPosition();
    if (!pos) { removeGhost(); return; }
    var row = pos.row;
    if (row === lastRow) return;
    lastRow = row;

    var session = editor.getSession();
    if (!session) { removeGhost(); return; }
    var line = session.getLine(row);
    if (!line) { removeGhost(); return; }

    var formatted = extractTimestamp(line);
    if (formatted) {
      showGhost(row, formatted);
    } else {
      removeGhost();
    }
  }

  editor.selection.on('changeCursor', onCursorChange);
  editor.renderer.on('afterRender', function () {
    // Re-render ghost after scroll
    if (lastRow >= 0) {
      var session = editor.getSession();
      if (session) {
        var line = session.getLine(lastRow);
        if (line) {
          var formatted = extractTimestamp(line);
          if (formatted) {
            showGhost(lastRow, formatted);
            return;
          }
        }
      }
      removeGhost();
    }
  });

  // ── Context menu: Insert Current Timestamp ──
  var editorContainer = document.getElementById('editor-container') || document.getElementById('monaco-host');
  if (editorContainer) {
    editorContainer.addEventListener('contextmenu', function (e) {
      // Only intercept right-clicks on the editor area
      if (!e.target.closest('.ace_editor')) return;

      // We add items to the context menu via bus
      // Use setTimeout to allow default contextmenu to be set up, then add items
      setTimeout(function () {
        bus.emit('contextmenu:show', {
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              label: 'Insert Unix Timestamp (seconds)',
              onClick: function () {
                var ts = Math.floor(Date.now() / 1000);
                editor.insert(String(ts));
                bus.emit('toast:show', { message: 'Inserted: ' + ts, type: 'ok' });
              }
            },
            {
              label: 'Insert Unix Timestamp (milliseconds)',
              onClick: function () {
                var ts = Date.now();
                editor.insert(String(ts));
                bus.emit('toast:show', { message: 'Inserted: ' + ts, type: 'ok' });
              }
            },
            {
              label: 'Insert ISO Timestamp',
              onClick: function () {
                var iso = new Date().toISOString();
                editor.insert(iso);
                bus.emit('toast:show', { message: 'Inserted: ' + iso, type: 'ok' });
              }
            }
          ]
        });
      }, 0);
      e.preventDefault();
    });
  }

  console.log('[ext:timestamp-converter] loaded');
})(PiPilot, bus, api, state, db);
