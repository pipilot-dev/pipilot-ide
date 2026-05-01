// PiPilot IDE — Help / docs virtual editor tab.
// Sidebar TOC + content pane that renders the markdown in /docs.
// All pages fetched relative to index.html (Electron resolves them
// from the app dir over file://). Cached after first load.

(() => {
  const bus = window.PiPilot?.bus;
  if (!bus) return;

  const TAB_ID = 'pipilot-help://main';

  // Page registry — order = sidebar order. Each entry maps a slug
  // (matches docs/<slug>.md) to display metadata. Keep in sync with
  // the files under docs/.
  const PAGES = [
    { slug: 'README',                title: 'Overview',           group: 'Start' },
    { slug: 'getting-started',       title: 'Getting Started',    group: 'Start' },
    { slug: 'keyboard-shortcuts',    title: 'Keyboard Shortcuts', group: 'Start' },

    { slug: 'ai-agent',              title: 'AI Agent',           group: 'Core' },
    { slug: 'editor',                title: 'Code Editor',        group: 'Core' },
    { slug: 'themes',                title: 'Themes',             group: 'Core' },
    { slug: 'fonts',                 title: 'Fonts',              group: 'Core' },

    { slug: 'source-control',        title: 'Source Control',     group: 'Workflow' },
    { slug: 'debugging',             title: 'Debugging',          group: 'Workflow' },
    { slug: 'deploy-hub',            title: 'Deploy Hub',         group: 'Workflow' },
    { slug: 'embedded-browser',      title: 'Embedded Browser',   group: 'Workflow' },
    { slug: 'terminal',              title: 'Terminal',           group: 'Workflow' },
    { slug: 'wiki',                  title: 'Wiki',               group: 'Workflow' },

    { slug: 'extensions',            title: 'Extensions',         group: 'Extending' },
    { slug: 'extension-api',         title: 'Extension API',      group: 'Extending' },
    { slug: 'settings-reference',    title: 'Settings Reference', group: 'Reference' },
  ];

  // ── Lazy-load `marked` from CDN (mirrors the loader in chat.js) ───
  let markedReady = false;
  let markedLoading = null;
  function ensureMarked() {
    if (markedReady || window.marked) { markedReady = true; return Promise.resolve(); }
    if (markedLoading) return markedLoading;
    markedLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
      s.onload = () => {
        if (window.marked && window.marked.setOptions) {
          window.marked.setOptions({ breaks: true, gfm: true });
        }
        markedReady = true;
        resolve();
      };
      s.onerror = () => { markedReady = false; resolve(); };
      document.head.appendChild(s);
    });
    return markedLoading;
  }

  function injectStyles() {
    if (document.getElementById('help-tab-styles')) return;
    const st = document.createElement('style');
    st.id = 'help-tab-styles';
    st.textContent = `
      .ht-root { width:100%; height:100%; display:flex; background:var(--bg); color:var(--text); font-family:var(--font-sans); overflow:hidden; }
      .ht-side {
        flex:0 0 240px; min-width:0; border-right:1px solid var(--border);
        display:flex; flex-direction:column; background:var(--surface);
      }
      .ht-side-h {
        padding:14px 16px 8px; font-size:13px; font-weight:600;
        color:var(--text-strong); letter-spacing:-0.01em;
        display:flex; align-items:center; gap:8px;
      }
      .ht-search {
        margin:0 12px 8px;
        background:var(--bg); border:1px solid var(--border); color:var(--text);
        padding:5px 10px; border-radius:5px; font:inherit; font-size:12px; outline:none;
      }
      .ht-search:focus { border-color:var(--accent); }
      .ht-nav { flex:1; overflow:auto; padding:4px 0 12px; }
      .ht-group {
        font-size:10px; color:var(--text-dim); text-transform:uppercase;
        letter-spacing:0.06em; font-weight:600; padding:10px 16px 4px;
      }
      .ht-link {
        all:unset; cursor:pointer; display:block; padding:5px 16px;
        font-size:12.5px; color:var(--text-mid); transition:background 100ms, color 100ms;
        border-left:2px solid transparent;
      }
      .ht-link:hover { background:var(--surface-alt); color:var(--text); }
      .ht-link.active {
        color:var(--text-strong); background:var(--surface-alt);
        border-left-color:var(--accent); font-weight:500;
      }

      .ht-main {
        flex:1; min-width:0; overflow:auto;
        padding:32px 48px 80px;
      }
      .ht-content { max-width:760px; margin:0 auto; }
      .ht-content h1 { font-size:28px; color:var(--text-strong); margin:0 0 8px; letter-spacing:-0.015em; font-weight:700; }
      .ht-content h2 { font-size:20px; color:var(--text-strong); margin:32px 0 10px; padding-top:8px; letter-spacing:-0.005em; font-weight:600; border-top:1px solid var(--border); padding-top:24px; }
      .ht-content h2:first-of-type { border-top:0; padding-top:0; margin-top:24px; }
      .ht-content h3 { font-size:15px; color:var(--text-strong); margin:22px 0 6px; font-weight:600; }
      .ht-content p { font-size:13.5px; line-height:1.65; margin:10px 0; color:var(--text); }
      .ht-content a { color:var(--accent); text-decoration:none; border-bottom:1px dotted color-mix(in srgb, var(--accent) 50%, transparent); }
      .ht-content a:hover { color:var(--accent-hover); border-bottom-style:solid; }
      .ht-content ul, .ht-content ol { margin:10px 0; padding-left:24px; }
      .ht-content li { font-size:13.5px; line-height:1.65; margin:4px 0; }
      .ht-content strong { color:var(--text-strong); font-weight:600; }
      .ht-content em { color:var(--text); font-style:italic; }
      .ht-content code:not(pre code) {
        font-family:var(--font-mono); font-size:12px; padding:1px 6px;
        background:var(--surface-alt); color:var(--accent-light);
        border-radius:3px; border:1px solid var(--border);
      }
      .ht-content pre {
        background:var(--surface); border:1px solid var(--border); border-radius:6px;
        padding:12px 14px; overflow:auto; margin:14px 0;
        font-family:var(--font-mono); font-size:12px; line-height:1.55;
      }
      .ht-content pre code { color:var(--text); font-family:inherit; }
      .ht-content blockquote {
        border-left:3px solid var(--accent); padding:4px 14px;
        margin:14px 0; background:var(--accent-dim); color:var(--text);
        border-radius:0 4px 4px 0; font-size:13px;
      }
      .ht-content blockquote p { margin:6px 0; }
      .ht-content table {
        border-collapse:collapse; margin:14px 0; font-size:12.5px;
        width:100%;
      }
      .ht-content th, .ht-content td {
        border:1px solid var(--border); padding:6px 10px; text-align:left;
      }
      .ht-content th { background:var(--surface-alt); color:var(--text-strong); font-weight:600; }
      .ht-content hr { border:0; border-top:1px solid var(--border); margin:32px 0; }
      .ht-content img { max-width:100%; border-radius:6px; }
      .ht-empty { color:var(--text-dim); font-size:13px; padding:40px 0; text-align:center; }
    `;
    document.head.appendChild(st);
  }

  // ── State ─────────────────────────────────────────────────────────
  const state = {
    active: 'README',
    cache: new Map(),       // slug → rendered html
    raw:   new Map(),       // slug → raw md (for search)
    query: '',
  };

  async function loadPage(slug) {
    if (state.raw.has(slug)) return state.raw.get(slug);
    try {
      const res = await fetch('docs/' + encodeURIComponent(slug) + '.md');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      state.raw.set(slug, text);
      return text;
    } catch (err) {
      const msg = `# Page not found\n\nCouldn't load \`docs/${slug}.md\`.\n\n> ${err.message}`;
      state.raw.set(slug, msg);
      return msg;
    }
  }

  async function renderPage(slug) {
    if (state.cache.has(slug)) return state.cache.get(slug);
    const md = await loadPage(slug);
    await ensureMarked();
    const html = window.marked ? window.marked.parse(md) : `<pre>${escapeHtml(md)}</pre>`;
    state.cache.set(slug, html);
    return html;
  }

  function matchesQuery(page, raw) {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    if (page.title.toLowerCase().includes(q)) return true;
    if (page.slug.toLowerCase().includes(q)) return true;
    if (raw && raw.toLowerCase().includes(q)) return true;
    return false;
  }

  function renderSidebar(container) {
    const groups = {};
    for (const page of PAGES) {
      const raw = state.raw.get(page.slug);
      if (!matchesQuery(page, raw)) continue;
      (groups[page.group] = groups[page.group] || []).push(page);
    }
    const html = Object.entries(groups).map(([group, pages]) => `
      <div class="ht-group">${escapeHtml(group)}</div>
      ${pages.map(p => `<button class="ht-link${p.slug === state.active ? ' active' : ''}" data-slug="${escapeHtml(p.slug)}">${escapeHtml(p.title)}</button>`).join('')}
    `).join('');
    container.innerHTML = html || '<div class="ht-empty">No matches</div>';
    container.querySelectorAll('[data-slug]').forEach((el) => {
      el.addEventListener('click', () => navigate(el.dataset.slug));
    });
  }

  let mountedContainer = null;
  let sideEl = null;
  let mainEl = null;

  async function navigate(slug) {
    state.active = slug;
    if (sideEl) renderSidebar(sideEl);
    if (mainEl) {
      mainEl.innerHTML = '<div class="ht-empty">Loading…</div>';
      const html = await renderPage(slug);
      // Wrap in .ht-content so styles apply
      mainEl.innerHTML = `<div class="ht-content">${html}</div>`;
      // Intercept anchor clicks for in-doc links to other pages
      mainEl.querySelectorAll('a').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (href.endsWith('.md')) {
          const match = href.match(/([^/]+?)\.md$/);
          if (match && PAGES.some(p => p.slug === match[1])) {
            a.addEventListener('click', (e) => { e.preventDefault(); navigate(match[1]); });
          }
        }
      });
      mainEl.scrollTop = 0;
    }
  }

  async function mount(container) {
    injectStyles();
    container.style.cssText = 'width:100%;height:100%;overflow:hidden;';
    mountedContainer = container;
    container.innerHTML = `
      <div class="ht-root">
        <aside class="ht-side">
          <div class="ht-side-h">📚 PiPilot Docs</div>
          <input type="text" class="ht-search" placeholder="Search…" data-search />
          <nav class="ht-nav" data-nav></nav>
        </aside>
        <main class="ht-main" data-main>
          <div class="ht-empty">Loading…</div>
        </main>
      </div>`;
    sideEl = container.querySelector('[data-nav]');
    mainEl = container.querySelector('[data-main]');
    const searchEl = container.querySelector('[data-search]');
    searchEl.addEventListener('input', () => {
      state.query = searchEl.value;
      renderSidebar(sideEl);
    });
    renderSidebar(sideEl);
    await navigate(state.active);
    // Pre-fetch all pages in the background so search has content to match
    for (const p of PAGES) loadPage(p.slug);
  }

  function openHelpTab(slug) {
    const editor = window.PiPilot?.editor;
    if (!editor || typeof editor.openVirtualTab !== 'function') return;
    if (slug && PAGES.some(p => p.slug === slug)) state.active = slug;
    try {
      if (editor.isVirtualTab && editor.isVirtualTab(TAB_ID) && typeof editor.closeFile === 'function') {
        editor.closeFile(TAB_ID);
      }
    } catch {}
    editor.openVirtualTab({
      id: TAB_ID, name: 'Help', icon: '📚', mount,
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  bus.on('help:open',  (slug) => openHelpTab(slug));
  // Surface a global so other modules can deep-link (e.g. status bar).
  window.PiPilot.help = { open: openHelpTab, pages: () => PAGES.slice() };
})();
