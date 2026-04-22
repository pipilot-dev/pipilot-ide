// PiPilot IDE Extension: Auto Close Tag
// Automatically inserts closing tags when typing `>` in HTML/JSX files.
// Auto-completes `</` with the nearest unclosed tag.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (!editor) return;

  // ── File type check ──
  var TAG_EXTENSIONS = /\.(html|htm|jsx|tsx|xml|xhtml|vue|svelte|astro|php|erb|ejs|hbs|handlebars)$/i;

  function isTagFile() {
    var file = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    if (!file) return false;
    return TAG_EXTENSIONS.test(file);
  }

  // ── Self-closing tags ──
  var VOID_TAGS = [
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ];

  function isVoidTag(tagName) {
    return VOID_TAGS.indexOf(tagName.toLowerCase()) !== -1;
  }

  // ── Extract tag name from opening tag text ──
  function extractTagName(text) {
    // Match <tagName ... from the end of text
    var match = text.match(/<([a-zA-Z][a-zA-Z0-9\-_.]*)[^>]*$/);
    if (match) return match[1];
    return null;
  }

  // ── Find nearest unclosed tag for `</` completion ──
  function findNearestUnclosed(textBefore) {
    var stack = [];
    // Match all opening and closing tags
    var tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9\-_.]*)[^>]*\/?>/g;
    var match;

    while ((match = tagRegex.exec(textBefore)) !== null) {
      var fullMatch = match[0];
      var tagName = match[1];

      if (isVoidTag(tagName)) continue;

      // Self-closing tag like <br/> or <Component />
      if (fullMatch.match(/\/\s*>$/)) continue;

      if (fullMatch.charAt(1) === '/') {
        // Closing tag — pop from stack if matching
        for (var i = stack.length - 1; i >= 0; i--) {
          if (stack[i].toLowerCase() === tagName.toLowerCase()) {
            stack.splice(i, 1);
            break;
          }
        }
      } else {
        // Opening tag
        stack.push(tagName);
      }
    }

    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  // ── Main change handler ──
  var skipNext = false;

  editor.on('change', function (delta) {
    if (skipNext) return;
    if (!isTagFile()) return;
    if (delta.action !== 'insert') return;

    var text = delta.lines.join('\n');
    var session = editor.getSession();
    var cursor = editor.getCursorPosition();

    // Case 1: User typed `>` — auto-insert closing tag
    if (text === '>') {
      var row = cursor.row;
      var col = cursor.column;
      var lineText = session.getLine(row).substring(0, col);

      // Check we're not in a self-closing tag />
      if (lineText.match(/\/\s*>$/)) return;

      // Check we're not closing a comment -->
      if (lineText.match(/--\s*>$/)) return;

      // Check we're inside an opening tag
      var tagName = extractTagName(lineText);
      if (!tagName) return;
      if (isVoidTag(tagName)) return;

      // Check if it looks like a closing tag </ ... >
      if (lineText.match(/<\/[^>]*>$/)) return;

      // Insert closing tag
      var closeTag = '</' + tagName + '>';
      skipNext = true;
      session.insert(cursor, closeTag);
      // Move cursor back before the closing tag
      editor.moveCursorTo(cursor.row, cursor.column);
      editor.clearSelection();
      skipNext = false;
      return;
    }

    // Case 2: User typed `/` after `<` — auto-complete closing tag
    if (text === '/') {
      var row = cursor.row;
      var col = cursor.column;
      var lineText = session.getLine(row).substring(0, col);

      // Check if the character before / is <
      if (!lineText.match(/<\/$/)) return;

      // Get all text before this point
      var allLines = [];
      for (var r = 0; r < row; r++) {
        allLines.push(session.getLine(r));
      }
      allLines.push(lineText.substring(0, lineText.length - 2)); // exclude the `</`

      var textBefore = allLines.join('\n');
      var unclosed = findNearestUnclosed(textBefore);

      if (unclosed) {
        var completion = unclosed + '>';
        skipNext = true;
        session.insert(cursor, completion);
        skipNext = false;
      }
      return;
    }
  });

  console.log('[ext:auto-close-tag] Auto Close Tag extension loaded');
})(PiPilot, bus, api, state, db);
