// PiPilot Font — Geist Mono (by Vercel)
// Modern, technical monospace from the Geist type system.
// Loaded lazily from Google Fonts the first time it's applied.

(() => {
  const reg = window.PiPilot?.fonts?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'geist-mono',
      label: 'Geist Mono',
      family: '"Geist Mono"',
      url: 'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;700&display=swap',
      ligatures: false,
    });
  } catch (err) { console.warn('[font-geist-mono] register failed:', err); }
})();
