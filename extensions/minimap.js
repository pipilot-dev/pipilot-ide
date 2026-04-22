// PiPilot IDE Extension: Minimap
// Shows a zoomed-out canvas view of the file on the right side of the editor.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (!editor) return;

  // ── Configuration ──
  var WIDTH = 60;
  var CHAR_W = 1.2;
  var LINE_H = 2.5;
  var MAX_COLS = 40; // max characters to render per line

  // ── Colors for syntax types ──
  var COLORS = {
    comment:    '#4a5568',
    string:     '#68d391',
    keyword:    '#6c8cff',
    number:     '#f6ad55',
    operator:   '#a0aec0',
    tag:        '#fc8181',
    attribute:  '#b794f4',
    normal:     '#8a8a96',
    background: '#141417'
  };

  // ── Create canvas ──
  var container = document.createElement('div');
  container.style.cssText = [
    'position:absolute', 'top:0', 'right:0', 'width:' + WIDTH + 'px',
    'height:100%', 'z-index:50', 'cursor:pointer',
    'border-left:1px solid var(--border,#2e2e35)',
    'background:' + COLORS.background
  ].join(';');

  var canvas = document.createElement('canvas');
  canvas.width = WIDTH * (window.devicePixelRatio || 1);
  canvas.style.cssText = 'width:' + WIDTH + 'px;height:100%;';
  container.appendChild(canvas);

  // Viewport indicator
  var viewport = document.createElement('div');
  viewport.style.cssText = [
    'position:absolute', 'left:0', 'right:0',
    'background:rgba(108,140,255,0.08)',
    'border:1px solid rgba(108,140,255,0.2)',
    'pointer-events:none', 'border-radius:2px'
  ].join(';');
  container.appendChild(viewport);

  // ── Attach to editor ──
  var editorEl = editor.container;
  if (editorEl) {
    editorEl.style.position = 'relative';
    editorEl.appendChild(container);
    // Shrink editor content to make room
    var contentEl = editorEl.querySelector('.ace_scroller');
    if (contentEl) {
      contentEl.style.marginRight = WIDTH + 'px';
    }
  }

  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;

  // ── Simple token classification ──
  var KEYWORDS = /^(var|let|const|function|return|if|else|for|while|do|switch|case|break|continue|class|import|export|from|default|new|try|catch|finally|throw|async|await|yield|typeof|instanceof|in|of|this|null|undefined|true|false|void|delete)$/;

  function classifyToken(type) {
    if (!type) return 'normal';
    if (type.indexOf('comment') !== -1) return 'comment';
    if (type.indexOf('string') !== -1) return 'string';
    if (type.indexOf('keyword') !== -1) return 'keyword';
    if (type.indexOf('constant.numeric') !== -1) return 'number';
    if (type.indexOf('tag') !== -1) return 'tag';
    if (type.indexOf('attribute') !== -1) return 'attribute';
    if (type.indexOf('operator') !== -1 || type.indexOf('paren') !== -1) return 'operator';
    return 'normal';
  }

  // ── Render minimap ──
  function render() {
    var session = editor.getSession();
    if (!session) return;

    var lineCount = session.getLength();
    var totalHeight = container.clientHeight;
    canvas.height = totalHeight * dpr;
    canvas.style.height = totalHeight + 'px';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, totalHeight);

    // Scale factor so all lines fit, or 1:1 if they fit naturally
    var naturalHeight = lineCount * LINE_H;
    var scale = naturalHeight > totalHeight ? totalHeight / naturalHeight : 1;
    var effectiveLineH = LINE_H * scale;

    // Get tokens for each line
    var tokenizer = session.getMode() && session.getMode().getTokenizer ? session.getMode().getTokenizer() : null;

    for (var row = 0; row < lineCount; row++) {
      var y = row * effectiveLineH;
      if (y > totalHeight) break;

      var line = session.getLine(row);
      if (!line) continue;

      // Try to get tokens from Ace's background tokenizer
      var tokens = null;
      try {
        tokens = session.bgTokenizer && session.bgTokenizer.getTokens ? session.bgTokenizer.getTokens(row) : null;
      } catch (e) {}

      if (tokens && tokens.length > 0) {
        var x = 2;
        for (var t = 0; t < tokens.length; t++) {
          var token = tokens[t];
          var val = token.value;
          if (!val) continue;

          var cls = classifyToken(token.type);
          ctx.fillStyle = COLORS[cls] || COLORS.normal;

          // Draw each character as a small rect
          for (var c = 0; c < val.length && x < WIDTH - 2; c++) {
            var ch = val.charAt(c);
            if (ch === ' ' || ch === '\t') {
              x += CHAR_W;
              continue;
            }
            ctx.globalAlpha = 0.7;
            ctx.fillRect(x, y, CHAR_W, Math.max(effectiveLineH - 0.5, 1));
            x += CHAR_W;
          }
          ctx.globalAlpha = 1;
        }
      } else {
        // Fallback: draw line as simple dots
        var trimmed = line.replace(/^\s+/, '');
        var indent = line.length - trimmed.length;
        var x = 2 + indent * CHAR_W;

        // Simple classification by first non-space content
        var color = COLORS.normal;
        if (trimmed.match(/^\/\/|^\/\*|^\*/)) color = COLORS.comment;
        else if (trimmed.match(/^['"`]/)) color = COLORS.string;
        else {
          var firstWord = trimmed.match(/^(\w+)/);
          if (firstWord && KEYWORDS.test(firstWord[1])) color = COLORS.keyword;
        }

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6;
        for (var c = 0; c < trimmed.length && x < WIDTH - 2; c++) {
          if (trimmed.charAt(c) !== ' ') {
            ctx.fillRect(x, y, CHAR_W, Math.max(effectiveLineH - 0.5, 1));
          }
          x += CHAR_W;
        }
        ctx.globalAlpha = 1;
      }
    }

    // ── Update viewport indicator ──
    var firstVisible = editor.getFirstVisibleRow();
    var lastVisible = editor.getLastVisibleRow();
    var vpTop = firstVisible * effectiveLineH;
    var vpHeight = (lastVisible - firstVisible + 1) * effectiveLineH;
    viewport.style.top = Math.max(0, vpTop) + 'px';
    viewport.style.height = Math.max(10, vpHeight) + 'px';
  }

  // ── Click to scroll ──
  container.addEventListener('click', function (e) {
    var rect = container.getBoundingClientRect();
    var y = e.clientY - rect.top;
    var totalHeight = container.clientHeight;
    var lineCount = editor.getSession().getLength();
    var naturalHeight = lineCount * LINE_H;
    var scale = naturalHeight > totalHeight ? totalHeight / naturalHeight : 1;
    var effectiveLineH = LINE_H * scale;

    var targetRow = Math.floor(y / effectiveLineH);
    targetRow = Math.max(0, Math.min(targetRow, lineCount - 1));
    editor.scrollToLine(targetRow, true, true);
    editor.gotoLine(targetRow + 1, 0, false);
  });

  // ── Drag to scroll ──
  var dragging = false;
  container.addEventListener('mousedown', function (e) {
    dragging = true;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var rect = container.getBoundingClientRect();
    var y = e.clientY - rect.top;
    var totalHeight = container.clientHeight;
    var lineCount = editor.getSession().getLength();
    var naturalHeight = lineCount * LINE_H;
    var scale = naturalHeight > totalHeight ? totalHeight / naturalHeight : 1;
    var effectiveLineH = LINE_H * scale;

    var targetRow = Math.floor(y / effectiveLineH);
    targetRow = Math.max(0, Math.min(targetRow, lineCount - 1));
    editor.scrollToLine(targetRow, true, true);
  });
  document.addEventListener('mouseup', function () { dragging = false; });

  // ── Debounced rendering ──
  var renderTimer = null;
  function debouncedRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  }

  editor.on('change', debouncedRender);
  editor.renderer.on('afterRender', debouncedRender);
  bus.on('editor:active-changed', function () {
    setTimeout(render, 200);
  });

  // Handle resize
  window.addEventListener('resize', debouncedRender);

  // Initial render
  setTimeout(render, 500);

  console.log('[ext:minimap] Minimap extension loaded');
})(PiPilot, bus, api, state, db);
