// PiPilot IDE Extension: File Size Indicator
// Status bar item showing file size, line count, and character count.

(function (PiPilot, bus, api, state, db) {

  var WARN_LINES = 500;
  var WARN_KB = 50;

  var statusBar = document.querySelector('.status-right');
  if (!statusBar) return;

  var item = document.createElement('span');
  item.className = 'status-item';
  item.style.cssText = 'font-size:10px;color:var(--text-dim);font-family:var(--font-mono);cursor:default;padding:0 6px;transition:color 0.2s;';
  item.title = 'File size info';
  statusBar.insertBefore(item, statusBar.firstChild);

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    var kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    var mb = kb / 1024;
    return mb.toFixed(2) + ' MB';
  }

  function update() {
    var editor = getEditor();
    if (!editor) {
      item.textContent = '';
      item.title = '';
      return;
    }

    var session = editor.getSession();
    if (!session) {
      item.textContent = '';
      return;
    }

    var text = session.getValue();
    var lines = session.getLength();
    var chars = text.length;
    var bytes = new Blob([text]).size; // accurate byte count (handles UTF-8)
    var kb = bytes / 1024;

    // Check warnings
    var warnings = [];
    var isWarning = false;

    if (lines > WARN_LINES) {
      warnings.push(lines + ' lines (>' + WARN_LINES + ')');
      isWarning = true;
    }
    if (kb > WARN_KB) {
      warnings.push(formatBytes(bytes) + ' (>' + WARN_KB + 'KB)');
      isWarning = true;
    }

    // Set color
    if (isWarning) {
      item.style.color = '#e5c07b'; // yellow warning
    } else {
      item.style.color = 'var(--text-dim)';
    }

    // Build display text
    var display = formatBytes(bytes) + '  ' + lines + ' ln  ' + chars + ' ch';
    item.textContent = display;

    // Tooltip
    var tooltip = 'Size: ' + formatBytes(bytes) + '\nLines: ' + lines + '\nCharacters: ' + chars;
    if (warnings.length > 0) {
      tooltip += '\n\nWarnings:\n' + warnings.join('\n');
    }
    item.title = tooltip;
  }

  // Listen for events
  if (bus && bus.on) {
    bus.on('editor:active-changed', update);
    bus.on('editor:dirty-changed', update);
  }

  // Hook into Ace change events for live updates
  var ace = getEditor();
  if (ace) {
    var timer = null;
    ace.on('change', function () {
      clearTimeout(timer);
      timer = setTimeout(update, 300);
    });
  }

  // Initial update
  setTimeout(update, 500);

  console.log('[ext:file-size-indicator] File Size Indicator loaded');
})(PiPilot, bus, api, state, typeof db !== 'undefined' ? db : null);
