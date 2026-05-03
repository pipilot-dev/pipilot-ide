// PiPilot IDE — Layout-aware wrap-limit controller
//
// Sets Ace's word-wrap column EXPLICITLY based on which side panels are
// open, so wrapped text never disappears behind the minimap or chat
// panel regardless of how Ace's pixel-based wrap calculation behaves.
//
// Reference targets (from the user's measurement):
//   • sidebar OPEN + chat OPEN  →  52 cols (length of
//        `const unreadNotificationCount = notifications.filter`)
//   • only chat OPEN            →  88 cols (length of
//        `const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)`)
//   • only sidebar OPEN         → 100 cols (sensible default)
//   • neither panel open        → 130 cols (mostly free)
//
// The controller listens for panel-toggle bus events AND uses a
// ResizeObserver on #ide-root as a backup (panel splitters can be
// dragged without firing toggle events). Both paths converge on a
// single applyWrapLimit() that pushes the column count to the active
// Ace session via session.setWrapLimitRange(limit, limit).

(function () {
  'use strict';
  if (window.__pipilotWrapLimitLoaded) return;
  window.__pipilotWrapLimitLoaded = true;

  const bus = window.PiPilot && window.PiPilot.bus;
  if (!bus) return;

  // Per-layout wrap targets, in characters.
  const COLS = {
    bothOpen:    52,
    onlyChat:    88,
    onlySidebar: 100,
    bothClosed:  130,
  };

  let editor = null;
  let lastLimit = 0;
  let pending = null;

  function getLayoutState() {
    const root = document.getElementById('ide-root');
    if (!root) return { sidebar: true, chat: true };
    return {
      sidebar: !root.classList.contains('side-collapsed'),
      chat:    !root.classList.contains('chat-collapsed'),
    };
  }

  function computeWrapLimit() {
    const { sidebar, chat } = getLayoutState();
    if (sidebar && chat)   return COLS.bothOpen;
    if (!sidebar && chat)  return COLS.onlyChat;
    if (sidebar && !chat)  return COLS.onlySidebar;
    return COLS.bothClosed;
  }

  function applyWrapLimit(force) {
    if (!editor) return;
    const limit = computeWrapLimit();
    if (!force && limit === lastLimit) return;
    lastLimit = limit;
    try {
      const session = editor.getSession();
      if (session && typeof session.setWrapLimitRange === 'function') {
        // Force a HARD wrap exactly at this column. Ace also respects the
        // editor.setOption('wrap', true) flag, which our settings layer
        // already controls; we just constrain the limit here.
        session.setUseWrapMode(true);
        session.setWrapLimitRange(limit, limit);
      }
    } catch {}
    try { editor.resize(true); } catch {}
  }

  function scheduleApply() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      applyWrapLimit(false);
    }, 50);
  }

  function init(ed) {
    editor = ed;
    applyWrapLimit(true);

    // Each new session needs the limit re-applied — Ace doesn't carry
    // wrapLimitRange across session swaps. Wait one frame so the new
    // session is fully attached before we mutate it.
    editor.on('changeSession', () => {
      setTimeout(() => applyWrapLimit(true), 30);
    });
  }

  // Listen for panel-toggle events from every plausible source so we
  // don't miss any path that flips sidebar/chat visibility.
  const TOGGLE_EVENTS = [
    'menu:view:toggle-sidebar',
    'menu:view:toggle-chat',
    'menu:toggle-sidebar',
    'menu:toggle-chat',
    'sidebar:visibility-changed',
    'chat:visibility-changed',
  ];
  for (const evt of TOGGLE_EVENTS) {
    bus.on(evt, scheduleApply);
  }

  // ── Two backup observers — bus events alone aren't reliable ────────
  // The activity bar and `app.js`'s toggleSidebar/toggleChat mutate
  // `#ide-root.side-collapsed` / `.chat-collapsed` directly; some paths
  // skip the bus entirely. So:
  //   1. MutationObserver on #ide-root[class] — fires on EVERY class
  //      change regardless of which code path triggered it.
  //   2. ResizeObserver on the editor container — `#ide-root` itself
  //      keeps the same outer size when panels toggle (only its grid
  //      columns redistribute), so RO on the root doesn't fire. The
  //      editor container, however, DOES change width with every panel
  //      toggle and every splitter drag — that's the right element to
  //      watch.
  let lastClassSnapshot = '';
  function watchLayout() {
    const root = document.getElementById('ide-root');
    if (!root) { setTimeout(watchLayout, 250); return; }

    lastClassSnapshot = root.className;
    try {
      const mo = new MutationObserver(() => {
        const next = root.className;
        if (next === lastClassSnapshot) return;
        // Only react when one of OUR classes flipped, ignoring unrelated
        // class additions (e.g. theme classes).
        const before = lastClassSnapshot;
        lastClassSnapshot = next;
        const beforeSide = before.includes('side-collapsed');
        const afterSide  = next.includes('side-collapsed');
        const beforeChat = before.includes('chat-collapsed');
        const afterChat  = next.includes('chat-collapsed');
        if (beforeSide !== afterSide || beforeChat !== afterChat) {
          scheduleApply();
        }
      });
      mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    } catch {}

    // Editor container resize → splitter drags, window resize, etc.
    function attachEditorRO() {
      const host = document.getElementById('monaco-host')
                || document.querySelector('.ace_editor')
                || (editor && editor.container);
      if (!host) { setTimeout(attachEditorRO, 250); return; }
      try {
        const ro = new ResizeObserver(scheduleApply);
        ro.observe(host);
      } catch {}
    }
    attachEditorRO();
  }
  watchLayout();

  bus.on('ace:ready', init);
})();
