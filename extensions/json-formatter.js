// PiPilot IDE Extension: JSON Formatter
// Format, validate, and minify JSON in the active file via keyboard shortcuts.

(function (PiPilot, bus, api, state, db) {
  var INDENT = 2;

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function isJsonFile() {
    var file = PiPilot.editor && PiPilot.editor.getActiveFile
      ? PiPilot.editor.getActiveFile()
      : null;
    if (!file) return false;
    return /\.json$/i.test(file);
  }

  function toast(message, type) {
    if (bus && bus.emit) {
      bus.emit('toast:show', { message: message, type: type || 'info' });
    }
  }

  function formatJson() {
    var editor = getEditor();
    if (!editor) { toast('No active editor', 'error'); return; }
    if (!isJsonFile()) { toast('Not a JSON file', 'warning'); return; }

    var session = editor.getSession();
    if (!session) return;
    var text = session.getValue();

    try {
      var parsed = JSON.parse(text);
      var formatted = JSON.stringify(parsed, null, INDENT);
      // Only update if different
      if (formatted !== text) {
        var cursor = editor.getCursorPosition();
        session.setValue(formatted);
        // Try to restore cursor near original position
        var maxRow = session.getLength() - 1;
        var row = Math.min(cursor.row, maxRow);
        var maxCol = session.getLine(row).length;
        var col = Math.min(cursor.column, maxCol);
        editor.moveCursorToPosition({ row: row, column: col });
        editor.clearSelection();
        toast('JSON formatted', 'success');
      } else {
        toast('JSON is valid (already formatted)', 'success');
      }
    } catch (e) {
      // Parse the error to extract line info if possible
      var msg = e.message || 'Invalid JSON';
      // Try to find position from error message
      var posMatch = msg.match(/position\s+(\d+)/i);
      if (posMatch) {
        var pos = parseInt(posMatch[1], 10);
        // Convert character position to row/col
        var lines = text.split('\n');
        var count = 0;
        for (var i = 0; i < lines.length; i++) {
          if (count + lines[i].length + 1 > pos) {
            editor.moveCursorToPosition({ row: i, column: pos - count });
            editor.clearSelection();
            break;
          }
          count += lines[i].length + 1;
        }
      }
      toast('JSON Error: ' + msg, 'error');
    }
  }

  function minifyJson() {
    var editor = getEditor();
    if (!editor) { toast('No active editor', 'error'); return; }
    if (!isJsonFile()) { toast('Not a JSON file', 'warning'); return; }

    var session = editor.getSession();
    if (!session) return;
    var text = session.getValue();

    try {
      var parsed = JSON.parse(text);
      var minified = JSON.stringify(parsed);
      if (minified !== text) {
        session.setValue(minified);
        editor.moveCursorToPosition({ row: 0, column: 0 });
        editor.clearSelection();
        toast('JSON minified (' + minified.length + ' chars)', 'success');
      } else {
        toast('JSON is already minified', 'info');
      }
    } catch (e) {
      toast('JSON Error: ' + (e.message || 'Invalid JSON'), 'error');
    }
  }

  // Register shortcuts
  if (PiPilot && PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+j', formatJson);
    PiPilot.shortcuts.register('mod+shift+m', minifyJson);
  }

  console.log('[ext:json-formatter] JSON Formatter loaded (Mod+Shift+J format, Mod+Shift+M minify)');
})(PiPilot, bus, api, state, typeof db !== 'undefined' ? db : null);
