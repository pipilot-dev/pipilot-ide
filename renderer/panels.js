// PiPilot IDE — Sidebar panel renderers (Phase 5)
// Registered on window.PiPilot.panels — sidebar.js calls these for git/extensions/checkpoints/deploy.

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  function injectStyles() {
    if (document.getElementById('panels-inline-styles')) return;
    const css = `
.p-section { padding: 8px 12px; border-bottom: 1px solid var(--border); }
.p-section h4 { color: var(--text-mid); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; font-weight: 600; }
.p-row {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; font-size: var(--fs-sm);
  border-radius: 3px; cursor: pointer;
}
.p-row:hover { background: var(--surface-alt); }
.p-row .name { flex: 1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-row .badge-mini { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); }
.p-row .badge-M { background: rgba(108,182,255,0.15); color: var(--info); }
.p-row .badge-A { background: rgba(86,211,100,0.15); color: var(--ok); }
.p-row .badge-D { background: rgba(229,83,75,0.15); color: var(--error); }
.p-row .badge-U, .p-row .badge-\\? { background: rgba(229,166,57,0.15); color: var(--warn); }
.p-row .row-actions { display: none; gap: 2px; }
.p-row:hover .row-actions { display: inline-flex; }
.p-row .row-actions button { padding: 1px 4px; font-size: 10px; color: var(--text-dim); background: transparent; border: 1px solid var(--border); border-radius: 3px; }
.p-row .row-actions button:hover { color: var(--accent); border-color: var(--accent); }

.p-commit {
  padding: 8px 12px; border-bottom: 1px solid var(--border);
}
.p-commit textarea {
  width: 100%; min-height: 50px; max-height: 140px; padding: 6px 8px;
  background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-strong); font-family: var(--font-sans); font-size: var(--fs-sm); resize: vertical;
}
.p-commit-actions { display: flex; gap: 6px; margin-top: 6px; }

.p-tabs { display: flex; border-bottom: 1px solid var(--border); }
.p-tab {
  flex: 1; padding: 8px; font-size: var(--fs-sm); color: var(--text-mid);
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
}
.p-tab.active { color: var(--text-strong); border-bottom-color: var(--accent); }

.connector-card {
  display: flex; gap: 10px; padding: 10px; border: 1px solid var(--border);
  border-radius: var(--radius); margin: 6px 0; align-items: center;
}
.connector-card .icon { font-size: 22px; }
.connector-card .info { flex: 1; }
.connector-card .info .name { color: var(--text-strong); font-weight: 500; font-size: var(--fs-sm); }
.connector-card .info .desc { color: var(--text-dim); font-size: 11px; }
.connector-card .info .conn { color: var(--ok); font-size: 11px; margin-top: 2px; }

.toggle {
  position: relative; width: 28px; height: 16px; background: var(--border);
  border-radius: 8px; cursor: pointer; transition: background var(--t);
}
.toggle.on { background: var(--accent); }
.toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  background: white; border-radius: 50%; transition: transform var(--t);
}
.toggle.on::after { transform: translateX(12px); }

.cp-item {
  padding: 10px; border-bottom: 1px solid var(--border);
}
.cp-item .label { color: var(--text-strong); font-weight: 500; font-size: var(--fs-sm); }
.cp-item .meta { color: var(--text-dim); font-size: 11px; margin: 2px 0 6px; }
.cp-item .actions { display: flex; gap: 6px; }

.dev-item {
  padding: 10px; border-bottom: 1px solid var(--border);
}
.dev-item .cmd { font-family: var(--font-mono); font-size: 11px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-item .url { color: var(--info); font-size: 11px; margin-top: 2px; }
.dev-item .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; }
.dev-item .status-dot.running { background: var(--ok); }
.dev-item .status-dot.stopped { background: var(--text-faint); }
.dev-item .status-dot.error { background: var(--error); }

.commits-list { max-height: 240px; overflow-y: auto; }
.commit-row { padding: 6px 12px; font-size: 11px; border-bottom: 1px solid var(--border); }
.commit-row .hash { color: var(--accent); font-family: var(--font-mono); }
.commit-row .msg { color: var(--text); }
.commit-row .meta { color: var(--text-dim); font-size: 10px; }

/* ── Git Panel Redesign ──────────────────────────────────────────────── */
.git-panel-root { position: relative; }
.git-loading {
  display: flex; align-items: center; gap: 8px; padding: 16px;
  color: var(--text-dim); font-size: 11px;
}
.git-loading-spinner {
  width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%;
  animation: tool-spin 0.8s linear infinite;
}
.git-empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 32px 16px; gap: 12px; text-align: center;
}
.git-empty-icon { color: var(--text-dim); }
.git-empty-title { font-size: 14px; font-weight: 600; color: var(--text-strong); }
.git-empty-desc { font-size: 11px; color: var(--text-dim); max-width: 260px; }

.git-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-bottom: 1px solid var(--border);
}
.git-branch-btn {
  display: flex; align-items: center; gap: 4px;
  background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 8px; color: var(--text);
  font-family: var(--font-mono); font-size: 11px; cursor: pointer;
  transition: border-color 0.15s;
}
.git-branch-btn:hover { border-color: var(--accent); }
.git-branch-btn svg { color: var(--accent); flex-shrink: 0; }
.git-branch-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-branch-chevron { font-size: 8px; color: var(--text-dim); }
.git-sync {
  font-family: var(--font-mono); font-size: 10px; color: var(--info);
  padding: 2px 6px; border-radius: 3px; background: rgba(108,182,255,0.1);
}
.git-action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; background: transparent; border: 1px solid transparent;
  border-radius: 4px; color: var(--text-dim); cursor: pointer; transition: all 0.15s;
}
.git-action-btn:hover { color: var(--text); background: var(--surface-alt); border-color: var(--border); }
.git-action-btn svg { width: 14px; height: 14px; }

.git-branch-dropdown, .git-actions-menu {
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--surface-raised, var(--surface)); box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  margin: 0 8px; max-height: 240px; overflow-y: auto;
}
.git-branch-dropdown.hidden, .git-actions-menu.hidden { display: none; }
.git-popover-backdrop { position: fixed; inset: 0; z-index: 1000; }
.git-actions-menu.popover, .git-branch-dropdown.popover {
  position: fixed; z-index: 1001;
  margin: 0; max-height: 360px;
}
.git-branch-item {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 12px;
  background: transparent; border: none; color: var(--text-mid);
  font-size: 11px; font-family: var(--font-mono); cursor: pointer; text-align: left;
  transition: background 0.1s;
}
.git-branch-item:hover { background: var(--surface-alt); }
.git-branch-item.active { color: var(--accent); }
.git-branch-item.create { color: var(--ok); border-bottom: 1px solid var(--border); }
.git-current-badge {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em;
  padding: 1px 5px; border-radius: 2px; background: rgba(255,107,53,0.12);
  color: var(--accent); margin-left: 4px;
}
.git-menu-item {
  display: block; width: 100%; padding: 8px 14px; background: transparent;
  border: none; color: var(--text); font-size: 12px; cursor: pointer;
  text-align: left; transition: background 0.1s;
}
.git-menu-item:hover { background: var(--surface-alt); }
.git-menu-item.danger { color: var(--error); }
.git-menu-item.danger:hover { background: rgba(229,83,75,0.08); }
.git-menu-sep { height: 1px; background: var(--border); margin: 4px 0; }

.git-commit-box {
  padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.git-commit-box textarea {
  width: 100%; min-height: 48px; max-height: 120px; padding: 8px 10px;
  background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text); font-family: var(--font-sans);
  font-size: 12px; resize: vertical; outline: none; box-sizing: border-box;
}
.git-commit-box textarea:focus { border-color: var(--accent); }
.git-commit-actions {
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
}
.git-ai-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; background: rgba(255,107,53,0.08);
  border: 1px solid rgba(255,107,53,0.2); border-radius: 4px;
  color: var(--accent); cursor: pointer; transition: all 0.15s;
}
.git-ai-btn:hover { background: rgba(255,107,53,0.15); border-color: var(--accent); }
.git-amend-label {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-dim); cursor: pointer;
}
.git-amend-label input { accent-color: var(--accent); }

.git-file-section { border-bottom: 1px solid var(--border); }
.git-section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px;
}
.git-section-title {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--text-mid); font-weight: 600;
}
.git-section-actions { display: flex; gap: 2px; }
.git-section-action {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border); border-radius: 3px;
  color: var(--text-dim); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.git-section-action:hover { color: var(--text); background: var(--surface-alt); }
.git-section-action.danger:hover { color: var(--error); background: rgba(229,83,75,0.08); }

.git-file-row {
  display: flex; align-items: center; gap: 6px; padding: 4px 12px;
  cursor: pointer; transition: background 0.1s;
}
.git-file-row:hover { background: var(--surface-alt); }
.git-file-badge {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  font-family: var(--font-mono); font-weight: 600; flex-shrink: 0;
}
.git-file-badge.badge-M { background: rgba(108,182,255,0.15); color: var(--info); }
.git-file-badge.badge-A { background: rgba(86,211,100,0.15); color: var(--ok); }
.git-file-badge.badge-D { background: rgba(229,83,75,0.15); color: var(--error); }
.git-file-badge.badge-R { background: rgba(229,166,57,0.15); color: var(--warn); }
.git-file-badge.badge-U, .git-file-badge.badge-\? { background: rgba(229,166,57,0.15); color: var(--warn); }
.git-file-name {
  flex: 1; font-size: 11px; color: var(--text); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.git-file-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.git-file-row:hover .git-file-actions { opacity: 1; }
.git-file-action {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  background: var(--surface-alt); border: 1px solid var(--border); border-radius: 3px;
  color: var(--text-dim); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.git-file-action:hover { color: var(--text); border-color: var(--accent); }
.git-file-action.danger:hover { color: var(--error); border-color: var(--error); }

.git-commits-list { max-height: 280px; overflow-y: auto; }
.git-commit-row {
  padding: 8px 12px; cursor: pointer; transition: background 0.1s;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.git-commit-row:hover { background: var(--surface-alt); }
.git-commit-main { display: flex; align-items: baseline; gap: 6px; }
.git-commit-hash {
  font-family: var(--font-mono); font-size: 10px; color: var(--accent);
  flex-shrink: 0;
}
.git-commit-msg { font-size: 11px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-commit-meta { font-size: 10px; color: var(--text-dim); margin-top: 2px; }

/* ── Git Panel v2 additions ───────────────────────────────────────────── */
.git-top-header {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px 5px 12px; border-bottom: 1px solid var(--border);
}
.git-top-title {
  flex: 1; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--text-mid); font-weight: 700;
}
.git-refresh-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; background: transparent; border: none;
  color: var(--text-dim); cursor: pointer; border-radius: 3px; transition: all 0.15s;
}
.git-refresh-btn:hover { color: var(--text); background: var(--surface-alt); }
.git-refresh-btn.spinning svg { animation: tool-spin 0.7s linear infinite; }

.git-branch-bar {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px; background: rgba(0,0,0,0.15); border-bottom: 1px solid var(--border);
}
.git-branch-bar .git-branch-btn { flex: 1; min-width: 0; }
.git-bar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; background: transparent; border: 1px solid transparent;
  border-radius: 4px; color: var(--text-dim); cursor: pointer; transition: all 0.15s;
  flex-shrink: 0;
}
.git-bar-btn:hover:not(:disabled) { color: var(--text); background: var(--surface-alt); border-color: var(--border); }
.git-bar-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.git-bar-btn svg { width: 13px; height: 13px; }
.git-bar-btn.spinning svg { animation: tool-spin 0.7s linear infinite; }

.git-status-bar {
  padding: 5px 12px; font-size: 11px; background: rgba(86,211,100,0.08);
  border-bottom: 1px solid rgba(86,211,100,0.2); color: var(--ok);
  animation: git-bar-in 0.15s ease;
}
.git-status-bar.error { background: rgba(229,83,75,0.08); border-color: rgba(229,83,75,0.2); color: var(--error); }
.git-status-bar.info { background: rgba(108,182,255,0.08); border-color: rgba(108,182,255,0.2); color: var(--info); }
@keyframes git-bar-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

.git-new-branch-input {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  border-bottom: 1px solid var(--border); background: var(--surface);
}
.git-new-branch-input input {
  flex: 1; background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 8px; color: var(--text); font-family: var(--font-mono);
  font-size: 11px; outline: none;
}
.git-new-branch-input input:focus { border-color: var(--accent); }
.git-new-branch-input button {
  padding: 4px 10px; font-size: 11px; border-radius: 4px; cursor: pointer;
  background: var(--accent); border: none; color: white; font-weight: 600; transition: opacity 0.15s;
}
.git-new-branch-input button:hover { opacity: 0.85; }

.git-section-chevron {
  font-size: 9px; color: var(--text-dim); margin-right: 4px;
  transition: transform 0.15s; display: inline-block;
}
.git-section-chevron.open { transform: rotate(90deg); }
.git-section-left { display: flex; align-items: center; cursor: pointer; flex: 1; gap: 4px; padding: 6px 0; }

.git-file-dir { font-size: 10px; color: var(--text-dim); flex-shrink: 0; margin-left: 2px; }

.git-commit-btn {
  padding: 3px 10px; font-size: 10px; font-weight: 600; border-radius: 3px;
  border: none; cursor: pointer; transition: all 0.15s; color: white; white-space: nowrap;
}
.git-commit-btn:not(:disabled) { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }
.git-commit-btn:not(:disabled):hover { opacity: 0.9; }
.git-commit-btn:disabled { background: var(--surface-alt); color: var(--text-dim); cursor: not-allowed; }

.git-textarea-wrap { position: relative; }
.git-textarea-wrap .git-ai-btn {
  position: absolute; top: 6px; right: 6px;
}
.git-textarea-wrap textarea { padding-right: 36px !important; }

.git-ai-btn.spinning svg { animation: tool-spin 0.7s linear infinite; }

.git-working-clean {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 28px 16px; gap: 8px; color: var(--text-dim);
}
.git-working-clean svg { opacity: 0.5; }
.git-working-clean span { font-size: 12px; }
`;
    const s = document.createElement('style');
    s.id = 'panels-inline-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }
  injectStyles();

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }

  function fmtSize(n) {
    if (!n) return '0B';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'onClick') e.addEventListener('click', v);
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else e.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  // ---------------- GIT PANEL ----------------
  async function renderGitPanel(container, projectPath) {
    // ── local helpers ──────────────────────────────────────────────────────
    function escapeHtml(s) {
      return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function splitPath(p) {
      const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (i < 0) return { name: p, dir: '' };
      return { name: p.slice(i + 1), dir: p.slice(0, i + 1) };
    }
    function svgIcon(d, size = 14, extra = '') {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
    }
    const ICONS = {
      branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
      refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
      pull: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
      push: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
      more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
      sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
      file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chevron: '<polyline points="9 18 15 12 9 6"/>',
      plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
      fetch: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      stash: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8l-2 4h12z"/>',
      merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
      cherry: '<circle cx="12" cy="15" r="5"/><path d="M12 10V5"/><path d="M8 5c0-1.7 1.3-3 3-3s3 1.3 3 3"/>',
      trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
      reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
      remote: '<circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>',
    };

    // ── panel state ────────────────────────────────────────────────────────
    let busy = false;
    let showBranchDropdown = false;
    let showActionsMenu = false;
    let branchMenuPos = null; // { top, left, width }
    let actionsMenuPos = null; // { top, left, width }
    let showNewBranch = false;
    let expandStaged = true;
    let expandChanges = true;
    let expandHistory = true;
    let statusMsg = null; // { text, type } — auto-clears
    let statusMsgTimer = null;
    let gitStatus = null;
    let hasRemote = false;
    let refreshTimer = null;

    function showStatusMsg(text, type = 'success') {
      statusMsg = { text, type };
      clearTimeout(statusMsgTimer);
      statusMsgTimer = setTimeout(() => { statusMsg = null; renderAll(); }, type === 'error' ? 5000 : 3000);
    }

    // ── initial load ───────────────────────────────────────────────────────
    container.classList.add('git-panel-root');
    container.innerHTML = '<div class="git-loading"><div class="git-loading-spinner"></div><span>Loading…</span></div>';

    async function loadStatus() {
      try {
        const r = await api.git.status(projectPath);
        if (!r || r.ok === false) return null;
        return r.status || r;
      } catch { return null; }
    }

    gitStatus = await loadStatus();

    if (!gitStatus) {
      container.innerHTML = '';
      const empty = el('div', { class: 'git-empty-state' });
      empty.innerHTML = `
        <div class="git-empty-icon">${svgIcon(ICONS.branch, 32)}</div>
        <div class="git-empty-title">No Repository</div>
        <div class="git-empty-desc">Initialize a git repository to track changes.</div>
        <button class="btn btn-primary btn-small" id="git-init-btn">Initialize Repository</button>
      `;
      container.appendChild(empty);
      container.querySelector('#git-init-btn')?.addEventListener('click', async () => {
        await api.git.init(projectPath);
        renderGitPanel(container, projectPath);
      });
      return;
    }

    // Try to detect remote
    try {
      const lo = await api.git.log(projectPath, { limit: 1 });
      hasRemote = !!(lo?.remote || lo?.remotes?.length || gitStatus.ahead !== undefined || gitStatus.behind !== undefined);
    } catch {}

    bus.emit('git:branch-changed', gitStatus.branch);

    // ── build + mount ──────────────────────────────────────────────────────
    function renderAll() {
      // preserve scroll
      const scrollTop = container.scrollTop;

      // cleanup any previous popovers/backdrops when re-rendering
      document.querySelectorAll('.git-actions-menu.popover, .git-branch-dropdown.popover, .git-popover-backdrop')
        .forEach(n => { try { n.remove(); } catch {} });

      container.innerHTML = '';

      const s = gitStatus || {};
      const allFiles = s.files || [];
      const stagedFiles  = allFiles.filter(f => f.index && f.index !== ' ' && f.index !== '?');
      const changedFiles = allFiles.filter(f => (f.working_dir && f.working_dir !== ' ') || (!f.index || f.index === '?'));
      // dedupe: remove pure-staged from changedFiles
      const unstagedFiles = allFiles.filter(f => f.working_dir && f.working_dir !== ' ' && f.working_dir !== '?');
      const untrackedFiles = allFiles.filter(f => f.index === '?' || f.working_dir === '?');
      const changedAll = [...unstagedFiles, ...untrackedFiles];

      // ── 1. Top header ──────────────────────────────────────────────────
      const topHeader = el('div', { class: 'git-top-header' });
      topHeader.appendChild(el('span', { class: 'git-top-title' }, 'Source Control'));
      const refreshBtn = el('button', { class: 'git-refresh-btn' + (busy ? ' spinning' : ''), title: 'Refresh' });
      refreshBtn.innerHTML = svgIcon(ICONS.refresh, 13);
      refreshBtn.addEventListener('click', async () => {
        if (busy) return;
        refreshBtn.classList.add('spinning');
        gitStatus = await loadStatus();
        refreshBtn.classList.remove('spinning');
        renderAll();
      });
      topHeader.appendChild(refreshBtn);
      container.appendChild(topHeader);

      // ── 2. Branch + actions bar ────────────────────────────────────────
      const branchBar = el('div', { class: 'git-branch-bar' });

      const branchBtn = el('button', { class: 'git-branch-btn', title: 'Switch Branch' });
      branchBtn.innerHTML = svgIcon(ICONS.branch, 11) +
        `<span class="git-branch-name">${escapeHtml(s.branch || 'HEAD')}</span>` +
        `<span class="git-branch-chevron">▾</span>`;
      branchBar.appendChild(branchBtn);

      // ahead/behind sync badge
      const ahead = s.ahead || 0;
      const behind = s.behind || 0;
      if (ahead || behind) {
        const sync = el('span', { class: 'git-sync' });
        sync.textContent = `${behind ? '↓' + behind : ''}${behind && ahead ? ' ' : ''}${ahead ? '↑' + ahead : ''}`;
        branchBar.appendChild(sync);
      }

      const pullBarBtn = el('button', { class: 'git-bar-btn', title: 'Pull' });
      pullBarBtn.innerHTML = svgIcon(ICONS.pull, 13);
      if (!hasRemote) pullBarBtn.disabled = true;
      pullBarBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        pullBarBtn.classList.add('spinning');
        showStatusMsg('Pulling…', 'info');
        renderAll();
        try {
          const r = await api.git.pull(projectPath);
          if (r?.ok === false) showStatusMsg('Pull failed: ' + r.error, 'error');
          else showStatusMsg('Pulled successfully');
          gitStatus = await loadStatus();
        } catch (e) { showStatusMsg('Pull failed: ' + e.message, 'error'); }
        busy = false;
        renderAll();
      });
      branchBar.appendChild(pullBarBtn);

      const pushBarBtn = el('button', { class: 'git-bar-btn', title: 'Push' });
      pushBarBtn.innerHTML = svgIcon(ICONS.push, 13);
      if (!hasRemote) pushBarBtn.disabled = true;
      pushBarBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        pushBarBtn.classList.add('spinning');
        showStatusMsg('Pushing…', 'info');
        renderAll();
        try {
          const r = await api.git.push(projectPath);
          if (r?.ok === false) showStatusMsg('Push failed: ' + r.error, 'error');
          else { showStatusMsg('Pushed successfully'); gitStatus = await loadStatus(); }
        } catch (e) { showStatusMsg('Push failed: ' + e.message, 'error'); }
        busy = false;
        renderAll();
      });
      branchBar.appendChild(pushBarBtn);

      const moreBtn = el('button', { class: 'git-bar-btn', title: 'More Actions (…)' });
      moreBtn.innerHTML = svgIcon(ICONS.more, 13);
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        actionsMenuPos = { top: r.bottom + 6, left: Math.max(8, r.right - 220), width: 220 };
        showActionsMenu = !showActionsMenu;
        showBranchDropdown = false;
        renderAll();
      });
      branchBar.appendChild(moreBtn);
      container.appendChild(branchBar);

      // ── 3. Branch dropdown ─────────────────────────────────────────────
      if (showBranchDropdown) {
        const dropdown = el('div', {
          class: 'git-branch-dropdown popover',
          style: branchMenuPos ? { top: branchMenuPos.top + 'px', left: branchMenuPos.left + 'px', width: branchMenuPos.width + 'px' } : { top: '64px', left: '60px', width: '240px' },
        });

        // "New branch…" option
        const createItem = el('button', { class: 'git-branch-item create' });
        createItem.innerHTML = svgIcon(ICONS.plus, 11) + ' New branch…';
        createItem.addEventListener('click', (e) => {
          e.stopPropagation();
          showBranchDropdown = false;
          showNewBranch = true;
          renderAll();
        });
        dropdown.appendChild(createItem);

        dropdown.innerHTML += '<div style="padding:6px 12px;color:var(--text-dim);font-size:10px;">Loading…</div>';
        container.appendChild(dropdown);

        // async populate
        api.git.branches(projectPath).then(resp => {
          if (!resp || resp.ok === false) throw new Error(resp?.error || 'branches failed');
          const branches = Array.isArray(resp.local) ? resp.local : (Array.isArray(resp.all) ? resp.all : []);
          const current = resp.current || s.branch;
          dropdown.innerHTML = '';
          dropdown.appendChild(createItem);

          branches.forEach(b => {
            const bname = typeof b === 'string' ? b : (b.name || b.label || '');
            if (!bname || bname.startsWith('remotes/')) return;
            const isCurrent = bname === current;
            const item = el('button', { class: 'git-branch-item' + (isCurrent ? ' active' : '') });
            item.innerHTML = svgIcon(ICONS.branch, 11) + ' ' + escapeHtml(bname) +
              (isCurrent ? ' <span class="git-current-badge">current</span>' : '');
            item.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (isCurrent) return;
              showStatusMsg('Switching to ' + bname + '…', 'info');
              showBranchDropdown = false;
              renderAll();
              try {
                await api.git.checkout(projectPath, bname);
                gitStatus = await loadStatus();
                bus.emit('git:branch-changed', gitStatus?.branch);
              } catch (err) { showStatusMsg('Checkout failed: ' + err.message, 'error'); }
              renderAll();
            });
            dropdown.appendChild(item);
          });
        }).catch(() => {
          dropdown.innerHTML = '<div style="padding:8px 12px;color:var(--error);font-size:11px;">Failed to load branches</div>';
          dropdown.prepend(createItem);
        });

        container.appendChild(dropdown);
      }

      // ── 4. New-branch inline input ─────────────────────────────────────
      if (showNewBranch) {
        const nbWrap = el('div', { class: 'git-new-branch-input' });
        const nbInput = el('input', { type: 'text', placeholder: 'New branch name…' });
        nbInput.setAttribute('autofocus', '');
        const nbBtn = el('button', null, 'Create');
        const doCreate = async () => {
          const name = nbInput.value.trim();
          if (!name) return;
          showNewBranch = false;
          showStatusMsg('Creating branch ' + name + '…', 'info');
          renderAll();
          try {
            await api.git.createBranch(projectPath, name);
            gitStatus = await loadStatus();
            bus.emit('git:branch-changed', gitStatus?.branch);
          } catch (err) { showStatusMsg('Create branch failed: ' + err.message, 'error'); }
          renderAll();
        };
        nbInput.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') { showNewBranch = false; renderAll(); } });
        nbBtn.addEventListener('click', doCreate);
        nbWrap.appendChild(nbInput);
        nbWrap.appendChild(nbBtn);
        container.appendChild(nbWrap);
        setTimeout(() => nbInput.focus(), 0);
      }

      // ── 5. Status message bar ──────────────────────────────────────────
      if (statusMsg) {
        const bar = el('div', { class: 'git-status-bar ' + (statusMsg.type === 'error' ? 'error' : statusMsg.type === 'info' ? 'info' : '') });
        bar.textContent = statusMsg.text;
        container.appendChild(bar);
      }

      // ── 6. Commit box ──────────────────────────────────────────────────
      const commitBox = el('div', { class: 'git-commit-box' });

      const txWrap = el('div', { class: 'git-textarea-wrap' });
      const commitTextarea = el('textarea', {
        placeholder: 'Message (Ctrl+Enter to commit)',
        rows: '3',
        style: { width: '100%', boxSizing: 'border-box' },
      });
      commitTextarea.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); doCommit(); }
      });

      const aiBtn = el('button', { class: 'git-ai-btn', title: 'Generate commit message with AI' });
      aiBtn.innerHTML = svgIcon(ICONS.sparkle, 12);
      aiBtn.addEventListener('click', async () => {
        aiBtn.disabled = true;
        aiBtn.style.opacity = '0.5';
        aiBtn.classList.add('spinning');
        try {
          const diffResp = await api.git.diff(projectPath, null, true);
          const rawDiff = (diffResp?.diff || '');
          const lines = rawDiff.split(/\r?\n/);
          const diffText = lines.slice(0, 150).join('\n');
          if (!diffText.trim()) { showStatusMsg('No staged changes to summarize', 'info'); renderAll(); return; }
          const r = await api.codestral.commitMessage({ diff: diffText });
          if (r?.ok === false) throw new Error(r.error || 'Commit generator failed');
          const msg = String(r?.text || '').trim().replace(/^["'`]+|["'`]+$/g, '');
          if (msg) commitTextarea.value = msg;
        } catch (e) {
          showStatusMsg('AI failed: ' + e.message, 'error');
          renderAll();
        } finally {
          aiBtn.disabled = false;
          aiBtn.style.opacity = '1';
          aiBtn.classList.remove('spinning');
        }
      });

      txWrap.appendChild(commitTextarea);
      txWrap.appendChild(aiBtn);
      commitBox.appendChild(txWrap);

      const commitActions = el('div', { class: 'git-commit-actions' });

      const amendLabel = el('label', { class: 'git-amend-label' });
      const amendCheck = el('input', { type: 'checkbox' });
      amendLabel.appendChild(amendCheck);
      amendLabel.appendChild(document.createTextNode(' Amend'));
      commitActions.appendChild(amendLabel);

      commitActions.appendChild(el('div', { style: { flex: '1' } }));

      const stagedCount = stagedFiles.length;
      const commitBtn = el('button', { class: 'git-commit-btn' });
      commitBtn.textContent = stagedCount > 0 ? `Commit (${stagedCount})` : 'Commit';
      if (stagedCount === 0) commitBtn.disabled = true;

      async function doCommit() {
        const msg = commitTextarea.value.trim();
        if (!msg) { showStatusMsg('Enter a commit message first', 'info'); renderAll(); return; }
        if (stagedCount === 0) { showStatusMsg('No staged changes to commit', 'info'); renderAll(); return; }
        busy = true;
        commitBtn.disabled = true;
        commitBtn.textContent = 'Committing…';
        try {
          const r = await api.git.commit(projectPath, msg);
          if (r?.ok === false) { showStatusMsg('Commit failed: ' + r.error, 'error'); }
          else {
            const shortHash = (r?.hash || '').slice(0, 7);
            showStatusMsg('Committed' + (shortHash ? ' ' + shortHash : ''));
            commitTextarea.value = '';
            gitStatus = await loadStatus();
          }
        } catch (e) { showStatusMsg('Commit failed: ' + e.message, 'error'); }
        busy = false;
        renderAll();
      }

      commitBtn.addEventListener('click', doCommit);
      commitActions.appendChild(commitBtn);
      commitBox.appendChild(commitActions);
      container.appendChild(commitBox);

      // ── 7. Working tree clean ──────────────────────────────────────────
      if (stagedFiles.length === 0 && changedAll.length === 0) {
        const clean = el('div', { class: 'git-working-clean' });
        clean.innerHTML = svgIcon(ICONS.check, 22) + '<span>Working tree clean</span>';
        container.appendChild(clean);
      }

      // ── 8. File section builder ────────────────────────────────────────
      function buildFileSection(title, files, opts = {}) {
        if (!files.length) return;
        const expanded = opts.expanded !== undefined ? opts.expanded : true;
        const sec = el('div', { class: 'git-file-section' });
        const hdr = el('div', { class: 'git-section-header' });

        const leftSide = el('div', { class: 'git-section-left' });
        const chev = el('span', { class: 'git-section-chevron' + (expanded ? ' open' : '') });
        chev.innerHTML = svgIcon(ICONS.chevron, 9);
        leftSide.appendChild(chev);
        leftSide.appendChild(el('span', { class: 'git-section-title' }, `${title} (${files.length})`));
        leftSide.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onToggle && opts.onToggle();
        });
        hdr.appendChild(leftSide);

        const hdrActions = el('div', { class: 'git-section-actions' });

        if (opts.canStageAll) {
          const stageAllBtn = el('button', { class: 'git-section-action', title: 'Stage All (+)' });
          stageAllBtn.textContent = '+';
          stageAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try { await api.git.add(projectPath, files.map(f => typeof f === 'string' ? f : f.path)); } catch {}
            gitStatus = await loadStatus();
            renderAll();
          });
          hdrActions.appendChild(stageAllBtn);
        }
        if (opts.canUnstageAll) {
          const unstageAllBtn = el('button', { class: 'git-section-action', title: 'Unstage All (−)' });
          unstageAllBtn.textContent = '−';
          unstageAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            for (const f of files) { try { await api.git.unstage(projectPath, typeof f === 'string' ? f : f.path); } catch {} }
            gitStatus = await loadStatus();
            renderAll();
          });
          hdrActions.appendChild(unstageAllBtn);
        }
        if (opts.canDiscardAll) {
          const discardAllBtn = el('button', { class: 'git-section-action danger', title: 'Discard All (↺)' });
          discardAllBtn.textContent = '↺';
          discardAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await (window.PiPilot?.modal?.confirm?.({ title: 'Discard all?', message: 'Discard all changes in this section? This cannot be undone.', danger: true }) || Promise.resolve(confirm('Discard all?')));
            if (!ok) return;
            for (const f of files) { try { await api.git.discard(projectPath, typeof f === 'string' ? f : f.path); } catch {} }
            gitStatus = await loadStatus();
            renderAll();
          });
          hdrActions.appendChild(discardAllBtn);
        }
        hdr.appendChild(hdrActions);
        sec.appendChild(hdr);

        if (expanded) {
          files.forEach(f => {
            const filePath = typeof f === 'string' ? f : (f.path || f);
            const rawStatus = opts.isStaged
              ? (f.index || '?')
              : (f.working_dir || f.index || opts.defaultStatus || '?');
            const statusLetter = rawStatus.trim() || '?';
            const safeClass = statusLetter.replace(/[^a-zA-Z?]/g, '') || '?';
            const { name: fname, dir: fdir } = splitPath(filePath);

            const row = el('div', { class: 'git-file-row' });
            row.addEventListener('click', async (e) => {
              if (e.target.closest('.git-file-actions')) return;
              try {
                const staged = opts.isStaged || false;
                const resp = await api.git.fileVersions(projectPath, filePath, staged);
                if (resp && window.PiPilot?.editor?.openDiffTab) {
                  window.PiPilot.editor.openDiffTab({
                    name: 'Diff: ' + fname,
                    original: resp.original || '',
                    modified: resp.modified || '',
                    originalTitle: 'HEAD',
                    modifiedTitle: staged ? 'Staged' : 'Working Tree',
                  });
                } else {
                  bus.emit('file:open', { path: filePath });
                }
              } catch { bus.emit('file:open', { path: filePath }); }
            });

            row.innerHTML = svgIcon(ICONS.file, 12, 'style="flex-shrink:0;color:var(--text-dim)"');
            row.appendChild(el('span', { class: 'git-file-name' }, fname));
            if (fdir) row.appendChild(el('span', { class: 'git-file-dir' }, fdir));
            row.appendChild(el('div', { style: { flex: '1' } }));

            const rowActions = el('div', { class: 'git-file-actions' });

            if (opts.canDiscard) {
              const discardBtn = el('button', { class: 'git-file-action danger', title: 'Discard changes (↺)' });
              discardBtn.textContent = '↺';
              discardBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ok = await (window.PiPilot?.modal?.confirm?.({ title: 'Discard?', message: filePath, danger: true }) || Promise.resolve(confirm('Discard ' + filePath + '?')));
                if (!ok) return;
                try { await api.git.discard(projectPath, filePath); } catch {}
                gitStatus = await loadStatus();
                renderAll();
              });
              rowActions.appendChild(discardBtn);
            }
            if (opts.canStage) {
              const stageBtn = el('button', { class: 'git-file-action', title: 'Stage (+)' });
              stageBtn.textContent = '+';
              stageBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await api.git.add(projectPath, [filePath]); } catch {}
                gitStatus = await loadStatus();
                renderAll();
              });
              rowActions.appendChild(stageBtn);
            }
            if (opts.canUnstage) {
              const unstageBtn = el('button', { class: 'git-file-action', title: 'Unstage (−)' });
              unstageBtn.textContent = '−';
              unstageBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await api.git.unstage(projectPath, filePath); } catch {}
                gitStatus = await loadStatus();
                renderAll();
              });
              rowActions.appendChild(unstageBtn);
            }
            row.appendChild(rowActions);

            const badge = el('span', { class: `git-file-badge badge-${safeClass}` }, statusLetter);
            row.appendChild(badge);

            sec.appendChild(row);
          });
        }
        container.appendChild(sec);
      }

      // ── 9. Staged Changes section ──────────────────────────────────────
      if (stagedFiles.length > 0) {
        buildFileSection('Staged Changes', stagedFiles, {
          isStaged: true,
          expanded: expandStaged,
          canUnstage: true,
          canUnstageAll: true,
          onToggle: () => { expandStaged = !expandStaged; renderAll(); },
        });
      }

      // ── 10. Changes section ────────────────────────────────────────────
      if (changedAll.length > 0) {
        buildFileSection('Changes', changedAll, {
          isStaged: false,
          expanded: expandChanges,
          canStage: true,
          canStageAll: true,
          canDiscard: true,
          canDiscardAll: true,
          defaultStatus: '?',
          onToggle: () => { expandChanges = !expandChanges; renderAll(); },
        });
      }

      // ── 11. History section ────────────────────────────────────────────
      const historySec = el('div', { class: 'git-file-section' });
      const historyHdr = el('div', { class: 'git-section-header' });
      const historyLeft = el('div', { class: 'git-section-left' });
      const historyChev = el('span', { class: 'git-section-chevron' + (expandHistory ? ' open' : '') });
      historyChev.innerHTML = svgIcon(ICONS.chevron, 9);
      historyLeft.appendChild(historyChev);
      historyLeft.appendChild(el('span', { class: 'git-section-title' }, 'History'));
      historyLeft.addEventListener('click', () => { expandHistory = !expandHistory; renderAll(); });
      historyHdr.appendChild(historyLeft);
      historySec.appendChild(historyHdr);

      if (expandHistory) {
        const list = el('div', { class: 'git-commits-list' });
        list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim)">Loading…</div>';
        historySec.appendChild(list);

        api.git.log(projectPath, { limit: 20 }).then(logResp => {
          const commits = logResp?.commits || [];
          list.innerHTML = '';
          if (!commits.length) {
            list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim)">No commits yet</div>';
            return;
          }
          commits.forEach(c => {
            const hash = (c.abbreviatedHash || c.hash || '').slice(0, 7);
            const row = el('div', { class: 'git-commit-row' });
            row.innerHTML = `
              <div class="git-commit-main">
                <span class="git-commit-hash">${escapeHtml(hash)}</span>
                <span class="git-commit-msg">${escapeHtml(c.message || c.subject || '')}</span>
              </div>
              <div class="git-commit-meta">${escapeHtml(c.author || '')} · ${escapeHtml(timeAgo(c.timestamp || (c.date ? new Date(c.date).getTime() : 0)))}</div>
            `;
            row.addEventListener('click', async () => {
              try {
                const detail = await api.git.show(projectPath, c.hash);
                if (detail && window.PiPilot?.editor?.openVirtualTab) {
                  window.PiPilot.editor.openVirtualTab({
                    id: `commit:${c.hash}`,
                    name: hash,
                    mount: (ctn) => {
                      ctn.style.cssText = 'padding:16px;overflow:auto;font-family:var(--font-mono);font-size:12px;color:var(--text);';
                      const d = detail.commit || detail;
                      ctn.innerHTML = `
                        <div style="margin-bottom:12px;">
                          <div style="font-size:14px;font-weight:600;color:var(--text-strong);">${escapeHtml(d.subject || d.message || '')}</div>
                          ${d.body ? `<div style="margin-top:6px;color:var(--text-mid);white-space:pre-wrap;">${escapeHtml(d.body)}</div>` : ''}
                          <div style="margin-top:8px;font-size:11px;color:var(--text-dim);">${escapeHtml(d.author || '')} · ${escapeHtml(d.date || '')}</div>
                          <div style="margin-top:4px;font-size:11px;color:var(--accent);">${escapeHtml(d.hash || c.hash || '')}</div>
                        </div>
                        ${(d.files || []).map(f2 => `<div style="padding:2px 0;font-size:11px;color:var(--text-mid);">${escapeHtml(typeof f2 === 'string' ? f2 : f2.file || f2.path || '')}</div>`).join('')}
                        ${d.diff ? `<pre style="margin-top:12px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;overflow-x:auto;font-size:11px;white-space:pre-wrap;">${escapeHtml(d.diff.slice(0, 10000))}</pre>` : ''}
                      `;
                    },
                  });
                }
              } catch {}
            });
            list.appendChild(row);
          });
        }).catch(() => {
          list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim)">Could not load history</div>';
        });
      }
      container.appendChild(historySec);

      // ── 12. More actions menu ──────────────────────────────────────────
      if (showActionsMenu) {
        const backdrop = el('div', { class: 'git-popover-backdrop' });
        backdrop.addEventListener('click', () => {
          showActionsMenu = false;
          renderAll();
        });
        document.body.appendChild(backdrop);

        const pos = actionsMenuPos || { top: 96, left: 80, width: 220 };
        const menu = el('div', {
          class: 'git-actions-menu popover',
          style: { top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' },
        });
        const menuActions = [
          { icon: ICONS.fetch,  label: 'Fetch', action: async () => { showStatusMsg('Fetching…','info'); try { const r = await api.git.fetch(projectPath); if (r?.ok === false) throw new Error(r.error); gitStatus = await loadStatus(); showStatusMsg('Fetched'); } catch (e) { showStatusMsg('Fetch failed: '+e.message,'error'); } } },
          { icon: ICONS.pull,   label: 'Pull', action: async () => { showStatusMsg('Pulling…','info'); try { const r = await api.git.pull(projectPath); if(r?.ok===false) showStatusMsg('Pull failed: '+r.error,'error'); else { showStatusMsg('Pulled successfully'); gitStatus=await loadStatus(); } } catch(e){showStatusMsg('Pull failed: '+e.message,'error');} } },
          { icon: ICONS.pull,   label: 'Pull (Rebase)', action: async () => { showStatusMsg('Pulling (rebase)…','info'); try { const r = await api.git.pull(projectPath,{rebase:true}); if(r?.ok===false) showStatusMsg('Pull failed: '+r.error,'error'); else { showStatusMsg('Pulled (rebased)'); gitStatus=await loadStatus(); } } catch(e){showStatusMsg('Pull failed: '+e.message,'error');} } },
          { icon: ICONS.push,   label: 'Push', action: async () => { showStatusMsg('Pushing…','info'); try { const r = await api.git.push(projectPath); if(r?.ok===false) showStatusMsg('Push failed: '+r.error,'error'); else { showStatusMsg('Pushed successfully'); gitStatus=await loadStatus(); } } catch(e){showStatusMsg('Push failed: '+e.message,'error');} } },
          { type: 'sep' },
          { icon: ICONS.plus,   label: 'Stage All Changes', action: async () => { try { await api.git.add(projectPath, '.'); gitStatus=await loadStatus(); } catch {} } },
          { icon: '', label: 'Unstage All', action: async () => { for (const f of stagedFiles) { try { await api.git.unstage(projectPath, typeof f==='string'?f:f.path); } catch {} } gitStatus=await loadStatus(); } },
          { icon: ICONS.reset,  label: 'Discard All Changes', danger: true, action: async () => {
            const ok = await (window.PiPilot?.modal?.confirm?.({ title:'Discard ALL changes?', message:'This will discard every uncommitted change. Cannot be undone.', danger:true, confirmText:'Discard All' }) || Promise.resolve(confirm('Discard ALL changes?')));
            if (!ok) return;
            try { await api.git.discard(projectPath, '.'); gitStatus=await loadStatus(); } catch (e) { showStatusMsg('Discard failed: '+e.message,'error'); }
          }},
          { type: 'sep' },
          { icon: ICONS.stash,  label: 'Stash', action: async () => { try { await api.git.stash(projectPath,{action:'push'}); showStatusMsg('Stashed'); gitStatus=await loadStatus(); } catch(e){showStatusMsg('Stash failed: '+e.message,'error');} } },
          { icon: ICONS.stash,  label: 'Pop Stash', action: async () => { try { const r=await api.git.stash(projectPath,{action:'pop'}); if(r?.ok===false) showStatusMsg('Pop failed: '+r.error,'error'); else { showStatusMsg('Stash popped'); gitStatus=await loadStatus(); } } catch(e){showStatusMsg('Pop failed: '+e.message,'error');} } },
          { type: 'sep' },
          { icon: ICONS.merge,  label: 'Merge Branch…', action: async () => {
            const b = window.prompt('Branch name to merge into current:');
            if (!b) return;
            showStatusMsg('Merging…','info');
            try { const r = await api.git.merge(projectPath, b); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Merged ' + b); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Merge failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.cherry, label: 'Cherry-pick Commit…', action: async () => {
            const h = window.prompt('Commit hash to cherry-pick:');
            if (!h) return;
            showStatusMsg('Cherry-picking…','info');
            try { const r = await api.git.cherryPick(projectPath, h); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Cherry-picked'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Cherry-pick failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.trash,  label: 'Delete Branch…', danger: true, action: async () => {
            const b = window.prompt('Branch name to delete:');
            if (!b) return;
            const ok = await (window.PiPilot?.modal?.confirm?.({ title:'Delete branch?', message:`Delete ${b}?`, danger:true, confirmText:'Delete' }) || Promise.resolve(confirm(`Delete branch ${b}?`)));
            if (!ok) return;
            try { const r = await api.git.deleteBranch(projectPath, b, false); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Deleted ' + b); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Delete failed: ' + e.message, 'error'); }
          } },
          { type: 'sep' },
          { icon: ICONS.reset,  label: 'Reset (soft)', action: async () => {
            const ref = window.prompt('Reset to (e.g. HEAD~1):', 'HEAD~1');
            if (!ref) return;
            try { const r = await api.git.reset(projectPath, 'soft', ref); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Reset soft'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Reset failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.reset,  label: 'Reset (mixed)', action: async () => {
            const ref = window.prompt('Reset to:', 'HEAD~1');
            if (!ref) return;
            try { const r = await api.git.reset(projectPath, 'mixed', ref); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Reset mixed'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Reset failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.reset,  label: 'Reset (hard) HEAD', danger: true, action: async () => {
            const ok = await (window.PiPilot?.modal?.confirm?.({ title:'Hard reset to HEAD?', message:'This will discard ALL changes. Continue?', danger:true, confirmText:'Reset' }) || Promise.resolve(confirm('Hard reset to HEAD will discard ALL changes. Continue?')));
            if (!ok) return;
            try { const r = await api.git.reset(projectPath, 'hard', 'HEAD'); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Reset hard'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Reset failed: ' + e.message, 'error'); }
          } },
          { type: 'sep' },
          { icon: ICONS.remote, label: 'Add Remote…', action: async () => {
            const name = window.prompt('Remote name:', 'origin');
            if (!name) return;
            const url = window.prompt('Remote URL (e.g. https://github.com/user/repo.git):');
            if (!url) return;
            try { const r = await api.git.addRemote(projectPath, name, url); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Remote added'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Add remote failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.refresh,label: 'Refresh', action: async () => { gitStatus=await loadStatus(); showStatusMsg('Refreshed','info'); } },
        ];

        menuActions.forEach(a => {
          if (a.type === 'sep') { menu.appendChild(el('div', { class: 'git-menu-sep' })); return; }
          const item = el('button', { class: 'git-menu-item' + (a.danger ? ' danger' : '') });
          item.innerHTML = (a.icon ? svgIcon(a.icon, 12, 'style="margin-right:8px;vertical-align:middle;flex-shrink:0"') : '<span style="display:inline-block;width:20px"></span>') + escapeHtml(a.label);
          item.addEventListener('click', () => { showActionsMenu = false; a.action().then ? a.action().then(() => renderAll()) : (() => { a.action(); renderAll(); })(); });
          menu.appendChild(item);
        });
        document.body.appendChild(menu);
      }

      // wire branch-btn to toggle dropdown
      const renderedBranchBtn = container.querySelector('.git-branch-btn');
      if (renderedBranchBtn) {
        renderedBranchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const width = 260;
          branchMenuPos = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width };
          showBranchDropdown = !showBranchDropdown;
          showActionsMenu = false;
          renderAll();
        });
      }

      container.scrollTop = scrollTop;
    } // end renderAll()

    renderAll();

    // ── auto-refresh every 5s ──────────────────────────────────────────────
    refreshTimer = setInterval(async () => {
      if (!container.isConnected) { clearInterval(refreshTimer); return; }
      const ns = await loadStatus();
      if (!ns) return;
      // Only re-render if files changed
      const prev = JSON.stringify((gitStatus?.files || []).map(f => f.path + f.index + f.working_dir));
      const next = JSON.stringify((ns.files || []).map(f => f.path + f.index + f.working_dir));
      if (prev !== next || ns.branch !== gitStatus?.branch) {
        gitStatus = ns;
        bus.emit('git:branch-changed', gitStatus.branch);
        renderAll();
      } else {
        gitStatus = ns;
      }
    }, 5000);

    // Stop polling when container leaves DOM
    new MutationObserver(() => {
      if (!container.isConnected) { clearInterval(refreshTimer); }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---------------- EXTENSIONS PANEL ----------------
  async function renderExtensionsPanel(container, projectPath) {
    container.innerHTML = '';
    let activeTab = 'extensions';

    async function render() {
      container.innerHTML = '';
      const header = el('div', { class: 'panel-header' }, el('span', { class: 'panel-title' }, 'Extensions'));
      container.appendChild(header);

      const tabs = el('div', { class: 'p-tabs' });
      ['extensions', 'mcp', 'cloud'].forEach(t => {
        const label = t === 'extensions' ? 'Extensions' : t === 'mcp' ? 'MCP Servers' : 'Connectors';
        const b = el('button', { class: 'p-tab' + (activeTab === t ? ' active' : ''), onClick: () => { activeTab = t; render(); } }, label);
        tabs.appendChild(b);
      });
      container.appendChild(tabs);

      if (activeTab === 'extensions') {
        await renderExtensionsTab(container);
      } else if (activeTab === 'mcp') {
        const sec = el('div', { class: 'p-section' });
        sec.appendChild(el('button', { class: 'btn btn-secondary btn-small', style: { width: '100%', marginBottom: '8px' }, onClick: () => bus.emit('modal:add-mcp') }, '+ Add MCP Server'));
        let resp;
        try { resp = await api.mcp.listServers(); } catch { resp = { servers: [] }; }
        const servers = (resp && resp.servers) || [];
        if (!servers.length) {
          sec.appendChild(el('div', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, 'No MCP servers configured'));
        }
        servers.forEach(s => {
          const card = el('div', { class: 'connector-card' },
            el('div', { class: 'icon' }, '🧩'),
            el('div', { class: 'info' },
              el('div', { class: 'name' }, s.name),
              el('div', { class: 'desc', style: { fontFamily: 'var(--font-mono)', fontSize: '10px' } }, `${s.command || ''} ${(s.args || []).join(' ')}`)
            ),
            el('div', { class: 'toggle' + (s.enabled ? ' on' : ''), onClick: async () => { await api.mcp.toggleServer(s.id, !s.enabled); render(); } })
          );
          card.appendChild(el('button', { class: 'icon-btn', onClick: async () => { await api.mcp.removeServer(s.id); render(); } }, '×'));
          sec.appendChild(card);
        });
        container.appendChild(sec);
      } else {
        const sec = el('div', { class: 'p-section' });
        let resp;
        try { resp = await api.cloud.listConnectors(); } catch { resp = { connectors: [] }; }
        const list = (resp && resp.connectors) || resp || [];
        list.forEach(c => {
          const card = el('div', { class: 'connector-card' },
            el('div', { class: 'icon' }, c.icon || '☁'),
            el('div', { class: 'info' },
              el('div', { class: 'name' }, c.name),
              el('div', { class: 'desc' }, c.desc || ''),
              c.connected ? el('div', { class: 'conn' }, c.username ? `Connected as @${c.username}` : 'Connected') : null
            )
          );
          if (c.connected) {
            card.appendChild(el('button', { class: 'btn btn-secondary btn-small', onClick: async () => {
              if (await window.PiPilot.modal.confirm({ title: 'Disconnect?', message: `Disconnect ${c.name}?` })) {
                await api.cloud.deleteToken(c.id);
                render();
              }
            } }, 'Disconnect'));
          } else {
            card.appendChild(el('button', { class: 'btn btn-primary btn-small', onClick: () => bus.emit('modal:connect-cloud', c.id) }, 'Connect'));
          }
          sec.appendChild(card);
        });
        container.appendChild(sec);
      }
    }

    // ── Extensions tab: browse registry + manage installed ──
    async function renderExtensionsTab(container) {
      const sec = el('div', { class: 'p-section' });

      // Fetch registry and installed in parallel
      const [registryResp, installedResp] = await Promise.all([
        api.extensions?.registry?.().catch(() => ({ extensions: [] })) || { extensions: [] },
        api.extensions?.installed?.().catch(() => ({ installed: {} })) || { installed: {} },
      ]);
      const registry = registryResp?.extensions || [];
      const installed = installedResp?.installed || {};

      if (!registry.length && !Object.keys(installed).length) {
        sec.appendChild(el('div', { style: { color: 'var(--text-dim)', fontSize: '11px', padding: '12px 0' } }, 'No extensions available yet. Check back soon!'));
        container.appendChild(sec);
        return;
      }

      // Merge: show installed first, then registry (skip already installed)
      const installedIds = new Set(Object.keys(installed));
      const allExtensions = [];

      // Installed extensions
      for (const [id, ext] of Object.entries(installed)) {
        const regEntry = registry.find(r => r.id === id);
        allExtensions.push({ ...ext, ...(regEntry || {}), id, _installed: true, _enabled: ext.enabled !== false });
      }

      // Registry extensions not yet installed
      for (const ext of registry) {
        if (!installedIds.has(ext.id)) {
          allExtensions.push({ ...ext, _installed: false, _enabled: false });
        }
      }

      for (const ext of allExtensions) {
        const card = el('div', { class: 'connector-card' });
        card.style.flexWrap = 'wrap';

        const icon = el('div', { class: 'icon', style: { fontSize: '18px' } }, ext.icon || '⚡');
        const info = el('div', { class: 'info' },
          el('div', { class: 'name', style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            ext.name || ext.id,
            ext.version ? el('span', { style: { fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' } }, `v${ext.version}`) : null
          ),
          el('div', { class: 'desc' }, ext.description || ''),
          ext.author ? el('div', { style: { fontSize: '9px', color: 'var(--text-dim)', marginTop: '2px' } }, `by ${ext.author}`) : null
        );

        card.appendChild(icon);
        card.appendChild(info);

        const actions = el('div', { style: { display: 'flex', gap: '4px', marginLeft: 'auto' } });

        if (ext._installed) {
          // Toggle enable/disable
          const toggleBtn = el('div', {
            class: 'toggle' + (ext._enabled ? ' on' : ''),
            title: ext._enabled ? 'Disable' : 'Enable',
            onClick: async () => {
              await api.extensions.toggle(ext.id, !ext._enabled);
              bus.emit('toast:show', { type: 'ok', message: `${ext.name} ${ext._enabled ? 'disabled' : 'enabled'} — restart to apply` });
              renderExtensionsTab(container);
            },
          });
          actions.appendChild(toggleBtn);

          // Uninstall
          actions.appendChild(el('button', { class: 'icon-btn', title: 'Uninstall', style: { fontSize: '12px' }, onClick: async () => {
            if (await window.PiPilot.modal.confirm({ title: 'Uninstall extension?', message: ext.name || ext.id, danger: true })) {
              await api.extensions.uninstall(ext.id);
              bus.emit('toast:show', { type: 'ok', message: `${ext.name} uninstalled` });
              renderExtensionsTab(container);
            }
          } }, '×'));
        } else {
          // Install
          actions.appendChild(el('button', { class: 'btn btn-primary btn-small', onClick: async () => {
            bus.emit('toast:show', { type: 'info', message: `Installing ${ext.name}...` });
            const result = await api.extensions.install(ext.id, ext.url, {
              name: ext.name, description: ext.description, version: ext.version,
              author: ext.author, icon: ext.icon,
            });
            if (result?.ok) {
              bus.emit('toast:show', { type: 'ok', message: `${ext.name} installed — restart to activate` });
              renderExtensionsTab(container);
            } else {
              bus.emit('toast:show', { type: 'error', message: 'Install failed: ' + (result?.error || 'unknown') });
            }
          } }, 'Install'));
        }

        card.appendChild(actions);
        sec.appendChild(card);
      }

      container.appendChild(sec);
    }

    render();
  }

  // ---------------- DEPLOY PANEL ----------------
  async function renderDeployPanel(container, projectPath) {
    async function render() {
      container.innerHTML = '';
      const header = el('div', { class: 'panel-header' },
        el('span', { class: 'panel-title' }, 'Deploy'),
        el('div', { class: 'panel-actions' },
          el('button', { class: 'icon-btn', title: 'Refresh', onClick: render }, '↻')
        )
      );
      container.appendChild(header);

      const sec1 = el('div', { class: 'p-section' });
      sec1.appendChild(el('h4', null, 'Dev Servers'));
      sec1.appendChild(el('button', { class: 'btn btn-primary btn-small', style: { width: '100%', marginBottom: '8px' }, onClick: async () => {
        bus.emit('toast:show', { message: 'Starting dev server…', type: 'info' });
        const r = await api.devServer.start(projectPath);
        if (r && r.ok === false) bus.emit('toast:show', { message: 'Start failed: ' + r.error, type: 'error' });
        else bus.emit('toast:show', { message: 'Dev server started', type: 'success' });
        render();
      } }, '▶ Start Dev Server'));

      let resp;
      try { resp = await api.devServer.list(); } catch { resp = { servers: [] }; }
      const servers = ((resp && resp.servers) || []).filter(s => s.projectPath === projectPath);
      if (!servers.length) {
        sec1.appendChild(el('div', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, 'No dev servers running'));
      }
      servers.forEach(s => {
        const item = el('div', { class: 'dev-item' });
        item.appendChild(el('div', null,
          el('span', { class: 'status-dot ' + s.status }),
          el('span', { class: 'cmd' }, s.cmd)
        ));
        if (s.url) item.appendChild(el('div', { class: 'url', onClick: () => api.shell.openExternal(s.url), style: { cursor: 'pointer' } }, s.url));
        const actions = el('div', { class: 'actions', style: { display: 'flex', gap: '6px', marginTop: '6px' } });
        if (s.status === 'running') {
          actions.appendChild(el('button', { class: 'btn btn-secondary btn-small', onClick: async () => { await api.devServer.stop(s.id); render(); } }, 'Stop'));
        }
        item.appendChild(actions);
        sec1.appendChild(item);
      });
      container.appendChild(sec1);

      const sec2 = el('div', { class: 'p-section' });
      sec2.appendChild(el('h4', null, 'Cloud Deploy'));
      let connResp;
      try { connResp = await api.cloud.listConnectors(); } catch { connResp = { connectors: [] }; }
      const connectors = ((connResp && connResp.connectors) || connResp || []).filter(c => ['vercel', 'netlify', 'cloudflare'].includes(c.id));
      connectors.forEach(c => {
        const card = el('div', { class: 'connector-card' },
          el('div', { class: 'icon' }, c.icon),
          el('div', { class: 'info' },
            el('div', { class: 'name' }, c.name),
            el('div', { class: 'desc' }, c.connected ? 'Connected' : 'Not connected')
          ),
          el('button', { class: 'btn btn-primary btn-small', disabled: !c.connected ? '' : null, onClick: () => {
            if (!c.connected) bus.emit('modal:connect-cloud', c.id);
            else bus.emit('toast:show', { message: `${c.name} deploy: coming soon`, type: 'info' });
          } }, c.connected ? 'Deploy' : 'Connect')
        );
        sec2.appendChild(card);
      });
      container.appendChild(sec2);
    }
    render();
  }

  // ---------------- OUTLINE PANEL ----------------
  function renderOutlinePanel(container) {
    container.innerHTML = '';
    const header = el('div', { class: 'panel-header' },
      el('span', { class: 'panel-title' }, 'Outline'),
      el('div', { class: 'panel-actions' },
        el('button', { class: 'icon-btn', title: 'Refresh', onClick: () => renderOutlinePanel(container) }, '↻')
      )
    );
    container.appendChild(header);
    const content = el('div', { id: 'outline-panel-content' });
    container.appendChild(content);
    // Delegate to ace-ai.js outline renderer
    if (window.PiPilot?.editorAi?.renderOutline) {
      window.PiPilot.editorAi.renderOutline(content);
    } else {
      content.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:11px;">Open a file to see symbols</div>';
    }
  }

  // ── WIKI PANEL ──
  async function renderWikiPanel(container, projectPath) {
    container.innerHTML = '';
    // Use state.projectPath as fallback
    const pp = projectPath || state.projectPath;
    if (!pp) { container.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:11px;">Open a project first</div>'; return; }

    const header = el('div', { class: 'panel-header' },
      el('span', { class: 'panel-title' }, 'Wiki'),
      el('div', { class: 'panel-actions' },
        el('button', { class: 'icon-btn', title: 'Generate Wiki', onClick: () => generateWiki(container, pp) }, '✨'),
        el('button', { class: 'icon-btn', title: 'Refresh', onClick: () => renderWikiPanel(container, pp) }, '↻')
      )
    );
    container.appendChild(header);

    let result;
    console.log('[wiki] fetching tree for:', pp);
    try {
      result = await api.wiki.tree(pp);
      console.log('[wiki] tree result:', JSON.stringify(result)?.slice(0, 500));
    } catch (err) {
      console.error('[wiki] tree error:', err?.message || err);
      result = { ok: false, sections: [] };
    }
    // Handle both { ok, sections } and direct { sections }
    const sections = result?.sections || [];
    console.log('[wiki] sections count:', sections.length);

    if (!sections.length) {
      const empty = el('div', { style: 'padding:20px;text-align:center;' });
      empty.innerHTML = `
        <div style="color:var(--text-dim);font-size:12px;margin-bottom:12px;">No wiki pages yet</div>
        <button class="btn btn-primary btn-small" id="wiki-generate-btn" style="font-size:11px;padding:6px 14px;">
          ✨ Generate Wiki
        </button>
        <div style="color:var(--text-faint);font-size:10px;margin-top:8px;">AI will scan your project and create documentation</div>
      `;
      container.appendChild(empty);
      container.querySelector('#wiki-generate-btn')?.addEventListener('click', () => generateWiki(container, pp));
      return;
    }

    const list = el('div', { style: 'padding:4px 0;' });
    for (const s of sections) {
      const row = el('button', { class: 'wiki-page-row', style: 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 12px;background:transparent;border:none;text-align:left;font-size:11px;color:var(--text);cursor:pointer;' });
      row.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.title)}</span>
        <span style="font-size:9px;color:var(--text-dim);">${Math.round(s.size / 1024)}KB</span>
      `;
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--surface-alt)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', () => openWikiPage(pp, s.id, s.title));
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  async function openWikiPage(projectPath, pageId, title) {
    try {
      const result = await api.wiki.page(projectPath, pageId);
      if (!result?.ok || !result.content) { bus.emit('toast:show', { type: 'error', message: 'Page not found' }); return; }
      // Open as virtual tab with markdown rendering
      const editor = window.PiPilot?.editor;
      if (!editor) return;
      editor.openVirtualTab({
        id: `wiki:${pageId}`,
        name: `📖 ${title}`,
        mount: (container) => {
          container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
          let html;
          if (window.marked?.parse) {
            try { html = window.marked.parse(result.content); } catch { html = escapeHtml(result.content).replace(/\n/g, '<br>'); }
          } else {
            html = escapeHtml(result.content).replace(/\n/g, '<br>');
          }
          container.innerHTML = `<div class="md-body" style="max-width:760px;margin:0 auto;padding:32px 40px;font-family:var(--font-sans);font-size:14px;line-height:1.7;color:var(--text);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
              <h1 style="font-size:24px;margin:0;color:var(--text-strong);">${escapeHtml(title)}</h1>
              <button id="wiki-edit-btn" style="padding:4px 10px;font-size:11px;background:var(--surface-alt);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;">Edit</button>
            </div>
            ${html}
          </div>`;
          // Render Mermaid diagrams in wiki
          if (window.mermaid) {
            container.querySelectorAll('pre code.language-mermaid').forEach(code => {
              const pre = code.closest('pre');
              if (!pre) return;
              const src = code.textContent || '';
              const div = document.createElement('div');
              div.style.cssText = 'margin:12px 0;text-align:center;overflow-x:auto;';
              const id = 'wiki-mmd-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
              try {
                window.mermaid.render(id, src).then(({ svg }) => { div.innerHTML = svg; pre.replaceWith(div); }).catch(() => {});
              } catch {}
            });
          }
          container.querySelector('#wiki-edit-btn')?.addEventListener('click', () => {
            const fp = projectPath + '/.pipilot/wikis/' + pageId + '.md';
            bus.emit('file:open', { path: fp });
          });
        },
      });
    } catch (err) { bus.emit('toast:show', { type: 'error', message: err.message }); }
  }

  function generateWiki(container, projectPath) {
    const root = document.getElementById('ide-root');
    if (root) root.classList.remove('chat-collapsed');
    bus.emit('menu:view:toggle-chat');
    setTimeout(() => {
      const root2 = document.getElementById('ide-root');
      if (root2?.classList.contains('chat-collapsed')) bus.emit('menu:view:toggle-chat');
      window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
        detail: {
          prefill: 'Use the wiki-generator sub-agent to scan this project and generate comprehensive wiki documentation in .pipilot/wikis/. It should create: index.md, architecture.md, modules.md, api.md, and setup.md.',
          submit: true,
        },
      }));
    }, 300);
  }

  window.PiPilot.panels = {
    git: renderGitPanel,
    outline: renderOutlinePanel,
    wiki: renderWikiPanel,
    extensions: renderExtensionsPanel,
    deploy: renderDeployPanel,
  };

  bus.on('panels:refresh', (panel) => {
    bus.emit('panel:switch', panel);
  });

  bus.on('git:changed', () => {
    const sidePanel = document.getElementById('side-panel-inner');
    if (sidePanel && sidePanel.dataset.panel === 'git' && state.projectPath) {
      renderGitPanel(sidePanel, state.projectPath);
    }
  });
})();
