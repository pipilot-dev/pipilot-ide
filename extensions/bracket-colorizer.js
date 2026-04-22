// PiPilot IDE Extension: Bracket Colorizer
// Colors matching brackets at different nesting depths using Ace markers.

(function (PiPilot, bus, api, state, db) {

  var STYLE_ID = 'pipilot-bracket-colorizer-styles';
  var COLORS = ['#ffd700', '#da70d6', '#179fff', '#00e68a']; // gold, orchid, blue, green
  var markerIdList = [];

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  // Inject styles for bracket depth colors
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    var css = '';
    for (var i = 0; i < COLORS.length; i++) {
      css += '.pipilot-bracket-d' + i + ' { position: absolute; border: none !important; z-index: 5; }\n';
      css += '.pipilot-bracket-d' + i + ' { color: ' + COLORS[i] + ' !important; }\n';
      // Use a text marker approach: Ace "text" type markers wrap content in a span
    }
    style.textContent = css;
    document.head.appendChild(style);
  }

  var Range;
  try {
    Range = ace.require('ace/range').Range;
  } catch (e) {
    // Fallback: try to get from global
    if (typeof window !== 'undefined' && window.ace && window.ace.require) {
      Range = window.ace.require('ace/range').Range;
    }
  }

  function clearMarkers() {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    for (var i = 0; i < markerIdList.length; i++) {
      try {
        session.removeMarker(markerIdList[i]);
      } catch (e) { /* ignore */ }
    }
    markerIdList = [];
  }

  function isOpenBracket(ch) {
    return ch === '(' || ch === '[' || ch === '{';
  }

  function isCloseBracket(ch) {
    return ch === ')' || ch === ']' || ch === '}';
  }

  function matchesOpen(open, close) {
    return (open === '(' && close === ')') ||
           (open === '[' && close === ']') ||
           (open === '{' && close === '}');
  }

  function updateBrackets() {
    var editor = getEditor();
    if (!editor || !Range) return;

    var session = editor.getSession();
    if (!session) return;

    ensureStyles();
    clearMarkers();

    var lineCount = session.getLength();
    var limit = Math.min(lineCount, 3000); // performance cap

    // Collect all bracket positions with depth
    var stack = [];
    var brackets = []; // {row, col, depth, char}
    var text = '';

    for (var row = 0; row < limit; row++) {
      var line = session.getLine(row);
      var inString = false;
      var stringChar = '';
      var escaped = false;
      var inLineComment = false;
      var inBlockComment = false;

      for (var col = 0; col < line.length; col++) {
        var ch = line[col];
        var prev = col > 0 ? line[col - 1] : '';

        // Skip escaped characters
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }

        // Handle strings
        if (!inLineComment && !inBlockComment) {
          if (inString) {
            if (ch === stringChar) {
              inString = false;
            }
            continue;
          }
          if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            stringChar = ch;
            continue;
          }
        }

        // Handle comments
        if (!inString && !inBlockComment && ch === '/' && col + 1 < line.length && line[col + 1] === '/') {
          inLineComment = true;
          continue;
        }
        if (!inString && !inBlockComment && ch === '/' && col + 1 < line.length && line[col + 1] === '*') {
          inBlockComment = true;
          col++; // skip *
          continue;
        }
        if (inBlockComment && ch === '*' && col + 1 < line.length && line[col + 1] === '/') {
          inBlockComment = false;
          col++; // skip /
          continue;
        }
        if (inLineComment || inBlockComment) continue;

        // Handle brackets
        if (isOpenBracket(ch)) {
          var depth = stack.length % COLORS.length;
          brackets.push({ row: row, col: col, depth: depth, char: ch, type: 'open' });
          stack.push({ char: ch, row: row, col: col, depth: depth });
        } else if (isCloseBracket(ch)) {
          if (stack.length > 0) {
            var top = stack[stack.length - 1];
            if (matchesOpen(top.char, ch)) {
              stack.pop();
              brackets.push({ row: row, col: col, depth: top.depth, char: ch, type: 'close' });
            } else {
              // Mismatched bracket — still pop and color
              stack.pop();
              brackets.push({ row: row, col: col, depth: top.depth, char: ch, type: 'close' });
            }
          } else {
            // Unmatched close bracket — depth 0
            brackets.push({ row: row, col: col, depth: 0, char: ch, type: 'close' });
          }
        }
      }
    }

    // Add markers for each bracket
    for (var bi = 0; bi < brackets.length; bi++) {
      var b = brackets[bi];
      var cls = 'pipilot-bracket-d' + b.depth;
      try {
        var range = new Range(b.row, b.col, b.row, b.col + 1);
        var markerId = session.addMarker(range, cls, 'text', false);
        markerIdList.push(markerId);
      } catch (e) { /* ignore */ }
    }
  }

  // Debounced update
  var timer = null;
  function debouncedUpdate() {
    clearTimeout(timer);
    timer = setTimeout(updateBrackets, 200);
  }

  // Listen for events
  if (bus && bus.on) {
    bus.on('editor:active-changed', debouncedUpdate);
    bus.on('editor:dirty-changed', debouncedUpdate);
  }

  // Hook into Ace change events
  var ace = getEditor();
  if (ace) {
    ace.on('change', debouncedUpdate);
  }

  // Initial update
  setTimeout(updateBrackets, 600);

  console.log('[ext:bracket-colorizer] Bracket Colorizer loaded (4-color depth cycling)');
})(PiPilot, bus, api, state, typeof db !== 'undefined' ? db : null);
