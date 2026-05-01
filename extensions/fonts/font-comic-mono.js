// PiPilot Font — Comic Mono
// A monospaced version of Comic Sans, by Shannon Miwa & dtinth.
// Surprisingly readable, weirdly fun for casual sessions.

(() => {
  const reg = window.PiPilot?.fonts?.register;
  if (typeof reg !== 'function') return;
  try {
    reg({
      id: 'comic-mono',
      label: 'Comic Mono',
      family: '"Comic Mono"',
      url: 'https://cdn.jsdelivr.net/npm/comic-mono-font@1.0.0/comic-mono.css',
      ligatures: false,
    });
  } catch (err) { console.warn('[font-comic-mono] register failed:', err); }
})();
