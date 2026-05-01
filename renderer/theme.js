// PiPilot IDE — Theme manager.
// One source of truth for the available themes; reads/writes settings.theme,
// sets <html data-theme="…">, and swaps the Ace editor theme to match.
// Token CSS lives in styles/tokens.css (see [data-theme="…"] blocks).

(() => {
  const bus = window.PiPilot?.bus;
  const api = window.electronAPI;
  if (!bus || !api) return;

  // Each entry: id matches a [data-theme="…"] block in tokens.css OR an
  // injected <style data-theme-id="…"> block from an extension.
  // aceTheme is loaded lazily from the Ace CDN — themePath was set by
  // ace-editor.js when it configured workerPath.
  const THEMES = [
    { id: 'midnight',         label: 'Midnight Studio',  aceTheme: 'midnight',                 dark: true,  source: 'builtin' },
    { id: 'carbon',           label: 'Carbon',           aceTheme: 'tomorrow_night_eighties',  dark: true,  source: 'builtin' },
    { id: 'dracula',          label: 'Dracula',          aceTheme: 'dracula',                  dark: true,  source: 'builtin' },
    { id: 'github-dark',      label: 'GitHub Dark',      aceTheme: 'github_dark',              dark: true,  source: 'builtin' },
    { id: 'solarized-dark',   label: 'Solarized Dark',   aceTheme: 'solarized_dark',           dark: true,  source: 'builtin' },
    { id: 'solarized-light',  label: 'Solarized Light',  aceTheme: 'solarized_light',          dark: false, source: 'builtin' },
  ];
  const DEFAULT = 'midnight';

  function find(id) { return THEMES.find(t => t.id === id) || THEMES[0]; }

  function apply(id, { saveAce = true } = {}) {
    const theme = find(id);
    document.documentElement.setAttribute('data-theme', theme.id);
    document.documentElement.classList.toggle('theme-light', !theme.dark);
    // Push the saved tab color hint to anything listening (titlebar etc).
    bus.emit('theme:applied', { id: theme.id, dark: theme.dark, aceTheme: theme.aceTheme });
    if (saveAce) applyAceTheme(theme.aceTheme);
  }

  function applyAceTheme(aceThemeName) {
    const editor = window.PiPilot?.editor?.getAce?.();
    if (!editor) return;
    try { editor.setTheme(`ace/theme/${aceThemeName}`); }
    catch (err) { console.warn('[theme] setTheme failed:', aceThemeName, err); }
  }

  // ── Persistence cache ───────────────────────────────────────────────
  // Extension-contributed themes register their CSS at extension-load
  // time, which happens AFTER theme.js's early apply at boot. To prevent
  // a flash of unstyled / wrong-themed UI when the user has selected an
  // extension theme, we cache the last-seen CSS body + ace-theme name +
  // dark flag in localStorage and replay them on boot — long before the
  // owning extension actually loads. The extension's eventual register()
  // call overwrites the cache with the live values.
  const CACHE_KEY = 'pipilot.theme.cache';
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function writeCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }
  function rememberInCache(id, entry) {
    if (entry.source === 'builtin') return; // builtins live in tokens.css already
    const cache = readCache();
    cache[id] = {
      css: document.querySelector(`style[data-theme-id="${id.replace(/[^a-z0-9_-]/gi, '')}"]`)?.textContent || '',
      label: entry.label,
      dark: !!entry.dark,
      aceTheme: entry.aceTheme,
    };
    writeCache(cache);
  }
  function rehydrateCache() {
    const cache = readCache();
    for (const [id, entry] of Object.entries(cache)) {
      if (THEMES.some(t => t.id === id)) continue; // already registered
      if (entry.css) {
        const el = document.createElement('style');
        el.setAttribute('data-theme-id', id);
        el.setAttribute('data-cached', '1');
        el.textContent = entry.css;
        document.head.appendChild(el);
      }
      THEMES.push({
        id, label: entry.label || id, dark: !!entry.dark,
        aceTheme: entry.aceTheme || 'tomorrow_night',
        source: 'cache', // will be replaced with 'extension' when register() fires
      });
    }
  }
  rehydrateCache();

  // Apply early — even before settings load — using a synchronous guess
  // from localStorage so there's no white flash. ipc.js seeds
  // PiPilot.state.settings.theme from settings.json once it loads, at
  // which point we re-apply if it differs.
  const earlyId = (() => {
    try {
      const raw = localStorage.getItem('pipilot.theme.preview');
      if (raw && find(raw)) return raw;
    } catch {}
    return DEFAULT;
  })();
  apply(earlyId, { saveAce: false });

  bus.on('settings:loaded', () => {
    const t = window.PiPilot?.state?.settings?.theme || DEFAULT;
    apply(t);
    try { localStorage.setItem('pipilot.theme.preview', t); } catch {}
  });
  bus.on('settings:changed', (p) => {
    if (!p || p.key !== 'theme') return;
    apply(p.value || DEFAULT);
    try { localStorage.setItem('pipilot.theme.preview', p.value || DEFAULT); } catch {}
  });
  bus.on('ace:ready', () => {
    // Editor came up after theme.js ran — push the current ace theme now.
    const id = document.documentElement.getAttribute('data-theme') || DEFAULT;
    applyAceTheme(find(id).aceTheme);
  });

  // ── Extension API ───────────────────────────────────────────────────
  // Themes contributed by extensions live in the same THEMES array — the
  // Settings picker, terminal palette derivation, ace-theme swap, and
  // "current()" all see them transparently. CSS is injected as a
  // <style data-theme-id="<id>"> element so unregister can clean up.
  function buildThemeCss(id, vars) {
    const lines = Object.entries(vars || {}).map(([k, v]) => {
      const key = k.startsWith('--') ? k : `--${k}`;
      return `  ${key}: ${v};`;
    }).join('\n');
    return `[data-theme="${id}"] {\n${lines}\n}\n`;
  }
  function injectThemeCss(id, cssText) {
    let el = document.querySelector(`style[data-theme-id="${CSS.escape(id)}"]`);
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('data-theme-id', id);
      document.head.appendChild(el);
    }
    el.textContent = cssText;
  }
  function register(theme) {
    if (!theme || typeof theme.id !== 'string' || !theme.id.trim()) {
      throw new Error('theme.register: { id } is required');
    }
    const id = theme.id.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      throw new Error(`theme.register: id "${id}" must be a slug (a-z0-9_-)`);
    }
    if (THEMES.some(t => t.id === id && t.source === 'builtin')) {
      throw new Error(`theme.register: cannot override built-in theme "${id}"`);
    }
    const cssText = theme.css || (theme.cssVars ? buildThemeCss(id, theme.cssVars) : null);
    if (cssText) injectThemeCss(id, cssText);
    const entry = {
      id,
      label: theme.label || id,
      dark: theme.dark !== false,
      aceTheme: theme.aceTheme || (theme.dark === false ? 'solarized_light' : 'tomorrow_night'),
      source: theme.source || 'extension',
    };
    const existingIdx = THEMES.findIndex(t => t.id === id);
    if (existingIdx >= 0) THEMES[existingIdx] = entry;
    else THEMES.push(entry);
    rememberInCache(id, entry);
    bus.emit('themes:registry-updated', { themes: THEMES.map(t => ({ id: t.id, label: t.label, dark: t.dark, source: t.source })) });
    // Re-apply if this theme was the active one (e.g. extension reloaded with new vars)
    if ((document.documentElement.getAttribute('data-theme') || DEFAULT) === id) apply(id);
    return true;
  }
  function unregister(id) {
    const idx = THEMES.findIndex(t => t.id === id);
    if (idx < 0) return false;
    if (THEMES[idx].source === 'builtin') return false;
    THEMES.splice(idx, 1);
    try { document.querySelector(`style[data-theme-id="${CSS.escape(id)}"]`)?.remove(); } catch {}
    const cache = readCache();
    if (cache[id]) { delete cache[id]; writeCache(cache); }
    if ((document.documentElement.getAttribute('data-theme') || DEFAULT) === id) {
      apply(DEFAULT);
      api.settings.set('theme', DEFAULT).catch(() => {});
    }
    bus.emit('themes:registry-updated', { themes: THEMES.map(t => ({ id: t.id, label: t.label, dark: t.dark, source: t.source })) });
    return true;
  }

  window.PiPilot.theme = {
    list: () => THEMES.map(t => ({ id: t.id, label: t.label, dark: t.dark, source: t.source })),
    current: () => document.documentElement.getAttribute('data-theme') || DEFAULT,
    apply: (id) => {
      apply(id);
      try { localStorage.setItem('pipilot.theme.preview', id); } catch {}
      api.settings.set('theme', id).catch(() => {});
      bus.emit('settings:changed', { key: 'theme', value: id });
    },
    register,
    unregister,
  };
})();
