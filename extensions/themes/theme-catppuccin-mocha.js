// PiPilot Theme — Catppuccin Mocha
// Soothing pastel palette from catppuccin.com.

(() => {
  const reg = window.PiPilot?.theme?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'catppuccin-mocha',
      label: 'Catppuccin Mocha',
      dark: true,
      aceTheme: 'dracula',
      cssVars: {
        '--bg': '#1e1e2e',
        '--surface': '#181825',
        '--surface-alt': '#11111b',
        '--surface-raised': '#313244',
        '--border': '#313244',
        '--border-hover': '#45475a',
        '--scrollbar-track-bg': '#11111b',
        '--text': '#cdd6f4',
        '--text-strong': '#f5e0dc',
        '--text-mid': '#a6adc8',
        '--text-dim': '#7f849c',
        '--text-faint': '#585b70',
        '--accent': '#cba6f7',
        '--accent-hover': '#d6b8ff',
        '--accent-light': '#e1c5ff',
        '--accent-dim': 'rgba(203,166,247,0.18)',
        '--warn': '#fab387',
        '--error': '#f38ba8',
        '--ok': '#a6e3a1',
        '--info': '#89b4fa',
      },
    });
  } catch (err) { console.warn('[theme-catppuccin-mocha] register failed:', err); }
})();
