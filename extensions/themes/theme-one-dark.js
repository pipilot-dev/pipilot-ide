// PiPilot Theme — One Dark
// Atom's classic One Dark Pro palette.

(() => {
  const reg = window.PiPilot?.theme?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'one-dark',
      label: 'One Dark Pro',
      dark: true,
      aceTheme: 'one_dark',
      cssVars: {
        '--bg': '#282c34',
        '--surface': '#21252b',
        '--surface-alt': '#2c313a',
        '--surface-raised': '#353b45',
        '--border': '#3e4451',
        '--border-hover': '#525866',
        '--scrollbar-track-bg': '#1c1f24',
        '--text': '#abb2bf',
        '--text-strong': '#e6e6e6',
        '--text-mid': '#7d8590',
        '--text-dim': '#5c6370',
        '--text-faint': '#3e4451',
        '--accent': '#61afef',
        '--accent-hover': '#7ec0f4',
        '--accent-light': '#a3d3f9',
        '--accent-dim': 'rgba(97,175,239,0.18)',
        '--warn': '#e5c07b',
        '--error': '#e06c75',
        '--ok': '#98c379',
        '--info': '#56b6c2',
      },
    });
  } catch (err) { console.warn('[theme-one-dark] register failed:', err); }
})();
