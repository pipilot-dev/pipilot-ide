// PiPilot Theme — Tokyo Night
// Inspired by the colors of downtown Tokyo at night.
// Registers via the standard PiPilot.theme.register API; works with the
// Settings → General → Color Theme picker and persists across reloads.

(() => {
  const reg = window.PiPilot?.theme?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'tokyo-night',
      label: 'Tokyo Night',
      dark: true,
      aceTheme: 'tomorrow_night',
      cssVars: {
        '--bg': '#1a1b26',
        '--surface': '#1f2335',
        '--surface-alt': '#24283b',
        '--surface-raised': '#2a2f48',
        '--border': '#2a2f48',
        '--border-hover': '#3b4261',
        '--scrollbar-track-bg': '#16161e',
        '--text': '#a9b1d6',
        '--text-strong': '#c0caf5',
        '--text-mid': '#7982a9',
        '--text-dim': '#565f89',
        '--text-faint': '#3b4261',
        '--accent': '#7aa2f7',
        '--accent-hover': '#94b1f7',
        '--accent-light': '#bfd6ff',
        '--accent-dim': 'rgba(122,162,247,0.18)',
        '--warn': '#e0af68',
        '--error': '#f7768e',
        '--ok': '#9ece6a',
        '--info': '#7dcfff',
      },
    });
  } catch (err) { console.warn('[theme-tokyo-night] register failed:', err); }
})();
