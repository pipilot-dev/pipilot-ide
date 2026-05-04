// PiPilot IDE — Login screen.
//
// Shown on app boot when no JWT is on disk, or when the proxy returns 401
// (token expired / revoked). Blocks the UI: no chat, no agent, no editor.
//
// UX is GitHub Device Flow style:
//   1. Display the user_code in a big font + Copy button
//   2. Auto-open the verification URL in the user's default browser
//   3. Poll every ~5 s, dismiss on success
//
// Exports:
//   PiPilot.auth.requireAuth() → Promise that resolves when the user is
//                                 authenticated. Used by app.js boot().
//   PiPilot.auth.show()        → manual re-show (for "Sign out" → "Sign in" cycle)

(() => {
  const api = window.electronAPI;
  if (!api?.auth) {
    console.warn('[auth] electronAPI.auth missing — preload not loaded?');
    return;
  }

  function injectStyles() {
    if (document.getElementById('auth-screen-styles')) return;
    const link = document.createElement('link');
    link.id = 'auth-screen-styles';
    link.rel = 'stylesheet';
    link.href = 'styles/auth-screen.css';
    document.head.appendChild(link);
  }

  let activePoll = null;
  let resolveCurrent = null;
  let overlayEl = null;

  function buildOverlay() {
    const root = document.createElement('div');
    root.className = 'auth-overlay';
    root.innerHTML = `
      <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div class="auth-brand">
          <div class="auth-logo">P</div>
          <div class="auth-title-block">
            <h1 id="auth-title">Sign in to PiPilot</h1>
            <p class="auth-sub">Authenticate with GitHub to unlock the AI agent.</p>
          </div>
        </div>

        <div class="auth-body" data-state="idle">
          <div class="auth-step" data-step="idle">
            <p class="auth-blurb">
              You'll be redirected to GitHub to authorise PiPilot. Your code stays on your machine —
              we only get your username, email, and a short-lived token.
            </p>
            <details class="auth-referral">
              <summary>Got an invite code?</summary>
              <input type="text" class="auth-referral-input" data-referral-input
                     placeholder="pp-xxxxxxxx" autocomplete="off" autocapitalize="off"
                     spellcheck="false" maxlength="14" />
              <span class="auth-referral-hint">Adds +20 chat turns/day for both you and your inviter once you send your first message.</span>
            </details>
            <button class="auth-primary" data-action="start">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-2.13c-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
              <span>Continue with GitHub</span>
            </button>
            <button class="auth-tertiary" data-action="quit">Quit</button>
          </div>

          <div class="auth-step" data-step="code" hidden>
            <p class="auth-instructions">
              Enter this code at <strong data-uri-host>github.com/login/device</strong>:
            </p>
            <div class="auth-code-row">
              <code class="auth-code" data-user-code>————</code>
              <button class="auth-icon-btn" data-action="copy" title="Copy code">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
            <div class="auth-status" data-status>
              <div class="auth-spinner"></div>
              <span data-status-text>Waiting for you to authorise PiPilot on GitHub…</span>
            </div>
            <div class="auth-actions">
              <button class="auth-secondary" data-action="open">
                Open GitHub
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </button>
              <button class="auth-tertiary" data-action="cancel">Cancel</button>
            </div>
          </div>

          <div class="auth-step" data-step="error" hidden>
            <div class="auth-error" data-error-text>Something went wrong.</div>
            <button class="auth-primary" data-action="retry">Try again</button>
            <button class="auth-tertiary" data-action="quit">Quit</button>
          </div>
        </div>

        <div class="auth-footer">
          <span>Free tier · Unlimited turns · No credit card</span>
        </div>
      </div>
    `;
    return root;
  }

  function setStep(step) {
    if (!overlayEl) return;
    overlayEl.querySelectorAll('.auth-step').forEach((el) => {
      el.hidden = el.dataset.step !== step;
    });
    overlayEl.querySelector('.auth-body').dataset.state = step;
  }

  function setStatus(text, kind = 'info') {
    if (!overlayEl) return;
    const t = overlayEl.querySelector('[data-status-text]');
    if (t) t.textContent = text;
    const s = overlayEl.querySelector('[data-status]');
    if (s) s.dataset.kind = kind;
  }

  function setError(message) {
    if (!overlayEl) return;
    const el = overlayEl.querySelector('[data-error-text]');
    if (el) el.textContent = message;
    setStep('error');
  }

  async function startFlow() {
    setStep('idle');
    setStatus('Starting…');
    // Pull the optional referral code from the input. Only `pp-xxxxxxxx`
    // shape is forwarded — anything else is silently ignored so a typo
    // doesn't break the flow.
    let referralCode = '';
    try {
      const v = (overlayEl?.querySelector('[data-referral-input]')?.value || '').trim();
      if (/^pp-[a-f0-9]{8}$/i.test(v)) referralCode = v.toLowerCase();
    } catch {}
    const res = await api.auth.start(referralCode ? { referralCode } : {});
    if (!res?.ok) {
      setError('Could not reach the auth service: ' + (res?.error || 'unknown'));
      return;
    }
    overlayEl.querySelector('[data-user-code]').textContent = res.user_code;
    try {
      const url = new URL(res.verification_uri);
      overlayEl.querySelector('[data-uri-host]').textContent = url.host + url.pathname;
    } catch {
      overlayEl.querySelector('[data-uri-host]').textContent = res.verification_uri;
    }
    overlayEl.dataset.verificationUri = res.verification_uri_complete || res.verification_uri;
    setStep('code');

    // Auto-open the verification URL on first start. The user can click
    // "Open GitHub" again if it didn't fire (some Linux desktops are
    // weird about default browsers).
    api.shell?.openExternal?.(overlayEl.dataset.verificationUri);

    beginPolling(res.interval || 5);
  }

  function beginPolling(intervalSeconds) {
    if (activePoll) clearTimeout(activePoll);
    let interval = Math.max(2, intervalSeconds);

    const tick = async () => {
      const res = await api.auth.poll();
      if (!res?.ok) {
        setStatus('Network error: ' + (res?.error || 'unknown') + ' · retrying…', 'warn');
        activePoll = setTimeout(tick, interval * 1000);
        return;
      }
      if (res.status === 'authorized') {
        setStatus('Signed in. Welcome aboard.', 'ok');
        // Tell the rest of the app — chat panel removes its sign-in banner,
        // settings refreshes the account section, etc.
        try { window.dispatchEvent(new CustomEvent('pipilot:auth-changed', { detail: { authenticated: true } })); } catch {}
        // Brief pause so the user sees the success state, then dismiss.
        setTimeout(() => {
          dismiss();
          if (resolveCurrent) { resolveCurrent(); resolveCurrent = null; }
        }, 600);
        return;
      }
      if (res.status === 'expired') {
        setError('That code expired. Start over.');
        return;
      }
      if (res.status === 'denied') {
        setError('You denied the authorization request. Try again to continue.');
        return;
      }
      // pending — keep waiting
      if (res.slow_down) interval = Math.min(60, interval + 5);
      activePoll = setTimeout(tick, interval * 1000);
    };

    activePoll = setTimeout(tick, interval * 1000);
  }

  function stopPolling() {
    if (activePoll) { clearTimeout(activePoll); activePoll = null; }
  }

  function dismiss() {
    stopPolling();
    if (overlayEl) {
      overlayEl.classList.add('auth-overlay-leaving');
      setTimeout(() => { overlayEl?.remove(); overlayEl = null; }, 200);
    }
  }

  async function show() {
    injectStyles();
    if (overlayEl) return;
    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);

    overlayEl.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset?.action;
      if (!action) return;

      if (action === 'start' || action === 'retry') {
        await startFlow();
      } else if (action === 'open') {
        const uri = overlayEl.dataset.verificationUri;
        if (uri) api.shell?.openExternal?.(uri);
      } else if (action === 'copy') {
        const code = overlayEl.querySelector('[data-user-code]').textContent;
        try {
          await navigator.clipboard.writeText(code);
          const btn = e.target.closest('[data-action="copy"]');
          btn.classList.add('auth-copied');
          setTimeout(() => btn.classList.remove('auth-copied'), 900);
        } catch {}
      } else if (action === 'cancel') {
        await api.auth.cancel();
        setStep('idle');
        stopPolling();
      } else if (action === 'quit') {
        api.window?.close?.();
      }
    });

    setStep('idle');
  }

  // Block the boot sequence until the user is authenticated. If a token
  // is already on disk, resolve immediately without showing anything.
  async function requireAuth() {
    const status = await api.auth.getStatus();
    if (status?.authenticated) return;

    return new Promise((resolve) => {
      resolveCurrent = resolve;
      show();
    });
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.auth = {
    requireAuth,
    show,
    signOut: async () => {
      await api.auth.signOut();
      // Force a relaunch-style re-prompt — easier than tearing down all the
      // renderer state cleanly.
      location.reload();
    },
  };
})();
