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

  // ── State ─────────────────────────────────────────────────────────
  const state = {
    project: null,        // { name, path, state: { initialized, branch, hasCommits, lastCommit, remotes } }
    accounts: { github: null, gitlab: null },
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
          <div class="dt-section-h"><span class="num">02</span><span>Cloud Deploy <em style="text-transform:none;letter-spacing:0;font-style:italic;color:var(--text-dim);font-weight:400;">— coming next: Vercel / Netlify / Cloudflare Pages / Railway / Render</em></span></div>
          <div style="padding:14px 16px; background:var(--surface); border:1px dashed var(--border); border-radius:8px; color:var(--text-dim); font-size:12px;">
            One-click deploy to your favorite cloud provider — pipeline is GitHub push → import & deploy.
            Connect a provider in the Deploy sidebar to get a head start.
          </div>
        </section>

      </div></div>`;

    container.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => onAction(b.dataset.act, b.dataset.provider));
    });
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
  function onAction(act, provider) {
    if (act === 'connect')    return openConnectDialog(provider);
    if (act === 'disconnect') return disconnectProvider(provider);
    if (act === 'push')       return openPushDialog(provider);
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
