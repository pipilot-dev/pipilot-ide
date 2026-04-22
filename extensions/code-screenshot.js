// PiPilot IDE Extension: Code Screenshot
// Select code -> right-click "Copy as Screenshot" or mod+shift+s.
// Renders code to a styled canvas with dark theme and copies as PNG.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (!editor) return;

  // ── Token color map (dark theme) ──
  var TOKEN_COLORS = {
    'keyword': '#ff7b72',
    'keyword.operator': '#ff7b72',
    'storage': '#ff7b72',
    'storage.type': '#ff7b72',
    'constant': '#79c0ff',
    'constant.numeric': '#79c0ff',
    'constant.language': '#79c0ff',
    'constant.character': '#79c0ff',
    'constant.other': '#79c0ff',
    'variable': '#ffa657',
    'variable.language': '#ffa657',
    'variable.parameter': '#e7e7ea',
    'string': '#a5d6ff',
    'string.regexp': '#7ee787',
    'comment': '#8b949e',
    'comment.line': '#8b949e',
    'comment.block': '#8b949e',
    'support': '#d2a8ff',
    'support.function': '#d2a8ff',
    'support.type': '#d2a8ff',
    'support.class': '#d2a8ff',
    'entity': '#d2a8ff',
    'entity.name': '#d2a8ff',
    'entity.name.function': '#d2a8ff',
    'entity.name.type': '#ffa657',
    'entity.other': '#7ee787',
    'punctuation': '#e7e7ea',
    'paren': '#e7e7ea',
    'meta.tag': '#7ee787',
    'invalid': '#e5484d'
  };

  var DEFAULT_COLOR = '#e7e7ea';
  var BG_COLOR = '#1c1c21';
  var BORDER_COLOR = '#2e2e35';
  var HEADER_BG = '#232329';
  var LINE_NUM_COLOR = '#6b6b76';
  var FONT_FAMILY = '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace';

  function getTokenColor(tokenType) {
    if (!tokenType) return DEFAULT_COLOR;
    // Try exact match first, then progressively shorter prefixes
    var parts = tokenType.split('.');
    for (var i = parts.length; i > 0; i--) {
      var key = parts.slice(0, i).join('.');
      if (TOKEN_COLORS[key]) return TOKEN_COLORS[key];
    }
    return DEFAULT_COLOR;
  }

  function captureScreenshot() {
    var ace = PiPilot.editor.getAce();
    if (!ace) return;

    var selected = ace.getSelectedText();
    if (!selected || !selected.trim()) {
      bus.emit('toast:show', { message: 'Select code to screenshot', type: 'warn' });
      return;
    }

    var session = ace.getSession();
    var range = ace.getSelectionRange();
    var startRow = range.start.row;
    var endRow = range.end.row;

    // Collect tokens for each line
    var lines = [];
    for (var row = startRow; row <= endRow; row++) {
      var tokens = session.getTokens(row);
      lines.push({
        lineNum: row + 1,
        tokens: tokens || [],
        text: session.getLine(row)
      });
    }

    // Get active file name
    var activeFile = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    var fileName = activeFile ? activeFile.split(/[\\/]/).pop() : 'code';

    renderToCanvas(lines, fileName);
  }

  function renderToCanvas(lines, fileName) {
    var FONT_SIZE = 14;
    var LINE_HEIGHT = 22;
    var PAD_X = 20;
    var PAD_Y = 16;
    var HEADER_HEIGHT = 36;
    var LINE_NUM_WIDTH = 50;
    var DOT_RADIUS = 6;

    // Measure text width
    var measureCanvas = document.createElement('canvas');
    var measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = FONT_SIZE + 'px ' + FONT_FAMILY;

    // Calculate max line width
    var maxWidth = 0;
    for (var i = 0; i < lines.length; i++) {
      var w = measureCtx.measureText(lines[i].text).width;
      if (w > maxWidth) maxWidth = w;
    }

    var contentWidth = Math.max(400, LINE_NUM_WIDTH + maxWidth + PAD_X * 2 + 20);
    var contentHeight = HEADER_HEIGHT + PAD_Y * 2 + lines.length * LINE_HEIGHT;

    var canvas = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 2;
    canvas.width = contentWidth * dpr;
    canvas.height = contentHeight * dpr;
    canvas.style.width = contentWidth + 'px';
    canvas.style.height = contentHeight + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Background with rounded corners
    var radius = 10;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(contentWidth - radius, 0);
    ctx.quadraticCurveTo(contentWidth, 0, contentWidth, radius);
    ctx.lineTo(contentWidth, contentHeight - radius);
    ctx.quadraticCurveTo(contentWidth, contentHeight, contentWidth - radius, contentHeight);
    ctx.lineTo(radius, contentHeight);
    ctx.quadraticCurveTo(0, contentHeight, 0, contentHeight - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fillStyle = BG_COLOR;
    ctx.fill();

    // Header bar
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(contentWidth - radius, 0);
    ctx.quadraticCurveTo(contentWidth, 0, contentWidth, radius);
    ctx.lineTo(contentWidth, HEADER_HEIGHT);
    ctx.lineTo(0, HEADER_HEIGHT);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fillStyle = HEADER_BG;
    ctx.fill();
    ctx.restore();

    // Window dots
    var dots = ['#e5484d', '#e5a639', '#56d364'];
    for (var d = 0; d < 3; d++) {
      ctx.beginPath();
      ctx.arc(PAD_X + d * 20, HEADER_HEIGHT / 2, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = dots[d];
      ctx.fill();
    }

    // File name in header
    ctx.font = '12px ' + FONT_FAMILY;
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'center';
    ctx.fillText(fileName, contentWidth / 2, HEADER_HEIGHT / 2 + 4);
    ctx.textAlign = 'left';

    // Header border
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT);
    ctx.lineTo(contentWidth, HEADER_HEIGHT);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Render code lines
    var baseY = HEADER_HEIGHT + PAD_Y;
    ctx.font = FONT_SIZE + 'px ' + FONT_FAMILY;

    for (var ln = 0; ln < lines.length; ln++) {
      var y = baseY + ln * LINE_HEIGHT + LINE_HEIGHT * 0.75;

      // Line number
      ctx.fillStyle = LINE_NUM_COLOR;
      ctx.textAlign = 'right';
      ctx.fillText(String(lines[ln].lineNum), PAD_X + LINE_NUM_WIDTH - 10, y);
      ctx.textAlign = 'left';

      // Tokens
      var x = PAD_X + LINE_NUM_WIDTH;
      var tokens = lines[ln].tokens;
      if (tokens && tokens.length > 0) {
        for (var t = 0; t < tokens.length; t++) {
          var token = tokens[t];
          var color = getTokenColor(token.type);
          ctx.fillStyle = color;
          // Handle tabs
          var text = (token.value || '').replace(/\t/g, '    ');
          ctx.fillText(text, x, y);
          x += ctx.measureText(text).width;
        }
      } else {
        // Fallback: render plain text
        ctx.fillStyle = DEFAULT_COLOR;
        var plainText = (lines[ln].text || '').replace(/\t/g, '    ');
        ctx.fillText(plainText, x, y);
      }
    }

    // Convert to blob and copy to clipboard
    canvas.toBlob(function (blob) {
      if (!blob) {
        bus.emit('toast:show', { message: 'Failed to create screenshot', type: 'error' });
        return;
      }

      // Try clipboard API with ClipboardItem
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        try {
          var item = new ClipboardItem({ 'image/png': blob });
          navigator.clipboard.write([item]).then(function () {
            bus.emit('toast:show', { message: 'Code screenshot copied to clipboard!', type: 'ok' });
          }).catch(function (err) {
            // Fallback: download
            downloadBlob(blob, fileName);
          });
        } catch (e) {
          downloadBlob(blob, fileName);
        }
      } else {
        downloadBlob(blob, fileName);
      }
    }, 'image/png');
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (fileName || 'code') + '-screenshot.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    bus.emit('toast:show', { message: 'Screenshot saved as ' + a.download, type: 'ok' });
  }

  // ── Register shortcut ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+s', captureScreenshot);
  }

  // ── Context menu ──
  var editorContainer = document.getElementById('editor-container') || document.getElementById('monaco-host');
  if (editorContainer) {
    editorContainer.addEventListener('contextmenu', function (e) {
      if (!e.target.closest('.ace_editor')) return;

      var ace = PiPilot.editor.getAce();
      if (!ace) return;
      var selected = ace.getSelectedText();
      if (!selected || !selected.trim()) return;

      e.preventDefault();
      bus.emit('contextmenu:show', {
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: 'Copy as Screenshot',
            onClick: captureScreenshot
          }
        ]
      });
    });
  }

  console.log('[ext:code-screenshot] loaded');
})(PiPilot, bus, api, state, db);
