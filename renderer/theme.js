// PiPilot IDE — Theme manager.
// One source of truth for the available themes; reads/writes settings.theme,
// sets <html data-theme="…">, and swaps the Ace editor theme to match.
// Token CSS lives in styles/tokens.css (see [data-theme="…"] blocks).

(() => {
  const bus = window.PiPilot?.bus;
  const api = window.electronAPI;
  if (!bus || !api) return;

  // Each entry: id matches a [data-theme="…"] block in tokens.css.
  // aceTheme is loaded lazily from the Ace CDN — themePath was set by
  // ace-editor.js when it configured workerPath.
  const THEMES = [
    { id: 'midnight',         label: 'Midnight Studio',  aceTheme: 'midnight',                 dark: true  },
    { id: 'carbon',           label: 'Carbon',           aceTheme: 'tomorrow_night_eighties',  dark: true  },
    { id: 'dracula',          label: 'Dracula',          aceTheme: 'dracula',                  dark: true  },
    { id: 'github-dark',      label: 'GitHub Dark',      aceTheme: 'github_dark',              dark: true  },
    { id: 'solarized-dark',   label: 'Solarized Dark',   aceTheme: 'solarized_dark',           dark: true  },
    { id: 'solarized-light',  label: 'Solarized Light',  aceTheme: 'solarized_light',          dark: false },
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

  window.PiPilot.theme = {
    list: () => THEMES.map(t => ({ id: t.id, label: t.label, dark: t.dark })),
    current: () => document.documentElement.getAttribute('data-theme') || DEFAULT,
    apply: (id) => {
      apply(id);
      try { localStorage.setItem('pipilot.theme.preview', id); } catch {}
      api.settings.set('theme', id).catch(() => {});
      bus.emit('settings:changed', { key: 'theme', value: id });
    },
  };
})();
