// PiPilot IDE — Toast notifications (Phase 6)
(function () {
  const bus = window.PiPilot?.bus;
  const MAX_VISIBLE = 5;
  const DEFAULT_DURATION = 3000;

  const ICONS = {
    success: '✓',
    error: '✕',
    warn: '!',
    info: 'i',
  };

  function ensureStyles() {
    if (document.getElementById('toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      .toast {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        min-width: 280px;
        max-width: 420px;
        padding: 10px 12px;
        background: var(--surface-raised);
        border: 1px solid var(--border);
        border-left: 3px solid var(--accent);
        border-radius: var(--radius);
        box-shadow: var(--shadow-lg);
        color: var(--text-strong);
        font-size: var(--fs-sm);
        pointer-events: auto;
        animation: toast-slide-in 0.2s ease-out;
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      .toast.leaving {
        opacity: 0;
        transform: translateX(16px);
      }
      .toast .toast-icon {
        width: 20px;
        height: 20px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 700;
        background: var(--surface-alt);
        color: var(--text-strong);
      }
      .toast.success { border-left-color: var(--ok); }
      .toast.success .toast-icon { background: rgba(86,211,100,0.18); color: var(--ok); }
      .toast.warn { border-left-color: var(--warn); }
      .toast.warn .toast-icon { background: rgba(229,166,57,0.18); color: var(--warn); }
      .toast.error { border-left-color: var(--error); }
      .toast.error .toast-icon { background: rgba(229,83,75,0.18); color: var(--error); }
      .toast.info { border-left-color: var(--info); }
      .toast.info .toast-icon { background: rgba(108,182,255,0.18); color: var(--info); }
      .toast-body { flex: 1; min-width: 0; }
      .toast-message {
        color: var(--text-strong);
        word-wrap: break-word;
        white-space: pre-wrap;
      }
      .toast-action {
        margin-top: 6px;
        padding: 3px 8px;
        font-size: var(--fs-xs);
        background: var(--surface-alt);
        color: var(--accent-light);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
      }
      .toast-action:hover { background: var(--accent-dim); color: var(--accent-light); border-color: var(--accent); }
      .toast-dismiss {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--text-dim);
        border-radius: var(--radius-sm);
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
      }
      .toast-dismiss:hover { background: var(--surface-alt); color: var(--text-strong); }
      @keyframes toast-slide-in {
        from { opacity: 0; transform: translateX(24px); }
        to { opacity: 1; transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  }

  const toasts = new Set();

  function getRoot() {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      root.className = 'toast-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function dismiss(toast) {
    if (!toast || !toasts.has(toast)) return;
    toasts.delete(toast);
    toast.el.classList.add('leaving');
    clearTimeout(toast.timer);
    setTimeout(() => {
      toast.el.remove();
    }, 200);
  }

  function show(message, opts = {}) {
    ensureStyles();
    const root = getRoot();
    const type = opts.type || 'info';
    const duration = opts.duration != null
      ? opts.duration
      : (type === 'error' ? 6000 : DEFAULT_DURATION);

    while (toasts.size >= MAX_VISIBLE) {
      const oldest = toasts.values().next().value;
      dismiss(oldest);
    }

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = ICONS[type] || ICONS.info;

    const body = document.createElement('div');
    body.className = 'toast-body';
    const msg = document.createElement('div');
    msg.className = 'toast-message';
    msg.textContent = String(message ?? '');
    body.appendChild(msg);

    let actionBtn = null;
    if (opts.action && opts.action.label) {
      actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action';
      actionBtn.textContent = opts.action.label;
      body.appendChild(actionBtn);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'toast-dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.textContent = '×';

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.appendChild(icon);
    el.appendChild(body);
    el.appendChild(dismissBtn);

    const toast = { el, timer: null, duration, remaining: duration };

    function startTimer() {
      if (duration <= 0) return;
      toast.start = Date.now();
      toast.timer = setTimeout(() => dismiss(toast), toast.remaining);
    }
    function pauseTimer() {
      if (!toast.timer) return;
      clearTimeout(toast.timer);
      toast.timer = null;
      toast.remaining = Math.max(500, toast.remaining - (Date.now() - toast.start));
    }

    el.addEventListener('mouseenter', pauseTimer);
    el.addEventListener('mouseleave', startTimer);

    dismissBtn.addEventListener('click', () => dismiss(toast));
    if (actionBtn && typeof opts.action.onClick === 'function') {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { opts.action.onClick(); } catch (err) { console.error(err); }
        dismiss(toast);
      });
    }

    root.appendChild(el);
    toasts.add(toast);
    startTimer();

    return { dismiss: () => dismiss(toast) };
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.toast = {
    show,
    success: (msg, opts = {}) => show(msg, { ...opts, type: 'success' }),
    error: (msg, opts = {}) => show(msg, { duration: 6000, ...opts, type: 'error' }),
    info: (msg, opts = {}) => show(msg, { ...opts, type: 'info' }),
    warn: (msg, opts = {}) => show(msg, { ...opts, type: 'warn' }),
  };

  // Decide whether a toast should be ESCALATED to a persistent notification
  // card (errors and actionable prompts) or shown as the classic ephemeral
  // toast. Either way we record it in the notification center's history so
  // the bell icon reflects the full activity log.
  function dispatch(message, opts = {}) {
    const type = opts.type || 'info';
    const notif = window.PiPilot?.notifications;
    const hasAction = opts.action && opts.action.label;
    const escalate = type === 'error' || hasAction;

    if (escalate && notif) {
      const sevMap = { ok: 'info', success: 'info', info: 'info', warn: 'warn', error: 'error' };
      notif.show({
        severity: sevMap[type] || 'info',
        message: String(message ?? ''),
        source: opts.source,
        sticky: true,
        actions: hasAction ? [{
          label: opts.action.label,
          primary: true,
          onClick: opts.action.onClick,
        }] : undefined,
      });
      return;
    }

    show(message, opts);

    // History-only mirror so the bell shows even transient confirmations.
    if (notif && notif.recordHistory) {
      const sevMap = { ok: 'info', success: 'info', info: 'info', warn: 'warn', error: 'error' };
      notif.recordHistory({
        severity: sevMap[type] || 'info',
        message: String(message ?? ''),
        source: opts.source,
      });
    }
  }

  if (bus) {
    bus.on('toast:show', (payload) => {
      if (!payload) return;
      if (typeof payload === 'string') { dispatch(payload); return; }
      const { message, ...opts } = payload;
      dispatch(message, opts);
    });
  }
})();
