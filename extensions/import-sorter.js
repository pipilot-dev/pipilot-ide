// PiPilot IDE Extension: Import Sorter
// Shortcut mod+shift+i sorts import/require statements into groups:
// 1) External (node_modules), 2) Absolute paths, 3) Relative paths.

(function (PiPilot, bus, api, state, db) {

  var JS_EXTS = /\.(js|jsx|ts|tsx|mjs|cjs)$/i;
  var IMPORT_RE = /^(import\s+.+\s+from\s+['"](.+)['"]|import\s+['"](.+)['"]|(?:var|let|const)\s+.+\s*=\s*require\s*\(\s*['"](.+)['"]\s*\))/;
  var IMPORT_LINE_RE = /^(?:import\s|(?:var|let|const)\s+\w.+=\s*require\s*\()/;

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function isJsFile() {
    var file = PiPilot.editor && PiPilot.editor.getActiveFile
      ? PiPilot.editor.getActiveFile()
      : null;
    if (!file) return false;
    return JS_EXTS.test(file);
  }

  function toast(message, type) {
    if (bus && bus.emit) {
      bus.emit('toast:show', { message: message, type: type || 'info' });
    }
  }

  function getModulePath(line) {
    var m = IMPORT_RE.exec(line.trim());
    if (!m) return null;
    return m[2] || m[3] || m[4] || null;
  }

  function classifyImport(modPath) {
    if (!modPath) return 1; // absolute by default
    if (modPath.startsWith('./') || modPath.startsWith('../')) return 2; // relative
    if (modPath.startsWith('/') || modPath.startsWith('@/') || /^[A-Z]:/.test(modPath)) return 1; // absolute
    return 0; // external (node_modules)
  }

  function isImportLine(line) {
    var trimmed = line.trim();
    if (!trimmed) return false;
    return IMPORT_LINE_RE.test(trimmed);
  }

  function sortImports() {
    if (!isJsFile()) {
      toast('Import Sorter: Not a JS/TS file', 'warning');
      return;
    }

    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    var lines = session.getValue().split('\n');
    var importLines = [];
    var importStartIdx = -1;
    var importEndIdx = -1;
    var leadingComments = [];

    // Find the block of import lines at the top of the file
    var inImportBlock = false;
    var seenImport = false;

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();

      // Skip leading empty lines and comments before imports
      if (!seenImport) {
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith("'use ") || trimmed.startsWith('"use ')) {
          continue;
        }
      }

      if (isImportLine(trimmed)) {
        if (!seenImport) {
          importStartIdx = i;
          seenImport = true;
        }
        inImportBlock = true;

        // Handle multi-line imports by collecting until we find the closing
        var fullLine = lines[i];
        var braceOpen = (fullLine.match(/{/g) || []).length;
        var braceClose = (fullLine.match(/}/g) || []).length;

        while (braceOpen > braceClose && i + 1 < lines.length) {
          i++;
          fullLine += '\n' + lines[i];
          braceOpen += (lines[i].match(/{/g) || []).length;
          braceClose += (lines[i].match(/}/g) || []).length;
        }

        importLines.push(fullLine);
        importEndIdx = i;
      } else if (seenImport) {
        // Allow blank lines within the import block
        if (!trimmed) {
          importEndIdx = i;
          continue;
        }
        // Non-import, non-blank line — end of imports
        break;
      }
    }

    if (importLines.length < 2) {
      toast('Import Sorter: Nothing to sort (' + importLines.length + ' import)', 'info');
      return;
    }

    // Classify and group
    var groups = { 0: [], 1: [], 2: [] }; // external, absolute, relative

    for (var j = 0; j < importLines.length; j++) {
      var line = importLines[j];
      var firstLine = line.split('\n')[0];
      var modPath = getModulePath(firstLine);
      var group = classifyImport(modPath);
      groups[group].push({ line: line, path: (modPath || '').toLowerCase() });
    }

    // Sort each group alphabetically by module path
    function sortGroup(arr) {
      arr.sort(function (a, b) {
        if (a.path < b.path) return -1;
        if (a.path > b.path) return 1;
        return 0;
      });
      return arr;
    }

    sortGroup(groups[0]);
    sortGroup(groups[1]);
    sortGroup(groups[2]);

    // Build sorted output with blank lines between groups
    var sortedLines = [];
    var groupOrder = [0, 1, 2];

    for (var g = 0; g < groupOrder.length; g++) {
      var grp = groups[groupOrder[g]];
      if (grp.length === 0) continue;
      if (sortedLines.length > 0) {
        sortedLines.push('');
      }
      for (var k = 0; k < grp.length; k++) {
        sortedLines.push(grp[k].line);
      }
    }

    // Replace in document
    var Range = ace.require('ace/range').Range;
    var range = new Range(importStartIdx, 0, importEndIdx, lines[importEndIdx].length);

    // Preserve cursor
    var cursorPos = editor.getCursorPosition();

    session.replace(range, sortedLines.join('\n'));

    // Restore cursor
    editor.moveCursorToPosition(cursorPos);
    editor.clearSelection();

    toast('Imports sorted: ' + importLines.length + ' statements in ' +
      (groups[0].length ? groups[0].length + ' external, ' : '') +
      (groups[1].length ? groups[1].length + ' absolute, ' : '') +
      (groups[2].length ? groups[2].length + ' relative' : ''),
      'success');
  }

  // Register shortcut
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+i', sortImports);
  } else {
    // Fallback: register directly with Ace
    var editor = getEditor();
    if (editor) {
      editor.commands.addCommand({
        name: 'sortImports',
        bindKey: { win: 'Ctrl-Shift-I', mac: 'Cmd-Shift-I' },
        exec: sortImports
      });
    }
  }

  console.log('[ext:import-sorter] Import Sorter loaded (Mod+Shift+I)');

})(PiPilot, bus, api, state, db);
