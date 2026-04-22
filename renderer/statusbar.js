(() => {
  const { bus } = window.PiPilot;

  function setBranch(name) {
    const el = $('#status-branch');
    if (!el) return;
    el.textContent = `⎇ ${name || '—'}`;
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
