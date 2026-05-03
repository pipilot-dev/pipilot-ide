// PiPilot IDE — Diagram export utility
//
// Adds a right-click "Download as PNG / SVG / Copy SVG" context menu to
// any rendered <svg> element (mermaid diagrams, the dependency graph,
// any future inline SVGs). Works in three call sites:
//   • Chat panel mermaid blocks
//   • Markdown dual-mode preview
//   • Wiki view
//
// SVG download: serialize via XMLSerializer + Blob.
// PNG download: rasterize the serialized SVG via Image → Canvas → toBlob.
//
// PNG renders at 2× scale (retina-crisp) over a dark IDE background to
// match what users see on screen. Pass {bg:'transparent'} or any color
// to override.

(function () {
  'use strict';
  if (window.__pipilotDiagramExportLoaded) return;
  window.__pipilotDiagramExportLoaded = true;

  // ── Serialization ─────────────────────────────────────────────────
  function ensureSvgNamespaces(svgEl) {
    if (!svgEl.getAttribute('xmlns')) {
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!svgEl.getAttribute('xmlns:xlink')) {
      svgEl.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }
  }

  function serializeSvg(svgEl) {
    const clone = svgEl.cloneNode(true);
    ensureSvgNamespaces(clone);
    // Mermaid sometimes leaves width/height unset on the SVG root; if so
    // fall back to viewBox so the PNG canvas knows what dimensions to use.
    const xml = new XMLSerializer().serializeToString(clone);
    return xml.startsWith('<?xml') ? xml : '<?xml version="1.0" standalone="no"?>\n' + xml;
  }

  function svgDimensions(svgEl) {
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    const rect = svgEl.getBoundingClientRect();
    const w = (vb && vb.width)  || svgEl.clientWidth  || rect.width  || 800;
    const h = (vb && vb.height) || svgEl.clientHeight || rect.height || 600;
    return { width: Math.ceil(w), height: Math.ceil(h) };
  }

  // ── Download helpers ──────────────────────────────────────────────
  function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 200);
  }

  function ensureExt(name, ext) {
    return name.toLowerCase().endsWith('.' + ext) ? name : name + '.' + ext;
  }

  function safeName(s) {
    return String(s || 'diagram')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'diagram';
  }

  function downloadSVG(svgEl, fileName) {
    if (!svgEl) return;
    const xml = serializeSvg(svgEl);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, ensureExt(safeName(fileName), 'svg'));
  }

  async function downloadPNG(svgEl, fileName, opts) {
    if (!svgEl) return;
    const scale = (opts && opts.scale) || 2;
    const bg = opts && opts.bg !== undefined ? opts.bg : '#16161a';
    const { width, height } = svgDimensions(svgEl);
    const xml = serializeSvg(svgEl);
    // data URL avoids CORS/taint issues compared to object URLs in some
    // Electron contexts.
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error('Failed to load SVG into image: ' + (e?.message || e)));
      img.src = dataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (bg && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          triggerDownload(blob, ensureExt(safeName(fileName), 'png'));
        }
        resolve();
      }, 'image/png');
    });
  }

  // ── Right-click menu ──────────────────────────────────────────────
  let activeMenu = null;
  function closeMenu() {
    if (!activeMenu) return;
    try { activeMenu.remove(); } catch {}
    activeMenu = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
  }
  function onOutside(e) { if (activeMenu && !activeMenu.contains(e.target)) closeMenu(); }
  function onEsc(e) { if (e.key === 'Escape') closeMenu(); }

  function showMenu(x, y, svgEl, baseFileName) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'pp-diag-menu';
    const items = [
      { id: 'png',      label: 'Download as PNG', icon: '🖼️' },
      { id: 'svg',      label: 'Download as SVG', icon: '📐' },
      { id: 'copy',     label: 'Copy SVG markup', icon: '📋' },
    ];
    menu.innerHTML = items.map(i =>
      `<div class="pp-diag-menu-item" data-action="${i.id}">
         <span class="pp-diag-menu-icon">${i.icon}</span>
         <span class="pp-diag-menu-label">${i.label}</span>
       </div>`
    ).join('');
    document.body.appendChild(menu);
    activeMenu = menu;

    // Position with viewport clamp
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = Math.min(x, vw - r.width - 8) + 'px';
    menu.style.top  = Math.min(y, vh - r.height - 8) + 'px';

    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.pp-diag-menu-item');
      if (!item) return;
      const action = item.dataset.action;
      const name = safeName(baseFileName || 'diagram-' + Date.now());
      try {
        if (action === 'png')  await downloadPNG(svgEl, name);
        else if (action === 'svg') downloadSVG(svgEl, name);
        else if (action === 'copy') {
          await navigator.clipboard.writeText(serializeSvg(svgEl));
          if (window.PiPilot?.bus?.emit) window.PiPilot.bus.emit('toast:show', { message: 'SVG markup copied', type: 'ok' });
        }
      } catch (err) {
        if (window.PiPilot?.bus?.emit) window.PiPilot.bus.emit('toast:show', { message: 'Export failed: ' + err.message, type: 'error' });
      }
      closeMenu();
    });

    // Defer outside-click so the same right-click event doesn't immediately
    // close the menu we just opened.
    setTimeout(() => {
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onEsc, true);
    }, 0);
  }

  function attachExportMenu(svgEl, baseFileName) {
    if (!svgEl || svgEl.dataset.ppExportAttached === '1') return;
    svgEl.dataset.ppExportAttached = '1';
    svgEl.style.cursor = svgEl.style.cursor || 'context-menu';
    svgEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMenu(e.clientX, e.clientY, svgEl, baseFileName);
    });
  }

  // Convenience: walk a container and attach the menu to every <svg> child.
  function attachToAllSvgs(container, baseFileName) {
    if (!container) return;
    container.querySelectorAll('svg').forEach((svg, i) => {
      const name = baseFileName ? `${baseFileName}-${i + 1}` : 'diagram-' + (i + 1);
      attachExportMenu(svg, name);
    });
  }

  // ── Styles for the menu (matches IDE chrome) ──────────────────────
  if (!document.getElementById('pp-diag-menu-styles')) {
    const s = document.createElement('style');
    s.id = 'pp-diag-menu-styles';
    s.textContent = `
.pp-diag-menu {
  position: fixed; z-index: 10000;
  min-width: 200px;
  padding: 4px;
  background: #1c1c21;
  border: 1px solid #2e2e35;
  border-radius: 6px;
  box-shadow: 0 14px 36px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 12.5px;
  color: #b0b0b8;
  user-select: none;
}
.pp-diag-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.pp-diag-menu-item:hover {
  background: rgba(255,107,53,0.10);
  color: #d9d9de;
}
.pp-diag-menu-icon { font-size: 14px; line-height: 1; opacity: 0.9; flex-shrink: 0; }
.pp-diag-menu-label { flex: 1; }
`;
    document.head.appendChild(s);
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.diagramExport = { downloadSVG, downloadPNG, attachExportMenu, attachToAllSvgs };
})();
