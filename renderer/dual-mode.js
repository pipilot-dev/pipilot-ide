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
        try { html = window.marked.parse(content); } catch { html = esc(content).replace(/\n/g, '<br>'); }
      } else {
        html = esc(content).replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
      }
      previewPanel.innerHTML = `<div class="dual-preview-md">${html}</div>`;
      // Mermaid
      if (window.mermaid) {
        previewPanel.querySelectorAll('pre code.language-mermaid').forEach(code => {
          const pre = code.closest('pre'); if (!pre) return;
          const src = code.textContent || '';
          const div = document.createElement('div');
          div.style.cssText = 'margin:12px 0;text-align:center;overflow-x:auto;padding:16px;';
          const id = 'dm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          try { window.mermaid.render(id, src).then(({ svg }) => { div.innerHTML = svg; pre.replaceWith(div); }).catch(() => {}); } catch {}
        });
      }
    } else if (type === 'svg') {
      const safe = content.replace(/<script[\s\S]*?<\/script>/gi, '');
      previewPanel.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:24px;background:repeating-conic-gradient(#2a2a2e 0% 25%, #222226 0% 50%) 50% / 16px 16px;">${safe}</div>`;
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
.dual-preview-md {
  padding: 24px 32px; max-width: 720px; margin: 0 auto;
  font-family: var(--font-sans); font-size: 14px; line-height: 1.7;
  color: var(--text);
}
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
