// PiPilot IDE Extension: CSS Unit Converter
// When cursor is on a CSS px value, shows a tooltip with conversions to rem, em, vw, %.
// Click any conversion to replace the value in the editor.

(function (PiPilot, bus, api, state, db) {

  var REM_BASE = 16;
  var VW_BASE = 1440;
  var STYLE_ID = 'pipilot-css-unit-converter-styles';
  var CSS_EXTS = /\.(css|scss|sass|less|styl)$/i;
  var PX_REGEX = /(-?\d+(?:\.\d+)?)px/g;
  var tooltipEl = null;
  var activeMarkerIds = [];
  var debounceTimer = null;

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function isCssFile() {
    var file = PiPilot.editor && PiPilot.editor.getActiveFile
      ? PiPilot.editor.getActiveFile()
      : null;
    if (!file) return false;
    return CSS_EXTS.test(file);
  }

  function roundNum(n, decimals) {
    var factor = Math.pow(10, decimals || 4);
    return Math.round(n * factor) / factor;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '\
.css-unit-tooltip { \
  position: fixed; \
  z-index: 99999; \
  background: var(--bg-secondary, #1e1e2e); \
  border: 1px solid var(--border, #444); \
  border-radius: 6px; \
  padding: 6px 0; \
  box-shadow: 0 4px 16px rgba(0,0,0,0.4); \
  font-family: var(--font-mono, monospace); \
  font-size: 12px; \
  min-width: 160px; \
  pointer-events: auto; \
} \
.css-unit-tooltip-row { \
  display: flex; \
  align-items: center; \
  justify-content: space-between; \
  padding: 4px 12px; \
  cursor: pointer; \
  color: var(--text, #cdd6f4); \
  transition: background 0.1s; \
} \
.css-unit-tooltip-row:hover { \
  background: var(--bg-hover, #313244); \
} \
.css-unit-tooltip-label { \
  color: var(--text-dim, #888); \
  font-size: 10px; \
  margin-right: 12px; \
  text-transform: uppercase; \
  min-width: 30px; \
} \
.css-unit-tooltip-value { \
  color: var(--accent, #89b4fa); \
  font-weight: 600; \
} \
.css-unit-tooltip-header { \
  padding: 4px 12px 6px; \
  font-size: 10px; \
  color: var(--text-dim, #666); \
  border-bottom: 1px solid var(--border, #333); \
  margin-bottom: 2px; \
  font-weight: 600; \
  letter-spacing: 0.5px; \
  text-transform: uppercase; \
} \
';
    document.head.appendChild(style);
  }

  function destroyTooltip() {
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
    }
    tooltipEl = null;
  }

  function createTooltip(pxValue, row, col, matchStart, matchEnd) {
    destroyTooltip();
    var editor = getEditor();
    if (!editor) return;

    var rem = roundNum(pxValue / REM_BASE);
    var em = roundNum(pxValue / REM_BASE);
    var vw = roundNum((pxValue / VW_BASE) * 100);
    var pct = roundNum((pxValue / REM_BASE) * 100);

    var conversions = [
      { label: 'rem', value: rem + 'rem' },
      { label: 'em', value: em + 'em' },
      { label: 'vw', value: vw + 'vw' },
      { label: '%', value: pct + '%' }
    ];

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'css-unit-tooltip';

    var header = document.createElement('div');
    header.className = 'css-unit-tooltip-header';
    header.textContent = pxValue + 'px — click to replace';
    tooltipEl.appendChild(header);

    for (var i = 0; i < conversions.length; i++) {
      (function (conv) {
        var rowEl = document.createElement('div');
        rowEl.className = 'css-unit-tooltip-row';

        var label = document.createElement('span');
        label.className = 'css-unit-tooltip-label';
        label.textContent = conv.label;

        var val = document.createElement('span');
        val.className = 'css-unit-tooltip-value';
        val.textContent = conv.value;

        rowEl.appendChild(label);
        rowEl.appendChild(val);

        rowEl.addEventListener('click', function (e) {
          e.stopPropagation();
          replaceValue(row, matchStart, matchEnd, conv.value);
          destroyTooltip();
        });

        tooltipEl.appendChild(rowEl);
      })(conversions[i]);
    }

    document.body.appendChild(tooltipEl);

    // Position near cursor
    var renderer = editor.renderer;
    if (!renderer) { destroyTooltip(); return; }

    var pos = renderer.textToScreenCoordinates(row, col);
    var tipRect = tooltipEl.getBoundingClientRect();
    var left = pos.pageX;
    var top = pos.pageY + 20;

    // Keep on screen
    if (left + tipRect.width > window.innerWidth) {
      left = window.innerWidth - tipRect.width - 8;
    }
    if (top + tipRect.height > window.innerHeight) {
      top = pos.pageY - tipRect.height - 4;
    }

    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }

  function replaceValue(row, startCol, endCol, newValue) {
    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    var Range = ace.require('ace/range').Range;
    var range = new Range(row, startCol, row, endCol);
    session.replace(range, newValue);
  }

  function onCursorChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkCursorPosition, 150);
  }

  function checkCursorPosition() {
    if (!isCssFile()) {
      destroyTooltip();
      return;
    }

    var editor = getEditor();
    if (!editor) return;
    var session = editor.getSession();
    if (!session) return;

    var cursor = editor.getCursorPosition();
    var line = session.getLine(cursor.row);
    if (!line) { destroyTooltip(); return; }

    // Find px values on this line
    var match;
    var found = false;
    PX_REGEX.lastIndex = 0;

    while ((match = PX_REGEX.exec(line)) !== null) {
      var matchStart = match.index;
      var matchEnd = match.index + match[0].length;

      // Check if cursor is within or adjacent to the match
      if (cursor.column >= matchStart && cursor.column <= matchEnd) {
        var pxVal = parseFloat(match[1]);
        if (pxVal !== 0 && !isNaN(pxVal)) {
          createTooltip(pxVal, cursor.row, cursor.column, matchStart, matchEnd);
          found = true;
        }
        break;
      }
    }

    if (!found) {
      destroyTooltip();
    }
  }

  // Close tooltip on click outside
  function onDocClick(e) {
    if (tooltipEl && !tooltipEl.contains(e.target)) {
      destroyTooltip();
    }
  }

  // ── Init ──
  function init() {
    ensureStyles();
    var editor = getEditor();
    if (!editor) {
      setTimeout(init, 1000);
      return;
    }

    var selection = editor.getSelection();
    if (selection) {
      selection.on('changeCursor', onCursorChange);
    }

    bus.on('editor:active-changed', function () {
      destroyTooltip();
    });

    document.addEventListener('click', onDocClick);
    console.log('[ext:css-unit-converter] CSS Unit Converter loaded');
  }

  init();

})(PiPilot, bus, api, state, db);
