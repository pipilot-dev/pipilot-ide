// PiPilot IDE — Notification Center
//
// VS Code-style reactive notifications. Persistent stack at bottom-right with
// severity icons, action buttons, source labels, per-notification gear menu,
// and a status-bar bell that opens a history panel and toggles Do Not Disturb.
//
// PUBLIC API (callable from any renderer module or extension):
//
//   const handle = window.PiPilot.notifications.show({
//     severity: 'info' | 'warn' | 'error' | 'progress',
//     message: 'string or HTML-safe text',
//     detail: 'optional second line',
//     source: 'Git',                       // small "Source: ..." footer
//     sticky: true,                        // never auto-dismiss
//     duration: 8000,                      // ms; ignored if sticky / has actions
//     actions: [{ label: 'Yes', primary: true, onClick: () => {} }, ...],
//     progress: { percent: 0..100, indeterminate: true },
//     onDismiss: () => {},
//   });
//   handle.update({ message, progress, actions });
//   handle.dismiss();
//
// Convenience: notifications.info(msg, opts) / .warn / .error / .progress
//
// Bus integration (for extensions / decoupled modules):
//   bus.emit('notifications:post', { ...payload })
//   bus.emit('notifications:update', { id, ...patch })
//   bus.emit('notifications:dismiss', { id })

(function () {
  const bus = window.PiPilot?.bus;
  if (!bus) return;

  const MAX_VISIBLE = 5;
  const HISTORY_LIMIT = 100;
  const DEFAULT_INFO_DURATION = 6500;
  const DND_KEY = 'pipilot.notifications.dnd';

  // ---------- State ----------
  let nextId = 1;
  const live = new Map();      // id → { node, payload, dismissTimer }
  const history = [];          // newest last
  let unread = 0;
  let dnd = false;
  let centerOpen = false;

  try { dnd = localStorage.getItem(DND_KEY) === '1'; } catch {}

  // ---------- Styles ----------
  function ensureStyles() {
    if (document.getElementById('notifications-styles')) return;
    const style = document.createElement('style');
    style.id = 'notifications-styles';
    style.textContent = `
      #notifications-root {
        position: fixed;
        right: 14px;
        bottom: 36px;
        z-index: 1500;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
        max-width: 420px;
        pointer-events: none;
      }
      .notif {
        pointer-events: auto;
        width: 380px;
        max-width: calc(100vw - 28px);
        background: var(--surface-raised, #1e1e1e);
        border: 1px solid var(--border, #303030);
        border-left: 3px solid var(--accent, #4a8cff);
        border-radius: var(--radius, 4px);
        box-shadow: 0 6px 20px rgba(0,0,0,0.45);
        font-size: var(--fs-sm, 12px);
        color: var(--text-strong, #e8e8e8);
        animation: notif-in 0.18s ease-out;
      }
      .notif.leaving { opacity: 0; transform: translateX(20px); transition: opacity 0.18s, transform 0.18s; }
      .notif.info  { border-left-color: var(--info, #6cb6ff); }
      .notif.warn  { border-left-color: var(--warn, #e5a639); }
      .notif.error { border-left-color: var(--error, #e5534b); }
      .notif.progress { border-left-color: var(--accent, #4a8cff); }
      @keyframes notif-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
      .notif-head { display: flex; align-items: flex-start; gap: 8px; padding: 10px 10px 6px; }
      .notif-icon { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; display: inline-flex; align-items: center; justify-content: center; }
      .notif.info  .notif-icon { color: var(--info, #6cb6ff); }
      .notif.warn  .notif-icon { color: var(--warn, #e5a639); }
      .notif.error .notif-icon { color: var(--error, #e5534b); }
      .notif.progress .notif-icon { color: var(--accent, #4a8cff); }
      .notif-message { flex: 1; min-width: 0; line-height: 1.4; word-wrap: break-word; }
      .notif-detail { color: var(--text-dim, #888); font-size: var(--fs-xs, 11px); margin-top: 4px; }
      .notif-tools { display: flex; gap: 2px; flex-shrink: 0; }
      .notif-icon-btn {
        width: 20px; height: 20px;
        display: inline-flex; align-items: center; justify-content: center;
        color: var(--text-dim, #888);
        background: transparent;
        border: none;
        border-radius: 3px;
        cursor: pointer;
      }
      .notif-icon-btn:hover { background: var(--surface-alt, #2a2a2a); color: var(--text-strong, #e8e8e8); }
      .notif-progress-wrap { padding: 0 10px 6px; }
      .notif-progress-bar {
        height: 2px;
        background: var(--surface-alt, #2a2a2a);
        border-radius: 2px;
        overflow: hidden;
        position: relative;
      }
      .notif-progress-fill {
        height: 100%;
        background: var(--accent, #4a8cff);
        width: 0%;
        transition: width 0.2s ease;
      }
      .notif-progress-bar.indeterminate .notif-progress-fill {
        width: 35%;
        animation: notif-progress-loop 1.4s ease-in-out infinite;
      }
      @keyframes notif-progress-loop {
        0%   { transform: translateX(-110%); }
        100% { transform: translateX(310%); }
      }
      .notif-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        padding: 0 10px 10px;
        flex-wrap: wrap;
      }
      .notif-source {
        padding: 6px 10px;
        font-size: var(--fs-xs, 11px);
        color: var(--text-dim, #888);
        border-top: 1px solid var(--border, #303030);
      }
      .notif-btn {
        padding: 4px 10px;
        font-size: var(--fs-xs, 11px);
        background: var(--surface-alt, #2a2a2a);
        color: var(--text-strong, #e8e8e8);
        border: 1px solid var(--border, #303030);
        border-radius: 2px;
        cursor: pointer;
        font-family: inherit;
      }
      .notif-btn:hover { border-color: var(--accent, #4a8cff); }
      .notif-btn.primary {
        background: var(--accent, #4a8cff);
        color: #fff;
        border-color: var(--accent, #4a8cff);
      }
      .notif-btn.primary:hover { filter: brightness(1.1); }
      .notif-gear-menu {
        position: absolute;
        background: var(--surface-raised, #252525);
        border: 1px solid var(--border, #303030);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        padding: 4px 0;
        z-index: 2000;
        min-width: 160px;
      }
      .notif-gear-item {
        display: block;
        padding: 6px 12px;
        font-size: var(--fs-xs, 11px);
        color: var(--text-strong, #e8e8e8);
        cursor: pointer;
        background: transparent;
        border: none;
        width: 100%;
        text-align: left;
        font-family: inherit;
      }
      .notif-gear-item:hover { background: var(--surface-alt, #2a2a2a); }
      /* Status bar bell */
      #status-notifications { position: relative; }
      .status-notif-badge {
        position: absolute;
        top: -4px; right: -6px;
        min-width: 14px; height: 14px;
        padding: 0 3px;
        background: var(--accent, #4a8cff);
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        line-height: 14px;
        text-align: center;
        border-radius: 7px;
        font-family: var(--font-mono, monospace);
      }
      .status-notif-badge.hidden { display: none; }
      #status-notifications.dnd svg { opacity: 0.45; }
      /* Notification center popover */
      #notifications-center {
        position: fixed;
        right: 14px;
        bottom: 36px;
        width: 380px;
        max-height: 60vh;
        background: var(--surface-raised, #1e1e1e);
        border: 1px solid var(--border, #303030);
        border-radius: var(--radius, 4px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        z-index: 1600;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .nc-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-bottom: 1px solid var(--border, #303030);
        font-size: var(--fs-xs, 11px);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-strong, #e8e8e8);
      }
      .nc-head-actions { display: flex; gap: 2px; }
      .nc-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
      .nc-empty {
        padding: 24px 16px;
        text-align: center;
        color: var(--text-dim, #888);
        font-size: var(--fs-sm, 12px);
      }
      .nc-item {
        display: flex;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--border, #303030);
        align-items: flex-start;
      }
      .nc-item:last-child { border-bottom: none; }
      .nc-item .nc-icon { width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px; }
      .nc-item.info  .nc-icon { color: var(--info, #6cb6ff); }
      .nc-item.warn  .nc-icon { color: var(--warn, #e5a639); }
      .nc-item.error .nc-icon { color: var(--error, #e5534b); }
      .nc-item.progress .nc-icon { color: var(--accent, #4a8cff); }
      .nc-item-body { flex: 1; min-width: 0; font-size: var(--fs-xs, 11px); }
      .nc-item-msg { color: var(--text-strong, #e8e8e8); line-height: 1.4; word-wrap: break-word; }
      .nc-item-meta { color: var(--text-dim, #888); margin-top: 2px; }
      .nc-item-remove {
        flex-shrink: 0;
        align-self: flex-start;
        margin-top: 1px;
        opacity: 0;
        transition: opacity 0.12s ease;
      }
      .nc-item:hover .nc-item-remove { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // ---------- Severity icons ----------
  function iconSvg(severity) {
    switch (severity) {
      case 'info':
        return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="7.2" y="6.8" width="1.6" height="5" rx="0.4"/><circle cx="8" cy="4.5" r="0.9"/></svg>`;
      case 'warn':
        return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5l7 12.5H1L8 1.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><rect x="7.2" y="6" width="1.6" height="4.5" rx="0.4"/><circle cx="8" cy="12" r="0.9"/></svg>`;
      case 'error':
        return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
      case 'progress':
        return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.2" stroke-dasharray="20 100"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1.2s" repeatCount="indefinite"/></circle></svg>`;
      default:
        return '';
    }
  }

  // ---------- DOM helpers ----------
  function getRoot() {
    let root = document.getElementById('notifications-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'notifications-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'on' && v) for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else n.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  // ---------- Core ----------
  function buildNode(payload, id) {
    const severity = payload.severity || 'info';
    const node = el('div', { class: `notif ${severity}` });

    const head = el('div', { class: 'notif-head' });
    head.appendChild(el('span', { class: 'notif-icon', html: iconSvg(severity) }));

    const msgWrap = el('div', { class: 'notif-message' });
    const msg = el('div', { class: 'notif-message-text' });
    msg.textContent = String(payload.message ?? '');
    msgWrap.appendChild(msg);
    if (payload.detail) {
      const det = el('div', { class: 'notif-detail' });
      det.textContent = String(payload.detail);
      msgWrap.appendChild(det);
    }
    head.appendChild(msgWrap);

    const tools = el('div', { class: 'notif-tools' });
    const gearBtn = el('button', {
      class: 'notif-icon-btn', title: 'Configure',
      html: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4"/></svg>`,
    });
    gearBtn.addEventListener('click', (e) => openGearMenu(e, payload, id));
    tools.appendChild(gearBtn);

    const closeBtn = el('button', {
      class: 'notif-icon-btn', title: 'Clear',
      html: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`,
    });
    closeBtn.addEventListener('click', () => dismissNotification(id, true));
    tools.appendChild(closeBtn);
    head.appendChild(tools);

    node.appendChild(head);

    if (payload.progress) {
      const wrap = el('div', { class: 'notif-progress-wrap' });
      const bar = el('div', { class: 'notif-progress-bar' + (payload.progress.indeterminate ? ' indeterminate' : '') });
      const fill = el('div', { class: 'notif-progress-fill' });
      if (!payload.progress.indeterminate) {
        const pct = Math.max(0, Math.min(100, Number(payload.progress.percent) || 0));
        fill.style.width = pct + '%';
      }
      bar.appendChild(fill);
      wrap.appendChild(bar);
      node.appendChild(wrap);
      node._progressFill = fill;
      node._progressBar = bar;
    }

    if (Array.isArray(payload.actions) && payload.actions.length) {
      const actions = el('div', { class: 'notif-actions' });
      for (const a of payload.actions) {
        const b = el('button', { class: 'notif-btn' + (a.primary ? ' primary' : '') });
        b.textContent = a.label;
        b.addEventListener('click', () => {
          try { a.onClick && a.onClick(); } catch (err) { console.error('[notif action]', err); }
          if (a.keepOpen) return;
          dismissNotification(id, true);
        });
        actions.appendChild(b);
      }
      node.appendChild(actions);
    }

    if (payload.source) {
      const src = el('div', { class: 'notif-source' });
      src.textContent = 'Source: ' + payload.source;
      node.appendChild(src);
    }

    return node;
  }

  function pushHistory(payload, id) {
    history.push({ id, ts: Date.now(), payload: { ...payload } });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  }

  function bumpUnread() {
    unread++;
    paintBadge();
  }
  function clearUnread() {
    unread = 0;
    paintBadge();
  }
  function paintBadge() {
    const badge = document.getElementById('status-notif-badge');
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = String(Math.min(unread, 99));
      badge.classList.remove('hidden');
    } else {
      badge.textContent = '';
      badge.classList.add('hidden');
    }
  }

  function evictOldest() {
    while (live.size >= MAX_VISIBLE) {
      const oldestId = live.keys().next().value;
      dismissNotification(oldestId, false);
    }
  }

  function show(payload) {
    if (!payload || (!payload.message && !payload.progress)) {
      return { id: null, update: () => {}, dismiss: () => {} };
    }
    ensureStyles();
    const id = nextId++;
    const severity = payload.severity || 'info';
    const stickyByDefault = severity === 'error' || severity === 'progress' || (payload.actions && payload.actions.length);
    const sticky = payload.sticky != null ? !!payload.sticky : stickyByDefault;
    const duration = payload.duration != null
      ? Number(payload.duration)
      : (severity === 'error' ? 9000 : DEFAULT_INFO_DURATION);

    pushHistory(payload, id);

    // Always bump the bell badge while the center is closed — the user
    // expects a visible counter regardless of DND. The center clears it
    // on open. Progress notifications don't bump (they update in place
    // and would otherwise spam the counter as % ticks).
    if (!centerOpen && severity !== 'progress') bumpUnread();

    if (dnd) {
      return makeHandle(id, payload);
    }

    evictOldest();
    const node = buildNode(payload, id);
    getRoot().appendChild(node);
    const entry = { node, payload, dismissTimer: null, sticky };
    live.set(id, entry);

    if (!sticky && duration > 0) {
      entry.dismissTimer = setTimeout(() => dismissNotification(id, false), duration);
      node.addEventListener('mouseenter', () => {
        if (entry.dismissTimer) { clearTimeout(entry.dismissTimer); entry.dismissTimer = null; }
      });
      node.addEventListener('mouseleave', () => {
        if (!live.has(id) || entry.dismissTimer) return;
        entry.dismissTimer = setTimeout(() => dismissNotification(id, false), Math.max(2000, duration / 2));
      });
    }

    return makeHandle(id, payload);
  }

  function update(id, patch) {
    const entry = live.get(id);
    if (!entry) return;
    entry.payload = { ...entry.payload, ...patch };
    // Easy path: rebuild the node in-place
    const newNode = buildNode(entry.payload, id);
    entry.node.replaceWith(newNode);
    entry.node = newNode;
    // Update history snapshot for this id
    const histEntry = history.find(h => h.id === id);
    if (histEntry) histEntry.payload = { ...entry.payload };
    if (centerOpen) renderCenter();
  }

  function dismissNotification(id, userInitiated) {
    const entry = live.get(id);
    if (!entry) return;
    live.delete(id);
    if (entry.dismissTimer) clearTimeout(entry.dismissTimer);
    entry.node.classList.add('leaving');
    setTimeout(() => entry.node.remove(), 180);
    if (userInitiated && typeof entry.payload.onDismiss === 'function') {
      try { entry.payload.onDismiss(); } catch (err) { console.error(err); }
    }
  }

  function makeHandle(id, payload) {
    return {
      id,
      update: (patch) => update(id, patch),
      dismiss: () => dismissNotification(id, true),
    };
  }

  // ---------- Gear menu ----------
  let openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
    document.removeEventListener('mousedown', onDocMenuMouseDown, true);
  }
  function onDocMenuMouseDown(e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  }
  function openGearMenu(e, payload, id) {
    e.stopPropagation();
    closeMenu();
    const menu = el('div', { class: 'notif-gear-menu' });
    const items = [
      { label: 'Clear notification', onClick: () => dismissNotification(id, true) },
      { label: 'Clear all notifications', onClick: () => clearAllLive() },
      { label: dnd ? 'Disable Do Not Disturb' : 'Enable Do Not Disturb', onClick: () => setDnd(!dnd) },
    ];
    for (const it of items) {
      const b = el('button', { class: 'notif-gear-item' });
      b.textContent = it.label;
      b.addEventListener('click', () => { closeMenu(); it.onClick(); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = e.currentTarget.getBoundingClientRect();
    menu.style.left = (r.left - menu.offsetWidth + r.width) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    openMenu = menu;
    setTimeout(() => document.addEventListener('mousedown', onDocMenuMouseDown, true), 0);
  }

  function clearAllLive() {
    for (const id of Array.from(live.keys())) dismissNotification(id, false);
  }

  // ---------- Do Not Disturb ----------
  function setDnd(on) {
    dnd = !!on;
    try { localStorage.setItem(DND_KEY, dnd ? '1' : '0'); } catch {}
    const btn = document.getElementById('status-notifications');
    if (btn) btn.classList.toggle('dnd', dnd);
    if (dnd) clearAllLive();
  }

  // ---------- Notification Center popover ----------
  function renderCenter() {
    let pop = document.getElementById('notifications-center');
    if (!pop) return;
    pop.innerHTML = '';
    const head = el('div', { class: 'nc-head' });
    head.appendChild(document.createTextNode(`Notifications · ${history.length}`));
    const tools = el('div', { class: 'nc-head-actions' });
    const dndBtn = el('button', {
      class: 'notif-icon-btn',
      title: dnd ? 'Disable Do Not Disturb' : 'Enable Do Not Disturb',
      html: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M13 12V8a5 5 0 0 0-10 0v4l-1 1h12l-1-1z"/><path d="M6.5 14.5a1.5 1.5 0 0 0 3 0"/>${dnd ? '<line x1="2" y1="2" x2="14" y2="14"/>' : ''}</svg>`,
    });
    dndBtn.addEventListener('click', (e) => { e.stopPropagation(); setDnd(!dnd); renderCenter(); });
    tools.appendChild(dndBtn);
    const clearBtn = el('button', {
      class: 'notif-icon-btn', title: 'Clear all',
      html: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 6h10M5 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 8h4l1-8"/></svg>`,
    });
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); history.length = 0; clearAllLive(); renderCenter(); });
    tools.appendChild(clearBtn);
    head.appendChild(tools);
    pop.appendChild(head);

    const list = el('div', { class: 'nc-list' });
    if (!history.length) {
      list.appendChild(el('div', { class: 'nc-empty' }, 'No notifications.'));
    } else {
      for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i];
        const sev = entry.payload.severity || 'info';
        const item = el('div', { class: 'nc-item ' + sev });
        item.appendChild(el('span', { class: 'nc-icon', html: iconSvg(sev) }));
        const body = el('div', { class: 'nc-item-body' });
        const m = el('div', { class: 'nc-item-msg' });
        m.textContent = String(entry.payload.message ?? '');
        body.appendChild(m);
        const meta = el('div', { class: 'nc-item-meta' });
        const when = new Date(entry.ts).toLocaleTimeString();
        meta.textContent = entry.payload.source ? `${entry.payload.source} · ${when}` : when;
        body.appendChild(meta);
        item.appendChild(body);

        const removeBtn = el('button', {
          class: 'notif-icon-btn nc-item-remove', title: 'Remove from list',
          html: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`,
        });
        const entryId = entry.id;
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = history.findIndex(h => h.id === entryId);
          if (idx >= 0) history.splice(idx, 1);
          // Also dismiss the live card if it's still showing.
          if (live.has(entryId)) dismissNotification(entryId, false);
          renderCenter();
        });
        item.appendChild(removeBtn);
        list.appendChild(item);
      }
    }
    pop.appendChild(list);
  }

  function toggleCenter() {
    let pop = document.getElementById('notifications-center');
    if (pop) {
      pop.remove();
      centerOpen = false;
      document.removeEventListener('mousedown', onCenterDocMouseDown, true);
      return;
    }
    pop = el('div', { id: 'notifications-center' });
    document.body.appendChild(pop);
    centerOpen = true;
    renderCenter();
    clearUnread();
    setTimeout(() => document.addEventListener('mousedown', onCenterDocMouseDown, true), 0);
  }
  function onCenterDocMouseDown(e) {
    const pop = document.getElementById('notifications-center');
    const btn = document.getElementById('status-notifications');
    if (!pop) return;
    if (pop.contains(e.target) || (btn && btn.contains(e.target))) return;
    pop.remove();
    centerOpen = false;
    document.removeEventListener('mousedown', onCenterDocMouseDown, true);
  }

  // ---------- Wire up ----------
  function init() {
    ensureStyles();
    getRoot();
    const btn = document.getElementById('status-notifications');
    if (btn) {
      btn.classList.toggle('dnd', dnd);
      btn.addEventListener('click', toggleCenter);
    }
    paintBadge();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Bus integration — extensions and decoupled modules post via the bus.
  bus.on('notifications:post', (payload) => show(payload || {}));
  bus.on('notifications:update', ({ id, ...patch } = {}) => { if (id != null) update(id, patch); });
  bus.on('notifications:dismiss', ({ id } = {}) => { if (id != null) dismissNotification(id, true); });

  // Backwards-compat: forward toast events into the notification stream so
  // existing call-sites (`bus.emit('toast:show', ...)`) automatically benefit
  // from history + DND, while `window.PiPilot.toast.show` keeps its own UI.
  // We DON'T re-emit here — toast.js already handles 'toast:show' with its
  // own renderer. Adding a notification too would double-render.

  // ---------- Public API ----------
  // History-only post: append to the notification log without ever rendering
  // a card. Used by toast.js so transient toasts still appear in the bell's
  // activity log without doubling up on the bottom-right UI.
  function recordHistory(payload) {
    if (!payload) return;
    const id = nextId++;
    pushHistory(payload, id);
    if (!centerOpen) bumpUnread();
    return id;
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.notifications = {
    show,
    update,
    dismiss: (id) => dismissNotification(id, true),
    info:     (msg, opts = {}) => show({ ...opts, severity: 'info', message: msg }),
    warn:     (msg, opts = {}) => show({ ...opts, severity: 'warn', message: msg }),
    error:    (msg, opts = {}) => show({ ...opts, severity: 'error', message: msg }),
    progress: (msg, opts = {}) => show({ ...opts, severity: 'progress', message: msg, sticky: true }),
    recordHistory,
    setDnd,
    isDnd: () => dnd,
    history: () => history.slice(),
    clearHistory: () => { history.length = 0; clearUnread(); if (centerOpen) renderCenter(); },
    toggleCenter,
  };
})();
