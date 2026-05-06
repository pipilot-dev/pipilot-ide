// PiPilot IDE — Font registry + loader.
// Owns the list of monospace fonts the user can pick in Settings → General.
// Built-ins ship with the IDE; extensions can register their own via
// PiPilot.fonts.register(). Web-hosted fonts are lazy-loaded from a CDN
// the first time they're applied, then cached by the browser.
//
// Persistence mirrors theme.js: extension-registered fonts get cached in
// localStorage so they survive a relaunch even before the owning extension
// loads.

(() => {
  const bus = window.PiPilot?.bus;
  const api = window.electronAPI;
  if (!bus || !api) return;

  const FALLBACK_STACK = '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace';

  // Each entry:
  //   id        — unique slug (used in settings.fontFamily so we can map back)
  //   label     — picker display
  //   family    — CSS font-family value to apply (already quoted if needed)
  //   stack     — full fallback stack appended after `family`
  //   url       — optional CSS URL (e.g. Google Fonts) loaded the first time
  //               the font is applied; null = the user must already have it
  //   ligatures — true if the font has programming ligatures (calt+liga)
  //   source    — 'builtin' | 'extension' | 'cache'
  // Built-in fonts ship as bundled woff2 files under public/fonts/<id>/.
  // The bundles are generated at install time by scripts/copy-fonts.js
  // (postinstall hook). Works fully offline; ~520 KB total for the set.
  // Cascadia Code stays uninstalled — it's a Windows-system font and
  // isn't redistributable through @fontsource.
  const FONTS = [
    { id: 'jetbrains-mono',  label: 'JetBrains Mono',   family: '"JetBrains Mono"',   url: 'public/fonts/jetbrains-mono/index.css',  ligatures: true,  source: 'builtin' },
    { id: 'fira-code',       label: 'Fira Code',        family: '"Fira Code"',        url: 'public/fonts/fira-code/index.css',       ligatures: true,  source: 'builtin' },
    { id: 'cascadia-code',   label: 'Cascadia Code',    family: '"Cascadia Code"',    url: null,                                     ligatures: true,  source: 'builtin' },
    { id: 'ibm-plex-mono',   label: 'IBM Plex Mono',    family: '"IBM Plex Mono"',    url: 'public/fonts/ibm-plex-mono/index.css',   ligatures: false, source: 'builtin' },
    { id: 'source-code-pro', label: 'Source Code Pro',  family: '"Source Code Pro"',  url: 'public/fonts/source-code-pro/index.css', ligatures: false, source: 'builtin' },
    { id: 'roboto-mono',     label: 'Roboto Mono',      family: '"Roboto Mono"',      url: 'public/fonts/roboto-mono/index.css',     ligatures: false, source: 'builtin' },
    { id: 'inconsolata',     label: 'Inconsolata',      family: '"Inconsolata"',      url: 'public/fonts/inconsolata/index.css',     ligatures: false, source: 'builtin' },
    { id: 'space-mono',      label: 'Space Mono',       family: '"Space Mono"',       url: 'public/fonts/space-mono/index.css',      ligatures: false, source: 'builtin' },
    { id: 'ubuntu-mono',     label: 'Ubuntu Mono',      family: '"Ubuntu Mono"',      url: 'public/fonts/ubuntu-mono/index.css',     ligatures: false, source: 'builtin' },
    { id: 'dm-mono',         label: 'DM Mono',          family: '"DM Mono"',          url: 'public/fonts/dm-mono/index.css',         ligatures: false, source: 'builtin' },
  ];
  const DEFAULT_ID = 'jetbrains-mono';

  // Tracks per-font stylesheet load promises so the Ace push waits for
  // the <link> to actually parse before measuring. document.fonts.load
  // can't resolve a FontFace that hasn't been declared yet, so calling
  // it before the @font-face parses returns an empty set immediately
  // and Ace renders with the fallback.
  const loadPromises = new Map();
  function loadStylesheet(id, url) {
    if (!url) return Promise.resolve();
    if (loadPromises.has(id)) return loadPromises.get(id);
    const safeId = id.replace(/[^a-z0-9_-]/gi, '');
    let link = document.querySelector(`link[data-font-id="${safeId}"]`);
    const p = new Promise((resolve) => {
      if (link && link.sheet) return resolve();
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.setAttribute('data-font-id', safeId);
        document.head.appendChild(link);
      }
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => resolve(), { once: true });
      // Safety net: a stylesheet that's already cached may have fired
      // load before we attached the listener. Resolve after a frame if
      // the sheet is reachable.
      requestAnimationFrame(() => { if (link.sheet) resolve(); });
    });
    loadPromises.set(id, p);
    return p;
  }

  function find(idOrFamily) {
    if (!idOrFamily) return null;
    const exact = FONTS.find(f => f.id === idOrFamily);
    if (exact) return exact;
    // Try matching by family (e.g. settings.fontFamily contained '"Fira Code"').
    const norm = String(idOrFamily).toLowerCase();
    return FONTS.find(f => norm.includes(f.family.toLowerCase().replace(/"/g, '')))
        || null;
  }

  function buildStack(font) {
    return `${font.family}, ${FALLBACK_STACK}`;
  }

  // Whatever is in settings.fontFamily is what the editor uses. Built-in
  // fonts store their id (e.g. "fira-code"); custom strings are passed
  // through verbatim. apply() handles both.
  function apply(value, { fromSettings = true } = {}) {
    if (!value) value = DEFAULT_ID;
    const font = find(value);
    let cssValue;
    if (font) {
      loadStylesheet(font.id, font.url);
      cssValue = buildStack(font);
    } else {
      // Custom user value (raw CSS font-family stack) — apply as-is.
      cssValue = String(value);
    }
    // Set BOTH --font-mono AND --font-sans to the same stack so the
    // whole IDE switches font when the user picks one — sidebar, chat
    // panel, status bar, welcome tab, virtual tabs, etc. all inherit
    // from body { font-family: var(--font-sans) } in tokens.css.
    // Mono and sans pointing at the same coding font is the right
    // default ("PiPilot's font" rather than "PiPilot's editor font");
    // can split later via a separate "UI font" picker if needed.
    document.documentElement.style.setProperty('--font-mono', cssValue);
    document.documentElement.style.setProperty('--font-sans', cssValue);
    console.log('[fonts] apply', { value, family: font?.family, url: font?.url, css: cssValue });
    bus.emit('fonts:applied', { value, font, css: cssValue });
    return cssValue;
  }

  // ── Persistence cache (extension-registered fonts) ──────────────────
  const CACHE_KEY = 'pipilot.fonts.cache';
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function writeCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }
  function rememberInCache(entry) {
    if (entry.source === 'builtin') return;
    const cache = readCache();
    cache[entry.id] = {
      label: entry.label,
      family: entry.family,
      url: entry.url || null,
      ligatures: !!entry.ligatures,
    };
    writeCache(cache);
  }
  (function rehydrateCache() {
    const cache = readCache();
    for (const [id, entry] of Object.entries(cache)) {
      if (FONTS.some(f => f.id === id)) continue;
      FONTS.push({
        id, label: entry.label || id, family: entry.family || `"${id}"`,
        url: entry.url || null, ligatures: !!entry.ligatures, source: 'cache',
      });
    }
  })();

  // ── Public API ──────────────────────────────────────────────────────
  function register(font) {
    if (!font || typeof font.id !== 'string' || !font.id.trim()) {
      throw new Error('fonts.register: { id } is required');
    }
    const id = font.id.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      throw new Error(`fonts.register: id "${id}" must be a slug`);
    }
    if (FONTS.some(f => f.id === id && f.source === 'builtin')) {
      throw new Error(`fonts.register: cannot override built-in font "${id}"`);
    }
    if (!font.family || typeof font.family !== 'string') {
      throw new Error('fonts.register: { family } is required (CSS font-family value)');
    }
    const entry = {
      id,
      label: font.label || id,
      family: font.family.trim(),
      url: font.url || null,
      ligatures: !!font.ligatures,
      source: font.source || 'extension',
    };
    const idx = FONTS.findIndex(f => f.id === id);
    if (idx >= 0) FONTS[idx] = entry;
    else FONTS.push(entry);
    rememberInCache(entry);
    bus.emit('fonts:registry-updated', { fonts: list() });
    // If this font was the active selection, re-apply now that it's registered.
    const current = window.PiPilot?.state?.settings?.fontFamily;
    if (current && (current === id || current === entry.family)) apply(current);
    return true;
  }

  function unregister(id) {
    const idx = FONTS.findIndex(f => f.id === id);
    if (idx < 0) return false;
    if (FONTS[idx].source === 'builtin') return false;
    FONTS.splice(idx, 1);
    const cache = readCache();
    if (cache[id]) { delete cache[id]; writeCache(cache); }
    // Drop the loaded stylesheet so a re-install gets a fresh fetch.
    loaded.delete(id);
    document.querySelector(`link[data-font-id="${id.replace(/[^a-z0-9_-]/gi, '')}"]`)?.remove();
    // If active, fall back to default.
    const current = window.PiPilot?.state?.settings?.fontFamily;
    if (current === id) {
      apply(DEFAULT_ID);
      api.settings.set('fontFamily', DEFAULT_ID).catch(() => {});
      bus.emit('settings:changed', { key: 'fontFamily', value: DEFAULT_ID });
    }
    bus.emit('fonts:registry-updated', { fonts: list() });
    return true;
  }

  function list() {
    return FONTS.map(f => ({ id: f.id, label: f.label, family: f.family, url: f.url, ligatures: f.ligatures, source: f.source }));
  }

  // ── Ligature wiring ─────────────────────────────────────────────────
  // Toggles font-feature-settings on the Ace editor host so ligature-
  // capable fonts (Fira Code, JetBrains Mono, Cascadia Code) render
  // glyphs like => != === ≠ etc. as combined characters.
  function applyLigatures(on) {
    let st = document.getElementById('pipilot-font-ligatures');
    if (!st) {
      st = document.createElement('style');
      st.id = 'pipilot-font-ligatures';
      document.head.appendChild(st);
    }
    st.textContent = on
      ? `.ace_editor, .ace_editor * { font-feature-settings: 'calt' 1, 'liga' 1, 'clig' 1; font-variant-ligatures: contextual; }`
      : `.ace_editor, .ace_editor * { font-feature-settings: 'calt' 0, 'liga' 0, 'clig' 0; font-variant-ligatures: none; }`;
  }

  // ── Boot apply + settings sync ──────────────────────────────────────
  bus.on('settings:loaded', () => {
    const v = window.PiPilot?.state?.settings?.fontFamily || DEFAULT_ID;
    apply(v);
    applyLigatures(!!window.PiPilot?.state?.settings?.fontLigatures);
  });
  bus.on('settings:changed', (p) => {
    if (!p) return;
    if (p.key === 'fontFamily') apply(p.value);
    if (p.key === 'fontLigatures') applyLigatures(!!p.value);
  });

  // Push the resolved CSS into the Ace editor whenever a font is applied.
  // Two subtleties Ace doesn't handle for us:
  //   1. The web font may not have downloaded by the time setOption fires —
  //      Ace would render with the next fallback in the stack and the user
  //      sees no visual change. Wait for document.fonts.load() so the actual
  //      face is ready before we tell Ace to switch.
  //   2. Ace caches per-character measurements based on the previous font.
  //      setOption('fontFamily', X) updates the inline CSS but the cursor
  //      position / line widths stay stuck on the old metrics until a
  //      forced reflow. renderer.updateFontSize() invalidates the cache
  //      and triggers a full re-measure + redraw.
  bus.on('fonts:applied', async ({ css, font }) => {
    const editor = window.PiPilot?.editor?.getAce?.();
    if (!editor || !css) return;
    // 1. Wait for the @font-face stylesheet to finish parsing so
    //    document.fonts knows about the font we're about to load.
    if (font && font.url) {
      try { await loadStylesheet(font.id, font.url); } catch {}
    }
    // 2. Wait for the actual font face (regular weight) to download.
    if (font && font.family && document.fonts && typeof document.fonts.load === 'function') {
      try { await document.fonts.load(`14px ${font.family}`); } catch {}
    }
    // 3. Push to Ace + invalidate its character-metric cache so cursor
    //    position and line widths re-measure with the new font.
    try {
      editor.setOption('fontFamily', css);
      if (editor.renderer && typeof editor.renderer.updateFontSize === 'function') {
        editor.renderer.updateFontSize();
      }
    } catch {}
  });
  // Editor came up after fonts.js already ran — push the current font in.
  bus.on('ace:ready', () => {
    const v = window.PiPilot?.state?.settings?.fontFamily || DEFAULT_ID;
    apply(v);
    applyLigatures(!!window.PiPilot?.state?.settings?.fontLigatures);
  });

  window.PiPilot.fonts = {
    list,
    current: () => window.PiPilot?.state?.settings?.fontFamily || DEFAULT_ID,
    apply: (id) => {
      const css = apply(id);
      api.settings.set('fontFamily', id).catch(() => {});
      bus.emit('settings:changed', { key: 'fontFamily', value: id });
      return css;
    },
    register,
    unregister,
    DEFAULT_ID,
  };
})();
