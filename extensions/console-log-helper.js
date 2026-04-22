// PiPilot IDE Extension: Console Log Helper
// mod+shift+c: Select variable -> insert console.log('[filename:line]', var, var) on next line.
// mod+shift+x: Remove ALL console.log/console.warn/console.error lines from current file.

(function (PiPilot, bus, api, state, db) {

  function getBaseName(path) {
    if (!path) return 'unknown';
    var parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  // ── mod+shift+c: Insert console.log ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+c', function () {
      var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
      if (!ace) return;

      var selected = ace.getSelectedText();
      if (!selected || !selected.trim()) {
        // If nothing selected, try to get the word under cursor
        var pos = ace.getCursorPosition();
        var session = ace.getSession();
        if (!session) return;
        var line = session.getLine(pos.row);
        if (!line) {
          if (bus && bus.emit) bus.emit('toast:show', { message: 'Select a variable to log', type: 'warn' });
          return;
        }
        // Extract word at cursor position
        var wordRange = session.getWordRange(pos.row, pos.column);
        if (wordRange) {
          selected = session.getTextRange(wordRange);
        }
        if (!selected || !selected.trim()) {
          if (bus && bus.emit) bus.emit('toast:show', { message: 'Select a variable to log', type: 'warn' });
          return;
        }
      }

      var varName = selected.trim();
      // Sanitize for string literal (escape quotes)
      var safeLabel = varName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      var session2 = ace.getSession();
      var pos2 = ace.getCursorPosition();
      var currentLine = session2.getLine(pos2.row);

      // Get filename
      var filePath = PiPilot.editor && PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
      var fileName = getBaseName(filePath);

      // Line number is 1-based for display
      var lineNum = pos2.row + 2; // +2 because we insert on the NEXT line (1-indexed)

      // Detect indentation from current line
      var indentMatch = currentLine.match(/^(\s*)/);
      var indent = indentMatch ? indentMatch[1] : '';

      var logLine = indent + "console.log('[" + fileName + ":" + lineNum + "]', '" + safeLabel + "', " + varName + ");";

      // Move to end of current line
      ace.navigateTo(pos2.row, currentLine.length);
      // Insert new line
      ace.insert('\n' + logLine);

      // Place cursor after the inserted line
      ace.navigateTo(pos2.row + 1, logLine.length);

      if (bus && bus.emit) {
        bus.emit('toast:show', { message: 'Inserted console.log for: ' + varName, type: 'ok' });
      }
    });
  }

  // ── mod+shift+x: Remove all console.log/warn/error lines ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+x', function () {
      var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
      if (!ace) return;

      var session = ace.getSession();
      if (!session) return;

      var doc = session.getDocument();
      if (!doc) return;

      var lines = doc.getAllLines();
      var removedCount = 0;
      var newLines = [];

      // Match console.log, console.warn, console.error (single-line)
      var logRegex = /^\s*console\.(log|warn|error)\s*\(/;

      for (var i = 0; i < lines.length; i++) {
        if (logRegex.test(lines[i])) {
          removedCount++;
        } else {
          newLines.push(lines[i]);
        }
      }

      if (removedCount === 0) {
        if (bus && bus.emit) bus.emit('toast:show', { message: 'No console.log/warn/error statements found', type: 'info' });
        return;
      }

      // Replace entire document content
      var fullRange = {
        start: { row: 0, column: 0 },
        end: { row: lines.length - 1, column: (lines[lines.length - 1] || '').length }
      };
      session.replace(fullRange, newLines.join('\n'));

      if (bus && bus.emit) {
        bus.emit('toast:show', {
          message: 'Removed ' + removedCount + ' console log line' + (removedCount !== 1 ? 's' : ''),
          type: 'ok'
        });
      }
    });
  }

  console.log('[ext:console-log-helper] loaded');
})(PiPilot, bus, api, state, db);
