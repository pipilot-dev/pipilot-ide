// PiPilot IDE — Shared HTML → PDF export
//
// Centralised PDF generation used by both the markdown dual-mode preview
// and the wiki view. Wraps html2pdf.js (lazy-loaded from CDN), with a
// fallback to window.print() through a sandboxed body-level container
// when the CDN is unavailable.
//
// Usage:
//   await window.PiPilot.pdfExport.exportNode(domNode, 'README');
//
// The given node's innerHTML is wrapped in a self-contained, GitHub-flavored
// HTML document, sized for A4 portrait, white-bg + dark text, with proper
// page-break heuristics. Result is saved as <fileName>.pdf via the browser
// download mechanism (no system print dialog).

(function () {
  'use strict';
  if (window.__pipilotPdfExportLoaded) return;
  window.__pipilotPdfExportLoaded = true;

  const bus = window.PiPilot && window.PiPilot.bus;

  let html2pdfPromise = null;
  function ensureHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (html2pdfPromise) return html2pdfPromise;
    html2pdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
      s.async = true;
      s.onload = () => window.html2pdf
        ? resolve(window.html2pdf)
        : reject(new Error('html2pdf global missing'));
      s.onerror = () => { html2pdfPromise = null; s.remove(); reject(new Error('Failed to load html2pdf.js from CDN')); };
      document.head.appendChild(s);
    });
    return html2pdfPromise;
  }

  function escapeHtmlSafe(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function buildPrintHtml(rawHtml, title) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtmlSafe(title)}</title>
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
  h1, h2, h3, h4, h5, h6 { color: #111; margin: 1.4em 0 0.5em; page-break-after: avoid; }
  h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; }
  h4 { font-size: 1em; }
  p { margin: 0 0 1em; }
  a { color: #0366d6; text-decoration: none; word-break: break-word; }
  a:hover { text-decoration: underline; }
  strong { color: #000; }
  code {
    background: #f6f8fa; color: #b32d2e;
    padding: 0.2em 0.4em; border-radius: 3px;
    font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, Menlo, monospace;
    font-size: 85%;
  }
  pre {
    background: #f6f8fa; color: #24292e;
    border: 1px solid #e1e4e8;
    padding: 12px 14px; border-radius: 6px;
    overflow-x: auto; line-height: 1.5; font-size: 9.5pt;
    page-break-inside: avoid;
  }
  pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
  blockquote {
    margin: 1em 0; padding: 0 1em;
    color: #6a737d; border-left: 4px solid #dfe2e5;
  }
  ul, ol { padding-left: 2em; margin: 0 0 1em; }
  li { margin: 0.25em 0; }
  hr { border: none; border-top: 1px solid #e1e4e8; margin: 2em 0; }
  table {
    border-collapse: collapse; width: 100%; margin: 1em 0;
    font-size: 10pt; page-break-inside: avoid;
  }
  th, td { border: 1px solid #dfe2e5; padding: 6px 13px; }
  th { background: #f6f8fa; font-weight: 600; text-align: left; }
  img { max-width: 100%; height: auto; border-radius: 4px; page-break-inside: avoid; }
  svg { max-width: 100%; height: auto; page-break-inside: avoid; }
  details { margin: 1em 0; }
  summary { cursor: pointer; font-weight: 500; }
</style>
</head>
<body>${rawHtml}</body>
</html>`;
  }

  async function exportNode(node, fileName) {
    if (!node) return false;
    const baseName = String(fileName || 'document').replace(/\.[^.]+$/, '');
    const outName = baseName + '.pdf';
    try {
      const html2pdf = await ensureHtml2Pdf();
      const fullHtml = buildPrintHtml(node.innerHTML, baseName);
      const opt = {
        margin: [12, 12, 14, 12],
        filename: outName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2, useCORS: true, letterRendering: true,
          backgroundColor: '#ffffff', logging: false,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      };
      await html2pdf().set(opt).from(fullHtml).save();
      bus?.emit?.('toast:show', { message: 'Saved ' + outName, type: 'ok' });
      return true;
    } catch (err) {
      console.warn('[pdf-export] html2pdf failed, falling back to print():', err);
      bus?.emit?.('toast:show', { message: 'Using browser print dialog (offline?)', type: 'info' });
      legacyPrintFallback(node, baseName);
      return false;
    }
  }

  // window.print() fallback — sandboxed body-level container so ancestor
  // overflow:hidden / scroll containers don't clip the export.
  function legacyPrintFallback(node, fileName) {
    if (!node) return;
    document.getElementById('pp-print-host')?.remove();
    document.getElementById('pp-print-styles')?.remove();
    const host = document.createElement('div');
    host.id = 'pp-print-host';
    const inner = document.createElement('div');
    inner.innerHTML = node.innerHTML;
    host.appendChild(inner);
    document.body.appendChild(host);
    const style = document.createElement('style');
    style.id = 'pp-print-styles';
    style.textContent = `
      #pp-print-host { display: none; }
      @media print {
        @page { margin: 16mm 14mm; size: A4; }
        html, body { background:#fff !important; color:#111 !important; margin:0 !important; padding:0 !important; height:auto !important; overflow:visible !important; }
        body > *:not(#pp-print-host) { display:none !important; }
        #pp-print-host { display:block !important; position:static !important; width:100% !important; height:auto !important; overflow:visible !important; background:#fff !important; }
        #pp-print-host * { color:#111 !important; }
        #pp-print-host pre { background:#f8f8f8 !important; border:1px solid #ddd !important; page-break-inside:avoid; }
        #pp-print-host code { background:#f3f3f3 !important; color:#b32d2e !important; }
        #pp-print-host h1, #pp-print-host h2, #pp-print-host h3 { page-break-after:avoid; }
        #pp-print-host img, #pp-print-host svg, #pp-print-host table { page-break-inside:avoid; max-width:100% !important; }
      }
    `;
    document.head.appendChild(style);
    const oldTitle = document.title;
    document.title = String(fileName || 'document').replace(/\.[^.]+$/, '');
    setTimeout(() => { try { window.print(); } catch (err) { console.error(err); } }, 60);
    const cleanup = () => {
      style.remove(); host.remove(); document.title = oldTitle;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => { if (document.getElementById('pp-print-host')) cleanup(); }, 60000);
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.pdfExport = { exportNode, legacyPrintFallback };
})();
