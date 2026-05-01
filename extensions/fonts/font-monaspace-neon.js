// PiPilot Font — Monaspace Neon (by GitHub)
// Modern monospace with texture healing and contextual ligatures.
// Loaded from cdn.jsdelivr as Google Fonts doesn't carry it.

(() => {
  const reg = window.PiPilot?.fonts?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'monaspace-neon',
      label: 'Monaspace Neon',
      family: '"Monaspace Neon"',
      url: 'https://cdn.jsdelivr.net/npm/monaspace-font@1.0.1/dist/Monaspace-Neon.css',
      ligatures: true,
    });
  } catch (err) { console.warn('[font-monaspace-neon] register failed:', err); }
})();
