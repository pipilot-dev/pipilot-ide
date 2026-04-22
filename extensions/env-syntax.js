// PiPilot IDE Extension: Env File Syntax
// Custom highlighting for .env files: keys in accent, values in green,
// comments in dim. Masks sensitive values (KEY, SECRET, TOKEN, PASSWORD)
// with asterisks — click to reveal.

(function (PiPilot, bus, api, state, db) {

  var STYLE_ID = 'pipilot-env-syntax-styles';
  var ENV_EXT = /\.(env|env\.\w+)$/i;
  var ENV_FILENAME = /^\.env(\..+)?$/i;
  var SENSITIVE_KEYS = /KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|AUTH/i;
  var markerIds = [];
  var maskedValues = {}; // row -> { col, endCol, value, masked }
  var overlayEls = [];

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function isEnvFile() {
    var file = PiPilot.editor && PiPilot.editor.getActiveFile
      ? PiPilot.editor.getActiveFile()
      : null;
    if (!file) return false;
    var name = file.replace(/\\/g, '/').split('/').pop();
    return ENV_FILENAME.test(name) || ENV_EXT.test(file);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '\
.env-key-marker { \
  position: absolute; \
  color: var(--accent, #89b4fa) !important; \
  font-weight: 600; \
  z-index: 5; \
} \
.env-equals-marker { \
  position: absolute; \
  color: var(--text-dim, #888) !important; \
  z-index: 5; \
} \
.env-value-marker { \
  position: absolute; \
  color: #a6e3a1 !important; \
  z-index: 5; \
} \
.env-comment-marker { \
  position: absolute; \
  color: var(--text-dim, #555) !important; \
  font-style: italic; \
  opacity: 0.6; \
  z-index: 5; \
} \
.env-masked-overlay { \
  position: absolute; \
  z-index: 10; \
  color: #f9e2af; \
  font-family: var(--font-mono, monospace); \
  cursor: pointer; \
  letter-spacing: 2px; \
  pointer-events: auto; \
} \
.env-masked-overlay:hover { \
  opacity: 0.8; \
} \
';
    document.head.appendChild(style);
  }

  function clearAll() {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    for (var i = 0; i < markerIds.length; i++) {
      session.removeMarker(markerIds[i]);
    }
    markerIds = [];
    maskedValues = {};
    clearOverlays();
  }

  function clearOverlays() {
    for (var i = 0; i < overlayEls.length; i++) {
      if (overlayEls[i] && overlayEls[i].parentNode) {
        overlayEls[i].parentNode.removeChild(overlayEls[i]);
      }
    }
    overlayEls = [];
  }

  function applyHighlighting() {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    clearAll();
    if (!isEnvFile()) return;

    ensureStyles();

    var Range = ace.require('ace/range').Range;
    var lines = session.getValue().split('\n');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      // Empty line
      if (!trimmed) continue;

      // Comment line
      if (trimmed.charAt(0) === '#') {
        var commentStart = line.indexOf('#');
        var range = new Range(i, commentStart, i, line.length);
        var mid = session.addMarker(range, 'env-comment-marker', 'text', false);
        markerIds.push(mid);
        continue;
      }

      // Key=Value line
      var eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;

      var key = line.substring(0, eqIdx);
      var value = line.substring(eqIdx + 1);

      // Key marker
      var keyTrimStart = line.length - line.trimStart().length;
      if (key.trim()) {
        var keyRange = new Range(i, keyTrimStart, i, eqIdx);
        var keyMid = session.addMarker(keyRange, 'env-key-marker', 'text', false);
        markerIds.push(keyMid);
      }

      // Equals marker
      var eqRange = new Range(i, eqIdx, i, eqIdx + 1);
      var eqMid = session.addMarker(eqRange, 'env-equals-marker', 'text', false);
      markerIds.push(eqMid);

      // Value marker
      if (value.length > 0) {
        var valStart = eqIdx + 1;
        var valEnd = line.length;

        // Strip surrounding quotes for display check
        var rawVal = value;
        if ((rawVal.charAt(0) === '"' && rawVal.charAt(rawVal.length - 1) === '"') ||
            (rawVal.charAt(0) === "'" && rawVal.charAt(rawVal.length - 1) === "'")) {
          rawVal = rawVal.substring(1, rawVal.length - 1);
        }

        var valRange = new Range(i, valStart, i, valEnd);
        var valMid = session.addMarker(valRange, 'env-value-marker', 'text', false);
        markerIds.push(valMid);

        // Check if sensitive
        if (SENSITIVE_KEYS.test(key.trim()) && rawVal.length > 0) {
          maskedValues[i] = {
            col: valStart,
            endCol: valEnd,
            value: value,
            masked: true,
            row: i
          };
        }
      }
    }

    // Render masks after a tick (need renderer to be ready)
    setTimeout(renderMasks, 50);
  }

  function renderMasks() {
    clearOverlays();

    var editor = getEditor();
    if (!editor) return;
    var renderer = editor.renderer;
    if (!renderer) return;

    var contentEl = renderer.content;
    if (!contentEl) return;

    for (var rowStr in maskedValues) {
      if (!maskedValues.hasOwnProperty(rowStr)) continue;
      var info = maskedValues[rowStr];
      if (!info.masked) continue;

      var row = parseInt(rowStr, 10);

      // Create custom overlay using Ace markers with custom renderer
      // We use a different approach: override via a custom marker with an onRender callback
      createMaskOverlay(editor, row, info);
    }
  }

  function createMaskOverlay(editor, row, info) {
    var renderer = editor.renderer;
    if (!renderer) return;

    var session = editor.getSession();
    var Range = ace.require('ace/range').Range;

    // Add a special marker that we render ourselves
    var range = new Range(row, info.col, row, info.endCol);
    var asterisks = '';
    for (var i = 0; i < Math.min(info.value.length, 20); i++) {
      asterisks += '*';
    }

    // We use a custom marker class and overlay approach
    var markerId = session.addMarker(range, 'env-masked-overlay-bg', 'text', false);
    markerIds.push(markerId);

    // Build a positioned overlay element
    var overlay = document.createElement('div');
    overlay.className = 'env-masked-overlay';
    overlay.textContent = asterisks;
    overlay.title = 'Click to reveal/hide';
    overlay.dataset.row = row;
    overlay.dataset.masked = 'true';
    overlay.style.display = 'none'; // positioned dynamically

    overlay.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var isMasked = overlay.dataset.masked === 'true';
      if (isMasked) {
        overlay.textContent = info.value;
        overlay.dataset.masked = 'false';
        overlay.style.letterSpacing = '0';
        info.masked = false;
      } else {
        overlay.textContent = asterisks;
        overlay.dataset.masked = 'true';
        overlay.style.letterSpacing = '2px';
        info.masked = true;
      }
    });

    var scroller = renderer.scroller;
    if (scroller) {
      scroller.appendChild(overlay);
      overlayEls.push(overlay);
    }

    // Position overlay
    function positionOverlay() {
      if (!overlay.parentNode) return;
      var coords = renderer.textToScreenCoordinates(row, info.col);
      var scrollerRect = scroller.getBoundingClientRect();
      var lineHeight = renderer.lineHeight || 16;

      overlay.style.display = 'block';
      overlay.style.left = (coords.pageX - scrollerRect.left + scroller.scrollLeft) + 'px';
      overlay.style.top = (coords.pageY - scrollerRect.top + scroller.scrollTop) + 'px';
      overlay.style.height = lineHeight + 'px';
      overlay.style.lineHeight = lineHeight + 'px';
      overlay.style.fontSize = (renderer.characterWidth ? '12px' : '12px');
    }

    positionOverlay();

    // Reposition on scroll and resize
    editor.on('changeSession', function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });

    session.on('changeScrollTop', positionOverlay);
    session.on('changeScrollLeft', positionOverlay);
    editor.renderer.on('afterRender', positionOverlay);
  }

  // Debounced update
  var updateTimer = null;
  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(applyHighlighting, 300);
  }

  // ── Init ──
  function init() {
    ensureStyles();
    var editor = getEditor();
    if (!editor) {
      setTimeout(init, 1000);
      return;
    }

    bus.on('editor:active-changed', scheduleUpdate);
    bus.on('editor:dirty-changed', scheduleUpdate);

    editor.on('change', function () {
      if (isEnvFile()) scheduleUpdate();
    });

    // Initial check
    scheduleUpdate();
  }

  init();
  console.log('[ext:env-syntax] Env File Syntax loaded');

})(PiPilot, bus, api, state, db);
