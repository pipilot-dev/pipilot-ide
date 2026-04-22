// PiPilot IDE Extension: Color Preview
// Detects color values in CSS/JS/HTML files and shows colored markers in the gutter.

(function (PiPilot, bus, api, state, db) {

  var STYLE_ID = 'pipilot-color-preview-styles';
  var MARKER_CLASS_PREFIX = 'pipilot-color-marker-';
  var COLOR_EXTS = /\.(css|scss|less|sass|js|jsx|ts|tsx|html|htm|vue|svelte|styl)$/i;
  var markerIds = [];
  var colorCounter = 0;
  var injectedColors = {};

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function isColorFile() {
    var file = PiPilot.editor && PiPilot.editor.getActiveFile
      ? PiPilot.editor.getActiveFile()
      : null;
    if (!file) return false;
    return COLOR_EXTS.test(file);
  }

  // Ensure base styles are injected
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.pipilot-color-gutter { position: relative; }',
      '.pipilot-color-gutter::after {',
      '  content: "";',
      '  position: absolute;',
      '  right: 4px;',
      '  top: 50%;',
      '  transform: translateY(-50%);',
      '  width: 10px;',
      '  height: 10px;',
      '  border-radius: 2px;',
      '  border: 1px solid rgba(255,255,255,0.3);',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // Inject a CSS class for a specific color
  function getColorClass(color) {
    // Normalize color for use as key
    var key = color.toLowerCase().replace(/\s+/g, '');
    if (injectedColors[key]) return injectedColors[key];

    colorCounter++;
    var cls = MARKER_CLASS_PREFIX + colorCounter;

    var style = document.getElementById(STYLE_ID);
    if (style) {
      style.textContent += '\n.ace_gutter-cell.' + cls + '::after { background: ' + color + '; content: ""; position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 10px; height: 10px; border-radius: 2px; border: 1px solid rgba(128,128,128,0.4); }';
    }

    injectedColors[key] = cls;
    return cls;
  }

  // Parse all colors from a line of text
  function extractColors(line) {
    var colors = [];

    // Hex colors: #rgb, #rgba, #rrggbb, #rrggbbaa
    var hexPattern = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
    var match;
    while ((match = hexPattern.exec(line)) !== null) {
      colors.push(match[0]);
    }

    // rgb() and rgba()
    var rgbPattern = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g;
    while ((match = rgbPattern.exec(line)) !== null) {
      colors.push(match[0]);
    }

    // hsl() and hsla()
    var hslPattern = /hsla?\(\s*\d+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\)/g;
    while ((match = hslPattern.exec(line)) !== null) {
      colors.push(match[0]);
    }

    return colors;
  }

  // Clear all existing markers
  function clearMarkers() {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    // Remove gutter decorations from all rows
    var len = session.getLength();
    for (var r = 0; r < len && r < 5000; r++) {
      // Remove all color classes from gutter
      var gutterRendererEl = null;
      try {
        var gutterCells = document.querySelectorAll('.ace_gutter-cell');
        for (var g = 0; g < gutterCells.length; g++) {
          var cell = gutterCells[g];
          var classes = cell.className.split(' ');
          for (var ci = 0; ci < classes.length; ci++) {
            if (classes[ci].indexOf(MARKER_CLASS_PREFIX) === 0) {
              cell.classList.remove(classes[ci]);
            }
          }
        }
      } catch (e) { /* ignore DOM errors */ }
    }

    // Remove session gutter decorations
    for (var ri = 0; ri < len && ri < 5000; ri++) {
      // Ace doesn't have a great API for removing all decorations,
      // so we track what we added
    }
    markerIds = [];
  }

  // Scan and apply color markers
  function updateColors() {
    var editor = getEditor();
    if (!editor) return;
    if (!isColorFile()) {
      clearMarkers();
      return;
    }

    var session = editor.getSession();
    if (!session) return;

    ensureStyles();

    // Remove old gutter decorations
    for (var mi = 0; mi < markerIds.length; mi++) {
      try {
        session.removeGutterDecoration(markerIds[mi].row, markerIds[mi].cls);
      } catch (e) { /* ignore */ }
    }
    markerIds = [];

    var lineCount = session.getLength();
    var limit = Math.min(lineCount, 5000); // cap for performance

    for (var row = 0; row < limit; row++) {
      var line = session.getLine(row);
      var colors = extractColors(line);
      if (colors.length > 0) {
        // Use the first color found on the line for the gutter indicator
        var cls = getColorClass(colors[0]);
        try {
          session.addGutterDecoration(row, cls);
          markerIds.push({ row: row, cls: cls });
        } catch (e) { /* ignore */ }
      }
    }
  }

  // Debounced update
  var updateTimer = null;
  function debouncedUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(updateColors, 400);
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
    // Also update when scrolling (gutter cells get re-rendered)
    ace.renderer.on('afterRender', function () {
      // Re-apply gutter decorations after render
      // (Ace preserves session decorations, so this should be fine)
    });
  }

  // Initial update
  setTimeout(updateColors, 800);

  console.log('[ext:color-preview] Color Preview loaded');
})(PiPilot, bus, api, state, typeof db !== 'undefined' ? db : null);
