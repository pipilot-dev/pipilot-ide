// PiPilot IDE — Embedded Browser
//
// Opens an editor tab containing a real Chromium <webview> (not an iframe),
// so it loads sites that block iframe embedding. Each tab is a fully
// independent browsing context with its own URL, history, and webContents.
//
// Public API:
//   PiPilot.browser.open(url)             — open a new browser tab
//   PiPilot.browser.openIncognito(url)    — same, but in-memory session
//   PiPilot.browser.openHistoryTab()      — show history list as a tab
//   PiPilot.browser.openDownloadsTab()    — show downloads list as a tab
//
// Bus events:
//   bus.emit('browser:open', { url, incognito })
//   bus.emit('browser:open-history')
//   bus.emit('browser:open-downloads')

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot?.bus;
  if (!bus || !api?.browser) return;

  const HOME_URL = localStorage.getItem('pipilot.browser.home') || 'https://www.google.com';
  const SEARCH_ENGINES = {
    google:    'https://www.google.com/search?q=',
    duckduckgo:'https://duckduckgo.com/?q=',
    bing:      'https://www.bing.com/search?q=',
    brave:     'https://search.brave.com/search?q=',
  };
  function getSearchEngine() {
    const key = localStorage.getItem('pipilot.browser.search') || 'google';
    return SEARCH_ENGINES[key] || SEARCH_ENGINES.google;
  }

  const PARTITION_PERSIST = 'persist:pipilot-browser';
  const PARTITION_INCOGNITO = 'pipilot-browser-incognito';
  const USER_AGENT = navigator.userAgent
    .replace(/PiPilot\/[\w.\-]+\s*/i, '')
    .replace(/Electron\/[\w.\-]+\s*/i, '')
    .trim();

  // Resolve the webview preload path once and reuse for every tab
  let WEBVIEW_PRELOAD_URL = null;
  api.browser.getPreloadPath().then(r => { if (r?.ok) WEBVIEW_PRELOAD_URL = r.url; }).catch(() => {});

  // ── Permission / auth / cert listeners (wire once globally) ────
  // The main process posts an "ask" event whenever a webview triggers
  // a permission/cert/auth challenge; we surface a PiPilot.modal and
  // post the user's decision back.
  const PERMISSION_LABEL = {
    media: 'use your camera and microphone',
    geolocation: 'know your location',
    notifications: 'show desktop notifications',
    'clipboard-read': 'read your clipboard',
    'clipboard-sanitized-write': 'write to your clipboard',
    'persistent-storage': 'store data persistently',
    fullscreen: 'enter fullscreen',
    pointerLock: 'lock your mouse pointer',
    'display-capture': 'capture your screen',
    midi: 'access MIDI devices',
    'midi-sysex': 'access MIDI devices (system-exclusive)',
    serial: 'access serial devices',
    hid: 'access HID devices',
    usb: 'access USB devices',
    'background-sync': 'sync data in the background',
  };
  api.browser.onPermissionAsk(async ({ id, origin, permission }) => {
    const label = PERMISSION_LABEL[permission] || `use the "${permission}" feature`;
    const modal = window.PiPilot?.modal;
    if (!modal?.confirm) {
      api.browser.respondPermission(id, 'deny');
      return;
    }
    const ok = await modal.confirm({
      title: 'Permission request',
      message: `${origin || 'A site'} wants to ${label}. Allow?`,
      confirmText: 'Allow',
      cancelText: 'Deny',
    });
    api.browser.respondPermission(id, ok ? 'allow' : 'deny');
    // Persist for this origin so we don't re-prompt on every page load
    if (origin) api.browser.savePermission(origin, permission, ok ? 'allow' : 'deny');
  });

  api.browser.onAuthAsk(async ({ id, host, realm }) => {
    const username = await window.PiPilot?.modal?.prompt?.({
      title: 'Sign in required',
      label: `${host} requires authentication${realm ? ` (${realm})` : ''}. Username:`,
      placeholder: 'username',
      confirmText: 'Next',
    });
    if (!username) { api.browser.respondAuth(id, null, null); return; }
    const password = await window.PiPilot?.modal?.prompt?.({
      title: 'Sign in required',
      label: `Password for ${username}:`,
      placeholder: 'password',
      confirmText: 'Sign in',
    });
    if (password == null) { api.browser.respondAuth(id, null, null); return; }
    api.browser.respondAuth(id, username, password);
  });

  api.browser.onCertAsk(async ({ id, origin, error }) => {
    const ok = await window.PiPilot?.modal?.confirm?.({
      title: 'Certificate problem',
      message: `${origin}\n\nThis site's certificate is invalid:\n${error || 'unknown error'}\n\nProceed anyway? Only do this if you trust the site.`,
      danger: true,
      confirmText: 'Proceed anyway',
      cancelText: 'Cancel',
    });
    api.browser.respondCert(id, !!ok, false);
  });

  // ── Address bar URL/search detection ────────────────────────────
  function normalizeUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    // Already a full URL
    if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(raw)) return raw;
    // about:, chrome:, etc.
    if (/^(about|chrome|file|data|mailto):/i.test(raw)) return raw;
    // localhost / IP / has a dot and no spaces → assume URL
    const looksLikeHost = /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(\/.*)?$/i.test(raw)
      || (/^[\w.\-]+\.[a-z]{2,}([\/?#].*)?$/i.test(raw) && !/\s/.test(raw));
    if (looksLikeHost) return 'https://' + raw;
    // Otherwise treat as search query
    return getSearchEngine() + encodeURIComponent(raw);
  }

  // ── Styles ──────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('browser-tab-styles')) return;
    const st = document.createElement('style');
    st.id = 'browser-tab-styles';
    st.textContent = `
      .br-tab { display: flex; flex-direction: column; height: 100%; background: var(--bg, #16161a); color: var(--text); }
      .br-toolbar {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 8px;
        background: var(--surface, #1a1a22);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        font-family: var(--font-sans);
      }
      .br-tab.incognito .br-toolbar { background: linear-gradient(90deg, #2a1f3a 0%, #1f1a2a 100%); }
      .br-icon-btn {
        width: 28px; height: 28px;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; border: none; border-radius: 4px;
        color: var(--text-mid, #aaa); cursor: pointer;
        flex-shrink: 0;
      }
      .br-icon-btn:hover:not(:disabled) { background: var(--surface-alt); color: var(--text-strong); }
      .br-icon-btn:disabled { opacity: 0.3; cursor: default; }
      .br-icon-btn.active { color: var(--accent); }
      .br-url-wrap {
        flex: 1; min-width: 0;
        display: flex; align-items: center; gap: 6px;
        background: var(--surface-alt, #232329);
        border: 1px solid transparent;
        border-radius: 14px;
        padding: 0 10px;
        height: 28px;
        transition: border-color 0.12s, background 0.12s;
      }
      .br-url-wrap:focus-within { border-color: var(--accent); background: var(--bg); }
      .br-secure-icon {
        width: 14px; height: 14px;
        display: inline-flex; align-items: center; justify-content: center;
        color: var(--text-dim);
        flex-shrink: 0;
      }
      .br-secure-icon.secure { color: #56d364; }
      .br-secure-icon.insecure { color: var(--warn); }
      .br-url-input {
        flex: 1; min-width: 0;
        background: transparent; border: none; outline: none;
        color: var(--text-strong); font-size: 12px;
        font-family: var(--font-sans);
        padding: 0;
      }
      .br-url-input::placeholder { color: var(--text-faint); }
      .br-progress {
        position: absolute;
        left: 0; right: 0;
        height: 2px;
        background: linear-gradient(90deg, var(--accent), var(--accent-light, #ffb38a));
        transform-origin: left center;
        transform: scaleX(0);
        transition: transform 0.25s ease, opacity 0.2s ease;
        z-index: 5;
        opacity: 0;
      }
      .br-progress.loading { opacity: 1; }
      .br-stage { flex: 1; min-height: 0; position: relative; background: #fff; }
      .br-stage webview { width: 100%; height: 100%; display: inline-flex; }
      .br-stage.error::before {
        content: attr(data-error);
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: var(--bg); color: var(--text-dim);
        font-size: 13px; padding: 32px; text-align: center; white-space: pre-wrap;
      }
      /* Find-in-page bar */
      .br-find {
        position: absolute;
        top: 8px; right: 14px;
        display: none;
        align-items: center; gap: 4px;
        background: var(--surface-raised);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 4px 6px;
        z-index: 10;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
      .br-find.open { display: inline-flex; }
      .br-find input {
        background: var(--surface-alt);
        border: 1px solid transparent;
        border-radius: 3px;
        color: var(--text);
        padding: 3px 8px;
        font-size: 12px;
        width: 200px;
        outline: none;
      }
      .br-find input:focus { border-color: var(--accent); }
      .br-find-count { color: var(--text-dim); font-size: 11px; min-width: 50px; text-align: center; }
      /* Menu popover */
      .br-menu {
        position: absolute;
        top: 38px; right: 8px;
        min-width: 220px;
        background: var(--surface-raised);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        padding: 4px;
        z-index: 100;
      }
      .br-menu-item {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 10px;
        font-size: 12px;
        color: var(--text);
        background: transparent; border: none;
        width: 100%; text-align: left;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
      }
      .br-menu-item:hover { background: var(--surface-alt); }
      .br-menu-item .br-key { margin-left: auto; color: var(--text-dim); font-size: 10px; font-family: var(--font-mono); }
      .br-menu-sep { height: 1px; background: var(--border); margin: 4px 0; }
      /* Bookmarks bar */
      .br-bookmarks {
        display: flex; align-items: center; gap: 2px;
        padding: 2px 8px;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        overflow-x: auto;
        flex-shrink: 0;
        scrollbar-width: thin;
      }
      .br-bookmark {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 8px;
        background: transparent;
        border: none;
        border-radius: 3px;
        font-size: 11px;
        color: var(--text-mid);
        cursor: pointer;
        white-space: nowrap;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: inherit;
      }
      .br-bookmark:hover { background: var(--surface-alt); color: var(--text-strong); }
      .br-bookmark img { width: 14px; height: 14px; flex-shrink: 0; }
      .br-bookmark-empty { padding: 3px 8px; font-size: 11px; color: var(--text-dim); font-style: italic; }
      /* History/downloads list pages */
      .br-list-page {
        padding: 24px 32px;
        max-width: 900px;
        margin: 0 auto;
        font-family: var(--font-sans);
      }
      .br-list-page h2 { color: var(--text-strong); font-size: 18px; margin: 0 0 16px; }
      .br-list-row {
        display: flex; align-items: center; gap: 12px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        border-radius: 4px;
      }
      .br-list-row:hover { background: var(--surface-alt); }
      .br-list-row img { width: 16px; height: 16px; flex-shrink: 0; }
      .br-list-row .br-list-title { flex: 1; min-width: 0; color: var(--text-strong); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .br-list-row .br-list-url { color: var(--text-dim); font-size: 11px; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
      .br-list-row .br-list-meta { color: var(--text-faint); font-size: 11px; flex-shrink: 0; }
      .br-list-row .br-list-x { background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 2px 6px; border-radius: 3px; opacity: 0; transition: opacity 0.12s; }
      .br-list-row:hover .br-list-x { opacity: 1; }
      .br-list-row .br-list-x:hover { background: var(--surface-raised); color: var(--error); }
      .br-list-empty { padding: 32px 16px; text-align: center; color: var(--text-dim); font-size: 13px; }
      .br-list-toolbar {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 0 14px;
        margin-bottom: 8px;
        border-bottom: 1px solid var(--border);
      }
      .br-list-toolbar input {
        flex: 1;
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text);
        padding: 5px 10px;
        font-size: 12px;
        font-family: inherit;
        outline: none;
      }
      .br-list-toolbar input:focus { border-color: var(--accent); }
      .br-list-toolbar button {
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text);
        padding: 5px 12px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .br-list-toolbar button:hover { border-color: var(--accent); }

      /* Internal page top-bar (back-to-browser) */
      .br-internal-topbar {
        display: flex; align-items: center; gap: 12px;
        padding: 6px 12px;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        position: sticky; top: 0; z-index: 5;
      }
      .br-internal-back {
        display: inline-flex; align-items: center; gap: 6px;
        background: transparent; border: 1px solid var(--border);
        color: var(--text-mid); padding: 4px 10px;
        border-radius: 6px; font-size: 11px;
        font-family: inherit; cursor: pointer;
      }
      .br-internal-back:hover { color: var(--text-strong); border-color: var(--accent); background: var(--surface-alt); }
      .br-internal-title { font-size: 12px; color: var(--text-dim); font-weight: 500; }

      /* Settings page */
      .br-settings { padding: 24px 32px; max-width: 760px; margin: 0 auto; font-family: var(--font-sans); }
      .br-settings h1 { color: var(--text-strong); font-size: 22px; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.01em; }
      .br-settings .lead { color: var(--text-dim); font-size: 13px; margin: 0 0 28px; }
      .br-settings section {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 18px 20px;
        margin-bottom: 16px;
      }
      .br-settings section h2 {
        color: var(--text-strong); font-size: 14px; margin: 0 0 14px;
        font-weight: 600;
      }
      .br-settings .row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 8px 0;
      }
      .br-settings .row + .row { border-top: 1px solid var(--border); }
      .br-settings .row .label { font-size: 13px; color: var(--text); flex: 1; min-width: 0; }
      .br-settings .row .label small { display: block; color: var(--text-dim); font-size: 11px; margin-top: 2px; font-weight: 400; }
      .br-settings input[type=text], .br-settings select {
        background: var(--surface-alt); color: var(--text);
        border: 1px solid var(--border); border-radius: 5px;
        padding: 6px 10px; font-size: 12px;
        font-family: inherit; min-width: 240px; outline: none;
      }
      .br-settings input[type=text]:focus, .br-settings select:focus { border-color: var(--accent); }
      .br-settings button.action {
        background: var(--surface-alt); color: var(--text);
        border: 1px solid var(--border); border-radius: 5px;
        padding: 6px 14px; font-size: 12px;
        cursor: pointer; font-family: inherit;
      }
      .br-settings button.action:hover { border-color: var(--accent); }
      .br-settings button.danger { color: #e5534b; border-color: rgba(229,83,75,0.4); }
      .br-settings button.danger:hover { background: rgba(229,83,75,0.1); }

      /* New-tab page */
      .br-newtab {
        min-height: 100%; display: flex; flex-direction: column;
        align-items: center; justify-content: flex-start;
        padding: 56px 24px 40px; gap: 32px;
        background:
          radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,107,53,0.18), transparent 65%),
          radial-gradient(ellipse 60% 60% at 80% 110%, rgba(108,140,255,0.10), transparent 60%),
          var(--bg);
        font-family: var(--font-sans);
        position: relative;
        overflow: hidden;
      }
      .br-newtab::before {
        content: '';
        position: absolute; inset: 0;
        background-image:
          linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
        background-size: 56px 56px;
        mask-image: radial-gradient(ellipse at 50% 30%, black 35%, transparent 80%);
        -webkit-mask-image: radial-gradient(ellipse at 50% 30%, black 35%, transparent 80%);
        pointer-events: none;
      }

      /* Hero — logo with globe-counter badge + artistic display title */
      .br-newtab-hero {
        position: relative; z-index: 1;
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        margin-bottom: 4px;
      }
      .br-newtab-logo-wrap {
        position: relative;
        width: 76px; height: 76px;
      }
      .br-newtab-logo {
        width: 76px; height: 76px;
        border-radius: 18px;
        background:
          conic-gradient(from 220deg, #ff6b35, #ff9a5c, #ffd166, #ff6b35);
        padding: 2px;
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.08) inset,
          0 16px 44px rgba(255,107,53,0.40),
          0 4px 14px rgba(0,0,0,0.55);
        animation: br-logo-spin 14s linear infinite;
      }
      .br-newtab-logo-inner {
        width: 100%; height: 100%;
        border-radius: 16px;
        background: #16161a;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Georgia', 'Playfair Display', serif;
        font-size: 36px; font-weight: 700;
        color: #fff;
        background-clip: padding-box;
      }
      .br-newtab-logo-inner span {
        background: linear-gradient(180deg, #fff 0%, #c8c8d0 100%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent;
        text-shadow: 0 0 30px rgba(255,107,53,0.4);
      }
      @keyframes br-logo-spin {
        from { filter: hue-rotate(0deg); }
        to   { filter: hue-rotate(360deg); }
      }
      .br-newtab-logo-wrap::after {
        /* Soft halo behind the logo */
        content: '';
        position: absolute; inset: -16px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,107,53,0.35), transparent 65%);
        filter: blur(14px);
        z-index: -1;
        animation: br-halo 4s ease-in-out infinite alternate;
      }
      @keyframes br-halo {
        from { opacity: 0.55; transform: scale(0.96); }
        to   { opacity: 0.95; transform: scale(1.06); }
      }
      /* Globe counter badge in the corner */
      .br-newtab-globe {
        position: absolute;
        top: -6px; right: -8px;
        width: 26px; height: 26px;
        border-radius: 50%;
        background: linear-gradient(135deg, #4a90e2 0%, #6cb6ff 100%);
        border: 2px solid #16161a;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 10px rgba(74,144,229,0.5);
        animation: br-globe-bob 3s ease-in-out infinite;
      }
      .br-newtab-globe svg { width: 14px; height: 14px; color: #fff; }
      @keyframes br-globe-bob {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50%      { transform: translateY(-2px) rotate(10deg); }
      }
      .br-newtab-globe::before {
        /* Tiny number badge under the globe (tab count) */
        content: attr(data-count);
        position: absolute;
        bottom: -6px; right: -6px;
        background: var(--accent, #ff6b35);
        color: #fff; font-size: 9px; font-weight: 700;
        padding: 1px 5px; border-radius: 999px;
        font-family: var(--font-mono, monospace);
        line-height: 1.4;
        border: 1.5px solid #16161a;
        min-width: 12px; text-align: center;
      }

      .br-newtab-title {
        font-family: 'Playfair Display', 'Cormorant Garamond', 'Georgia', serif;
        font-size: 56px; font-weight: 700;
        letter-spacing: -0.025em; line-height: 0.95;
        margin: 0;
        background: linear-gradient(180deg, #ffffff 0%, #b0b0bc 100%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent;
        text-align: center;
      }
      .br-newtab-title .accent {
        font-style: italic;
        font-weight: 700;
        background: linear-gradient(180deg, #ff8c61 0%, #ff6b35 100%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .br-newtab-tagline {
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--text-dim, #888);
        margin: 0;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      /* Live clock under the title */
      .br-newtab-clock {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        margin-top: 4px; padding: 12px 22px;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 14px;
        backdrop-filter: blur(6px);
        font-family: var(--font-mono, 'JetBrains Mono', monospace);
      }
      .br-newtab-clock .time {
        font-size: 28px; font-weight: 600;
        color: var(--text-strong, #fff);
        letter-spacing: 0.04em;
        font-variant-numeric: tabular-nums;
        line-height: 1;
      }
      .br-newtab-clock .time .sec {
        font-size: 18px;
        color: var(--accent-light, #ffb38a);
        margin-left: 4px;
        font-weight: 500;
      }
      .br-newtab-clock .date {
        font-size: 11px;
        color: var(--text-dim, #888);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-weight: 500;
      }
      @media (max-width: 520px) {
        .br-newtab-title { font-size: 40px; }
        .br-newtab-logo-wrap, .br-newtab-logo { width: 60px; height: 60px; }
        .br-newtab-logo-inner { font-size: 28px; }
      }

      .br-newtab-search {
        width: 100%; max-width: 580px;
        display: flex; align-items: center; gap: 10px;
        background: var(--surface-raised); border: 1px solid var(--border);
        border-radius: 24px; padding: 4px 6px 4px 16px;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .br-newtab-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(255,107,53,0.15); }
      .br-newtab-search svg { color: var(--text-dim); flex-shrink: 0; }
      .br-newtab-search input {
        flex: 1; background: transparent; border: none; outline: none;
        color: var(--text-strong); font-size: 14px; padding: 10px 4px;
        font-family: inherit;
      }
      .br-newtab-search button {
        background: var(--accent); color: #fff; border: none;
        border-radius: 18px; padding: 7px 18px; font-size: 12px;
        cursor: pointer; font-weight: 600; font-family: inherit;
      }
      .br-newtab-shortcuts {
        display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 18px; max-width: 580px; width: 100%;
      }
      @media (max-width: 520px) { .br-newtab-shortcuts { grid-template-columns: repeat(2, 1fr); } }
      .br-newtab-shortcut {
        position: relative;
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 16px 8px;
        background: transparent; border: 1px solid transparent;
        border-radius: 10px; cursor: pointer;
        text-align: center; font-family: inherit;
        transition: background 0.12s, border-color 0.12s;
      }
      .br-newtab-shortcut:hover { background: var(--surface); border-color: var(--border); }
      .br-newtab-shortcut .icon {
        width: 48px; height: 48px; border-radius: 12px;
        background: var(--surface-alt); display: flex;
        align-items: center; justify-content: center;
        color: var(--text-strong); font-size: 18px; font-weight: 700;
        overflow: hidden;
      }
      .br-newtab-shortcut .icon img { width: 28px; height: 28px; }
      .br-newtab-shortcut .name {
        font-size: 12px; color: var(--text); max-width: 100%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .br-newtab-shortcut .remove {
        position: absolute; top: 4px; right: 4px;
        background: var(--surface-raised); border: 1px solid var(--border);
        color: var(--text-dim); border-radius: 50%;
        width: 20px; height: 20px;
        display: none; align-items: center; justify-content: center;
        cursor: pointer; font-size: 11px;
      }
      .br-newtab-shortcut:hover .remove { display: flex; }
      .br-newtab-shortcut .remove:hover { color: #e5534b; border-color: #e5534b; }
      .br-newtab-shortcut.add .icon {
        background: transparent; border: 1.5px dashed var(--border);
        color: var(--text-dim); font-weight: 400;
      }
      .br-newtab-shortcut.add:hover .icon { border-color: var(--accent); color: var(--accent); }

      /* Site-info popover */
      .br-site-info {
        position: absolute; top: 36px; left: 8px;
        z-index: 100; min-width: 320px; max-width: 420px;
        background: var(--surface-raised); border: 1px solid var(--border);
        border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        padding: 0; font-family: var(--font-sans);
        animation: br-pop-in 0.12s ease-out;
      }
      @keyframes br-pop-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      .br-site-info .si-head {
        padding: 14px 16px; border-bottom: 1px solid var(--border);
        display: flex; gap: 10px; align-items: center;
      }
      .br-site-info .si-status {
        width: 28px; height: 28px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .br-site-info .si-status.secure   { background: rgba(86,211,100,0.15); color: #56d364; }
      .br-site-info .si-status.insecure { background: rgba(229,166,57,0.15); color: var(--warn); }
      .br-site-info .si-status.info     { background: var(--surface-alt); color: var(--text-dim); }
      .br-site-info .si-host { flex: 1; min-width: 0; }
      .br-site-info .si-host b { display: block; font-size: 13px; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .br-site-info .si-host span { font-size: 11px; color: var(--text-dim); }
      .br-site-info .si-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 16px; border-bottom: 1px solid var(--border);
        font-size: 12px;
      }
      .br-site-info .si-row:last-of-type { border-bottom: none; }
      .br-site-info .si-row .k { color: var(--text-dim); }
      .br-site-info .si-row .v { color: var(--text-strong); font-family: var(--font-mono); font-size: 11px; }
      .br-site-info .si-actions {
        padding: 10px 16px; display: flex; gap: 8px; border-top: 1px solid var(--border);
      }
      .br-site-info .si-actions button {
        flex: 1; background: var(--surface-alt); color: var(--text);
        border: 1px solid var(--border); border-radius: 5px;
        padding: 6px 10px; font-size: 11px; cursor: pointer; font-family: inherit;
      }
      .br-site-info .si-actions button:hover { border-color: var(--accent); }
      .br-site-info .si-actions button.danger:hover { color: #e5534b; border-color: #e5534b; background: rgba(229,83,75,0.08); }

      /* View-source banner */
      .br-vs-banner {
        position: absolute; top: 0; left: 0; right: 0;
        z-index: 6;
        display: flex; align-items: center; gap: 10px;
        padding: 6px 14px;
        background: linear-gradient(180deg, rgba(255,107,53,0.16), rgba(255,107,53,0.06));
        border-bottom: 1px solid rgba(255,107,53,0.35);
        color: var(--text-strong, #fff);
        font-family: var(--font-sans);
        font-size: 12px;
      }
      .br-vs-banner .icon {
        width: 14px; height: 14px; color: var(--accent, #ff6b35);
        flex-shrink: 0;
      }
      .br-vs-banner .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .br-vs-banner .label b { color: var(--accent-light, #ffb38a); font-family: var(--font-mono, monospace); font-size: 11px; }
      .br-vs-banner button {
        background: var(--accent, #ff6b35); color: #fff;
        border: none; border-radius: 4px;
        padding: 4px 12px; font-size: 11px; font-weight: 600;
        cursor: pointer; font-family: inherit;
        flex-shrink: 0;
      }
      .br-vs-banner button:hover { filter: brightness(1.1); }

      /* Error page (replaces Chromium's default failed-load page) */
      .br-error {
        position: absolute; inset: 0; z-index: 4;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 32px 24px;
        background: var(--bg);
        font-family: var(--font-sans);
        overflow: auto;
      }
      .br-error .glyph {
        width: 96px; height: 96px;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 50%;
        margin-bottom: 22px;
        color: var(--warn);
      }
      .br-error h1 {
        font-size: 22px; font-weight: 700; color: var(--text-strong);
        margin: 0 0 8px; letter-spacing: -0.01em;
      }
      .br-error .sub { color: var(--text-dim); font-size: 13px; margin: 0 0 4px; max-width: 480px; text-align: center; line-height: 1.5; }
      .br-error code.url { display: inline-block; margin-top: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--text-mid); background: var(--surface-alt); padding: 4px 8px; border-radius: 4px; max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .br-error .badge { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); margin-top: 12px; letter-spacing: 0.06em; }
      .br-error .actions { margin-top: 24px; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
      .br-error .actions button {
        font-family: inherit; font-size: 13px;
        padding: 8px 18px; border-radius: 6px; cursor: pointer;
      }
      .br-error .actions .primary {
        background: var(--accent); color: #fff; border: 1px solid var(--accent);
        font-weight: 600;
      }
      .br-error .actions .primary:hover { filter: brightness(1.1); }
      .br-error .actions .secondary {
        background: transparent; color: var(--text);
        border: 1px solid var(--border);
      }
      .br-error .actions .secondary:hover { border-color: var(--accent); color: var(--accent-light); }
      .br-error .net-status {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; color: var(--text-dim);
        margin-top: 18px;
      }
      .br-error .net-status .dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 6px rgba(86,211,100,0.5);
      }
      .br-error .net-status .dot.off { background: var(--error); box-shadow: 0 0 6px rgba(229,83,75,0.5); animation: br-blink 1.4s infinite; }
      @keyframes br-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

      /* Mini-game */
      .br-game-wrap {
        margin-top: 28px;
        display: flex; flex-direction: column; align-items: center; gap: 8px;
      }
      .br-game-toggle {
        background: var(--surface-alt); color: var(--text);
        border: 1px solid var(--border); border-radius: 6px;
        padding: 6px 14px; font-size: 12px; cursor: pointer; font-family: inherit;
      }
      .br-game-toggle:hover { border-color: var(--accent); color: var(--accent-light); }
      .br-game-canvas {
        background: #06080d; border: 1px solid var(--border); border-radius: 8px;
        cursor: crosshair;
        outline: none;
      }
      .br-game-canvas:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(255,107,53,0.15); }
      .br-game-info { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
      .br-game-info b { color: var(--accent-light); }
    `;
    document.head.appendChild(st);
  }

  // ── Icons (codicon-style) ───────────────────────────────────────
  const I = {
    back:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    fwd:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    reload:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    stop:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    home:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    star:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    starFill:`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    menu:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/></svg>`,
    lock:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
    warn:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 22h20L12 2z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="18" r="0.6" fill="currentColor"/></svg>`,
    info:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`,
    globe:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  };

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  function favicon(url) {
    try {
      const u = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
    } catch { return ''; }
  }

  function relTime(ts) {
    if (!ts) return '';
    const ms = Date.now() - ts;
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    return new Date(ts).toLocaleDateString();
  }

  // ── Error page text builder ─────────────────────────────────────
  // Maps Chromium net-error codes to user-friendly messaging.
  function errorMessageFor(code, desc) {
    const c = Math.abs(Number(code) || 0);
    const offline = !navigator.onLine;
    const codeLabel = `ERR_${(desc || '').replace(/^net::/, '') || 'UNKNOWN'} (${code})`;
    // Net::INTERNET_DISCONNECTED, NAME_NOT_RESOLVED etc.
    if (offline || c === 105 || c === 106) {
      return {
        icon: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="22" x2="22" y2="2"/><path d="M5 12.55a11 11 0 0 1 4.5-2.4"/><path d="M16 6.5A11 11 0 0 1 21 12.55"/><path d="M8 16.5a4 4 0 0 1 4-2"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
        title: 'No internet connection',
        body: 'Your computer is offline. Check your network connection — the page will reload automatically when you reconnect.',
        code: codeLabel,
      };
    }
    if (c === 137 || c === 109 || c === 105 || c === 7 || c === 22 || c === 138) {
      return {
        icon: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>',
        title: "This site can't be reached",
        body: "We couldn't find the server for this address. Check the URL for typos or try again later.",
        code: codeLabel,
      };
    }
    if (c === 100 || c === 101 || c === 102 || c === 103 || c === 104) {
      return {
        icon: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>',
        title: 'Connection refused',
        body: 'The server actively refused the connection. The site may be down or blocking traffic.',
        code: codeLabel,
      };
    }
    if (c === 118 || c === 21) {
      return {
        icon: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>',
        title: 'Connection timed out',
        body: 'The server took too long to respond. It may be overloaded or unreachable from your network.',
        code: codeLabel,
      };
    }
    if (c >= 200 && c < 300) {
      return {
        icon: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 17l-2-2"/></svg>',
        title: 'Certificate problem',
        body: "The site's security certificate is invalid or expired. Continuing may not be safe.",
        code: codeLabel,
      };
    }
    return {
      icon: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      title: 'This page failed to load',
      body: desc ? String(desc).replace(/^net::/, '').replace(/_/g, ' ').toLowerCase() : 'An unexpected error occurred.',
      code: codeLabel,
    };
  }

  // ── Full-tab arcade game (Phaser-based) ─────────────────────────
  // Opens in its own editor tab so it gets the whole viewport. Phaser is
  // loaded from a CDN once and cached by Chromium for offline reuse.
  // Phaser is bundled locally at public/lib/phaser.min.js so the game
  // works fully offline. We try the local copy first; if for some reason
  // it's missing (custom build, file deleted), we fall back to the CDN.
  const PHASER_LOCAL = 'public/lib/phaser.min.js';
  const PHASER_CDN   = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js';
  let phaserPromise = null;
  function injectScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('script load failed: ' + src));
      document.head.appendChild(s);
    });
  }
  function loadPhaser() {
    if (phaserPromise) return phaserPromise;
    if (window.Phaser) { phaserPromise = Promise.resolve(window.Phaser); return phaserPromise; }
    phaserPromise = (async () => {
      try {
        await injectScript(PHASER_LOCAL);
        if (window.Phaser) return window.Phaser;
        throw new Error('Phaser missing after local load');
      } catch (localErr) {
        // Local missing — try CDN
        try {
          await injectScript(PHASER_CDN);
          if (window.Phaser) return window.Phaser;
          throw new Error('Phaser missing after CDN load');
        } catch (cdnErr) {
          throw new Error("Could not load game engine. Local file missing and you're offline.");
        }
      }
    })();
    return phaserPromise;
  }

  function openGameTab() {
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return;
    editor.openVirtualTab({
      id: 'browser-game://stellar-shooter',
      name: '🚀 Stellar Shooter',
      mount: async (container) => {
        container.style.cssText = 'display:flex;flex-direction:column;height:100%;background:radial-gradient(ellipse at top, #1a1830 0%, #06080d 65%);color:#fff;font-family:var(--font-sans);overflow:hidden;';
        container.innerHTML = `
          <div style="padding:8px 14px;background:rgba(0,0,0,0.4);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:14px;flex-shrink:0;">
            <span style="font-weight:700;font-size:13px;letter-spacing:0.04em;">🚀 STELLAR SHOOTER</span>
            <span style="color:rgba(255,255,255,0.5);font-size:11px;">← → move · Space fire · P pause · R restart</span>
            <span style="margin-left:auto;color:rgba(255,255,255,0.6);font-size:11px;font-family:var(--font-mono);" id="ss-hi">Hi: 0</span>
          </div>
          <div id="ss-host" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative;">
            <div id="ss-status" style="color:rgba(255,255,255,0.7);font-size:13px;">Loading game engine…</div>
          </div>
        `;
        const host = container.querySelector('#ss-host');
        const status = container.querySelector('#ss-status');
        const hiEl = container.querySelector('#ss-hi');
        try {
          const Phaser = await loadPhaser();
          status.remove();
          startStellarShooter(Phaser, host, hiEl);
        } catch (err) {
          status.innerHTML = '<div style="text-align:center;max-width:380px;line-height:1.55;">' +
            'Could not load the game engine.<br><span style="color:rgba(255,255,255,0.5);font-size:11px;">' +
            escapeHtml(err.message) + '</span></div>';
        }
      },
    });
  }

  function startStellarShooter(Phaser, host, hiEl) {
    const HI_KEY = 'pipilot.browser.game.hi';
    let hiScore = 0;
    try { hiScore = parseInt(localStorage.getItem(HI_KEY) || '0', 10) || 0; } catch {}
    if (hiEl) hiEl.textContent = 'Hi: ' + hiScore;

    // Use an internal logical canvas size — Phaser's Scale.FIT keeps it sharp at any window size
    const W = 720, H = 900;
    let scene = null;

    class Main extends Phaser.Scene {
      constructor() { super('main'); }
      preload() {
        // All textures are generated procedurally — no external assets,
        // works fully offline once Phaser itself is cached.
      }
      create() {
        scene = this;
        this.score = 0;
        this.wave = 1;
        this.lives = 3;
        this.paused = false;
        this.gameOver = false;
        this.fireCooldown = 0;
        this.tripleShot = 0;
        this.rapidFire = 0;

        // Procedural textures
        this._mkTexture('player', 36, 30, (g) => {
          g.fillStyle(0xff6b35);
          g.fillTriangle(18, 0, 0, 30, 36, 30);
          g.fillStyle(0xffd166);
          g.fillRect(15, 18, 6, 10);
          g.fillStyle(0x1a1a22);
          g.fillCircle(18, 18, 3);
        });
        this._mkTexture('bullet', 6, 14, (g) => {
          g.fillStyle(0xffe79a);
          g.fillRoundedRect(0, 0, 6, 14, 2);
        });
        this._mkTexture('ebullet', 8, 12, (g) => {
          g.fillStyle(0xff5e7e);
          g.fillCircle(4, 6, 4);
        });
        for (let t = 0; t < 3; t++) {
          const colors = [0x73c991, 0x6cb6ff, 0xb392f0];
          this._mkTexture('enemy' + t, 32, 28, (g) => {
            g.fillStyle(colors[t]);
            g.fillRoundedRect(2, 6, 28, 18, 4);
            g.fillRoundedRect(6, 0, 20, 10, 4);
            g.fillStyle(0xffffff);
            g.fillCircle(11, 14, 2);
            g.fillCircle(21, 14, 2);
            g.fillStyle(0x000000);
            g.fillCircle(11, 14, 1);
            g.fillCircle(21, 14, 1);
          });
        }
        this._mkTexture('powerup', 22, 22, (g) => {
          g.fillStyle(0xffd166);
          g.fillRoundedRect(2, 2, 18, 18, 5);
          g.fillStyle(0x1a1a22);
          g.fillCircle(11, 11, 4);
        });
        this._mkTexture('star', 2, 2, (g) => {
          g.fillStyle(0xffffff);
          g.fillRect(0, 0, 2, 2);
        });

        // Starfield background (simple parallax)
        this.starsFar  = this._makeStars(80, 0.4, 0.35);
        this.starsNear = this._makeStars(40, 0.9, 0.7);

        // Groups
        this.bullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, runChildUpdate: false });
        this.enemyBullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, runChildUpdate: false });
        this.enemies = this.physics.add.group();
        this.powerups = this.physics.add.group();

        // Player
        this.player = this.physics.add.image(W / 2, H - 70, 'player');
        this.player.setCollideWorldBounds(true);

        // Collisions
        this.physics.add.overlap(this.bullets, this.enemies, (b, e) => this._hitEnemy(b, e));
        this.physics.add.overlap(this.enemyBullets, this.player, (eb, p) => this._hitPlayer(eb));
        this.physics.add.overlap(this.player, this.enemies, (p, e) => this._crashIntoEnemy(e));
        this.physics.add.overlap(this.player, this.powerups, (p, pu) => this._collectPower(pu));

        // HUD
        this.hud = this.add.text(14, 14, '', {
          fontFamily: 'var(--font-mono, monospace)', fontSize: '14px',
          color: '#ffffff', stroke: '#000', strokeThickness: 3,
        }).setDepth(10);
        this.center = this.add.text(W / 2, H / 2, '', {
          fontFamily: 'var(--font-sans, sans-serif)', fontSize: '36px', fontStyle: 'bold',
          color: '#ffffff', align: 'center',
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('A,D,SPACE,P,R,ENTER');
        this.input.keyboard.on('keydown-P', () => { if (!this.gameOver) this.paused = !this.paused; });
        this.input.keyboard.on('keydown-R', () => { this.scene.restart(); });

        this._spawnWave();
        this._updateHud();
      }
      _mkTexture(key, w, h, draw) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        draw(g);
        g.generateTexture(key, w, h);
        g.destroy();
      }
      _makeStars(count, speed, alpha) {
        const arr = [];
        for (let i = 0; i < count; i++) {
          const s = this.add.image(Math.random() * W, Math.random() * H, 'star').setAlpha(alpha);
          arr.push({ s, speed });
        }
        return arr;
      }
      _spawnWave() {
        const cols = 8;
        const rows = Math.min(2 + Math.floor(this.wave / 2), 5);
        const spacingX = 70;
        const spacingY = 56;
        const startX = (W - (cols - 1) * spacingX) / 2;
        const startY = 80;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const tier = r === 0 ? 2 : r === 1 ? 1 : 0;
            const e = this.physics.add.image(startX + c * spacingX, startY + r * spacingY, 'enemy' + tier);
            e.tier = tier;
            e.hp = tier + 1;
            e.swayPhase = Math.random() * Math.PI * 2;
            e.fireChance = 0.0006 + this.wave * 0.0002 + tier * 0.0002;
            this.enemies.add(e);
          }
        }
        // Drop a powerup occasionally
        if (this.wave > 1 && Math.random() < 0.55) {
          const pu = this.physics.add.image(80 + Math.random() * (W - 160), -20, 'powerup');
          pu.kind = ['rapid', 'triple', 'life'][Math.floor(Math.random() * 3)];
          pu.body.setVelocityY(60);
          this.powerups.add(pu);
        }
      }
      _hitEnemy(bullet, enemy) {
        if (this.gameOver) return;
        bullet.disableBody(true, true);
        enemy.hp -= 1;
        if (enemy.hp <= 0) {
          this.score += (enemy.tier + 1) * 25;
          this._explosion(enemy.x, enemy.y, enemy.tier);
          enemy.destroy();
          this._updateHud();
        } else {
          enemy.setTintFill(0xffffff);
          this.time.delayedCall(80, () => enemy.clearTint && enemy.clearTint());
        }
      }
      _hitPlayer(eb) {
        if (this.gameOver) return;
        eb.disableBody(true, true);
        this._loseLife();
      }
      _crashIntoEnemy(e) {
        if (this.gameOver) return;
        if (e && e.destroy) e.destroy();
        this._loseLife();
      }
      _collectPower(pu) {
        if (this.gameOver) return;
        if (pu.kind === 'rapid')  this.rapidFire = 600;
        if (pu.kind === 'triple') this.tripleShot = 600;
        if (pu.kind === 'life')   { this.lives = Math.min(this.lives + 1, 5); }
        pu.destroy();
        this._updateHud();
      }
      _loseLife() {
        this.lives--;
        this._explosion(this.player.x, this.player.y, 3);
        if (this.lives <= 0) { this._endGame(); return; }
        // Brief invuln + reset position
        this.player.setPosition(W / 2, H - 70);
        this.player.setAlpha(0.3);
        this.tweens.add({ targets: this.player, alpha: 1, duration: 120, repeat: 9, yoyo: true });
        this._updateHud();
      }
      _explosion(x, y, tier) {
        const colors = [0x73c991, 0x6cb6ff, 0xb392f0, 0xff6b35];
        for (let i = 0; i < 12 + tier * 4; i++) {
          const p = this.add.rectangle(x, y, 3, 3, colors[tier % colors.length]);
          const a = Math.random() * Math.PI * 2;
          const sp = 60 + Math.random() * 140;
          this.tweens.add({
            targets: p,
            x: x + Math.cos(a) * sp,
            y: y + Math.sin(a) * sp,
            alpha: 0, duration: 500 + Math.random() * 200,
            onComplete: () => p.destroy(),
          });
        }
      }
      _endGame() {
        this.gameOver = true;
        // Freeze the simulation so enemies/bullets stop moving and the
        // player can't keep colliding (which used to keep firing
        // _crashIntoEnemy after death).
        try {
          this.physics.world.pause();
          if (this.player) {
            this.player.setVisible(false);
            this.player.body && this.player.body.setEnable(false);
          }
        } catch {}
        if (this.score > hiScore) {
          hiScore = this.score;
          try { localStorage.setItem(HI_KEY, String(hiScore)); } catch {}
          if (hiEl) hiEl.textContent = 'Hi: ' + hiScore;
        }
        this.center.setText('GAME OVER\n\nScore: ' + this.score + '\nWave: ' + this.wave + '\n\nPress R to restart');
      }
      _updateHud() {
        const pu = [];
        if (this.tripleShot > 0) pu.push('TRI(' + Math.ceil(this.tripleShot / 60) + ')');
        if (this.rapidFire > 0)  pu.push('RPD(' + Math.ceil(this.rapidFire / 60) + ')');
        this.hud.setText(
          'SCORE  ' + this.score +
          '   WAVE  ' + this.wave +
          '   LIVES  ' + '♥'.repeat(this.lives) +
          (pu.length ? '   ' + pu.join(' ') : '')
        );
      }
      _fire() {
        const speed = -640;
        const fire = (x) => {
          const b = this.bullets.create(x, this.player.y - 18, 'bullet');
          b.body.setAllowGravity(false);
          b.setVelocityY(speed);
          b.setActive(true).setVisible(true);
        };
        if (this.tripleShot > 0) {
          fire(this.player.x);
          const sl = this.bullets.create(this.player.x - 14, this.player.y - 12, 'bullet');
          sl.body.setAllowGravity(false); sl.setVelocity(-90, speed);
          const sr = this.bullets.create(this.player.x + 14, this.player.y - 12, 'bullet');
          sr.body.setAllowGravity(false); sr.setVelocity(90, speed);
        } else {
          fire(this.player.x);
        }
      }
      update(_t, dt) {
        if (this.gameOver) return;
        if (this.paused) {
          this.center.setText('PAUSED\n\nPress P to resume');
          return;
        } else {
          this.center.setText('');
        }

        // Starfield
        for (const { s, speed } of this.starsFar)  { s.y += speed; if (s.y > H) { s.y = -2; s.x = Math.random() * W; } }
        for (const { s, speed } of this.starsNear) { s.y += speed; if (s.y > H) { s.y = -2; s.x = Math.random() * W; } }

        // Player movement
        const left  = this.cursors.left.isDown  || this.keys.A.isDown;
        const right = this.cursors.right.isDown || this.keys.D.isDown;
        const sp = 360;
        this.player.setVelocityX(left ? -sp : right ? sp : 0);

        // Fire
        this.fireCooldown -= dt;
        const cd = this.rapidFire > 0 ? 90 : 220;
        if ((this.cursors.space.isDown || this.keys.SPACE.isDown || this.keys.ENTER.isDown) && this.fireCooldown <= 0) {
          this._fire();
          this.fireCooldown = cd;
        }
        if (this.tripleShot > 0) this.tripleShot -= 1;
        if (this.rapidFire > 0)  this.rapidFire -= 1;

        // Cull bullets
        this.bullets.children.iterate((b) => { if (b && b.y < -20) b.destroy(); });
        this.enemyBullets.children.iterate((b) => { if (b && b.y > H + 20) b.destroy(); });
        this.powerups.children.iterate((p) => { if (p && p.y > H + 20) p.destroy(); });

        // Enemies sway + occasionally fire
        const baseT = this.time.now / 600;
        this.enemies.children.iterate((e) => {
          if (!e) return;
          e.swayPhase += 0.02;
          e.x += Math.cos(e.swayPhase) * 0.6;
          // Slow descent that accelerates as wave goes on
          e.y += 0.1 + this.wave * 0.05;
          if (Math.random() < e.fireChance) {
            const eb = this.enemyBullets.create(e.x, e.y + 16, 'ebullet');
            eb.body.setAllowGravity(false);
            eb.setVelocityY(280 + this.wave * 18);
          }
          if (e.y > H - 60) {
            // Reached the bottom — instant lose
            e.destroy();
            this._loseLife();
          }
        });

        // Wave clear?
        if (this.enemies.countActive(true) === 0) {
          this.wave += 1;
          this._updateHud();
          this._spawnWave();
        }
        this._updateHud();
      }
    }

    const config = {
      type: Phaser.AUTO,
      width: W, height: H,
      backgroundColor: '#06080d',
      parent: host,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
      scene: [Main],
      banner: false,
    };
    const game = new Phaser.Game(config);
    // Auto-cleanup when the tab unmounts
    const obs = new MutationObserver(() => {
      if (!host.isConnected) { try { game.destroy(true); } catch {} obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── Asteroids-lite — offline mini-game (legacy fallback) ────────
  // Tiny, single-canvas, keyboard-controlled. Ship is a stylized P (PiPilot
  // mark). Hit asteroids to score; getting hit ends the run. Resets cleanly
  // when the user retries the page.
  function mountAsteroids(parent) {
    const W = 520, H = 320;
    const info = document.createElement('div');
    info.className = 'br-game-info';
    info.innerHTML = '<b>Asteroids</b> · ← → rotate · ↑ thrust · Space fire · R restart';
    const canvas = document.createElement('canvas');
    canvas.className = 'br-game-canvas';
    canvas.width = W; canvas.height = H;
    canvas.tabIndex = 0;
    parent.appendChild(canvas);
    parent.appendChild(info);
    setTimeout(() => canvas.focus(), 30);

    const ctx = canvas.getContext('2d');
    let ship, asteroids, bullets, score, gameOver, raf;
    const keys = { left: false, right: false, thrust: false, fire: false };
    let cooldown = 0;

    function reset() {
      ship = { x: W/2, y: H/2, vx: 0, vy: 0, ang: -Math.PI/2, alive: true };
      asteroids = [];
      bullets = [];
      score = 0;
      gameOver = false;
      cooldown = 0;
      for (let i = 0; i < 4; i++) spawnAsteroid();
    }
    function spawnAsteroid(size) {
      size = size || 30 + Math.random() * 14;
      const edge = Math.floor(Math.random() * 4);
      let x, y;
      if (edge === 0) { x = 0;     y = Math.random() * H; }
      else if (edge === 1) { x = W; y = Math.random() * H; }
      else if (edge === 2) { x = Math.random() * W; y = 0; }
      else                 { x = Math.random() * W; y = H; }
      const a = Math.random() * Math.PI * 2;
      const sp = 0.4 + Math.random() * 0.8;
      asteroids.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size, ang: 0, spin: (Math.random() - 0.5) * 0.04 });
    }
    function wrap(o) {
      if (o.x < 0) o.x += W; if (o.x > W) o.x -= W;
      if (o.y < 0) o.y += H; if (o.y > H) o.y -= H;
    }
    function step() {
      ctx.fillStyle = '#06080d';
      ctx.fillRect(0, 0, W, H);
      // Stars
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < 60; i++) {
        const sx = (i * 73 + 17) % W;
        const sy = (i * 131 + 41) % H;
        ctx.fillRect(sx, sy, 1, 1);
      }

      if (!gameOver) {
        if (keys.left)  ship.ang -= 0.06;
        if (keys.right) ship.ang += 0.06;
        if (keys.thrust) {
          ship.vx += Math.cos(ship.ang) * 0.12;
          ship.vy += Math.sin(ship.ang) * 0.12;
        }
        ship.vx *= 0.992; ship.vy *= 0.992;
        ship.x += ship.vx; ship.y += ship.vy;
        wrap(ship);

        if (cooldown > 0) cooldown--;
        if (keys.fire && cooldown <= 0) {
          bullets.push({ x: ship.x, y: ship.y, vx: Math.cos(ship.ang) * 5 + ship.vx, vy: Math.sin(ship.ang) * 5 + ship.vy, life: 60 });
          cooldown = 8;
        }
      }

      // Bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx; b.y += b.vy; b.life--;
        wrap(b);
        if (b.life <= 0) { bullets.splice(i, 1); continue; }
        ctx.fillStyle = '#ffe79a';
        ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
      }

      // Asteroids
      for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        a.x += a.vx; a.y += a.vy; a.ang += a.spin;
        wrap(a);
        // Draw lumpy circle
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.ang);
        ctx.strokeStyle = '#9aa0a6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const seg = 9;
        for (let k = 0; k < seg; k++) {
          const t = (k / seg) * Math.PI * 2;
          const r = a.size * (0.78 + (Math.sin(k * 5.3 + a.size) + 1) * 0.11);
          const px = Math.cos(t) * r, py = Math.sin(t) * r;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // Bullet hits
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx*dx + dy*dy < a.size * a.size) {
            bullets.splice(j, 1);
            asteroids.splice(i, 1);
            score += Math.round(60 / a.size * 10);
            // Split if big
            if (a.size > 18) {
              for (let s = 0; s < 2; s++) {
                const ang = Math.random() * Math.PI * 2;
                asteroids.push({ x: a.x, y: a.y, vx: Math.cos(ang) * 1.4, vy: Math.sin(ang) * 1.4, size: a.size * 0.55, ang: 0, spin: (Math.random() - 0.5) * 0.06 });
              }
            }
            break;
          }
        }
        // Ship hit
        if (ship.alive && !gameOver) {
          const dx = ship.x - a.x, dy = ship.y - a.y;
          if (dx*dx + dy*dy < (a.size + 8) * (a.size + 8)) {
            gameOver = true;
            ship.alive = false;
          }
        }
      }
      // Spawn waves
      if (asteroids.length < 3) {
        for (let i = 0; i < 3; i++) spawnAsteroid();
      }

      // Ship
      if (ship.alive) {
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.ang + Math.PI / 2);
        // Stylized 'P' (PiPilot mark)
        ctx.strokeStyle = '#FF6B35';
        ctx.fillStyle = 'rgba(255,107,53,0.15)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(7, 8);
        ctx.lineTo(0, 5);
        ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (keys.thrust) {
          ctx.beginPath();
          ctx.moveTo(0, 8);
          ctx.lineTo(-3, 14);
          ctx.lineTo(3, 14);
          ctx.closePath();
          ctx.fillStyle = '#ffd166';
          ctx.fill();
        }
        ctx.restore();
      }

      // HUD
      ctx.fillStyle = '#e8e8e8';
      ctx.font = '600 13px var(--font-sans, system-ui)';
      ctx.fillText('SCORE  ' + score, 12, 20);
      if (gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = '700 26px var(--font-sans, system-ui)';
        ctx.fillText('GAME OVER', W/2, H/2 - 10);
        ctx.font = '400 13px var(--font-sans, system-ui)';
        ctx.fillStyle = '#bbb';
        ctx.fillText('Score: ' + score + '  ·  Press R to restart', W/2, H/2 + 16);
        ctx.textAlign = 'start';
      }

      raf = requestAnimationFrame(step);
    }
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') keys.left = true;
      else if (e.key === 'ArrowRight') keys.right = true;
      else if (e.key === 'ArrowUp') keys.thrust = true;
      else if (e.key === ' ' || e.key === 'Spacebar') { keys.fire = true; e.preventDefault(); }
      else if (e.key.toLowerCase() === 'r') reset();
    });
    canvas.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft') keys.left = false;
      else if (e.key === 'ArrowRight') keys.right = false;
      else if (e.key === 'ArrowUp') keys.thrust = false;
      else if (e.key === ' ' || e.key === 'Spacebar') keys.fire = false;
    });
    // Auto-pause if removed from DOM
    const obs = new MutationObserver(() => {
      if (!canvas.isConnected) { try { cancelAnimationFrame(raf); } catch {} obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    reset();
    raf = requestAnimationFrame(step);
  }

  // ── Tab registry — used by AI control tools to address open tabs ──
  // Map<tabId, { wv, mode: 'std'|'inc', urlInput, getCurrent: () => ({url,title}) }>
  const tabRegistry = new Map();
  function registerTab(tabId, entry) { tabRegistry.set(tabId, entry); }
  function unregisterTab(tabId) { tabRegistry.delete(tabId); }
  function findTab(tabId) {
    if (tabId && tabRegistry.has(tabId)) return tabRegistry.get(tabId);
    // Fallback: return the active browser tab if available
    const active = window.PiPilot?.editor?.getActiveFile?.();
    if (active && tabRegistry.has(active)) return tabRegistry.get(active);
    // Or the most recently registered one
    if (tabRegistry.size) return Array.from(tabRegistry.values()).pop();
    return null;
  }

  // ── Browser tab ─────────────────────────────────────────────────
  let tabSeq = 0;
  function openBrowserTab(initialUrl, opts = {}) {
    ensureStyles();
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return;
    const incognito = !!opts.incognito;
    const tabId = `browser-tab://${incognito ? 'inc' : 'std'}/${++tabSeq}/${Date.now()}`;
    // Resolve start URL. If no URL was provided AND new-tab page is enabled,
    // boot into about:newtab so the user lands on the shortcut grid.
    let startUrl;
    if (initialUrl) {
      startUrl = normalizeUrl(initialUrl);
    } else if (shortcutsEnabled()) {
      startUrl = NEWTAB_PSEUDO;
    } else {
      startUrl = HOME_URL;
    }
    if (!startUrl) startUrl = HOME_URL;

    editor.openVirtualTab({
      id: tabId,
      name: incognito ? 'New private tab' : 'New tab',
      mount: (container) => mountBrowser(container, tabId, startUrl, incognito),
    });
  }

  function mountBrowser(container, tabId, startUrl, incognito) {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'br-tab' + (incognito ? ' incognito' : '');
    container.appendChild(root);

    // ── Toolbar ──
    const toolbar = document.createElement('div');
    toolbar.className = 'br-toolbar';
    toolbar.style.position = 'relative';
    const progress = document.createElement('div');
    progress.className = 'br-progress';
    progress.style.bottom = '-2px';
    toolbar.appendChild(progress);

    function iconBtn(html, title, onClick) {
      const b = document.createElement('button');
      b.className = 'br-icon-btn';
      b.title = title;
      b.innerHTML = html;
      b.addEventListener('click', onClick);
      return b;
    }

    const backBtn = iconBtn(I.back, 'Back (Alt+←)', () => safeWv(() => { if (wv.canGoBack()) wv.goBack(); }));
    const fwdBtn  = iconBtn(I.fwd, 'Forward (Alt+→)', () => safeWv(() => { if (wv.canGoForward()) wv.goForward(); }));
    const reloadBtn = iconBtn(I.reload, 'Reload (F5)', () => safeWv(() => wv.reload()));
    const homeBtn = iconBtn(I.home, 'Home', () => safeWv(() => wv.loadURL(HOME_URL)));
    toolbar.appendChild(backBtn);
    toolbar.appendChild(fwdBtn);
    toolbar.appendChild(reloadBtn);
    toolbar.appendChild(homeBtn);

    // URL bar
    const urlWrap = document.createElement('div');
    urlWrap.className = 'br-url-wrap';
    const secure = document.createElement('span');
    secure.className = 'br-secure-icon';
    secure.style.cursor = 'pointer';
    secure.title = 'Connection info';
    secure.innerHTML = I.info;
    const urlInput = document.createElement('input');
    urlInput.className = 'br-url-input';
    urlInput.type = 'text';
    urlInput.placeholder = incognito ? 'Search privately or paste URL…' : 'Search the web or paste a URL…';
    urlInput.spellcheck = false;
    urlWrap.appendChild(secure);
    urlWrap.appendChild(urlInput);
    toolbar.appendChild(urlWrap);

    const starBtn = iconBtn(I.star, 'Bookmark this page (Ctrl+D)', toggleBookmark);
    const menuBtn = iconBtn(I.menu, 'Menu', toggleMenu);
    toolbar.appendChild(starBtn);
    toolbar.appendChild(menuBtn);

    root.appendChild(toolbar);

    // ── Bookmarks bar ──
    const bookmarksBar = document.createElement('div');
    bookmarksBar.className = 'br-bookmarks';
    root.appendChild(bookmarksBar);
    refreshBookmarks();

    // ── Stage (webview) ──
    const stage = document.createElement('div');
    stage.className = 'br-stage';
    root.appendChild(stage);

    const wv = document.createElement('webview');
    wv.setAttribute('partition', incognito ? PARTITION_INCOGNITO : PARTITION_PERSIST);
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', USER_AGENT);
    if (WEBVIEW_PRELOAD_URL) wv.setAttribute('preload', WEBVIEW_PRELOAD_URL);
    wv.src = startUrl === NEWTAB_PSEUDO ? 'about:blank' : startUrl;
    stage.appendChild(wv);

    // New-tab overlay: shown when current URL is `about:newtab`. Sits on
    // top of the (blank) webview. We hide it the moment the user navigates.
    const newTabOverlay = document.createElement('div');
    newTabOverlay.style.cssText = 'position:absolute;inset:0;background:var(--bg);z-index:3;display:none;overflow:auto;';
    stage.appendChild(newTabOverlay);
    function showNewTab() {
      newTabOverlay.style.display = '';
      currentUrl = NEWTAB_PSEUDO;
      paintUrl(NEWTAB_PSEUDO);
      // Update editor tab label
      try { window.PiPilot.editor.setTabName?.(tabId, incognito ? 'New private tab' : 'New tab'); } catch {}
      renderNewTabInto(newTabOverlay, (target) => {
        const u = normalizeUrl(target);
        if (u) navigateInTab(u);
      });
    }
    function hideNewTab() { newTabOverlay.style.display = 'none'; }
    function navigateInTab(url) {
      hideNewTab();
      safeWv(() => wv.loadURL(url));
    }
    if (startUrl === NEWTAB_PSEUDO) {
      // Defer one tick so the rest of mountBrowser finishes first
      setTimeout(showNewTab, 0);
    }

    // ── Console capture (rolling, capped at 500 entries) ──
    const consoleLog = [];
    const LEVEL = ['log', 'warn', 'error', 'info'];
    wv.addEventListener('console-message', (e) => {
      consoleLog.push({
        level: LEVEL[e.level] || 'log',
        text: e.message || '',
        source: e.sourceId || '',
        line: e.line || 0,
        ts: Date.now(),
      });
      if (consoleLog.length > 500) consoleLog.splice(0, consoleLog.length - 500);
    });
    // Reset on full navigation so the log reflects the current page
    wv.addEventListener('did-navigate', () => { consoleLog.length = 0; });

    // ── Bridge for window.alert/confirm/prompt + print + save-link ──
    wv.addEventListener('ipc-message', async (e) => {
      const channel = e.channel;
      const payload = (e.args && e.args[0]) || {};
      if (channel === 'webview:dialog') {
        const { id, kind, message, defaultValue } = payload;
        const modal = window.PiPilot?.modal;
        let value = null;
        if (modal) {
          if (kind === 'alert' || kind === 'beforeunload') {
            await (modal.alert ? modal.alert({ title: kind === 'beforeunload' ? 'Leave page?' : 'Page says', message }) : modal.confirm({ title: 'Page says', message, confirmText: 'OK' }));
            value = true;
          } else if (kind === 'confirm') {
            value = await modal.confirm({ title: 'Page asks', message, confirmText: 'OK', cancelText: 'Cancel' });
          } else if (kind === 'prompt') {
            value = await modal.prompt({ title: 'Page asks', label: message, defaultValue: defaultValue || '', confirmText: 'OK' });
          }
        }
        try { wv.send('host:dialog:response', { id, value }); } catch {}
      } else if (channel === 'webview:print') {
        const wcId = wv.getWebContentsId();
        const r = await api.browser.printToPdf(wcId, (payload.title || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80));
        if (r?.ok && !r.cancelled) {
          window.PiPilot?.notifications?.show({
            severity: 'info',
            message: `Saved page as PDF`,
            source: 'Browser',
            sticky: true,
            actions: [
              { label: 'Show in folder', primary: true, onClick: () => api.browser.revealFile(r.savePath) },
              { label: 'Dismiss', onClick: () => {} },
            ],
          });
        } else if (r?.error) {
          bus.emit('toast:show', { type: 'error', message: 'Print failed: ' + r.error, source: 'Browser' });
        }
      } else if (channel === 'webview:save-link') {
        const r = await api.browser.saveAs(payload.url, payload.suggestedName);
        if (r?.error) bus.emit('toast:show', { type: 'error', message: 'Save failed: ' + r.error, source: 'Browser' });
      }
    });

    // Find-in-page bar
    const find = document.createElement('div');
    find.className = 'br-find';
    find.innerHTML = `
      <input type="text" placeholder="Find in page" />
      <span class="br-find-count"></span>
      <button class="br-icon-btn" data-find="prev" title="Previous">◀</button>
      <button class="br-icon-btn" data-find="next" title="Next">▶</button>
      <button class="br-icon-btn" data-find="close" title="Close">✕</button>
    `;
    stage.appendChild(find);
    const findInput = find.querySelector('input');
    const findCount = find.querySelector('.br-find-count');
    let findActive = false;
    function openFind() { find.classList.add('open'); findInput.focus(); findInput.select(); findActive = true; }
    function closeFind() { find.classList.remove('open'); try { wv.stopFindInPage('clearSelection'); } catch {} findActive = false; findCount.textContent = ''; }
    findInput.addEventListener('input', () => {
      const q = findInput.value;
      if (q) wv.findInPage(q);
      else { try { wv.stopFindInPage('clearSelection'); } catch {} findCount.textContent = ''; }
    });
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { if (e.shiftKey) wv.findInPage(findInput.value, { forward: false, findNext: true }); else wv.findInPage(findInput.value, { findNext: true }); }
      else if (e.key === 'Escape') closeFind();
    });
    find.querySelector('[data-find="prev"]').addEventListener('click', () => wv.findInPage(findInput.value, { forward: false, findNext: true }));
    find.querySelector('[data-find="next"]').addEventListener('click', () => wv.findInPage(findInput.value, { findNext: true }));
    find.querySelector('[data-find="close"]').addEventListener('click', closeFind);
    wv.addEventListener('found-in-page', (e) => {
      const { activeMatchOrdinal, matches } = e.result || {};
      findCount.textContent = matches > 0 ? `${activeMatchOrdinal}/${matches}` : 'no matches';
    });

    // ── State sync ──
    let currentUrl = startUrl;
    let currentTitle = '';
    let lastFavicon = null;
    let isLoading = false;
    let domReady = false;

    function paintNav() {
      // canGoBack/canGoForward access webContents which only exists after
      // the webview is attached to the DOM AND dom-ready has fired.
      // Before then, just show defaults — they'll repaint on dom-ready.
      if (domReady) {
        try {
          backBtn.disabled = !wv.canGoBack();
          fwdBtn.disabled = !wv.canGoForward();
        } catch { backBtn.disabled = true; fwdBtn.disabled = true; }
      } else {
        backBtn.disabled = true;
        fwdBtn.disabled = true;
      }
      reloadBtn.innerHTML = isLoading ? I.stop : I.reload;
      reloadBtn.title = isLoading ? 'Stop' : 'Reload (F5)';
      reloadBtn.onclick = isLoading ? () => safeWv(() => wv.stop()) : () => safeWv(() => wv.reload());
    }
    function safeWv(fn) { try { return fn(); } catch (err) { console.warn('[browser] webview op failed (not ready?):', err); } }
    function paintSecure(url) {
      secure.classList.remove('secure', 'insecure');
      if (/^https:\/\//i.test(url)) { secure.classList.add('secure'); secure.innerHTML = I.lock; }
      else if (/^http:\/\//i.test(url)) { secure.classList.add('insecure'); secure.innerHTML = I.warn; }
      else { secure.innerHTML = I.info; }
    }
    function paintUrl(url) {
      if (document.activeElement !== urlInput) urlInput.value = url;
      paintSecure(url);
    }

    async function paintStar() {
      try {
        const r = await api.browser.listBookmarks();
        const has = (r?.entries || []).some(b => b.url === currentUrl);
        starBtn.innerHTML = has ? I.starFill : I.star;
        starBtn.classList.toggle('active', has);
      } catch {}
    }

    // ── Webview events ──
    wv.addEventListener('dom-ready', () => {
      domReady = true;
      paintNav();
      try { wv.setAudioMuted(false); } catch {}
    });
    wv.addEventListener('did-start-loading', () => {
      isLoading = true;
      progress.classList.add('loading');
      progress.style.transform = 'scaleX(0.15)';
      stage.classList.remove('error');
      paintNav();
    });
    wv.addEventListener('did-stop-loading', () => {
      isLoading = false;
      progress.style.transform = 'scaleX(1)';
      setTimeout(() => { progress.classList.remove('loading'); progress.style.transform = 'scaleX(0)'; }, 250);
      paintNav();
    });
    wv.addEventListener('did-navigate', (e) => {
      currentUrl = e.url;
      paintUrl(e.url);
      paintStar();
      // Hide the new-tab overlay any time a real page loads
      if (e.url && e.url !== 'about:blank') hideNewTab();
      // If we navigated to a different URL than the view-source target,
      // clear the banner. (e.g. user clicked Back, typed a new URL, etc.)
      if (viewSourceOf && e.url !== viewSourceOf) hideVsBanner();
      // History (skip incognito)
      if (!incognito) {
        api.browser.addHistory({ url: e.url, title: currentTitle, faviconUrl: lastFavicon }).catch(() => {});
      }
    });
    wv.addEventListener('did-navigate-in-page', (e) => {
      currentUrl = e.url;
      paintUrl(e.url);
      paintStar();
    });
    wv.addEventListener('page-title-updated', (e) => {
      currentTitle = e.title || currentUrl;
      // Update the editor tab name (max 28 chars)
      const display = currentTitle.length > 28 ? currentTitle.slice(0, 28) + '…' : currentTitle;
      try { window.PiPilot.editor.setTabName?.(tabId, display); } catch {}
      // Also try the imperative DOM API as a fallback
      const tabEl = document.querySelector(`[data-tab-id="${CSS.escape(tabId)}"] .tab-name, [data-path="${CSS.escape(tabId)}"] .tab-name`);
      if (tabEl) tabEl.textContent = display;
    });
    wv.addEventListener('page-favicon-updated', (e) => {
      lastFavicon = (e.favicons && e.favicons[0]) || null;
    });
    // ── Rich error page + auto-reload-on-reconnect ─────────────────
    // ── View-source state + Chrome-style banner ────────────────────
    // Chromium's `did-navigate` reports the underlying URL without the
    // `view-source:` prefix, so we can't infer view-source mode from
    // currentUrl alone. Track it explicitly.
    let viewSourceOf = null; // original URL we're viewing source of, or null
    const vsBanner = document.createElement('div');
    vsBanner.className = 'br-vs-banner';
    vsBanner.style.display = 'none';
    vsBanner.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      <span class="label">Viewing source of <b></b></span>
      <button type="button">Exit source view</button>
    `;
    stage.appendChild(vsBanner);
    function showVsBanner(targetUrl) {
      viewSourceOf = targetUrl;
      vsBanner.querySelector('b').textContent = targetUrl;
      vsBanner.style.display = '';
    }
    function hideVsBanner() {
      viewSourceOf = null;
      vsBanner.style.display = 'none';
    }
    vsBanner.querySelector('button').addEventListener('click', () => {
      const target = viewSourceOf;
      hideVsBanner();
      if (target) safeWv(() => wv.loadURL(target));
    });

    const errorOverlay = document.createElement('div');
    errorOverlay.className = 'br-error';
    errorOverlay.style.display = 'none';
    stage.appendChild(errorOverlay);
    let lastFailedUrl = '';
    let reconnectListener = null;
    function showErrorPage(errorCode, errorDescription, failedUrl) {
      lastFailedUrl = failedUrl || currentUrl || '';
      const meta = errorMessageFor(errorCode, errorDescription);
      errorOverlay.innerHTML = `
        <div class="glyph">${meta.icon}</div>
        <h1>${escapeHtml(meta.title)}</h1>
        <p class="sub">${escapeHtml(meta.body)}</p>
        ${lastFailedUrl ? `<code class="url">${escapeHtml(lastFailedUrl)}</code>` : ''}
        <div class="badge">${escapeHtml(meta.code)}</div>
        <div class="actions">
          <button class="primary"  data-act="retry">Try again</button>
          <button class="secondary" data-act="search">Search Google</button>
          <button class="secondary" data-act="home">New tab</button>
        </div>
        <div class="net-status">
          <span class="dot ${navigator.onLine ? '' : 'off'}"></span>
          <span class="net-label">${navigator.onLine ? 'Connected' : "Offline — page will auto-reload when you're back"}</span>
        </div>
        <div class="br-game-wrap">
          <button class="br-game-toggle">🚀 Play while you wait</button>
        </div>
      `;
      errorOverlay.style.display = '';
      // Wire actions
      errorOverlay.querySelector('[data-act="retry"]').addEventListener('click', () => {
        if (lastFailedUrl) { hideErrorPage(); safeWv(() => wv.loadURL(lastFailedUrl)); }
      });
      errorOverlay.querySelector('[data-act="search"]').addEventListener('click', () => {
        const q = (lastFailedUrl || '').replace(/^https?:\/\//, '').slice(0, 200);
        safeWv(() => wv.loadURL(getSearchEngine() + encodeURIComponent(q)));
      });
      errorOverlay.querySelector('[data-act="home"]').addEventListener('click', () => {
        showNewTab();
      });
      errorOverlay.querySelector('.br-game-toggle').addEventListener('click', () => {
        openGameTab();
      });

      // Auto-reload when network comes back
      if (reconnectListener) window.removeEventListener('online', reconnectListener);
      reconnectListener = () => {
        const dot = errorOverlay.querySelector('.net-status .dot');
        const label = errorOverlay.querySelector('.net-status .net-label');
        if (dot) dot.classList.remove('off');
        if (label) label.textContent = 'Reconnected — reloading…';
        if (lastFailedUrl) {
          setTimeout(() => { hideErrorPage(); safeWv(() => wv.loadURL(lastFailedUrl)); }, 600);
        }
      };
      window.addEventListener('online', reconnectListener);
    }
    function hideErrorPage() {
      errorOverlay.style.display = 'none';
      errorOverlay.innerHTML = '';
      if (reconnectListener) { window.removeEventListener('online', reconnectListener); reconnectListener = null; }
    }
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return; // ABORTED — user-initiated, ignore
      showErrorPage(e.errorCode, e.errorDescription, e.validatedURL);
    });
    wv.addEventListener('did-start-loading', () => {
      // Hide error page when a new load begins (manual retry, back/forward, etc.)
      if (errorOverlay.style.display !== 'none') hideErrorPage();
    });
    // Open new windows / target=_blank in a new browser tab
    // 'new-window' is deprecated and unreliable in Electron 32+. Popups
    // are now caught in main via setWindowOpenHandler — see preload's
    // onPopupRequest listener which routes them to openBrowserTab.
    wv.addEventListener('new-window', (e) => {
      // Main's setWindowOpenHandler is now authoritative. We keep this
      // listener as a no-op safety net; setting return action 'deny' in
      // main should prevent this from firing in modern Electron.
      e.preventDefault?.();
    });

    // ── URL input ──
    urlInput.addEventListener('focus', () => urlInput.select());
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = (urlInput.value || '').trim();
        if (!v) return;
        if (v === NEWTAB_PSEUDO || v === 'about:newtab') {
          showNewTab();
          hideVsBanner();
        } else if (v.startsWith('view-source:')) {
          // Manual view-source URL — set banner state so the menu/banner sync up
          showVsBanner(v.slice('view-source:'.length));
          safeWv(() => wv.loadURL(v));
        } else {
          const target = normalizeUrl(v);
          if (target) {
            hideVsBanner();
            navigateInTab(target);
          }
        }
        wv.focus();
      } else if (e.key === 'Escape') {
        urlInput.value = currentUrl;
        wv.focus();
      }
    });

    // ── Site-info popover (click the lock/info icon) ──
    let siInfoEl = null;
    function closeSiteInfo() {
      if (siInfoEl) { siInfoEl.remove(); siInfoEl = null; }
      document.removeEventListener('mousedown', onSiteInfoOutside, true);
    }
    function onSiteInfoOutside(e) {
      if (siInfoEl && !siInfoEl.contains(e.target) && !secure.contains(e.target)) closeSiteInfo();
    }
    secure.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (siInfoEl) { closeSiteInfo(); return; }
      let parsed = null; try { parsed = new URL(currentUrl); } catch {}
      if (!parsed) return;
      const isHttps = parsed.protocol === 'https:';
      const isHttp  = parsed.protocol === 'http:';
      const statusKind = isHttps ? 'secure' : (isHttp ? 'insecure' : 'info');
      const statusIcon = isHttps ? I.lock : (isHttp ? I.warn : I.info);
      const statusLabel = isHttps ? 'Connection is secure' : (isHttp ? 'Not secure' : 'Internal page');
      const statusDesc = isHttps
        ? 'Information sent to this site is encrypted (TLS).'
        : isHttp
          ? 'Anyone on this network can see what you send to this site.'
          : 'A built-in browser page.';
      // Cookies (page-side document.cookie — covers all non-HttpOnly)
      let cookieCount = 0;
      try {
        const r = await execJsSafe('document.cookie ? document.cookie.split(";").filter(s=>s.trim()).length : 0');
        cookieCount = Number(r) || 0;
      } catch {}
      siInfoEl = document.createElement('div');
      siInfoEl.className = 'br-site-info';
      siInfoEl.innerHTML = `
        <div class="si-head">
          <span class="si-status ${statusKind}">${statusIcon}</span>
          <div class="si-host">
            <b>${escapeHtml(parsed.hostname)}</b>
            <span>${escapeHtml(statusLabel)}</span>
          </div>
        </div>
        <div class="si-row"><span class="k">Connection</span><span class="v">${escapeHtml(parsed.protocol.replace(':',''))}${isHttps ? ' · TLS' : ''}</span></div>
        <div class="si-row"><span class="k">Cookies</span><span class="v">${cookieCount}</span></div>
        <div class="si-row"><span class="k">Mode</span><span class="v">${incognito ? 'private' : 'persistent'}</span></div>
        <div style="padding:10px 16px;font-size:11px;color:var(--text-dim);border-top:1px solid var(--border);">${escapeHtml(statusDesc)}</div>
        <div class="si-actions">
          <button data-act="copy">Copy URL</button>
          <button data-act="clear" class="danger">Clear site cookies</button>
        </div>
      `;
      // Anchor below the secure icon
      const r = secure.getBoundingClientRect();
      siInfoEl.style.top = (r.bottom + 6) + 'px';
      siInfoEl.style.left = Math.max(8, r.left - 4) + 'px';
      document.body.appendChild(siInfoEl);
      siInfoEl.querySelector('[data-act="copy"]').addEventListener('click', () => {
        try { navigator.clipboard.writeText(currentUrl); bus.emit('toast:show', { type:'ok', message:'URL copied' }); } catch {}
        closeSiteInfo();
      });
      siInfoEl.querySelector('[data-act="clear"]').addEventListener('click', async () => {
        // Best-effort: clear document.cookie for this origin (non-HttpOnly only)
        try {
          await execJsSafe(`
            for (const c of document.cookie.split(';')) {
              const name = c.split('=')[0].trim();
              document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + location.hostname;
              document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
            }
            location.reload();
          `);
          bus.emit('toast:show', { type: 'ok', message: 'Cookies cleared for this site', source: 'Browser' });
        } catch {}
        closeSiteInfo();
      });
      setTimeout(() => document.addEventListener('mousedown', onSiteInfoOutside, true), 0);
    });
    function execJsSafe(code) {
      try { return wv.executeJavaScript(code, true); } catch { return Promise.resolve(null); }
    }

    // ── Bookmark toggle ──
    async function toggleBookmark() {
      const r = await api.browser.listBookmarks();
      const has = (r?.entries || []).some(b => b.url === currentUrl);
      if (has) {
        await api.browser.removeBookmark(currentUrl);
        bus.emit('toast:show', { type: 'ok', message: 'Bookmark removed', source: 'Browser' });
      } else {
        await api.browser.addBookmark({ url: currentUrl, title: currentTitle, faviconUrl: lastFavicon });
        bus.emit('toast:show', { type: 'ok', message: 'Bookmarked', source: 'Browser' });
      }
      paintStar();
      refreshBookmarks();
    }

    async function refreshBookmarks() {
      const r = await api.browser.listBookmarks();
      bookmarksBar.innerHTML = '';
      const list = r?.entries || [];
      if (!list.length) {
        const empty = document.createElement('span');
        empty.className = 'br-bookmark-empty';
        empty.textContent = 'No bookmarks yet — click the ★ to save the current page';
        bookmarksBar.appendChild(empty);
        return;
      }
      for (const bm of list.slice(0, 30)) {
        const b = document.createElement('button');
        b.className = 'br-bookmark';
        b.title = `${bm.title}\n${bm.url}`;
        const ico = bm.faviconUrl || favicon(bm.url);
        b.innerHTML = (ico ? `<img src="${escapeAttr(ico)}" />` : I.globe) + escapeHtml(bm.title || bm.url);
        b.addEventListener('click', () => wv.loadURL(bm.url));
        bookmarksBar.appendChild(b);
      }
    }

    // ── Menu ──
    let menuEl = null;
    function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', onDocMenuMouseDown, true); } }
    function onDocMenuMouseDown(e) { if (menuEl && !menuEl.contains(e.target) && !menuBtn.contains(e.target)) closeMenu(); }
    function toggleMenu() {
      if (menuEl) { closeMenu(); return; }
      menuEl = document.createElement('div');
      menuEl.className = 'br-menu';
      const items = [
        { label: 'New tab',         key: 'Ctrl+T', onClick: () => openBrowserTab(null) },
        { label: 'New private tab', onClick: () => openBrowserTab(null, { incognito: true }) },
        { type: 'sep' },
        { label: 'Find in page',    key: 'Ctrl+F', onClick: () => openFind() },
        { label: 'Zoom in',         key: 'Ctrl++', onClick: () => zoom(+0.1) },
        { label: 'Zoom out',        key: 'Ctrl+-', onClick: () => zoom(-0.1) },
        { label: 'Reset zoom',      key: 'Ctrl+0', onClick: () => wv.setZoomFactor(1) },
        { type: 'sep' },
        { label: 'History',         onClick: () => openHistoryTab() },
        { label: 'Downloads',       onClick: () => openDownloadsTab() },
        { type: 'sep' },
        { label: 'Open in system browser', onClick: () => api.browser.openExternal(currentUrl) },
        { label: 'Copy URL',        onClick: () => { try { navigator.clipboard.writeText(currentUrl); bus.emit('toast:show', { type:'ok', message: 'URL copied' }); } catch {} } },
        { label: 'Save page as PDF', onClick: async () => {
          const wcId = wv.getWebContentsId();
          const r = await api.browser.printToPdf(wcId, (currentTitle || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80));
          if (r?.ok && !r.cancelled) {
            window.PiPilot?.notifications?.show({
              severity: 'info', message: 'Saved page as PDF', source: 'Browser', sticky: true,
              actions: [ { label: 'Show in folder', primary: true, onClick: () => api.browser.revealFile(r.savePath) }, { label: 'Dismiss', onClick: () => {} } ],
            });
          } else if (r?.error) bus.emit('toast:show', { type: 'error', message: 'Print failed: ' + r.error, source: 'Browser' });
        } },
        { label: 'Save link target as…', onClick: () => bus.emit('toast:show', { type: 'info', message: 'Tip: Shift+click any link to save it', source: 'Browser' }) },
        { label: viewSourceOf ? 'Hide page source' : 'View page source',
          onClick: () => {
            if (viewSourceOf) {
              const target = viewSourceOf;
              hideVsBanner();
              safeWv(() => wv.loadURL(target));
            } else {
              const target = currentUrl;
              showVsBanner(target);
              safeWv(() => wv.loadURL('view-source:' + target));
            }
          } },
        { type: 'sep' },
        { label: 'Toggle DevTools', key: 'F12', onClick: () => { try { wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools(); } catch {} } },
        { label: 'Set as home',     onClick: () => { try { localStorage.setItem('pipilot.browser.home', currentUrl); bus.emit('toast:show', { type: 'ok', message: 'Home page saved' }); } catch {} } },
        { type: 'sep' },
        { label: '🚀 Stellar Shooter', onClick: () => openGameTab() },
        { label: 'Settings',        onClick: () => openSettingsTab() },
      ];
      for (const it of items) {
        if (it.type === 'sep') { const s = document.createElement('div'); s.className = 'br-menu-sep'; menuEl.appendChild(s); continue; }
        const b = document.createElement('button');
        b.className = 'br-menu-item';
        b.innerHTML = `<span>${escapeHtml(it.label)}</span>${it.key ? `<span class="br-key">${escapeHtml(it.key)}</span>` : ''}`;
        b.addEventListener('click', () => { closeMenu(); it.onClick(); });
        menuEl.appendChild(b);
      }
      root.appendChild(menuEl);
      setTimeout(() => document.addEventListener('mousedown', onDocMenuMouseDown, true), 0);
    }

    function zoom(delta) {
      try {
        const cur = wv.getZoomFactor();
        wv.setZoomFactor(Math.max(0.25, Math.min(3, cur + delta)));
      } catch {}
    }

    // ── Keyboard shortcuts (scoped to the tab) ──
    container.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); }
      else if (ctrl && e.key.toLowerCase() === 't') { e.preventDefault(); openBrowserTab(null); }
      else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleBookmark(); }
      else if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
      else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoom(+0.1); }
      else if (ctrl && e.key === '-') { e.preventDefault(); zoom(-0.1); }
      else if (ctrl && e.key === '0') { e.preventDefault(); try { wv.setZoomFactor(1); } catch {} }
      else if (e.key === 'F5') { e.preventDefault(); wv.reload(); }
      else if (e.key === 'F12') { e.preventDefault(); try { wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools(); } catch {} }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); safeWv(() => { if (wv.canGoBack()) wv.goBack(); }); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); safeWv(() => { if (wv.canGoForward()) wv.goForward(); }); }
    });

    paintUrl(startUrl);

    // Register this tab so AI control tools can address it.
    registerTab(tabId, {
      wv, stage,
      mode: incognito ? 'inc' : 'std',
      get url() { return currentUrl; },
      get title() { return currentTitle; },
      get domReady() { return domReady; },
      get consoleLog() { return consoleLog; },
      get isLoading() { return isLoading; },
      loadURL: (u) => safeWv(() => wv.loadURL(u)),
      reload: () => safeWv(() => wv.reload()),
      goBack: () => safeWv(() => { if (wv.canGoBack()) wv.goBack(); }),
      goForward: () => safeWv(() => { if (wv.canGoForward()) wv.goForward(); }),
    });
    // Best-effort: deregister when the editor unmounts the tab. The host
    // calls `doc.unmount()` on close, but virtual tabs in this codebase
    // don't reliably wire it; rely on a MutationObserver on the container.
    const obs = new MutationObserver(() => {
      if (!container.isConnected) {
        unregisterTab(tabId);
        try { obs.disconnect(); } catch {}
      }
    });
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch {}
  }

  // ── History tab ─────────────────────────────────────────────────
  // Render a "← Back to browser" top bar onto a virtual tab. Closes the
  // current tab and either focuses an existing browser tab or opens a new
  // one (the new-tab page).
  function renderInternalTopBar(currentTabId, label) {
    return `
      <div class="br-internal-topbar">
        <button class="br-internal-back" type="button" data-internal-back>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to browser
        </button>
        <span class="br-internal-title">${escapeHtml(label || '')}</span>
      </div>
    `;
  }
  function wireInternalTopBar(container, currentTabId) {
    const btn = container.querySelector('[data-internal-back]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // Find any existing browser tab; if none, open a new one
      const tabs = Array.from(tabRegistry.entries());
      try { window.PiPilot.editor.closeFile?.(currentTabId); } catch {}
      if (tabs.length) {
        const [firstId] = tabs[0];
        try { window.PiPilot.editor.openFile?.(firstId); } catch {
          window.PiPilot?.browser?.open?.();
        }
      } else {
        openBrowserTab(null);
      }
    });
  }

  function openHistoryTab() {
    ensureStyles();
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return;
    const tabId = 'browser-history://';
    editor.openVirtualTab({
      id: tabId,
      name: 'Browser History',
      mount: async (container) => {
        container.style.cssText = 'overflow:auto;height:100%;background:var(--bg);color:var(--text);';
        container.innerHTML = `
          ${renderInternalTopBar(tabId, 'History')}
          <div class="br-list-page">
            <h2>History</h2>
            <div class="br-list-toolbar">
              <input id="hist-search" type="text" placeholder="Filter history…" />
              <button id="hist-clear">Clear all history</button>
            </div>
            <div id="hist-rows"></div>
          </div>
        `;
        wireInternalTopBar(container, tabId);
        const rows = container.querySelector('#hist-rows');
        const search = container.querySelector('#hist-search');
        async function paint() {
          const r = await api.browser.listHistory({ query: search.value, limit: 500 });
          rows.innerHTML = '';
          const list = r?.entries || [];
          if (!list.length) { rows.innerHTML = '<div class="br-list-empty">Nothing here yet.</div>'; return; }
          for (const e of list) {
            const row = document.createElement('div');
            row.className = 'br-list-row';
            const ico = e.faviconUrl || favicon(e.url);
            row.innerHTML = `
              ${ico ? `<img src="${escapeAttr(ico)}" />` : `<span style="width:16px;color:var(--text-dim)">${I.globe}</span>`}
              <span class="br-list-title">${escapeHtml(e.title || e.url)}</span>
              <span class="br-list-url">${escapeHtml(e.url)}</span>
              <span class="br-list-meta">${escapeHtml(relTime(e.ts))}</span>
            `;
            row.addEventListener('click', () => openBrowserTab(e.url));
            rows.appendChild(row);
          }
        }
        let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(paint, 150); });
        container.querySelector('#hist-clear').addEventListener('click', async () => {
          if (!confirm('Clear all browser history? This cannot be undone.')) return;
          await api.browser.clearHistory();
          paint();
        });
        paint();
      },
    });
  }

  // ── Downloads tab ───────────────────────────────────────────────
  // In-memory list of all downloads observed since renderer load. Persists
  // across tabs but not app restarts (download files themselves persist).
  const downloads = []; // { id, fileName, url, savePath, totalBytes, received, state, ts }
  let downloadsTabContainer = null;
  api.browser.onDownload((evt) => {
    if (!evt) return;
    const existing = downloads.find(d => d.id === evt.id);
    if (evt.kind === 'start') {
      const entry = { id: evt.id, fileName: evt.fileName, url: evt.url, savePath: evt.savePath, totalBytes: evt.totalBytes, received: 0, state: 'progressing', ts: Date.now() };
      downloads.unshift(entry);
      bus.emit('toast:show', { type: 'info', message: `Downloading ${entry.fileName}`, source: 'Browser' });
    } else if (existing) {
      if (evt.kind === 'progress') { existing.received = evt.received; existing.totalBytes = evt.totalBytes; existing.state = 'progressing'; }
      else if (evt.kind === 'done') {
        existing.state = evt.state || 'completed';
        existing.savePath = evt.savePath || existing.savePath;
        if (existing.state === 'completed') {
          window.PiPilot?.notifications?.show({
            severity: 'info',
            message: `Downloaded ${existing.fileName}`,
            source: 'Browser',
            sticky: true,
            actions: [
              { label: 'Show in folder', primary: true, onClick: () => api.browser.revealFile(existing.savePath) },
              { label: 'Dismiss', onClick: () => {} },
            ],
          });
        } else if (existing.state === 'cancelled') {
          bus.emit('toast:show', { type: 'warn', message: `Cancelled ${existing.fileName}`, source: 'Browser' });
        } else {
          bus.emit('toast:show', { type: 'error', message: `Download failed: ${existing.fileName}`, source: 'Browser' });
        }
      }
    }
    if (downloadsTabContainer) renderDownloadsList(downloadsTabContainer);
  });

  function fmtBytes(n) {
    if (!n || n < 0) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function renderDownloadsList(container) {
    const rows = container.querySelector('#dl-rows');
    if (!rows) return;
    rows.innerHTML = '';
    if (!downloads.length) { rows.innerHTML = '<div class="br-list-empty">No downloads yet.</div>'; return; }
    for (const d of downloads) {
      const row = document.createElement('div');
      row.className = 'br-list-row';
      const pct = d.totalBytes ? Math.round((d.received / d.totalBytes) * 100) : 0;
      const status = d.state === 'completed' ? `${fmtBytes(d.totalBytes || d.received)} · saved`
                  : d.state === 'cancelled' ? 'cancelled'
                  : d.state === 'interrupted' ? 'interrupted'
                  : `${fmtBytes(d.received)} / ${fmtBytes(d.totalBytes)} · ${pct}%`;
      row.innerHTML = `
        <span style="width:16px;color:var(--text-dim)">${I.globe}</span>
        <span class="br-list-title">${escapeHtml(d.fileName)}</span>
        <span class="br-list-url">${escapeHtml(d.url)}</span>
        <span class="br-list-meta">${escapeHtml(status)}</span>
      `;
      row.addEventListener('click', () => {
        if (d.state === 'completed') api.browser.revealFile(d.savePath);
      });
      rows.appendChild(row);
    }
  }

  function openDownloadsTab() {
    ensureStyles();
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return;
    const tabId = 'browser-downloads://';
    editor.openVirtualTab({
      id: tabId,
      name: 'Downloads',
      mount: (container) => {
        container.style.cssText = 'overflow:auto;height:100%;background:var(--bg);color:var(--text);';
        container.innerHTML = `
          ${renderInternalTopBar(tabId, 'Downloads')}
          <div class="br-list-page">
            <h2>Downloads</h2>
            <div class="br-list-toolbar">
              <span style="flex:1;color:var(--text-dim);font-size:12px;">Files saved to your Downloads folder.</span>
              <button id="dl-clear">Clear list</button>
            </div>
            <div id="dl-rows"></div>
          </div>
        `;
        wireInternalTopBar(container, tabId);
        downloadsTabContainer = container;
        renderDownloadsList(container);
        container.querySelector('#dl-clear').addEventListener('click', () => {
          downloads.length = 0;
          renderDownloadsList(container);
        });
      },
    });
  }

  // ── Settings tab ────────────────────────────────────────────────
  const SETTINGS_TAB_ID = 'browser-settings://';
  function openSettingsTab() {
    ensureStyles();
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return;
    editor.openVirtualTab({
      id: SETTINGS_TAB_ID,
      name: 'Browser Settings',
      mount: (container) => {
        container.style.cssText = 'overflow:auto;height:100%;background:var(--bg);color:var(--text);';
        const home = localStorage.getItem('pipilot.browser.home') || HOME_URL;
        const search = localStorage.getItem('pipilot.browser.search') || 'google';
        container.innerHTML = `
          ${renderInternalTopBar(SETTINGS_TAB_ID, 'Settings')}
          <div class="br-settings">
            <h1>Browser Settings</h1>
            <p class="lead">Tune the in-app browser. Changes save instantly.</p>

            <section>
              <h2>General</h2>
              <div class="row">
                <div class="label">Home page<small>Shown when you open a new tab without a URL.</small></div>
                <input type="text" id="set-home" value="${escapeHtml(home)}" placeholder="https://www.google.com or about:newtab"/>
              </div>
              <div class="row">
                <div class="label">Search engine<small>Used when the address bar contains a query, not a URL.</small></div>
                <select id="set-search">
                  <option value="google">Google</option>
                  <option value="duckduckgo">DuckDuckGo</option>
                  <option value="bing">Bing</option>
                  <option value="brave">Brave Search</option>
                </select>
              </div>
            </section>

            <section>
              <h2>New Tab Page</h2>
              <div class="row">
                <div class="label">Open New Tab page<small>Show the shortcut grid + search box when opening a tab without a URL. Otherwise the home page above is used.</small></div>
                <select id="set-newtab">
                  <option value="1">On</option>
                  <option value="0">Off (use home page)</option>
                </select>
              </div>
            </section>

            <section>
              <h2>Privacy</h2>
              <div class="row">
                <div class="label">Browsing history<small>URLs you've visited in this browser.</small></div>
                <button class="action danger" id="clear-history">Clear all history</button>
              </div>
              <div class="row">
                <div class="label">Cookies &amp; site data<small>Wipes the persistent browser session — you'll be signed out of every site.</small></div>
                <button class="action danger" id="clear-cookies">Clear cookies + cache</button>
              </div>
              <div class="row">
                <div class="label">Bookmarks<small>Saved with the ★ button on the toolbar.</small></div>
                <button class="action" id="open-bookmarks">Manage bookmarks…</button>
              </div>
            </section>

            <section>
              <h2>About</h2>
              <div class="row">
                <div class="label">Storage location<small>Where bookmarks, history, and the persistent session live.</small></div>
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);">&lt;userData&gt;/browser/</span>
              </div>
              <div class="row">
                <div class="label">Downloads folder<small>Files saved by the browser.</small></div>
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);">&lt;Downloads&gt;/PiPilot/</span>
              </div>
            </section>
          </div>
        `;
        wireInternalTopBar(container, SETTINGS_TAB_ID);

        const setHome = container.querySelector('#set-home');
        const setSearch = container.querySelector('#set-search');
        const setNewtab = container.querySelector('#set-newtab');
        setSearch.value = search;
        setNewtab.value = localStorage.getItem('pipilot.browser.newtab') || '1';
        const persist = (key, val) => { try { localStorage.setItem(key, val); } catch {} bus.emit('toast:show', { type: 'ok', message: 'Saved', source: 'Browser' }); };
        setHome.addEventListener('change', () => persist('pipilot.browser.home', setHome.value.trim()));
        setSearch.addEventListener('change', () => persist('pipilot.browser.search', setSearch.value));
        setNewtab.addEventListener('change', () => persist('pipilot.browser.newtab', setNewtab.value));

        container.querySelector('#clear-history').addEventListener('click', async () => {
          if (!confirm('Clear all browser history? Cannot be undone.')) return;
          await api.browser.clearHistory();
          bus.emit('toast:show', { type: 'ok', message: 'History cleared', source: 'Browser' });
        });
        container.querySelector('#clear-cookies').addEventListener('click', async () => {
          if (!confirm('Clear cookies + cache? You will be signed out of every site.')) return;
          await api.browser.clearData(false);
          bus.emit('toast:show', { type: 'ok', message: 'Cookies + cache cleared', source: 'Browser' });
        });
        container.querySelector('#open-bookmarks').addEventListener('click', () => {
          // Just open the new-tab page where bookmarks bar is visible — easiest UX
          openBrowserTab(null);
        });
      },
    });
  }

  // ── New Tab page ────────────────────────────────────────────────
  const NEWTAB_PSEUDO = 'about:newtab';
  function loadShortcuts() {
    try {
      const raw = localStorage.getItem('pipilot.browser.shortcuts');
      if (raw) return JSON.parse(raw);
    } catch {}
    // Sensible defaults the first time
    return [
      { name: 'Google',  url: 'https://www.google.com' },
      { name: 'YouTube', url: 'https://www.youtube.com' },
      { name: 'GitHub',  url: 'https://github.com' },
    ];
  }
  function saveShortcuts(list) {
    try { localStorage.setItem('pipilot.browser.shortcuts', JSON.stringify(list.slice(0, 8))); } catch {}
  }
  function isNewTabUrl(url) {
    return !url || url === NEWTAB_PSEUDO || url === 'about:blank';
  }
  function shortcutsEnabled() {
    return localStorage.getItem('pipilot.browser.newtab') !== '0';
  }

  function renderNewTabInto(stage, navigate) {
    const shortcuts = loadShortcuts();
    const cards = shortcuts.map((s, i) => `
      <button class="br-newtab-shortcut" data-idx="${i}" data-url="${escapeAttr(s.url)}">
        <span class="icon">
          ${favicon(s.url) ? `<img src="${escapeAttr(favicon(s.url))}" alt="" />` : escapeHtml((s.name || '?').slice(0, 1).toUpperCase())}
        </span>
        <span class="name">${escapeHtml(s.name || s.url)}</span>
        <span class="remove" data-remove="${i}" title="Remove">×</span>
      </button>
    `).join('');
    const addBtn = shortcuts.length < 8
      ? `<button class="br-newtab-shortcut add" data-add>
           <span class="icon">+</span><span class="name">Add shortcut</span>
         </button>`
      : '';
    // Live tab count for the globe badge
    const tabCount = (window.PiPilot?.browser?.listOpenTabs?.() || []).length || 1;
    stage.innerHTML = `
      <div class="br-newtab">
        <div class="br-newtab-hero">
          <div class="br-newtab-logo-wrap">
            <div class="br-newtab-logo"><div class="br-newtab-logo-inner"><span>P</span></div></div>
            <div class="br-newtab-globe" data-count="${tabCount}" title="${tabCount} tab${tabCount === 1 ? '' : 's'} open">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
          </div>
          <h1 class="br-newtab-title">PiPilot <span class="accent">Web</span></h1>
          <p class="br-newtab-tagline">Browse · Search · Build</p>
          <div class="br-newtab-clock" id="newtab-clock" aria-live="off">
            <div class="time"><span class="hm">--:--</span><span class="sec">--</span></div>
            <div class="date">Loading…</div>
          </div>
        </div>
        <div class="br-newtab-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="newtab-input" placeholder="Search the web or paste a URL…" autofocus />
          <button id="newtab-go">Go</button>
        </div>
        <div class="br-newtab-shortcuts">
          ${cards}
          ${addBtn}
        </div>
      </div>
    `;
    const input = stage.querySelector('#newtab-input');
    const go = () => { const v = input.value.trim(); if (v) navigate(v); };
    stage.querySelector('#newtab-go').addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => input.focus(), 80);
    stage.querySelectorAll('.br-newtab-shortcut[data-url]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove]')) return;
        navigate(el.dataset.url);
      });
    });
    stage.querySelectorAll('[data-remove]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.remove, 10);
        const list = loadShortcuts();
        list.splice(idx, 1);
        saveShortcuts(list);
        renderNewTabInto(stage, navigate);
      });
    });
    const add = stage.querySelector('[data-add]');
    if (add) add.addEventListener('click', async () => {
      const name = await window.PiPilot.modal.prompt({ title: 'Add Shortcut', label: 'Name', placeholder: 'Google', confirmText: 'Next' });
      if (!name) return;
      const url = await window.PiPilot.modal.prompt({ title: 'Add Shortcut', label: `URL for "${name}"`, placeholder: 'https://example.com', confirmText: 'Add' });
      if (!url) return;
      const list = loadShortcuts();
      list.push({ name: name.trim(), url: url.trim() });
      saveShortcuts(list);
      renderNewTabInto(stage, navigate);
    });

    // ── Live clock ──
    // Updates the time every second and the date every minute. The
    // interval is cleaned up via MutationObserver when the new-tab
    // overlay is hidden (re-render replaces the node, observer fires).
    const clockEl = stage.querySelector('#newtab-clock');
    if (clockEl) {
      const hmEl  = clockEl.querySelector('.hm');
      const secEl = clockEl.querySelector('.sec');
      const dateEl = clockEl.querySelector('.date');
      let lastDateStr = '';
      const pad = (n) => String(n).padStart(2, '0');
      const tick = () => {
        const d = new Date();
        const h = d.getHours();
        const m = d.getMinutes();
        const s = d.getSeconds();
        // Use 12-hour or 24-hour based on locale
        const use12 = new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12;
        if (use12) {
          const hh = ((h % 12) || 12);
          hmEl.textContent = pad(hh) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM');
        } else {
          hmEl.textContent = pad(h) + ':' + pad(m);
        }
        secEl.textContent = ':' + pad(s);
        const dateStr = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        if (dateStr !== lastDateStr) { dateEl.textContent = dateStr; lastDateStr = dateStr; }
      };
      tick();
      const tid = setInterval(tick, 1000);
      // Stop ticking once the clock node leaves the DOM (overlay hidden / re-rendered)
      const obs = new MutationObserver(() => {
        if (!clockEl.isConnected) { clearInterval(tid); obs.disconnect(); }
      });
      try { obs.observe(stage, { childList: true, subtree: true }); } catch { obs.observe(document.body, { childList: true, subtree: true }); }
    }
  }

  // ── AI control bridge ──────────────────────────────────────────
  // Main sends `browser:control:request { id, op, args }`. We dispatch
  // to the matching op handler and post the result back via
  // ipcRenderer.send('browser:control:response', { id, ok, result, error }).
  function waitDomReady(entry, timeoutMs = 10000) {
    if (entry.domReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        if (entry.domReady) { clearInterval(t); resolve(); return; }
        if (Date.now() - start > timeoutMs) { clearInterval(t); reject(new Error('dom-ready timeout')); }
      }, 60);
    });
  }
  async function execJs(entry, code) {
    await waitDomReady(entry);
    return await entry.wv.executeJavaScript(code, true);
  }
  function jsLit(s) {
    return JSON.stringify(String(s ?? ''));
  }

  // Inject a small library of helpers into the page once per tab. We
  // namespace under window.__pipilot to avoid collisions.
  // String.raw so any escape sequence inside (\n, \s, \", etc.) survives
  // into the page-side source verbatim. With a plain template literal,
  // \n would be turned into a real newline before reaching the page,
  // breaking string literals like "lines.join('\n')".
  const HELPER_JS = String.raw`
    (function () {
      if (window.__pipilot) return;
      const pp = window.__pipilot = {};

      // Smart selector resolver — supports:
      //   * pure CSS:  "button.submit", "#search", "a[href*='login']"
      //   * ref:       "[ref=e62]" → translated to [data-pp-ref="e62"]
      //   * text:      'text="Login"'           (exact-or-contains, case sensitive)
      //                "text=Login"
      //                "text=/log.?in/i"        (regex form)
      //   * has-text:  'a:has-text("Sign in")'  (CSS prefix + contains-text filter)
      //   * role:      'role=button[name="Submit"]'  (ARIA role + accessible name)
      // Returns the first match, or null.
      // ── Element scoring & helpers ───────────────────────────────────
      // Every candidate gets a score; we return the highest. Scoring:
      //   +1000  in viewport
      //   +500   visible (display + opacity + size)
      //   +400   interactive role (button/link/input/[role=button|tab|menuitem])
      //   +300   has cursor:pointer
      //   +200   exact text match
      //   +100   contains text match
      //   +N     (smaller is better)  inverse of bounding-box area  → prefers specific element over wrapper
      //   -2000  hidden / display:none / 0×0
      //   -500   covered by another element at its center
      //   -300   inside aria-hidden / inert subtree
      pp._isVisible = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (!el.getBoundingClientRect) return false;
        const cs = getComputedStyle(el);
        if (!cs) return false;
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (parseFloat(cs.opacity || '1') === 0) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        return true;
      };
      pp._isInViewport = (el) => {
        const r = el.getBoundingClientRect();
        const vh = innerHeight || document.documentElement.clientHeight;
        const vw = innerWidth || document.documentElement.clientWidth;
        return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      };
      pp._isInert = (el) => {
        for (let cur = el; cur; cur = cur.parentElement) {
          if (cur.hasAttribute && (cur.hasAttribute('inert') || cur.getAttribute('aria-hidden') === 'true')) return true;
        }
        return false;
      };
      pp._isInteractive = (el) => {
        const tag = (el.tagName || '').toLowerCase();
        if (['a', 'button', 'input', 'select', 'textarea', 'option', 'summary'].includes(tag)) return true;
        const role = el.getAttribute && el.getAttribute('role');
        if (['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch'].includes(role)) return true;
        const cs = getComputedStyle(el);
        if (cs && cs.cursor === 'pointer') return true;
        if (el.onclick || (el.hasAttribute && el.hasAttribute('onclick'))) return true;
        if (el.tabIndex >= 0) return true;
        return false;
      };
      pp._isCovered = (el) => {
        try {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const cx = Math.min(Math.max(0, r.left + r.width / 2), innerWidth - 1);
          const cy = Math.min(Math.max(0, r.top + r.height / 2), innerHeight - 1);
          const top = document.elementFromPoint(cx, cy);
          if (!top) return false;
          if (top === el || el.contains(top) || top.contains(el)) return false;
          return true;
        } catch { return false; }
      };
      pp._scoreElement = (el, opts) => {
        opts = opts || {};
        let s = 0;
        if (!pp._isVisible(el)) return -2000;
        if (pp._isInert(el)) s -= 300;
        if (pp._isInteractive(el)) s += 400;
        if (pp._isInViewport(el)) s += 1000;
        s += 500; // visible base
        if (pp._isCovered(el)) s -= 500;
        const r = el.getBoundingClientRect();
        const area = Math.max(r.width * r.height, 1);
        // Specificity: prefer smaller (more specific) elements over giant wrappers.
        s += Math.max(0, 200 - Math.log10(area) * 30);
        // Text-match boosts
        if (opts.text) {
          const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt === opts.text) s += 200;
          else if (txt.toLowerCase() === opts.text.toLowerCase()) s += 180;
          else if (txt.includes(opts.text)) s += 100;
          else if (txt.toLowerCase().includes(opts.text.toLowerCase())) s += 80;
        }
        return s;
      };
      pp._best = (candidates, opts) => {
        let best = null, bestScore = -Infinity;
        for (const c of candidates) {
          const s = pp._scoreElement(c, opts);
          if (s > bestScore) { bestScore = s; best = c; }
        }
        return best;
      };

      // Smart selector resolver
      pp.find = (sel) => {
        if (!sel) return null;
        sel = String(sel).trim();
        // Ref alias: [ref=eN] → CSS [data-pp-ref="eN"]
        sel = sel.replace(/\[ref=([^\]"' ]+)\]/g, '[data-pp-ref="$1"]');
        // text=
        if (sel.startsWith('text=')) {
          const v = sel.slice(5).trim();
          // Restrict to interactive-leaning tags first; broaden if no hits.
          const targetTags = 'a,button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],label';
          const broadTags  = 'a,button,input,select,textarea,h1,h2,h3,h4,h5,h6,p,span,div,li,td,th,label,strong,em,small,figcaption,summary,[role]';
          let isRegex = false, re = null, txt = '';
          if (v.startsWith('/') && v.lastIndexOf('/') > 0) {
            const last = v.lastIndexOf('/');
            try { re = new RegExp(v.slice(1, last), v.slice(last + 1)); isRegex = true; } catch { return null; }
          } else {
            txt = v.replace(/^["']|["']$/g, '');
          }
          const matchTextOf = (el) => {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) return false;
            if (isRegex) return re.test(t);
            return t === txt || t.includes(txt) || t.toLowerCase().includes(txt.toLowerCase());
          };
          const collect = (selector) => {
            const out = [];
            for (const el of document.querySelectorAll(selector)) {
              if (matchTextOf(el)) out.push(el);
            }
            return out;
          };
          let candidates = collect(targetTags);
          if (!candidates.length) candidates = collect(broadTags);
          // For interactive elements, also include the closest clickable ancestor —
          // helpful when the visible text is on a <span> inside an <a>.
          const expanded = new Set(candidates);
          for (const el of candidates) {
            const a = el.closest('a, button, [role=button], [role=link], [onclick]');
            if (a) expanded.add(a);
          }
          return pp._best(Array.from(expanded), { text: txt || '' });
        }
        // role=button[name="Submit"]
        if (sel.startsWith('role=')) {
          const m = sel.slice(5).match(/^([\w-]+)(?:\[name=(?:["']([^"']*)["']|([^\]]+))\])?$/);
          if (!m) return null;
          const role = m[1];
          const wantName = (m[2] || m[3] || '').toLowerCase();
          const extra = role === 'button' ? ', input[type=submit], input[type=button]' : '';
          const candidates = Array.from(document.querySelectorAll('[role="' + role + '"], ' + role + extra));
          if (!wantName) return pp._best(candidates, {});
          const matched = candidates.filter(el => {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            return aria === wantName || txt === wantName || aria.includes(wantName) || txt.includes(wantName);
          });
          return pp._best(matched, { text: wantName });
        }
        // CSS with :has-text("foo") filter
        const hasText = sel.match(/^(.*?):has-text\(\s*(?:["']([^"']*)["']|\/([^/]+)\/(\w*))\s*\)\s*(.*)$/);
        if (hasText) {
          const base = (hasText[1] || '*').trim();
          const literal = hasText[2];
          const rePat = hasText[3];
          const reFlags = hasText[4] || '';
          const tail = (hasText[5] || '').trim();
          let pred;
          if (literal != null) pred = (t) => t.includes(literal);
          else { try { const re = new RegExp(rePat, reFlags); pred = (t) => re.test(t); } catch { return null; } }
          const candidates = [];
          for (const c of document.querySelectorAll(base)) {
            if (pred((c.textContent || '').trim())) candidates.push(tail ? c.querySelector(tail) : c);
          }
          return pp._best(candidates.filter(Boolean), { text: literal || '' });
        }
        // Plain CSS — query all, score, pick best (handles ambiguous selectors)
        try {
          const all = Array.from(document.querySelectorAll(sel));
          if (all.length === 0) return null;
          if (all.length === 1) return all[0];
          return pp._best(all, {});
        } catch { return null; }
      };
      pp.q = (sel) => pp.find(sel);
      pp.qs = (sel) => {
        try { return Array.from(document.querySelectorAll(sel)); } catch { return []; }
      };
      // Full pointer/mouse sequence at element center, with overlay detection.
      // Most SPAs (React, Vue, Svelte) listen for pointerdown/mousedown/
      // pointerup/mouseup in addition to click; some only respond to
      // pointerdown. el.click() alone misses these. We also use
      // elementFromPoint to detect when an overlay is over the target —
      // dispatching events on the visible top element is what a real user
      // would do.
      pp._pointerSeq = (target, x, y) => {
        const opts = { bubbles: true, cancelable: true, composed: true,
                       clientX: x, clientY: y, button: 0, buttons: 1,
                       pointerId: 1, pointerType: 'mouse', isPrimary: true };
        try { target.dispatchEvent(new PointerEvent('pointerover', opts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('mouseover', opts)); } catch {}
        try { target.dispatchEvent(new PointerEvent('pointerenter', opts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('mouseenter', opts)); } catch {}
        try { target.dispatchEvent(new PointerEvent('pointermove', opts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('mousemove', opts)); } catch {}
        try { target.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}
        try { target.focus && target.focus({ preventScroll: true }); } catch {}
        const upOpts = { ...opts, buttons: 0 };
        try { target.dispatchEvent(new PointerEvent('pointerup', upOpts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('mouseup', upOpts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('click', upOpts)); } catch {}
      };
      // Low-level click — dispatches the pointer/mouse sequence at coords.
      // Returns synchronously. Used as the implementation backbone for the
      // verified async click below.
      pp._performClick = (el) => {
        if (!pp._isVisible(el)) return { ok: false, error: 'element not visible' };
        try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return { ok: false, error: 'element has zero size' };
        const cx = Math.min(Math.max(0, r.left + r.width / 2), innerWidth - 1);
        const cy = Math.min(Math.max(0, r.top + r.height / 2), innerHeight - 1);
        let target = el;
        try {
          const top = document.elementFromPoint(cx, cy);
          if (top && top !== el && !el.contains(top) && !top.contains(el)) target = top;
        } catch {}
        try {
          pp._pointerSeq(target, cx, cy);
          if (target !== el) { try { el.click && el.click(); } catch {} }
          else if (el.tagName === 'A' && el.href) { try { el.click && el.click(); } catch {} }
        } catch (e) { return { ok: false, error: e.message }; }
        return { ok: true, target: target === el ? 'direct' : 'overlay-redirected', x: cx, y: cy };
      };

      // Capture the page's "fingerprint" — used to detect whether anything
      // actually changed after an action.
      pp._snapshotState = () => {
        const modals = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], dialog');
        let openModalCount = 0;
        for (const m of modals) {
          if (m.tagName === 'DIALOG' && !m.hasAttribute('open')) continue;
          if (pp._isVisible(m)) openModalCount++;
        }
        let active = document.activeElement;
        const focusRef = active && active.getAttribute && active.getAttribute('data-pp-ref') || null;
        const focusTag = active ? active.tagName : '';
        return {
          url: location.href,
          title: document.title,
          scrollY: window.scrollY,
          openModalCount,
          focusRef,
          focusTag,
          domSize: document.body ? document.body.getElementsByTagName('*').length : 0,
        };
      };
      pp._elemSig = (el) => {
        if (!el || !el.isConnected) return null;
        return [
          el.tagName,
          el.id || '',
          (el.className || '').toString(),
          (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          el.disabled ? 'disabled' : '',
          (el.getAttribute && el.getAttribute('aria-expanded')) || '',
          (el.getAttribute && el.getAttribute('aria-pressed')) || '',
          (el.getAttribute && el.getAttribute('aria-checked')) || '',
        ].join('|');
      };

      // Verified click — async. Snapshots state before/after, watches DOM
      // mutations during the settle window, and returns a confidence
      // signal so the agent can detect "click did nothing" reliably.
      pp.clickAndVerify = async (sel, opts) => {
        opts = opts || {};
        const settleMs = Math.max(150, Math.min(2000, opts.settleMs || 350));
        const el = pp.find(sel);
        if (!el) return { ok: false, error: 'not found: ' + sel };

        const before = pp._snapshotState();
        const sigBefore = pp._elemSig(el);
        const elBefore = el;

        // Mutation counter for the settle window
        let mutCount = 0;
        let mutDetail = { childList: 0, attributes: 0, characterData: 0 };
        let observer = null;
        try {
          observer = new MutationObserver((records) => {
            mutCount += records.length;
            for (const r of records) {
              if (mutDetail[r.type] != null) mutDetail[r.type] += 1;
            }
          });
          observer.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, characterData: true,
            attributeOldValue: false, characterDataOldValue: false,
          });
        } catch {}

        const clickRes = pp._performClick(el);
        if (!clickRes.ok) {
          if (observer) try { observer.disconnect(); } catch {}
          return clickRes;
        }

        // Wait for the DOM to settle
        await new Promise(r => setTimeout(r, settleMs));
        if (observer) try { observer.disconnect(); } catch {}

        const after = pp._snapshotState();
        const sigAfter = pp._elemSig(elBefore);
        const targetGone = !elBefore.isConnected;
        const targetMutated = !targetGone && sigBefore !== sigAfter;
        const verified = {
          urlChanged: before.url !== after.url,
          titleChanged: before.title !== after.title,
          scrollChanged: Math.abs(before.scrollY - after.scrollY) > 5,
          modalAppeared: after.openModalCount > before.openModalCount,
          modalDismissed: after.openModalCount < before.openModalCount,
          modalCountDelta: after.openModalCount - before.openModalCount,
          targetGone,
          targetMutated,
          domSizeDelta: after.domSize - before.domSize,
          domMutationCount: mutCount,
          mutationsByType: mutDetail,
          focusChanged: before.focusRef !== after.focusRef || before.focusTag !== after.focusTag,
          beforeUrl: before.url,
          afterUrl: after.url,
        };
        // Confidence heuristics
        let confidence = 'no-change';
        if (verified.urlChanged || verified.modalAppeared || verified.modalDismissed || targetGone) {
          confidence = 'high';
        } else if (mutCount > 8 || verified.titleChanged || (verified.focusChanged && targetMutated)) {
          confidence = 'medium';
        } else if (mutCount > 0 || verified.scrollChanged || verified.focusChanged || targetMutated) {
          confidence = 'low';
        }
        return { ...clickRes, verified, confidence };
      };

      // Synchronous click (legacy / simple callers). Doesn't verify.
      pp.click = (sel) => {
        const el = pp.find(sel);
        if (!el) return { ok: false, error: 'not found: ' + sel };
        return pp._performClick(el);
      };
      pp.fill = (sel, value) => {
        const el = pp.q(sel);
        if (!el) return { ok: false, error: 'not found: ' + sel };
        el.focus();
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(window[tag === 'INPUT' ? 'HTMLInputElement' : 'HTMLTextAreaElement'].prototype, 'value').set;
          setter.call(el, String(value));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.isContentEditable) {
          el.textContent = String(value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          return { ok: false, error: 'not an input/textarea/contentEditable: ' + sel };
        }
        return { ok: true };
      };
      // Key→code/keyCode map. Many sites listen for e.code or e.keyCode,
      // not e.key — without these, Enter never submits, ArrowDown never
      // moves selection in a combobox, etc.
      pp._keyMap = {
        Enter:      { code: 'Enter',      keyCode: 13,  key: 'Enter' },
        Tab:        { code: 'Tab',        keyCode: 9,   key: 'Tab' },
        Escape:     { code: 'Escape',     keyCode: 27,  key: 'Escape' },
        Esc:        { code: 'Escape',     keyCode: 27,  key: 'Escape' },
        Backspace:  { code: 'Backspace',  keyCode: 8,   key: 'Backspace' },
        Delete:     { code: 'Delete',     keyCode: 46,  key: 'Delete' },
        Space:      { code: 'Space',      keyCode: 32,  key: ' ' },
        ' ':        { code: 'Space',      keyCode: 32,  key: ' ' },
        ArrowUp:    { code: 'ArrowUp',    keyCode: 38,  key: 'ArrowUp' },
        ArrowDown:  { code: 'ArrowDown',  keyCode: 40,  key: 'ArrowDown' },
        ArrowLeft:  { code: 'ArrowLeft',  keyCode: 37,  key: 'ArrowLeft' },
        ArrowRight: { code: 'ArrowRight', keyCode: 39,  key: 'ArrowRight' },
        Home:       { code: 'Home',       keyCode: 36,  key: 'Home' },
        End:        { code: 'End',        keyCode: 35,  key: 'End' },
        PageUp:     { code: 'PageUp',     keyCode: 33,  key: 'PageUp' },
        PageDown:   { code: 'PageDown',   keyCode: 34,  key: 'PageDown' },
      };
      pp._keyInfo = (k) => {
        if (pp._keyMap[k]) return pp._keyMap[k];
        if (/^F([1-9]|1[0-2])$/.test(k)) {
          const n = parseInt(k.slice(1), 10);
          return { code: k, keyCode: 111 + n, key: k };
        }
        if (k.length === 1) {
          const upper = k.toUpperCase();
          const isLetter = /[A-Z]/.test(upper);
          const isDigit  = /[0-9]/.test(upper);
          if (isLetter) return { code: 'Key' + upper, keyCode: upper.charCodeAt(0), key: k };
          if (isDigit)  return { code: 'Digit' + upper, keyCode: upper.charCodeAt(0), key: k };
        }
        return { code: k, keyCode: 0, key: k };
      };
      pp.press = (key) => {
        // Chords: "Ctrl+A", "Shift+Enter", "Alt+ArrowDown", "Cmd+K"
        const parts = String(key).split('+').map(s => s.trim());
        const last = parts.pop();
        const mods = new Set(parts.map(p => p.toLowerCase()));
        const info = pp._keyInfo(last);
        const opts = {
          bubbles: true, cancelable: true, composed: true,
          key: info.key, code: info.code, keyCode: info.keyCode, which: info.keyCode,
          ctrlKey: mods.has('ctrl') || mods.has('control'),
          shiftKey: mods.has('shift'),
          altKey: mods.has('alt') || mods.has('option'),
          metaKey: mods.has('meta') || mods.has('cmd') || mods.has('command'),
        };
        const tgt = document.activeElement && document.activeElement !== document.body
                    ? document.activeElement
                    : document.body;
        const ev = (type, extras) => {
          const e = new KeyboardEvent(type, opts);
          // keyCode/which are not always copied by the constructor on all
          // engines; force them via defineProperty to satisfy older code.
          try { Object.defineProperty(e, 'keyCode', { get: () => info.keyCode }); } catch {}
          try { Object.defineProperty(e, 'which',   { get: () => info.keyCode }); } catch {}
          if (extras) Object.assign(opts, extras);
          tgt.dispatchEvent(e);
        };
        ev('keydown');
        // Printable keys also fire keypress + input
        if (!info.code.startsWith('Arrow') && !info.code.startsWith('F') &&
            !['Escape','Tab','Backspace','Delete','Home','End','PageUp','PageDown','Enter'].includes(info.code)) {
          ev('keypress');
          if ((tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') && opts.key.length === 1 && !opts.ctrlKey && !opts.metaKey) {
            try { document.execCommand && document.execCommand('insertText', false, opts.key); } catch {}
          }
        }
        ev('keyup');
        // Enter on a button/link or inside a form should trigger that action
        if (info.code === 'Enter') {
          if (tgt.tagName === 'BUTTON' || (tgt.tagName === 'A' && tgt.href) || tgt.getAttribute('role') === 'button') {
            try { tgt.click(); } catch {}
          } else if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') {
            const form = tgt.closest && tgt.closest('form');
            if (form) try { form.requestSubmit ? form.requestSubmit() : form.submit(); } catch {}
          }
        }
        return { ok: true, key: opts.key, code: opts.code };
      };
      pp.hover = (sel) => {
        const el = pp.find(sel);
        if (!el) return { ok: false, error: 'not found: ' + sel };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
        ['mouseover', 'mouseenter', 'mousemove'].forEach(t => el.dispatchEvent(new MouseEvent(t, opts)));
        return { ok: true };
      };
      pp.drag = (fromSel, toSel) => {
        const a = pp.find(fromSel), b = pp.find(toSel);
        if (!a || !b) return { ok: false, error: 'not found' };
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        const ax = ar.left + ar.width / 2, ay = ar.top + ar.height / 2;
        const bx = br.left + br.width / 2, by = br.top + br.height / 2;
        const dt = new DataTransfer();
        a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ax, clientY: ay, button: 0 }));
        a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, clientX: ax, clientY: ay, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('dragenter', { bubbles: true, clientX: bx, clientY: by, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('dragover',  { bubbles: true, clientX: bx, clientY: by, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('drop',      { bubbles: true, clientX: bx, clientY: by, dataTransfer: dt }));
        a.dispatchEvent(new DragEvent('dragend',   { bubbles: true, clientX: bx, clientY: by, dataTransfer: dt }));
        a.dispatchEvent(new MouseEvent('mouseup',  { bubbles: true, clientX: bx, clientY: by, button: 0 }));
        return { ok: true };
      };
      // Programmatic file upload — main reads files, ships base64 chunks,
      // we reconstruct a File and stuff it into the input via DataTransfer.
      pp.upload = (sel, files) => {
        const el = pp.find(sel);
        if (!el || el.tagName !== 'INPUT' || el.type !== 'file') return { ok: false, error: 'target is not <input type=file>' };
        const dt = new DataTransfer();
        for (const f of files) {
          const bin = atob(f.base64);
          const len = bin.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
          dt.items.add(new File([u8], f.name, { type: f.mime || 'application/octet-stream' }));
        }
        el.files = dt.files;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, count: files.length };
      };
      /* RETIRED — coordinate-input + game-bot page-side helpers.
       * Re-enable in lockstep with renderer/browser-tab.js OPS and
       * main/ide-tools-mcp.js (search "RETIRED — coordinate-input"). */
      /*
      pp.clickAt = (x, y, opts) => {
        opts = opts || {};
        x = Math.max(0, Math.min(innerWidth - 1, Number(x) || 0));
        y = Math.max(0, Math.min(innerHeight - 1, Number(y) || 0));
        const target = (opts.bubbleToBody && document.body) || document.elementFromPoint(x, y) || document.body;
        if (!target) return { ok: false, error: 'no element at ' + x + ',' + y };
        pp._pointerSeq(target, x, y);
        return { ok: true, target: target.tagName + (target.id ? '#' + target.id : ''), x, y };
      };
      // Move the mouse to coordinates without clicking — fires
      // pointerover/move + mouseover/move on whatever's under the cursor.
      // Useful for canvas games that read mouse position on rAF.
      pp.mouseMoveAt = (x, y) => {
        x = Math.max(0, Math.min(innerWidth - 1, Number(x) || 0));
        y = Math.max(0, Math.min(innerHeight - 1, Number(y) || 0));
        const target = document.elementFromPoint(x, y) || document.body;
        const opts = { bubbles: true, cancelable: true, composed: true,
                       clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        try { target.dispatchEvent(new PointerEvent('pointerover', opts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('mouseover', opts)); } catch {}
        try { target.dispatchEvent(new PointerEvent('pointermove', opts)); } catch {}
        try { target.dispatchEvent(new MouseEvent('mousemove', opts)); } catch {}
        return { ok: true, target: target.tagName, x, y };
      };
      // Drag from one coordinate to another (mousedown → moves → mouseup).
      // Issues "steps" intermediate moves so canvas-based drag mechanics
      // see a smooth path, not just an endpoint jump.
      pp.dragAt = (x1, y1, x2, y2, steps) => {
        x1 = Math.max(0, Math.min(innerWidth - 1, Number(x1)));
        y1 = Math.max(0, Math.min(innerHeight - 1, Number(y1)));
        x2 = Math.max(0, Math.min(innerWidth - 1, Number(x2)));
        y2 = Math.max(0, Math.min(innerHeight - 1, Number(y2)));
        steps = Math.max(1, Math.min(60, Number(steps) || 12));
        const start = document.elementFromPoint(x1, y1) || document.body;
        const baseDown = { bubbles: true, cancelable: true, composed: true,
                           clientX: x1, clientY: y1, button: 0, buttons: 1,
                           pointerId: 1, pointerType: 'mouse', isPrimary: true };
        try { start.dispatchEvent(new PointerEvent('pointerdown', baseDown)); } catch {}
        try { start.dispatchEvent(new MouseEvent('mousedown', baseDown)); } catch {}
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const cx = x1 + (x2 - x1) * t;
          const cy = y1 + (y2 - y1) * t;
          const el = document.elementFromPoint(cx, cy) || start;
          const mv = { bubbles: true, cancelable: true, composed: true,
                       clientX: cx, clientY: cy, buttons: 1,
                       pointerId: 1, pointerType: 'mouse', isPrimary: true };
          try { el.dispatchEvent(new PointerEvent('pointermove', mv)); } catch {}
          try { el.dispatchEvent(new MouseEvent('mousemove', mv)); } catch {}
        }
        const end = document.elementFromPoint(x2, y2) || start;
        const upOpts = { bubbles: true, cancelable: true, composed: true,
                         clientX: x2, clientY: y2, button: 0, buttons: 0,
                         pointerId: 1, pointerType: 'mouse', isPrimary: true };
        try { end.dispatchEvent(new PointerEvent('pointerup', upOpts)); } catch {}
        try { end.dispatchEvent(new MouseEvent('mouseup', upOpts)); } catch {}
        try { end.dispatchEvent(new MouseEvent('click', upOpts)); } catch {}
        return { ok: true, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, steps };
      };

      // ── Agent-programmable game bots / long-lived workers ──────────
      // The agent ships a tick-function source. We compile it once, then
      // call it every intervalMs (or on requestAnimationFrame for max
      // refresh rate). The script gets a ctx with: state (persistent
      // object), log(), find/click/type/press/clickAt/mouseMoveAt
      // helpers, eval(), stop(), now(), runtime(). Multiple named
      // scripts can run concurrently; status (running / log / state)
      // can be polled from outside.
      pp.scripts = pp.scripts || new Map();
      pp._mkCtx = (rec) => ({
        state: rec.state,
        runtime: () => Date.now() - rec.startedAt,
        now: () => Date.now(),
        log: (msg) => {
          const line = '[' + (Date.now() - rec.startedAt) + 'ms] ' + (typeof msg === 'string' ? msg : JSON.stringify(msg));
          rec.log.push(line);
          if (rec.log.length > 500) rec.log.splice(0, rec.log.length - 500);
        },
        stop: (reason) => { rec.stopReason = reason || 'stop() called'; rec._stopRequested = true; },
        find: (sel) => pp.find(sel),
        qs: (sel) => pp.qs(sel),
        click: (sel) => pp.click(sel),
        type: (sel, text) => pp.fill(sel, text),
        press: (key) => pp.press(key),
        hover: (sel) => pp.hover(sel),
        clickAt: (x, y) => pp.clickAt(x, y),
        mouseMoveAt: (x, y) => pp.mouseMoveAt(x, y),
        dragAt: (x1, y1, x2, y2, steps) => pp.dragAt(x1, y1, x2, y2, steps),
        scroll: (opts) => pp.scroll(opts),
        scrollTo: (sel, block) => pp.scrollToSelector(sel, block),
        text: (sel) => pp.text(sel),
        html: (sel) => pp.html(sel),
        exists: (sel) => pp.exists(sel),
        eval: (code) => { try { return (function(){ return eval(code); })(); } catch (e) { return { __error: e.message }; } },
      });
      pp.runScript = (name, source, opts) => {
        if (pp.scripts.has(name)) return { ok: false, error: 'script "' + name + '" already running — stop it first' };
        opts = opts || {};
        const intervalMs = Math.max(0, Math.min(2000, Number(opts.intervalMs) || 100));
        const useRaf = opts.useRaf === true || intervalMs === 0;
        let userFn;
        try {
          // Compile once. Source is a function BODY — caller can use ctx.* and return early to skip a tick.
          // eslint-disable-next-line no-new-func
          userFn = new Function('ctx', '"use strict";\n' + source + '\n');
        } catch (err) {
          return { ok: false, error: 'compile failed: ' + err.message };
        }
        const rec = {
          name, startedAt: Date.now(), ticks: 0, errors: 0,
          log: [], state: {}, _stopRequested: false, stopReason: null,
          lastTickAt: 0, intervalMs, useRaf, source: source.slice(0, 4000),
          _timerId: 0, _rafId: 0,
        };
        const ctx = pp._mkCtx(rec);
        const tick = () => {
          if (rec._stopRequested) { pp._stopScriptInternal(rec); return; }
          rec.ticks += 1; rec.lastTickAt = Date.now();
          try {
            const res = userFn(ctx);
            if (res === 'stop' || res === false) { rec.stopReason = 'returned stop'; pp._stopScriptInternal(rec); return; }
          } catch (err) {
            rec.errors += 1;
            ctx.log('ERROR: ' + (err && err.message ? err.message : String(err)));
            if (rec.errors >= 20) { rec.stopReason = 'too many errors'; pp._stopScriptInternal(rec); return; }
          }
          if (useRaf) rec._rafId = requestAnimationFrame(tick);
          else        rec._timerId = setTimeout(tick, intervalMs);
        };
        pp.scripts.set(name, rec);
        if (useRaf) rec._rafId = requestAnimationFrame(tick);
        else        rec._timerId = setTimeout(tick, intervalMs);
        return { ok: true, name, useRaf, intervalMs };
      };
      pp._stopScriptInternal = (rec) => {
        if (rec._timerId) clearTimeout(rec._timerId);
        if (rec._rafId)   cancelAnimationFrame(rec._rafId);
        rec._timerId = 0; rec._rafId = 0;
        rec.stoppedAt = Date.now();
      };
      pp.stopScript = (name) => {
        const rec = pp.scripts.get(name);
        if (!rec) return { ok: false, error: 'no such script: ' + name };
        rec._stopRequested = true; rec.stopReason = rec.stopReason || 'external stop';
        pp._stopScriptInternal(rec);
        const summary = { ok: true, name, ticks: rec.ticks, errors: rec.errors, runtimeMs: (rec.stoppedAt - rec.startedAt), reason: rec.stopReason, log: rec.log.slice(-30), state: rec.state };
        pp.scripts.delete(name);
        return summary;
      };
      pp.scriptStatus = (name) => {
        const rec = pp.scripts.get(name);
        if (!rec) return { ok: false, error: 'no such script: ' + name };
        return {
          ok: true, name,
          running: !rec._stopRequested,
          ticks: rec.ticks, errors: rec.errors,
          runtimeMs: Date.now() - rec.startedAt,
          state: rec.state,
          log: rec.log.slice(-50),
        };
      };
      // Live-mutate a running bot's state from outside. Lets the agent
      // close the loop: take a screenshot, decide, push new targets to
      // the bot, the bot reacts at 60Hz against those targets.
      pp.updateScriptState = (name, patch) => {
        const rec = pp.scripts.get(name);
        if (!rec) return { ok: false, error: 'no such script: ' + name };
        if (!patch || typeof patch !== 'object') return { ok: false, error: 'patch must be an object' };
        Object.assign(rec.state, patch);
        return { ok: true, name, state: rec.state };
      };
      pp.listScripts = () => {
        return Array.from(pp.scripts.values()).map(r => ({
          name: r.name, running: !r._stopRequested,
          ticks: r.ticks, errors: r.errors, runtimeMs: Date.now() - r.startedAt,
        }));
      };
      */

      pp.scrollToSelector = (sel, block) => {
        const el = pp.find(sel);
        if (!el) return { ok: false, error: 'not found: ' + sel };
        el.scrollIntoView({ block: block || 'center', behavior: 'instant' });
        return { ok: true, x: window.scrollX, y: window.scrollY };
      };
      pp.scroll = (opts) => {
        if (opts && typeof opts.to === 'number') window.scrollTo(0, opts.to);
        else window.scrollBy(0, (opts && opts.dy) || 0);
        return { ok: true, x: window.scrollX, y: window.scrollY, max: document.documentElement.scrollHeight };
      };
      pp.text = (sel) => {
        const el = sel ? pp.q(sel) : document.body;
        if (!el) return null;
        return (el.innerText || el.textContent || '').trim();
      };
      pp.html = (sel) => {
        const el = sel ? pp.q(sel) : document.documentElement;
        if (!el) return null;
        return el.outerHTML;
      };
      pp.exists = (sel) => !!pp.q(sel);
      pp.wait = async (sel, timeout) => {
        const t0 = Date.now();
        timeout = timeout || 10000;
        return new Promise((resolve) => {
          const tick = () => {
            if (pp.q(sel)) return resolve({ ok: true, ms: Date.now() - t0 });
            if (Date.now() - t0 > timeout) return resolve({ ok: false, error: 'timeout: ' + sel, ms: Date.now() - t0 });
            requestAnimationFrame(tick);
          };
          tick();
        });
      };
      // ── Accessibility-tree snapshot (Playwright-style YAML) ──
      // Walks the DOM, assigns sticky refs (data-pp-ref="e<n>") to every
      // visible/interactive node, and emits an indented outline. Refs
      // can later be passed to __pipilot.clickRef / fillRef.
      pp._refSeq = 0;
      pp.refOf = (el) => {
        let r = el.getAttribute && el.getAttribute('data-pp-ref');
        if (r) return r;
        r = 'e' + (++pp._refSeq);
        el.setAttribute && el.setAttribute('data-pp-ref', r);
        return r;
      };
      pp.elByRef = (ref) => document.querySelector('[data-pp-ref="' + ref + '"]');
      pp.clickRef = (ref) => {
        const el = pp.elByRef(ref);
        if (!el) return { ok: false, error: 'no element with ref ' + ref };
        return pp._performClick(el);
      };
      pp.clickRefAndVerify = (ref, opts) => {
        return pp.clickAndVerify('[data-pp-ref="' + ref + '"]', opts);
      };
      pp.fillRef = (ref, value) => {
        const el = pp.elByRef(ref);
        if (!el) return { ok: false, error: 'no element with ref ' + ref };
        return pp.fill('[data-pp-ref="' + ref + '"]', value);
      };
      pp.snapshot = () => {
        // Reset: clear stale refs from a previous snapshot
        document.querySelectorAll('[data-pp-ref]').forEach(el => el.removeAttribute('data-pp-ref'));
        pp._refSeq = 0;

        const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','META','LINK','HEAD','TEMPLATE']);
        const ROLE_MAP = {
          a: 'link', button: 'button',
          h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
          ul: 'list', ol: 'list', li: 'listitem',
          nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
          article: 'article', section: 'region', aside: 'complementary',
          form: 'form', label: 'label', table: 'table', tr: 'row', td: 'cell', th: 'columnheader',
          textarea: 'textbox', select: 'combobox',
          img: 'img', svg: 'img', video: 'video', audio: 'audio', iframe: 'iframe',
          dialog: 'dialog', details: 'group', summary: 'button',
        };
        function roleOf(el) {
          const aria = el.getAttribute && el.getAttribute('role');
          if (aria) return aria;
          const tag = el.tagName.toLowerCase();
          if (tag === 'input') {
            const t = (el.type || 'text').toLowerCase();
            if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
            if (t === 'checkbox') return 'checkbox';
            if (t === 'radio') return 'radio';
            return 'textbox';
          }
          return ROLE_MAP[tag] || 'generic';
        }
        function isVisible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          const cs = window.getComputedStyle(el);
          if (!cs) return false;
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const op = parseFloat(cs.opacity || '1');
          if (op === 0) return false;
          return true;
        }
        function isInteractive(el, role) {
          const cs = window.getComputedStyle(el);
          if (cs && cs.cursor === 'pointer') return true;
          if (['link','button','checkbox','radio','tab','menuitem'].includes(role)) return true;
          if (el.onclick || (el.hasAttribute && el.hasAttribute('onclick'))) return true;
          return false;
        }
        function nameOf(el, role) {
          const aria = el.getAttribute && el.getAttribute('aria-label');
          if (aria) return aria.slice(0, 200);
          const alt = el.getAttribute && el.getAttribute('alt');
          if (alt) return alt.slice(0, 200);
          const title = el.getAttribute && el.getAttribute('title');
          if (title) return title.slice(0, 200);
          if (role === 'img' || role === 'video' || role === 'audio') return '';
          if (role === 'textbox' || role === 'combobox' || role === 'checkbox' || role === 'radio') {
            const ph = el.getAttribute && el.getAttribute('placeholder');
            if (ph) return ph.slice(0, 100);
            const nm = el.getAttribute && el.getAttribute('name');
            if (nm) return nm;
          }
          if (el.children.length === 0) {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length <= 200) return t;
            if (t) return t.slice(0, 200) + '…';
          }
          return '';
        }
        const lines = [];
        // A node is "informative" if it has its own role/text/handler/aria.
        // Pure structural wrappers (div with no text, no role, no event,
        // no aria) get RECURSED INTO but not emitted as their own line —
        // so the AI doesn't see refs for layout-only divs and click them
        // by mistake.
        function isInformative(el, role, name, interactive) {
          if (interactive) return true;
          if (role !== 'generic') return true;
          if (name) return true;
          if (el.tagName === 'BODY' || el.tagName === 'MAIN' || el.tagName === 'NAV' ||
              el.tagName === 'HEADER' || el.tagName === 'FOOTER' || el.tagName === 'ASIDE' ||
              el.tagName === 'SECTION' || el.tagName === 'ARTICLE' || el.tagName === 'FORM') return true;
          if (el.hasAttribute && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) return true;
          if (el.id) return true;
          return false;
        }
        function walk(el, depth) {
          if (!el || el.nodeType !== 1) return;
          if (SKIP_TAGS.has(el.tagName)) return;
          if (!isVisible(el)) return;
          const role = roleOf(el);
          const name = nameOf(el, role);
          const interactive = isInteractive(el, role);
          const kids = Array.from(el.children).filter(c => isVisible(c) && !SKIP_TAGS.has(c.tagName));
          const emit = isInformative(el, role, name, interactive);
          if (emit) {
            const ref = pp.refOf(el);
            let line = '  '.repeat(depth) + '- ' + role;
            if (name) line += ' ' + JSON.stringify(name);
            line += ' [ref=' + ref + ']';
            if (interactive) line += ' [cursor=pointer]';
            if (kids.length) line += ':';
            lines.push(line);
            for (const k of kids) walk(k, depth + 1);
          } else {
            // Skip emission, but recurse with the SAME depth so children
            // appear at the structural level the user expects.
            for (const k of kids) walk(k, depth);
          }
        }
        walk(document.body, 0);
        return { tree: lines.join('\n'), refCount: pp._refSeq, url: location.href, title: document.title };
      };

      pp.summary = () => ({
        url: location.href,
        title: document.title,
        scrollY: window.scrollY,
        scrollMax: document.documentElement.scrollHeight,
        viewport: { w: innerWidth, h: innerHeight },
        // Lightweight dom outline of interactive elements
        links: Array.from(document.querySelectorAll('a[href]')).slice(0, 25).map(a => ({ text: (a.textContent||'').trim().slice(0,80), href: a.href })),
        buttons: Array.from(document.querySelectorAll('button, [role=button]')).slice(0, 25).map(b => ({ text: (b.textContent||'').trim().slice(0,80) })),
        inputs: Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 25).map(i => ({ tag: i.tagName.toLowerCase(), type: i.type||'', name: i.name||'', placeholder: i.placeholder||'', id: i.id||'' })),
      });
    })();
  `;

  async function ensureHelpers(entry) { try { await execJs(entry, HELPER_JS); } catch {} }

  const OPS = {
    async open({ url, incognito }) {
      openBrowserTab(url, { incognito: !!incognito });
      // Wait briefly for the new tab's webview to register
      await new Promise(r => setTimeout(r, 200));
      const entries = Array.from(tabRegistry.entries());
      const last = entries[entries.length - 1];
      return { tabId: last?.[0] || null, url };
    },
    async list_tabs() {
      const active = window.PiPilot?.editor?.getActiveFile?.();
      return Array.from(tabRegistry.entries()).map(([id, e]) => ({
        tabId: id, url: e.url, title: e.title, mode: e.mode, active: id === active,
      }));
    },
    async close_tab({ tabId }) {
      const entry = findTab(tabId);
      if (!entry) return { ok: false, error: 'no such tab' };
      const realId = [...tabRegistry.entries()].find(([, v]) => v === entry)?.[0];
      // Use the editor's tab-close API if available
      try { window.PiPilot.editor.closeFile?.(realId); } catch {}
      unregisterTab(realId);
      return { ok: true, closed: realId };
    },
    async navigate({ tabId, url }) { const e = findTab(tabId); if (!e) throw new Error('no such tab'); e.loadURL(url); return { ok: true }; },
    async back({ tabId })    { const e = findTab(tabId); if (!e) throw new Error('no such tab'); e.goBack();   return { ok: true }; },
    async forward({ tabId }) { const e = findTab(tabId); if (!e) throw new Error('no such tab'); e.goForward();return { ok: true }; },
    async reload({ tabId })  { const e = findTab(tabId); if (!e) throw new Error('no such tab'); e.reload();   return { ok: true }; },
    async url({ tabId })   { const e = findTab(tabId); if (!e) throw new Error('no such tab'); return { url: e.url }; },
    async title({ tabId }) { const e = findTab(tabId); if (!e) throw new Error('no such tab'); return { title: e.title }; },
    async screenshot({ tabId, format, quality, maxWidth }) {
      const e = findTab(tabId);
      if (!e) throw new Error('no such tab');
      await waitDomReady(e);
      await execJs(e, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))').catch(() => {});

      // Capture (retry until we get pixels)
      let img;
      for (let i = 0; i < 3; i++) {
        img = await e.wv.capturePage();
        const probe = img.toPNG();
        if (probe.length > 1024) break;
        await new Promise(r => setTimeout(r, 250));
      }
      if (!img) throw new Error('capturePage returned empty image');

      // Optional downscale to cap final pixel width — only resizes when the
      // capture is wider than the cap, never upscales. Default 1600px keeps
      // text legible while halving payload size for ultrawide monitors.
      const cap = Math.max(640, Math.min(3840, Number(maxWidth) || 1600));
      try {
        const sz = img.getSize();
        if (sz && sz.width > cap) {
          // Aspect-preserving resize via height-omit
          img = img.resize({ width: cap, quality: 'best' });
        }
      } catch {}

      // Encode. Default JPEG quality 92 is visually lossless for UI text and
      // ~3-5x smaller than PNG. Caller can force PNG via format:'png'.
      const fmt = (format || 'jpeg').toLowerCase();
      const q = Math.max(60, Math.min(100, Number(quality) || 92));
      let buf, mime, ext;
      if (fmt === 'png') {
        buf = img.toPNG();
        mime = 'image/png'; ext = 'png';
      } else {
        buf = img.toJPEG(q);
        mime = 'image/jpeg'; ext = 'jpg';
      }
      const sz = buf.length;
      if (!sz) throw new Error('image encode returned empty buffer');

      await ensureHelpers(e);
      let snap = null;
      try { snap = await execJs(e, '__pipilot.snapshot()'); } catch (err) { snap = { tree: '', error: err.message }; }

      return {
        ok: true,
        mime,
        ext,
        base64: buf.toString('base64'),
        size: sz,
        snapshot: snap,
        consoleLog: e.consoleLog ? e.consoleLog.slice() : [],
        url: e.url,
        title: e.title,
      };
    },
    async snapshot({ tabId }) {
      const e = findTab(tabId);
      if (!e) throw new Error('no such tab');
      await waitDomReady(e);
      await ensureHelpers(e);
      const snap = await execJs(e, '__pipilot.snapshot()');
      return { ...snap, consoleLog: e.consoleLog ? e.consoleLog.slice() : [] };
    },
    async console_log({ tabId, clear }) {
      const e = findTab(tabId);
      if (!e) throw new Error('no such tab');
      const out = e.consoleLog ? e.consoleLog.slice() : [];
      if (clear && e.consoleLog) e.consoleLog.length = 0;
      return { entries: out };
    },
    async click_ref({ tabId, ref, settleMs }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const settle = Math.max(150, Math.min(2000, Number(settleMs) || 350));
      const r = await execJs(e, `__pipilot.clickRefAndVerify(${jsLit(ref)}, { settleMs: ${settle} })`);
      if (r && r.verified && r.verified.urlChanged) {
        await new Promise(rs => setTimeout(rs, 250));
        const start = Date.now();
        while (e.isLoading && Date.now() - start < 5000) await new Promise(rs => setTimeout(rs, 80));
      }
      return r;
    },
    async fill_ref({ tabId, ref, text, submit }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const r = await execJs(e, `__pipilot.fillRef(${jsLit(ref)}, ${jsLit(text)})`);
      if (submit && r?.ok) await execJs(e, `__pipilot.press('Enter')`);
      return r;
    },
    async click({ tabId, selector, settleMs }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const settle = Math.max(150, Math.min(2000, Number(settleMs) || 350));
      const r = await execJs(e, `__pipilot.clickAndVerify(${jsLit(selector)}, { settleMs: ${settle} })`);
      // If URL changed, give Chromium a beat to finish navigation so the
      // very next op runs against the new page.
      if (r && r.verified && r.verified.urlChanged) {
        await new Promise(rs => setTimeout(rs, 250));
        // Wait for isLoading to clear (max 5s)
        const start = Date.now();
        while (e.isLoading && Date.now() - start < 5000) await new Promise(rs => setTimeout(rs, 80));
      }
      return r;
    },
    async type({ tabId, selector, text, submit }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const r = await execJs(e, `__pipilot.fill(${jsLit(selector)}, ${jsLit(text)})`);
      if (submit && r?.ok) await execJs(e, `__pipilot.press('Enter')`);
      return r;
    },
    async press_key({ tabId, key }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.press(${jsLit(key)})`);
    },
    async scroll({ tabId, dy, to }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const opts = to != null ? { to: Number(to) } : { dy: Number(dy || 0) };
      return await execJs(e, `__pipilot.scroll(${JSON.stringify(opts)})`);
    },
    async get_text({ tabId, selector }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const txt = await execJs(e, `__pipilot.text(${selector ? jsLit(selector) : 'null'})`);
      return { text: txt };
    },
    async get_html({ tabId, selector }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const html = await execJs(e, `__pipilot.html(${selector ? jsLit(selector) : 'null'})`);
      return { html };
    },
    async wait_for({ tabId, selector, timeoutMs }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.wait(${jsLit(selector)}, ${Number(timeoutMs)||10000})`);
    },
    async eval({ tabId, expression }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      const code = String(expression || '').trim();
      if (!code) return { result: null };
      // Smart wrapping:
      //   - if the code already uses `return`, treat as a function body
      //   - if it starts with a statement keyword (let/const/if/for/comment),
      //     treat as a body with implicit `return undefined`
      //   - otherwise wrap as a single expression: `return await (<expr>)`
      const hasReturn = /(^|\W)return\s/.test(code);
      const looksStatement = /^(?:\/\/|\/\*|let\s|const\s|var\s|if\s|for\s|while\s|do\s|switch\s|function\s|throw\s|try\s|class\s|debugger\b|;)/.test(code);
      let wrapped;
      if (hasReturn) {
        wrapped = `(async () => { try { ${code} } catch (e) { return { __error: e.message } } })()`;
      } else if (looksStatement) {
        wrapped = `(async () => { try { ${code}\n;return undefined; } catch (e) { return { __error: e.message } } })()`;
      } else {
        wrapped = `(async () => { try { return await (${code}) } catch (e) { return { __error: e.message } } })()`;
      }
      try {
        return { result: await execJs(e, wrapped) };
      } catch (err) {
        // Fallback: if the heuristic guessed wrong, try the other form
        try {
          const alt = `(async () => { try { ${code}\n;return undefined; } catch (e) { return { __error: e.message } } })()`;
          return { result: await execJs(e, alt) };
        } catch {
          throw err;
        }
      }
    },
    async summary({ tabId }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.summary()`);
    },
    async hover({ tabId, selector }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.hover(${jsLit(selector)})`);
    },
    /* RETIRED — coordinate-input + game-bot ops batch.
     * Re-enable in lockstep with the matching MCP tool definitions in
     * main/ide-tools-mcp.js (search "RETIRED — coordinate-input"). */
    /*
    async click_at({ tabId, x, y }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.clickAt(${Number(x)||0}, ${Number(y)||0})`);
    },
    async mouse_move_at({ tabId, x, y }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.mouseMoveAt(${Number(x)||0}, ${Number(y)||0})`);
    },
    async drag_at({ tabId, x1, y1, x2, y2, steps }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.dragAt(${Number(x1)||0}, ${Number(y1)||0}, ${Number(x2)||0}, ${Number(y2)||0}, ${Number(steps)||12})`);
    },
    async poll_until({ tabId, expression, intervalMs, timeoutMs }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      const interval = Math.max(20, Math.min(1000, Number(intervalMs) || 100));
      const timeout  = Math.max(interval * 4, Math.min(60000, Number(timeoutMs) || 10000));
      const code = `(async () => {
        const start = Date.now();
        const evalOnce = () => { try { return (function(){ return (${expression}); })(); } catch (e) { return undefined; } };
        let v = evalOnce();
        while (!v) {
          if (Date.now() - start > ${timeout}) return { ok: false, timeout: true, ms: Date.now() - start, lastValue: v };
          await new Promise(r => setTimeout(r, ${interval}));
          v = evalOnce();
        }
        return { ok: true, ms: Date.now() - start, value: v };
      })()`;
      return await execJs(e, code);
    },
    async run_script({ tabId, name, source, intervalMs, useRaf }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const opts = { intervalMs: Number(intervalMs) || 100, useRaf: !!useRaf };
      const b64 = btoa(unescape(encodeURIComponent(String(source || ''))));
      const code =
        'const __src = decodeURIComponent(escape(atob(' + JSON.stringify(b64) + ')));' +
        '__pipilot.runScript(' + jsLit(name) + ', __src, ' + JSON.stringify(opts) + ');';
      return await execJs(e, code);
    },
    async stop_script({ tabId, name }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, '__pipilot.stopScript(' + jsLit(name) + ')');
    },
    async update_script_state({ tabId, name, patch }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      const json = JSON.stringify(patch || {});
      return await execJs(e, '__pipilot.updateScriptState(' + jsLit(name) + ', ' + json + ')');
    },
    async script_status({ tabId, name }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      if (name) return await execJs(e, '__pipilot.scriptStatus(' + jsLit(name) + ')');
      return await execJs(e, '__pipilot.listScripts()');
    },
    async sample({ tabId, expression, intervalMs, durationMs }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      const interval = Math.max(20, Math.min(500, Number(intervalMs) || 100));
      const duration = Math.max(interval * 2, Math.min(30000, Number(durationMs) || 3000));
      const code = `(async () => {
        const samples = [];
        const start = Date.now();
        while (Date.now() - start < ${duration}) {
          let v;
          try { v = (function(){ return (${expression}); })(); } catch (e) { v = { __error: e.message }; }
          samples.push({ t: Date.now() - start, v });
          await new Promise(r => setTimeout(r, ${interval}));
        }
        return { samples, ms: Date.now() - start };
      })()`;
      return await execJs(e, code);
    },
    */
    async drag({ tabId, from, to }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.drag(${jsLit(from)}, ${jsLit(to)})`);
    },
    async scroll_to({ tabId, selector, block }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.scrollToSelector(${jsLit(selector)}, ${jsLit(block || 'center')})`);
    },
    async upload({ tabId, selector, files }) {
      // `files` is [{ path }] from the agent. Read each file in the renderer
      // (which has Node fs via electronAPI) and ship base64 to the page.
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      if (!Array.isArray(files) || !files.length) throw new Error('no files');
      const encoded = [];
      for (const f of files) {
        const r = await api.files.read(f.path);
        let base64 = '';
        let mime = 'application/octet-stream';
        if (r && r.dataUrl) {
          const m = /^data:([^;]+);base64,(.*)$/.exec(r.dataUrl);
          if (m) { mime = m[1]; base64 = m[2]; }
        } else if (r && typeof r.content === 'string') {
          base64 = btoa(unescape(encodeURIComponent(r.content)));
          mime = r.mime || 'text/plain';
        }
        if (!base64) throw new Error('could not read ' + f.path);
        const name = (f.name || f.path.split(/[\\/]/).pop() || 'file');
        encoded.push({ base64, mime, name });
      }
      await ensureHelpers(e);
      return await execJs(e, `__pipilot.upload(${jsLit(selector)}, ${JSON.stringify(encoded)})`);
    },
    async wait_load({ tabId, idleMs, timeoutMs }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      const idle = Math.max(150, Number(idleMs) || 500);
      const timeout = Math.max(idle * 2, Number(timeoutMs) || 15000);
      const start = Date.now();
      let idleSince = e.isLoading ? 0 : Date.now();
      return await new Promise((resolve) => {
        const t = setInterval(() => {
          if (e.isLoading) idleSince = 0;
          else if (!idleSince) idleSince = Date.now();
          else if (Date.now() - idleSince >= idle) { clearInterval(t); resolve({ ok: true, ms: Date.now() - start }); return; }
          if (Date.now() - start > timeout) { clearInterval(t); resolve({ ok: false, error: 'timeout', ms: Date.now() - start }); }
        }, 60);
      });
    },
    async set_viewport({ tabId, width, height }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      const w = Math.max(320, Math.min(3840, Number(width) || 1280));
      const h = Math.max(240, Math.min(2160, Number(height) || 800));
      // Resize the webview element — Chromium reports this as the viewport.
      try { e.wv.style.width = w + 'px'; e.wv.style.height = h + 'px'; e.wv.style.flex = 'none'; } catch {}
      return { ok: true, width: w, height: h };
    },
    async reset_viewport({ tabId }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      try { e.wv.style.width = ''; e.wv.style.height = ''; e.wv.style.flex = ''; } catch {}
      return { ok: true };
    },
    async cookies_get({ tabId, url }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      return { result: await execJs(e, `(async () => document.cookie)()`) };
    },
    async pdf({ tabId, name }) {
      const e = findTab(tabId); if (!e) throw new Error('no such tab');
      const wcId = e.wv.getWebContentsId();
      const r = await api.browser.printToPdf(wcId, name || (e.title || 'page'));
      return r;
    },
  };

  // Popups (target=_blank, window.open) → forward from main to a fresh
  // browser tab. Inherits incognito mode from the originating tab when we
  // can identify it (otherwise defaults to standard).
  if (api.browser.onPopupRequest) {
    api.browser.onPopupRequest(({ url, disposition }) => {
      if (!url) return;
      // Detect originating mode: pick the active browser tab if any.
      let incognito = false;
      try {
        const active = window.PiPilot?.editor?.getActiveFile?.();
        const entry = active && tabRegistry.get(active);
        if (entry && entry.mode === 'inc') incognito = true;
      } catch {}
      openBrowserTab(url, { incognito });
    });
  }

  if (api.browser.onControlRequest) {
    api.browser.onControlRequest(async (req) => {
      const { id, op, args } = req || {};
      try {
        const handler = OPS[op];
        if (!handler) throw new Error('unknown op: ' + op);
        const result = await handler(args || {});
        api.browser.controlRespond({ id, ok: true, result });
      } catch (err) {
        api.browser.controlRespond({ id, ok: false, error: err && err.message ? err.message : String(err) });
      }
    });
  }

  // ── Public API + bus wiring ─────────────────────────────────────
  bus.on('browser:open', ({ url, incognito } = {}) => openBrowserTab(url || null, { incognito }));
  bus.on('browser:open-history', () => openHistoryTab());
  bus.on('browser:open-downloads', () => openDownloadsTab());
  bus.on('browser:control:reload', ({ tabId } = {}) => { const e = findTab(tabId); if (e) e.reload(); });

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.browser = {
    // Default new-tab behavior: if user has new-tab page enabled, open it;
    // otherwise navigate to the configured home URL.
    open: (url) => openBrowserTab(url || null),
    openIncognito: (url) => openBrowserTab(url || null, { incognito: true }),
    openHistoryTab,
    openDownloadsTab,
    openSettingsTab,
    openGameTab,
    setHome: (url) => { try { localStorage.setItem('pipilot.browser.home', url); } catch {} },
    setSearchEngine: (key) => { try { localStorage.setItem('pipilot.browser.search', key); } catch {} },
    // Returns a snapshot of currently-open browser tabs in the IDE — used
    // by chat.js to attach context to outgoing messages so the agent knows
    // what the user has open and can act on it via mcp__pipilot__browser_*.
    listOpenTabs: () => {
      const active = window.PiPilot?.editor?.getActiveFile?.();
      return Array.from(tabRegistry.entries()).map(([id, e]) => ({
        tabId: id,
        url: e.url || '',
        title: e.title || '',
        mode: e.mode,
        active: id === active,
      }));
    },
    HOME_URL,
  };
})();
