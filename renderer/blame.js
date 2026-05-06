// PiPilot IDE — Inline Git Blame ("who shipped this line")
//
// Zed-style: as you move the cursor through a tracked file, a small dim pill
// appears at the END of the active line — `Anye, 3 days ago · feat: cli args
// ▸ a1b2c3d`. Click anywhere on the pill to open that commit in a real editor
// tab. Hover the SHA to see a GitHub-style commit card (subject, body, +/-,
// author, date, "Open on GitHub" link if origin points to github.com).
//
// Public API:
//   bus.emit('blame:toggle')    — flip on/off (status-bar bell-style toggle)
//   bus.on('git:show-commit', { hash }) — also fired by anything else that
//     wants to open a commit detail tab (e.g. SC panel history rows).

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot?.bus;
  const state = window.PiPilot?.state;
  if (!bus || !api?.git) return;

  const MAX_LINES = 5000;
  const HOVER_DELAY = 250;
  const ENABLED_KEY = 'pipilot.blame.enabled';

  let enabled = true;
  try { const v = localStorage.getItem(ENABLED_KEY); if (v === '0') enabled = false; } catch {}

  // Per-file blame map. Cleared on git:changed (re-fetched lazily).
  const blameByPath = new Map();      // absPath → Array<{line, sha, author, summary, timestamp}> (sparse, indexed by line)
  const inFlight = new Set();         // absPath
  const remoteCache = new Map();      // projectPath → { url, github }
  const commitInfoCache = new Map();  // sha → commit-info payload
  let pillEl = null;
  let lastLine = -1;
  let lastPath = null;
  let cursorListener = null;
  let scrollListener = null;
  let attachedAce = null;

  // ---------- Styles ----------
  function ensureStyles() {
    if (document.getElementById('blame-styles')) return;
    const st = document.createElement('style');
    st.id = 'blame-styles';
    st.textContent = `
      .blame-pill {
        position: absolute;
        z-index: 5;
        font-family: var(--font-sans);
        font-size: 11px;
        color: var(--text-dim, #888);
        background: transparent;
        padding: 0 6px;
        border-radius: 3px;
        white-space: nowrap;
        pointer-events: auto;
        cursor: pointer;
        opacity: 0.55;
        transition: opacity 0.15s, background 0.15s;
        user-select: none;
        max-width: 70%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .blame-pill:hover { opacity: 1; background: var(--surface-alt, #2a2a2a); }
      .blame-pill .blame-sep { margin: 0 6px; opacity: 0.5; }
      .blame-pill .blame-sha {
        color: var(--accent, #4a8cff);
        font-family: var(--font-mono);
        cursor: pointer;
        padding: 0 2px;
        border-radius: 2px;
      }
      .blame-pill .blame-sha:hover { background: rgba(108,140,255,0.18); }
      .blame-pill.uncommitted { color: var(--warn, #e5a639); font-style: italic; cursor: default; }
      .blame-pill.uncommitted:hover { background: transparent; }

      /* GitHub-style commit hover card */
      .commit-card {
        position: fixed;
        z-index: 9999;
        width: 380px;
        max-width: calc(100vw - 16px);
        background: var(--surface-raised, #1e1e1e);
        border: 1px solid var(--border, #303030);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        font-family: var(--font-sans);
        color: var(--text-strong, #e8e8e8);
        overflow: hidden;
        animation: cc-in 0.12s ease-out;
      }
      @keyframes cc-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      .cc-head {
        display: flex;
        gap: 8px;
        padding: 12px 14px 6px;
        align-items: flex-start;
      }
      .cc-icon {
        width: 16px; height: 16px;
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--text-dim, #888);
      }
      .cc-subject {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
        color: var(--text-strong, #e8e8e8);
        word-wrap: break-word;
      }
      .cc-body {
        padding: 0 14px 8px 38px;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text, #ccc);
        line-height: 1.5;
        white-space: pre-wrap;
        word-wrap: break-word;
        max-height: 200px;
        overflow-y: auto;
      }
      .cc-stats {
        padding: 4px 14px 8px 38px;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-family: var(--font-mono);
      }
      .cc-stat-add  { color: #56d364; font-weight: 700; }
      .cc-stat-del  { color: #e5534b; font-weight: 700; }
      .cc-stat-bar  { display: inline-flex; gap: 1px; margin-left: 4px; }
      .cc-stat-sq   { width: 8px; height: 8px; border-radius: 1px; background: var(--surface-alt, #2a2a2a); }
      .cc-stat-sq.add { background: #238636; }
      .cc-stat-sq.del { background: #da3633; }
      .cc-foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-top: 1px solid var(--border, #303030);
        font-size: 11px;
        color: var(--text-dim, #888);
      }
      .cc-avatar {
        width: 20px; height: 20px;
        border-radius: 999px;
        background: var(--accent, #4a8cff);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        flex-shrink: 0;
        background-size: cover;
        background-position: center;
      }
      .cc-foot-text { flex: 1; min-width: 0; }
      .cc-foot-text b { color: var(--text-strong, #e8e8e8); font-weight: 600; }
      .cc-foot-link {
        flex-shrink: 0;
        color: var(--accent, #4a8cff);
        text-decoration: none;
        background: transparent;
        border: 1px solid var(--border, #303030);
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .cc-foot-link:hover { background: var(--surface-alt, #2a2a2a); }
      .cc-loading {
        padding: 16px;
        text-align: center;
        color: var(--text-dim, #888);
        font-size: 12px;
      }
    `;
    document.head.appendChild(st);
  }

  // ---------- Time formatting ----------
  function relTime(ts) {
    if (!ts) return '';
    const ms = Date.now() - ts * 1000;
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 30) return d + ' days ago';
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + ' months ago';
    const y = Math.floor(mo / 12);
    return y + (y === 1 ? ' year ago' : ' years ago');
  }
  function relTimeISO(iso) {
    if (!iso) return '';
    const ts = Math.floor(new Date(iso).getTime() / 1000);
    return relTime(ts);
  }
  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0] || '').join('').toUpperCase() || '?';
  }
  function avatarColor(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `hsl(${hue}, 55%, 45%)`;
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ---------- Blame fetch ----------
  async function fetchBlame(projectPath, absFile) {
    if (inFlight.has(absFile)) return null;
    inFlight.add(absFile);
    try {
      const rel = relPath(projectPath, absFile);
      if (!rel) return null;
      const r = await api.git.blame(projectPath, rel);
      if (!r || r.ok === false) return null;
      // Build sparse array indexed by line number
      const arr = [];
      for (const e of (r.blame || [])) {
        if (e.line > 0) arr[e.line] = e;
      }
      blameByPath.set(absFile, arr);
      return arr;
    } catch { return null; }
    finally { inFlight.delete(absFile); }
  }

  function relPath(projectPath, absFile) {
    if (!projectPath || !absFile) return '';
    const p = String(projectPath).replace(/\\/g, '/').replace(/\/+$/, '');
    const a = String(absFile).replace(/\\/g, '/');
    if (a.indexOf(p + '/') === 0) return a.slice(p.length + 1);
    return '';
  }

  // ---------- Pill rendering ----------
  function removePill() {
    if (pillEl) { pillEl.remove(); pillEl = null; }
    lastLine = -1;
  }

  function renderPill(ace, lineIndex, entry) {
    ensureStyles();
    const renderer = ace.renderer;
    const host = renderer.container;
    if (!host) return;
    if (!pillEl) {
      pillEl = document.createElement('div');
      pillEl.className = 'blame-pill';
      host.appendChild(pillEl);
    }

    const isUncommitted = entry.sha && /^0+$/.test(entry.sha);
    pillEl.classList.toggle('uncommitted', !!isUncommitted);

    if (isUncommitted) {
      pillEl.innerHTML = '· You · uncommitted';
      pillEl.onclick = null;
    } else {
      const author = entry.author || 'Unknown';
      const when = relTime(entry.timestamp);
      const summary = entry.summary || '';
      const sha = entry.sha.slice(0, 7);
      pillEl.innerHTML =
        `· ${escapeHtml(author)}, ${escapeHtml(when)}` +
        `<span class="blame-sep">·</span>${escapeHtml(summary)}` +
        `<span class="blame-sep">▸</span><span class="blame-sha" data-sha="${entry.sha}">${sha}</span>`;
      pillEl.onclick = (e) => {
        // If user clicked the SHA specifically, don't double-fire
        if (e.target.classList.contains('blame-sha')) return;
        bus.emit('git:show-commit', { hash: entry.sha });
      };
      const shaEl = pillEl.querySelector('.blame-sha');
      if (shaEl) {
        shaEl.addEventListener('click', (e) => {
          e.stopPropagation();
          bus.emit('git:show-commit', { hash: entry.sha });
        });
        wireHoverCard(shaEl, entry.sha);
      }
    }

    // Position at end-of-line, anchored to Ace's text layer
    positionPill(ace, lineIndex);
  }

  function positionPill(ace, lineIndex) {
    if (!pillEl) return;
    const renderer = ace.renderer;
    const session = ace.session;
    if (!session) return;
    const lineText = session.getLine(lineIndex) || '';
    const col = lineText.length;
    // Coordinates are relative to the editor host element
    const coords = renderer.textToScreenCoordinates(lineIndex, col);
    const hostRect = renderer.container.getBoundingClientRect();
    const x = coords.pageX - hostRect.left + 16;
    const y = coords.pageY - hostRect.top;
    // If line is offscreen vertically, hide
    if (y < 0 || y > hostRect.height) {
      pillEl.style.display = 'none';
      return;
    }
    pillEl.style.display = '';
    pillEl.style.left = x + 'px';
    pillEl.style.top = y + 'px';
  }

  // ---------- Cursor / scroll wiring ----------
  function attach() {
    const ace = window.PiPilot?.editor?.getAce?.();
    if (!ace || ace === attachedAce) return;
    detach();
    attachedAce = ace;
    cursorListener = () => updateForCursor();
    scrollListener = () => { if (pillEl) positionPill(ace, lastLine); };
    ace.on('changeSelection', cursorListener);
    ace.session?.on('changeScrollTop', scrollListener);
  }
  function detach() {
    if (attachedAce) {
      try { attachedAce.off('changeSelection', cursorListener); } catch {}
      try { attachedAce.session?.off('changeScrollTop', scrollListener); } catch {}
    }
    attachedAce = null;
    cursorListener = null;
    scrollListener = null;
  }

  async function updateForCursor() {
    if (!enabled) { removePill(); return; }
    const ace = window.PiPilot?.editor?.getAce?.();
    const activePath = window.PiPilot?.editor?.getActiveFile?.();
    if (!ace || !activePath || !state?.projectPath) { removePill(); return; }
    if (window.PiPilot.editor.isVirtualTab?.(activePath)) { removePill(); return; }
    const session = ace.session;
    if (!session) { removePill(); return; }
    const lineCount = session.getLength?.() || 0;
    if (lineCount > MAX_LINES) { removePill(); return; }

    const pos = ace.getCursorPosition();
    const lineIndex = pos.row;
    if (activePath !== lastPath) {
      lastPath = activePath;
      removePill();
    }
    if (lineIndex === lastLine && pillEl && pillEl.dataset.path === activePath) {
      // Just reposition (cursor moved horizontally on same line)
      positionPill(ace, lineIndex);
      return;
    }

    // Make sure we have blame for this file
    let arr = blameByPath.get(activePath);
    if (!arr) {
      arr = await fetchBlame(state.projectPath, activePath);
      if (!arr) { removePill(); return; }
      // After fetch, cursor might have moved — recompute with current
      const pos2 = ace.getCursorPosition();
      lastLine = pos2.row;
    } else {
      lastLine = lineIndex;
    }

    const entry = arr[lastLine + 1]; // blame is 1-indexed
    if (!entry) { removePill(); return; }
    renderPill(ace, lastLine, entry);
    if (pillEl) pillEl.dataset.path = activePath;
  }

  // ---------- GitHub-style commit hover card ----------
  let hoverCard = null;
  let hoverTimer = null;
  let hoverDismissTimer = null;
  function clearHoverTimers() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (hoverDismissTimer) { clearTimeout(hoverDismissTimer); hoverDismissTimer = null; }
  }
  function dismissCard() {
    clearHoverTimers();
    if (hoverCard) { hoverCard.remove(); hoverCard = null; }
  }
  function wireHoverCard(el, sha) {
    el.addEventListener('mouseenter', () => {
      clearHoverTimers();
      hoverTimer = setTimeout(() => showCard(el, sha), HOVER_DELAY);
    });
    el.addEventListener('mouseleave', () => {
      clearHoverTimers();
      hoverDismissTimer = setTimeout(dismissCard, 200);
    });
  }
  async function showCard(anchor, sha) {
    dismissCard();
    if (!state?.projectPath) return;
    ensureStyles();
    hoverCard = document.createElement('div');
    hoverCard.className = 'commit-card';
    hoverCard.innerHTML = `<div class="cc-loading">Loading commit ${sha.slice(0, 7)}…</div>`;
    document.body.appendChild(hoverCard);
    positionCard(anchor);
    hoverCard.addEventListener('mouseenter', clearHoverTimers);
    hoverCard.addEventListener('mouseleave', () => {
      hoverDismissTimer = setTimeout(dismissCard, 200);
    });

    // Fetch commit info (cache-first) + remote info in parallel
    const [info, remote] = await Promise.all([
      commitInfoCache.has(sha) ? commitInfoCache.get(sha) : (async () => {
        const r = await api.git.commitInfo(state.projectPath, sha);
        if (r?.ok) commitInfoCache.set(sha, r.commit);
        return r?.commit || null;
      })(),
      remoteCache.has(state.projectPath) ? remoteCache.get(state.projectPath) : (async () => {
        const r = await api.git.remoteInfo(state.projectPath);
        const v = r?.ok ? { url: r.url, github: r.github } : null;
        if (v) remoteCache.set(state.projectPath, v);
        return v;
      })(),
    ]);
    if (!hoverCard) return;
    if (!info) {
      hoverCard.innerHTML = `<div class="cc-loading">Could not load commit ${escapeHtml(sha.slice(0, 7))}.</div>`;
      return;
    }
    renderCardBody(info, remote);
    positionCard(anchor);
  }
  function positionCard(anchor) {
    if (!hoverCard) return;
    const r = anchor.getBoundingClientRect();
    const cardRect = hoverCard.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    if (top + cardRect.height > window.innerHeight - 8) top = r.top - cardRect.height - 6;
    if (left + cardRect.width > window.innerWidth - 8) left = window.innerWidth - cardRect.width - 8;
    if (left < 8) left = 8;
    hoverCard.style.top = top + 'px';
    hoverCard.style.left = left + 'px';
  }
  function renderCardBody(commit, remote) {
    if (!hoverCard) return;
    const stats = renderStatsBar(commit.additions, commit.deletions);
    const ghLink = remote?.github
      ? `<button class="cc-foot-link" data-href="https://github.com/${escapeHtml(remote.github.owner)}/${escapeHtml(remote.github.repo)}/commit/${escapeHtml(commit.hash)}">Open on GitHub ↗</button>`
      : '';
    const av = `<span class="cc-avatar" style="background:${avatarColor(commit.email || commit.author)};">${escapeHtml(initials(commit.author))}</span>`;
    const when = relTimeISO(commit.date);
    hoverCard.innerHTML = `
      <div class="cc-head">
        <svg class="cc-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v3.5M8 11.5V15" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
        <div class="cc-subject">${escapeHtml(commit.subject)}</div>
      </div>
      ${commit.body ? `<div class="cc-body">${escapeHtml(commit.body)}</div>` : ''}
      ${(commit.additions || commit.deletions) ? `<div class="cc-stats">${stats}</div>` : ''}
      <div class="cc-foot">
        ${av}
        <div class="cc-foot-text"><b>${escapeHtml(commit.author)}</b> committed ${escapeHtml(when)}</div>
        ${ghLink}
      </div>
    `;
    const link = hoverCard.querySelector('[data-href]');
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const href = link.dataset.href;
        if (api.shell?.openExternal) api.shell.openExternal(href);
        else window.open(href, '_blank');
      });
    }
  }
  function renderStatsBar(add, del) {
    const total = (add || 0) + (del || 0);
    const N = 5;
    let addCells = 0;
    if (total > 0) addCells = Math.round((add / total) * N);
    if (add > 0 && addCells === 0) addCells = 1;
    if (del > 0 && addCells === N) addCells = N - 1;
    const delCells = N - addCells;
    let bar = '<span class="cc-stat-bar">';
    for (let i = 0; i < addCells; i++) bar += '<span class="cc-stat-sq add"></span>';
    for (let i = 0; i < delCells; i++) bar += '<span class="cc-stat-sq del"></span>';
    bar += '</span>';
    return `<span class="cc-stat-add">+${add || 0}</span><span class="cc-stat-del">−${del || 0}</span>${bar}`;
  }

  // ---------- Commit detail tab ----------
  // ---------- Unified-diff parser ----------
  // Parses `git show`'s patch text into per-file blocks suitable for the
  // GitHub-style accordion view. Handles: rename headers, binary files,
  // mode changes, multi-hunk files. Doesn't try to interpret rare formats
  // (combined diffs from merge commits, etc.) — falls back to raw text.
  function parseUnifiedDiff(diffText) {
    const files = [];
    if (!diffText) return files;
    const lines = diffText.split('\n');
    let i = 0;
    let cur = null;
    function pushCur() { if (cur) files.push(cur); }
    while (i < lines.length) {
      const ln = lines[i];
      if (ln.startsWith('diff --git ')) {
        pushCur();
        // diff --git a/foo b/bar
        const m = ln.match(/^diff --git a\/(.+) b\/(.+)$/);
        const oldPath = m ? m[1] : '';
        const newPath = m ? m[2] : '';
        cur = {
          oldPath,
          newPath,
          path: newPath || oldPath,
          isRename: oldPath && newPath && oldPath !== newPath,
          isBinary: false,
          isNew: false,
          isDeleted: false,
          mode: null,
          hunks: [],
          additions: 0,
          deletions: 0,
        };
        i++;
        continue;
      }
      if (!cur) { i++; continue; }
      if (ln.startsWith('new file mode ')) { cur.isNew = true; cur.mode = ln.slice(14); i++; continue; }
      if (ln.startsWith('deleted file mode ')) { cur.isDeleted = true; cur.mode = ln.slice(18); i++; continue; }
      if (ln.startsWith('Binary files ') || ln.startsWith('GIT binary patch')) { cur.isBinary = true; i++; continue; }
      if (ln.startsWith('index ') || ln.startsWith('similarity ') || ln.startsWith('rename ') || ln.startsWith('--- ') || ln.startsWith('+++ ')) { i++; continue; }
      if (ln.startsWith('@@')) {
        const m = ln.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
        const hunk = {
          oldStart: m ? parseInt(m[1], 10) : 0,
          oldCount: m ? parseInt(m[2] || '1', 10) : 0,
          newStart: m ? parseInt(m[3], 10) : 0,
          newCount: m ? parseInt(m[4] || '1', 10) : 0,
          context: m ? (m[5] || '').trim() : '',
          lines: [],
        };
        let oldNo = hunk.oldStart;
        let newNo = hunk.newStart;
        i++;
        while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@')) {
          const raw = lines[i];
          if (raw.startsWith('\\ No newline')) { i++; continue; }
          const c = raw[0];
          if (c === '+') {
            hunk.lines.push({ type: 'add', oldNo: null, newNo, text: raw.slice(1) });
            newNo++;
            cur.additions++;
          } else if (c === '-') {
            hunk.lines.push({ type: 'del', oldNo, newNo: null, text: raw.slice(1) });
            oldNo++;
            cur.deletions++;
          } else {
            // context (or empty trailing line at file end)
            hunk.lines.push({ type: 'ctx', oldNo, newNo, text: raw.length ? raw.slice(1) : '' });
            oldNo++;
            newNo++;
          }
          i++;
        }
        cur.hunks.push(hunk);
        continue;
      }
      i++;
    }
    pushCur();
    return files;
  }

  // Mini stat squares (5-square bar like GitHub)
  function fileStatBar(add, del) {
    const total = (add || 0) + (del || 0);
    const N = 5;
    let addCells = 0;
    if (total > 0) addCells = Math.round((add / total) * N);
    if (add > 0 && addCells === 0) addCells = 1;
    if (del > 0 && addCells === N) addCells = N - 1;
    const delCells = N - addCells;
    let bar = '<span class="diff-stat-bar">';
    for (let i = 0; i < addCells; i++) bar += '<span class="diff-stat-sq add"></span>';
    for (let i = 0; i < delCells; i++) bar += '<span class="diff-stat-sq del"></span>';
    bar += '</span>';
    return bar;
  }

  // Files we never auto-render: their diffs are huge and almost never useful.
  const GENERATED_FILES = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|Pipfile\.lock|go\.sum|bun\.lockb|deno\.lock)$/i;
  const LARGE_THRESHOLD = 500;    // changed lines
  const HUGE_THRESHOLD  = 5000;   // changed lines — show extra warning
  const CHUNK_SIZE      = 800;    // rows per render-frame for huge files

  function buildBodyHtml(file) {
    let html = '';
    for (const hunk of file.hunks) {
      html += `<div class="diff-hunk-head"><span class="diff-hunk-meta">@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@</span>${hunk.context ? `<span class="diff-hunk-ctx">${escapeHtml(hunk.context)}</span>` : ''}</div>`;
      for (const line of hunk.lines) {
        const cls = line.type === 'add' ? 'diff-row add' : line.type === 'del' ? 'diff-row del' : 'diff-row';
        const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        html += `<div class="${cls}">`
          + `<span class="diff-no diff-no-old">${line.oldNo ?? ''}</span>`
          + `<span class="diff-no diff-no-new">${line.newNo ?? ''}</span>`
          + `<span class="diff-marker">${marker}</span>`
          + `<span class="diff-line">${escapeHtml(line.text)}</span>`
          + `</div>`;
      }
    }
    return html;
  }

  // Stream a huge file's hunks into the DOM in chunks via rAF so the UI
  // doesn't freeze. Returns immediately; chunks fill in over the next few
  // animation frames.
  function streamBodyHtml(body, file) {
    const totalLines = file.hunks.reduce((n, h) => n + h.lines.length + 1, 0);
    if (totalLines <= CHUNK_SIZE) { body.innerHTML = buildBodyHtml(file); return; }
    body.innerHTML = '<div class="diff-binary-msg">Rendering 0 / ' + totalLines + '…</div>';
    const progressEl = body.querySelector('.diff-binary-msg');
    // Flatten to a row-stream for steady chunking
    const rows = [];
    for (const hunk of file.hunks) {
      rows.push({ kind: 'hunk', hunk });
      for (const line of hunk.lines) rows.push({ kind: 'line', line });
    }
    let i = 0;
    const buffer = [];
    function tick() {
      const end = Math.min(i + CHUNK_SIZE, rows.length);
      for (; i < end; i++) {
        const r = rows[i];
        if (r.kind === 'hunk') {
          const h = r.hunk;
          buffer.push(`<div class="diff-hunk-head"><span class="diff-hunk-meta">@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@</span>${h.context ? `<span class="diff-hunk-ctx">${escapeHtml(h.context)}</span>` : ''}</div>`);
        } else {
          const ln = r.line;
          const cls = ln.type === 'add' ? 'diff-row add' : ln.type === 'del' ? 'diff-row del' : 'diff-row';
          const marker = ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : ' ';
          buffer.push(`<div class="${cls}"><span class="diff-no diff-no-old">${ln.oldNo ?? ''}</span><span class="diff-no diff-no-new">${ln.newNo ?? ''}</span><span class="diff-marker">${marker}</span><span class="diff-line">${escapeHtml(ln.text)}</span></div>`);
        }
      }
      if (i < rows.length) {
        if (progressEl) progressEl.textContent = `Rendering ${i} / ${rows.length}…`;
        requestAnimationFrame(tick);
      } else {
        body.innerHTML = buffer.join('');
      }
    }
    requestAnimationFrame(tick);
  }

  function renderFileAccordion(file, options) {
    const opts = options || {};
    const article = document.createElement('div');
    article.className = 'diff-file';
    const totalChanged = file.additions + file.deletions;
    const isGenerated = GENERATED_FILES.test(file.path);
    const isLarge = totalChanged > LARGE_THRESHOLD;
    const isHuge  = totalChanged > HUGE_THRESHOLD;
    // Auto-expand only small, non-generated, eligible files
    const autoExpand = opts.expanded && !isLarge && !isGenerated && !file.isBinary;

    const summary = file.isNew ? 'new file' : file.isDeleted ? 'deleted' : file.isRename ? `renamed from ${file.oldPath}` : '';
    const statsTxt = file.isBinary
      ? '<span class="diff-binary">Binary</span>'
      : `<span class="diff-add-num">+${file.additions}</span><span class="diff-del-num">−${file.deletions}</span>${fileStatBar(file.additions, file.deletions)}`;
    article.classList.toggle('collapsed', !autoExpand);

    // Header
    const head = document.createElement('div');
    head.className = 'diff-file-head';
    head.innerHTML = `
      <button class="diff-chevron" title="Toggle">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 4l3 3 3-3z"/></svg>
      </button>
      <span class="diff-file-path" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
      ${summary ? `<span class="diff-file-tag">${escapeHtml(summary)}</span>` : ''}
      <span class="diff-file-stats">${statsTxt}</span>
      <button class="diff-file-open" title="View file at this commit">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/><path d="M9 2l4 4M9 2v4h4"/></svg>
      </button>
    `;

    // Body — built lazily on first expand
    const body = document.createElement('div');
    body.className = 'diff-file-body';
    let bodyRendered = false;
    function renderBody() {
      if (bodyRendered) return;
      bodyRendered = true;
      if (file.isBinary) { body.innerHTML = '<div class="diff-binary-msg">Binary file not shown.</div>'; return; }
      if (!file.hunks.length) { body.innerHTML = '<div class="diff-binary-msg">No textual changes.</div>'; return; }
      streamBodyHtml(body, file);
    }
    function showLoadStub() {
      const reasonMsg = isGenerated
        ? 'Some generated files are not rendered by default.'
        : isHuge
          ? `Large diff (${totalChanged.toLocaleString()} lines). Loading may take a moment.`
          : `${totalChanged.toLocaleString()} changed lines. Click to render.`;
      body.innerHTML = `
        <div class="diff-load-stub">
          <div class="diff-load-skeleton">
            <div class="sk sk-1"></div><div class="sk sk-2"></div>
            <div class="sk sk-3"></div><div class="sk sk-4"></div>
            <div class="sk sk-5"></div>
          </div>
          <button class="diff-load-btn">Load Diff</button>
          <div class="diff-load-msg">${escapeHtml(reasonMsg)}</div>
        </div>`;
      body.querySelector('.diff-load-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        article.classList.remove('collapsed');
        renderBody();
      });
    }

    if (autoExpand) {
      renderBody();
    } else if (isLarge || isGenerated) {
      // Body has a Load Diff stub even when collapsed, so when user expands
      // they don't get a wall of automatic rendering — they opt in.
      showLoadStub();
    }
    article.appendChild(head);
    article.appendChild(body);

    head.addEventListener('click', (e) => {
      if (e.target.closest('.diff-file-copy')) return;
      const willExpand = article.classList.contains('collapsed');
      article.classList.toggle('collapsed');
      if (willExpand) {
        // Expanding: small files render now; large/generated stay on stub
        // until user clicks Load Diff (intentional).
        if (!isLarge && !isGenerated) renderBody();
        else if (!body.children.length) showLoadStub();
      }
    });
    head.querySelector('.diff-file-open')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (file.isDeleted) { bus.emit('toast:show', { message: 'File was deleted in this commit', type: 'warn' }); return; }
      // Binary files: media types (image/video/audio/pdf) get a real preview;
      // anything else binary will fall through to a "cannot preview" message
      // inside the tab itself.
      if (typeof opts.onOpenAtCommit === 'function') opts.onOpenAtCommit(file);
    });

    // Public hook for "Expand all" toolbar button — force-render
    article._forceLoad = () => {
      article.classList.remove('collapsed');
      renderBody();
    };
    return article;
  }

  function ensureDiffStyles() {
    if (document.getElementById('diff-tab-styles')) return;
    const st = document.createElement('style');
    st.id = 'diff-tab-styles';
    st.textContent = `
      .diff-file {
        border: 1px solid var(--border, #303030);
        border-radius: 6px;
        background: var(--surface-raised, #1e1e1e);
        margin-bottom: 14px;
        overflow: hidden;
      }
      .diff-file.collapsed .diff-file-body { display: none; }
      .diff-file.collapsed .diff-chevron svg { transform: rotate(-90deg); }
      .diff-file-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--surface, #1a1a22);
        border-bottom: 1px solid var(--border, #303030);
        cursor: pointer;
        user-select: none;
      }
      .diff-file.collapsed .diff-file-head { border-bottom: none; }
      .diff-chevron {
        background: transparent; border: none; padding: 0;
        color: var(--text-dim, #888);
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px;
        cursor: pointer;
      }
      .diff-chevron svg { transition: transform 0.12s ease; }
      .diff-file-path {
        flex: 1; min-width: 0;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-strong, #e8e8e8);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .diff-file-tag {
        font-size: 10px;
        color: var(--text-dim, #888);
        padding: 1px 6px;
        border: 1px solid var(--border, #303030);
        border-radius: 999px;
        flex-shrink: 0;
      }
      .diff-file-stats {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 11px;
      }
      .diff-add-num { color: #56d364; font-weight: 700; }
      .diff-del-num { color: #e5534b; font-weight: 700; }
      .diff-stat-bar { display: inline-flex; gap: 1px; margin-left: 2px; }
      .diff-stat-sq { width: 8px; height: 8px; border-radius: 1px; background: var(--surface-alt, #2a2a2a); }
      .diff-stat-sq.add { background: #238636; }
      .diff-stat-sq.del { background: #da3633; }
      .diff-binary { color: var(--text-dim); font-size: 11px; }
      .diff-file-open {
        background: transparent;
        border: none;
        color: var(--text-dim, #888);
        cursor: pointer;
        padding: 3px 6px;
        border-radius: 3px;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .diff-file-open:hover { color: var(--accent, #4a8cff); background: var(--surface-alt, #2a2a2a); }

      .diff-file-body {
        background: var(--bg, #16161a);
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.5;
        overflow-x: auto;
      }
      .diff-binary-msg { padding: 14px; color: var(--text-dim); font-size: 12px; text-align: center; }
      .diff-hunk-head {
        background: rgba(108,140,255,0.08);
        color: #6c8cff;
        padding: 4px 10px;
        font-size: 11px;
        border-top: 1px solid var(--border, #303030);
        border-bottom: 1px solid var(--border, #303030);
        white-space: nowrap;
      }
      .diff-hunk-meta { font-family: var(--font-mono); }
      .diff-hunk-ctx { color: var(--text-dim); margin-left: 12px; }
      .diff-row {
        display: flex;
        white-space: pre;
        min-height: 20px;
      }
      .diff-row.add { background: rgba(46,160,67,0.15); }
      .diff-row.add .diff-no, .diff-row.add .diff-marker { background: rgba(46,160,67,0.30); color: #aff5b4; }
      .diff-row.del { background: rgba(248,81,73,0.15); }
      .diff-row.del .diff-no, .diff-row.del .diff-marker { background: rgba(248,81,73,0.30); color: #ffd7d5; }
      .diff-no {
        flex-shrink: 0;
        width: 48px;
        padding: 0 8px;
        text-align: right;
        color: var(--text-dim, #6e7681);
        background: var(--surface-alt, #232329);
        font-variant-numeric: tabular-nums;
        user-select: none;
        border-right: 1px solid var(--border, #303030);
      }
      .diff-marker {
        flex-shrink: 0;
        width: 18px;
        text-align: center;
        color: var(--text-dim, #6e7681);
        background: var(--surface-alt, #232329);
        user-select: none;
        border-right: 1px solid var(--border, #303030);
      }
      .diff-line {
        flex: 1;
        padding: 0 12px;
        color: var(--text);
        white-space: pre;
      }
      .diff-toolbar {
        display: flex; align-items: center; gap: 10px;
        margin: 4px 0 14px;
        font-size: 12px; color: var(--text-dim);
      }
      .diff-toolbar button {
        background: var(--surface-alt, #232329);
        color: var(--text);
        border: 1px solid var(--border, #303030);
        border-radius: 4px;
        padding: 3px 10px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .diff-toolbar button:hover { border-color: var(--accent); }

      /* Load Diff stub for large / generated files */
      .diff-load-stub {
        padding: 22px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        background: var(--bg);
      }
      .diff-load-skeleton {
        width: 100%;
        max-width: 520px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .diff-load-skeleton .sk {
        height: 10px;
        border-radius: 3px;
        background: linear-gradient(90deg, var(--surface-alt) 0%, var(--surface-raised) 50%, var(--surface-alt) 100%);
        background-size: 200% 100%;
        animation: sk-shimmer 1.4s infinite ease-in-out;
        opacity: 0.55;
      }
      .diff-load-skeleton .sk-1 { width: 38%; }
      .diff-load-skeleton .sk-2 { width: 62%; }
      .diff-load-skeleton .sk-3 { width: 48%; }
      .diff-load-skeleton .sk-4 { width: 70%; }
      .diff-load-skeleton .sk-5 { width: 30%; }
      @keyframes sk-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .diff-load-btn {
        background: var(--accent, #4a8cff);
        color: #fff;
        border: none;
        padding: 6px 18px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      .diff-load-btn:hover { filter: brightness(1.1); }
      .diff-load-msg {
        font-size: 11px;
        color: var(--text-dim);
        text-align: center;
        max-width: 420px;
        line-height: 1.5;
      }
    `;
    document.head.appendChild(st);
  }

  function openCommitTab(hash) {
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab || !state?.projectPath) return;
    const projectPath = state.projectPath;
    const id = `git-commit://${projectPath}/${hash}`;
    editor.openVirtualTab({
      id,
      name: `Commit ${hash.slice(0, 7)}`,
      mount: async (container) => {
        ensureStyles();
        ensureDiffStyles();
        container.innerHTML = `<div class="cc-loading" style="padding:32px;text-align:center;">Loading commit ${escapeHtml(hash.slice(0,7))}…</div>`;
        container.style.cssText = 'overflow:auto;padding:16px 24px;font-family:var(--font-sans);color:var(--text);background:var(--bg);';
        const [showRes, infoRes, remoteRes] = await Promise.all([
          api.git.show(projectPath, hash),
          api.git.commitInfo(projectPath, hash),
          api.git.remoteInfo(projectPath),
        ]);
        if (!showRes?.ok || !infoRes?.ok) {
          container.innerHTML = `<div class="cc-loading">Failed to load commit. ${escapeHtml(showRes?.error || infoRes?.error || '')}</div>`;
          return;
        }
        const c = infoRes.commit;
        const remote = remoteRes?.ok ? remoteRes.github : null;
        const stats = renderStatsBar(c.additions, c.deletions);
        const av = `<span class="cc-avatar" style="background:${avatarColor(c.email || c.author)};width:32px;height:32px;font-size:13px;">${escapeHtml(initials(c.author))}</span>`;
        const ghBtn = remote
          ? `<button class="cc-foot-link" data-gh="https://github.com/${escapeHtml(remote.owner)}/${escapeHtml(remote.repo)}/commit/${escapeHtml(c.hash)}">Open on GitHub ↗</button>`
          : '';
        container.innerHTML = `
          <div style="margin-bottom:14px;display:flex;align-items:flex-start;gap:14px;">
            ${av}
            <div style="flex:1;min-width:0;">
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--text-strong);line-height:1.35;word-wrap:break-word;">${escapeHtml(c.subject)}</div>
              <div style="margin-top:6px;font-size:12px;color:var(--text-dim);"><b style="color:var(--text);">${escapeHtml(c.author)}</b> · ${escapeHtml(c.email)} · ${escapeHtml(relTimeISO(c.date))} · <span style="font-family:var(--font-mono);">${escapeHtml(c.shortHash)}</span></div>
            </div>
            ${ghBtn}
          </div>
          ${c.body ? `<pre style="font-family:var(--font-mono);font-size:12px;color:var(--text);background:var(--surface-alt);border:1px solid var(--border);border-radius:4px;padding:10px 12px;white-space:pre-wrap;word-wrap:break-word;margin:0 0 14px;">${escapeHtml(c.body)}</pre>` : ''}
          <div style="margin-bottom:10px;font-family:var(--font-mono);font-size:12px;">${stats} · ${c.filesChanged} ${c.filesChanged === 1 ? 'file' : 'files'} changed</div>
          <div class="diff-toolbar">
            <button id="diff-expand">Expand all</button>
            <button id="diff-collapse">Collapse all</button>
          </div>
          <div id="diff-files"></div>
        `;
        const link = container.querySelector('[data-gh]');
        if (link) {
          link.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const href = link.dataset.gh;
            if (api.shell?.openExternal) api.shell.openExternal(href);
            else window.open(href, '_blank');
          });
        }

        const files = parseUnifiedDiff(showRes.diff || '');
        const filesEl = container.querySelector('#diff-files');
        const onOpenAtCommit = (file) => openFileAtCommit(projectPath, hash, file.path);
        // Auto-expand small files (<200 lines of changes); collapse the rest
        for (const f of files) {
          const expanded = ((f.additions + f.deletions) <= 200 && files.length <= 8);
          filesEl.appendChild(renderFileAccordion(f, { expanded, onOpenAtCommit }));
        }
        if (!files.length) {
          filesEl.innerHTML = `<div class="diff-binary-msg">No diff produced for this commit (likely a merge).</div>`;
        }
        container.querySelector('#diff-expand')?.addEventListener('click', () => {
          filesEl.querySelectorAll('.diff-file').forEach(el => {
            if (typeof el._forceLoad === 'function') el._forceLoad();
            else el.classList.remove('collapsed');
          });
        });
        container.querySelector('#diff-collapse')?.addEventListener('click', () => {
          filesEl.querySelectorAll('.diff-file').forEach(el => el.classList.add('collapsed'));
        });
      },
    });
  }

  // ---------- Open file at a specific commit ----------
  // Mounts a real read-only Ace editor inside a virtual tab so syntax
  // highlighting, search, line numbers, etc. all work exactly like a normal
  // file — but the content is whatever was at that revision.
  const ACE_MODES = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    jsx: 'javascript', ts: 'typescript', tsx: 'tsx',
    json: 'json', jsonc: 'json',
    py: 'python', rb: 'ruby', go: 'golang', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c_cpp', cpp: 'c_cpp', cc: 'c_cpp', h: 'c_cpp', hpp: 'c_cpp',
    cs: 'csharp', php: 'php',
    html: 'html', htm: 'html', xml: 'xml',
    css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    md: 'markdown', mdx: 'markdown',
    yml: 'yaml', yaml: 'yaml', toml: 'toml',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    sql: 'sql',
    vue: 'html', svelte: 'html',
    dockerfile: 'dockerfile', makefile: 'makefile',
  };
  function detectMode(filePath) {
    const name = (filePath || '').split(/[\\/]/).pop().toLowerCase();
    if (name === 'dockerfile') return 'dockerfile';
    if (name === 'makefile') return 'makefile';
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return ACE_MODES[ext] || 'text';
  }

  // Media-type detection for the per-commit file viewer
  const IMAGE_EXTS = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', avif:'image/avif', bmp:'image/bmp', ico:'image/x-icon', svg:'image/svg+xml' };
  const VIDEO_EXTS = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', mkv:'video/x-matroska', m4v:'video/mp4', ogv:'video/ogg' };
  const AUDIO_EXTS = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', m4a:'audio/mp4', aac:'audio/aac', opus:'audio/opus' };
  const PDF_EXTS   = { pdf:'application/pdf' };
  function fileExt(p) {
    const name = (p || '').split(/[\\/]/).pop().toLowerCase();
    return name.includes('.') ? name.split('.').pop() : '';
  }
  function mediaKind(p) {
    const ext = fileExt(p);
    if (IMAGE_EXTS[ext]) return { kind: 'image', mime: IMAGE_EXTS[ext] };
    if (VIDEO_EXTS[ext]) return { kind: 'video', mime: VIDEO_EXTS[ext] };
    if (AUDIO_EXTS[ext]) return { kind: 'audio', mime: AUDIO_EXTS[ext] };
    if (PDF_EXTS[ext])   return { kind: 'pdf',   mime: PDF_EXTS[ext]   };
    return null;
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function openFileAtCommit(projectPath, hash, filePath) {
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return;
    const ace = window.ace;
    const shortHash = hash.slice(0, 7);
    const fileName = filePath.split(/[\\/]/).pop();
    const id = `git-file://${projectPath}/${hash}/${filePath}`;
    const media = mediaKind(filePath);

    editor.openVirtualTab({
      id,
      name: `${fileName} @ ${shortHash}`,
      mount: async (container) => {
        container.style.cssText = 'display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text);';
        container.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--surface);border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:11px;color:var(--text-dim);flex-shrink:0;">
            <span style="color:var(--text-strong);font-weight:600;">${escapeHtml(filePath)}</span>
            <span style="color:var(--text-dim);">@</span>
            <span style="color:var(--accent);">${escapeHtml(shortHash)}</span>
            <span id="size-badge" style="color:var(--text-dim);"></span>
            <span style="margin-left:auto;color:var(--text-dim);">read-only · file at commit</span>
            <button id="open-current-btn" style="background:var(--surface-alt);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer;font-family:inherit;">Open current version</button>
            <button id="show-commit-btn" style="background:var(--surface-alt);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer;font-family:inherit;">View commit</button>
          </div>
          <div id="content-host" style="flex:1;min-height:0;display:flex;align-items:stretch;justify-content:stretch;overflow:auto;background:var(--bg);">
            <div id="loading" style="margin:auto;padding:24px;color:var(--text-dim);font-size:12px;">Loading ${escapeHtml(fileName)} at ${escapeHtml(shortHash)}…</div>
          </div>
        `;
        const host = container.querySelector('#content-host');
        const sizeBadge = container.querySelector('#size-badge');
        container.querySelector('#open-current-btn')?.addEventListener('click', () => {
          bus.emit('file:open', { path: projectPath + '/' + filePath });
        });
        container.querySelector('#show-commit-btn')?.addEventListener('click', () => {
          bus.emit('git:show-commit', { hash });
        });

        // ── Media path: image / video / audio / pdf ─────────────────────
        // SVG: render as image (it IS an image) — fetch as text via the
        //      regular showFile path and inline as svg+xml data URL so the
        //      browser renders it as scalable graphic.
        if (media) {
          if (media.kind === 'image' && fileExt(filePath) === 'svg') {
            const r = await api.git.showFile(projectPath, hash, filePath);
            if (!r || r.ok === false) { host.innerHTML = `<div style="margin:auto;color:var(--text-dim);">Failed to load.</div>`; return; }
            const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(r.content || '')));
            renderImage(host, dataUrl, fileName);
            sizeBadge.textContent = '· ' + fmtBytes((r.content || '').length);
            return;
          }
          const r = await api.git.showFileBinary(projectPath, hash, filePath);
          if (!r || r.ok === false) { host.innerHTML = `<div style="margin:auto;color:var(--text-dim);">Failed to load: ${escapeHtml(r?.error || 'unknown')}</div>`; return; }
          if (r.tooLarge) {
            host.innerHTML = `<div style="margin:auto;text-align:center;color:var(--text-dim);font-size:12px;max-width:400px;line-height:1.6;">
              <div style="font-size:14px;color:var(--text);margin-bottom:6px;">File too large to preview</div>
              ${fmtBytes(r.size)} exceeds the ${fmtBytes(r.maxBytes)} preview cap.<br>
              Open the current version on disk to view.
            </div>`;
            sizeBadge.textContent = '· ' + fmtBytes(r.size);
            return;
          }
          const dataUrl = `data:${media.mime};base64,${r.base64}`;
          sizeBadge.textContent = '· ' + fmtBytes(r.size);
          if (media.kind === 'image') renderImage(host, dataUrl, fileName);
          else if (media.kind === 'video') renderVideo(host, dataUrl, media.mime);
          else if (media.kind === 'audio') renderAudio(host, dataUrl, media.mime, fileName);
          else if (media.kind === 'pdf') renderPdf(host, dataUrl);
          return;
        }

        // ── Text path: real Ace editor ─────────────────────────────────
        if (!ace) { host.innerHTML = `<div style="margin:auto;color:var(--text-dim);">Editor not ready.</div>`; return; }
        const r = await api.git.showFile(projectPath, hash, filePath);
        if (!r || r.ok === false) {
          host.innerHTML = `<div style="margin:auto;color:var(--text-dim);">Failed to load: ${escapeHtml(r?.error || 'unknown')}</div>`;
          return;
        }
        // Detect unknown binary content (NUL byte in first 8KB → it's binary)
        if (r.content && r.content.charCodeAt(0) === 0 || (r.content && r.content.slice(0, 8192).indexOf(String.fromCharCode(0)) !== -1)) {
          host.innerHTML = `<div style="margin:auto;text-align:center;color:var(--text-dim);font-size:12px;max-width:400px;line-height:1.6;">
            <div style="font-size:14px;color:var(--text);margin-bottom:6px;">Binary file</div>
            ${escapeHtml(fileName)} contains binary data and cannot be previewed.
          </div>`;
          sizeBadge.textContent = '· ' + fmtBytes((r.content || '').length);
          return;
        }
        sizeBadge.textContent = '· ' + fmtBytes((r.content || '').length);
        host.innerHTML = '';
        const aceHost = document.createElement('div');
        aceHost.style.cssText = 'flex:1;min-height:0;width:100%;';
        host.appendChild(aceHost);
        try {
          // Honour the user's --font-mono pick; falls back to the
          // hard-coded stack only if the CSS var is somehow empty.
          const fontFamily = (() => {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
            return v || '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace';
          })();
          const editorInst = ace.edit(aceHost, {
            theme: 'ace/theme/midnight',
            mode: 'ace/mode/' + detectMode(filePath),
            readOnly: true,
            showPrintMargin: false,
            highlightActiveLine: false,
            fontSize: 13,
            fontFamily,
            showGutter: true,
            scrollPastEnd: 0,
            useWrapMode: false,
            value: r.content,
          });
          editorInst.setValue(r.content || '', -1);
          editorInst.clearSelection();
          editorInst.renderer.setScrollMargin(8, 8, 0, 0);
          setTimeout(() => editorInst.resize(), 30);
        } catch {
          aceHost.innerHTML = `<pre style="padding:12px;font-family:var(--font-mono);font-size:12px;color:var(--text);white-space:pre;overflow:auto;margin:0;">${escapeHtml(r.content)}</pre>`;
        }
      },
    });
  }

  function renderImage(host, dataUrl, name) {
    host.innerHTML = '';
    host.style.background = `repeating-conic-gradient(#1a1a1f 0% 25%, #232329 0% 50%) 50% / 16px 16px`;
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = name;
    img.style.cssText = 'max-width:100%;max-height:100%;margin:auto;display:block;object-fit:contain;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
    host.appendChild(img);
  }
  function renderVideo(host, dataUrl, mime) {
    host.innerHTML = '';
    host.style.background = '#000';
    const v = document.createElement('video');
    v.src = dataUrl;
    v.controls = true;
    v.style.cssText = 'max-width:100%;max-height:100%;margin:auto;display:block;';
    if (mime) v.setAttribute('type', mime);
    host.appendChild(v);
  }
  function renderAudio(host, dataUrl, mime, name) {
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:auto;display:flex;flex-direction:column;align-items:center;gap:14px;padding:32px;';
    const label = document.createElement('div');
    label.style.cssText = 'color:var(--text-dim);font-size:13px;font-family:var(--font-mono);';
    label.textContent = name;
    const a = document.createElement('audio');
    a.src = dataUrl;
    a.controls = true;
    a.style.cssText = 'min-width:320px;';
    if (mime) a.setAttribute('type', mime);
    wrap.appendChild(label);
    wrap.appendChild(a);
    host.appendChild(wrap);
  }
  function renderPdf(host, dataUrl) {
    host.innerHTML = '';
    const f = document.createElement('iframe');
    f.src = dataUrl;
    f.style.cssText = 'flex:1;min-height:0;width:100%;border:none;';
    host.appendChild(f);
  }

  // ---------- Toggle ----------
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch {}
    if (!enabled) removePill();
    else updateForCursor();
    bus.emit('blame:state', { enabled });
  }

  // ---------- Wire ----------
  bus.on('editor:active-changed', () => {
    removePill();
    lastPath = null;
    setTimeout(attach, 50);
    setTimeout(updateForCursor, 100);
  });
  bus.on('file:saved', ({ path } = {}) => {
    if (path) blameByPath.delete(path);
    setTimeout(updateForCursor, 200);
  });
  bus.on('git:changed', () => {
    blameByPath.clear();
    commitInfoCache.clear();
    remoteCache.clear();
    setTimeout(updateForCursor, 200);
  });
  bus.on('project:closed', () => {
    blameByPath.clear();
    commitInfoCache.clear();
    remoteCache.clear();
    removePill();
    detach();
    lastPath = null;
  });
  bus.on('git:show-commit', ({ hash } = {}) => { if (hash) openCommitTab(hash); });
  bus.on('blame:toggle', () => setEnabled(!enabled));

  // Boot
  setTimeout(() => { attach(); updateForCursor(); }, 800);

  window.PiPilot.blame = {
    isEnabled: () => enabled,
    setEnabled,
    refresh: () => { blameByPath.clear(); updateForCursor(); },
    openCommit: (hash) => openCommitTab(hash),
  };
})();
