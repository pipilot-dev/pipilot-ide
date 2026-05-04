// PiPilot IDE — "Made with PiPilot" badge dialog.
//
// Tiny modal that hands the user a Markdown snippet + an SVG download
// they can drop into a project README or landing page. The badge URL
// includes their referral code so any traffic from the badge is
// attributed back to them (compounds the referral loop nicely).
//
// Triggered from Settings → Account → "Get the badge" button.

(() => {
  const bus = window.PiPilot?.bus;
  if (!bus) return;

  // Self-contained inline SVG so we don't depend on a remote shields.io
  // service. Renders exactly the same in every README that embeds it.
  function buildBadgeSvg() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="28" role="img" aria-label="Made with PiPilot">
  <linearGradient id="g" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
    <stop offset="1" stop-opacity=".15"/>
  </linearGradient>
  <clipPath id="r"><rect width="160" height="28" rx="5" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="80"  height="28" fill="#1c1c22"/>
    <rect x="80" width="80" height="28" fill="#6e9fff"/>
    <rect width="160" height="28" fill="url(#g)"/>
  </g>
  <g fill="#fff" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="12" font-weight="600" text-anchor="middle">
    <text x="40"  y="18">Made with</text>
    <text x="120" y="18">PiPilot</text>
  </g>
</svg>`;
  }

  function inviteLink(login, referralCode) {
    const base = 'https://github.com/pipilot-dev/pipilot-ide';
    if (referralCode) return `${base}?r=${encodeURIComponent(referralCode)}`;
    if (login)        return `${base}?via=${encodeURIComponent(login)}`;
    return base;
  }

  // The Markdown snippet inlines the SVG via a data: URL. Keeps the
  // badge entirely self-hosted — no external image dependencies, works
  // even if pipilot-dev/pipilot-ide-badge is offline.
  function buildMarkdown(login, referralCode) {
    const link = inviteLink(login, referralCode);
    const svgB64 = btoa(unescape(encodeURIComponent(buildBadgeSvg())));
    return `[![Made with PiPilot](data:image/svg+xml;base64,${svgB64})](${link})`;
  }

  function injectStyles() {
    if (document.getElementById('badge-dialog-styles')) return;
    const st = document.createElement('style');
    st.id = 'badge-dialog-styles';
    st.textContent = `
      .bd-overlay {
        position: fixed; inset: 0; z-index: 90000;
        background: color-mix(in srgb, black 50%, transparent);
        backdrop-filter: blur(2px);
        display: grid; place-items: center;
        animation: bd-in 140ms ease-out;
      }
      @keyframes bd-in { from { opacity: 0; } to { opacity: 1; } }
      .bd-card {
        width: min(560px, calc(100vw - 48px));
        background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
        padding: 22px;
        font-family: var(--font-sans);
        color: var(--text);
        display: flex; flex-direction: column; gap: 16px;
      }
      .bd-card h2 {
        margin: 0; font-size: 16px; font-weight: 600;
        color: var(--text-strong); letter-spacing: -0.01em;
      }
      .bd-card .sub { margin: 0; font-size: 12.5px; color: var(--text-mid); line-height: 1.55; }
      .bd-preview {
        display: grid; place-items: center;
        padding: 18px; background: var(--bg);
        border: 1px solid var(--border); border-radius: 6px;
      }
      .bd-snippet {
        display: flex; flex-direction: column; gap: 6px;
      }
      .bd-snippet label { font-size: 11px; color: var(--text-dim); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; }
      .bd-snippet textarea {
        width: 100%; min-height: 76px; resize: vertical;
        background: var(--bg); border: 1px solid var(--border); color: var(--text);
        font-family: var(--font-mono); font-size: 11.5px; padding: 8px 10px; border-radius: 5px;
        outline: none;
      }
      .bd-snippet textarea:focus { border-color: var(--accent); }
      .bd-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .bd-btn {
        padding: 8px 14px; border-radius: 5px; font: inherit; font-size: 12px; cursor: pointer;
        border: 1px solid var(--border); background: var(--surface-alt); color: var(--text);
        transition: background 100ms, color 100ms;
      }
      .bd-btn:hover { background: var(--bg); color: var(--text-strong); }
      .bd-btn.primary { background: var(--text-strong); color: var(--bg); border-color: var(--text-strong); }
      .bd-btn.primary:hover { background: white; }
    `;
    document.head.appendChild(st);
  }

  function show(login, referralCode) {
    injectStyles();

    const root = document.createElement('div');
    root.className = 'bd-overlay';

    const md = buildMarkdown(login, referralCode);
    const svg = buildBadgeSvg();
    const svgUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));

    root.innerHTML = `
      <div class="bd-card" role="dialog" aria-modal="true">
        <div>
          <h2>"Made with PiPilot" badge</h2>
          <p class="sub">Drop this in your project's README. Visitors who click the badge land on PiPilot's GitHub${referralCode ? ' — and credit you with the referral.' : '.'}</p>
        </div>
        <div class="bd-preview"><img src="${svgUrl}" alt="Made with PiPilot" /></div>
        <div class="bd-snippet">
          <label>Markdown</label>
          <textarea readonly data-md></textarea>
        </div>
        <div class="bd-actions">
          <button class="bd-btn" data-action="download">Download SVG</button>
          <button class="bd-btn primary" data-action="copy">Copy markdown</button>
          <button class="bd-btn" data-action="close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    const ta = root.querySelector('[data-md]');
    ta.value = md;
    ta.addEventListener('focus', () => ta.select());

    const close = () => { try { root.remove(); } catch {} };
    root.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset?.action;
      if (action === 'close' || e.target === root) {
        close();
        return;
      }
      if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(md);
          const btn = e.target.closest('[data-action="copy"]');
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1200);
        } catch {}
      }
      if (action === 'download') {
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'pipilot-badge.svg';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
      }
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.badgeDialog = { show };
})();
