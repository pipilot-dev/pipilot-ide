// PiPilot IDE Extension: JSDoc Generator
// Select a function and press Mod+Shift+D to generate a JSDoc comment above it.

(function (PiPilot, bus, api, state, db) {

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

  // Parse a parameter string like "a: string, b?: number, c = 5, ...rest: any[]"
  function parseParams(paramStr) {
    if (!paramStr || !paramStr.trim()) return [];
    var params = [];
    var depth = 0;
    var current = '';

    for (var i = 0; i < paramStr.length; i++) {
      var ch = paramStr[i];
      if (ch === '(' || ch === '<' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === '>' || ch === ']' || ch === '}') depth--;

      if (ch === ',' && depth === 0) {
        params.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) params.push(current.trim());

    return params.map(function (p) {
      // Remove default values
      var withoutDefault = p.split('=')[0].trim();
      // Check for rest params
      var isRest = withoutDefault.indexOf('...') === 0;
      if (isRest) withoutDefault = withoutDefault.substring(3);
      // Check for optional (?)
      var isOptional = false;
      // Split name and type
      var parts = withoutDefault.split(':');
      var name = parts[0].trim();
      var type = parts.length > 1 ? parts.slice(1).join(':').trim() : '*';

      if (name.charAt(name.length - 1) === '?') {
        isOptional = true;
        name = name.substring(0, name.length - 1);
      }

      // Handle destructured params
      if (name.indexOf('{') !== -1 || name.indexOf('[') !== -1) {
        name = 'param';
        type = 'Object';
      }

      if (isRest) {
        type = type || 'any[]';
        name = '...' + name;
      }

      return { name: name, type: type, optional: isOptional, hasDefault: p.indexOf('=') !== -1 };
    });
  }

  // Extract function info from a line of text
  function parseFunctionLine(line) {
    var patterns = [
      // async function name(params): ReturnType
      /(?:export\s+)?(?:async\s+)?function\s*(\*?\s*\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?/,
      // const name = (params): ReturnType =>
      /(?:export\s+)?(?:var|let|const)\s+(\w+)\s*=\s*(?:async\s+)?(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\=\{]+))?\s*=>/,
      // const name = function(params)
      /(?:export\s+)?(?:var|let|const)\s+(\w+)\s*=\s*(?:async\s+)?function\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?/,
      // name(params): ReturnType { — class method
      /(?:(?:public|private|protected|static|async|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?/,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match = line.match(patterns[i]);
      if (match) {
        return {
          name: (match[1] || '').trim().replace(/^\*\s*/, ''),
          params: match[2] || '',
          returnType: match[3] ? match[3].trim() : null,
          isGenerator: (match[1] || '').indexOf('*') !== -1,
          isAsync: /async/.test(line)
        };
      }
    }
    return null;
  }

  function generateJsDoc() {
    var editor = getEditor();
    if (!editor) { toast('No active editor', 'error'); return; }

    var session = editor.getSession();
    if (!session) return;

    var selection = editor.getSelection();
    var range = selection.getRange();

    // Use selection or current line
    var startRow = range.start.row;
    var endRow = range.end.row;
    var text = '';
    for (var r = startRow; r <= endRow; r++) {
      text += session.getLine(r) + '\n';
    }
    // If single line selected (or no selection), try a few lines for multi-line signatures
    if (startRow === endRow) {
      for (var extra = 1; extra <= 3; extra++) {
        if (startRow + extra < session.getLength()) {
          text += session.getLine(startRow + extra) + '\n';
        }
      }
    }

    // Collapse to single line for parsing
    var collapsed = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    var info = parseFunctionLine(collapsed);

    if (!info) {
      toast('No function found on current line/selection', 'warning');
      return;
    }

    var params = parseParams(info.params);
    var indent = session.getLine(startRow).match(/^(\s*)/)[1] || '';

    // Build JSDoc
    var lines = [];
    lines.push(indent + '/**');

    // Description placeholder
    lines.push(indent + ' * ' + (info.name || 'function') + ' — description');

    if (params.length > 0 || info.returnType) {
      lines.push(indent + ' *');
    }

    for (var pi = 0; pi < params.length; pi++) {
      var param = params[pi];
      var typeStr = '{' + param.type + '}';
      var nameStr = param.optional || param.hasDefault
        ? '[' + param.name + ']'
        : param.name;
      lines.push(indent + ' * @param ' + typeStr + ' ' + nameStr + ' — description');
    }

    if (info.returnType) {
      var retType = info.returnType.replace(/\{/g, '').trim();
      if (info.isAsync && retType.indexOf('Promise') === -1) {
        retType = 'Promise<' + retType + '>';
      }
      lines.push(indent + ' * @returns {' + retType + '} description');
    } else if (info.isAsync) {
      lines.push(indent + ' * @returns {Promise<*>} description');
    }

    lines.push(indent + ' */');

    var docBlock = lines.join('\n') + '\n';

    // Check if there's already a JSDoc above
    if (startRow > 0) {
      var prevLine = session.getLine(startRow - 1).trim();
      if (prevLine === '*/') {
        toast('JSDoc already exists above this function', 'warning');
        return;
      }
    }

    // Insert above the function line
    session.insert({ row: startRow, column: 0 }, docBlock);
    // Move cursor into the description
    editor.moveCursorToPosition({ row: startRow, column: indent.length + 3 });
    editor.clearSelection();

    toast('JSDoc generated for ' + (info.name || 'function'), 'success');
  }

  // Register shortcut
  if (PiPilot && PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+d', generateJsDoc);
  }

  console.log('[ext:jsdoc-generator] JSDoc Generator loaded (Mod+Shift+D)');
})(PiPilot, bus, api, state, typeof db !== 'undefined' ? db : null);
