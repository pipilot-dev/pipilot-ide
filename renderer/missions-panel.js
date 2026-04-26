// PiPilot IDE — Missions panel + editor modal + titlebar launcher
//
// Registers window.PiPilot.panels.missions (called by sidebar.js when
// the user clicks the activity-bar Missions icon), plus a titlebar
// pill that opens the same view from anywhere. The editor modal
// handles create/edit with target picker (local/cloud), trigger picker
// (manual/once/interval/cron), permission preset, notifications, and
// a "Run now" test action.

(function () {
  'use strict';
  if (window.__pipilotMissionsPanelLoaded) return;
  window.__pipilotMissionsPanelLoaded = true;

  const bus = window.PiPilot && window.PiPilot.bus;
  const api = (window.PiPilot && window.PiPilot.api) || window.electronAPI;
  const state = window.PiPilot && window.PiPilot.state;
  if (!bus || !api?.missions) {
    console.warn('[missions-panel] dependencies missing — disabled');
    return;
  }

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function relativeTime(ts) {
    if (!ts) return 'never';
    const d = Date.now() - ts;
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return Math.round(d / 60_000) + 'm ago';
    if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
    return Math.round(d / 86_400_000) + 'd ago';
  }

  function describeTrigger(t) {
    if (!t || !t.kind) return 'manual';
    switch (t.kind) {
      case 'manual': return 'Manual';
      case 'once': return 'Once at ' + (t.at ? new Date(t.at).toLocaleString() : 'unset');
      case 'interval': {
        const m = (t.everyMs || 0) / 60_000;
        if (m < 60) return `Every ${Math.round(m)} min`;
        if (m < 1440) return `Every ${Math.round(m / 60)} h`;
        return `Every ${Math.round(m / 1440)} d`;
      }
      case 'cron': {
        const c = t.spec || {};
        const time = `${String(c.hour ?? 0).padStart(2,'0')}:${String(c.minute ?? 0).padStart(2,'0')}`;
        const wd = Array.isArray(c.weekdays) ? weekdayLabel(c.weekdays) : 'Daily';
        return `${wd} at ${time}`;
      }
      case 'on-idle': return 'On chat idle';
      case 'on-commit': return 'On commit';
      case 'on-push': return 'On push';
      default: return t.kind;
    }
  }

  function weekdayLabel(days) {
    if (days.length === 7) return 'Daily';
    if (JSON.stringify(days) === JSON.stringify([1,2,3,4,5])) return 'Weekdays';
    if (JSON.stringify(days) === JSON.stringify([0,6])) return 'Weekends';
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days.map(d => names[d]).join(',');
  }

  function describeTarget(target) {
    if (!target) return 'unknown';
    if (target.kind === 'cloud') return `☁ ${target.repo}${target.branch ? '@' + target.branch : ''}`;
    return `📁 ${(target.projectPath || '').split(/[\\/]/).slice(-2).join('/') || '?'}`;
  }

  // ---------- Styles ----------
  const STYLE_ID = 'pp-missions-styles';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.pp-missions { display:flex; flex-direction:column; height:100%; font-family:var(--font-sans); color:var(--text); }
.pp-missions-head { padding:10px 12px 8px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:8px; }
.pp-missions-title-row { display:flex; align-items:center; gap:8px; justify-content:space-between; }
.pp-missions-title { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--text-mid); font-family:var(--font-mono); }
.pp-missions-newwrap { display:flex; align-items:stretch; }
.pp-missions-newbtn { background:var(--accent); color:#fff; border:none; padding:5px 10px; font-size:11.5px; font-weight:500; cursor:pointer; display:flex; align-items:center; gap:5px; transition:background 0.15s; }
.pp-missions-newbtn:first-child { border-radius:6px 0 0 6px; }
.pp-missions-newbtn:last-child { border-radius:0 6px 6px 0; padding:5px 8px; border-left:1px solid rgba(255,255,255,0.15); }
.pp-missions-newwrap > .pp-missions-newbtn:only-child { border-radius:6px; }
.pp-missions-newbtn:hover { background:var(--accent-hover); }
.pp-preset-menu { position:fixed; z-index:9100; min-width:230px; background:var(--surface,#1c1c21); border:1px solid var(--border); border-radius:8px; padding:4px; box-shadow:0 12px 32px rgba(0,0,0,0.45); display:flex; flex-direction:column; gap:2px; }
.pp-preset-item { background:transparent; border:none; color:var(--text); padding:7px 10px; border-radius:5px; text-align:left; font-size:12.5px; cursor:pointer; font-family:var(--font-sans); transition:background 0.12s; }
.pp-preset-item:hover { background:rgba(255,107,53,0.12); color:var(--accent-light,#ffb38a); }
.pp-missions-pat-pill { display:flex; align-items:center; gap:6px; padding:5px 9px; border-radius:14px; font-size:11px; cursor:pointer; transition:background 0.15s; }
.pp-missions-pat-pill.set { background:rgba(86,212,221,0.1); border:1px solid rgba(86,212,221,0.3); color:#56d4dd; }
.pp-missions-pat-pill.unset { background:rgba(255,107,53,0.08); border:1px solid rgba(255,107,53,0.3); color:var(--accent-light, #ffb38a); }
.pp-missions-pat-pill:hover { filter:brightness(1.15); }
.pp-missions-pat-pill .pp-pat-dot { width:6px; height:6px; border-radius:50%; background:currentColor; }

.pp-missions-list { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:8px; }
.pp-missions-empty { padding:24px 12px; text-align:center; color:var(--text-dim); font-size:12px; line-height:1.6; }
.pp-missions-empty strong { display:block; color:var(--text-mid); font-size:13px; margin-bottom:4px; }

.pp-mission-card { background:var(--surface, #1c1c21); border:1px solid var(--border); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; transition:border-color 0.15s; }
.pp-mission-card:hover { border-color:rgba(255,255,255,0.16); }
.pp-mission-card.disabled { opacity:0.55; }
.pp-mission-card.running { border-color:var(--accent); box-shadow:0 0 0 1px rgba(255,107,53,0.2); }
.pp-mission-row1 { display:flex; align-items:center; gap:8px; }
.pp-mission-name { flex:1; font-size:12.5px; font-weight:500; color:var(--text-strong); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pp-mission-status-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.pp-mission-status-dot.success { background:var(--ok, #62c167); }
.pp-mission-status-dot.error { background:var(--error, #e5534b); }
.pp-mission-status-dot.skipped { background:var(--text-dim); }
.pp-mission-status-dot.timeout { background:#e0a04a; }
.pp-mission-status-dot.running { background:var(--info, #6cb6ff); animation:pp-mission-pulse 1.4s ease-in-out infinite; }
.pp-mission-status-dot.never { background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); }
@keyframes pp-mission-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

.pp-mission-meta { display:flex; gap:10px; font-size:10.5px; color:var(--text-dim); font-family:var(--font-mono); flex-wrap:wrap; }
.pp-mission-meta span { display:flex; align-items:center; gap:3px; }
.pp-mission-actions { display:flex; gap:6px; margin-top:2px; }
.pp-mission-btn { background:transparent; border:1px solid rgba(255,255,255,0.1); color:var(--text-mid); padding:3px 9px; border-radius:5px; font-size:10.5px; cursor:pointer; transition:all 0.15s; }
.pp-mission-btn:hover { background:rgba(255,255,255,0.05); color:var(--text-strong); border-color:rgba(255,255,255,0.18); }
.pp-mission-btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.pp-mission-btn.primary:hover { background:var(--accent-hover); }
.pp-mission-btn.danger:hover { background:rgba(229,83,75,0.15); color:var(--error); border-color:rgba(229,83,75,0.4); }

/* ── Editor modal ───────────────────────────────────────────── */
.pp-mission-editor-backdrop { position:fixed; inset:0; background:rgba(8,8,12,0.6); backdrop-filter:blur(4px); z-index:9000; display:flex; align-items:center; justify-content:center; padding:20px; animation:pp-mission-fade 0.18s ease-out; }
@keyframes pp-mission-fade { from { opacity:0; } to { opacity:1; } }
.pp-mission-editor { width:560px; max-width:100%; max-height:90vh; background:var(--surface,#1c1c21); border:1px solid var(--border); border-radius:10px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,0.5); }
.pp-me-head { padding:14px 18px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.pp-me-title { font-size:14px; font-weight:600; color:var(--text-strong); }
.pp-me-close { background:transparent; border:none; color:var(--text-mid); cursor:pointer; padding:4px 6px; border-radius:5px; font-size:18px; line-height:1; }
.pp-me-close:hover { background:rgba(255,255,255,0.06); color:var(--text-strong); }
.pp-me-body { padding:14px 18px 4px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:14px; font-size:12.5px; }

.pp-me-field { display:flex; flex-direction:column; gap:5px; }
.pp-me-label { font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase; color:var(--text-mid); font-family:var(--font-mono); font-weight:500; }
.pp-me-input, .pp-me-textarea, .pp-me-select { width:100%; background:rgba(0,0,0,0.25); border:1px solid var(--border); border-radius:6px; padding:8px 10px; color:var(--text-strong); font-family:var(--font-sans); font-size:12.5px; outline:none; transition:border-color 0.15s; box-sizing:border-box; }
.pp-me-input:focus, .pp-me-textarea:focus, .pp-me-select:focus { border-color:var(--accent); }
.pp-me-textarea { resize:vertical; min-height:90px; max-height:220px; font-family:var(--font-mono); font-size:12px; line-height:1.55; }
.pp-me-help { font-size:11px; color:var(--text-dim); }

.pp-me-tabs { display:flex; gap:4px; padding:3px; background:rgba(0,0,0,0.2); border-radius:6px; border:1px solid var(--border); width:fit-content; }
.pp-me-tab { background:transparent; border:none; color:var(--text-mid); padding:5px 12px; border-radius:4px; font-size:11.5px; cursor:pointer; transition:all 0.15s; font-family:var(--font-sans); }
.pp-me-tab:hover { color:var(--text-strong); }
.pp-me-tab.active { background:var(--accent); color:#fff; }

.pp-me-row { display:flex; gap:10px; }
.pp-me-row > .pp-me-field { flex:1; }
.pp-me-checkrow { display:flex; flex-direction:column; gap:6px; }
.pp-me-check { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-mid); cursor:pointer; user-select:none; }
.pp-me-check input { margin:0; cursor:pointer; }

.pp-me-foot { padding:12px 18px; border-top:1px solid var(--border); display:flex; gap:8px; justify-content:flex-end; }
.pp-me-foot .pp-me-spacer { flex:1; }
.pp-me-btn { background:transparent; border:1px solid var(--border); color:var(--text-mid); padding:7px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:500; transition:all 0.15s; }
.pp-me-btn:hover { background:rgba(255,255,255,0.05); color:var(--text-strong); }
.pp-me-btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.pp-me-btn.primary:hover { background:var(--accent-hover); }
.pp-me-btn:disabled { opacity:0.5; cursor:not-allowed; }
.pp-me-error { color:var(--error); font-size:11.5px; margin-right:auto; align-self:center; }

/* Titlebar pill */
.titlebar-missions-btn {
  display:flex; align-items:center; gap:6px;
  background:transparent; border:1px solid rgba(255,255,255,0.08);
  color:var(--text-mid); padding:4px 10px; border-radius:14px;
  font-size:11px; font-family:var(--font-sans); cursor:pointer;
  transition:background 0.15s, border-color 0.15s, color 0.15s;
  -webkit-app-region:no-drag;
}
.titlebar-missions-btn:hover { background:rgba(255,107,53,0.1); border-color:rgba(255,107,53,0.32); color:var(--accent-light,#ffb38a); }
.titlebar-missions-label { letter-spacing:0.04em; }
.titlebar-missions-dot { width:7px; height:7px; border-radius:50%; background:var(--info,#6cb6ff); animation:pp-mission-pulse 1.4s ease-in-out infinite; }
@media (max-width: 900px) { .titlebar-missions-label { display:none; } }
`;
    document.head.appendChild(s);
  }

  // ---------- Presets ----------
  // Templates to seed common mission shapes. The user can edit any field
  // after picking one — presets only fill the form.
  const PRESETS = {
    blank: { label: 'Blank' },
    bugbot: {
      label: 'BugBot — review code on commit',
      tags: ['bugbot'],
      seed: () => ({
        name: 'BugBot',
        prompt: [
          'You are a code-review bot. Review the most recent local changes (uncommitted diff first, otherwise the last commit) for bugs, regressions, and suspicious patterns.',
          '',
          'For EACH finding, append one line to `.pipilot/bug-findings.jsonl` (NOT a JSON array — one JSON object per line). Schema:',
          '  { "path": "<absolute or project-relative path>", "line": <1-based number>, "severity": "error"|"warning"|"info", "message": "<one-sentence description>", "code": "BugBot" }',
          '',
          'Rules:',
          '- DO NOT fix anything. Only report.',
          '- Skip stylistic nits and naming preferences. Focus on real bugs: null deref, off-by-one, wrong async patterns, missing error handling, security issues, regressions.',
          '- If there are zero findings worth surfacing, write nothing to the file and end with `Skipped: no bugs detected`.',
          '- Overwrite the file at the start of the run so old findings don\'t persist (use Write with empty content first if the file exists).',
        ].join('\n'),
        target: { kind: 'local', projectPath: state?.projectPath || '' },
        trigger: { kind: 'manual' },
        permissions: { preset: 'fs-only' },
        effort: 'medium',
        notify: { onSuccess: true, onError: true, onSkip: false },
        tags: ['bugbot'],
      }),
    },
    daily_summary: {
      label: 'Daily summary at 9am',
      seed: () => ({
        name: 'Daily summary',
        prompt: 'Summarise what changed in the project since the last summary. List notable commits, new files, and removed files. Append a dated section to `.pipilot/daily-summary.md`.',
        target: { kind: 'local', projectPath: state?.projectPath || '' },
        trigger: { kind: 'cron', spec: { hour: 9, minute: 0, weekdays: [1,2,3,4,5] } },
        permissions: { preset: 'fs-plus-bash' },
        effort: 'low',
        notify: { onSuccess: false, onError: true, onSkip: false },
      }),
    },
    cloud_pr_review: {
      label: 'Cloud PR review',
      seed: () => ({
        name: 'Open PRs review',
        prompt: 'List open pull requests on the configured repo. For each, fetch the diff, write a 3-bullet review to a comment on the PR via mcp__github__create_issue_comment.',
        target: { kind: 'cloud', repo: '', branch: 'main' },
        trigger: { kind: 'manual' },
        permissions: { preset: 'cloud' },
        effort: 'medium',
        notify: { onSuccess: true, onError: true, onSkip: false },
      }),
    },
  };

  // ---------- State ----------
  let panelContainer = null;
  let cachedMissions = [];
  let patIsSet = false;
  let runningIds = new Set();

  async function loadMissions() {
    try {
      const r = await api.missions.list(state?.projectPath || null);
      cachedMissions = r?.missions || [];
      runningIds = new Set(cachedMissions.filter(m => m.isRunning).map(m => m.id));
      updateTitlebarDot();
    } catch (err) {
      console.warn('[missions-panel] list failed', err);
      cachedMissions = [];
    }
  }

  async function loadPatStatus() {
    try {
      const r = await api.secrets.has('githubPat');
      patIsSet = !!r?.has;
    } catch { patIsSet = false; }
  }

  function updateTitlebarDot() {
    const dot = document.getElementById('titlebar-missions-dot');
    const badge = document.getElementById('missions-activity-badge');
    if (dot) {
      if (runningIds.size > 0) { dot.hidden = false; }
      else { dot.hidden = true; }
    }
    if (badge) {
      if (runningIds.size > 0) { badge.classList.remove('hidden'); badge.textContent = String(runningIds.size); }
      else { badge.classList.add('hidden'); }
    }
  }

  // ---------- Panel renderer ----------
  function renderPanel(container) {
    panelContainer = container;
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'pp-missions';
    root.innerHTML = `
      <div class="pp-missions-head">
        <div class="pp-missions-title-row">
          <span class="pp-missions-title">Missions</span>
          <div class="pp-missions-newwrap">
            <button class="pp-missions-newbtn" data-act="new">+ New Mission</button>
            <button class="pp-missions-newbtn pp-missions-newcaret" data-act="new-menu" title="Pick a preset">▾</button>
          </div>
        </div>
        <button class="pp-missions-pat-pill ${patIsSet ? 'set' : 'unset'}" data-act="pat">
          <span class="pp-pat-dot"></span>
          <span>${patIsSet ? 'GitHub connected' : 'Connect GitHub for cloud missions'}</span>
        </button>
      </div>
      <div class="pp-missions-list" id="pp-missions-list"></div>
    `;
    container.appendChild(root);
    root.querySelector('[data-act="new"]').addEventListener('click', () => openEditor(null));
    root.querySelector('[data-act="new-menu"]').addEventListener('click', (e) => openPresetMenu(e.currentTarget));
    root.querySelector('[data-act="pat"]').addEventListener('click', openPatModal);
    renderList();
  }

  function renderList() {
    const list = panelContainer?.querySelector('#pp-missions-list');
    if (!list) return;
    list.innerHTML = '';
    if (!cachedMissions.length) {
      list.innerHTML = `
        <div class="pp-missions-empty">
          <strong>No missions yet</strong>
          A Mission is a saved background agent task.<br/>
          Create one to schedule reviews, sync wikis, or run BugBot on your repo.
        </div>`;
      return;
    }
    for (const m of cachedMissions) list.appendChild(renderCard(m));
  }

  function renderCard(m) {
    const card = document.createElement('div');
    const isRunning = runningIds.has(m.id);
    const statusClass = isRunning ? 'running' : (m.lastRunStatus || 'never');
    card.className = 'pp-mission-card' + (m.enabled ? '' : ' disabled') + (isRunning ? ' running' : '');
    card.innerHTML = `
      <div class="pp-mission-row1">
        <span class="pp-mission-status-dot ${statusClass}" title="${escapeHtml(m.lastRunStatus || 'never run')}"></span>
        <span class="pp-mission-name">${escapeHtml(m.name)}</span>
      </div>
      <div class="pp-mission-meta">
        <span>${escapeHtml(describeTarget(m.target))}</span>
        <span>· ${escapeHtml(describeTrigger(m.trigger))}</span>
        <span>· ran ${m.runCount || 0}× · ${escapeHtml(relativeTime(m.lastRunAt))}</span>
      </div>
      ${m.lastRunMessage ? `<div class="pp-mission-meta" style="opacity:0.85;">${escapeHtml(m.lastRunMessage.slice(0, 100))}</div>` : ''}
      <div class="pp-mission-actions">
        <button class="pp-mission-btn primary" data-act="run" ${isRunning ? 'disabled' : ''}>${isRunning ? 'Running…' : 'Run now'}</button>
        <button class="pp-mission-btn" data-act="edit">Edit</button>
        <button class="pp-mission-btn" data-act="toggle">${m.enabled ? 'Disable' : 'Enable'}</button>
        <button class="pp-mission-btn danger" data-act="delete">Delete</button>
      </div>
    `;
    card.querySelector('[data-act="run"]').addEventListener('click', () => runNow(m));
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(m));
    card.querySelector('[data-act="toggle"]').addEventListener('click', () => toggleEnabled(m));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteMission(m));
    return card;
  }

  async function runNow(m) {
    if (m.target?.kind === 'cloud' && !patIsSet) {
      bus.emit('toast:show', { type: 'warn', message: 'Connect GitHub first' });
      openPatModal();
      return;
    }
    bus.emit('toast:show', { type: 'info', message: `Mission "${m.name}" queued` });
    const r = await api.missions.run(m.id, state?.projectPath || null, true);
    if (!r?.ok) bus.emit('toast:show', { type: 'warn', message: 'Could not start: ' + (r?.error || 'unknown') });
  }

  async function toggleEnabled(m) {
    const next = { ...m, enabled: !m.enabled };
    await api.missions.save(m.scope || 'global', state?.projectPath || null, next);
    await refresh();
  }

  async function deleteMission(m) {
    const ok = confirm(`Delete mission "${m.name}"? This can't be undone.`);
    if (!ok) return;
    await api.missions.delete(m.scope || 'global', state?.projectPath || null, m.id);
    await refresh();
  }

  async function refresh() {
    await loadMissions();
    renderList();
  }

  // ---------- Preset menu ----------
  function openPresetMenu(anchor) {
    const existing = document.getElementById('pp-preset-menu');
    if (existing) { existing.remove(); return; }
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'pp-preset-menu';
    menu.className = 'pp-preset-menu';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.innerHTML = Object.entries(PRESETS).map(([k, p]) =>
      `<button class="pp-preset-item" data-preset="${k}">${escapeHtml(p.label)}</button>`
    ).join('');
    document.body.appendChild(menu);
    const close = () => menu.remove();
    setTimeout(() => {
      document.addEventListener('click', function once(e) {
        if (!menu.contains(e.target) && e.target !== anchor) {
          close();
          document.removeEventListener('click', once);
        }
      });
    }, 0);
    menu.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        close();
        const key = btn.dataset.preset;
        const preset = PRESETS[key];
        if (!preset?.seed) { openEditor(null); return; }
        openEditor(preset.seed());
      });
    });
  }

  // ---------- PAT modal ----------
  function openPatModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'pp-mission-editor-backdrop';
    backdrop.innerHTML = `
      <div class="pp-mission-editor" style="width:440px;">
        <div class="pp-me-head">
          <span class="pp-me-title">Connect GitHub</span>
          <button class="pp-me-close" data-act="close">&times;</button>
        </div>
        <div class="pp-me-body">
          <div class="pp-me-field">
            <label class="pp-me-label">Personal access token</label>
            <input class="pp-me-input" type="password" id="pp-pat-input" placeholder="ghp_..." autocomplete="off" />
            <div class="pp-me-help">
              Used by cloud missions to read/edit GitHub repositories.
              Stored encrypted via your OS keychain (DPAPI on Windows, Keychain on macOS).
              Required scopes: <code>repo</code> (and <code>workflow</code> if missions touch CI files).
            </div>
          </div>
          <div class="pp-me-help">
            <a href="#" data-act="github-link" style="color:var(--info);">Open github.com/settings/tokens</a>
          </div>
        </div>
        <div class="pp-me-foot">
          <span class="pp-me-error" id="pp-pat-error"></span>
          ${patIsSet ? '<button class="pp-me-btn danger" data-act="clear">Disconnect</button>' : ''}
          <button class="pp-me-btn" data-act="close">Cancel</button>
          <button class="pp-me-btn primary" data-act="save">Save & verify</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener('click', close));
    backdrop.querySelector('[data-act="github-link"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      try { api.shell?.openExternal?.('https://github.com/settings/tokens'); } catch {}
    });
    backdrop.querySelector('[data-act="clear"]')?.addEventListener('click', async () => {
      await api.secrets.delete('githubPat');
      patIsSet = false;
      bus.emit('toast:show', { type: 'ok', message: 'GitHub disconnected' });
      close();
      renderPanel(panelContainer);
    });
    backdrop.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const input = backdrop.querySelector('#pp-pat-input');
      const errEl = backdrop.querySelector('#pp-pat-error');
      const tok = input.value.trim();
      errEl.textContent = '';
      if (!tok) { errEl.textContent = 'Token required'; return; }
      // Verify against api.github.com/user
      try {
        const res = await fetch('https://api.github.com/user', { headers: { Authorization: 'token ' + tok, 'User-Agent': 'PiPilot' } });
        if (!res.ok) { errEl.textContent = `GitHub rejected the token (${res.status})`; return; }
        await api.secrets.set('githubPat', tok);
        patIsSet = true;
        bus.emit('toast:show', { type: 'ok', message: 'GitHub connected' });
        close();
        renderPanel(panelContainer);
      } catch (err) {
        errEl.textContent = 'Network error: ' + (err?.message || err);
      }
    });
    setTimeout(() => backdrop.querySelector('#pp-pat-input')?.focus(), 50);
  }

  // ---------- Editor modal ----------
  function openEditor(existing) {
    const isNew = !existing;
    const m = existing ? JSON.parse(JSON.stringify(existing)) : {
      name: '',
      prompt: '',
      target: { kind: 'local', projectPath: state?.projectPath || '' },
      trigger: { kind: 'manual' },
      permissions: { preset: 'fs-only' },
      effort: 'medium',
      enabled: true,
      cloudPr: true,
      notify: { onSuccess: true, onError: true, onSkip: false },
    };

    const backdrop = document.createElement('div');
    backdrop.className = 'pp-mission-editor-backdrop';
    backdrop.innerHTML = `
      <div class="pp-mission-editor">
        <div class="pp-me-head">
          <span class="pp-me-title">${isNew ? 'New Mission' : 'Edit Mission'}</span>
          <button class="pp-me-close" data-act="close">&times;</button>
        </div>
        <div class="pp-me-body" id="pp-me-body"></div>
        <div class="pp-me-foot">
          <span class="pp-me-error" id="pp-me-error"></span>
          <button class="pp-me-btn" data-act="close">Cancel</button>
          ${isNew ? '' : '<button class="pp-me-btn" data-act="run">Save & Run now</button>'}
          <button class="pp-me-btn primary" data-act="save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const body = backdrop.querySelector('#pp-me-body');
    body.innerHTML = renderEditorBody(m);
    wireEditor(body, m);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener('click', close));
    backdrop.querySelector('[data-act="save"]').addEventListener('click', async () => {
      if (await saveFromEditor(backdrop, m, false)) close();
    });
    backdrop.querySelector('[data-act="run"]')?.addEventListener('click', async () => {
      const saved = await saveFromEditor(backdrop, m, true);
      if (saved) close();
    });
    setTimeout(() => backdrop.querySelector('#pp-me-name')?.focus(), 50);
  }

  function renderEditorBody(m) {
    return `
      <div class="pp-me-field">
        <label class="pp-me-label">Name</label>
        <input class="pp-me-input" id="pp-me-name" value="${escapeHtml(m.name)}" placeholder="e.g. Daily code review" />
      </div>
      <div class="pp-me-field">
        <label class="pp-me-label">Prompt</label>
        <textarea class="pp-me-textarea" id="pp-me-prompt" placeholder="Describe what the agent should do each time it runs.">${escapeHtml(m.prompt)}</textarea>
      </div>

      <div class="pp-me-field">
        <label class="pp-me-label">Target</label>
        <div class="pp-me-tabs" id="pp-me-target-tabs">
          <button class="pp-me-tab ${m.target?.kind === 'local' ? 'active' : ''}" data-target="local">Local project</button>
          <button class="pp-me-tab ${m.target?.kind === 'cloud' ? 'active' : ''}" data-target="cloud" ${patIsSet ? '' : 'title="Connect GitHub first"'}>Cloud (GitHub)</button>
        </div>
        <div id="pp-me-target-body" style="margin-top:6px;">${renderTargetBody(m)}</div>
      </div>

      <div class="pp-me-field">
        <label class="pp-me-label">Trigger</label>
        <div class="pp-me-tabs" id="pp-me-trigger-tabs">
          <button class="pp-me-tab ${m.trigger?.kind === 'manual' ? 'active' : ''}" data-trig="manual">Manual</button>
          <button class="pp-me-tab ${m.trigger?.kind === 'once' ? 'active' : ''}" data-trig="once">Once</button>
          <button class="pp-me-tab ${m.trigger?.kind === 'interval' ? 'active' : ''}" data-trig="interval">Interval</button>
          <button class="pp-me-tab ${m.trigger?.kind === 'cron' ? 'active' : ''}" data-trig="cron">Daily/Weekly</button>
        </div>
        <div id="pp-me-trigger-body" style="margin-top:6px;">${renderTriggerBody(m)}</div>
      </div>

      <div class="pp-me-row">
        <div class="pp-me-field">
          <label class="pp-me-label">Permissions</label>
          <select class="pp-me-select" id="pp-me-perm">
            <option value="fs-only" ${m.permissions?.preset === 'fs-only' ? 'selected' : ''}>FS only (Read/Edit/Write)</option>
            <option value="fs-plus-bash" ${m.permissions?.preset === 'fs-plus-bash' ? 'selected' : ''}>FS + Bash</option>
            <option value="fs-plus-web" ${m.permissions?.preset === 'fs-plus-web' ? 'selected' : ''}>FS + Web</option>
            <option value="full" ${m.permissions?.preset === 'full' ? 'selected' : ''}>Full (FS + Bash + Web + sub-agents)</option>
            <option value="cloud" ${m.permissions?.preset === 'cloud' ? 'selected' : ''}>Cloud only (GitHub MCP)</option>
          </select>
        </div>
        <div class="pp-me-field">
          <label class="pp-me-label">Effort</label>
          <select class="pp-me-select" id="pp-me-effort">
            <option value="none" ${m.effort === 'none' ? 'selected' : ''}>None</option>
            <option value="low" ${m.effort === 'low' ? 'selected' : ''}>Low</option>
            <option value="medium" ${m.effort === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high" ${m.effort === 'high' ? 'selected' : ''}>High</option>
          </select>
        </div>
      </div>

      <div class="pp-me-field" id="pp-me-cloud-pr-field" style="${m.target?.kind === 'cloud' ? '' : 'display:none;'}">
        <label class="pp-me-check">
          <input type="checkbox" id="pp-me-cloudpr" ${m.cloudPr !== false ? 'checked' : ''} />
          Open a Pull Request instead of pushing directly
        </label>
        <div class="pp-me-help">Recommended. Disable to commit directly to the branch (advanced).</div>
      </div>

      <div class="pp-me-field">
        <label class="pp-me-label">Notifications</label>
        <div class="pp-me-checkrow">
          <label class="pp-me-check"><input type="checkbox" id="pp-me-not-success" ${m.notify?.onSuccess !== false ? 'checked' : ''} /> Toast on success</label>
          <label class="pp-me-check"><input type="checkbox" id="pp-me-not-error" ${m.notify?.onError !== false ? 'checked' : ''} /> Toast on error</label>
          <label class="pp-me-check"><input type="checkbox" id="pp-me-not-skip" ${m.notify?.onSkip === true ? 'checked' : ''} /> Toast when skipped</label>
        </div>
      </div>

      <div class="pp-me-field">
        <label class="pp-me-check"><input type="checkbox" id="pp-me-enabled" ${m.enabled !== false ? 'checked' : ''} /> Mission is enabled</label>
      </div>
    `;
  }

  function renderTargetBody(m) {
    if (m.target?.kind === 'cloud') {
      return `
        <div class="pp-me-row">
          <div class="pp-me-field"><label class="pp-me-label">Repository</label>
            <input class="pp-me-input" id="pp-me-repo" placeholder="owner/name" value="${escapeHtml(m.target.repo || '')}" /></div>
          <div class="pp-me-field" style="flex:0 0 140px;"><label class="pp-me-label">Branch</label>
            <input class="pp-me-input" id="pp-me-branch" placeholder="main" value="${escapeHtml(m.target.branch || 'main')}" /></div>
        </div>
        <div class="pp-me-help">${patIsSet ? '' : '⚠ Connect GitHub before saving a cloud mission.'}</div>`;
    }
    return `
      <input class="pp-me-input" id="pp-me-projectpath" placeholder="C:/path/to/project" value="${escapeHtml(m.target?.projectPath || state?.projectPath || '')}" />
      <div class="pp-me-help">Defaults to your currently open project.</div>`;
  }

  function renderTriggerBody(m) {
    const t = m.trigger || {};
    switch (t.kind) {
      case 'once': {
        const v = t.at ? new Date(t.at).toISOString().slice(0,16) : '';
        return `<input class="pp-me-input" type="datetime-local" id="pp-me-once-at" value="${v}" />`;
      }
      case 'interval': {
        const m_ = (t.everyMs || 3600000) / 60_000;
        return `
          <div class="pp-me-row">
            <div class="pp-me-field"><label class="pp-me-label">Every</label>
              <input class="pp-me-input" type="number" min="1" id="pp-me-int-amt" value="${m_}" /></div>
            <div class="pp-me-field"><label class="pp-me-label">Unit</label>
              <select class="pp-me-select" id="pp-me-int-unit">
                <option value="minutes" selected>Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select></div>
          </div>
          <div class="pp-me-help">Minimum 1 minute. Runs are subject to the cooldown.</div>`;
      }
      case 'cron': {
        const c = t.spec || { hour: 9, minute: 0, weekdays: null };
        const wd = Array.isArray(c.weekdays) ? c.weekdays : null;
        const isDaily = !wd || wd.length === 7;
        const isWeekdays = wd && JSON.stringify(wd) === JSON.stringify([1,2,3,4,5]);
        const isWeekends = wd && JSON.stringify(wd) === JSON.stringify([0,6]);
        const isCustom = !isDaily && !isWeekdays && !isWeekends;
        const time = `${String(c.hour ?? 9).padStart(2,'0')}:${String(c.minute ?? 0).padStart(2,'0')}`;
        const wdNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        return `
          <div class="pp-me-tabs" id="pp-me-cron-mode" style="margin-bottom:6px;">
            <button class="pp-me-tab ${isDaily ? 'active' : ''}" data-cron="daily">Daily</button>
            <button class="pp-me-tab ${isWeekdays ? 'active' : ''}" data-cron="weekdays">Weekdays</button>
            <button class="pp-me-tab ${isWeekends ? 'active' : ''}" data-cron="weekends">Weekends</button>
            <button class="pp-me-tab ${isCustom ? 'active' : ''}" data-cron="custom">Custom</button>
          </div>
          <div class="pp-me-row">
            <div class="pp-me-field"><label class="pp-me-label">Time</label>
              <input class="pp-me-input" type="time" id="pp-me-cron-time" value="${time}" /></div>
          </div>
          <div id="pp-me-cron-days" style="${isCustom ? '' : 'display:none;'}margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">
            ${wdNames.map((n,i) => `<label class="pp-me-check"><input type="checkbox" data-wd="${i}" ${wd && wd.includes(i) ? 'checked' : ''} /> ${n}</label>`).join('')}
          </div>`;
      }
      default:
        return `<div class="pp-me-help">Mission only runs when you click <em>Run now</em>.</div>`;
    }
  }

  function wireEditor(body, m) {
    body.querySelectorAll('#pp-me-target-tabs .pp-me-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const kind = tab.dataset.target;
        if (kind === 'cloud' && !patIsSet) {
          bus.emit('toast:show', { type: 'warn', message: 'Connect GitHub first' });
          openPatModal();
          return;
        }
        m.target = kind === 'cloud'
          ? { kind: 'cloud', repo: m.target?.repo || '', branch: m.target?.branch || 'main' }
          : { kind: 'local', projectPath: m.target?.projectPath || state?.projectPath || '' };
        body.querySelectorAll('#pp-me-target-tabs .pp-me-tab').forEach(t => t.classList.toggle('active', t === tab));
        body.querySelector('#pp-me-target-body').innerHTML = renderTargetBody(m);
        body.querySelector('#pp-me-cloud-pr-field').style.display = kind === 'cloud' ? '' : 'none';
      });
    });
    body.querySelectorAll('#pp-me-trigger-tabs .pp-me-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const kind = tab.dataset.trig;
        m.trigger = { kind, ...(kind === 'cron' ? { spec: m.trigger?.spec || { hour: 9, minute: 0, weekdays: null } } : {}) };
        body.querySelectorAll('#pp-me-trigger-tabs .pp-me-tab').forEach(t => t.classList.toggle('active', t === tab));
        body.querySelector('#pp-me-trigger-body').innerHTML = renderTriggerBody(m);
        wireCronTabs(body, m);
      });
    });
    wireCronTabs(body, m);
  }

  function wireCronTabs(body, m) {
    const cronMode = body.querySelector('#pp-me-cron-mode');
    if (!cronMode) return;
    cronMode.querySelectorAll('.pp-me-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        cronMode.querySelectorAll('.pp-me-tab').forEach(t => t.classList.toggle('active', t === tab));
        const days = body.querySelector('#pp-me-cron-days');
        if (tab.dataset.cron === 'custom') days.style.display = '';
        else days.style.display = 'none';
      });
    });
  }

  function readEditor(backdrop, m) {
    const $ = (sel) => backdrop.querySelector(sel);
    const name = $('#pp-me-name').value.trim();
    const prompt = $('#pp-me-prompt').value.trim();
    const permPreset = $('#pp-me-perm').value;
    const effort = $('#pp-me-effort').value;
    const enabled = $('#pp-me-enabled').checked;
    const notify = {
      onSuccess: $('#pp-me-not-success').checked,
      onError: $('#pp-me-not-error').checked,
      onSkip: $('#pp-me-not-skip').checked,
    };
    let target;
    if (m.target.kind === 'cloud') {
      target = { kind: 'cloud', repo: $('#pp-me-repo').value.trim(), branch: $('#pp-me-branch').value.trim() || 'main' };
    } else {
      target = { kind: 'local', projectPath: $('#pp-me-projectpath').value.trim() };
    }
    const cloudPr = $('#pp-me-cloudpr')?.checked !== false;

    let trigger = { kind: m.trigger.kind || 'manual' };
    if (trigger.kind === 'once') {
      const v = $('#pp-me-once-at')?.value;
      if (v) trigger.at = new Date(v).getTime();
    } else if (trigger.kind === 'interval') {
      const amt = parseInt($('#pp-me-int-amt')?.value || '1', 10);
      const unit = $('#pp-me-int-unit')?.value || 'minutes';
      const mult = unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 86_400_000;
      trigger.everyMs = Math.max(60_000, amt * mult);
    } else if (trigger.kind === 'cron') {
      const time = $('#pp-me-cron-time')?.value || '09:00';
      const [h, mi] = time.split(':').map(x => parseInt(x, 10));
      const cronMode = backdrop.querySelector('#pp-me-cron-mode .pp-me-tab.active')?.dataset?.cron || 'daily';
      let weekdays = null;
      if (cronMode === 'weekdays') weekdays = [1,2,3,4,5];
      else if (cronMode === 'weekends') weekdays = [0,6];
      else if (cronMode === 'custom') {
        weekdays = Array.from(backdrop.querySelectorAll('#pp-me-cron-days input[type=checkbox]'))
          .filter(cb => cb.checked).map(cb => parseInt(cb.dataset.wd, 10));
        if (!weekdays.length) weekdays = null;
      }
      trigger.spec = { hour: h, minute: mi, weekdays };
    }

    return {
      ...m,
      name, prompt, target, trigger, effort, enabled, cloudPr, notify,
      permissions: { preset: permPreset },
    };
  }

  async function saveFromEditor(backdrop, original, runAfter) {
    const errEl = backdrop.querySelector('#pp-me-error');
    errEl.textContent = '';
    let m;
    try { m = readEditor(backdrop, original); }
    catch (err) { errEl.textContent = err?.message || String(err); return false; }

    const scope = m.target?.kind === 'local' && state?.projectPath ? 'project' : 'global';
    const r = await api.missions.save(scope, state?.projectPath || null, m);
    if (!r?.ok) { errEl.textContent = r?.error || 'Save failed'; return false; }
    bus.emit('toast:show', { type: 'ok', message: `Mission saved` });
    await refresh();
    if (runAfter) {
      const rr = await api.missions.run(r.mission.id, state?.projectPath || null, true);
      if (!rr?.ok) bus.emit('toast:show', { type: 'warn', message: 'Could not start: ' + (rr?.error || 'unknown') });
    }
    return true;
  }

  // ---------- Wire up ----------
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.panels = window.PiPilot.panels || {};
  window.PiPilot.panels.missions = (container) => {
    Promise.all([loadMissions(), loadPatStatus()]).then(() => renderPanel(container));
  };
  window.PiPilot.missions = window.PiPilot.missions || {};
  window.PiPilot.missions.openPanel = () => bus.emit('panel:switch', 'missions');
  window.PiPilot.missions.openEditor = (m) => openEditor(m || null);
  window.PiPilot.missions.openPatModal = openPatModal;

  // Refresh on broadcasts so the panel stays live.
  api.missions.onStatus((payload) => {
    if (payload?.state === 'running') runningIds.add(payload.id);
    else runningIds.delete(payload.id);
    updateTitlebarDot();
    if (panelContainer && panelContainer.querySelector('#pp-missions-list')) {
      // Refresh full state (status broadcasts include final stats too).
      refresh();
    }
  });
  api.missions.onChanged(() => { if (panelContainer) refresh(); });
  bus.on('missions:refresh', () => { if (panelContainer) refresh(); });
  bus.on('project:opened', () => { if (panelContainer) refresh(); });

  // Titlebar pill
  const titleBtn = document.getElementById('titlebar-missions-btn');
  if (titleBtn) {
    titleBtn.addEventListener('click', () => bus.emit('panel:switch', 'missions'));
  }
  // Activity-bar button — wired by panels.js click delegation already.
})();
