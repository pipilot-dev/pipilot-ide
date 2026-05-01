// PiPilot IDE — Deploy virtual editor tab.
// One-stop hub for shipping the current project. v1 covers code hosting
// (GitHub + GitLab one-click create+push). Cloud deploy providers and
// dev-server merge come in subsequent passes.

(() => {
  const bus = window.PiPilot?.bus;
  const api = window.electronAPI;
  if (!bus || !api) return;

  const TAB_ID = 'pipilot-deploy://main';

  function injectStyles() {
    if (document.getElementById('deploy-tab-styles')) return;
    const st = document.createElement('style');
    st.id = 'deploy-tab-styles';
    st.textContent = `
      .dt-root { width:100%; height:100%; overflow:auto; background:var(--bg); color:var(--text); font-family:var(--font-sans); }
      .dt-shell { max-width:960px; margin:0 auto; padding:32px 40px 80px; display:flex; flex-direction:column; gap:24px; }
      .dt-hero { display:flex; align-items:center; gap:18px; padding:18px 22px; border:1px solid var(--border); border-radius:10px; background:var(--surface); }
      .dt-hero-icon {
        width:44px; height:44px; border-radius:10px; background:var(--accent-dim);
        color:var(--accent); display:flex; align-items:center; justify-content:center;
        font-size:22px; flex:0 0 auto;
      }
      .dt-hero-info { flex:1; min-width:0; }
      .dt-hero-name { font-size:17px; font-weight:600; color:var(--text-strong); letter-spacing:-0.005em; }
      .dt-hero-meta { font-size:12px; color:var(--text-dim); margin-top:3px; display:flex; gap:14px; flex-wrap:wrap; }
      .dt-hero-meta .pill { display:inline-flex; align-items:center; gap:6px; padding:2px 9px; border-radius:999px; background:var(--surface-alt); color:var(--text-mid); font-size:11px; font-variant-numeric:tabular-nums; }
      .dt-hero-meta .pill.ok { color:var(--ok); background:color-mix(in srgb, var(--ok) 15%, transparent); }
      .dt-hero-meta .pill.warn { color:var(--warn); background:color-mix(in srgb, var(--warn) 15%, transparent); }

      .dt-section { display:flex; flex-direction:column; gap:10px; }
      .dt-section-h {
        display:flex; align-items:baseline; gap:10px;
        font-size:11px; color:var(--text-dim); text-transform:uppercase;
        letter-spacing:0.06em; font-weight:600; padding:0 2px;
      }
      .dt-section-h .num { font-variant-numeric:tabular-nums; opacity:0.5; }

      .dt-cards { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      @media (max-width:760px) { .dt-cards { grid-template-columns:1fr; } }
      .dt-card {
        background:var(--surface); border:1px solid var(--border); border-radius:10px;
        padding:18px 20px; display:flex; flex-direction:column; gap:14px;
        transition:border-color 140ms;
      }
      .dt-card:hover { border-color:var(--border-hover); }
      .dt-card-head { display:flex; align-items:center; gap:12px; }
      .dt-card-icon { font-size:24px; flex:0 0 auto; }
      .dt-card-title { flex:1; }
      .dt-card-name { font-size:14px; font-weight:600; color:var(--text-strong); }
      .dt-card-desc { font-size:11.5px; color:var(--text-dim); margin-top:1px; }
      .dt-card-status {
        font-size:10.5px; padding:2px 8px; border-radius:999px;
        font-weight:500; letter-spacing:0.03em; text-transform:uppercase;
      }
      .dt-card-status.connected { color:var(--ok); background:color-mix(in srgb, var(--ok) 15%, transparent); }
      .dt-card-status.disconnected { color:var(--text-dim); background:var(--overlay-2); }
      .dt-card-account {
        display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-mid);
        padding:8px 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px;
      }
      .dt-card-account img { width:20px; height:20px; border-radius:50%; }
      .dt-card-actions { display:flex; gap:8px; }
      .dt-btn {
        all:unset; cursor:pointer; flex:1; text-align:center;
        padding:8px 14px; font-size:12.5px; font-weight:500;
        border-radius:6px; transition:background 120ms, color 120ms, border-color 120ms;
        border:1px solid var(--border); color:var(--text); background:var(--surface-alt);
      }
      .dt-btn:hover:not(:disabled) { background:var(--surface-raised); color:var(--text-strong); }
      .dt-btn:disabled { opacity:0.4; cursor:default; }
      .dt-btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
      .dt-btn.primary:hover:not(:disabled) { background:var(--accent-hover); border-color:var(--accent-hover); }
      .dt-btn.danger { color:var(--error); }

      /* Dialog overlay used by Connect + Push prompts */
      .dt-dialog-bg {
        position:fixed; inset:0; z-index:1000;
        background:rgba(0,0,0,0.45); backdrop-filter:blur(2px);
        display:flex; align-items:center; justify-content:center;
        animation:dt-fade 140ms ease;
      }
      @keyframes dt-fade { from { opacity:0; } to { opacity:1; } }
      .dt-dialog {
        background:var(--surface-raised); border:1px solid var(--border);
        border-radius:10px; box-shadow:var(--shadow-lg);
        width:min(440px, calc(100vw - 32px)); padding:22px 24px;
        display:flex; flex-direction:column; gap:14px;
      }
      .dt-dialog h3 { font-size:15px; color:var(--text-strong); font-weight:600; margin:0; }
      .dt-dialog .lead { font-size:12px; color:var(--text-dim); line-height:1.5; margin:-6px 0 0; }
      .dt-dialog label { font-size:11.5px; color:var(--text-mid); display:flex; flex-direction:column; gap:4px; }
      .dt-dialog input[type=text], .dt-dialog input[type=password], .dt-dialog textarea, .dt-dialog select {
        background:var(--bg); border:1px solid var(--border); color:var(--text);
        padding:6px 10px; border-radius:5px; font:inherit; font-size:12.5px;
        font-family:var(--font-sans);
      }
      .dt-dialog input[type=text]:focus, .dt-dialog input[type=password]:focus, .dt-dialog textarea:focus, .dt-dialog select:focus { outline:none; border-color:var(--accent); }
      .dt-dialog textarea { font-family:inherit; resize:vertical; min-height:60px; }
      .dt-dialog .row { display:flex; gap:10px; align-items:center; }
      .dt-dialog .row.toggle { font-size:12.5px; color:var(--text); cursor:pointer; }
      .dt-dialog .row.toggle input { width:14px; height:14px; cursor:pointer; }
      .dt-dialog .actions { display:flex; gap:8px; margin-top:6px; justify-content:flex-end; }
      .dt-error { color:var(--error); font-size:11.5px; padding:8px 10px; background:color-mix(in srgb, var(--error) 12%, transparent); border-radius:5px; }

      /* Last-deploy summary inside cloud cards */
      .dt-deploy-last { display:flex; align-items:center; gap:10px; font-size:11.5px; padding:8px 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px; }
      .dt-deploy-pill {
        font-size:10px; font-weight:600; padding:1px 7px; border-radius:999px; letter-spacing:0.04em; text-transform:uppercase;
      }
      .dt-deploy-pill.success { color:var(--ok); background:color-mix(in srgb, var(--ok) 15%, transparent); }
      .dt-deploy-pill.error   { color:var(--error); background:color-mix(in srgb, var(--error) 15%, transparent); }
      .dt-deploy-url { color:var(--accent); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dt-deploy-when { color:var(--text-dim); font-size:10.5px; flex:0 0 auto; }

      /* Dev servers list */
      .dt-dev-list { display:flex; flex-direction:column; gap:6px; }
      .dt-dev-row { display:flex; align-items:center; gap:10px; padding:6px 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px; font-size:12px; }
      .dt-dev-status { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
      .dt-dev-status.ok { background:var(--ok); box-shadow:0 0 6px color-mix(in srgb, var(--ok) 60%, transparent); animation:dt-pulse 2s ease-in-out infinite; }
      @keyframes dt-pulse { 0%,100% { opacity:1; } 50% { opacity:0.55; } }
      .dt-dev-url { color:var(--accent); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dt-dev-cmd { font-family:var(--font-mono); font-size:10.5px; color:var(--text-dim); flex:0 0 auto; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* Live progress log */
      .dt-log {
        background:var(--bg); border:1px solid var(--border); border-radius:6px;
        font-family:var(--font-mono); font-size:11.5px; line-height:1.55;
        padding:10px 12px; max-height:240px; overflow:auto;
        color:var(--text-mid); white-space:pre-wrap;
      }
      .dt-log .step { color:var(--accent); }
      .dt-log .ok { color:var(--ok); font-weight:600; }
      .dt-log .err { color:var(--error); }
    `;
    document.head.appendChild(st);
  }

  // ── Cloud provider catalog ────────────────────────────────────────
  // Static UI metadata; the actual deploy runs via api.deploy.run which
  // shells out to the provider's CLI under main/ipc-deploy.js. "wired"
  // means we have a working spawn adapter; the rest are surfaced as
  // "coming soon" placeholders so the connection flow still works.
  const CLOUD_PROVIDERS = [
    { id: 'vercel',     name: 'Vercel',           icon: '▲',  desc: 'Frontend + serverless',  wired: true,  authUrl: 'https://vercel.com/account/tokens' },
    { id: 'netlify',    name: 'Netlify',          icon: '◈',  desc: 'JAMstack + functions',    wired: true,  authUrl: 'https://app.netlify.com/user/applications#personal-access-tokens' },
    { id: 'cloudflare', name: 'Cloudflare Pages', icon: '☁',  desc: 'Edge static + Workers',  wired: true,  authUrl: 'https://dash.cloudflare.com/profile/api-tokens' },
    { id: 'railway',    name: 'Railway',          icon: '🚂', desc: 'Full-stack PaaS',         wired: true,  authUrl: 'https://railway.com/account/tokens' },
    { id: 'render',     name: 'Render',           icon: '◉',  desc: 'Static + servers + DBs',  wired: false, authUrl: 'https://dashboard.render.com/u/settings#api-keys' },
  ];

  // ── State ─────────────────────────────────────────────────────────
  const state = {
    project: null,        // { name, path, state: { initialized, branch, hasCommits, lastCommit, remotes } }
    accounts: { github: null, gitlab: null },
    cloud: {},            // { providerId: { connected: bool, history: [] } }
    devServers: [],       // [{ id, projectPath, url, port, ... }]
  };

  function projectPath() { return window.PiPilot?.state?.projectPath || ''; }

  async function loadAll() {
    const p = projectPath();
    if (p) {
      try {
        const r = await api.publish.getState(p);
        if (r?.ok) state.project = { name: r.projectName, path: p, state: r.state };
        else state.project = { name: '(no project)', path: '', state: null };
      } catch { state.project = { name: '(no project)', path: '', state: null }; }
    } else {
      state.project = { name: '(no project open)', path: '', state: null };
    }
    state.accounts.github = await api.github.whoami().catch(() => ({ ok: false }));
    state.accounts.gitlab = await api.gitlab.whoami().catch(() => ({ ok: false }));

    // Cloud connectors — read which have a saved token from the existing
    // cloud-tokens store, plus per-provider deploy history.
    let connectors = [];
    try { const r = await api.cloud.listConnectors(); connectors = r?.connectors || []; } catch {}
    let history = {};
    try { const r = await api.deploy.history(); history = r?.history || {}; } catch {}
    state.cloud = {};
    for (const cp of CLOUD_PROVIDERS) {
      const conn = connectors.find(c => c.id === cp.id);
      state.cloud[cp.id] = {
        connected: !!conn?.connected,
        username: conn?.meta?.username || null,
        history: history[cp.id] || [],
      };
    }

    // Dev servers (only for the current project)
    try {
      const r = await api.devServer.list();
      const all = r?.servers || r || [];
      state.devServers = (Array.isArray(all) ? all : []).filter(s => !p || s.projectPath === p);
    } catch { state.devServers = []; }
  }

  // ── Render ────────────────────────────────────────────────────────
  function renderInto(container) {
    const project = state.project || { name: '(no project)', state: null };
    const gh = state.accounts.github || { ok: false };
    const gl = state.accounts.gitlab || { ok: false };
    const s = project.state || {};

    container.innerHTML = `
      <div class="dt-root"><div class="dt-shell">
        <header class="dt-hero">
          <div class="dt-hero-icon">${escapeHtml((project.name || '?').slice(0, 1).toUpperCase())}</div>
          <div class="dt-hero-info">
            <div class="dt-hero-name">${escapeHtml(project.name || '(no project)')}</div>
            <div class="dt-hero-meta">
              <span class="pill ${s.initialized ? 'ok' : 'warn'}">${s.initialized ? '✓ git initialized' : '○ no git yet'}</span>
              ${s.branch ? `<span class="pill">branch · ${escapeHtml(s.branch)}</span>` : ''}
              ${s.lastCommit ? `<span class="pill" title="${escapeHtml(s.lastCommit.message || '')}">${escapeHtml(s.lastCommit.shortHash)} · ${escapeHtml((s.lastCommit.message || '').split('\\n')[0].slice(0, 50))}</span>` : ''}
              ${(s.remotes || []).map(r => `<span class="pill">↗ ${escapeHtml(r.name)} · ${escapeHtml(shortenUrl(r.url))}</span>`).join('')}
            </div>
          </div>
        </header>

        <section class="dt-section">
          <div class="dt-section-h"><span class="num">01</span><span>Code Hosting</span></div>
          <div class="dt-cards">
            ${renderCard('github', '🐙', 'GitHub', 'Push to github.com', gh)}
            ${renderCard('gitlab', '🦊', 'GitLab', 'Push to gitlab.com', gl)}
          </div>
        </section>

        <section class="dt-section">
          <div class="dt-section-h"><span class="num">02</span><span>Cloud Deploy</span></div>
          <div class="dt-cards dt-cloud-cards">
            ${CLOUD_PROVIDERS.map(cp => renderCloudCard(cp)).join('')}
          </div>
        </section>

        <section class="dt-section">
          <div class="dt-section-h"><span class="num">03</span><span>Dev Servers</span></div>
          ${renderDevServers()}
        </section>

      </div></div>`;

    container.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => onAction(b.dataset.act, b.dataset.provider, b.dataset));
    });
  }

  function renderCloudCard(cp) {
    const s = state.cloud[cp.id] || { connected: false, history: [] };
    const last = s.history[0];
    return `
      <div class="dt-card" data-provider="${cp.id}">
        <div class="dt-card-head">
          <div class="dt-card-icon">${cp.icon}</div>
          <div class="dt-card-title">
            <div class="dt-card-name">${escapeHtml(cp.name)}${cp.wired ? '' : ' <span style="font-size:9px;color:var(--text-dim);font-weight:400;text-transform:uppercase;letter-spacing:0.04em;">(soon)</span>'}</div>
            <div class="dt-card-desc">${escapeHtml(cp.desc)}</div>
          </div>
          <div class="dt-card-status ${s.connected ? 'connected' : 'disconnected'}">${s.connected ? 'connected' : 'not connected'}</div>
        </div>
        ${s.connected && s.username ? `<div class="dt-card-account"><span>@${escapeHtml(s.username)}</span></div>` : ''}
        ${last ? `
          <div class="dt-deploy-last">
            <span class="dt-deploy-pill ${last.status}">${last.status === 'success' ? '✓' : '✗'} ${last.status}</span>
            ${last.url ? `<a href="#" class="dt-deploy-url" data-act="open-url" data-url="${escapeHtml(last.url)}">${escapeHtml(shortenUrl(last.url))}</a>` : ''}
            <span class="dt-deploy-when">${formatRel(last.finishedAt)}</span>
          </div>
        ` : ''}
        <div class="dt-card-actions">
          ${s.connected
            ? cp.wired
              ? `<button class="dt-btn primary" data-act="deploy" data-provider="${cp.id}" data-target="preview" title="Deploy to a preview URL">▶ Deploy preview</button>
                 <button class="dt-btn" data-act="deploy" data-provider="${cp.id}" data-target="production" title="Deploy to production">→ Production</button>`
              : `<button class="dt-btn" disabled>Coming soon</button>
                 <button class="dt-btn" data-act="disconnect-cloud" data-provider="${cp.id}">Disconnect</button>`
            : `<button class="dt-btn primary" data-act="connect-cloud" data-provider="${cp.id}">Connect ${escapeHtml(cp.name)}</button>`
          }
          ${s.history.length ? `<button class="dt-btn" data-act="history" data-provider="${cp.id}" title="Deploy history">⏱ ${s.history.length}</button>` : ''}
        </div>
      </div>`;
  }

  function renderDevServers() {
    const p = projectPath();
    if (!p) {
      return `<div style="padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text-dim);font-size:12px;">No project open — open a folder to start a dev server.</div>`;
    }
    const servers = state.devServers || [];
    return `
      <div class="dt-card" style="gap:10px;">
        <div class="dt-card-head">
          <div class="dt-card-icon">▶</div>
          <div class="dt-card-title">
            <div class="dt-card-name">${servers.length ? `${servers.length} running` : 'No dev servers running'}</div>
            <div class="dt-card-desc">Auto-detected build commands from package.json / framework files.</div>
          </div>
          <button class="dt-btn primary" data-act="dev-start" style="flex:0 0 auto;padding:6px 12px;">▶ Start</button>
        </div>
        ${servers.length ? `
          <div class="dt-dev-list">
            ${servers.map(s => `
              <div class="dt-dev-row">
                <span class="dt-dev-status ok"></span>
                <a href="#" class="dt-dev-url" data-act="open-url" data-url="${escapeHtml(s.url || '')}">${escapeHtml(s.url || `port ${s.port || '?'}`)}</a>
                <span class="dt-dev-cmd">${escapeHtml(s.cmd || s.command || '')}</span>
                <button class="dt-btn" data-act="dev-stop" data-id="${escapeHtml(s.id || '')}" style="flex:0 0 auto;padding:3px 10px;font-size:11px;">Stop</button>
              </div>
            `).join('')}
          </div>` : ''}
      </div>`;
  }

  function formatRel(ts) {
    if (!ts) return '';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  function renderCard(provider, icon, name, desc, who) {
    const connected = who?.ok;
    return `
      <div class="dt-card" data-provider="${provider}">
        <div class="dt-card-head">
          <div class="dt-card-icon">${icon}</div>
          <div class="dt-card-title">
            <div class="dt-card-name">${name}</div>
            <div class="dt-card-desc">${desc}</div>
          </div>
          <div class="dt-card-status ${connected ? 'connected' : 'disconnected'}">${connected ? 'connected' : 'not connected'}</div>
        </div>
        ${connected ? `
          <div class="dt-card-account">
            ${who.avatar ? `<img src="${escapeHtml(who.avatar)}" alt="" />` : ''}
            <span>@${escapeHtml(who.login || '')}${who.name ? ` · ${escapeHtml(who.name)}` : ''}</span>
          </div>
          <div class="dt-card-actions">
            <button class="dt-btn primary" data-act="push" data-provider="${provider}">↗ Push project</button>
            <button class="dt-btn" data-act="disconnect" data-provider="${provider}" title="Remove the saved token">Disconnect</button>
          </div>
        ` : `
          <div class="dt-card-actions">
            <button class="dt-btn primary" data-act="connect" data-provider="${provider}">Connect ${name}</button>
          </div>
        `}
      </div>`;
  }

  // ── Actions ───────────────────────────────────────────────────────
  function onAction(act, provider, dataset) {
    if (act === 'connect')          return openConnectDialog(provider);
    if (act === 'disconnect')       return disconnectProvider(provider);
    if (act === 'push')             return openPushDialog(provider);
    if (act === 'connect-cloud')    return openCloudConnectDialog(provider);
    if (act === 'disconnect-cloud') return disconnectCloud(provider);
    if (act === 'deploy')           return openDeployDialog(provider, dataset?.target || 'preview');
    if (act === 'history')          return openHistoryDialog(provider);
    if (act === 'open-url')         { try { api.shell?.openExternal?.(dataset?.url); } catch {} return; }
    if (act === 'dev-start')        return startDevServer();
    if (act === 'dev-stop')         return stopDevServer(dataset?.id);
  }

  function openCloudConnectDialog(provider) {
    const cp = CLOUD_PROVIDERS.find(c => c.id === provider);
    if (!cp) return;
    showDialog({
      title: `Connect ${cp.name}`,
      body: `<p class="lead">Paste a personal access token from <a href="${cp.authUrl}" target="_blank" style="color:var(--accent);">${cp.authUrl}</a> (we'll open it in your browser).</p>
        <p class="lead">Stored encrypted in your OS keychain via Electron's safeStorage.</p>
        <label>Token<input type="password" data-field="token" placeholder="${cp.id === 'vercel' ? 'vercel_…' : cp.id === 'netlify' ? 'nfp_…' : '…'}" autofocus /></label>`,
      onSubmit: async (root) => {
        const token = root.querySelector('[data-field="token"]').value.trim();
        if (!token) return 'Token is required.';
        const r = await api.cloud.saveToken(provider, token, {});
        if (!r?.ok) return r?.error || 'Failed to save token.';
        // Verify if the existing connector test handler covers this provider.
        try {
          const t = await api.cloud.testConnection(provider);
          if (t?.ok && t.username) {
            await api.cloud.saveToken(provider, token, { username: t.username });
          } else if (t && t.ok === false) {
            await api.cloud.deleteToken(provider).catch(() => {});
            return t?.error || `Token rejected by ${cp.name}.`;
          }
        } catch {}
        await refresh();
        return null;
      },
      submitLabel: 'Connect',
    });
    try { api.shell?.openExternal?.(cp.authUrl); } catch {}
  }

  async function disconnectCloud(provider) {
    try { await api.cloud.deleteToken(provider); } catch {}
    await refresh();
  }

  async function openDeployDialog(provider, target) {
    const cp = CLOUD_PROVIDERS.find(c => c.id === provider);
    const isProd = target === 'production';

    // Pull the provider's extraConfig spec + previously-saved values so
    // the dialog can render input rows for things like Cloudflare's
    // project name / dist dir / account ID.
    let extraConfig = [];
    let savedConfig = {};
    try {
      const list = await api.deploy.listProviders();
      const p = (list?.providers || []).find(p => p.id === provider);
      extraConfig = p?.extraConfig || [];
    } catch {}
    if (extraConfig.length) {
      try {
        const r = await api.deploy.getConfig(provider, projectPath());
        if (r?.ok) savedConfig = r.config || {};
      } catch {}
    }
    const configHtml = extraConfig.map(c => `
      <label>${escapeHtml(c.label)}${c.required ? ' <span style="color:var(--error);">*</span>' : ''}<input type="text" data-cfg="${escapeHtml(c.key)}" value="${escapeHtml(savedConfig[c.key] || '')}" placeholder="${escapeHtml(c.placeholder || '')}" /></label>`).join('');

    showDialog({
      title: `Deploy to ${cp?.name || provider} — ${isProd ? 'production' : 'preview'}`,
      body: `<p class="lead">Runs the official ${cp?.name} CLI against your project. The first run downloads the CLI (~30s); subsequent deploys are fast.</p>
        <p class="lead" style="color:${isProd ? 'var(--warn)' : 'inherit'};">${isProd ? '⚠ Deploying to <strong>production</strong> — this updates your live URL.' : 'Deploying to a <strong>preview</strong> URL — your prod site is untouched.'}</p>
        ${configHtml}
        <div data-progress style="display:none;"><div class="dt-log" data-log></div></div>`,
      onSubmit: async (root, ctxBtns) => {
        // Collect the extraConfig values from the inputs.
        const config = {};
        for (const c of extraConfig) {
          const el = root.querySelector(`[data-cfg="${c.key}"]`);
          const v = el?.value?.trim();
          if (v) config[c.key] = v;
          else if (c.required) return `${c.label} is required.`;
        }

        root.querySelector('[data-progress]').style.display = 'block';
        const log = root.querySelector('[data-log]');
        const writeLog = (cls, text) => {
          const div = document.createElement('div');
          if (cls) div.className = cls;
          div.textContent = text;
          log.appendChild(div);
          log.scrollTop = log.scrollHeight;
        };
        ctxBtns.disable();
        const off = api.deploy.onEvent((evt) => {
          if (evt.type === 'log')   writeLog(evt.stream === 'stderr' ? 'err' : '', evt.line);
          else if (evt.type === 'error') writeLog('err', '✗ ' + evt.message);
          else if (evt.type === 'done')  writeLog('ok', '✓ Deployed: ' + (evt.url || '(check log)'));
        });
        const r = await api.deploy.run({ provider, projectPath: projectPath(), target, config });
        try { off(); } catch {}
        if (!r?.ok) {
          ctxBtns.enable();
          return r?.error || 'Deploy failed.';
        }
        if (r.url) {
          ctxBtns.replaceSubmit('Open Site', () => {
            try { api.shell?.openExternal?.(r.url); } catch {}
            ctxBtns.close();
          });
        } else {
          ctxBtns.replaceSubmit('Done', () => ctxBtns.close());
        }
        await refresh();
        return null;
      },
      submitLabel: isProd ? 'Deploy to Production' : 'Deploy Preview',
    });
  }

  function openHistoryDialog(provider) {
    const cp = CLOUD_PROVIDERS.find(c => c.id === provider);
    const list = state.cloud[provider]?.history || [];
    const rows = list.length
      ? list.map(h => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);font-size:12px;">
            <span class="dt-deploy-pill ${h.status}">${h.status === 'success' ? '✓' : '✗'}</span>
            <span style="flex:1;min-width:0;">${h.url ? `<a href="#" data-act="open-url" data-url="${escapeHtml(h.url)}" style="color:var(--accent);">${escapeHtml(shortenUrl(h.url))}</a>` : '<span style="color:var(--text-dim);">(no url)</span>'}</span>
            <span style="font-size:10px;color:var(--text-dim);">${escapeHtml(h.target || 'preview')}</span>
            <span style="font-size:10px;color:var(--text-dim);">${formatRel(h.finishedAt)}</span>
            <span style="font-size:10px;color:var(--text-dim);">${Math.round(((h.finishedAt - h.startedAt) || 0) / 1000)}s</span>
          </div>`).join('')
      : '<p class="lead">No deploys yet for this provider.</p>';
    showDialog({
      title: `${cp?.name || provider} · Deploy history`,
      body: `<div style="max-height:380px;overflow:auto;">${rows}</div>`,
      onSubmit: () => null,
      submitLabel: 'Close',
    });
  }

  async function startDevServer() {
    const p = projectPath();
    if (!p) return;
    try {
      const r = await api.devServer.start(p);
      if (r && r.ok === false) {
        bus.emit('toast:show', { message: 'Start failed: ' + r.error, type: 'error' });
      }
    } catch (err) {
      bus.emit('toast:show', { message: 'Start failed: ' + (err?.message || err), type: 'error' });
    }
    await refresh();
  }

  async function stopDevServer(id) {
    if (!id) return;
    try { await api.devServer.stop(id); } catch {}
    await refresh();
  }

  async function disconnectProvider(provider) {
    const key = provider === 'github' ? 'githubPat' : 'gitlabPat';
    try { await api.secrets?.delete?.(key); } catch {}
    await refresh();
  }

  function openConnectDialog(provider) {
    const isGh = provider === 'github';
    const tokenUrl = isGh
      ? 'https://github.com/settings/tokens?type=beta'
      : 'https://gitlab.com/-/profile/personal_access_tokens';
    const scope = isGh ? 'repo' : 'api + write_repository';
    showDialog({
      title: `Connect ${isGh ? 'GitHub' : 'GitLab'}`,
      body: `<p class="lead">Paste a personal access token with <code>${scope}</code> scope. Stored encrypted in your OS keychain via Electron's safeStorage.</p>
        <p class="lead">Generate one at <a href="${tokenUrl}" target="_blank" style="color:var(--accent);">${tokenUrl}</a> (we'll open it in your browser).</p>
        <label>Personal access token<input type="password" data-field="token" placeholder="${isGh ? 'ghp_… or github_pat_…' : 'glpat-…'}" autofocus /></label>`,
      onSubmit: async (root) => {
        const token = root.querySelector('[data-field="token"]').value.trim();
        if (!token) return 'Token is required.';
        const r = await api.secrets.set(isGh ? 'githubPat' : 'gitlabPat', token);
        if (!r?.ok) return r?.error || 'Failed to save token.';
        // Verify by calling whoami — if it fails, roll back the save.
        const verify = isGh ? await api.github.whoami() : await api.gitlab.whoami();
        if (!verify?.ok) {
          await api.secrets.delete(isGh ? 'githubPat' : 'gitlabPat').catch(() => {});
          return verify?.error || 'Token rejected by ' + (isGh ? 'GitHub' : 'GitLab');
        }
        await refresh();
        return null;
      },
      submitLabel: 'Connect',
    });
    try { api.shell?.openExternal?.(tokenUrl); } catch {}
  }

  async function openPushDialog(provider) {
    const isGh = provider === 'github';
    const project = state.project;
    if (!project?.path) {
      showDialog({ title: 'Open a project first', body: '<p class="lead">No project is open. Use File → Open Folder, then come back.</p>', onSubmit: () => null, submitLabel: 'OK' });
      return;
    }
    // Fetch owner / namespace lists in parallel
    let ownerOptions = [];
    if (isGh) {
      const me = state.accounts.github;
      ownerOptions = [{ value: me?.login || '', label: `@${me?.login || '?'} (personal)` }];
      try {
        const orgs = await api.github.listOrgs();
        if (orgs?.ok) for (const o of orgs.orgs || []) ownerOptions.push({ value: o.login, label: `@${o.login} (org)` });
      } catch {}
    } else {
      try {
        const r = await api.gitlab.listNamespaces();
        if (r?.ok) for (const n of r.namespaces || []) ownerOptions.push({ value: String(n.id), label: `${n.path} (${n.kind})` });
      } catch {}
    }

    const defaultName = (project.name || 'my-project').replace(/[^a-z0-9_.-]/gi, '-');
    const ownerOptsHtml = ownerOptions.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');

    showDialog({
      title: `Push to ${isGh ? 'GitHub' : 'GitLab'}`,
      body: `<p class="lead">Creates a new repo and pushes your project's current branch in one shot.</p>
        <label>Repository name<input type="text" data-field="name" value="${escapeHtml(defaultName)}" autofocus /></label>
        <label>${isGh ? 'Owner' : 'Namespace'}<select data-field="owner">${ownerOptsHtml}</select></label>
        <label>Description (optional)<input type="text" data-field="description" placeholder="What is this project?" /></label>
        <label class="row toggle"><input type="checkbox" data-field="private" checked /> <span>Make repository private</span></label>
        <div data-progress style="display:none;"><div class="dt-log" data-log></div></div>`,
      onSubmit: async (root, ctxBtns) => {
        const name = root.querySelector('[data-field="name"]').value.trim();
        const owner = root.querySelector('[data-field="owner"]').value;
        const description = root.querySelector('[data-field="description"]').value.trim();
        const isPrivate = root.querySelector('[data-field="private"]').checked;
        if (!name) return 'Repository name is required.';
        if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(name)) return 'Use letters, digits, dot, underscore, dash. Must start with a letter or digit.';

        // Set up live log
        root.querySelector('[data-progress]').style.display = 'block';
        const log = root.querySelector('[data-log]');
        const writeLog = (cls, text) => {
          const div = document.createElement('div');
          if (cls) div.className = cls;
          div.textContent = text;
          log.appendChild(div);
          log.scrollTop = log.scrollHeight;
        };
        ctxBtns.disable();
        const off = api.publish.onEvent((evt) => {
          if (evt.type === 'step') writeLog('step', '→ ' + evt.message);
          else if (evt.type === 'log') writeLog('', evt.message);
          else if (evt.type === 'error') writeLog('err', '✗ ' + evt.message);
          else if (evt.type === 'done') writeLog('ok', '✓ Pushed to ' + evt.webUrl);
        });

        const opts = isGh
          ? { provider, projectPath: project.path, name, description, isPrivate, owner }
          : { provider, projectPath: project.path, name, description, isPrivate, namespaceId: owner ? Number(owner) : undefined };
        const r = await api.publish.createAndPush(opts);
        try { off(); } catch {}
        if (!r?.ok) {
          ctxBtns.enable();
          return r?.error || 'Push failed.';
        }
        // Success — update primary action to "Open repo" then auto-close after a beat.
        ctxBtns.replaceSubmit('Open Repo', () => {
          try { api.shell?.openExternal?.(r.webUrl); } catch {}
          ctxBtns.close();
        });
        await refresh();
        return null;
      },
      submitLabel: 'Create + Push',
    });
  }

  // ── Dialog helper ─────────────────────────────────────────────────
  function showDialog({ title, body, onSubmit, submitLabel = 'OK' }) {
    const bg = document.createElement('div');
    bg.className = 'dt-dialog-bg';
    bg.innerHTML = `<div class="dt-dialog">
      <h3>${escapeHtml(title)}</h3>
      ${body}
      <div data-error class="dt-error" style="display:none;"></div>
      <div class="actions">
        <button class="dt-btn" data-cancel>Cancel</button>
        <button class="dt-btn primary" data-submit>${escapeHtml(submitLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    const submitBtn = bg.querySelector('[data-submit]');
    const cancelBtn = bg.querySelector('[data-cancel]');
    const errEl = bg.querySelector('[data-error]');
    const ctxBtns = {
      disable() { submitBtn.disabled = true; cancelBtn.textContent = 'Close'; },
      enable() { submitBtn.disabled = false; },
      replaceSubmit(label, handler) { submitBtn.textContent = label; submitBtn.onclick = handler; },
      close,
    };
    submitBtn.addEventListener('click', async () => {
      errEl.style.display = 'none';
      const err = await onSubmit(bg.querySelector('.dt-dialog'), ctxBtns);
      if (err) { errEl.textContent = err; errEl.style.display = 'block'; return; }
      // null/undefined → close (unless replaceSubmit already changed handler)
      if (submitBtn.textContent === escapeHtml(submitLabel)) close();
    });
    cancelBtn.addEventListener('click', close);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // ── Mount + lifecycle ─────────────────────────────────────────────
  let mountedContainer = null;
  async function mount(container) {
    injectStyles();
    container.style.cssText = 'width:100%;height:100%;overflow:hidden;';
    mountedContainer = container;
    container.innerHTML = `<div class="dt-root"><div class="dt-shell"><div style="text-align:center;padding:40px;color:var(--text-dim);">Loading…</div></div></div>`;
    await loadAll();
    if (mountedContainer === container) renderInto(container);
  }

  async function refresh() {
    if (!mountedContainer) return;
    await loadAll();
    renderInto(mountedContainer);
  }

  function openDeployTab() {
    const editor = window.PiPilot?.editor;
    if (!editor || typeof editor.openVirtualTab !== 'function') return;
    try {
      if (editor.isVirtualTab && editor.isVirtualTab(TAB_ID) && typeof editor.closeFile === 'function') {
        editor.closeFile(TAB_ID);
      }
    } catch {}
    editor.openVirtualTab({
      id: TAB_ID,
      name: 'Deploy',
      icon: '🚀',
      mount,
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function shortenUrl(u) {
    if (!u) return '';
    return String(u).replace(/^https?:\/\//, '').replace(/\.git$/, '').slice(0, 36);
  }

  bus.on('project:opened', () => { if (mountedContainer) refresh(); });
  bus.on('project:loaded', () => { if (mountedContainer) refresh(); });

  window.PiPilot.deploy = window.PiPilot.deploy || {};
  window.PiPilot.deploy.openTab = openDeployTab;
})();
