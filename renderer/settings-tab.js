// Settings — opened as a virtual editor tab (replaces the old modal).
// Same data plumbing as the previous modal: api.settings.all/set,
// api.terminal.profiles, api.extensions.listBuiltins, api.getVersion.
(() => {
  const bus = window.PiPilot?.bus;
  const api = window.electronAPI;
  if (!bus || !api) return;

  const SETTINGS_TAB_ID = 'pipilot-settings://main';

  const SECTIONS = [
    { id: 'general',  label: 'General',  num: '01' },
    { id: 'editor',   label: 'Editor',   num: '02' },
    { id: 'terminal', label: 'Terminal', num: '03' },
    { id: 'ai',       label: 'AI',       num: '04' },
    { id: 'features', label: 'Features', num: '05' },
    { id: 'about',    label: 'About',    num: '06' },
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
    }

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
    const off = () => { try { off1(); } catch {} try { off2(); } catch {} };
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
