// PiPilot IDE — Welcome Tab + Walkthroughs (opens as editor tabs like VSCode)

(() => {
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;
  const api = window.electronAPI;

  const WELCOME_ID = '__welcome__';
  const GETTING_STARTED_ID = '__walkthrough_getting_started__';
  const AI_POWER_ID = '__walkthrough_ai_power__';
  const RECENT_FILES_PREFIX = 'pipilot:recent-files:';

  // Bump the version string for a walkthrough whenever its content meaningfully
  // changes — the welcome card will then show an "Updated" pill until the user
  // re-opens the walkthrough at least once.
  const WALKTHROUGH_VERSIONS = {
    'getting-started': '1',
    'ai-power': '2', // bumped — show "Updated" badge
  };

  function clampPct(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }
  function markWalkthroughSeen(id) {
    try { localStorage.setItem('pipilot.walkthrough.seen.' + id, WALKTHROUGH_VERSIONS[id] || '1'); } catch {}
  }
  function setWalkthroughProgress(id, pct) {
    try { localStorage.setItem('pipilot.walkthrough.progress.' + id, String(clampPct(pct))); } catch {}
  }

  function normalizeProjectKey(projectPath) {
    return String(projectPath || '').replace(/\\/g, '/').toLowerCase();
  }

  function recentFilesStorageKey(projectPath) {
    return RECENT_FILES_PREFIX + normalizeProjectKey(projectPath);
  }

  function relToProject(filePath, projectPath) {
    const fp = String(filePath || '').replace(/\\/g, '/');
    const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!root) return fp;
    if (fp.toLowerCase().startsWith((root + '/').toLowerCase())) return fp.slice(root.length + 1);
    return fp;
  }

  function escapeHtmlSafe(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // Convert a "YYYY-MM-DD HH:MM" string into a relative phrase ("2h ago",
  // "yesterday", "3 days ago"). Returns null on parse failure.
  function relativeTimeFromString(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) return null;
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    if (!t || isNaN(t)) return null;
    const delta = Date.now() - t;
    if (delta < 0) return 'in the future';
    const sec = Math.floor(delta / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    if (sec < 60) return 'just now';
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    if (day === 1) return 'yesterday';
    if (day < 7) return `${day} days ago`;
    if (day < 30) return `${Math.floor(day / 7)} week${Math.floor(day / 7) === 1 ? '' : 's'} ago`;
    if (day < 365) return `${Math.floor(day / 30)} month${Math.floor(day / 30) === 1 ? '' : 's'} ago`;
    return `${Math.floor(day / 365)} year${Math.floor(day / 365) === 1 ? '' : 's'} ago`;
  }

  function toAbsoluteFromProject(relPath, projectPath) {
    const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root || !rel) return '';
    return `${root}/${rel}`;
  }

  // ── Welcome Tab ──
  // The welcome tab is intentionally transient: never persisted, never
  // restored, and always re-mounted on open. Mounting is the only place
  // we read the diary, so forcing a fresh mount each time guarantees the
  // resume carousel reflects the latest entries — no stale-tab race.
  function openWelcomeTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    // If a stale welcome tab is open, tear it down before opening a new
    // one so mount() runs again and pulls fresh diary data.
    try {
      if (editor.isVirtualTab && editor.isVirtualTab(WELCOME_ID) && typeof editor.closeFile === 'function') {
        editor.closeFile(WELCOME_ID);
      }
    } catch {}
    editor.openVirtualTab({
      id: WELCOME_ID,
      name: 'Welcome',
      icon: '🏠',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildWelcomeHTML();
        wireWelcomeEvents(container);
      },
    });
  }

  function buildWelcomeHTML() {
    return `<div class="wt-welcome">
      <div class="wt-bg" aria-hidden="true">
        <div class="wt-bg-warm"></div>
        <div class="wt-bg-cool"></div>
        <div class="wt-bg-grid"></div>
        <div class="wt-bg-grain"></div>
        <div class="wt-bg-vignette"></div>
      </div>

      <div class="wt-welcome-inner">

        <header class="wt-hero" style="--wt-anim-delay:0ms;">
          <span class="wt-eyebrow"><span class="wt-eyebrow-dot"></span>AI · NATIVE · IDE</span>
          <div class="wt-hero-row">
            <div class="wt-hero-logo-frame">
              <img src="public/icon.png" class="wt-hero-logo" />
              <span class="wt-hero-logo-glow" aria-hidden="true"></span>
            </div>
            <div class="wt-hero-text">
              <h1 class="wt-hero-title">PiPilot<span class="wt-hero-title-mark">.</span></h1>
              <p class="wt-hero-tagline">An editor that thinks alongside you.</p>
            </div>
          </div>
          <div class="wt-hero-meta">
            <span class="wt-meta-chip"><span class="wt-meta-led"></span>v1.0.0</span>
            <span class="wt-meta-sep"></span>
            <span class="wt-meta-chip">Native Desktop</span>
            <span class="wt-meta-sep"></span>
            <span class="wt-meta-chip">AI Agents</span>
          </div>
        </header>

        <!-- Resumption: Yesterday Card. Populated async after mount. -->
        <div class="wt-resume" id="wt-resume-host" hidden></div>

        <div class="wt-main">
          <div class="wt-col">
            <section class="wt-section" style="--wt-anim-delay:80ms;">
              <div class="wt-section-head">
                <span class="wt-section-num">01</span>
                <h2 class="wt-section-title">Start</h2>
                <span class="wt-section-rule"></span>
              </div>
              <div class="wt-actions">
                <button class="wt-action" data-action="new-file">
                  <span class="wt-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6M9 15h6"/></svg></span>
                  <span class="wt-action-label">New File</span>
                  <span class="wt-action-arrow">→</span>
                </button>
                <button class="wt-action" data-action="open-folder">
                  <span class="wt-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
                  <span class="wt-action-label">Open Folder</span>
                  <span class="wt-action-arrow">→</span>
                </button>
                <button class="wt-action" data-action="clone-repo">
                  <span class="wt-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></span>
                  <span class="wt-action-label">Clone Git Repository</span>
                  <span class="wt-action-arrow">→</span>
                </button>
                <button class="wt-action wt-action-primary" data-action="new-project">
                  <span class="wt-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg></span>
                  <span class="wt-action-label">Generate New Project with AI</span>
                  <span class="wt-action-arrow">→</span>
                </button>
              </div>
            </section>

            <section class="wt-section" style="--wt-anim-delay:160ms;">
              <div class="wt-section-head">
                <span class="wt-section-num">02</span>
                <h2 class="wt-section-title">Recent</h2>
                <span class="wt-section-rule"></span>
              </div>
              <div class="wt-recent" id="wt-recent-list"><div class="wt-recent-loading">Loading…</div></div>
            </section>
          </div>

          <div class="wt-col">
            <section class="wt-section wt-section-vscode" style="--wt-anim-delay:120ms;">
              <h2 class="wt-vscode-h2">Walkthroughs</h2>
              <div class="wt-walkthroughs">
                <button class="wt-wk-card featured" data-walkthrough="getting-started" data-wk-id="getting-started">
                  <span class="wt-wk-pennant" aria-hidden="true">
                    <svg viewBox="0 0 36 36" width="36" height="36">
                      <path d="M0 0 L36 0 L36 14 L18 36 L0 18 Z" fill="var(--accent, #4a8cff)"/>
                      <path d="M14 7l1.6 4.8h5l-4 2.9 1.5 4.8-4.1-3-4.1 3 1.5-4.8-4-2.9h5z" fill="#ffffff"/>
                    </svg>
                  </span>
                  <div class="wt-wk-body">
                    <div class="wt-wk-title-row">
                      <span class="wt-wk-title">Get Started with PiPilot</span>
                    </div>
                    <div class="wt-wk-desc">Customize your editor, learn the basics, and start coding.</div>
                  </div>
                  <div class="wt-wk-progress" aria-hidden="true"><div class="wt-wk-progress-fill"></div></div>
                </button>
                <button class="wt-wk-card" data-walkthrough="ai-power" data-wk-id="ai-power">
                  <span class="wt-wk-icon-line">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12a4 4 0 0 1 4-4M12 16a4 4 0 0 0 4-4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
                  </span>
                  <div class="wt-wk-body">
                    <div class="wt-wk-title-row">
                      <span class="wt-wk-title">AI Power User</span>
                      <span class="wt-wk-badge" data-show="updated">Updated</span>
                    </div>
                    <div class="wt-wk-desc">Your AI pair programmer to write code faster and smarter.</div>
                  </div>
                  <div class="wt-wk-progress" aria-hidden="true"><div class="wt-wk-progress-fill"></div></div>
                </button>
              </div>
            </section>

            <section class="wt-section wt-section-vscode" style="--wt-anim-delay:200ms;">
              <h2 class="wt-vscode-h2">Help</h2>
              <div class="wt-actions">
                <button class="wt-action" data-action="docs">
                  <span class="wt-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg></span>
                  <span class="wt-action-label">Documentation</span>
                  <span class="wt-action-arrow">→</span>
                </button>
                <button class="wt-action" data-action="shortcuts">
                  <span class="wt-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h8M6 16h.01M18 16h.01M10 16h4"/></svg></span>
                  <span class="wt-action-label">Keyboard Shortcuts</span>
                  <span class="wt-action-arrow">→</span>
                </button>
              </div>
            </section>
          </div>
        </div>

        <footer class="wt-footer" style="--wt-anim-delay:260ms;">
          <label class="wt-checkbox">
            <input type="checkbox" id="wt-show-on-startup" checked />
            <span class="wt-checkbox-box"></span>
            <span class="wt-checkbox-label">Show welcome page on startup</span>
          </label>
          <span class="wt-footer-credit">crafted with care · pipilot</span>
        </footer>

      </div>
    </div>`;
  }

  // Strip the trailing meta footer (`<!-- meta: turns=..., session=... -->`)
  // and any "Last prompt:" / "Agent summary:" prefixes from older fallback
  // entries so the Resume Card displays clean prose.
  function cleanDiarySummary(s) {
    if (!s) return '';
    let out = String(s);
    // Drop comment-style meta footer and anything after it.
    out = out.replace(/<!--\s*meta:[\s\S]*?-->\s*$/m, '').trim();
    return out;
  }

  // Loads recent diary entries into the resume host as a carousel — the
  // newest entry is shown first (active). Prev/Next buttons + dot
  // indicators navigate through up to 10 prior entries. Idempotent.
  async function loadResumeCardInto(container) {
    if (!container) return;
    const host = container.querySelector('#wt-resume-host');
    if (!host) return;
    const projectPath = state.projectPath;
    if (!projectPath || !api.diary?.read) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    try {
      const r = await api.diary.read(projectPath, 10);
      const all = (r?.entries || [])
        .map(e => ({ ...e, summary: cleanDiarySummary(e?.summary || '') }))
        .filter(e => e && e.summary);
      if (!all.length) {
        host.hidden = true;
        host.innerHTML = '';
        return;
      }

      const renderBody = (s) => {
        try {
          return window.marked?.parse
            ? window.marked.parse(s, { breaks: true, gfm: true })
            : escapeHtmlSafe(s).replace(/\n+/g, '<br/>');
        } catch {
          return escapeHtmlSafe(s).replace(/\n+/g, '<br/>');
        }
      };

      const slides = all.map((entry, i) => {
        const ago = relativeTimeFromString(entry.time) || entry.time;
        const eyebrow = i === 0 ? 'Resume where you left off' : 'Earlier session';
        const sid = entry?.meta?.session || '';
        return `
          <div class="wt-resume-slide" data-idx="${i}" data-session-id="${escapeHtmlSafe(sid)}" ${i === 0 ? '' : 'aria-hidden="true"'}>
            <div class="wt-resume-head">
              <span class="wt-resume-eyebrow">${eyebrow}</span>
              <span class="wt-resume-time">${escapeHtmlSafe(ago)}</span>
            </div>
            <div class="wt-resume-body md-body">${renderBody(entry.summary)}</div>
          </div>`;
      }).join('');

      const dots = all.map((_, i) =>
        `<button type="button" class="wt-resume-dot${i === 0 ? ' active' : ''}" data-idx="${i}" aria-label="Diary entry ${i + 1}"></button>`
      ).join('');

      const showNav = all.length > 1;
      host.innerHTML = `
        <div class="wt-resume-card${showNav ? ' has-carousel' : ''}">
          <div class="wt-resume-track" data-active="0">${slides}</div>
          ${showNav ? `
            <button type="button" class="wt-resume-nav prev" data-nav="prev" aria-label="Previous entry">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button type="button" class="wt-resume-nav next" data-nav="next" aria-label="Next entry">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div class="wt-resume-dots">${dots}</div>
          ` : ''}
          <div class="wt-resume-actions">
            <button class="wt-resume-btn" data-action="resume-chat">Open chat</button>
            <button class="wt-resume-btn ghost" data-action="dismiss-resume">Dismiss</button>
          </div>
        </div>`;
      host.hidden = false;
      host.style.opacity = ''; host.style.maxHeight = '';

      const card = host.querySelector('.wt-resume-card');
      const track = host.querySelector('.wt-resume-track');
      const resumeBtn = () => host.querySelector('[data-action="resume-chat"]');
      const setActive = (idx) => {
        const n = all.length;
        const i = ((idx % n) + n) % n;
        track.dataset.active = String(i);
        host.querySelectorAll('.wt-resume-slide').forEach((el, j) => {
          el.classList.toggle('active', j === i);
          if (j === i) el.removeAttribute('aria-hidden');
          else el.setAttribute('aria-hidden', 'true');
        });
        host.querySelectorAll('.wt-resume-dot').forEach((el, j) => {
          el.classList.toggle('active', j === i);
        });
        // Sync the resume button to the active slide's session — disable
        // when the entry was written without a session id (older diaries).
        const btn = resumeBtn();
        if (btn) {
          const sid = all[i]?.meta?.session || '';
          btn.dataset.sessionId = sid;
          btn.disabled = !sid;
          btn.title = sid ? `Open session ${sid}` : 'Session id not recorded for this entry';
          btn.textContent = sid ? 'Open session' : 'Open chat';
        }
      };
      // Mark first slide active so CSS reveals it.
      setActive(0);

      if (showNav) {
        host.querySelector('[data-nav="prev"]')?.addEventListener('click', () => {
          setActive((parseInt(track.dataset.active, 10) || 0) - 1);
        });
        host.querySelector('[data-nav="next"]')?.addEventListener('click', () => {
          setActive((parseInt(track.dataset.active, 10) || 0) + 1);
        });
        host.querySelectorAll('.wt-resume-dot').forEach(d => {
          d.addEventListener('click', () => setActive(parseInt(d.dataset.idx, 10) || 0));
        });
        // Arrow-key navigation when card is focused/hovered.
        card?.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((parseInt(track.dataset.active, 10) || 0) - 1); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); setActive((parseInt(track.dataset.active, 10) || 0) + 1); }
        });
        card?.setAttribute('tabindex', '0');
      }

      host.querySelector('[data-action="resume-chat"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const sid = btn?.dataset?.sessionId || '';
        // Make sure the chat panel is visible so the user actually sees
        // the session they just opened — only emits "show" if currently
        // hidden, so it never closes an open panel.
        try { bus.emit('chat:show'); } catch {}
        if (!sid) {
          // Fallback: no session id recorded — best we can do is reveal
          // the chat panel and let the user pick from history.
          try { bus.emit('menu:view:toggle-chat'); } catch {}
          return;
        }
        try {
          const loadFn = window.PiPilot?.chat?.loadSession;
          if (typeof loadFn === 'function') {
            await loadFn(sid);
            window.PiPilot?.chat?.focus?.();
          } else {
            console.warn('[welcome] chat.loadSession unavailable');
            try { bus.emit('menu:view:toggle-chat'); } catch {}
          }
        } catch (err) {
          console.warn('[welcome] failed to open session', sid, err);
          bus.emit('toast:show', { type: 'warn', message: 'Could not open that chat session' });
        }
      });
      host.querySelector('[data-action="dismiss-resume"]')?.addEventListener('click', () => {
        host.style.transition = 'opacity 0.2s, max-height 0.3s';
        host.style.opacity = '0'; host.style.maxHeight = '0';
        setTimeout(() => { host.hidden = true; host.style.maxHeight = ''; host.style.opacity = ''; host.innerHTML = ''; }, 320);
      });
    } catch (err) {
      console.warn('[welcome] resume card load failed:', err);
    }
  }

  // Find the live welcome tab container if one exists, so external
  // refreshes don't have to know the editor's tab plumbing.
  function findWelcomeContainer() {
    return document.querySelector('[data-virtual-tab-id="' + WELCOME_ID + '"], #virtual-' + WELCOME_ID + ', .virtual-' + WELCOME_ID)
      || document.querySelector('.wt-welcome')?.parentElement
      || document.querySelector('.wt-welcome');
  }

  async function wireWelcomeEvents(container) {
    // Initial load when the welcome tab first mounts. If the project
    // isn't loaded yet (e.g. cold-start before project:opened), this is a
    // no-op — the project:opened listener below will refresh it.
    loadResumeCardInto(container);

    // Start actions
    container.querySelector('[data-action="new-file"]')?.addEventListener('click', () => bus.emit('menu:file:new-file'));
    container.querySelector('[data-action="open-folder"]')?.addEventListener('click', async () => {
      const p = await api.pickFolder(); if (p) bus.emit('project:open', p);
    });
    container.querySelector('[data-action="clone-repo"]')?.addEventListener('click', () => bus.emit('modal:clone-repo'));
    container.querySelector('[data-action="new-project"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('pipilot:show-generate-modal'));
    });
    container.querySelector('[data-action="docs"]')?.addEventListener('click', openDocsTab);
    container.querySelector('[data-action="shortcuts"]')?.addEventListener('click', openShortcutsTab);

    // Walkthroughs — wire clicks + paint progress + Updated badge from localStorage
    container.querySelector('[data-walkthrough="getting-started"]')?.addEventListener('click', openGettingStartedTab);
    container.querySelector('[data-walkthrough="ai-power"]')?.addEventListener('click', openAIPowerTab);
    container.querySelectorAll('.wt-wk-card[data-wk-id]').forEach((card) => {
      const id = card.dataset.wkId;
      const pct = clampPct(parseInt(localStorage.getItem('pipilot.walkthrough.progress.' + id) || '0', 10));
      card.dataset.progress = pct;
      const fill = card.querySelector('.wt-wk-progress-fill');
      if (fill) fill.style.width = pct + '%';
      const badge = card.querySelector('.wt-wk-badge[data-show="updated"]');
      if (badge) {
        // Show "Updated" if the walkthrough version on disk is newer than what
        // the user last opened. Default visible until user opens it once.
        const lastSeen = localStorage.getItem('pipilot.walkthrough.seen.' + id) || '';
        const current = WALKTHROUGH_VERSIONS[id] || '1';
        badge.dataset.visible = lastSeen === current ? '0' : '1';
      }
    });

    // Show on startup checkbox
    const cb = container.querySelector('#wt-show-on-startup');
    const saved = localStorage.getItem('pipilot-show-welcome');
    if (saved === 'false') cb.checked = false;
    cb?.addEventListener('change', () => localStorage.setItem('pipilot-show-welcome', cb.checked));

    // Recent files — show last 5, filter out deleted files
    const list = container.querySelector('#wt-recent-list');
    try {
      const projectPath = state.projectPath;
      const raw = projectPath ? localStorage.getItem(recentFilesStorageKey(projectPath)) : null;
      const parsed = Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [];
      const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
      const rootPrefix = (root + '/').toLowerCase();

      const recents = parsed
        .map((entry) => {
          const s = String(entry || '').replace(/\\/g, '/');
          if (!s) return null;
          if (s.toLowerCase().startsWith(rootPrefix)) return s.slice(root.length + 1);
          if (!s.includes(':') && !s.startsWith('/')) return s.replace(/^\/+/, '');
          return null;
        })
        .filter(Boolean)
        .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);

      // Validate files exist on disk, remove deleted ones
      const validated = [];
      for (const relPath of recents) {
        if (validated.length >= 5) break;
        const fullPath = toAbsoluteFromProject(relPath, projectPath);
        try {
          const stat = api?.files?.stat ? await api.files.stat(fullPath) : { size: 1 };
          const exists = stat && stat.size !== undefined;
          if (exists) validated.push(relPath);
        } catch {
          validated.push(relPath); // keep if we can't check (API unavailable)
        }
      }

      // Save cleaned list back
      try { if (projectPath) localStorage.setItem(recentFilesStorageKey(projectPath), JSON.stringify(validated)); } catch {}

      if (!projectPath || !validated.length) {
        list.innerHTML = '<div class="wt-no-recent">No recently opened files</div>';
      } else {
        list.innerHTML = '';
        validated.forEach(relPath => {
          const rel = String(relPath || '').replace(/\\/g, '/');
          const fullPath = toAbsoluteFromProject(rel, projectPath);
          const name = rel.split(/[\\/]/).pop();
          const dir = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';

          const row = document.createElement('div');
          row.className = 'wt-recent-row';

          const btn = document.createElement('button');
          btn.className = 'wt-recent-item';
          btn.dataset.path = fullPath;
          btn.innerHTML = `
            <span class="wt-recent-item-text">
              <span class="wt-recent-name">${name}</span>
              ${dir ? `<span class="wt-recent-path">${dir}</span>` : ''}
            </span>
          `;
          btn.addEventListener('click', () => bus.emit('file:open', { path: btn.dataset.path }));

          const removeBtn = document.createElement('button');
          removeBtn.className = 'wt-recent-remove';
          removeBtn.title = 'Remove from list';
          removeBtn.textContent = '\u00d7';
          removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const next = validated.filter(p => String(p).replace(/\\/g, '/') !== rel);
              localStorage.setItem(recentFilesStorageKey(projectPath), JSON.stringify(next));
            } catch {}
            row.remove();
            if (!list.children.length) {
              list.innerHTML = '<div class="wt-no-recent">No recently opened files</div>';
            }
          });

          row.appendChild(btn);
          row.appendChild(removeBtn);
          list.appendChild(row);
        });
      }
    } catch { list.innerHTML = '<div class="wt-no-recent">No recently opened files</div>'; }
  }

  // ── Getting Started Walkthrough ──
  function openGettingStartedTab() {
    markWalkthroughSeen('getting-started');
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: GETTING_STARTED_ID,
      name: 'Getting Started',
      icon: '🚀',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildGettingStartedHTML();
        wireWalkthroughEvents(container);
      },
    });
  }

  function buildGettingStartedHTML() {
    const steps = [
      { id: 'open-project', title: 'Open a project folder', desc: 'Open an existing folder or clone a repository to get started.', action: 'Open Folder', event: 'open-folder' },
      { id: 'explore-editor', title: 'Explore the editor', desc: 'Open files from the explorer, use tabs, breadcrumbs, and keyboard shortcuts to navigate.', done: true },
      { id: 'use-terminal', title: 'Use the integrated terminal', desc: 'Run commands, start dev servers, and manage your project from the built-in terminal.', action: 'Open Terminal', event: 'toggle-terminal' },
      { id: 'source-control', title: 'Track changes with Git', desc: 'Stage, commit, push, and manage branches from the Source Control panel.', action: 'Open Source Control', event: 'open-git' },
      { id: 'preview', title: 'Preview your project', desc: 'Start a dev server and see live changes in the built-in preview panel.', action: 'Open Preview', event: 'open-preview' },
      { id: 'customize', title: 'Customize your settings', desc: 'Adjust font size, themes, auto-save, and editor behavior from Settings.', action: 'Open Settings', event: 'open-settings' },
      { id: 'docs', title: 'Read the docs', desc: 'Full reference for every feature — AI agent, deploy hub, debugger, themes, extensions, and more.', action: 'Open Docs', event: 'open-help' },
    ];

    return `<div class="wt-walkthrough">
      <button class="wt-back" data-action="back">← Back</button>
      <div class="wt-wk-header">
        <h1 class="wt-wk-h1">Get Started with PiPilot</h1>
        <p class="wt-wk-subtitle">Customize your editor, learn the basics, and start coding</p>
      </div>
      <div class="wt-steps">
        ${steps.map(s => `
          <div class="wt-step ${s.done ? 'done' : ''}" data-step="${s.id}">
            <div class="wt-step-check">${s.done ? '✓' : '○'}</div>
            <div class="wt-step-content">
              <div class="wt-step-title">${s.title}</div>
              <div class="wt-step-desc">${s.desc}</div>
              ${s.action ? `<button class="wt-step-btn" data-event="${s.event}">${s.action}</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  // ── AI Power User Walkthrough ──
  function openAIPowerTab() {
    markWalkthroughSeen('ai-power');
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: AI_POWER_ID,
      name: 'AI Power User',
      icon: '🤖',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildAIPowerHTML();
        wireWalkthroughEvents(container);
      },
    });
  }

  function buildAIPowerHTML() {
    const steps = [
      { id: 'chat', title: 'Chat about your code', desc: 'Ask the AI agent to explain code, find bugs, or answer questions about your project.', done: true },
      { id: 'build', title: 'Build features with natural language', desc: 'Describe what you want and the agent will read, write, and run code for you.', done: true },
      { id: 'inline', title: 'AI-suggested inline completions', desc: 'As you type, PiPilot suggests code to help you complete what you started. Press Tab to accept, Esc to dismiss.', action: 'Try It', event: 'focus-editor' },
      { id: 'inline-chat', title: 'Use inline chat in the editor', desc: 'Select code and press Ctrl+I to open inline chat. Ask the AI to refactor, explain, or enhance your selection.', action: 'Try Ctrl+I', event: 'focus-editor' },
      { id: 'diagnostics', title: 'AI-powered diagnostics', desc: 'The agent can run diagnostics, find type errors, and fix them automatically. Click "AI Fix" on any problem.', action: 'Open Problems', event: 'open-problems' },
      { id: 'search', title: 'Smart codebase search', desc: 'The agent uses BM25 semantic search to understand your codebase. Ask "how does X work?" and get relevant results.', },
      { id: 'wiki', title: 'Generate project documentation', desc: 'The wiki-generator agent scans your code and creates comprehensive documentation with architecture diagrams.', action: 'Generate Wiki', event: 'generate-wiki' },
      { id: 'screenshot', title: 'Visual UI verification', desc: 'The agent can take screenshots of your running app and analyze the DOM layout to verify UI changes.', },
    ];

    return `<div class="wt-walkthrough">
      <button class="wt-back" data-action="back">← Back</button>
      <div class="wt-wk-header">
        <h1 class="wt-wk-h1">AI Power User</h1>
        <p class="wt-wk-subtitle">Your AI pair programmer to write code faster and smarter</p>
      </div>
      <div class="wt-steps">
        ${steps.map(s => `
          <div class="wt-step ${s.done ? 'done' : ''}" data-step="${s.id}">
            <div class="wt-step-check">${s.done ? '✓' : '○'}</div>
            <div class="wt-step-content">
              <div class="wt-step-title">${s.title}</div>
              <div class="wt-step-desc">${s.desc}</div>
              ${s.action ? `<button class="wt-step-btn" data-event="${s.event}">${s.action}</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  function wireWalkthroughEvents(container) {
    container.querySelector('[data-action="back"]')?.addEventListener('click', openWelcomeTab);
    container.querySelectorAll('.wt-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const event = btn.dataset.event;
        if (event === 'open-folder') bus.emit('menu:file:open-folder');
        else if (event === 'toggle-terminal') bus.emit('menu:view:toggle-terminal');
        else if (event === 'open-git') bus.emit('panel:switch', 'git');
        else if (event === 'open-preview') bus.emit('devserver:start');
        else if (event === 'open-settings') bus.emit('modal:settings');
        else if (event === 'open-help')     window.PiPilot?.help?.open?.();
        else if (event === 'open-problems') bus.emit('bottom:show', 'problems');
        else if (event === 'focus-editor') { /* just close the tab */ }
        else if (event === 'generate-wiki') {
          bus.emit('menu:view:toggle-chat');
          setTimeout(() => window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
            detail: { prefill: 'Use the wiki-generator sub-agent to generate project documentation.', submit: true },
          })), 200);
        }
        // Mark step as done
        const step = btn.closest('.wt-step');
        if (step) { step.classList.add('done'); step.querySelector('.wt-step-check').textContent = '✓'; }
      });
    });
  }

  // ── CSS ──
  function injectStyles() {
    if (document.getElementById('welcome-tab-css')) return;
    const s = document.createElement('style');
    s.id = 'welcome-tab-css';
    s.textContent = `
/* ─────────────────────────────────────────────────────────────────
   Welcome Screen — "Editorial Dusk"
   Atmospheric layered background, refined typography, smooth entry.
   ───────────────────────────────────────────────────────────────── */
.wt-welcome {
  position: relative;
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  background: var(--bg);
  font-family: var(--font-sans);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  scroll-behavior: smooth;
}

/* ── Atmospheric background layers ────────────────────────────── */
.wt-bg { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 0; }
.wt-bg-warm,
.wt-bg-cool {
  position: absolute;
  width: 880px;
  height: 880px;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.42;
  will-change: transform;
}
.wt-bg-warm {
  top: -360px; right: -260px;
  background: radial-gradient(circle, rgba(255,107,53,0.55) 0%, rgba(255,107,53,0) 65%);
  animation: wt-drift-warm 24s ease-in-out infinite alternate;
}
.wt-bg-cool {
  bottom: -380px; left: -240px;
  background: radial-gradient(circle, rgba(74,144,229,0.4) 0%, rgba(74,144,229,0) 65%);
  animation: wt-drift-cool 28s ease-in-out infinite alternate;
}
@keyframes wt-drift-warm {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to   { transform: translate3d(-30px, 25px, 0) scale(1.06); }
}
@keyframes wt-drift-cool {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to   { transform: translate3d(40px, -20px, 0) scale(1.04); }
}
.wt-bg-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(var(--overlay-1) 1px, transparent 1px),
    linear-gradient(90deg, var(--overlay-1) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse at 50% 30%, black 35%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 30%, black 35%, transparent 80%);
}
.wt-bg-grain {
  position: absolute; inset: 0;
  opacity: 0.5;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
.wt-bg-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 50% 0%, transparent 50%, rgba(0,0,0,0.38) 100%);
}

/* ── Inner wrapper ────────────────────────────────────────────── */
.wt-welcome-inner {
  position: relative;
  z-index: 1;
  max-width: 1100px;
  margin: 0 auto;
  padding: 80px 56px 48px;
  display: flex;
  flex-direction: column;
  gap: 56px;
}
@media (max-width: 880px) {
  .wt-welcome-inner { padding: 56px 28px 32px; gap: 40px; }
}

/* Entry animation — staggered via --wt-anim-delay per element */
.wt-hero,
.wt-section,
.wt-footer {
  opacity: 0;
  transform: translateY(14px);
  animation: wt-enter 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  animation-delay: var(--wt-anim-delay, 0ms);
}
@keyframes wt-enter {
  to { opacity: 1; transform: translateY(0); }
}

/* ── Hero ─────────────────────────────────────────────────────── */
.wt-hero { display: flex; flex-direction: column; gap: 22px; }

.wt-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--overlay-2);
  background: var(--overlay-1);
  backdrop-filter: blur(8px);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.18em;
  color: var(--accent-light);
}
.wt-eyebrow-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(255,107,53,0.18), 0 0 14px rgba(255,107,53,0.55);
  animation: wt-pulse 2.4s ease-in-out infinite;
}
@keyframes wt-pulse {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.15); }
}

.wt-hero-row { display: flex; align-items: flex-end; gap: 20px; }
.wt-hero-logo-frame {
  position: relative;
  width: 64px; height: 64px;
  flex-shrink: 0;
}
.wt-hero-logo {
  position: relative;
  z-index: 1;
  width: 64px; height: 64px;
  border-radius: 16px;
  box-shadow:
    0 1px 0 var(--overlay-2) inset,
    0 14px 40px rgba(255,107,53,0.35),
    0 4px 14px rgba(0,0,0,0.5);
}
.wt-hero-logo-glow {
  position: absolute; inset: -10px;
  border-radius: 22px;
  background: radial-gradient(circle, rgba(255,107,53,0.45), transparent 70%);
  filter: blur(18px);
  opacity: 0.7;
  z-index: 0;
  animation: wt-glow 4s ease-in-out infinite alternate;
}
@keyframes wt-glow {
  from { opacity: 0.55; }
  to   { opacity: 0.85; }
}

.wt-hero-text { display: flex; flex-direction: column; gap: 4px; padding-bottom: 2px; }
.wt-hero-title {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 56px;
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 0.95;
  color: var(--text-strong);
  background: linear-gradient(180deg, var(--text-strong) 0%, var(--text-mid) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.wt-hero-title-mark {
  -webkit-text-fill-color: var(--accent);
  color: var(--accent);
}
.wt-hero-tagline {
  margin: 0;
  font-size: 15px;
  color: var(--text-mid);
  letter-spacing: 0.005em;
  font-weight: 400;
}
@media (max-width: 880px) {
  .wt-hero-title { font-size: 44px; }
  .wt-hero-row { gap: 16px; }
}

.wt-hero-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.wt-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  text-transform: uppercase;
}
.wt-meta-led {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 8px rgba(86,211,100,0.7);
}
.wt-meta-sep {
  width: 1px; height: 10px;
  background: var(--overlay-3);
}

/* ── Resume Card (Yesterday Card) ─────────────────────────────── */
.wt-resume {
  margin-top: 8px;
  animation: wt-enter 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
}
.wt-resume-card {
  position: relative;
  background: linear-gradient(180deg, rgba(255,107,53,0.08), rgba(255,107,53,0.02));
  border: 1px solid rgba(255,107,53,0.22);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  outline: none;
}
.wt-resume-card.has-carousel { padding-bottom: 14px; }
.wt-resume-card:focus-visible { box-shadow: 0 0 0 2px rgba(255,107,53,0.35); }
.wt-resume-track {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
  min-height: 80px;
}
.wt-resume-slide {
  grid-column: 1; grid-row: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 0.28s cubic-bezier(0.2,0.7,0.2,1), transform 0.28s cubic-bezier(0.2,0.7,0.2,1);
}
.wt-resume-slide.active {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.wt-resume-nav {
  position: absolute;
  top: 14px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(20,20,26,0.8);
  border: 1px solid var(--overlay-3);
  color: var(--text-mid);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s;
  backdrop-filter: blur(6px);
  z-index: 2;
}
.wt-resume-nav:hover {
  background: rgba(255,107,53,0.18);
  border-color: rgba(255,107,53,0.45);
  color: var(--accent-light);
  transform: scale(1.06);
}
.wt-resume-nav.prev { right: 50px; }
.wt-resume-nav.next { right: 14px; }
.wt-resume-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 2px;
}
.wt-resume-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: none;
  padding: 0;
  background: var(--overlay-4);
  cursor: pointer;
  transition: background 0.15s, transform 0.15s, width 0.2s;
}
.wt-resume-dot:hover { background: var(--overlay-4); }
.wt-resume-dot.active {
  background: var(--accent-light, #ffb38a);
  width: 18px;
  border-radius: 3px;
}
.wt-resume-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.wt-resume-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-light);
}
.wt-resume-time {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-dim);
}
.wt-resume-body {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}
/* Markdown styling inside the resume card — keeps prose readable while
   matching the IDE palette. Tighter than the chat bubble's md-body. */
.wt-resume-body p { margin: 0 0 8px; }
.wt-resume-body p:last-child { margin-bottom: 0; }
.wt-resume-body strong { color: var(--text-strong); font-weight: 600; }
.wt-resume-body em { color: var(--text-strong); font-style: italic; }
.wt-resume-body a { color: var(--info); text-decoration: none; border-bottom: 1px dotted rgba(108,182,255,0.4); }
.wt-resume-body a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.wt-resume-body code:not(pre code) {
  background: var(--overlay-2);
  color: var(--accent-light);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.wt-resume-body pre {
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--overlay-2);
  padding: 8px 10px;
  border-radius: 4px;
  margin: 6px 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.45;
}
.wt-resume-body pre code { background: none; color: var(--text-strong); padding: 0; font-size: inherit; }
.wt-resume-body ul, .wt-resume-body ol { margin: 4px 0 8px; padding-left: 22px; }
.wt-resume-body li { margin: 2px 0; }
.wt-resume-body h1, .wt-resume-body h2, .wt-resume-body h3, .wt-resume-body h4 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  margin: 8px 0 4px;
}
.wt-resume-body blockquote {
  border-left: 2px solid var(--accent);
  padding-left: 10px;
  margin: 6px 0;
  color: var(--text-mid);
}
.wt-resume-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.wt-resume-btn {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  background: var(--accent);
  border: 1px solid var(--accent);
  color: #fff;
}
.wt-resume-btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.wt-resume-btn:disabled,
.wt-resume-btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--overlay-2);
  border-color: var(--overlay-3);
  color: var(--text-mid);
}
.wt-resume-btn:disabled:hover,
.wt-resume-btn[disabled]:hover { background: var(--overlay-2); border-color: var(--overlay-3); }
.wt-resume-btn.ghost {
  background: transparent;
  border-color: var(--overlay-3);
  color: var(--text-mid);
}
.wt-resume-btn.ghost:hover { color: var(--text-strong); border-color: var(--overlay-4); }

/* ── Two-column main ──────────────────────────────────────────── */
.wt-main {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 56px;
}
@media (max-width: 880px) { .wt-main { grid-template-columns: 1fr; gap: 40px; } }
.wt-col { display: flex; flex-direction: column; gap: 36px; min-width: 0; }

/* ── Section heads ───────────────────────────────────────────── */
.wt-section-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.wt-section-num {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--accent-light);
  background: rgba(255,107,53,0.08);
  padding: 3px 7px;
  border-radius: 4px;
  border: 1px solid rgba(255,107,53,0.18);
}
.wt-section-title {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-strong);
  margin: 0;
}
.wt-section-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--overlay-2), transparent);
}

/* ── Action buttons (Start, Help) ─────────────────────────────── */
.wt-actions { display: flex; flex-direction: column; gap: 6px; }
.wt-action {
  position: relative;
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  background: var(--overlay-1);
  border: 1px solid var(--overlay-2);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  transition: border-color 0.22s ease, background 0.22s ease, transform 0.22s ease;
}
.wt-action:hover {
  border-color: var(--overlay-3);
  background: var(--overlay-1);
  transform: translateY(-1px);
}
.wt-action:active { transform: translateY(0); }
.wt-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px; height: 28px;
  border-radius: 7px;
  background: var(--overlay-1);
  color: var(--text-mid);
  transition: color 0.22s ease, background 0.22s ease;
}
.wt-action:hover .wt-action-icon { color: var(--text-strong); background: var(--overlay-2); }
.wt-action-label { color: var(--text); transition: color 0.22s ease; }
.wt-action:hover .wt-action-label { color: var(--text-strong); }
.wt-action-arrow {
  font-family: var(--font-mono);
  color: var(--text-faint);
  font-size: 14px;
  transform: translateX(-4px);
  opacity: 0;
  transition: transform 0.25s ease, opacity 0.25s ease, color 0.25s ease;
}
.wt-action:hover .wt-action-arrow {
  transform: translateX(0);
  opacity: 1;
  color: var(--accent-light);
}
.wt-action-primary {
  background: linear-gradient(180deg, rgba(255,107,53,0.10), rgba(255,107,53,0.04));
  border-color: rgba(255,107,53,0.25);
}
.wt-action-primary .wt-action-icon { color: var(--accent-light); background: rgba(255,107,53,0.12); }
.wt-action-primary:hover {
  border-color: rgba(255,107,53,0.45);
  background: linear-gradient(180deg, rgba(255,107,53,0.16), rgba(255,107,53,0.06));
}
.wt-action-primary .wt-action-label { color: var(--text-strong); }

/* ── Recent files ─────────────────────────────────────────────── */
.wt-recent { display: flex; flex-direction: column; gap: 2px; }
.wt-recent-loading {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  padding: 10px 4px;
  letter-spacing: 0.04em;
}
.wt-recent-row {
  display: flex; align-items: center; gap: 4px;
  border-radius: 8px;
  transition: background 0.18s ease;
}
.wt-recent-row:hover { background: var(--overlay-1); }
.wt-recent-item {
  display: grid;
  grid-template-columns: 14px 1fr;
  column-gap: 10px;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  min-width: 0;
  border-radius: 8px;
}
.wt-recent-item::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
  transition: background 0.18s ease, transform 0.18s ease;
}
.wt-recent-item:hover::before { background: var(--accent); transform: scale(1.4); }
.wt-recent-item-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.wt-recent-name {
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.18s ease;
}
.wt-recent-item:hover .wt-recent-name { color: var(--accent-light); }
.wt-recent-path {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wt-recent-remove {
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  width: 24px; height: 24px;
  border-radius: 6px;
  flex: 0 0 auto;
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  margin-right: 4px;
  transition: opacity 0.18s ease, color 0.18s ease, background 0.18s ease;
}
.wt-recent-row:hover .wt-recent-remove { opacity: 1; }
.wt-recent-remove:hover { color: var(--error); background: rgba(229,83,75,0.1); }
.wt-no-recent {
  font-family: var(--font-mono);
  color: var(--text-faint);
  font-size: 11px;
  padding: 12px 4px;
  letter-spacing: 0.02em;
}

/* ── VS Code-style section header (no number prefix) ───────── */
.wt-section-vscode .wt-vscode-h2 {
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-strong);
  margin: 0 0 12px 0;
  padding: 0;
}

/* ── VS Code-style walkthrough cards ───────────────────────── */
.wt-walkthroughs { display: flex; flex-direction: column; gap: 8px; }

.wt-wk-card {
  position: relative;
  display: grid;
  grid-template-columns: 28px 1fr;
  column-gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 54px;
  padding: 10px 14px 14px 14px;   /* extra bottom padding leaves room for the progress bar */
  background: var(--overlay-1);
  border: 1px solid var(--overlay-2);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  overflow: hidden;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.wt-wk-card:hover {
  background: var(--overlay-2);
  border-color: var(--overlay-2);
}
.wt-wk-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

/* Featured pennant — anchored to the top-left corner (overlaps padding) */
.wt-wk-pennant {
  position: relative;
  width: 28px; height: 28px;
  display: inline-block;
  margin: -10px 0 -10px -14px;
  align-self: stretch;
}
.wt-wk-pennant svg {
  position: absolute;
  top: 0; left: 0;
  width: 36px; height: 36px;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}

/* Plain icon for non-featured cards */
.wt-wk-icon-line {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px; height: 28px;
  color: var(--accent, #4a8cff);
  flex-shrink: 0;
}

.wt-wk-body { min-width: 0; }
.wt-wk-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wt-wk-title {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--text-strong);
  line-height: 1.3;
}
.wt-wk-desc {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.4;
  margin-top: 2px;
}
.wt-wk-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent, #4a8cff);
  color: #fff;
  line-height: 14px;
  letter-spacing: 0.02em;
}
.wt-wk-badge[data-show="updated"][data-visible="0"] { display: none; }

/* Progress bar pinned to the bottom of the card */
.wt-wk-progress {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 3px;
  background: var(--overlay-2);
  overflow: hidden;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
}
.wt-wk-progress-fill {
  height: 100%;
  width: 0%;
  background: var(--accent, #4a8cff);
  transition: width 0.35s ease;
}
.wt-wk-card[data-progress="0"] .wt-wk-progress { display: none; }

/* ── Footer ──────────────────────────────────────────────────── */
.wt-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 28px;
  border-top: 1px solid var(--overlay-2);
}
.wt-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  user-select: none;
}
.wt-checkbox input { position: absolute; opacity: 0; pointer-events: none; }
.wt-checkbox-box {
  width: 14px; height: 14px;
  border-radius: 4px;
  border: 1.5px solid var(--border-hover);
  background: var(--overlay-1);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.18s ease, background 0.18s ease;
}
.wt-checkbox input:checked + .wt-checkbox-box {
  border-color: var(--accent);
  background: var(--accent);
}
.wt-checkbox input:checked + .wt-checkbox-box::after {
  content: '';
  width: 4px; height: 7px;
  border-right: 1.5px solid #fff;
  border-bottom: 1.5px solid #fff;
  transform: rotate(45deg) translate(-0.5px, -0.5px);
}
.wt-checkbox-label { font-size: 12px; color: var(--text-dim); transition: color 0.18s ease; }
.wt-checkbox:hover .wt-checkbox-label { color: var(--text-mid); }
.wt-footer-credit {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* ── Reduced motion ──────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .wt-bg-warm, .wt-bg-cool, .wt-eyebrow-dot, .wt-hero-logo-glow { animation: none !important; }
  .wt-hero, .wt-section, .wt-footer { animation: none !important; opacity: 1; transform: none; }
}

/* Walkthrough pages */
.wt-walkthrough { padding: 40px; max-width: 700px; margin: 0 auto; }
.wt-back {
  background: transparent; border: none; color: var(--text-dim); font-size: 12px;
  cursor: pointer; padding: 4px 0; margin-bottom: 16px; font-family: inherit;
}
.wt-back:hover { color: var(--text); }
.wt-wk-header { margin-bottom: 32px; }
.wt-wk-h1 { font-size: 28px; font-weight: 300; color: var(--text-strong); margin: 0 0 8px; }
.wt-wk-subtitle { font-size: 15px; color: var(--text-dim); margin: 0; line-height: 1.5; }
.wt-steps { display: flex; flex-direction: column; gap: 4px; }
.wt-step {
  display: flex; gap: 12px; padding: 12px 16px;
  border-radius: 6px; transition: background 0.1s;
  border: 1px solid transparent;
}
.wt-step:hover { background: var(--surface-alt); border-color: var(--border); }
.wt-step-check {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; border: 1.5px solid var(--text-dim); color: var(--text-dim);
  margin-top: 2px;
}
.wt-step.done .wt-step-check {
  background: var(--accent); border-color: var(--accent); color: white;
  font-size: 11px; font-weight: 700;
}
.wt-step-content { flex: 1; min-width: 0; }
.wt-step-title { font-size: 13px; font-weight: 500; color: var(--text-strong); margin-bottom: 4px; }
.wt-step-desc { font-size: 12px; color: var(--text-dim); line-height: 1.5; margin-bottom: 8px; }
.wt-step-btn {
  padding: 5px 14px; font-size: 11px; font-weight: 500;
  background: var(--accent); color: white; border: none;
  border-radius: 4px; cursor: pointer;
}
.wt-step-btn:hover { filter: brightness(1.1); }
/* Docs */
.wt-docs-page {
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.wt-docs-hero {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: radial-gradient(circle at top right, rgba(255,107,53,0.16), transparent 48%),
              radial-gradient(circle at 18% 120%, rgba(74,144,229,0.16), transparent 42%),
              linear-gradient(180deg, var(--overlay-1), transparent);
  padding: 24px;
}
.wt-docs-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--overlay-3);
  background: rgba(0,0,0,0.18);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-light);
}
.wt-docs-lead {
  margin: 12px 0 0;
  color: var(--text-mid);
  font-size: 14px;
  line-height: 1.65;
  max-width: 720px;
}
.wt-docs-stats {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 10px;
}
.wt-docs-stat {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: rgba(0,0,0,0.14);
}
.wt-docs-stat-value { font-size: 18px; color: var(--text-strong); font-weight: 700; letter-spacing: -0.02em; }
.wt-docs-stat-label { font-size: 11px; color: var(--text-dim); margin-top: 2px; }

.wt-docs-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wt-docs-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-mid);
  font-size: 11px;
  font-family: var(--font-mono);
}

.wt-docs-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 860px) {
  .wt-docs-grid { grid-template-columns: 1fr; }
  .wt-docs-stats { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
}

.wt-docs-section {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--overlay-1), transparent 30%), var(--surface);
  padding: 14px;
}
.wt-docs-section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.wt-docs-icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-light);
  background: rgba(255,107,53,0.15);
  border: 1px solid rgba(255,107,53,0.2);
  font-size: 13px;
}
.wt-docs-title {
  font-size: 15px;
  color: var(--text-strong);
  margin: 0;
  letter-spacing: -0.01em;
}
.wt-docs-list { list-style: none; padding: 0; margin: 0; }
.wt-docs-list li {
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-mid);
  line-height: 1.6;
  border-bottom: 1px solid var(--overlay-2);
}
.wt-docs-list li:last-child { border-bottom: none; }
.wt-docs-list li strong { color: var(--text-strong); font-weight: 600; }
.wt-docs-list li kbd {
  background: var(--surface-alt);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--accent-light);
}

/* Shortcuts + About (premium pages) */
.wt-shortcuts-page,
.wt-about-page {
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.wt-panel-hero {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: radial-gradient(circle at top right, rgba(255,107,53,0.14), transparent 45%),
              radial-gradient(circle at 0% 100%, rgba(74,144,229,0.14), transparent 40%),
              linear-gradient(180deg, var(--overlay-1), transparent);
  padding: 22px;
}
.wt-panel-kicker {
  display: inline-flex;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--overlay-3);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-light);
}
.wt-panel-lead { margin-top: 10px; color: var(--text-mid); font-size: 14px; line-height: 1.6; max-width: 760px; }

.wt-shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 860px) { .wt-shortcuts-grid { grid-template-columns: 1fr; } }
.wt-shortcuts-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--overlay-1), transparent 30%), var(--surface);
  padding: 12px;
}
.wt-shortcuts-card h2 {
  margin: 0 0 10px;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-mid);
}
.wt-shortcuts-table { display: flex; flex-direction: column; gap: 2px; }
.wt-shortcut-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--overlay-2); }
.wt-shortcut-row:last-child { border-bottom: none; }
.wt-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 122px;
  padding: 4px 8px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-strong);
  flex-shrink: 0;
}
.wt-shortcut-desc { font-size: 12px; color: var(--text-mid); line-height: 1.45; }

.wt-about-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  background: linear-gradient(180deg, var(--overlay-1), transparent 30%), var(--surface);
}
.wt-about-top {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--overlay-2);
}
.wt-about-logo {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  box-shadow: 0 10px 26px rgba(255,107,53,0.22);
}
.wt-about-title { margin: 0; font-size: 22px; font-weight: 650; color: var(--text-strong); letter-spacing: -0.01em; }
.wt-about-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--text-dim); }
.wt-about-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 860px) { .wt-about-grid { grid-template-columns: 1fr; } }
.wt-about-metric {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  background: rgba(0,0,0,0.14);
}
.wt-about-metric-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
.wt-about-metric-value { margin-top: 4px; font-size: 13px; color: var(--text-strong); }
.wt-about-note {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--overlay-2);
  font-size: 11px;
  color: var(--text-dim);
}
    `;
    document.head.appendChild(s);
  }

  function buildDocumentationViewHTML(opts = {}) {
    const showBack = !!opts.withBack;
    return `<div class="wt-walkthrough wt-docs-page" style="max-width:1040px;">
      ${showBack ? '<button class="wt-back" data-action="back">← Back</button>' : ''}

      <section class="wt-docs-hero">
        <div class="wt-docs-kicker">Reference · Documentation</div>
        <h1 class="wt-wk-h1" style="margin-top:12px;">PiPilot IDE Documentation</h1>
        <p class="wt-docs-lead">A complete guide to the editor, AI tooling, terminals, source control, and preview workflow. Built for fast onboarding and daily expert usage.</p>
        <div class="wt-docs-stats">
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">6</div><div class="wt-docs-stat-label">Core Surfaces</div></div>
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">20+</div><div class="wt-docs-stat-label">Power Features</div></div>
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">10+</div><div class="wt-docs-stat-label">Shortcuts</div></div>
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">1</div><div class="wt-docs-stat-label">Unified Workflow</div></div>
        </div>
      </section>

      <div class="wt-docs-quick">
        <span class="wt-docs-chip">⌨ Ctrl+P Quick Open</span>
        <span class="wt-docs-chip">🤖 Ctrl+I AI Chat</span>
        <span class="wt-docs-chip">🧪 Problems + AI Fix</span>
        <span class="wt-docs-chip">🌐 Built-in Preview</span>
        <span class="wt-docs-chip">🧭 Source Control</span>
      </div>

      <div class="wt-docs-grid">
        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">📝</span><h2 class="wt-docs-title">Editor</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Tabs</strong> — Open multiple files, drag to reorder, middle-click to close, right-click for context actions.</li>
            <li><strong>Breadcrumbs</strong> — Navigate parent folders and symbols with fewer clicks.</li>
            <li><strong>Split Preview</strong> — For HTML/MD/SVG, open code and rendered output side by side.</li>
            <li><strong>Word Wrap + Minimap</strong> — Comfortable long-file reading with structure awareness.</li>
            <li><strong>Auto Save</strong> — Save after edits with minimal friction from File settings.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">✨</span><h2 class="wt-docs-title">AI Features</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Chat Panel</strong> — Open from titlebar and drive code changes end to end.</li>
            <li><strong>Inline Completions</strong> — Accept ghost text with <kbd>Tab</kbd>, dismiss with <kbd>Esc</kbd>.</li>
            <li><strong>Inline Chat</strong> — Select code + <kbd>Ctrl+I</kbd> for local refactors and explanations.</li>
            <li><strong>Selection Actions</strong> — Add to chat, inline transform, or enhance selected code instantly.</li>
            <li><strong>Diagnostics Hover</strong> — Use quick fix and AI fix directly on squiggles.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">🛠</span><h2 class="wt-docs-title">AI Capabilities</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Code Analysis</strong> — Detects errors and provides fixes for TypeScript, JSON, and other languages.</li>
            <li><strong>Project Awareness</strong> — Understands frameworks, dependencies, and project structure for better assistance.</li>
            <li><strong>Smart Search</strong> — Searches code, files, symbols, and uses semantic understanding across the codebase.</li>
            <li><strong>Visual Verification</strong> — Captures screenshots and analyzes DOM for UI debugging and improvements.</li>
            <li><strong>Design Guidance</strong> — Provides design-token aware suggestions for UI planning and enhancements.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">📦</span><h2 class="wt-docs-title">Panels</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Explorer</strong> — Lazy-loaded tree with batch actions and context operations.</li>
            <li><strong>Search</strong> — Project-wide search with regex and replace support.</li>
            <li><strong>Source Control</strong> — Stage, commit, pull, push, branch, stash, merge, reset.</li>
            <li><strong>Outline</strong> — Symbol-level navigation for active file structure.</li>
            <li><strong>Wiki + Extensions + Checkpoints</strong> — Docs generation, MCP, and safe snapshots.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">🌐</span><h2 class="wt-docs-title">Preview</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Dev Server Detection</strong> — Auto-detects npm scripts and opens preview fast.</li>
            <li><strong>Static Preview</strong> — Works for plain HTML projects with zero config.</li>
            <li><strong>Responsive Modes</strong> — Desktop, tablet, and mobile viewpoints.</li>
            <li><strong>Runtime Console</strong> — Consolidated browser and server console signals.</li>
            <li><strong>URL Bar</strong> — Inspect local or external endpoints from the same pane.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">▸</span><h2 class="wt-docs-title">Terminal</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Multiple Sessions</strong> — Run parallel tasks and separate logs by terminal.</li>
            <li><strong>Shell Profiles</strong> — PowerShell, cmd, Git Bash, and custom shells.</li>
            <li><strong>Localhost Detection</strong> — Instant Open in Preview when servers boot.</li>
            <li><strong>Clipboard Flow</strong> — Full copy/paste command workflow support.</li>
            <li><strong>IDE Integration</strong> — Terminal, problems, and preview aligned in one loop.</li>
          </ul>
        </section>
      </div>
    </div>`;
  }

  // ── Documentation Tab ──
  function openDocsTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: '__docs__',
      name: 'Documentation',
      icon: '📖',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildDocumentationViewHTML({ withBack: false });
      },
    });
  }

  // ── Keyboard Shortcuts Tab ──
  function openShortcutsTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    const shortcuts = [
      ['General', [
        ['Ctrl+S', 'Save file'], ['Ctrl+Shift+S', 'Save all files'], ['Ctrl+W', 'Close tab'],
        ['Ctrl+P', 'Quick open file'], ['Ctrl+Shift+P', 'Command palette'],
        ['Ctrl+B', 'Toggle sidebar'], ['Ctrl+`', 'Toggle terminal'], ['Ctrl+I', 'Toggle chat / Inline chat'],
      ]],
      ['Editor', [
        ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'], ['Ctrl+D', 'Select word'],
        ['Ctrl+/', 'Toggle line comment'], ['Ctrl+Shift+V', 'Toggle dual preview'],
        ['Tab', 'Accept inline completion'], ['Esc', 'Dismiss completion / Close inline chat'],
        ['Ctrl+.', 'Quick Fix'], ['Alt+F8', 'Next problem'],
      ]],
      ['Navigation', [
        ['Ctrl+G', 'Go to line'], ['Ctrl+Shift+O', 'Go to symbol'],
        ['Ctrl+Click', 'Go to definition'], ['Alt+Left', 'Navigate back'], ['Alt+Right', 'Navigate forward'],
      ]],
      ['File Explorer', [
        ['Ctrl+A', 'Select all files (when explorer focused)'], ['Delete', 'Delete selected files'],
        ['Escape', 'Clear selection'],
      ]],
    ];
    editor.openVirtualTab({
      id: '__shortcuts__',
      name: 'Keyboard Shortcuts',
      icon: '⌨',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = `<div class="wt-walkthrough wt-shortcuts-page" style="max-width:980px;">
          <section class="wt-panel-hero">
            <div class="wt-panel-kicker">Reference · Shortcuts</div>
            <h1 class="wt-wk-h1" style="margin-top:10px;">Keyboard Shortcuts</h1>
            <p class="wt-panel-lead">Speed up your workflow with key combinations for navigation, editing, terminal control, and AI actions.</p>
          </section>

          <div class="wt-shortcuts-grid">
            ${shortcuts.map(([group, keys]) => `
              <section class="wt-shortcuts-card">
                <h2>${group}</h2>
                <div class="wt-shortcuts-table">
                  ${keys.map(([key, desc]) => `
                    <div class="wt-shortcut-row">
                      <kbd class="wt-kbd">${key}</kbd>
                      <span class="wt-shortcut-desc">${desc}</span>
                    </div>
                  `).join('')}
                </div>
              </section>
            `).join('')}
          </div>
        </div>`;
      },
    });
  }

  // ── About Tab ──
  function openAboutTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: '__about__',
      name: 'About',
      icon: 'ℹ',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = `<div class="wt-walkthrough wt-about-page" style="max-width:980px;">
          <section class="wt-panel-hero">
            <div class="wt-panel-kicker">Product · About</div>
            <h1 class="wt-wk-h1" style="margin-top:10px;">About PiPilot IDE</h1>
            <p class="wt-panel-lead">PiPilot is an AI-native coding environment designed to keep editing, execution, diagnostics, and AI-assisted iteration in one continuous flow.</p>
          </section>

          <section class="wt-about-card">
            <div class="wt-about-top">
              <img src="public/icon.png" width="52" height="52" class="wt-about-logo" />
              <div>
                <h2 class="wt-about-title">PiPilot IDE</h2>
                <p class="wt-about-subtitle">AI-native development environment</p>
              </div>
            </div>

            <div class="wt-about-grid">
              <div class="wt-about-metric">
                <div class="wt-about-metric-label">Version</div>
                <div class="wt-about-metric-value">1.0.0</div>
              </div>
              <div class="wt-about-metric">
                <div class="wt-about-metric-label">Build</div>
                <div class="wt-about-metric-value">Production</div>
              </div>
              <div class="wt-about-metric">
                <div class="wt-about-metric-label">Edition</div>
                <div class="wt-about-metric-value">Native Desktop</div>
              </div>
            </div>

            <div class="wt-about-note">&copy; ${new Date().getFullYear()} PiPilot. All rights reserved.</div>
          </section>
        </div>`;
      },
    });
  }
  function handleCloseProject() {
    // Close all editor tabs
    const editor = window.PiPilot?.editor;
    if (editor) {
      try { editor.closeAllFiles?.(); } catch {}
    }
    // Open the Welcome tab as the landing state
    setTimeout(openWelcomeTab, 100);
  }

  // ── Init ──
  function init() {
    injectStyles();

    // Open welcome tab on startup if setting is enabled
    const showWelcome = localStorage.getItem('pipilot-show-welcome');
    if (showWelcome !== 'false') {
      bus.on('project:opened', () => {
        setTimeout(openWelcomeTab, 300);
      });
    }

    // Whenever a project opens (or switches), refresh the Resume Card
    // even if the welcome tab is already mounted. Without this, the tab
    // mounted while no project was loaded keeps the card hidden forever
    // because openVirtualTab is no-op on existing tabs (no re-mount).
    bus.on('project:opened', () => {
      // Try a few times — the welcome tab may be opened ~300ms after
      // project:opened fires (above), so the container might not exist
      // yet at the first attempt.
      let attempts = 0;
      const tick = () => {
        const c = findWelcomeContainer();
        if (c) loadResumeCardInto(c);
        if (++attempts < 6 && !c) setTimeout(tick, 200);
      };
      tick();
      // And once more after the welcome tab definitely exists.
      setTimeout(() => {
        const c = findWelcomeContainer();
        if (c) loadResumeCardInto(c);
      }, 600);
    });
    bus.on('project:closed', () => {
      const c = findWelcomeContainer();
      if (c) loadResumeCardInto(c); // will hide the host since projectPath is now null
    });

    // Handle Help menu items
    bus.on('menu:help:welcome', openWelcomeTab);
    bus.on('menu:help:getting-started', openGettingStartedTab);
    bus.on('menu:help:docs', openDocsTab);
    bus.on('menu:help:shortcuts', openShortcutsTab);
    bus.on('menu:help:about', openAboutTab);

    // Handle close project — show welcome tab instead of going to welcome screen
    bus.on('menu:file:close-folder', handleCloseProject);

    // Expose for other modules
    window.PiPilot.welcomeTab = {
      open: openWelcomeTab,
      openGettingStarted: openGettingStartedTab,
      openAIPower: openAIPowerTab,
      openDocs: openDocsTab,
      buildDocumentationHTML: buildDocumentationViewHTML,
      openShortcuts: openShortcutsTab,
      openAbout: openAboutTab,
      setWalkthroughProgress,
      markWalkthroughSeen,
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
