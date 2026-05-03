// PiPilot IDE — Dual Mode Editor (code + preview for HTML/MD/SVG)

(() => {
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  const PREVIEWABLE = new Set(['html', 'htm', 'md', 'markdown', 'svg']);
  let previewPanel = null;
  let previewVisible = false;
  let toggleBtn = null;       // the button group container
  let debounceTimer = null;
  let viewMode = 'code';      // 'code' | 'split' | 'preview'

  function isPreviewable(fp) {
    if (!fp) return false;
    const ext = fp.split('.').pop().toLowerCase();
    return PREVIEWABLE.has(ext);
  }

  function getFileType(fp) {
    const ext = fp.split('.').pop().toLowerCase();
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'svg') return 'svg';
    return 'html';
  }

  function ensureToggleBtn() {
    if (toggleBtn && document.body.contains(toggleBtn)) return;
    const ec = document.getElementById('editor-container');
    if (!ec) return;
    if (!ec.style.position) ec.style.position = 'relative';

    toggleBtn = document.createElement('div');
    toggleBtn.className = 'dual-mode-toggle-group';

    // Code only
    const codeBtn = document.createElement('button');
    codeBtn.className = 'dual-mode-btn active';
    codeBtn.dataset.mode = 'code';
    codeBtn.title = 'Code Only';
    codeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

    // Split view
    const splitBtn = document.createElement('button');
    splitBtn.className = 'dual-mode-btn';
    splitBtn.dataset.mode = 'split';
    splitBtn.title = 'Split View (Ctrl+Shift+V)';
    splitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></svg>';

    // Preview only
    const previewBtn = document.createElement('button');
    previewBtn.className = 'dual-mode-btn';
    previewBtn.dataset.mode = 'preview';
    previewBtn.title = 'Preview Only';
    previewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

    toggleBtn.appendChild(codeBtn);
    toggleBtn.appendChild(splitBtn);
    toggleBtn.appendChild(previewBtn);

    toggleBtn.addEventListener('click', (e) => {
      const btn = e.target.closest('.dual-mode-btn');
      if (!btn) return;
      setViewMode(btn.dataset.mode);
    });

    ec.appendChild(toggleBtn);
  }

  function setViewMode(mode) {
    viewMode = mode;
    if (toggleBtn) {
      toggleBtn.querySelectorAll('.dual-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    }
    if (mode === 'code') {
      previewVisible = false;
      hidePreview();
    } else if (mode === 'split') {
      previewVisible = true;
      showPreview();
      applySplit();
    } else if (mode === 'preview') {
      previewVisible = true;
      showPreview();
      // Full-width preview, hide editor
      const host = document.getElementById('monaco-host');
      if (host) host.style.width = '0%';
      if (previewPanel) { previewPanel.style.left = '0'; previewPanel.style.width = '100%'; }
      if (resizer) resizer.style.display = 'none';
    }
  }

  function toggle() {
    // Cycle: code → split → preview → code
    const modes = ['code', 'split', 'preview'];
    const next = modes[(modes.indexOf(viewMode) + 1) % modes.length];
    setViewMode(next);
  }

  let resizer = null;
  let splitPercent = 50;

  function showPreview() {
    previewVisible = true;
    const ec = document.getElementById('editor-container');
    if (!ec) return;

    if (!previewPanel) {
      previewPanel = document.createElement('div');
      previewPanel.id = 'dual-mode-preview';
      ec.appendChild(previewPanel);
    }
    if (!resizer) {
      resizer = document.createElement('div');
      resizer.className = 'dual-mode-resizer';
      ec.appendChild(resizer);
      initResizer();
    }

    previewPanel.style.display = 'block';
    resizer.style.display = 'block';
    if (toggleBtn) toggleBtn.classList.add('active');
    applySplit();
    updateContent();
  }

  function hidePreview() {
    previewVisible = false;
    if (previewPanel) previewPanel.style.display = 'none';
    if (resizer) resizer.style.display = 'none';
    if (toggleBtn) toggleBtn.classList.remove('active');
    const host = document.getElementById('monaco-host');
    if (host) host.style.width = '';
  }

  function applySplit() {
    const host = document.getElementById('monaco-host');
    if (host) host.style.width = splitPercent + '%';
    if (previewPanel) previewPanel.style.left = (splitPercent + 0.3) + '%';
    if (previewPanel) previewPanel.style.width = (100 - splitPercent - 0.3) + '%';
    if (resizer) resizer.style.left = splitPercent + '%';
  }

  function initResizer() {
    if (!resizer) return;
    let dragging = false;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const ec = document.getElementById('editor-container');
      if (!ec) return;
      const rect = ec.getBoundingClientRect();
      let pct = ((e.clientX - rect.left) / rect.width) * 100;
      pct = Math.max(20, Math.min(80, pct));
      splitPercent = pct;
      applySplit();
      // Resize ace editor
      const ace = window.PiPilot?.editor?.getAce?.() || window.PiPilot?.editor?.getEditor?.();
      if (ace?.resize) ace.resize();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const ace = window.PiPilot?.editor?.getAce?.() || window.PiPilot?.editor?.getEditor?.();
      if (ace?.resize) ace.resize();
    });
  }

  function updateContent() {
    if (!previewVisible || !previewPanel) return;
    const fp = state.activeFile;
    if (!fp || !isPreviewable(fp)) {
      previewPanel.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;font-size:12px;">Not a previewable file</div>';
      return;
    }
    const editor = window.PiPilot?.editor;
    const session = editor?.getSession?.(fp);
    const content = session ? session.getValue() : '';
    const type = getFileType(fp);

    if (type === 'markdown') {
      let html;
      if (window.marked?.parse) {
        // Add IDs to headings for anchor navigation
        const renderer = new window.marked.Renderer();
        renderer.heading = function(text, level) {
          const headingText = typeof text === 'object' ? text.text : text;
          const headingLevel = typeof text === 'object' ? text.depth : level;
          const slug = String(headingText).toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
          return `<h${headingLevel} id="${slug}">${headingText}</h${headingLevel}>`;
        };
        try { html = window.marked.parse(content, { renderer }); } catch { html = esc(content).replace(/\n/g, '<br>'); }
      } else {
        html = esc(content).replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
      }
      const fileName = (fp.split(/[\\/]/).pop() || 'document.md');
      previewPanel.innerHTML = `
        <div class="dual-preview-toolbar">
          <span class="dual-preview-fname" title="${esc(fileName)}">${esc(fileName)}</span>
          <div class="dual-preview-actions">
            <button class="dual-preview-btn" data-action="copy-all" title="Copy entire document as plain text">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy</span>
            </button>
            <button class="dual-preview-btn primary" data-action="download-pdf" title="Download as PDF (opens system print dialog → choose ‘Save as PDF’)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download PDF</span>
            </button>
          </div>
        </div>
        <div class="dual-preview-md">${html}</div>
      `;
      const mdEl = previewPanel.querySelector('.dual-preview-md');

      // Toolbar button wiring
      const copyBtn = previewPanel.querySelector('[data-action="copy-all"]');
      copyBtn?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(mdEl.innerText || '');
          const orig = copyBtn.querySelector('span').textContent;
          copyBtn.querySelector('span').textContent = 'Copied';
          copyBtn.classList.add('ok');
          setTimeout(() => {
            copyBtn.querySelector('span').textContent = orig;
            copyBtn.classList.remove('ok');
          }, 1200);
        } catch (err) {
          bus.emit('toast:show', { message: 'Copy failed: ' + err.message, type: 'error' });
        }
      });
      previewPanel.querySelector('[data-action="download-pdf"]')?.addEventListener('click', () => {
        downloadAsPDF(mdEl, fileName);
      });

      // Handle link clicks — anchors, cross-file, deep links
      mdEl.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;
        e.preventDefault();
        const href = link.getAttribute('href') || '';

        // Anchor links — scroll within preview
        if (href.startsWith('#')) {
          const target = previewPanel.querySelector(`#${CSS.escape(href.slice(1))}`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        // .md links — open that file in the editor
        if (href.endsWith('.md') && !href.includes('://')) {
          const dir = fp.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
          const targetPath = dir + '/' + href.replace(/^\.?\/?/, '');
          bus.emit('file:open', { path: targetPath });
          return;
        }

        // File deep links (src/app.js etc.) — open in editor
        if (!href.includes('://') && /\.\w{1,8}$/.test(href)) {
          const projectPath = state.projectPath || '';
          const filePath = projectPath + '/' + href.replace(/^\.?\/?/, '');
          bus.emit('file:open', { path: filePath });
          return;
        }

        // External URLs
        if (href.startsWith('http://') || href.startsWith('https://')) {
          try { require('electron').shell.openExternal(href); } catch { window.open(href, '_blank'); }
        }
      });

      // Mermaid — defensive renderer guards against parse errors
      if (window.mermaid && window.PiPilot?.mermaidSafe) {
        previewPanel.querySelectorAll('pre code.language-mermaid').forEach(code => {
          const pre = code.closest('pre'); if (!pre) return;
          const src = code.textContent || '';
          const div = document.createElement('div');
          div.style.cssText = 'margin:12px 0;text-align:center;overflow-x:auto;padding:16px;';
          pre.replaceWith(div);
          window.PiPilot.mermaidSafe.renderInto(div, src, 'dm-mmd').then(node => {
            if (node && node.tagName === 'svg' && window.PiPilot?.diagramExport?.attachExportMenu) {
              window.PiPilot.diagramExport.attachExportMenu(node, (fileName || 'diagram').replace(/\.[^.]+$/, ''));
            }
          });
        });
      }
    } else if (type === 'svg') {
      const safe = content.replace(/<script[\s\S]*?<\/script>/gi, '');
      previewPanel.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:24px;background:repeating-conic-gradient(#2a2a2e 0% 25%, #222226 0% 50%) 50% / 16px 16px;">${safe}</div>`;
      // The whole markdown view *is* a single SVG file — wire the export menu onto it too.
      try {
        const svgEl = previewPanel.querySelector('svg');
        if (svgEl && window.PiPilot?.diagramExport?.attachExportMenu) {
          window.PiPilot.diagramExport.attachExportMenu(svgEl, (fileName || 'image').replace(/\.[^.]+$/, ''));
        }
      } catch {}
      const svg = previewPanel.querySelector('svg');
      if (svg) { svg.style.maxWidth = '100%'; svg.style.maxHeight = '100%'; }
    } else {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:100%;height:100%;border:none;background:white;';
      iframe.sandbox = 'allow-scripts allow-same-origin';
      previewPanel.innerHTML = '';
      previewPanel.appendChild(iframe);
      try { const doc = iframe.contentDocument; doc.open(); doc.write(content); doc.close(); } catch {}
    }
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ─── PDF export via html2pdf.js ────────────────────────────────────
  // Direct PDF generation (no system print dialog). html2pdf.js renders
  // a self-contained HTML string offscreen via html2canvas, then builds
  // the PDF with jsPDF. Bypasses every clipping / overflow issue the
  // browser print pipeline has when content lives inside a scrollable
  // parent. Output is a real .pdf file saved with the correct filename.
  //
  // The library is loaded lazily from CDN on first use (~140 KB) so cold
  // startup pays nothing. If the CDN load fails (offline / blocked) we
  // gracefully fall back to window.print() with a sandboxed clone host.

  let html2pdfPromise = null;
  function ensureHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (html2pdfPromise) return html2pdfPromise;
    html2pdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
      s.async = true;
      s.onload = () => window.html2pdf ? resolve(window.html2pdf) : reject(new Error('html2pdf global missing'));
      s.onerror = () => { html2pdfPromise = null; s.remove(); reject(new Error('Failed to load html2pdf.js from CDN')); };
      document.head.appendChild(s);
    });
    return html2pdfPromise;
  }

  // Build a fully-styled, self-contained HTML string for PDF rendering.
  // Inline styles + a Google-Fonts link for nicer prose typography. The
  // rules mirror the screen preview but with GFM-style print colours
  // (black text on white, blue links) so the PDF reads well on paper.
  function buildPrintHtml(rawHtml, fileName) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtmlSafe(fileName)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.65;
    color: #24292e;
    background: #ffffff;
    max-width: 780px;
    margin: 24px auto;
    padding: 0 16px;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, h4, h5, h6 {
    color: #111;
    margin: 1.4em 0 0.5em;
    page-break-after: avoid;
  }
  h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; }
  h4 { font-size: 1em; }
  p { margin: 0 0 1em; }
  a { color: #0366d6; text-decoration: none; word-break: break-word; }
  a:hover { text-decoration: underline; }
  strong { color: #000; }
  em { color: #24292e; }
  code {
    background: #f6f8fa;
    color: #b32d2e;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, Menlo, monospace;
    font-size: 85%;
  }
  pre {
    background: #f6f8fa;
    color: #24292e;
    border: 1px solid #e1e4e8;
    padding: 12px 14px;
    border-radius: 6px;
    overflow-x: auto;
    page-break-inside: avoid;
    line-height: 1.5;
    font-size: 9.5pt;
  }
  pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
  blockquote {
    margin: 1em 0;
    padding: 0 1em;
    color: #6a737d;
    border-left: 4px solid #dfe2e5;
  }
  ul, ol { padding-left: 2em; margin: 0 0 1em; }
  li { margin: 0.25em 0; }
  li p { margin: 0; }
  hr { border: none; border-top: 1px solid #e1e4e8; margin: 2em 0; }
  table {
    border-collapse: collapse;
    margin: 1em 0;
    width: 100%;
    font-size: 10pt;
    page-break-inside: avoid;
  }
  th, td { border: 1px solid #dfe2e5; padding: 6px 13px; }
  th { background: #f6f8fa; font-weight: 600; text-align: left; }
  img {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    page-break-inside: avoid;
  }
  details { margin: 1em 0; }
  summary { cursor: pointer; font-weight: 500; }
</style>
</head>
<body>${rawHtml}</body>
</html>`;
  }

  function escapeHtmlSafe(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  async function downloadAsPDF(mdEl, fileName) {
    if (!mdEl) return;
    const btn = document.querySelector('.dual-preview-btn[data-action="download-pdf"]');
    const btnLabel = btn?.querySelector('span');
    const originalLabel = btnLabel?.textContent || '';
    if (btnLabel) btnLabel.textContent = 'Generating…';
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try {
      // Delegated to the shared pdf-export utility, used here AND by
      // the wiki view. Single source of truth for HTML→PDF.
      if (window.PiPilot?.pdfExport?.exportNode) {
        await window.PiPilot.pdfExport.exportNode(mdEl, fileName);
      } else {
        legacyPrintFallback(mdEl, String(fileName || 'document').replace(/\.[^.]+$/, ''));
      }
    } finally {
      if (btnLabel) btnLabel.textContent = originalLabel || 'Download PDF';
      if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
    }
  }

  // Why a sandboxed print container instead of `body * { visibility: hidden }`:
  //   The previous approach left the original .dual-preview-md inside its
  //   scrollable parent (#dual-mode-preview, overflow:auto). Even with
  //   `overflow: visible !important` on the parent, several ancestor
  //   containers (#editor-container, the layout panes) also clip with
  //   overflow:auto, and Chromium's print pipeline is inconsistent about
  //   which clip layers it honours. Result: only the visible scroll
  //   region exported. The fix is to clone the rendered markdown into a
  //   FRESH, body-level container with no constraining ancestors at all.
  //
  // Steps:
  //   1. Clone .dual-preview-md HTML into a new <div id="pp-print-host">
  //      attached directly to <body>.
  //   2. Inject @media print rules that: (a) hide every direct child of
  //      <body> EXCEPT our print host, (b) reset html/body/print-host so
  //      no ancestor clips, (c) restyle the markdown for paper.
  //   3. Update document.title so the print dialog defaults to the file
  //      name.
  //   4. Call window.print(). Pick "Save as PDF" in the dialog.
  //   5. Clean up — remove the host + style, restore the title.
  function legacyPrintFallback(mdEl, fileName) {
    if (!mdEl) return;

    // Tear down any leftover host from a previous attempt.
    document.getElementById('pp-print-host')?.remove();
    document.getElementById('pp-print-styles')?.remove();

    const host = document.createElement('div');
    host.id = 'pp-print-host';
    // Wrap in our own .dual-preview-md so the existing styled rules cascade
    // unchanged in screen mode (the host stays display:none until print).
    const inner = document.createElement('div');
    inner.className = 'dual-preview-md';
    inner.innerHTML = mdEl.innerHTML;
    host.appendChild(inner);
    document.body.appendChild(host);

    const style = document.createElement('style');
    style.id = 'pp-print-styles';
    style.textContent = `
      /* Off-screen during normal viewing so the host doesn't take any
         space or get rendered alongside the editor. */
      #pp-print-host { display: none; }

      @media print {
        @page { margin: 16mm 14mm; size: A4; }

        /* Reset every ancestor that might clip — html and body normally
           have overflow:hidden in this app's layout css. */
        html, body {
          background: #ffffff !important;
          color: #111 !important;
          margin: 0 !important;
          padding: 0 !important;
          height: auto !important;
          overflow: visible !important;
          user-select: text !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* Hide every direct child of <body> except our print host. */
        body > *:not(#pp-print-host) { display: none !important; }

        #pp-print-host {
          display: block !important;
          position: static !important;
          width: 100% !important;
          height: auto !important;
          overflow: visible !important;
          background: #ffffff !important;
        }

        #pp-print-host .dual-preview-md {
          color: #111 !important;
          background: #ffffff !important;
          max-width: none !important;
          padding: 0 !important;
          margin: 0 !important;
          font-family: var(--font-sans, "Plus Jakarta Sans", system-ui, sans-serif);
          font-size: 11pt !important;
          line-height: 1.55 !important;
        }
        #pp-print-host h1, #pp-print-host h2, #pp-print-host h3,
        #pp-print-host h4, #pp-print-host strong {
          color: #000 !important;
          border-color: #ccc !important;
          page-break-after: avoid;
        }
        #pp-print-host a {
          color: #1a73e8 !important;
          text-decoration: underline;
          word-break: break-word;
        }
        #pp-print-host code {
          background: #f3f3f3 !important;
          color: #b32d2e !important;
          border: 1px solid #e5e5e5 !important;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
        }
        #pp-print-host pre {
          background: #f8f8f8 !important;
          border: 1px solid #ddd !important;
          padding: 8px 10px !important;
          page-break-inside: avoid;
          white-space: pre-wrap !important;
          word-break: break-word !important;
        }
        #pp-print-host pre code {
          background: none !important;
          color: #111 !important;
          border: none !important;
        }
        #pp-print-host blockquote { border-color: #888 !important; color: #444 !important; }
        #pp-print-host table {
          border-collapse: collapse !important;
          width: 100% !important;
          page-break-inside: avoid;
        }
        #pp-print-host th, #pp-print-host td {
          border: 1px solid #bbb !important;
          padding: 4px 8px !important;
        }
        #pp-print-host th { background: #f0f0f0 !important; }
        #pp-print-host img {
          max-width: 100% !important;
          height: auto !important;
          page-break-inside: avoid;
        }
        #pp-print-host hr { border: none; border-top: 1px solid #ddd; margin: 1em 0; }
        #pp-print-host ul, #pp-print-host ol { padding-left: 24px; }
        #pp-print-host li { page-break-inside: avoid; }
      }
    `;
    document.head.appendChild(style);

    const oldTitle = document.title;
    document.title = String(fileName || 'document').replace(/\.[^.]+$/, '');

    // Give the browser a paint cycle to apply the print stylesheet, then
    // open the dialog. Some Chromium builds print before our DOM mutation
    // settles otherwise.
    setTimeout(() => {
      try { window.print(); } catch (err) { console.error('print failed:', err); }
    }, 60);

    // Clean up after the dialog closes (printing or cancelling). The
    // event order is: afterprint → next tick. We listen once.
    const cleanup = () => {
      style.remove();
      host.remove();
      document.title = oldTitle;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    // Fallback: also clean up after a generous timeout in case the
    // afterprint event doesn't fire (rare, but Electron can be flaky).
    setTimeout(() => { if (document.getElementById('pp-print-host')) cleanup(); }, 60000);
  }

  function injectStyles() {
    if (document.getElementById('dual-mode-css')) return;
    const s = document.createElement('style');
    s.id = 'dual-mode-css';
    s.textContent = `
#dual-mode-preview {
  display: none; position: absolute; top: 0;
  width: 50%; height: 100%; overflow: auto; z-index: 5;
  background: var(--bg);
}
.dual-mode-resizer {
  display: none; position: absolute; top: 0;
  width: 5px; height: 100%; z-index: 6;
  cursor: col-resize; background: transparent;
  transition: background 0.15s;
}
.dual-mode-resizer:hover, .dual-mode-resizer:active {
  background: var(--accent);
}
.dual-preview-toolbar {
  position: sticky; top: 0; z-index: 4;
  display: flex; align-items: center; gap: 10px;
  /* Right padding reserves room for the dual-mode-toggle-group, which
     floats over the editor container at top:8px right:8px and would
     otherwise cover our action buttons. ~110px clears 3 toggle btns + gap. */
  padding: 8px 120px 8px 14px;
  background: rgba(28,28,33,0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
.dual-preview-fname {
  flex: 1 1 auto; min-width: 0;
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dual-preview-actions {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 6px;
}
.dual-preview-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 9px; font-size: 11px; font-weight: 500;
  font-family: var(--font-sans);
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 5px;
  color: var(--text-mid);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.dual-preview-btn:hover { background: rgba(255,255,255,0.07); color: var(--text-strong); border-color: rgba(255,255,255,0.14); }
.dual-preview-btn.primary {
  background: rgba(255,107,53,0.12);
  border-color: rgba(255,107,53,0.28);
  color: var(--accent-light);
}
.dual-preview-btn.primary:hover {
  background: rgba(255,107,53,0.2);
  border-color: rgba(255,107,53,0.5);
  color: var(--accent);
}
.dual-preview-btn.ok { color: var(--ok); border-color: rgba(86,211,100,0.4); }
.dual-preview-btn.busy { opacity: 0.7; cursor: wait; }
.dual-preview-btn:disabled { cursor: not-allowed; opacity: 0.6; }

.dual-preview-md {
  padding: 24px 32px; max-width: 720px; margin: 0 auto;
  font-family: var(--font-sans); font-size: 14px; line-height: 1.7;
  color: var(--text);
  /* Allow text selection + native context menu (Copy) inside the rendered
     markdown — overrides the app-wide user-select: none default. */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.dual-preview-md ::selection { background: rgba(255,107,53,0.3); color: var(--text-strong); }
.dual-preview-md h1 { font-size: 24px; color: var(--text-strong); margin: 0 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.dual-preview-md h2 { font-size: 20px; color: var(--text-strong); margin: 18px 0 8px; }
.dual-preview-md h3 { font-size: 16px; color: var(--text-strong); margin: 14px 0 6px; }
.dual-preview-md code { background: var(--surface-alt); padding: 2px 5px; border-radius: 3px; font-family: var(--font-mono); font-size: 12px; color: var(--accent-light); }
.dual-preview-md pre { background: var(--surface-alt); border: 1px solid var(--border); border-radius: 4px; padding: 10px 12px; margin: 8px 0; overflow-x: auto; }
.dual-preview-md pre code { background: none; padding: 0; color: var(--text-strong); }
.dual-preview-md a { color: var(--info); }
.dual-preview-md img { max-width: 100%; border-radius: 4px; }
.dual-preview-md blockquote { border-left: 3px solid var(--border); padding-left: 10px; color: var(--text-mid); margin: 6px 0; }
.dual-preview-md table { border-collapse: collapse; margin: 6px 0; font-size: 12px; }
.dual-preview-md th, .dual-preview-md td { border: 1px solid var(--border); padding: 4px 8px; }
.dual-preview-md th { background: var(--surface-alt); }
.dual-mode-toggle-group {
  display: none; align-items: center;
  position: absolute; top: 8px; right: 8px; z-index: 8;
  background: var(--surface); border: 1px solid var(--border); border-radius: 5px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  overflow: hidden;
}
.dual-mode-toggle-group.show { display: flex; }
.dual-mode-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 26px; border: none;
  background: transparent; color: var(--text-dim); cursor: pointer;
  transition: all 0.12s;
}
.dual-mode-btn:not(:last-child) { border-right: 1px solid var(--border); }
.dual-mode-btn:hover { background: var(--surface-alt); color: var(--text); }
.dual-mode-btn.active { background: rgba(255,107,53,0.12); color: var(--accent); }
`;
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();

    function onFileChanged() {
      ensureToggleBtn();
      const fp = state.activeFile;
      if (toggleBtn) toggleBtn.classList.toggle('show', isPreviewable(fp));
      if (!isPreviewable(fp) && viewMode !== 'code') setViewMode('code');
      if (previewVisible && isPreviewable(fp)) updateContent();
    }

    bus.on('editor:active-changed', onFileChanged);
    bus.on('editor:dirty-changed', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(updateContent, 400); });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        if (isPreviewable(state.activeFile)) { e.preventDefault(); toggle(); }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
