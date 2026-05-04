// PiPilot IDE — Ace editor + tabs + breadcrumb (replaces Monaco editor.js)

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  const hostEl = document.getElementById('monaco-host');
  const virtualHostEl = document.getElementById('virtual-host');
  const emptyEl = document.getElementById('editor-empty');
  const tabBarEl = document.getElementById('tab-bar');
  const breadcrumbEl = document.getElementById('breadcrumb');
  if (!hostEl || !tabBarEl) return;

  // ---------- Ace base path for dynamic mode/theme loading ----------
  ace.config.set('basePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7/');

  const Range = ace.require('ace/range').Range;

  // ---------- Midnight theme ----------
  ace.define('ace/theme/midnight', ['require', 'exports', 'module', 'ace/lib/dom'], function (require, exports) {
    exports.isDark = true;
    exports.cssClass = 'ace-midnight';
    exports.cssText = [
      '.ace-midnight .ace_gutter { background: #16161a; color: #42424a; border-right: 1px solid #232329; }',
      '.ace-midnight .ace_gutter-active-line { background: #1c1c21; color: #8a8a94; }',
      '.ace-midnight { background: #16161a; color: #b0b0b8; }',
      '.ace-midnight .ace_cursor { color: #FF6B35; }',
      '.ace-midnight .ace_marker-layer .ace_selection { background: rgba(255,107,53,0.25); }',
      '.ace-midnight .ace_selection.ace_start { box-shadow: 0 0 3px 0px #16161a; }',
      '.ace-midnight .ace_marker-layer .ace_active-line { background: #1c1c21; }',
      '.ace-midnight .ace_marker-layer .ace_selected-word { border: 1px solid rgba(255,107,53,0.3); }',
      '.ace-midnight .ace_invisible { color: #2a2a31; }',
      '.ace-midnight .ace_keyword { color: #FF8C61; }',
      '.ace-midnight .ace_keyword.ace_operator { color: #b0b0b8; }',
      '.ace-midnight .ace_string { color: #56d364; }',
      '.ace-midnight .ace_string.ace_regexp { color: #56d364; }',
      '.ace-midnight .ace_comment { color: #6b6b76; font-style: italic; }',
      '.ace-midnight .ace_constant.ace_numeric { color: #6cb6ff; }',
      '.ace-midnight .ace_constant.ace_language { color: #6cb6ff; }',
      '.ace-midnight .ace_constant.ace_character { color: #6cb6ff; }',
      '.ace-midnight .ace_constant.ace_other { color: #6cb6ff; }',
      '.ace-midnight .ace_entity.ace_name.ace_function { color: #e5a639; }',
      '.ace-midnight .ace_entity.ace_name.ace_tag { color: #FF6B35; }',
      '.ace-midnight .ace_entity.ace_other.ace_attribute-name { color: #e5a639; }',
      '.ace-midnight .ace_variable { color: #d9d9de; }',
      '.ace-midnight .ace_variable.ace_parameter { color: #d9d9de; }',
      '.ace-midnight .ace_support.ace_function { color: #e5a639; }',
      '.ace-midnight .ace_support.ace_type { color: #FF8C61; }',
      '.ace-midnight .ace_support.ace_constant { color: #6cb6ff; }',
      '.ace-midnight .ace_support.ace_class { color: #FF8C61; }',
      '.ace-midnight .ace_storage { color: #FF8C61; }',
      '.ace-midnight .ace_storage.ace_type { color: #FF8C61; }',
      '.ace-midnight .ace_paren { color: #b0b0b8; }',
      '.ace-midnight .ace_indent-guide { background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGD4z8DAwAoAEfgBfcsKcbYAAAAASUVORK5CYII=) right repeat-y; }',
      '.ace-midnight .ace_indent-guide-active { background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGD4z8DAwAoAEvgBfc8KcXcAAAAASUVORK5CYII=) right repeat-y; }',
      '.ace-midnight .ace_fold { background-color: #e5a639; border-color: #b0b0b8; }',
      '.ace-midnight .ace_tooltip { background: #1c1c21; color: #b0b0b8; border: 1px solid #2e2e35; }',
      '.ace-midnight .ace_search { background: #1c1c21; border: 1px solid #2e2e35; color: #b0b0b8; }',
      '.ace-midnight .ace_search_field { background: #16161a; color: #b0b0b8; border: 1px solid #2e2e35; }',
      '.ace-midnight .ace_marker-layer .ace_bracket { border: 1px solid #FF6B35; background: rgba(255,107,53,0.19); }',
      '.ace-midnight .ace_scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }',
      '.ace-midnight .ace_scrollbar::-webkit-scrollbar-thumb { background: #2e2e3580; border-radius: 4px; }',
      '.ace-midnight .ace_scrollbar::-webkit-scrollbar-thumb:hover { background: #44444d80; }',
      '.ace-midnight .ace_scrollbar::-webkit-scrollbar-track { background: var(--scrollbar-track-bg); }',
      // Diagnostic markers
      '.ace-midnight .pp-marker-error { position: absolute; border-bottom: 2px wavy #e5534b; z-index: 3; }',
      '.ace-midnight .pp-marker-warning { position: absolute; border-bottom: 2px wavy #e5a639; z-index: 3; }',
      '.ace-midnight .pp-marker-info { position: absolute; border-bottom: 2px wavy #6cb6ff; z-index: 3; }',
      // Live-change highlight markers (fade out)
      '@keyframes pp-flash-fade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }',
      '.ace-midnight .pp-line-added { position: absolute; background: rgba(86,211,100,0.12); border-left: 2px solid rgba(86,211,100,0.6); animation: pp-flash-fade 7s ease-out forwards; z-index: 1; }',
      '.ace-midnight .pp-line-modified { position: absolute; background: rgba(229,166,57,0.10); border-left: 2px solid rgba(229,166,57,0.5); animation: pp-flash-fade 7s ease-out forwards; z-index: 1; }',
    ].join('\n');
    const dom = require('ace/lib/dom');
    dom.importCssString(exports.cssText, exports.cssClass, false);
  });

  // ---------- State ----------
  // path -> { session, viewState, dirty, originalContent, name, markerIds, diagnostics }
  // virtualId -> { virtual: true, name, icon, mount, unmount, container, dirty: false }
  const openDocs = new Map();
  let activePath = null;
  let tabOrder = [];
  let aceEditor = null;
  const OPEN_TABS_PREFIX = 'pipilot:editor-tabs:';
  const RECENT_FILES_PREFIX = 'pipilot:recent-files:';
  const MAX_RECENT_FILES = 20;

  // ---------- Language map (Ace modes) ----------
  const LANG_MAP = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'tsx',
    json: 'json', jsonc: 'json',
    md: 'markdown', mdx: 'markdown',
    html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'scss', sass: 'scss', less: 'less',
    py: 'python', rb: 'ruby', go: 'golang', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c_cpp', h: 'c_cpp', cpp: 'c_cpp', cc: 'c_cpp', hpp: 'c_cpp', cs: 'csharp',
    php: 'php', sh: 'sh', bash: 'sh', zsh: 'sh',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
    sql: 'sql', lua: 'lua', r: 'r',
    dockerfile: 'dockerfile',
    vue: 'html', svelte: 'html',
  };

  // ---------- Utilities ----------
  function basename(p) {
    if (!p) return '';
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  function detectLanguage(filePath) {
    const name = basename(filePath).toLowerCase();
    if (name === 'dockerfile') return 'dockerfile';
    if (name === 'makefile') return 'makefile';
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return LANG_MAP[ext] || 'text';
  }

  function aceModePath(lang) {
    return 'ace/mode/' + (lang || 'text');
  }

  function normalizeFilePath(p) {
    // File tab identity should be case-insensitive on Windows and separator-agnostic.
    return String(p || '').replace(/\//g, '\\').toLowerCase();
  }

  function findExistingFileTabPath(filePath) {
    const normalized = normalizeFilePath(filePath);
    for (const key of openDocs.keys()) {
      const d = openDocs.get(key);
      if (!d || d.virtual) continue;
      if (normalizeFilePath(key) === normalized) return key;
    }
    return null;
  }

  function normalizeProjectKey(projectPath) {
    return String(projectPath || '').replace(/\\/g, '/').toLowerCase();
  }

  function openTabsStorageKey(projectPath) {
    return OPEN_TABS_PREFIX + normalizeProjectKey(projectPath);
  }

  function recentFilesStorageKey(projectPath) {
    return RECENT_FILES_PREFIX + normalizeProjectKey(projectPath);
  }

  function toProjectRelativePath(projectPath, filePath) {
    const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const full = String(filePath || '').replace(/\\/g, '/');
    if (!root || !full) return null;
    const rootPrefix = (root + '/').toLowerCase();
    if (!full.toLowerCase().startsWith(rootPrefix)) return null;
    return full.slice(root.length + 1);
  }

  function persistOpenTabs() {
    const projectPath = state.projectPath;
    if (!projectPath) return;
    const key = openTabsStorageKey(projectPath);
    const fileTabs = tabOrder.filter((p) => {
      const d = openDocs.get(p);
      return d && !d.virtual;
    });
    const activeFile = activePath && openDocs.get(activePath) && !openDocs.get(activePath).virtual
      ? activePath
      : (fileTabs[fileTabs.length - 1] || null);
    // Snapshot viewState for the currently-active doc so it survives a reload —
    // the doc.viewState field is only refreshed on switchTo, never for the live tab.
    if (activeFile && aceEditor) {
      const liveDoc = openDocs.get(activeFile);
      if (liveDoc && !liveDoc.virtual) {
        liveDoc.viewState = {
          scrollTop: aceEditor.session.getScrollTop(),
          scrollLeft: aceEditor.session.getScrollLeft(),
          cursor: aceEditor.getCursorPosition(),
          selection: aceEditor.getSelectionRange(),
        };
      }
    }
    const viewStates = {};
    for (const p of fileTabs) {
      const d = openDocs.get(p);
      if (d && d.viewState) {
        const sel = d.viewState.selection;
        viewStates[p] = {
          scrollTop: d.viewState.scrollTop,
          scrollLeft: d.viewState.scrollLeft,
          cursor: d.viewState.cursor,
          selection: sel && sel.start && sel.end ? { start: sel.start, end: sel.end } : null,
        };
      }
    }
    try {
      localStorage.setItem(key, JSON.stringify({ tabs: fileTabs, active: activeFile, viewStates, ts: Date.now() }));
    } catch {}
  }

  function addRecentFile(filePath) {
    const projectPath = state.projectPath;
    if (!projectPath || !filePath) return;
    const key = recentFilesStorageKey(projectPath);
    try {
      const rel = toProjectRelativePath(projectPath, filePath);
      if (!rel) return;
      const raw = localStorage.getItem(key);
      const list = Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [];
      const normalized = String(rel).replace(/\\/g, '/');
      const deduped = [normalized, ...list.filter((p) => String(p).replace(/\\/g, '/') !== normalized)].slice(0, MAX_RECENT_FILES);
      localStorage.setItem(key, JSON.stringify(deduped));
    } catch {}
  }

  async function restoreOpenTabsForProject(projectPath) {
    if (!projectPath) return;
    const t0 = performance.now();
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(openTabsStorageKey(projectPath)) || 'null');
    } catch {}
    const tabs = Array.isArray(saved?.tabs) ? saved.tabs : [];
    if (!tabs.length) return;
    const savedStates = (saved && typeof saved.viewStates === 'object' && saved.viewStates) ? saved.viewStates : {};

    // Re-hydrate a saved viewState onto the in-memory doc so the next switchTo
    // (and the active-tab path below) restore cursor + scroll without extra wiring.
    const applyViewState = (path) => {
      const vs = savedStates[path];
      if (!vs) return;
      const doc = openDocs.get(path);
      if (!doc || doc.virtual) return;
      doc.viewState = {
        scrollTop: vs.scrollTop || 0,
        scrollLeft: vs.scrollLeft || 0,
        cursor: vs.cursor || { row: 0, column: 0 },
        selection: vs.selection || null,
      };
      // If this doc is currently bound to the editor, push the cursor to the
      // live session too — otherwise the next switchTo will snapshot the
      // not-yet-applied (0, 0) cursor and overwrite our saved state.
      if (aceEditor && aceEditor.session === doc.session) {
        aceEditor.session.setScrollTop(doc.viewState.scrollTop);
        aceEditor.session.setScrollLeft(doc.viewState.scrollLeft);
        aceEditor.moveCursorToPosition(doc.viewState.cursor);
        if (doc.viewState.selection) aceEditor.selection.setRange(doc.viewState.selection);
      }
    };

    // Open the active tab first so the user sees something useful immediately,
    // then restore the rest in the background, yielding to the event loop
    // between each one. With 15+ saved tabs this turns a multi-second freeze
    // into a smooth incremental restore — the user can interact with the
    // active tab while siblings load behind it.
    const activePath = saved?.active && tabs.includes(saved.active) ? saved.active : tabs[0];
    const rest = tabs.filter(p => p !== activePath);

    let opened = 0;
    try { await openFile(activePath); opened++; } catch {}
    if (saved?.active && openDocs.has(saved.active)) switchTo(saved.active);
    applyViewState(activePath);
    if (openDocs.has('__welcome__')) closeFile('__welcome__');
    console.log(`[startup] restoreOpenTabsForProject active tab took ${(performance.now() - t0).toFixed(0)}ms`);

    // Background phase: open remaining tabs one per task, with yield points.
    const yieldFn = (cb) => (typeof requestIdleCallback === 'function')
      ? requestIdleCallback(cb, { timeout: 200 })
      : setTimeout(cb, 0);
    let i = 0;
    const restT0 = performance.now();
    function next() {
      if (i >= rest.length) {
        console.log(`[startup] restoreOpenTabsForProject restored ${opened}/${tabs.length} tabs in ${(performance.now() - t0).toFixed(0)}ms total (${(performance.now() - restT0).toFixed(0)}ms background)`);
        persistOpenTabs();
        return;
      }
      const p = rest[i++];
      // openFile triggers switchTo(p), which (line ~940) snapshots the *current*
      // doc's cursor as its viewState. Apply the saved viewState before that
      // snapshot runs so the saved cursor isn't overwritten with (0, 0).
      openFile(p).then(() => {
        opened++;
        applyViewState(p);
      }, () => {}).finally(() => yieldFn(next));
    }
    if (rest.length) yieldFn(next);
    else persistOpenTabs();
  }

  // ---------- Ace editor instance ----------
  function ensureEditor() {
    if (aceEditor) return aceEditor;
    const _t0 = performance.now();

    // Configure worker path so Ace's built-in syntax checkers (JS, JSON, CSS, etc.) load from CDN
    ace.config.set('workerPath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7');
    // Themes are loaded lazily by setTheme() — point at the same CDN so
    // dracula / github_dark / solarized_* etc. download on demand.
    ace.config.set('themePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7');
    ace.config.set('basePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7');

    // fonts.js owns font resolution: it applies the saved value (id or
    // raw CSS) and returns the final stack to use here. If fonts.js
    // hasn't loaded for some reason, fall back to whatever the user
    // typed verbatim, then to the JetBrains Mono default.
    const resolvedFont = window.PiPilot?.fonts?.apply?.(state.settings?.fontFamily)
      || (state.settings?.fontFamily || '').trim()
      || '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace';
    aceEditor = ace.edit(hostEl, {
      theme: 'ace/theme/midnight',
      fontFamily: resolvedFont,
      fontSize: state.settings?.fontSize || 13,
      showPrintMargin: false,
      highlightActiveLine: true,
      showFoldWidgets: true,
      tabSize: state.settings?.tabSize || 2,
      useSoftTabs: true,
      scrollPastEnd: 0,
      animatedScroll: true,
      cursorStyle: state.settings?.cursorStyle === 'block' ? 'ace' : 'slim',
      displayIndentGuides: true,
      showInvisibles: false,
      enableAutoIndent: true,
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: true,
      enableSnippets: false,
      wrap: state.settings?.wordWrap !== 'off',
      showLineNumbers: state.settings?.lineNumbers !== false,
      showGutter: true,
    });

    // Padding at top
    aceEditor.renderer.setScrollMargin(8, 0, 0, 0);

    // Cursor position events — use editor-level event so it survives session switches
    aceEditor.on('changeSelection', () => {
      const pos = aceEditor.getCursorPosition();
      bus.emit('editor:position', { line: pos.row + 1, col: pos.column + 1 });
    });

    // Content change -> dirty tracking
    aceEditor.on('change', () => {
      if (!activePath) return;
      // Ignore ghost text spacer line mutations
      if (window.PiPilot?.isGhostMutating?.()) return;
      const doc = openDocs.get(activePath);
      if (!doc || doc.virtual) return;
      const nowContent = doc.session.getValue();
      const isDirty = nowContent !== doc.originalContent;
      if (doc.dirty !== isDirty) {
        doc.dirty = isDirty;
        renderTabs();
        if (!isDirty) bus.emit('editor:dirty-changed', { path: activePath, dirty: false });
      }
      // Always emit when dirty so auto-save can re-debounce on every keystroke
      if (isDirty) {
        bus.emit('editor:dirty-changed', { path: activePath, dirty: true });
      }
    });

    // Ctrl+S / Cmd+S
    aceEditor.commands.addCommand({
      name: 'save',
      bindKey: { win: 'Ctrl-S', mac: 'Cmd-S' },
      exec: () => { saveFile(activePath); },
    });

    // Ctrl+Shift+S / Cmd+Shift+S
    aceEditor.commands.addCommand({
      name: 'saveAll',
      bindKey: { win: 'Ctrl-Shift-S', mac: 'Cmd-Shift-S' },
      exec: () => { saveAllFiles(); },
    });

    // Ctrl+W / Cmd+W
    aceEditor.commands.addCommand({
      name: 'closeTab',
      bindKey: { win: 'Ctrl-W', mac: 'Cmd-W' },
      exec: () => { if (activePath) closeFile(activePath); },
    });

    // Ctrl+Click (Cmd+Click on macOS) on a URL → open in our embedded
    // browser tab. Mirrors VS Code / JetBrains behaviour. Falls back to
    // opening in the system browser if the embedded browser bus event
    // isn't handled.
    //
    // Ace's mousedown event fires before the click is processed; the
    // domEvent gives us the modifier state. We hit-test the cursor
    // position, snap to the URL token under it, and intercept.
    const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/g;
    aceEditor.on('mousedown', (e) => {
      const ev = e.domEvent;
      const ctrlOrMeta = (process.platform === 'darwin') ? ev?.metaKey : ev?.ctrlKey;
      if (!ctrlOrMeta || ev?.button !== 0) return;
      try {
        const pos = e.getDocumentPosition();
        const session = aceEditor.session;
        const line = session.getLine(pos.row) || '';
        URL_RE.lastIndex = 0;
        let m;
        while ((m = URL_RE.exec(line))) {
          const start = m.index;
          const end = start + m[0].length;
          if (pos.column >= start && pos.column <= end) {
            e.preventDefault();
            e.stop?.();
            const raw = m[0];
            const url = raw.startsWith('www.') ? `https://${raw}` : raw;
            try { bus.emit('browser:open', { url }); }
            catch { window.electronAPI?.shell?.openExternal?.(url); }
            return;
          }
        }
      } catch (err) {
        console.warn('[ace] ctrl-click handler failed', err);
      }
    });

    console.log(`[startup] ensureEditor (Ace init) took ${(performance.now() - _t0).toFixed(0)}ms`);
    bus.emit('ace:ready', aceEditor);

    return aceEditor;
  }

  // ---------- Diagnostics / markers ----------
  function setDiagnostics(filePath, diagnostics) {
    const doc = openDocs.get(filePath);
    if (!doc || doc.virtual) return;

    // Clear old markers
    if (doc.markerIds && doc.markerIds.length) {
      for (const id of doc.markerIds) {
        doc.session.removeMarker(id);
      }
    }
    doc.markerIds = [];
    doc.diagnostics = diagnostics || [];

    // Add new markers
    for (const d of doc.diagnostics) {
      const row = (d.line || d.row || 1) - (d.line ? 1 : 0);
      const startCol = d.startCol || d.startColumn || 0;
      const endCol = d.endCol || d.endColumn || startCol + 1;
      const sev = d.severity === 2 || d.severity === 'warning' ? 'warning'
        : d.severity === 1 || d.severity === 'error' ? 'error' : 'info';
      const range = new Range(row, startCol, row, endCol);
      const markerId = doc.session.addMarker(range, 'pp-marker-' + sev, 'text', false);
      doc.markerIds.push(markerId);
    }

    // Annotations (gutter icons)
    const annotations = doc.diagnostics.map((d) => {
      const row = (d.line || d.row || 1) - (d.line ? 1 : 0);
      return {
        row,
        column: d.startCol || d.startColumn || 0,
        text: d.message || '',
        type: (d.severity === 2 || d.severity === 'warning') ? 'warning'
          : (d.severity === 1 || d.severity === 'error') ? 'error' : 'info',
      };
    });
    doc.session.setAnnotations(annotations);

    updateProblemsCount();

    broadcastDiagnostics();
  }

  function broadcastDiagnostics() {
    const diagMap = {};
    for (const [p, d] of openDocs) {
      if (d.virtual || !d.diagnostics?.length) continue;
      diagMap[p] = d.diagnostics.map(dd => ({
        row: (dd.line || dd.row || 1) - (dd.line ? 1 : 0),
        startCol: dd.startCol || dd.startColumn || 0,
        endCol: dd.endCol || dd.endColumn || (dd.startCol || 0) + 1,
        message: dd.message || '',
        severity: (dd.severity === 2 || dd.severity === 'warning') ? 'warning'
          : (dd.severity === 1 || dd.severity === 'error') ? 'error' : 'info',
        source: dd.source || '',
        code: dd.code || '',
        fixes: dd.fixes || [],
      }));
    }
    bus.emit('ace:diagnostics-updated', diagMap);
  }

  function updateProblemsCount() {
    let errors = 0, warnings = 0;
    for (const [, doc] of openDocs) {
      if (doc.virtual) continue;
      for (const d of (doc.diagnostics || [])) {
        const sev = d.severity;
        if (sev === 1 || sev === 'error') errors++;
        else if (sev === 2 || sev === 'warning') warnings++;
      }
    }
    bus.emit('problems:count', { errors, warnings, total: errors + warnings });
  }

  // ---------- Tab context menu ----------
  function showTabContextMenu(x, y, filePath) {
    const existing = document.getElementById('tab-ctx-menu');
    if (existing) existing.remove();

    const idx = tabOrder.indexOf(filePath);
    const menu = document.createElement('div');
    menu.id = 'tab-ctx-menu';
    menu.style.cssText = [
      'position:fixed', `left:${x}px`, `top:${y}px`,
      'z-index:99999', 'background:var(--surface,#1c1c21)',
      'border:1px solid var(--border,#2e2e35)', 'border-radius:6px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.5)', 'padding:4px 0',
      'min-width:180px', 'font-size:12px', 'color:var(--text,#b0b0b8)',
    ].join(';');

    // Build actions per tab kind. Detect virtual tabs by id prefix.
    const isBrowser = filePath.startsWith('browser-tab://');
    const isBrowserHistory = filePath === 'browser-history://';
    const isBrowserDownloads = filePath === 'browser-downloads://';
    const isCommit = filePath.startsWith('git-commit://');
    const isGitFile = filePath.startsWith('git-file://') || filePath.startsWith('git-diff-bin://');
    const isWelcome = filePath === '__welcome__' || filePath.startsWith('__walkthrough_');
    const closeBlock = [
      { label: 'Close', action: () => closeFile(filePath) },
      { label: 'Close Others', action: () => { [...tabOrder].filter(p => p !== filePath).forEach(p => closeFile(p)); } },
      { label: 'Close All', action: () => { [...tabOrder].forEach(p => closeFile(p)); } },
      { label: 'Close to the Right', action: () => { tabOrder.slice(idx + 1).forEach(p => closeFile(p)); }, disabled: idx >= tabOrder.length - 1 },
    ];

    let actions;
    if (isBrowser) {
      // Browser-tab specific menu
      const tabInfo = (window.PiPilot?.browser?.listOpenTabs?.() || []).find(t => t.tabId === filePath) || {};
      const url = tabInfo.url || '';
      actions = [
        ...closeBlock,
        null,
        { label: 'Reload Page', action: () => bus.emit('browser:control:reload', { tabId: filePath }) },
        { label: 'Duplicate Tab', action: () => { if (url) window.PiPilot?.browser?.open?.(url); } , disabled: !url },
        { label: 'New Browser Tab', action: () => window.PiPilot?.browser?.open?.() },
        { label: 'New Private Tab', action: () => window.PiPilot?.browser?.openIncognito?.() },
        null,
        { label: 'Copy URL', action: async () => { try { await navigator.clipboard.writeText(url); bus.emit('toast:show', { type: 'ok', message: 'URL copied' }); } catch {} }, disabled: !url },
        { label: 'Open in System Browser', action: () => { if (url) api.browser?.openExternal?.(url) || api.shell?.openExternal?.(url); }, disabled: !url },
        null,
        { label: 'Browser History', action: () => window.PiPilot?.browser?.openHistoryTab?.() },
        { label: 'Downloads', action: () => window.PiPilot?.browser?.openDownloadsTab?.() },
      ];
    } else if (isBrowserHistory || isBrowserDownloads) {
      actions = [
        ...closeBlock,
        null,
        { label: 'New Browser Tab', action: () => window.PiPilot?.browser?.open?.() },
        { label: isBrowserHistory ? 'Open Downloads' : 'Open History', action: () => isBrowserHistory ? window.PiPilot?.browser?.openDownloadsTab?.() : window.PiPilot?.browser?.openHistoryTab?.() },
      ];
    } else if (isCommit) {
      const hash = filePath.split('/').pop() || '';
      actions = [
        ...closeBlock,
        null,
        { label: 'Copy Commit Hash', action: async () => { try { await navigator.clipboard.writeText(hash); bus.emit('toast:show', { type: 'ok', message: 'Hash copied' }); } catch {} } },
        { label: 'Copy Short Hash', action: async () => { try { await navigator.clipboard.writeText(hash.slice(0, 7)); bus.emit('toast:show', { type: 'ok', message: 'Short hash copied' }); } catch {} } },
      ];
    } else if (isGitFile) {
      // Parse the underlying file path from git-file://<projectPath>/<hash>/<file>
      const m = filePath.match(/^git-(?:file|diff-bin):\/\/(.+?)\/([0-9a-f]+|HEAD|wt|staged)\/(.+)$/);
      const realPath = m ? `${m[1]}/${m[3]}` : '';
      actions = [
        ...closeBlock,
        null,
        { label: 'Open Current Version', action: () => realPath && bus.emit('file:open', { path: realPath }), disabled: !realPath },
        { label: 'Copy Path', action: async () => { try { await navigator.clipboard.writeText(realPath || filePath); bus.emit('toast:show', { type: 'ok', message: 'Path copied' }); } catch {} } },
      ];
    } else if (isWelcome) {
      actions = [
        ...closeBlock,
      ];
    } else {
      // Regular file tab
      actions = [
        ...closeBlock,
        null,
        { label: 'Copy Path', action: async () => { try { await navigator.clipboard.writeText(filePath); bus.emit('toast:show', { type: 'ok', message: 'Path copied' }); } catch {} } },
        { label: 'Reveal in Explorer', action: () => { api.shell?.showItemInFolder?.(filePath); } },
      ];
    }

    for (const item of actions) {
      if (!item) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border,#2e2e35);margin:4px 0;';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;padding:5px 14px;cursor:${item.disabled ? 'default' : 'pointer'};color:${item.disabled ? 'var(--text-dim,#42424a)' : 'inherit'};`;
      row.textContent = item.label;
      if (!item.disabled) {
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--surface-alt,#232329)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.addEventListener('click', () => { menu.remove(); item.action(); });
      }
      menu.appendChild(row);
    }

    document.body.appendChild(menu);

    // Close on outside click or Escape
    const dismiss = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss, true); }
    };
    const dismissKey = (e) => { if (e.key === 'Escape') { menu.remove(); document.removeEventListener('keydown', dismissKey, true); } };
    setTimeout(() => {
      document.addEventListener('mousedown', dismiss, true);
      document.addEventListener('keydown', dismissKey, true);
    }, 0);

    // Keep menu within viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  }

  // ---------- Tab rendering ----------
  function renderTabs() {
    tabBarEl.innerHTML = '';
    for (const p of tabOrder) {
      const doc = openDocs.get(p);
      if (!doc) continue;
      const isActive = p === activePath;
      const tab = h('div', {
        class: 'tab' + (isActive ? ' active' : '') + (doc.dirty ? ' dirty' : ''),
        dataset: { path: p },
        draggable: 'true',
        title: p,
      });
      tab.appendChild(h('span', { class: 'tab-icon', html: smallFileIcon(doc.name) }));
      tab.appendChild(h('span', { class: 'tab-name' }, doc.name));
      const closeBtn = h('button', {
        class: 'tab-close',
        title: 'Close',
        onClick: (e) => { e.stopPropagation(); closeFile(p); },
      });
      closeBtn.appendChild(h('span', {
        class: 'tab-close-icon',
        html: doc.dirty
          ? '<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="currentColor"/></svg>'
          : '<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.5"><path d="M2 2l6 6M8 2l-6 6"/></svg>',
      }));
      tab.appendChild(closeBtn);

      tab.addEventListener('click', () => switchTo(p));
      tab.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); closeFile(p); }
      });
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showTabContextMenu(e.clientX, e.clientY, p);
      });

      // Drag & drop reorder
      tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/pipilot-tab', p);
        e.dataTransfer.effectAllowed = 'move';
        tab.classList.add('dragging');
      });
      tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
      tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        const src = e.dataTransfer.getData('application/pipilot-tab');
        if (!src || src === p) return;
        const from = tabOrder.indexOf(src);
        const to = tabOrder.indexOf(p);
        if (from < 0 || to < 0) return;
        tabOrder.splice(from, 1);
        tabOrder.splice(to, 0, src);
        renderTabs();
        persistOpenTabs();
      });

      tabBarEl.appendChild(tab);
    }
  }

  function smallFileIcon(name) {
    const ext = name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const colors = {
      js: '#f1dd35', jsx: '#f1dd35', ts: '#3178c6', tsx: '#3178c6',
      json: '#cbcb41', md: '#6cb6ff', css: '#6cb6ff', html: '#e34c26',
      py: '#3572a5', go: '#00add8', rs: '#dea584',
    };
    const color = colors[ext] || 'var(--text-dim)';
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 2h6l4 4v8a1 1 0 0 1-1 1H3z" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1"/><path d="M9 2v4h4" stroke="${color}" stroke-width="1"/></svg>`;
  }

  // ---------- Breadcrumb ----------
  // Tabs whose ids should NOT show a path breadcrumb (browser tabs, history,
  // downloads, commit details, etc. — these aren't filesystem locations).
  const BREADCRUMB_HIDE_PREFIXES = [
    'browser-tab://',
    'browser-history://',
    'browser-downloads://',
    'git-commit://',
    'git-file://',
    'git-diff-bin://',
    'ext://',
  ];
  function updateBreadcrumb() {
    if (!breadcrumbEl) return;
    // Always clear inline display we may have set previously — let CSS
    // (`.breadcrumb:empty`) decide whether to collapse the row. Setting
    // `display:none` directly on a grid row sometimes prevents subsequent
    // grid rows (the editor area) from claiming the freed space cleanly.
    breadcrumbEl.style.display = '';
    breadcrumbEl.innerHTML = '';
    if (!activePath) return;

    // For non-file virtual tabs (browser, history, commit detail, etc.),
    // leave the breadcrumb empty — the `:empty` CSS rule collapses it.
    if (BREADCRUMB_HIDE_PREFIXES.some(p => activePath.startsWith(p))) return;

    const projRoot = state.projectPath;
    const projName = state.projectName || (projRoot ? basename(projRoot) : '');
    let rel = activePath;
    if (projRoot && activePath.startsWith(projRoot)) {
      rel = activePath.slice(projRoot.length + 1);
    }
    const parts = rel.split(/[\\/]/).filter(Boolean);

    // "/ PATH" label (Vite style)
    const pathLabel = h('span', { class: 'breadcrumb-path-label' }, '/ PATH');
    breadcrumbEl.appendChild(pathLabel);

    // Project name as first segment
    if (projName) {
      breadcrumbEl.appendChild(makeBreadcrumbSegment(projName, false, projRoot));
    }

    // Path segments
    let cumulativePath = projRoot || '';
    parts.forEach((part, i) => {
      cumulativePath += (cumulativePath ? '/' : '') + part;
      const isLast = i === parts.length - 1;
      breadcrumbEl.appendChild(makeBreadcrumbSegment(part, isLast, cumulativePath));
    });
  }

  function makeBreadcrumbSegment(label, isLast, segPath) {
    const btn = h('button', { class: 'breadcrumb-seg' + (isLast ? ' breadcrumb-seg-last' : '') });
    const text = h('span', {}, label);
    const chevron = h('span', { class: 'breadcrumb-chevron', html: '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' });
    btn.appendChild(text);
    btn.appendChild(chevron);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close any existing dropdown
      document.querySelectorAll('.breadcrumb-dropdown').forEach(d => d.remove());

      // Find siblings at this path level
      const parentDir = segPath.replace(/[\\/][^\\/]*$/, '');
      const dir = isLast ? parentDir : segPath;

      // Show dropdown with siblings
      const rect = btn.getBoundingClientRect();
      showBreadcrumbDropdown(dir, rect.left, rect.bottom + 2);
      chevron.style.transform = 'rotate(90deg)';
      const close = () => {
        chevron.style.transform = '';
        document.removeEventListener('mousedown', onOutside);
      };
      const onOutside = (ev) => {
        if (!ev.target.closest('.breadcrumb-dropdown') && !btn.contains(ev.target)) {
          document.querySelectorAll('.breadcrumb-dropdown').forEach(d => d.remove());
          close();
        }
      };
      setTimeout(() => document.addEventListener('mousedown', onOutside), 10);
    });

    return btn;
  }

  async function listDirChildren(dirPath) {
    try {
      // api.files.listDir already includes dot folders
      const result = await api.files.listDir(dirPath);
      const children = result || [];
      children.sort((a, b) => {
        const aDir = a.isDir || a.type === 'dir';
        const bDir = b.isDir || b.type === 'dir';
        if (aDir !== bDir) return aDir ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      return children;
    } catch { return []; }
  }

  const FOLDER_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--accent-light)" stroke-width="1"><path d="M2 4h4l1 1.5h7V13H2z" fill="rgba(255,107,53,0.15)"/></svg>';
  const FILE_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" stroke-width="1"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>';
  const CHEVRON_RIGHT = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>';

  async function showBreadcrumbDropdown(dirPath, left, top) {
    document.querySelectorAll('.breadcrumb-dropdown').forEach(d => d.remove());

    const children = await listDirChildren(dirPath);
    if (!children.length) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'breadcrumb-dropdown';
    dropdown.style.top = top + 'px';
    dropdown.style.left = Math.max(4, Math.min(left, window.innerWidth - 280)) + 'px';

    function renderRows(items, container, depth) {
      for (const child of items) {
        const isDir = child.isDir || child.type === 'dir';
        const row = document.createElement('button');
        row.className = 'breadcrumb-dd-row' + (child.path === activePath ? ' active' : '');
        row.style.paddingLeft = (12 + depth * 16) + 'px';

        const chevronSpan = isDir ? `<span class="breadcrumb-dd-chevron">${CHEVRON_RIGHT}</span>` : '<span style="width:8px;display:inline-block;"></span>';
        row.innerHTML = `${chevronSpan}${isDir ? FOLDER_ICON : FILE_ICON}<span class="breadcrumb-dd-name">${child.name || ''}</span>`;

        let expanded = false;
        let childContainer = null;

        row.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isDir) {
            expanded = !expanded;
            const chev = row.querySelector('.breadcrumb-dd-chevron');
            if (chev) chev.style.transform = expanded ? 'rotate(90deg)' : '';

            if (expanded) {
              if (!childContainer) {
                childContainer = document.createElement('div');
                childContainer.className = 'breadcrumb-dd-children';
                // Insert after this row
                row.parentElement.insertBefore(childContainer, row.nextSibling);
                // Load children
                const subChildren = await listDirChildren(child.path);
                if (subChildren.length) {
                  renderRows(subChildren, childContainer, depth + 1);
                } else {
                  const empty = document.createElement('div');
                  empty.className = 'breadcrumb-dd-empty';
                  empty.style.paddingLeft = (12 + (depth + 1) * 16) + 'px';
                  empty.textContent = '(empty)';
                  childContainer.appendChild(empty);
                }
              }
              childContainer.style.display = 'block';
            } else {
              if (childContainer) childContainer.style.display = 'none';
            }
          } else {
            // Open file
            dropdown.remove();
            bus.emit('file:open', { path: child.path });
          }
        });

        container.appendChild(row);
      }
    }

    renderRows(children, dropdown, 0);
    document.body.appendChild(dropdown);

    // Close on Escape
    const onKey = (e) => { if (e.key === 'Escape') { dropdown.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  function updateEmptyState() {
    const hasFiles = openDocs.size > 0;
    if (emptyEl) emptyEl.style.display = hasFiles ? 'none' : 'flex';
    if (hostEl) hostEl.style.display = hasFiles ? 'block' : 'none';
  }

  // ---------- Core operations ----------
  async function openFile(filePath, opts = {}) {
    if (!filePath) return;

    const existingPath = findExistingFileTabPath(filePath);
    if (existingPath) {
      switchTo(existingPath, opts);
      return;
    }

    if (!openDocs.has(filePath)) {
      let data;
      try {
        data = await api.files.read(filePath);
      } catch (e) {
        bus.emit('toast:show', { type: 'error', message: 'Open failed: ' + e.message });
        return;
      }
      if (data && data.binary) {
        // Binary file -> open as virtual tab
        const fpath = filePath;
        const fname = basename(filePath);
        const fsize = data.size || 0;
        const fmime = data.mime || 'application/octet-stream';
        const isImage = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/i.test(fname);
        const isFont = /\.(woff|woff2|ttf|otf|eot)$/i.test(fname);
        openVirtualTab({
          id: filePath,
          name: fname,
          mount: (container) => {
            container.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;gap:16px;padding:32px;box-sizing:border-box;background:var(--bg);';
            const formatSize = (bytes) => {
              if (bytes < 1024) return bytes + ' B';
              if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
              return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            };
            if (isImage && data.dataUrl) {
              const img = document.createElement('img');
              img.src = data.dataUrl;
              img.style.cssText = 'max-width:100%;max-height:60%;object-fit:contain;border-radius:6px;border:1px solid var(--border);';
              container.appendChild(img);
            } else {
              const icon = document.createElement('div');
              icon.style.cssText = 'width:64px;height:64px;background:var(--surface);border:1px solid var(--border);border-radius:12px;display:flex;align-items:center;justify-content:center;';
              icon.innerHTML = isFont
                ? '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>'
                : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
              container.appendChild(icon);
            }
            const info = document.createElement('div');
            info.style.cssText = 'text-align:center;display:flex;flex-direction:column;gap:6px;';
            info.innerHTML = `
              <div style="font-size:16px;font-weight:600;color:var(--text-strong);font-family:var(--font-mono);">${fname}</div>
              <div style="font-size:12px;color:var(--text-mid);font-family:var(--font-mono);">${fmime}</div>
              <div style="font-size:11px;color:var(--text-dim);">${formatSize(fsize)}</div>
              <div style="font-size:10px;color:var(--text-faint);margin-top:8px;max-width:400px;word-break:break-all;">${fpath}</div>
            `;
            container.appendChild(info);
            const copyBtn = document.createElement('button');
            copyBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text-mid);font-size:11px;font-family:var(--font-mono);cursor:pointer;';
            copyBtn.textContent = 'Copy Path';
            copyBtn.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(fpath);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy Path'; }, 1500);
              } catch {}
            });
            container.appendChild(copyBtn);
          },
        });
        return;
      }

      const content = (data && data.content) || '';
      const lang = detectLanguage(filePath);
      const session = ace.createEditSession(content, aceModePath(lang));
      session.setTabSize(state.settings?.tabSize || 2);
      session.setUseSoftTabs(true);
      session.setUseWrapMode(state.settings?.wordWrap !== 'off');
      // Ace's syntax workers are narrow: the JS worker chokes on JSX/TSX, the HTML
      // worker can't parse Vue/Svelte/MDX templates, and the CSS worker rejects SCSS/
      // LESS/Tailwind directives. Key the toggle on the file *extension* (not the Ace
      // mode), because LANG_MAP aliases jsx→javascript and vue/svelte→html — using
      // the mode name would re-enable the worker on exactly the files it misreads.
      const extMatch = String(filePath || '').toLowerCase().match(/\.([a-z0-9]+)$/);
      const ext = extMatch ? extMatch[1] : '';
      const WORKER_EXTS = new Set(['js', 'mjs', 'cjs', 'json', 'jsonc', 'html', 'htm']);
      session.setOption('useWorker', WORKER_EXTS.has(ext));

      const docEntry = {
        session,
        viewState: null,
        dirty: false,
        originalContent: content,
        name: basename(filePath),
        markerIds: [],
        diagnostics: [],
      };
      openDocs.set(filePath, docEntry);

      // Listen for annotation changes from Ace's worker (built-in syntax checking)
      session.on('changeAnnotation', () => {
        const anns = session.getAnnotations() || [];
        if (!anns.length && !docEntry.diagnostics.length) return;
        // Convert Ace annotations to our diagnostics format
        docEntry.diagnostics = anns.map(a => ({
          row: a.row,
          line: a.row + 1,
          startCol: a.column || 0,
          endCol: (a.column || 0) + 1,
          message: a.text || '',
          severity: a.type === 'error' ? 1 : a.type === 'warning' ? 2 : 3,
          source: 'ace',
          code: '',
        }));
        // Re-add squiggly markers
        if (docEntry.markerIds.length) {
          for (const id of docEntry.markerIds) session.removeMarker(id);
          docEntry.markerIds = [];
        }
        for (const d of docEntry.diagnostics) {
          const sev = d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info';
          const line = session.getLine(d.row) || '';
          const endCol = Math.max(d.endCol, Math.min(d.startCol + line.trimEnd().length - d.startCol, line.length));
          const range = new Range(d.row, d.startCol, d.row, endCol || d.startCol + 1);
          docEntry.markerIds.push(session.addMarker(range, 'pp-marker-' + sev, 'text', false));
        }
        updateProblemsCount();
        broadcastDiagnostics();
      });
      tabOrder.push(filePath);
      persistOpenTabs();
    }

    switchTo(filePath, opts);
  }

  function switchTo(filePath, opts = {}) {
    // Save view state of previous file
    if (activePath && openDocs.has(activePath) && aceEditor) {
      const prev = openDocs.get(activePath);
      if (!prev.virtual) {
        prev.viewState = {
          scrollTop: aceEditor.session.getScrollTop(),
          scrollLeft: aceEditor.session.getScrollLeft(),
          cursor: aceEditor.getCursorPosition(),
          selection: aceEditor.getSelectionRange(),
        };
      }
    }

    const doc = openDocs.get(filePath);
    if (!doc) return;

    activePath = filePath;
    state.activeFile = filePath;

    if (doc.virtual) {
      // Hide Ace host, show virtual content
      hostEl.classList.add('hidden');
      virtualHostEl.classList.remove('hidden');
      if (!doc.mounted) {
        const container = document.createElement('div');
        container.className = 'virtual-tab-content';
        container.style.cssText = 'width:100%;height:100%;overflow:auto;';
        doc.container = container;
        virtualHostEl.innerHTML = '';
        virtualHostEl.appendChild(container);
        try {
          doc.unmount = doc.mount(container) || (() => {});
        } catch (e) {
          console.error('virtual mount', e);
        }
        doc.mounted = true;
      } else {
        virtualHostEl.innerHTML = '';
        virtualHostEl.appendChild(doc.container);
      }
      bus.emit('editor:active-changed', { path: filePath, virtual: true });
      bus.emit('editor:language', { language: '' });
    } else {
      ensureEditor();
      // Show Ace, hide virtual
      virtualHostEl.classList.add('hidden');
      hostEl.classList.remove('hidden');
      if (aceEditor) {
        aceEditor.setSession(doc.session);
        if (doc.viewState) {
          aceEditor.session.setScrollTop(doc.viewState.scrollTop);
          aceEditor.session.setScrollLeft(doc.viewState.scrollLeft);
          aceEditor.moveCursorToPosition(doc.viewState.cursor);
          aceEditor.selection.setRange(doc.viewState.selection);
        }
        if (opts.line) {
          const row = opts.line - 1;
          const col = (opts.col || 1) - 1;
          aceEditor.gotoLine(opts.line, col, true);
          aceEditor.scrollToLine(row, true, true);
        }
        aceEditor.focus();
      }
      const lang = detectLanguage(filePath);
      addRecentFile(filePath);
      bus.emit('editor:active-changed', { path: filePath });
      bus.emit('editor:language', { language: lang });
    }

    renderTabs();
    updateBreadcrumb();
    updateEmptyState();

    state.openFiles = tabOrder.map((p) => {
      const d = openDocs.get(p);
      return { path: p, name: d.name, dirty: d.dirty, virtual: !!d.virtual };
    });
    persistOpenTabs();
  }

  async function closeFile(filePath) {
    const doc = openDocs.get(filePath);
    if (!doc) return;
    if (doc.dirty && !doc.virtual) {
      const ok = window.confirm(`"${doc.name}" has unsaved changes. Close without saving?`);
      if (!ok) return;
    }
    if (doc.virtual) {
      try { doc.unmount?.(); } catch {}
      if (doc.container && doc.container.parentNode === virtualHostEl) {
        virtualHostEl.removeChild(doc.container);
      }
    } else {
      // Clean up markers
      if (doc.markerIds) {
        for (const id of doc.markerIds) {
          try { doc.session.removeMarker(id); } catch {}
        }
      }
      try { doc.session.destroy(); } catch {}
    }
    openDocs.delete(filePath);
    tabOrder = tabOrder.filter((p) => p !== filePath);

    if (activePath === filePath) {
      activePath = null;
      state.activeFile = null;
      if (tabOrder.length) {
        switchTo(tabOrder[tabOrder.length - 1]);
      } else {
        if (aceEditor) aceEditor.setSession(ace.createEditSession('', 'ace/mode/text'));
        virtualHostEl.classList.add('hidden');
        virtualHostEl.innerHTML = '';
        hostEl.classList.remove('hidden');
        renderTabs();
        updateBreadcrumb();
        updateEmptyState();
        bus.emit('editor:active-changed', { path: null });
      }
    } else {
      renderTabs();
    }

    updateProblemsCount();

    state.openFiles = tabOrder.map((p) => {
      const d = openDocs.get(p);
      return { path: p, name: d.name, dirty: d.dirty };
    });
    persistOpenTabs();
  }

  async function saveFile(filePath) {
    if (!filePath) filePath = activePath;
    if (!filePath) return;
    const doc = openDocs.get(filePath);
    if (!doc || doc.virtual) return;
    if (!doc.dirty) return;
    const content = doc.session.getValue();
    try {
      await api.files.write(filePath, content);
      doc.originalContent = content;
      doc.dirty = false;
      renderTabs();
      bus.emit('editor:dirty-changed', { path: filePath, dirty: false });
      bus.emit('file:saved', { path: filePath });
      bus.emit('toast:show', { type: 'ok', message: `Saved ${doc.name}` });
    } catch (e) {
      bus.emit('toast:show', { type: 'error', message: 'Save failed: ' + e.message });
    }
  }

  async function saveAllFiles() {
    const dirty = [...openDocs.entries()].filter(([, d]) => d.dirty && !d.virtual);
    for (const [p] of dirty) {
      await saveFile(p);
    }
  }

  function getDirtyFiles() {
    return [...openDocs.entries()].filter(([, d]) => d.dirty && !d.virtual).map(([p]) => p);
  }

  function getActiveFile() {
    return activePath;
  }

  // ---------- Virtual tab API ----------
  function openVirtualTab({ id, name, icon, mount }) {
    if (!id || typeof mount !== 'function') return;
    if (openDocs.has(id)) {
      switchTo(id);
      return;
    }
    openDocs.set(id, {
      virtual: true,
      name: name || id,
      icon,
      mount,
      mounted: false,
      dirty: false,
    });
    tabOrder.push(id);
    switchTo(id);
  }

  function openDiffTab({ id, name, original, modified, language, originalTitle, modifiedTitle }) {
    const tabId = id || `pipilot://diff/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (openDocs.has(tabId)) { switchTo(tabId); return; }

    let leftEditor = null;
    let rightEditor = null;

    openVirtualTab({
      id: tabId,
      name: name || 'Diff',
      mount: (container) => {
        // Diff tab needs Ace to own scrolling — disable parent scroll
        container.style.overflow = 'hidden';

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;background:#16161a;overflow:hidden;';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;font-size:11px;color:var(--text-mid,#8a8a94);border-bottom:1px solid var(--border,#2e2e35);background:var(--surface,#1c1c21);flex-shrink:0;';
        const leftTitle = document.createElement('div');
        leftTitle.style.cssText = 'flex:1;padding:6px 12px;';
        leftTitle.textContent = originalTitle || 'Original';
        const rightTitle = document.createElement('div');
        rightTitle.style.cssText = 'flex:1;padding:6px 12px;border-left:1px solid var(--border,#2e2e35);';
        rightTitle.textContent = modifiedTitle || 'Modified';
        header.appendChild(leftTitle);
        header.appendChild(rightTitle);
        wrap.appendChild(header);

        // Editor pair with resizable divider
        const editorsRow = document.createElement('div');
        editorsRow.style.cssText = 'display:flex;flex:1;min-height:0;position:relative;overflow:hidden;';

        const leftHost = document.createElement('div');
        leftHost.style.cssText = 'width:50%;min-width:80px;position:relative;overflow:hidden;';
        const divider = document.createElement('div');
        divider.style.cssText = 'width:4px;cursor:col-resize;background:var(--border,#2e2e35);flex-shrink:0;transition:background 0.15s;z-index:5;';
        divider.addEventListener('mouseenter', () => { divider.style.background = 'var(--accent,#FF6B35)'; });
        divider.addEventListener('mouseleave', () => { if (!dragging) divider.style.background = 'var(--border,#2e2e35)'; });
        const rightHost = document.createElement('div');
        rightHost.style.cssText = 'flex:1;min-width:80px;position:relative;overflow:hidden;';

        editorsRow.appendChild(leftHost);
        editorsRow.appendChild(divider);
        editorsRow.appendChild(rightHost);
        wrap.appendChild(editorsRow);
        container.appendChild(wrap);

        // Resize logic
        let dragging = false;
        divider.addEventListener('mousedown', (e) => {
          e.preventDefault();
          dragging = true;
          divider.style.background = 'var(--accent,#FF6B35)';
          const startX = e.clientX;
          const startW = leftHost.offsetWidth;
          const totalW = editorsRow.offsetWidth - divider.offsetWidth;
          const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const newW = Math.max(80, Math.min(totalW - 80, startW + dx));
            leftHost.style.width = newW + 'px';
            if (leftEditor) leftEditor.resize();
            if (rightEditor) rightEditor.resize();
          };
          const onUp = () => {
            dragging = false;
            divider.style.background = 'var(--border,#2e2e35)';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        const aceLang = language ? aceModePath(LANG_MAP[language] || language) : 'ace/mode/text';
        const editorOpts = {
          theme: 'ace/theme/midnight',
          mode: aceLang,
          readOnly: true,
          showPrintMargin: false,
          highlightActiveLine: false,
          fontSize: 13,
          fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace',
          showGutter: true,
          scrollPastEnd: 0,
          useWrapMode: false,
        };

        // Create editors after DOM layout
        setTimeout(() => {
          try {
            leftEditor = ace.edit(leftHost, editorOpts);
            leftEditor.setValue(original || '', -1);
            leftEditor.clearSelection();
            leftEditor.renderer.setScrollMargin(0, 0, 0, 0);

            rightEditor = ace.edit(rightHost, editorOpts);
            rightEditor.setValue(modified || '', -1);
            rightEditor.clearSelection();
            rightEditor.renderer.setScrollMargin(0, 0, 0, 0);

            // Force correct sizing
            leftEditor.resize();
            rightEditor.resize();

            // Highlight diff lines
            highlightDiffLines(leftEditor, rightEditor, original || '', modified || '');

            // Sync scrolling (both axes) — use RAF guard to prevent feedback loop
            let syncSource = null;
            leftEditor.session.on('changeScrollTop', (st) => {
              if (syncSource === 'right') return;
              syncSource = 'left';
              rightEditor.session.setScrollTop(st);
              requestAnimationFrame(() => { syncSource = null; });
            });
            rightEditor.session.on('changeScrollTop', (st) => {
              if (syncSource === 'left') return;
              syncSource = 'right';
              leftEditor.session.setScrollTop(st);
              requestAnimationFrame(() => { syncSource = null; });
            });
            leftEditor.session.on('changeScrollLeft', (sl) => {
              if (syncSource === 'right') return;
              syncSource = 'left';
              rightEditor.session.setScrollLeft(sl);
              requestAnimationFrame(() => { syncSource = null; });
            });
            rightEditor.session.on('changeScrollLeft', (sl) => {
              if (syncSource === 'left') return;
              syncSource = 'right';
              leftEditor.session.setScrollLeft(sl);
              requestAnimationFrame(() => { syncSource = null; });
            });

            // Resize on container size changes
            const ro = new ResizeObserver(() => {
              leftEditor?.resize();
              rightEditor?.resize();
            });
            ro.observe(editorsRow);
          } catch (e) {
            console.error('diff editor creation failed', e);
          }
        }, 30);

        return () => {
          try { leftEditor?.destroy(); } catch {}
          try { rightEditor?.destroy(); } catch {}
        };
      },
    });
  }

  function highlightDiffLines(leftEd, rightEd, originalText, modifiedText) {
    const origLines = originalText.split('\n');
    const modLines = modifiedText.split('\n');

    // Simple line-by-line diff highlighting
    const maxLen = Math.max(origLines.length, modLines.length);
    for (let i = 0; i < maxLen; i++) {
      const origLine = i < origLines.length ? origLines[i] : undefined;
      const modLine = i < modLines.length ? modLines[i] : undefined;

      if (origLine !== modLine) {
        if (origLine !== undefined && i < origLines.length) {
          leftEd.session.addMarker(
            new Range(i, 0, i, origLine.length || 1),
            'ace-diff-removed',
            'fullLine',
            false
          );
        }
        if (modLine !== undefined && i < modLines.length) {
          rightEd.session.addMarker(
            new Range(i, 0, i, modLine.length || 1),
            'ace-diff-added',
            'fullLine',
            false
          );
        }
      }
    }
  }

  // Inject diff highlight CSS
  (function injectDiffCSS() {
    const style = document.createElement('style');
    style.textContent = [
      '.ace-diff-removed { position: absolute; background: rgba(229,83,75,0.15); z-index: 1; }',
      '.ace-diff-added { position: absolute; background: rgba(86,211,100,0.15); z-index: 1; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  // ---------- Bus wiring ----------
  bus.on('file:open', (payload) => {
    if (!payload) return;
    const p = typeof payload === 'string' ? payload : payload.path;
    openFile(p, { line: payload?.line, col: payload?.col });
  });

  bus.on('menu:save', () => saveFile(activePath));
  bus.on('menu:save-all', () => saveAllFiles());

  bus.on('project:closed', () => {
    for (const [, doc] of openDocs) {
      if (doc.virtual) {
        try { doc.unmount?.(); } catch {}
      } else {
        try { doc.session.destroy(); } catch {}
      }
    }
    openDocs.clear();
    tabOrder = [];
    activePath = null;
    state.activeFile = null;
    state.openFiles = [];
    if (aceEditor) aceEditor.setSession(ace.createEditSession('', 'ace/mode/text'));
    virtualHostEl.classList.add('hidden');
    virtualHostEl.innerHTML = '';
    hostEl.classList.remove('hidden');
    renderTabs();
    updateBreadcrumb();
    updateEmptyState();
    persistOpenTabs();
  });

  bus.on('project:opened', ({ path }) => {
    const projectPath = path || state.projectPath;
    if (!projectPath) return;
    // Welcome tab may open shortly after project load; restore after that.
    setTimeout(() => { restoreOpenTabsForProject(projectPath); }, 420);
  });

  bus.on('file:renamed', ({ from, to }) => {
    if (!openDocs.has(from)) return;
    const doc = openDocs.get(from);
    const wasActive = activePath === from;
    let viewState = null;
    if (aceEditor && wasActive && !doc.virtual) {
      viewState = {
        scrollTop: aceEditor.session.getScrollTop(),
        scrollLeft: aceEditor.session.getScrollLeft(),
        cursor: aceEditor.getCursorPosition(),
        selection: aceEditor.getSelectionRange(),
      };
    }
    // Clean up old
    if (!doc.virtual) {
      try { doc.session.destroy(); } catch {}
    }
    openDocs.delete(from);
    tabOrder = tabOrder.filter((p) => p !== from);
    if (wasActive) {
      activePath = null;
      state.activeFile = null;
    }
    if (wasActive) {
      openFile(to).then(() => {
        if (aceEditor && viewState) {
          aceEditor.session.setScrollTop(viewState.scrollTop);
          aceEditor.session.setScrollLeft(viewState.scrollLeft);
          aceEditor.moveCursorToPosition(viewState.cursor);
        }
      });
    }
  });

  bus.on('file:deleted', ({ path }) => {
    if (openDocs.has(path)) closeFile(path);
  });

  // Live-reload open files when they change on disk (e.g. agent edits)
  bus.on('file:external-change', async (evt) => {
    if (!evt || evt.type !== 'change' || !evt.path) return;
    // Normalize path separators to match openDocs keys
    const fp = evt.path.replace(/\//g, '\\');
    const doc = openDocs.get(fp) || openDocs.get(evt.path);
    if (!doc || doc.virtual) return;

    // Skip if user has unsaved edits — don't overwrite their work
    if (doc.dirty) return;

    const docPath = openDocs.has(fp) ? fp : evt.path;

    let newContent;
    try {
      const result = await api.files.read(docPath);
      if (!result || result.binary) return;
      newContent = typeof result === 'string' ? result : result.content;
    } catch { return; }
    if (typeof newContent !== 'string') return;

    // Skip if content hasn't actually changed
    if (newContent === doc.session.getValue()) return;

    // Save cursor, scroll, and selection state
    const isActive = activePath === docPath;
    let cursor, scrollTop, scrollLeft, selRange;
    if (isActive && aceEditor) {
      cursor = aceEditor.getCursorPosition();
      scrollTop = aceEditor.session.getScrollTop();
      scrollLeft = aceEditor.session.getScrollLeft();
      selRange = aceEditor.selection.getRange();
    } else if (doc.viewState) {
      cursor = doc.viewState.cursor;
      scrollTop = doc.viewState.scrollTop;
      scrollLeft = doc.viewState.scrollLeft;
      selRange = doc.viewState.selection;
    }

    // Diff old vs new for change highlight markers
    const oldLines = doc.session.doc.getAllLines();
    const newLines = newContent.split(/\n/);

    // Update content using doc.setValue to preserve undo history
    doc.session.doc.setValue(newContent);
    doc.originalContent = newContent;
    doc.dirty = false;

    // Add green/orange line highlights for changed/added lines
    const changeMarkerIds = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;
      if (oldLine === newLine) continue;
      const cls = oldLine === undefined ? 'pp-line-added' : 'pp-line-modified';
      if (newLine !== undefined) {
        const range = new Range(i, 0, i, 1);
        const mid = doc.session.addMarker(range, cls, 'fullLine', false);
        changeMarkerIds.push(mid);
      }
    }
    // Auto-remove markers after animation completes
    if (changeMarkerIds.length) {
      setTimeout(() => {
        for (const mid of changeMarkerIds) {
          try { doc.session.removeMarker(mid); } catch {}
        }
      }, 7500);
    }

    // Restore cursor/scroll (clamp to new content bounds)
    if (isActive && aceEditor && cursor) {
      const maxRow = doc.session.getLength() - 1;
      const safeRow = Math.min(cursor.row, maxRow);
      const safeCol = Math.min(cursor.column, doc.session.getLine(safeRow).length);
      aceEditor.moveCursorToPosition({ row: safeRow, column: safeCol });
      aceEditor.session.setScrollTop(scrollTop || 0);
      aceEditor.session.setScrollLeft(scrollLeft || 0);
      if (selRange) {
        try { aceEditor.selection.setRange(selRange); } catch {}
      }
      aceEditor.clearSelection();
    }

    renderTabs();
    bus.emit('editor:dirty-changed', { path: docPath, dirty: false });
  });

  // Close tabs for files deleted externally (e.g. agent deleted a file)
  bus.on('file:external-change', (evt) => {
    if (!evt || evt.type !== 'unlink' || !evt.path) return;
    const fp2 = evt.path.replace(/\//g, '\\');
    const key = openDocs.has(fp2) ? fp2 : (openDocs.has(evt.path) ? evt.path : null);
    if (key) closeFile(key);
  });

  // Auto-open newly created files (like VSCode does when agent creates a file)
  bus.on('file:external-change', (evt) => {
    if (!evt || evt.type !== 'add' || !evt.path) return;
    // Only auto-open files, not directories
    if (evt.path.endsWith('/') || evt.path.endsWith('\\')) return;
    // Skip non-text files by extension
    const skip = /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|mp[34]|wav|ogg|webm|zip|tar|gz|exe|dll|so|dylib|lock)$/i;
    if (skip.test(evt.path)) return;
    // Skip files inside heavy/internal dirs (node_modules, .git, .pipilot, dist, etc.)
    const heavyDirs = /[/\\](node_modules|\.git|\.pipilot|dist|build|\.next|\.cache|\.turbo|out)[/\\]/;
    if (heavyDirs.test(evt.path)) return;
    openFile(evt.path);
  });

  // Diagnostics bus event
  bus.on('diagnostics:set', ({ path, diagnostics }) => {
    setDiagnostics(path, diagnostics);
  });

  // Global keyboard shortcuts (fallback if Ace not focused)
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveFile(activePath);
    } else if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveAllFiles();
    } else if (mod && (e.key === 'w' || e.key === 'W')) {
      if (activePath) { e.preventDefault(); closeFile(activePath); }
    }
  });

  // Listen for main-process menu events
  if (api.onMenu) {
    api.onMenu('save', () => saveFile(activePath));
    api.onMenu('save-all', () => saveAllFiles());
  }

  // Initial state
  updateEmptyState();
  renderTabs();
  updateBreadcrumb();

  // ---------- Resize handling ----------
  const resizeObserver = new ResizeObserver(() => {
    if (aceEditor) aceEditor.resize();
  });
  resizeObserver.observe(hostEl);

  // ── Reapply settings to existing sessions ─────────────────────────
  // The Ace edit sessions are created lazily per-file, and each one calls
  // session.setUseWrapMode at creation. If the user's saved settings load
  // AFTER a session was created, or they toggle wordWrap in Settings, we
  // need to push the new value into every open session — Ace doesn't do
  // this automatically. Same for tab size.
  function reapplyEditorSettings(changedKey) {
    const wantWrap = state.settings?.wordWrap !== 'off';
    const wantTab = state.settings?.tabSize || 2;
    for (const [, doc] of openDocs) {
      if (doc.virtual || !doc.session) continue;
      try {
        if (!changedKey || changedKey === 'wordWrap') doc.session.setUseWrapMode(wantWrap);
        if (!changedKey || changedKey === 'tabSize') doc.session.setTabSize(wantTab);
      } catch {}
    }
    if (aceEditor) {
      try {
        if (!changedKey || changedKey === 'wordWrap') aceEditor.setOption('wrap', wantWrap);
        if (!changedKey || changedKey === 'fontSize') aceEditor.setOption('fontSize', state.settings?.fontSize || 13);
        // fontFamily is handled entirely by fonts.js (it resolves font ids
        // from the registry, lazy-loads web stylesheets, and pushes the
        // resolved CSS into Ace via the fonts:applied bus event).
        if (!changedKey || changedKey === 'cursorStyle') {
          aceEditor.setOption('cursorStyle', state.settings?.cursorStyle === 'block' ? 'ace' : 'slim');
        }
        if (!changedKey || changedKey === 'lineNumbers') {
          aceEditor.setOption('showLineNumbers', state.settings?.lineNumbers !== false);
        }
      } catch {}
    }
  }
  bus.on('settings:loaded', () => reapplyEditorSettings(null));
  bus.on('settings:changed', (payload) => {
    if (!payload) return;
    if (['wordWrap', 'tabSize', 'fontSize', 'cursorStyle', 'lineNumbers'].includes(payload.key)) {
      reapplyEditorSettings(payload.key);
    }
  });

  // ---------- Public API ----------
  window.PiPilot.editor = {
    openFile,
    closeFile,
    saveFile,
    saveAllFiles,
    getActiveFile,
    getDirtyFiles,
    getAce: () => aceEditor,
    getEditor: () => aceEditor,
    getMonaco: () => null, // backward compat — no Monaco
    openVirtualTab,
    openDiffTab,
    isVirtualTab: (id) => !!openDocs.get(id)?.virtual,
    setDiagnostics,
    getSession: (filePath) => {
      const doc = openDocs.get(filePath || activePath);
      return doc && !doc.virtual ? doc.session : null;
    },
  };
})();
