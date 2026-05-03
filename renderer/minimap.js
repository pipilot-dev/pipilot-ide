// PiPilot IDE — Built-in editor minimap (VS Code-style)
//
// Renders a zoomed-out preview of the current file on the right side of
// the Ace editor with a draggable viewport indicator. Replaces the
// previously shipped Minimap *extension* — built-in so it always works,
// even when the user has not installed any extensions.
//
// Lifecycle:
//   • Waits for `bus.emit('ace:ready', editor)` before doing anything,
//     because Ace is created lazily on first file open.
//   • Re-renders on editor change, scroll, viewport change, tab switch.
//   • Toggles visibility based on `state.settings.minimap` (default true).
//
// Conflict guard: sets window.__pipilotMinimapBuiltIn = true. The legacy
// extension at extensions/minimap.js checks this flag and bails if set.

(function () {
  'use strict';
  if (window.__pipilotMinimapBuiltIn) return;
  window.__pipilotMinimapBuiltIn = true;

  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  // ── Visual config ──────────────────────────────────────────────
  const WIDTH = 70;            // px — width of the minimap column
  const GUTTER = 12;           // px — visual gap between wrapped text and the minimap
  const SCROLLER_RESERVE = WIDTH + GUTTER; // total width to subtract from the scroller
  const CHAR_W = 1.4;          // px — per-character horizontal advance
  const LINE_H = 2.6;          // px — natural line height when zoomed out
  const PADDING_X = 3;         // px — left padding inside the canvas
  const VIEWPORT_HANDLE = 'rgba(255,107,53,0.10)';
  const VIEWPORT_BORDER = 'rgba(255,107,53,0.32)';

  // Token-class → colour. Picked to read against the dark IDE bg.
  const COLORS = {
    comment:    '#4a5568',
    string:     '#68d391',
    keyword:    '#6c8cff',
    number:     '#f6ad55',
    operator:   '#a0aec0',
    tag:        '#fc8181',
    attribute:  '#b794f4',
    function:   '#fbd38d',
    type:       '#9f7aea',
    normal:     '#8a8a96',
    background: 'transparent', // inherits IDE bg via container
  };

  let editor = null;
  let container = null;
  let canvas = null;
  let ctx = null;
  let viewport = null;
  let dpr = window.devicePixelRatio || 1;
  let renderTimer = null;
  let dragging = false;
  let attached = false;

  // ── Build DOM once ─────────────────────────────────────────────
  function buildDOM() {
    if (container) return;
    container = document.createElement('div');
    container.className = 'pp-minimap';
    container.style.cssText = [
      'position:absolute', 'top:0', 'right:0',
      'width:' + WIDTH + 'px', 'height:100%',
      'z-index:8',
      'border-left:1px solid var(--border, #2e2e35)',
      'background:rgba(20,20,24,0.55)',
      'cursor:pointer',
      'overflow:hidden',
      'transition:opacity 0.15s ease',
    ].join(';');

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:' + WIDTH + 'px;height:100%;display:block;';
    container.appendChild(canvas);

    viewport = document.createElement('div');
    viewport.className = 'pp-minimap-viewport';
    viewport.style.cssText = [
      'position:absolute', 'left:0', 'right:0',
      'background:' + VIEWPORT_HANDLE,
      'border:1px solid ' + VIEWPORT_BORDER,
      'border-radius:2px',
      'pointer-events:none',
      'transition:top 80ms linear, height 80ms linear',
    ].join(';');
    container.appendChild(viewport);

    ctx = canvas.getContext('2d');

    // Click + drag scrolling
    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // Tell Ace its visible width has changed. Without this, Ace keeps the
  // pre-margin scroller width and continues wrapping lines at the wider
  // size — the right portion gets hidden behind the minimap, and word-
  // wrap appears broken because lines extend past the visible area.
  // editor.resize(true) is enough: the renderer fires its `resize` event,
  // the session listens, and reflows wrap data on the next render tick.
  function notifyAceResize() {
    if (!editor) return;
    try { editor.resize(true); } catch {}
  }

  function attachToEditor() {
    if (attached) return;
    if (!editor || !editor.container) return;
    buildDOM();
    const editorEl = editor.container;
    editorEl.style.position = 'relative';
    editorEl.appendChild(container);
    // Push the editor's scroller left so the minimap doesn't overlap code.
    const scroller = editorEl.querySelector('.ace_scroller');
    if (scroller) scroller.style.right = SCROLLER_RESERVE + 'px';
    attached = true;
    applyVisibility();
    notifyAceResize();
    scheduleRender();
  }

  function detachFromEditor() {
    if (!attached) return;
    if (container && container.parentElement) container.parentElement.removeChild(container);
    if (editor && editor.container) {
      const scroller = editor.container.querySelector('.ace_scroller');
      // Reset to Ace's default (right: 0). We use empty string to fall back
      // to whatever the stylesheet defines, which is right: 0.
      if (scroller) scroller.style.right = '';
    }
    attached = false;
    notifyAceResize();
  }

  function applyVisibility() {
    const enabled = state.settings?.minimap !== false;
    if (enabled) {
      if (!attached) { attachToEditor(); return; }
      container.style.display = 'block';
      const scroller = editor?.container?.querySelector('.ace_scroller');
      if (scroller && scroller.style.right !== SCROLLER_RESERVE + 'px') {
        scroller.style.right = SCROLLER_RESERVE + 'px';
        notifyAceResize();
      }
    } else {
      if (container) container.style.display = 'none';
      const scroller = editor?.container?.querySelector('.ace_scroller');
      if (scroller && scroller.style.right) {
        scroller.style.right = '';
        notifyAceResize();
      }
    }
  }

  // ── Token classification (Ace background tokenizer) ───────────
  function classifyToken(type) {
    if (!type) return 'normal';
    if (type.indexOf('comment') !== -1) return 'comment';
    if (type.indexOf('string') !== -1) return 'string';
    if (type.indexOf('keyword') !== -1) return 'keyword';
    if (type.indexOf('constant.numeric') !== -1) return 'number';
    if (type.indexOf('entity.name.tag') !== -1 || type.indexOf('meta.tag') !== -1) return 'tag';
    if (type.indexOf('entity.other.attribute-name') !== -1) return 'attribute';
    if (type.indexOf('entity.name.function') !== -1 || type.indexOf('support.function') !== -1) return 'function';
    if (type.indexOf('storage.type') !== -1 || type.indexOf('support.type') !== -1) return 'type';
    if (type.indexOf('operator') !== -1 || type.indexOf('paren') !== -1 || type.indexOf('punctuation') !== -1) return 'operator';
    return 'normal';
  }

  // ── Render the minimap to canvas ──────────────────────────────
  function render() {
    if (!attached || !editor || !ctx) return;
    if (state.settings?.minimap === false) return;

    const session = editor.getSession();
    if (!session) return;

    const totalHeight = container.clientHeight || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.height = totalHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, totalHeight);

    const lineCount = session.getLength();
    if (!lineCount) {
      updateViewport(totalHeight, LINE_H);
      return;
    }

    // Pick a scale so every line fits. If the file is short, stay 1:1.
    const naturalHeight = lineCount * LINE_H;
    const scale = naturalHeight > totalHeight ? totalHeight / naturalHeight : 1;
    const lineH = LINE_H * scale;
    const drawHeight = Math.max(lineH - 0.4, 0.6);
    const maxX = WIDTH - PADDING_X;

    const bg = session.bgTokenizer;
    const hasTokenizer = bg && typeof bg.getTokens === 'function';

    for (let row = 0; row < lineCount; row++) {
      const y = row * lineH;
      if (y > totalHeight + 2) break;
      const line = session.getLine(row);
      if (!line) continue;

      let x = PADDING_X;
      // Preserve indent visually
      const indentMatch = line.match(/^[\t ]+/);
      if (indentMatch) x += indentMatch[0].length * CHAR_W;

      let tokens = null;
      if (hasTokenizer) {
        try { tokens = bg.getTokens(row); } catch {}
      }

      if (tokens && tokens.length > 0) {
        for (let t = 0; t < tokens.length; t++) {
          const tok = tokens[t];
          const val = tok.value || '';
          if (!val) continue;
          const cls = classifyToken(tok.type);
          ctx.fillStyle = COLORS[cls] || COLORS.normal;
          ctx.globalAlpha = cls === 'comment' ? 0.45 : 0.85;
          for (let c = 0; c < val.length; c++) {
            if (x >= maxX) break;
            const ch = val.charCodeAt(c);
            if (ch === 32 || ch === 9) { x += CHAR_W; continue; }
            ctx.fillRect(x, y, CHAR_W, drawHeight);
            x += CHAR_W;
          }
          if (x >= maxX) break;
        }
      } else {
        // No tokenizer ready yet — draw line silhouette
        ctx.fillStyle = COLORS.normal;
        ctx.globalAlpha = 0.55;
        const trimmed = line.replace(/^[\t ]+/, '');
        for (let c = 0; c < trimmed.length; c++) {
          if (x >= maxX) break;
          const ch = trimmed.charCodeAt(c);
          if (ch !== 32 && ch !== 9) ctx.fillRect(x, y, CHAR_W, drawHeight);
          x += CHAR_W;
        }
      }
    }
    ctx.globalAlpha = 1;

    updateViewport(totalHeight, lineH);
  }

  function updateViewport(totalHeight, lineH) {
    const firstVisible = editor.getFirstVisibleRow();
    const lastVisible = editor.getLastVisibleRow();
    const top = Math.max(0, firstVisible * lineH);
    const height = Math.max(12, (lastVisible - firstVisible + 1) * lineH);
    viewport.style.top = top + 'px';
    viewport.style.height = Math.min(height, totalHeight - top) + 'px';
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = requestAnimationFrame(() => {
      renderTimer = null;
      render();
    });
  }

  // ── Click & drag scrolling ────────────────────────────────────
  function rowFromClientY(clientY) {
    if (!editor) return 0;
    const rect = container.getBoundingClientRect();
    const y = clientY - rect.top;
    const session = editor.getSession();
    const lineCount = session ? session.getLength() : 0;
    const totalHeight = container.clientHeight || 1;
    const naturalHeight = lineCount * LINE_H;
    const scale = naturalHeight > totalHeight ? totalHeight / naturalHeight : 1;
    const lineH = LINE_H * scale;
    let row = Math.floor(y / lineH);
    if (row < 0) row = 0;
    if (row > lineCount - 1) row = lineCount - 1;
    return row;
  }

  function onMouseDown(e) {
    dragging = true;
    e.preventDefault();
    const row = rowFromClientY(e.clientY);
    editor.scrollToLine(row, true, true);
  }
  function onMouseMove(e) {
    if (!dragging) return;
    const row = rowFromClientY(e.clientY);
    editor.scrollToLine(row, true, true);
  }
  function onMouseUp() { dragging = false; }

  // ── Hookup ────────────────────────────────────────────────────
  function init(ed) {
    editor = ed;
    attachToEditor();
    // Re-render on edits, scroll, mode change, viewport change.
    editor.on('change', scheduleRender);
    editor.on('changeSession', () => setTimeout(scheduleRender, 30));
    editor.session.on && editor.session.on('changeMode', scheduleRender);
    editor.renderer.on('afterRender', scheduleRender);
    editor.renderer.on('changeCharacterSize', scheduleRender);
    window.addEventListener('resize', scheduleRender);
  }

  // Wait for Ace to be created (lazy on first file open).
  bus.on('ace:ready', (ed) => init(ed));

  // Settings toggle wiring — re-applied whenever settings change.
  bus.on('settings:changed', (payload) => {
    if (!payload || payload.key === 'minimap') {
      applyVisibility();
      scheduleRender();
    }
  });
})();
