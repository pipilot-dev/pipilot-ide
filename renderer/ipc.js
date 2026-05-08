// PiPilot IDE — IPC wrapper around window.electronAPI
// Provides a small layer of helpers shared by all renderer modules.

window.PiPilot = window.PiPilot || {};
window.PiPilot.api = window.electronAPI;

// Tiny event bus for cross-module communication in the renderer.
window.PiPilot.bus = (() => {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      listeners.get(event)?.forEach(fn => {
        try { fn(payload); } catch (e) { console.error(`bus[${event}]`, e); }
      });
    },
  };
})();

// Shared global state (project, open files, settings)
window.PiPilot.state = {
  projectPath: null,
  projectName: null,
  openFiles: [], // [{ path, name, dirty, content }]
  activeFile: null,
  settings: {
    fontSize: 13,
    theme: 'midnight',
    cursorStyle: 'line',
    tabSize: 2,
    wordWrap: 'on',
    minimap: true,
    builtinWordCount: true,
    builtinJsdoc: true,
    builtinColorPreview: true,
    builtinFileSizeIndicator: true,
    builtinAutoCloseTag: true,
    builtinApiPlayground: true,
    builtinDependencyGraph: true,
    // Warm agent sessions: keep one Claude SDK subprocess alive per
    // workspace so follow-up chat messages skip the ~12 s cold start.
    // ON by default — fall back via the Settings toggle if you hit a
    // case the warm path mishandles (the cold agent:send path stays
    // intact for plan mode, attachments, missions, etc.).
    agentWarmSessions: true,
  },
  agentMode: 'agent', // 'agent' | 'plan'
};

// Bootstrap saved settings from the main process into state.settings as
// early as possible (before the editor and other modules read them). The
// merge runs the main-side migrations (e.g. wordWrap default flip), then
// emits a `settings:loaded` bus event so listeners can reapply changed
// values to already-created Ace sessions, the minimap, etc.
(async function bootstrapSettings() {
  try {
    if (!window.electronAPI?.settings?.all) return;
    const r = await window.electronAPI.settings.all();
    if (!r || !r.ok || !r.settings) return;
    Object.assign(window.PiPilot.state.settings, r.settings);
    window.PiPilot.bus.emit('settings:loaded', r.settings);
  } catch (err) {
    console.warn('[settings] bootstrap failed:', err);
  }
})();

// Keep state.settings in sync with every settings:changed event. Without
// this, modules that read state.settings (ace-editor reapplyEditorSettings,
// terminal, chat) see stale values after the user changes a setting in
// the Settings tab — they only refresh after a full reload because that
// re-runs bootstrapSettings above. Listening here is the single source
// of truth so individual consumers don't each have to mirror the value.
window.PiPilot.bus.on('settings:changed', (payload) => {
  if (!payload || typeof payload.key !== 'string') return;
  window.PiPilot.state.settings[payload.key] = payload.value;
});

// Convenience for query selectors
window.$ = (sel, root = document) => root.querySelector(sel);
window.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Element creation helper
window.h = (tag, props = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === false || v == null) continue;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
};

// Debounce + throttle
window.PiPilot.debounce = (fn, ms = 200) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
window.PiPilot.throttle = (fn, ms = 100) => {
  let last = 0, pending = null;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else { clearTimeout(pending); pending = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (now - last)); }
  };
};
