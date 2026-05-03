(() => {
  const { bus } = window.PiPilot;

  let lastSummary = null;

  function setBranch(name) {
    const el = $('#status-branch');
    if (!el) return;
    el.textContent = `⎇ ${name || '—'}`;
  }

  function renderSummary(s) {
    const el = $('#status-branch');
    if (!el) return;
    lastSummary = s;
    if (!s || !s.hasRepo) {
      el.textContent = `⎇ ${s?.branch || '—'}`;
      el.title = 'No git repository';
      return;
    }
    const dirty = s.dirty > 0 ? '*' : '';
    const ahead = s.ahead > 0 ? ` ↑${s.ahead}` : '';
    const behind = s.behind > 0 ? ` ↓${s.behind}` : '';
    const branch = s.branch || '—';
    el.textContent = `⎇ ${branch}${dirty}${behind}${ahead}`;
    const parts = [`Branch: ${branch}`];
    if (s.tracking) parts.push(`Tracking: ${s.tracking}`);
    if (s.dirty) parts.push(`${s.dirty} changed`);
    if (s.ahead) parts.push(`${s.ahead} ahead`);
    if (s.behind) parts.push(`${s.behind} behind`);
    el.title = parts.join(' · ');
  }

  function setProblems(count) {
    const el = $('#status-problems');
    if (!el) return;
    if (typeof count === 'object') {
      const e = count.errors || 0;
      const w = count.warnings || 0;
      el.innerHTML = `<span style="color:${e ? 'var(--error)' : 'var(--text-dim)'}">✕ ${e}</span> <span style="color:${w ? 'var(--warn)' : 'var(--text-dim)'}">⚠ ${w}</span>`;
      el.classList.toggle('ok', e === 0 && w === 0);
      el.classList.toggle('warn', e > 0 || w > 0);
    } else {
      const n = Number(count) || 0;
      el.textContent = `⚠ ${n}`;
      el.classList.toggle('ok', n === 0);
      el.classList.toggle('warn', n > 0);
    }
  }

  function setPosition(pos) {
    const el = $('#status-position');
    if (!el) return;
    const { line = 1, col = 1 } = pos || {};
    el.textContent = `Ln ${line}, Col ${col}`;
  }

  function setLanguage(lang) {
    const el = $('#status-language');
    if (!el) return;
    const text = (typeof lang === 'object') ? (lang.language || 'Plain Text') : (lang || 'Plain Text');
    el.textContent = text;
  }

  function init() {
    setBranch('main');
    setProblems(0);
    setPosition({ line: 1, col: 1 });
    setLanguage('Plain Text');

    bus.on('git:branch-changed', (name) => setBranch(name));
    bus.on('git:summary:updated', (s) => renderSummary(s));
    // If decorations service is already loaded with a summary, paint it.
    try {
      const s = window.PiPilot?.gitDecorations?.summary?.();
      if (s) renderSummary(s);
    } catch {}
    bus.on('problems:count', (count) => setProblems(count));
    bus.on('editor:position', (pos) => setPosition(pos));
    bus.on('editor:language', (lang) => setLanguage(lang));

    // Problems button — opens the bottom panel on the Problems tab
    $('#status-problems')?.addEventListener('click', () => {
      const main = $('#main-area');
      if (!main) return;
      main.style.gridTemplateRows = '';
      main.classList.remove('bottom-collapsed');
      const tab = $('.bottom-tab[data-bottom="problems"]');
      tab?.click();
    });

    // Terminal button — opens the bottom panel on the Terminal tab
    $('#status-terminal')?.addEventListener('click', () => {
      const main = $('#main-area');
      if (!main) return;
      main.style.gridTemplateRows = '';
      main.classList.remove('bottom-collapsed');
      const tab = $('.bottom-tab[data-bottom="terminal"]');
      tab?.click();
      bus.emit('terminal:focus');
    });

    const blameBtn = $('#status-blame');
    if (blameBtn) {
      const paint = () => {
        const on = window.PiPilot?.blame?.isEnabled?.() !== false;
        blameBtn.style.opacity = on ? '1' : '0.45';
        blameBtn.title = on ? 'Inline git blame: ON (click to disable)' : 'Inline git blame: OFF (click to enable)';
      };
      paint();
      blameBtn.addEventListener('click', () => bus.emit('blame:toggle'));
      bus.on('blame:state', paint);
    }

    $('#status-branch')?.addEventListener('click', () => {
      const btns = $$('#activity-bar .activity-btn[data-panel]');
      btns.forEach(b => b.classList.toggle('active', b.dataset.panel === 'git'));
      bus.emit('panel:switch', 'git');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
