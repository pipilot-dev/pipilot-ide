// PiPilot IDE — "What's new in this version" popup.
//
// On boot, compare the running version (from electronAPI.getVersion())
// with the last version we stored in localStorage. If they differ —
// or it's never been recorded — fetch RELEASE_NOTES_<version>.md from
// the bundle and show it in a modal so users see what changed without
// having to hunt down release notes on GitHub.
//
// Suppressed on the very-first launch ever (no point showing v0.1.0
// release notes to someone who's literally never installed PiPilot —
// they're seeing the IDE for the first time, not an "update").

(() => {
  const api = window.electronAPI;
  if (!api?.getVersion) return;

  const SEEN_KEY = 'pipilot.changelog.last-seen';
  const FIRST_LAUNCH_KEY = 'pipilot.changelog.first-launch-done';

  let markedReady = false;
  function ensureMarked() {
    if (markedReady || window.marked) { markedReady = true; return Promise.resolve(); }
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
      s.onload = () => { markedReady = true; resolve(); };
      s.onerror = () => { markedReady = false; resolve(); };
      document.head.appendChild(s);
    });
  }

  async function loadNotes(version) {
    const slug = version.startsWith('v') ? version : `v${version}`;
    const candidates = [
      `RELEASE_NOTES_${slug}.md`,
      `release-notes/${slug}.md`,
    ];
    for (const path of candidates) {
      try {
        const res = await fetch(path);
        if (res.ok) return await res.text();
      } catch {}
    }
    return null;
  }

  function injectStyles() {
    if (document.getElementById('changelog-popup-styles')) return;
    const st = document.createElement('style');
    st.id = 'changelog-popup-styles';
    st.textContent = `
      .cl-overlay {
        position: fixed; inset: 0; z-index: 90100;
        background: color-mix(in srgb, black 55%, transparent);
        backdrop-filter: blur(2px);
        display: grid; place-items: center;
        animation: cl-in 160ms ease-out;
      }
      @keyframes cl-in { from { opacity: 0; } to { opacity: 1; } }
      .cl-card {
        width: min(640px, calc(100vw - 48px));
        max-height: min(720px, calc(100vh - 48px));
        background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
        display: flex; flex-direction: column;
        font-family: var(--font-sans); color: var(--text);
        overflow: hidden;
      }
      .cl-head {
        padding: 18px 22px; border-bottom: 1px solid var(--border);
        display: flex; align-items: center; gap: 12px;
      }
      .cl-head .badge {
        font-family: var(--font-mono); font-size: 11px; font-weight: 600;
        padding: 3px 8px; border-radius: 999px;
        background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, white));
        color: var(--bg);
      }
      .cl-head h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-strong); flex: 1; }
      .cl-head .x {
        all: unset; cursor: pointer; padding: 4px 8px; border-radius: 4px;
        color: var(--text-mid); font-size: 18px; line-height: 1;
      }
      .cl-head .x:hover { background: var(--surface-alt); color: var(--text-strong); }
      .cl-body {
        flex: 1; overflow: auto; padding: 18px 22px 8px;
        font-size: 13px; line-height: 1.6;
      }
      .cl-body h1 { font-size: 18px; margin: 6px 0 12px; color: var(--text-strong); }
      .cl-body h2 { font-size: 14px; margin: 18px 0 6px; color: var(--text-strong); border-top: 1px solid var(--border); padding-top: 14px; }
      .cl-body h2:first-of-type { border-top: 0; padding-top: 0; }
      .cl-body h3 { font-size: 13px; margin: 14px 0 4px; color: var(--text-strong); }
      .cl-body p, .cl-body li { font-size: 12.5px; line-height: 1.55; }
      .cl-body ul, .cl-body ol { margin: 6px 0; padding-left: 20px; }
      .cl-body code:not(pre code) {
        font-family: var(--font-mono); font-size: 11.5px;
        padding: 1px 5px; background: var(--bg);
        border: 1px solid var(--border); border-radius: 3px;
        color: var(--accent);
      }
      .cl-body pre {
        background: var(--bg); border: 1px solid var(--border);
        border-radius: 5px; padding: 10px 12px; overflow: auto;
        font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5;
        margin: 10px 0;
      }
      .cl-body table { border-collapse: collapse; margin: 10px 0; font-size: 12px; width: 100%; }
      .cl-body th, .cl-body td { border: 1px solid var(--border); padding: 5px 9px; text-align: left; }
      .cl-body th { background: var(--surface-alt); color: var(--text-strong); font-weight: 600; }
      .cl-body a { color: var(--accent); text-decoration: none; }
      .cl-body a:hover { text-decoration: underline; }
      .cl-foot {
        padding: 12px 22px 18px; border-top: 1px solid var(--border);
        display: flex; gap: 8px; justify-content: flex-end;
      }
      .cl-btn {
        padding: 7px 14px; border-radius: 5px; font: inherit; font-size: 12px; cursor: pointer;
        border: 1px solid var(--border); background: var(--surface-alt); color: var(--text);
      }
      .cl-btn.primary { background: var(--text-strong); color: var(--bg); border-color: var(--text-strong); }
      .cl-btn.primary:hover { background: white; }
    `;
    document.head.appendChild(st);
  }

  async function show(versionOverride) {
    const version = versionOverride || (await api.getVersion()) || '';
    if (!version) return false;
    const md = await loadNotes(version);
    if (!md) return false;

    injectStyles();
    await ensureMarked();
    const html = window.marked
      ? window.marked.parse(md)
      : `<pre>${md.replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]))}</pre>`;

    const root = document.createElement('div');
    root.className = 'cl-overlay';
    root.innerHTML = `
      <div class="cl-card" role="dialog" aria-modal="true">
        <div class="cl-head">
          <span class="badge">v${version.replace(/^v/, '')}</span>
          <h2>What's new</h2>
          <button class="x" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="cl-body" data-body></div>
        <div class="cl-foot">
          <button class="cl-btn primary" data-action="close">Got it</button>
        </div>
      </div>
    `;
    root.querySelector('[data-body]').innerHTML = html;
    document.body.appendChild(root);

    const close = () => {
      try { root.remove(); } catch {}
      try { localStorage.setItem(SEEN_KEY, version); } catch {}
    };
    root.addEventListener('click', (e) => {
      if (e.target === root || e.target.closest('[data-action="close"]')) close();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    // External links inside the body open in the embedded browser when
    // available, fall back to OS browser otherwise.
    root.querySelectorAll('.cl-body a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!/^https?:/i.test(href)) return;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        try { window.PiPilot?.bus?.emit?.('browser:open', { url: href }); }
        catch { api.shell?.openExternal?.(href); }
      });
    });
    return true;
  }

  async function maybeShowOnBoot() {
    let version = '';
    try { version = (await api.getVersion()) || ''; } catch {}
    if (!version) return;

    let lastSeen = '';
    let firstLaunchDone = false;
    try {
      lastSeen = localStorage.getItem(SEEN_KEY) || '';
      firstLaunchDone = localStorage.getItem(FIRST_LAUNCH_KEY) === '1';
    } catch {}

    // First-ever launch: don't show — the user is seeing the IDE for the
    // first time. Just record the version + flag so the next update is
    // detected as an update, not a first install.
    if (!firstLaunchDone) {
      try {
        localStorage.setItem(FIRST_LAUNCH_KEY, '1');
        localStorage.setItem(SEEN_KEY, version);
      } catch {}
      return;
    }

    if (lastSeen === version) return;
    // Wait a beat so the popup doesn't fight the editor for first paint.
    setTimeout(() => { show(version).catch(() => {}); }, 1200);
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.changelog = { show, maybeShowOnBoot };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShowOnBoot);
  } else {
    maybeShowOnBoot();
  }
})();
