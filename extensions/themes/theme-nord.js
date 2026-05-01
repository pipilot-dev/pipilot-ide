// PiPilot Theme — Nord
// Cool, arctic palette inspired by nordtheme.com.

(() => {
  const reg = window.PiPilot?.theme?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'nord',
      label: 'Nord',
      dark: true,
      aceTheme: 'nord_dark',
      cssVars: {
        '--bg': '#2e3440',
        '--surface': '#3b4252',
        '--surface-alt': '#434c5e',
        '--surface-raised': '#4c566a',
        '--border': '#434c5e',
        '--border-hover': '#5e6779',
        '--scrollbar-track-bg': '#252932',
        '--text': '#d8dee9',
        '--text-strong': '#eceff4',
        '--text-mid': '#8b95a6',
        '--text-dim': '#6c7689',
        '--text-faint': '#4c566a',
        '--accent': '#88c0d0',
        '--accent-hover': '#9bcdd9',
        '--accent-light': '#b3d8e2',
        '--accent-dim': 'rgba(136,192,208,0.18)',
        '--warn': '#ebcb8b',
        '--error': '#bf616a',
        '--ok': '#a3be8c',
        '--info': '#81a1c1',
      },
    });
  } catch (err) { console.warn('[theme-nord] register failed:', err); }
})();
