// PiPilot Theme — Monokai Pro
// The classic Monokai palette refined for everyday use.

(() => {
  const reg = window.PiPilot?.theme?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'monokai-pro',
      label: 'Monokai Pro',
      dark: true,
      aceTheme: 'monokai',
      cssVars: {
        '--bg': '#2d2a2e',
        '--surface': '#221f22',
        '--surface-alt': '#363237',
        '--surface-raised': '#403e41',
        '--border': '#5b595c',
        '--border-hover': '#727072',
        '--scrollbar-track-bg': '#19181a',
        '--text': '#fcfcfa',
        '--text-strong': '#ffffff',
        '--text-mid': '#c1c0c0',
        '--text-dim': '#939293',
        '--text-faint': '#5b595c',
        '--accent': '#ffd866',
        '--accent-hover': '#ffe18a',
        '--accent-light': '#ffe9a8',
        '--accent-dim': 'rgba(255,216,102,0.18)',
        '--warn': '#fc9867',
        '--error': '#ff6188',
        '--ok': '#a9dc76',
        '--info': '#78dce8',
      },
    });
  } catch (err) { console.warn('[theme-monokai-pro] register failed:', err); }
})();
