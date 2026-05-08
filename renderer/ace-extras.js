// PiPilot IDE — Ace editor extras
//
// Wires up three Ace ext modules that ship with the editor but aren't
// loaded by default:
//
//   • ext-beautify         → Format Document  (Shift+Alt+F + context menu)
//   • ext-keybinding_menu  → Command palette  (Ctrl+Alt+H)
//   • ext-emmet            → HTML/JSX shortcut expansion (Tab on HTML/CSS/JSX)
//
// Loaded as a core module (index.html script tag) — listens for the
// `ace:ready` bus event so it can hook into the editor that ace-editor.js
// creates lazily on first file open.

(function () {;
  'use strict';
  if (window.__pipilotAceExtrasLoaded) return;
  window.__pipilotAceExtrasLoaded = true;

  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  // Ace lazy-loads ext modules from the workerPath set in ace-editor.js
  // (cdnjs 1.32.7). loadModule fires the callback once the script is
  // resolved and parsed; we wrap it in a Promise for async/await.
  function loadAceModule(name) {
    return new Promise((resolve, reject) => {
      try {
        window.ace.config.loadModule(name, (mod) => mod ? resolve(mod) : reject(new Error('module not found: ' + name)));
      } catch (err) { reject(err); }
    });
  }

  // ── Format Document  (ext-beautify) ──────────────────────────────
  // Beautify is per-mode: it formats the active session using the rules
  // for whatever language Ace has assigned. Best for HTML/CSS/XML/JS/JSON.
  // For TS/TSX a real formatter (prettier) would be richer, but this is
  // a solid baseline that works offline with no extra dependencies.
  function setupBeautify(editor) {
    let beautifyMod = null;
    async function ensureBeautify() {
      if (beautifyMod) return beautifyMod;
      try { beautifyMod = await loadAceModule('ace/ext/beautify'); }
      catch (err) { console.warn('[ace-extras] beautify load failed:', err); throw err; }
      return beautifyMod;
    }
    async function formatDocument() {
      try {
        const mod = await ensureBeautify();
        if (!mod || typeof mod.beautify !== 'function') {
          bus.emit('toast:show', { message: 'Beautify not available for this language', type: 'warn' });
          return;
        }
        mod.beautify(editor.getSession());
        bus.emit('toast:show', { message: 'Document formatted', type: 'ok' });
      } catch (err) {
        bus.emit('toast:show', { message: 'Format failed: ' + err.message, type: 'error' });
      }
    }
    // Bind Shift+Alt+F (matches VS Code).
    editor.commands.addCommand({
      name: 'formatDocument',
      bindKey: { win: 'Shift-Alt-F', mac: 'Shift-Option-F' },
      exec: formatDocument,
    });
    // Inject into the right-click context menu via the existing bus hook.
    bus.on('editor:context-menu', (payload) => {
      if (!payload || !Array.isArray(payload.items)) return;
      payload.items.push({ label: 'Format Document', hint: 'Shift+Alt+F', run: formatDocument });
    });
  }

  // ── Command Palette  (ext-keybinding_menu) ───────────────────────
  // Ctrl+Alt+H opens a searchable list of every command Ace and our
  // custom commands have registered, with their keybindings.
  function setupKeybindingMenu(editor) {
    let bound = false;
    async function showPalette() {
      try {
        const mod = await loadAceModule('ace/ext/keybinding_menu');
        if (!bound) {
          // The first call wires up the menu and registers `showKeyboardShortcuts`.
          if (typeof mod.init === 'function') mod.init(editor);
          bound = true;
        }
        editor.execCommand('showKeyboardShortcuts');
      } catch (err) {
        console.warn('[ace-extras] keybinding menu load failed:', err);
        bus.emit('toast:show', { message: 'Command palette unavailable', type: 'error' });
      }
    }
    editor.commands.addCommand({
      name: 'showCommandPalette',
      bindKey: { win: 'Ctrl-Alt-H', mac: 'Cmd-Alt-H' },
      exec: showPalette,
    });
  }

  // ── Emmet  (ext-emmet) ───────────────────────────────────────────
  // Tab on an Emmet abbreviation (`div>ul>li*3`, `.btn.btn-primary`) in
  // HTML/JSX/CSS/SCSS expands to full markup. Ace's ext-emmet expects a
  // global `window.emmet` core to be available; we load it from a CDN
  // before activating the extension. If the core script can't load we
  // silently skip — Tab keeps its default indent behaviour.
  const EMMET_LANGS = new Set(['html', 'xml', 'svg', 'css', 'scss', 'less', 'tsx', 'jsx', 'vue', 'svelte', 'php', 'twig', 'erb', 'handlebars']);
  const EMMET_EXTS = new Set(['html', 'htm', 'xml', 'svg', 'css', 'scss', 'sass', 'less', 'jsx', 'tsx', 'vue', 'svelte', 'php', 'twig', 'hbs', 'handlebars', 'erb']);

  function activeFileIsEmmetable() {
    const fp = state?.activeFile || '';
    const ext = (fp.split('.').pop() || '').toLowerCase();
    return EMMET_EXTS.has(ext);
  }

  function loadScriptOnce(src) {
    const existing = document.querySelector(`script[data-pipilot-src="${src}"]`);
    if (existing && existing.dataset.pipilotLoaded === '1') return Promise.resolve();
    if (existing) existing.remove(); // clean up a previous failed attempt
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.pipilotSrc = src;
      s.onload = () => { s.dataset.pipilotLoaded = '1'; resolve(); };
      s.onerror = () => { s.remove(); reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function setupEmmet(editor) {
    // Ace's ext-emmet expects the legacy emmet API exposed as `window.emmet`.
    // The compatible UMD bundle ships INSIDE ace-builds itself as
    // `emmet.js` (or `emmet.min.js` on cdnjs). The npm `emmet` package
    // and `@emmetio/codemirror-plugin` use a different API and won't work.
    //
    // Try cdnjs first (we already use it for ace.js), fall back to jsdelivr,
    // then to unpkg. All three serve the same ace-builds bundle.
    // Local-first: if the optional public/vendor/ace/emmet.min.js exists
    // (we may pre-bundle it later), load it without touching the network.
    // Falls back to public CDNs only when we have connectivity. The npm
    // ace-builds package doesn't ship emmet.js so we don't depend on it.
    const EMMET_CDNS = [
      'public/vendor/ace/emmet.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7/emmet.min.js',
      'https://cdn.jsdelivr.net/npm/ace-builds@1.32.9/src-min-noconflict/emmet.js',
      'https://unpkg.com/ace-builds@1.32.9/src-min-noconflict/emmet.js',
    ];
    let loaded = false;
    let lastErr = null;
    for (const url of EMMET_CDNS) {
      try { await loadScriptOnce(url); loaded = true; break; }
      catch (err) { lastErr = err; }
    }
    if (!loaded) {
      console.warn('[ace-extras] Emmet skipped:', lastErr?.message || 'all CDN sources failed');
      return;
    }
    if (!window.emmet) {
      console.warn('[ace-extras] Emmet skipped: global not exposed by CDN bundle');
      return;
    }
    try {
      const mod = await loadAceModule('ace/ext/emmet');
      if (mod && typeof mod.setCore === 'function') mod.setCore(window.emmet);
      editor.setOption('enableEmmet', true);
      console.log('[ace-extras] Emmet enabled');
    } catch (err) {
      console.warn('[ace-extras] Emmet ext load failed:', err.message);
    }
  }

  // ── Wire it all up when Ace becomes available ──────────────────
  function init(editor) {
    if (!editor || !editor.commands) return;
    setupBeautify(editor);
    setupKeybindingMenu(editor);
    // Emmet activation is gated to the *currently active* emmetable file
    // when first triggered, but we initialise lazily so HTML/JSX users
    // don't pay the CDN cost until they actually have one of those files
    // open.
    let emmetTriggered = false;
    editor.on('changeSession', () => {
      if (emmetTriggered) return;
      if (activeFileIsEmmetable()) {
        emmetTriggered = true;
        setupEmmet(editor);
      }
    });
    // Also try once now in case a file is already open.
    if (activeFileIsEmmetable()) {
      emmetTriggered = true;
      setupEmmet(editor);
    }
  }

  bus.on('ace:ready', init);
})();
