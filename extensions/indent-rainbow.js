// PiPilot IDE Extension: Indent Rainbow
// Colors indentation levels with subtle background colors.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (!editor) return;

  // ── Colors ──
  var COLORS = [
    'rgba(255,107,53,0.04)',
    'rgba(86,211,100,0.04)',
    'rgba(108,182,255,0.04)',
    'rgba(229,166,57,0.04)'
  ];

  // ── Inject CSS classes ──
  var style = document.createElement('style');
  var cssRules = '';
  for (var i = 0; i < COLORS.length; i++) {
    cssRules += '.indent-rainbow-' + i + ' { position:absolute; background:' + COLORS[i] + '; z-index:1; pointer-events:none; }\n';
  }
  style.textContent = cssRules;
  document.head.appendChild(style);

  // ── Marker management ──
  var markerIds = [];
  var Range = ace.require('ace/range').Range;

  function clearMarkers() {
    var session = editor.getSession();
    if (!session) return;
    for (var i = 0; i < markerIds.length; i++) {
      session.removeMarker(markerIds[i]);
    }
    markerIds = [];
  }

  function detectTabSize(session) {
    var opts = session.getOptions ? session.getOptions() : {};
    return opts.tabSize || session.getTabSize() || 2;
  }

  function updateRainbow() {
    var session = editor.getSession();
    if (!session) return;

    clearMarkers();

    var tabSize = detectTabSize(session);
    var lineCount = session.getLength();
    var useTabs = session.getUseSoftTabs ? !session.getUseSoftTabs() : false;

    for (var row = 0; row < lineCount; row++) {
      var line = session.getLine(row);
      if (!line || line.trim() === '') continue;

      // Count leading whitespace
      var match = line.match(/^(\s+)/);
      if (!match) continue;

      var ws = match[1];
      var totalSpaces = 0;
      for (var c = 0; c < ws.length; c++) {
        if (ws[c] === '\t') {
          totalSpaces += tabSize;
        } else {
          totalSpaces++;
        }
      }

      // Create markers for each indent level
      var levels = Math.floor(totalSpaces / tabSize);
      var charPos = 0;

      for (var lvl = 0; lvl < levels; lvl++) {
        var startCol = charPos;
        // Advance by tabSize worth of characters
        var remaining = tabSize;
        while (remaining > 0 && charPos < ws.length) {
          if (ws[charPos] === '\t') {
            remaining = 0;
          } else {
            remaining--;
          }
          charPos++;
        }
        var endCol = charPos;

        var colorIdx = lvl % COLORS.length;
        var range = new Range(row, startCol, row, endCol);
        var mid = session.addMarker(range, 'indent-rainbow-' + colorIdx, 'text', false);
        markerIds.push(mid);
      }
    }
  }

  // ── Debounced update ──
  var debounceTimer = null;
  function debouncedUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateRainbow, 200);
  }

  // ── Events ──
  editor.on('change', debouncedUpdate);
  bus.on('editor:active-changed', function () {
    clearMarkers();
    setTimeout(updateRainbow, 100);
  });

  // Initial render
  setTimeout(updateRainbow, 500);

  console.log('[ext:indent-rainbow] Indent Rainbow extension loaded');
})(PiPilot, bus, api, state, db);
