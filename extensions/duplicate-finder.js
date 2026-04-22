// PiPilot IDE Extension: Duplicate Line Finder
// Shortcut mod+shift+u scans current file for duplicate lines.
// Shows count in a toast and highlights duplicates with yellow markers.

(function (PiPilot, bus, api, state, db) {

  var STYLE_ID = 'pipilot-duplicate-finder-styles';
  var MARKER_CLASS = 'pipilot-dup-highlight';
  var markerIds = [];
  var dupMap = {}; // normalized line -> [row indices]

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function toast(message, type) {
    if (bus && bus.emit) {
      bus.emit('toast:show', { message: message, type: type || 'info' });
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '\
.pipilot-dup-highlight { \
  position: absolute; \
  background: rgba(250, 204, 21, 0.15); \
  border-left: 3px solid #facc15; \
  z-index: 5; \
} \
.pipilot-dup-gutter { \
  color: #facc15 !important; \
  font-weight: bold; \
} \
';
    document.head.appendChild(style);
  }

  function clearMarkers() {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    for (var i = 0; i < markerIds.length; i++) {
      session.removeMarker(markerIds[i]);
    }
    markerIds = [];

    // Clear gutter decorations
    var lineCount = session.getLength();
    for (var r = 0; r < lineCount; r++) {
      session.removeGutterDecoration(r, 'pipilot-dup-gutter');
    }

    dupMap = {};
  }

  function findDuplicates() {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    // Clear previous
    clearMarkers();
    ensureStyles();

    var lines = session.getValue().split('\n');
    var lineMap = {}; // normalized -> [row indices]
    var totalDupLines = 0;
    var dupGroups = 0;

    for (var i = 0; i < lines.length; i++) {
      var normalized = lines[i].trim();
      // Skip blank and whitespace-only lines
      if (!normalized) continue;

      if (!lineMap[normalized]) {
        lineMap[normalized] = [];
      }
      lineMap[normalized].push(i);
    }

    // Filter to only lines that appear more than once
    var Range = ace.require('ace/range').Range;

    for (var key in lineMap) {
      if (!lineMap.hasOwnProperty(key)) continue;
      var rows = lineMap[key];
      if (rows.length < 2) continue;

      dupGroups++;
      totalDupLines += rows.length;

      for (var j = 0; j < rows.length; j++) {
        var row = rows[j];
        var range = new Range(row, 0, row, lines[row].length);
        var markerId = session.addMarker(range, MARKER_CLASS, 'fullLine', false);
        markerIds.push(markerId);
        session.addGutterDecoration(row, 'pipilot-dup-gutter');
      }
    }

    dupMap = lineMap;

    if (dupGroups === 0) {
      toast('No duplicate lines found', 'success');
    } else {
      toast('Found ' + totalDupLines + ' duplicate lines in ' + dupGroups + ' group' + (dupGroups !== 1 ? 's' : ''), 'warning');
    }
  }

  function jumpToNextDuplicate() {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    var cursor = editor.getCursorPosition();
    var currentLine = session.getLine(cursor.row).trim();

    if (!currentLine || !dupMap[currentLine] || dupMap[currentLine].length < 2) return;

    var rows = dupMap[currentLine];
    // Find next occurrence after current row
    var nextRow = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] > cursor.row) {
        nextRow = rows[i];
        break;
      }
    }
    // Wrap around
    if (nextRow === -1) {
      nextRow = rows[0];
    }

    editor.gotoLine(nextRow + 1, 0, true);
    editor.centerSelection();
  }

  // Register shortcut
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+u', findDuplicates);
  } else {
    var editor = getEditor();
    if (editor) {
      editor.commands.addCommand({
        name: 'findDuplicates',
        bindKey: { win: 'Ctrl-Shift-U', mac: 'Cmd-Shift-U' },
        exec: findDuplicates
      });
    }
  }

  // Clear markers on file change
  bus.on('editor:active-changed', function () {
    clearMarkers();
  });

  // Click on gutter to jump between duplicates
  function initGutterClick() {
    var editor = getEditor();
    if (!editor) {
      setTimeout(initGutterClick, 1000);
      return;
    }

    editor.on('guttermousedown', function (e) {
      var row = e.getDocumentPosition().row;
      var session = editor.getSession();
      if (!session) return;

      var lineText = session.getLine(row).trim();
      if (lineText && dupMap[lineText] && dupMap[lineText].length >= 2) {
        // Set cursor to this row then jump to next dup
        editor.gotoLine(row + 1, 0, false);
        setTimeout(jumpToNextDuplicate, 50);
        e.stop();
      }
    });
  }

  initGutterClick();
  console.log('[ext:duplicate-finder] Duplicate Line Finder loaded (Mod+Shift+U)');

})(PiPilot, bus, api, state, db);
