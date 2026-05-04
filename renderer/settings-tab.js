// Settings — opened as a virtual editor tab (replaces the old modal).
// Same data plumbing as the previous modal: api.settings.all/set,
// api.terminal.profiles, api.extensions.listBuiltins, api.getVersion.
(() => {
  const bus = window.PiPilot?.bus;
  const api = window.electronAPI;
  if (!bus || !api) return;

  const SETTINGS_TAB_ID = 'pipilot-settings://main';

  const SECTIONS = [
    { id: 'account',  label: 'Account',  num: '01' },
    { id: 'general',  label: 'General',  num: '02' },
    { id: 'editor',   label: 'Editor',   num: '03' },
    { id: 'terminal', label: 'Terminal', num: '04' },
    { id: 'ai',       label: 'AI',       num: '05' },
    { id: 'features', label: 'Features', num: '06' },
    { id: 'about',    label: 'About',    num: '07' },
  ];

  function injectStyles() {
    if (document.getElementById('settings-tab-styles')) return;
    const st = document.createElement('style');
    st.id = 'settings-tab-styles';
    st.textContent = `
      .st-root { width:100%; height:100%; overflow:auto; background:var(--bg); color:var(--text); font-family:var(--font-sans); }
      .st-shell { max-width:920px; margin:0 auto; padding:32px 40px 80px; display:grid; grid-template-columns:200px 1fr; gap:36px; }
      .st-side { position:sticky; top:32px; align-self:start; display:flex; flex-direction:column; gap:2px; }
      .st-side h1 { font-size:18px; margin:0 0 14px; letter-spacing:-0.01em; color:var(--text-strong); font-weight:700; }
      .st-nav { display:flex; flex-direction:column; gap:1px; }
      .st-nav button {
        all:unset; cursor:pointer; padding:7px 10px; font-size:12.5px; color:var(--text-mid);
        border-radius:5px; display:flex; align-items:center; gap:8px; transition:background 120ms, color 120ms;
      }
      .st-nav button:hover { background:var(--surface-alt); color:var(--text); }
      .st-nav button.active { background:var(--surface-alt); color:var(--text-strong); font-weight:500; }
      .st-nav .num { font-size:10px; color:var(--text-dim); font-variant-numeric:tabular-nums; min-width:18px; }
      .st-main { min-width:0; }
      .st-sec { display:none; animation:st-fade 180ms ease; }
      .st-sec.active { display:block; }
      @keyframes st-fade { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
      .st-sec h2 { font-size:20px; margin:0 0 4px; color:var(--text-strong); letter-spacing:-0.01em; font-weight:600; }
      .st-sec .lead { color:var(--text-dim); font-size:12px; margin:0 0 24px; }
      .st-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
      .st-card + .st-card { margin-top:14px; }
      .st-row { display:flex; align-items:center; gap:16px; padding:14px 16px; min-height:48px; }
      .st-row + .st-row { border-top:1px solid var(--border); }
      .st-row .lbl { flex:1; min-width:0; }
      .st-row .lbl .t { font-size:13px; color:var(--text); font-weight:500; }
      .st-row .lbl .d { display:block; font-size:11.5px; color:var(--text-dim); margin-top:2px; line-height:1.45; font-weight:400; }
      .st-row .ctl { flex:0 0 auto; display:flex; align-items:center; gap:8px; }
      .st-row input[type=text], .st-row input[type=number], .st-row select {
        background:var(--bg); border:1px solid var(--border); color:var(--text);
        font:inherit; font-size:12.5px; padding:5px 9px; border-radius:5px; min-width:140px;
        transition:border-color 120ms;
      }
      .st-row input[type=text]:focus, .st-row input[type=number]:focus, .st-row select:focus {
        border-color:var(--accent); outline:none;
      }
      .st-row input[type=range] { width:160px; accent-color:var(--accent); }
      .st-range-val { font-variant-numeric:tabular-nums; font-size:12px; color:var(--text-dim); min-width:24px; text-align:right; }
      .st-switch { position:relative; width:32px; height:18px; flex:0 0 auto; }
      .st-switch input { opacity:0; width:100%; height:100%; cursor:pointer; margin:0; position:absolute; inset:0; z-index:2; }
      .st-switch .knob { position:absolute; inset:0; background:var(--surface-alt); border:1px solid var(--border); border-radius:999px; transition:background 140ms, border-color 140ms; }
      .st-switch .knob::after { content:''; position:absolute; top:2px; left:2px; width:12px; height:12px; background:var(--text-mid); border-radius:50%; transition:transform 140ms, background 140ms; }
      .st-switch input:checked ~ .knob { background:var(--accent); border-color:var(--accent); }
      .st-switch input:checked ~ .knob::after { transform:translateX(14px); background:#fff; }
      .st-about { text-align:center; padding:32px 0 12px; }
      .st-about .logo { width:56px; height:56px; margin:0 auto 14px; opacity:0.95; }
      .st-about .name { font-size:22px; color:var(--text-strong); font-weight:600; letter-spacing:-0.01em; }
      .st-about .ver  { color:var(--text-dim); font-size:12px; margin-top:4px; font-variant-numeric:tabular-nums; }
      .st-about .tag  { color:var(--text-dim); font-size:12px; margin-top:18px; line-height:1.6; }
      .st-empty { padding:18px 16px; color:var(--text-dim); font-size:12px; text-align:center; }
      .st-saved { position:fixed; bottom:18px; right:24px; background:var(--accent); color:#fff;
                  font-size:11.5px; font-weight:500; padding:6px 12px; border-radius:999px;
                  opacity:0; transform:translateY(8px); transition:opacity 180ms, transform 180ms;
                  pointer-events:none; z-index:10; }
      .st-saved.show { opacity:1; transform:none; }

      /* Account section */
      .st-account-card {
        display: flex; align-items: center; gap: 16px;
        padding: 20px; background: var(--surface);
        border: 1px solid var(--border); border-radius: 8px;
      }
      .st-account-avatar {
        width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0;
        background: var(--bg); border: 1px solid var(--border);
        object-fit: cover;
      }
      .st-account-avatar.placeholder {
        display: grid; place-items: center;
        font-family: var(--font-mono);
        font-weight: 600; font-size: 22px; color: var(--text-strong);
      }
      .st-account-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .st-account-info .login {
        font-size: 15px; font-weight: 600; color: var(--text-strong); letter-spacing: -0.005em;
      }
      .st-account-info .email { font-size: 12px; color: var(--text-mid); }
      .st-account-meta {
        display: flex; gap: 14px; align-items: center; margin-top: 6px;
        font-size: 11px; color: var(--text-dim);
      }
      .st-account-plan {
        text-transform: uppercase; letter-spacing: 0.05em;
        padding: 2px 8px; border-radius: 999px;
        font-weight: 600; font-size: 10px;
      }
      .st-account-plan.plan-free   { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
      .st-account-plan.plan-paid   { background: color-mix(in srgb, var(--ok, #6ee7a7) 22%, transparent); color: var(--ok, #6ee7a7); }
      .st-account-plan.plan-admin  { background: color-mix(in srgb, var(--err, #ff7b85) 22%, transparent); color: var(--err, #ff7b85); }
      .st-account-plan.plan-sponsor{ background: linear-gradient(135deg,#ff7eb6,#f5b254); color: #16161a; }
      .st-account-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-items: flex-end; }
      .st-account-actions button {
        padding: 6px 12px; border-radius: 5px; font: inherit; font-size: 12px; cursor: pointer;
        border: 1px solid var(--border); background: var(--surface-alt); color: var(--text);
        transition: background 100ms, color 100ms, border-color 100ms;
      }
      .st-account-actions button:hover { background: var(--bg); color: var(--text-strong); }
      .st-account-actions .danger { color: var(--err, #ff7b85); border-color: color-mix(in srgb, var(--err, #ff7b85) 35%, var(--border)); }
      .st-account-actions .danger:hover {
        background: color-mix(in srgb, var(--err, #ff7b85) 14%, var(--surface-alt));
        color: var(--err, #ff7b85);
      }

      .st-signin-card {
        padding: 32px; text-align: center;
        background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
      }
      .st-signin-card .blurb { font-size: 13px; color: var(--text-mid); margin: 6px 0 18px; line-height: 1.55; max-width: 440px; margin-left: auto; margin-right: auto; }
      .st-signin-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 16px; border-radius: 6px;
        background: var(--text-strong); color: var(--bg);
        border: 0; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        transition: background 100ms;
      }
      .st-signin-btn:hover { background: white; }

      .st-account-loading {
        padding: 32px; text-align: center; color: var(--text-dim); font-size: 12.5px;
      }
    `;
    document.head.appendChild(st);
  }

  function flashSaved(root) {
    let el = root.querySelector('.st-saved');
    if (!el) {
      el = document.createElement('div');
      el.className = 'st-saved';
      el.textContent = 'Saved';
      root.appendChild(el);
    }
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 900);
  }

  function rowText(key, label, desc, value, attrs = {}) {
    const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<div class="st-row">
      <div class="lbl"><div class="t">${label}</div>${desc ? `<small class="d">${desc}</small>` : ''}</div>
      <div class="ctl"><input type="text" data-key="${key}" value="${escapeHtml(value || '')}" ${a} /></div>
    </div>`;
  }
  function rowNumber(key, label, desc, value, min, max) {
    return `<div class="st-row">
      <div class="lbl"><div class="t">${label}</div>${desc ? `<small class="d">${desc}</small>` : ''}</div>
      <div class="ctl"><input type="number" data-key="${key}" value="${value}" min="${min}" max="${max}" /></div>
    </div>`;
  }
  function rowRange(key, label, desc, value, min, max) {
    return `<div class="st-row">
      <div class="lbl"><div class="t">${label}</div>${desc ? `<small class="d">${desc}</small>` : ''}</div>
      <div class="ctl">
        <input type="range" data-key="${key}" value="${value}" min="${min}" max="${max}" />
        <span class="st-range-val" data-range-for="${key}">${value}</span>
      </div>
    </div>`;
  }
  function rowSelect(key, label, desc, value, options) {
    const opts = options.map(o => `<option value="${o.v}"${o.v === value ? ' selected' : ''}>${o.t}</option>`).join('');
    return `<div class="st-row">
      <div class="lbl"><div class="t">${label}</div>${desc ? `<small class="d">${desc}</small>` : ''}</div>
      <div class="ctl"><select data-key="${key}">${opts}</select></div>
    </div>`;
  }
  function rowSwitch(key, label, desc, checked) {
    return `<div class="st-row">
      <div class="lbl"><div class="t">${label}</div>${desc ? `<small class="d">${desc}</small>` : ''}</div>
      <div class="ctl"><label class="st-switch"><input type="checkbox" data-key="${key}" ${checked ? 'checked' : ''} /><span class="knob"></span></label></div>
    </div>`;
  }
  // Font picker: select with each option in its own font, plus a sibling
  // text input that's hidden unless the special "__custom__" option wins.
  function rowFontPicker(key, label, desc, value, options, customValue) {
    const opts = options.map(o =>
      `<option value="${escapeHtml(o.v)}"${o.v === value ? ' selected' : ''} style="${o.style || ''}">${escapeHtml(o.t)}</option>`
    ).join('');
    const isCustom = value === '__custom__';
    return `<div class="st-row st-row-font">
      <div class="lbl"><div class="t">${label}</div>${desc ? `<small class="d">${desc}</small>` : ''}</div>
      <div class="ctl" style="flex-direction:column;align-items:flex-end;gap:6px;">
        <select data-key="${key}" data-font-picker="1">${opts}</select>
        <input type="text" data-key="${key}" data-font-custom="1" value="${escapeHtml(customValue || '')}"
               placeholder='e.g. "Fira Code", monospace'
               style="display:${isCustom ? 'block' : 'none'};min-width:240px;" />
      </div>
    </div>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function buildSection(id, settings, profiles, builtins, appVersion) {
    if (id === 'account') {
      // Async-populated by hydrateAccountSection() once the section is in
      // the DOM. We render a loading shell first because buildSection is
      // sync and we don't want to block other sections waiting for the
      // /auth/me round-trip.
      return `
        <h2>Account</h2>
        <p class="lead">Sign in with GitHub to use the AI agent and inline AI features.</p>
        <div data-account-host>
          <div class="st-account-loading">Loading account…</div>
        </div>
      `;
    }
    if (id === 'general') {
      const themes = window.PiPilot?.theme?.list?.() || [{ id: 'midnight', label: 'Midnight Studio' }];
      const currentTheme = window.PiPilot?.theme?.current?.() || 'midnight';
      const fonts = window.PiPilot?.fonts?.list?.() || [];
      const currentFont = settings.fontFamily || window.PiPilot?.fonts?.DEFAULT_ID || 'jetbrains-mono';
      const isCustomFont = currentFont && !fonts.some(f => f.id === currentFont || f.family === currentFont);
      // Each option previews in its own font. Custom… reveals the text input.
      const fontOpts = fonts.map(f => ({
        v: f.id,
        t: f.label,
        style: `font-family: ${f.family}, ui-monospace, Consolas, monospace;`,
      }));
      fontOpts.push({ v: '__custom__', t: 'Custom (CSS stack)…', style: '' });
      return `
        <h2>General</h2>
        <p class="lead">Editor look-and-feel.</p>
        <div class="st-card">
          ${rowSelect('theme', 'Color Theme', 'Applies live to the entire IDE — workbench colors and the editor syntax theme.', currentTheme, themes.map(t => ({ v: t.id, t: t.label })))}
          ${rowRange('fontSize', 'Editor Font Size', 'Base font size in pixels. Live-updates the editor.', settings.fontSize || 13, 10, 24)}
          ${rowFontPicker('fontFamily', 'Font Family', 'Pick a built-in coding font (lazy-loaded from CDN) or paste a custom CSS stack.', isCustomFont ? '__custom__' : currentFont, fontOpts, isCustomFont ? currentFont : '')}
          ${rowSwitch('fontLigatures', 'Programming Ligatures', 'Render glyphs like => != === as combined symbols (looks great with Fira Code, JetBrains Mono, Cascadia Code).', !!settings.fontLigatures)}
          ${rowSelect('cursorStyle', 'Cursor Style', 'Caret rendering in code editors.', settings.cursorStyle || 'line', [
            { v: 'line', t: 'Line' },
            { v: 'block', t: 'Block' },
          ])}
        </div>`;
    }
    if (id === 'editor') {
      return `
        <h2>Editor</h2>
        <p class="lead">Indentation, wrapping, and gutter behavior.</p>
        <div class="st-card">
          ${rowNumber('tabSize', 'Tab Size', 'Number of spaces per indent level.', settings.tabSize || 2, 1, 8)}
          ${rowSelect('wordWrap', 'Word Wrap', 'Soft-wrap long lines to fit the viewport.', settings.wordWrap || 'off', [
            { v: 'off', t: 'Off' },
            { v: 'on', t: 'On' },
          ])}
          ${rowSwitch('minimap', 'Minimap', 'Show the code minimap on the right edge.', settings.minimap !== false)}
          ${rowSwitch('lineNumbers', 'Line Numbers', 'Show line numbers in the gutter.', settings.lineNumbers !== false)}
        </div>`;
    }
    if (id === 'terminal') {
      const opts = (profiles || []).map(p => ({
        v: p.id,
        t: `${p.name} (${p.path})`,
      }));
      const cur = settings.terminalProfile || (profiles?.find(p => p.default)?.id) || (profiles?.[0]?.id) || '';
      return `
        <h2>Terminal</h2>
        <p class="lead">Default shell and terminal appearance.</p>
        <div class="st-card">
          ${opts.length
            ? rowSelect('terminalProfile', 'Default Shell', 'Used when opening a new terminal.', cur, opts)
            : '<div class="st-empty">No shell profiles detected.</div>'}
          ${rowNumber('terminalFontSize', 'Terminal Font Size', 'Font size in pixels for the terminal.', settings.terminalFontSize || 13, 10, 24)}
        </div>`;
    }
    if (id === 'ai') {
      const effortLevels = (window.PiPilot?.chat?.effortLevels?.() || [
        { id: 'none',   label: 'None' },
        { id: 'low',    label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high',   label: 'High' },
        { id: 'xhigh',  label: 'X-High' },
      ]).map(l => ({ v: l.id, t: l.label }));
      const currentEffort = window.PiPilot?.chat?.getEffort?.() || 'medium';
      const cooldownMin = Math.max(1, Math.round((settings.autoUpdateWikiCooldownMs ?? 5 * 60 * 1000) / 60000));
      return `
        <h2>AI</h2>
        <p class="lead">Agent defaults. API keys are configured in the project <code>.env</code>.</p>
        <div class="st-card">
          ${rowSelect('agentDefaultMode', 'Default Agent Mode', 'Mode picked when opening a new chat.', settings.agentDefaultMode || 'agent', [
            { v: 'agent', t: 'Agent' },
            { v: 'plan',  t: 'Plan' },
          ])}
          ${rowSelect('__reasoningEffort', 'Reasoning Effort', 'Depth of the agent\'s thinking phase. Synced with the chat input toolbar.', currentEffort, effortLevels)}
        </div>
        <div class="st-card">
          ${rowSwitch('autoUpdateWiki', 'Auto-Update Wiki', 'Refresh project wiki docs after the agent finishes a meaningful change.', settings.autoUpdateWiki !== false)}
          ${rowNumber('__autoUpdateWikiCooldownMin', 'Wiki Cooldown (minutes)', 'Minimum gap between automatic wiki refreshes.', cooldownMin, 1, 240)}
        </div>`;
    }
    if (id === 'features') {
      const rows = (builtins || []).map(b => rowSwitch(
        b.settingsKey,
        b.name,
        b.desc || '',
        settings[b.settingsKey] !== false
      )).join('');
      return `
        <h2>Built-in Features</h2>
        <p class="lead">Shipped with the IDE. Toggles take effect on next launch.</p>
        <div class="st-card">${rows || '<div class="st-empty">No built-in features available.</div>'}</div>`;
    }
    if (id === 'about') {
      return `
        <h2>About</h2>
        <p class="lead">Version and build details.</p>
        <div class="st-card">
          <div class="st-about">
            <img class="logo" src="public/icon.png" alt="" />
            <div class="name">PiPilot IDE</div>
            <div class="ver">Version ${escapeHtml(appVersion || 'unknown')}</div>
            <div class="tag">Native AI development environment.<br/>An editor that thinks alongside you.</div>
          </div>
        </div>`;
    }
    return '';
  }

  function wireInputs(root, settings) {
    // Font picker is a dual-input control (select + custom-text). They
    // share data-key="fontFamily" so the generic loop below would
    // double-bind them — handle the pair specially first.
    const fontSelect = root.querySelector('select[data-font-picker]');
    const fontCustom = root.querySelector('input[data-font-custom]');
    if (fontSelect && fontCustom) {
      const saveFont = async (value) => {
        console.log('[settings-tab] saving font:', value);
        settings.fontFamily = value;
        try {
          await api.settings.set('fontFamily', value);
          bus.emit('settings:changed', { key: 'fontFamily', value });
          flashSaved(root);
        } catch (err) { console.warn('[settings-tab] font save failed:', err); }
      };
      fontSelect.addEventListener('change', () => {
        const v = fontSelect.value;
        console.log('[settings-tab] font select changed →', v);
        if (v === '__custom__') {
          fontCustom.style.display = 'block';
          fontCustom.focus();
          if (fontCustom.value.trim()) saveFont(fontCustom.value.trim());
          return;
        }
        fontCustom.style.display = 'none';
        saveFont(v);
      });
      fontCustom.addEventListener('change', () => {
        if (fontSelect.value !== '__custom__') return;
        const v = fontCustom.value.trim();
        if (v) saveFont(v);
      });
    } else {
      console.warn('[settings-tab] font picker elements missing — select:', !!fontSelect, 'custom:', !!fontCustom);
    }

    root.querySelectorAll('[data-key]').forEach((input) => {
      // Skip the font picker pair — handled above.
      if (input.dataset.fontPicker !== undefined || input.dataset.fontCustom !== undefined) return;
      const key = input.dataset.key;
      const handler = async () => {
        let value;
        if (input.type === 'checkbox') value = input.checked;
        else if (input.type === 'number' || input.type === 'range') value = parseInt(input.value, 10);
        else value = input.value;
        const liveLabel = root.querySelector(`[data-range-for="${key}"]`);
        if (liveLabel) liveLabel.textContent = value;

        try {
          if (key === '__reasoningEffort') {
            window.PiPilot?.chat?.setEffort?.(value);
          } else if (key === '__autoUpdateWikiCooldownMin') {
            const ms = Math.max(60_000, Number(value) * 60_000);
            settings.autoUpdateWikiCooldownMs = ms;
            await api.settings.set('autoUpdateWikiCooldownMs', ms);
            bus.emit('settings:changed', { key: 'autoUpdateWikiCooldownMs', value: ms });
          } else {
            settings[key] = value;
            await api.settings.set(key, value);
            bus.emit('settings:changed', { key, value });
          }
          flashSaved(root);
        } catch (err) {
          console.warn('[settings-tab] save failed:', key, err);
        }
      };
      input.addEventListener('change', handler);
      if (input.type === 'range') input.addEventListener('input', handler);
    });
  }

  async function mount(container, opts) {
    injectStyles();
    container.style.cssText = 'width:100%;height:100%;overflow:hidden;';
    container.innerHTML = `<div class="st-root"><div class="st-shell">
      <aside class="st-side">
        <h1>Settings</h1>
        <nav class="st-nav">
          ${SECTIONS.map((s, i) => `<button data-sec="${s.id}"${i === 0 ? ' class="active"' : ''}>
            <span class="num">${s.num}</span><span>${s.label}</span>
          </button>`).join('')}
        </nav>
      </aside>
      <main class="st-main">
        <div class="st-empty">Loading…</div>
      </main>
    </div></div>`;

    const root = container.querySelector('.st-root');
    const main = container.querySelector('.st-main');

    let settings = {};
    let profiles = [];
    let builtins = [];
    let appVersion = '';
    try { settings = (await api.settings.all())?.settings || {}; } catch {}
    try { profiles = await api.terminal.profiles(); } catch {}
    try { const r = await api.extensions?.listBuiltins?.(); if (r?.ok) builtins = r.builtins || []; } catch {}
    try { appVersion = await api.getVersion(); } catch {}

    const initialSec = (opts && opts.section) || SECTIONS[0].id;

    function showSection(id) {
      main.innerHTML = `<section class="st-sec active">${buildSection(id, settings, profiles, builtins, appVersion)}</section>`;
      wireInputs(main, settings);
      container.querySelectorAll('.st-nav button').forEach((b) => {
        b.classList.toggle('active', b.dataset.sec === id);
      });
      if (id === 'account') hydrateAccountSection(main);
    }

    // Renders the account card with live data from the proxy. Re-runs
    // whenever auth state changes (sign-in / sign-out from elsewhere).
    async function hydrateAccountSection(scope) {
      const host = scope.querySelector('[data-account-host]');
      if (!host) return;

      const status = await api.auth?.getStatus?.();
      const proxyUrl = await api.auth?.proxyUrl?.();

      if (!status?.authenticated) {
        host.innerHTML = `
          <div class="st-signin-card">
            <div style="font-size:32px;margin-bottom:8px;">🔐</div>
            <div style="font-size:14px;color:var(--text-strong);font-weight:600;">Not signed in</div>
            <p class="blurb">
              Editing works without an account. Sign in with GitHub to unlock chat, the AI agent, inline completions, and inline chat.
            </p>
            <button class="st-signin-btn" data-action="signin">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-2.13c-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
              Sign in with GitHub
            </button>
            <div style="margin-top:18px;font-size:11px;color:var(--text-dim);">
              Auth handled by <code style="font-family:var(--font-mono);">${proxyUrl || 'pipilot-proxy'}</code>
            </div>
          </div>
        `;
        host.querySelector('[data-action="signin"]')?.addEventListener('click', () => {
          window.PiPilot?.auth?.show?.();
        });
        return;
      }

      // Authenticated — fetch the live profile.
      const me = await api.auth?.me?.();
      if (!me?.ok) {
        // Token rejected by proxy → drop and re-prompt.
        host.innerHTML = `
          <div class="st-signin-card">
            <div style="font-size:14px;color:var(--err,#ff7b85);font-weight:600;">Session expired</div>
            <p class="blurb">Your sign-in is no longer valid. Please sign in again.</p>
            <button class="st-signin-btn" data-action="signin">Sign in again</button>
          </div>
        `;
        host.querySelector('[data-action="signin"]')?.addEventListener('click', () => {
          window.PiPilot?.auth?.show?.();
        });
        return;
      }

      const u = me.user || {};
      const initial = (u.login || '?').slice(0, 1).toUpperCase();
      const avatar = u.avatar_url
        ? `<img class="st-account-avatar" src="${escapeHtml(u.avatar_url)}" alt="${escapeHtml(u.login || '')}" />`
        : `<div class="st-account-avatar placeholder">${escapeHtml(initial)}</div>`;

      // Plan badge — admin / sponsor get distinct colours.
      const planLabel = String(u.plan || 'free').toUpperCase();
      const planClass = u.plan === 'admin' ? 'plan-admin'
        : u.sponsor ? 'plan-sponsor'
        : (u.plan === 'pro' || u.plan === 'team') ? 'plan-paid'
        : 'plan-free';

      // Quota bar — only shown for capped tiers.
      let quotaCard = '';
      if (u.quota_unlimited) {
        const reason = u.plan === 'admin' ? 'Admin account'
          : u.sponsor ? `GitHub Sponsor ($${u.sponsor_tier_usd}/mo)`
          : 'Pro plan';
        quotaCard = `
          <div class="st-card" style="margin-top:14px;">
            <div class="st-row">
              <div class="lbl">
                <div class="t">Daily usage · Unlimited</div>
                <div class="d">${escapeHtml(reason)} — no quota.</div>
              </div>
            </div>
          </div>
        `;
      } else {
        const used = u.quota_used_today || 0;
        const cap  = u.quota_per_day    || 50;
        const pct  = Math.min(100, Math.round((used / cap) * 100));
        const colour = pct >= 90 ? 'var(--err,#ff7b85)' : pct >= 60 ? 'var(--warn,#f5b254)' : 'var(--accent)';
        const refBonus = u.referral_bonus_per_day || 0;
        const streakBonus = u.streak_bonus_per_day || 0;
        quotaCard = `
          <div class="st-card" style="margin-top:14px;">
            <div class="st-row" style="display:block;">
              <div class="lbl" style="margin-bottom:8px;">
                <div class="t">Daily usage · ${used} / ${cap}</div>
                <div class="d">Resets at midnight UTC.</div>
              </div>
              <div style="height:6px;background:var(--surface-alt);border-radius:3px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:${colour};transition:width 200ms;"></div>
              </div>
              <div style="display:flex;gap:14px;margin-top:10px;font-size:11px;color:var(--text-dim);font-variant-numeric:tabular-nums;">
                <span>Base ${u.base_quota || 50}</span>
                ${refBonus ? `<span style="color:var(--accent);">+${refBonus} referrals</span>` : ''}
                ${streakBonus ? `<span style="color:var(--warn,#f5b254);">+${streakBonus} streak (${u.streak_days}d)</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }

      // Referral card — code + invite link + count.
      const referralLink = u.referral_code
        ? `https://github.com/pipilot-dev/pipilot-ide?r=${encodeURIComponent(u.referral_code)}`
        : '';
      const referralCard = u.referral_code ? `
        <div class="st-card" style="margin-top:14px;">
          <div class="st-row" style="display:block;">
            <div class="lbl" style="margin-bottom:10px;">
              <div class="t">Invite friends, earn quota</div>
              <div class="d">Each friend who signs up + sends one chat = +20 turns/day for both of you (max +200).</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
              <code style="flex:1;font-family:var(--font-mono);font-size:12px;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text-strong);user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(referralLink)}</code>
              <button data-action="copy-link" style="padding:7px 12px;border-radius:5px;font:inherit;font-size:11.5px;cursor:pointer;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);">Copy link</button>
            </div>
            <div style="font-size:11.5px;color:var(--text-mid);">
              <strong style="color:var(--text-strong);">${u.referrals_count || 0}</strong> qualified ${u.referrals_count === 1 ? 'invite' : 'invites'}
              · Code: <code style="font-family:var(--font-mono);">${escapeHtml(u.referral_code)}</code>
            </div>
          </div>
        </div>
      ` : '';

      host.innerHTML = `
        <div class="st-account-card">
          ${avatar}
          <div class="st-account-info">
            <div class="login">${escapeHtml(u.login || 'unknown')}</div>
            ${u.email ? `<div class="email">${escapeHtml(u.email)}</div>` : ''}
            <div class="st-account-meta">
              <span class="st-account-plan ${planClass}">${escapeHtml(planLabel)}</span>
              ${u.sponsor ? '<span class="st-account-plan plan-sponsor">SPONSOR</span>' : ''}
              <span>via GitHub</span>
            </div>
          </div>
          <div class="st-account-actions">
            <button data-action="open-github">View on GitHub</button>
            <button class="danger" data-action="signout">Sign out</button>
          </div>
        </div>
        ${quotaCard}
        ${referralCard}
        <div class="st-card" style="margin-top:14px;">
          <div class="st-row" style="display:block;">
            <div class="lbl" style="margin-bottom:8px;">
              <div class="t">Show your support</div>
              <div class="d">Drop a "Made with PiPilot" badge in your README — it links back here so other developers can find the IDE.</div>
            </div>
            <button data-action="get-badge" style="padding:7px 12px;border-radius:5px;font:inherit;font-size:11.5px;cursor:pointer;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);">Get the badge</button>
          </div>
        </div>
        <div class="st-card" style="margin-top:14px;">
          <div class="st-row">
            <div class="lbl">
              <div class="t">Proxy endpoint</div>
              <div class="d">All AI requests authenticated by this URL.</div>
            </div>
            <div class="ctl">
              <code style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-mid);">${escapeHtml(proxyUrl || '')}</code>
            </div>
          </div>
        </div>
      `;

      host.querySelector('[data-action="open-github"]')?.addEventListener('click', () => {
        api.shell?.openExternal?.(`https://github.com/${u.login}`);
      });
      host.querySelector('[data-action="signout"]')?.addEventListener('click', async () => {
        if (!confirm('Sign out of PiPilot? You\'ll need to sign in again to use AI features.')) return;
        await api.auth.signOut();
        try { window.dispatchEvent(new CustomEvent('pipilot:auth-changed', { detail: { authenticated: false } })); } catch {}
        hydrateAccountSection(scope);
      });
      host.querySelector('[data-action="copy-link"]')?.addEventListener('click', async (e) => {
        try {
          await navigator.clipboard.writeText(referralLink);
          const btn = e.currentTarget;
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1200);
        } catch {}
      });
      host.querySelector('[data-action="get-badge"]')?.addEventListener('click', () => {
        window.PiPilot?.badgeDialog?.show?.(u.login);
      });
    }

    // Refresh account section when auth state changes elsewhere (e.g. user
    // signs in via the chat banner while Settings is open in another tab).
    const authChangedFn = () => {
      const active = container.querySelector('.st-nav button.active')?.dataset?.sec;
      if (active === 'account') hydrateAccountSection(main);
    };
    window.addEventListener('pipilot:auth-changed', authChangedFn);

    container.querySelectorAll('.st-nav button').forEach((b) => {
      b.addEventListener('click', () => showSection(b.dataset.sec));
    });
    showSection(initialSec);

    // Re-render the General section when an extension registers/removes a
    // theme OR a font so the pickers reflect newly-installed contributions
    // live. Both refresh the same section.
    const refreshGeneral = () => {
      const active = container.querySelector('.st-nav button.active')?.dataset?.sec;
      if (active === 'general') showSection('general');
    };
    const off1 = bus.on('themes:registry-updated', refreshGeneral);
    const off2 = bus.on('fonts:registry-updated', refreshGeneral);
    const off = () => {
      try { off1(); } catch {}
      try { off2(); } catch {}
      try { window.removeEventListener('pipilot:auth-changed', authChangedFn); } catch {}
    };
    // Best-effort cleanup: when the virtual tab closes its container is
    // detached. Use a MutationObserver on body to catch it.
    new MutationObserver((muts, obs) => {
      if (!document.body.contains(container)) { try { off(); } catch {} obs.disconnect(); }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function openSettingsTab(opts) {
    const editor = window.PiPilot?.editor;
    if (!editor || typeof editor.openVirtualTab !== 'function') return;
    let section = null;
    if (opts && typeof opts === 'object') {
      if (typeof opts.tab === 'string') {
        const match = SECTIONS.find(s => s.label.toLowerCase() === opts.tab.toLowerCase() || s.id === opts.tab.toLowerCase());
        if (match) section = match.id;
      } else if (typeof opts.tab === 'number' && SECTIONS[opts.tab]) {
        section = SECTIONS[opts.tab].id;
      }
      if (typeof opts.section === 'string') section = opts.section;
    }
    try {
      if (editor.isVirtualTab && editor.isVirtualTab(SETTINGS_TAB_ID) && typeof editor.closeFile === 'function') {
        editor.closeFile(SETTINGS_TAB_ID);
      }
    } catch {}
    editor.openVirtualTab({
      id: SETTINGS_TAB_ID,
      name: 'Settings',
      icon: '⚙',
      mount: (c) => mount(c, { section }),
    });
  }

  bus.on('modal:settings', openSettingsTab);
  window.PiPilot.settings = window.PiPilot.settings || {};
  window.PiPilot.settings.openTab = openSettingsTab;
})();
