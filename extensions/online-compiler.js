// PiPilot IDE Extension: Online Code Compiler
// Powered by OneCompiler API — compile & run 60+ languages online.
// Free 50 executions with built-in key, then users get their own at:
// https://www.allthingsdev.co/apimarketplace/endpoints/onecompiler-apis/665c76be98e9e140d6530c20

(function (PiPilot, bus, api, state, db) {

  var DEFAULT_API_KEY = 'Mkv8n2ggXBuRSIyBCeqGPS43F55PHHrXax3qRrIGIKl4EoBLtW';
  var API_URL = 'https://OneCompiler-APIs.proxy-production.allthingsdev.co/api/v1/run';
  var API_HOST = 'OneCompiler-APIs.allthingsdev.co';
  var API_ENDPOINT = '4e3cf87d-56c0-4dc2-88b4-c63c0a3ac6df';

  // Language map: file extension → OneCompiler language ID
  var LANG_MAP = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', python: 'python',
    java: 'java',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin', kts: 'kotlin',
    scala: 'scala',
    r: 'r', R: 'r',
    dart: 'dart',
    lua: 'lua',
    perl: 'perl', pl: 'perl',
    sh: 'bash', bash: 'bash',
    ps1: 'powershell',
    sql: 'mysql',
    html: 'html',
    groovy: 'groovy',
    haskell: 'haskell', hs: 'haskell',
    clj: 'clojure',
    ex: 'elixir', exs: 'elixir',
    erl: 'erlang',
    fs: 'fsharp', fsx: 'fsharp',
    m: 'objectivec',
    pas: 'pascal',
    nim: 'nim',
    d: 'd',
    vb: 'vb',
    coffee: 'coffeescript',
    asm: 'assembly',
    cobol: 'cobol', cob: 'cobol',
    fortran: 'fortran', f90: 'fortran',
    lisp: 'commonlisp', cl: 'commonlisp',
    prolog: 'prolog',
    tcl: 'tcl',
  };

  var cachedApiKey = '';
  var isRunning = false;

  // Load user's custom API key (falls back to default)
  async function getApiKey() {
    if (cachedApiKey) return cachedApiKey;
    if (db) {
      try {
        var stored = await db.get('apiKey');
        if (stored) { cachedApiKey = stored; return stored; }
      } catch (e) {}
    }
    return DEFAULT_API_KEY;
  }

  async function saveApiKey(key) {
    cachedApiKey = key;
    if (db) await db.set('apiKey', key);
  }

  function detectLanguage(filePath) {
    if (!filePath) return null;
    var ext = filePath.split('.').pop().toLowerCase();
    return LANG_MAP[ext] || null;
  }

  // ── Run code via OneCompiler API ──
  async function runCode(code, language, stdin) {
    var apiKey = await getApiKey();

    var body = {
      language: language,
      stdin: stdin || '',
      files: [
        { name: 'main', content: code }
      ]
    };

    var resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-apihub-key': apiKey,
        'x-apihub-host': API_HOST,
        'x-apihub-endpoint': API_ENDPOINT,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      var errText = await resp.text().catch(function () { return ''; });
      if (resp.status === 429) {
        throw new Error('Rate limit exceeded. Get your own API key at allthingsdev.co');
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Invalid API key. Update your key in extension settings.');
      }
      throw new Error('API error ' + resp.status + ': ' + errText.slice(0, 200));
    }

    return await resp.json();
  }

  // ── Inject CSS ──
  var style = document.createElement('style');
  style.textContent = '\
.oc-output-header { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--surface-alt); }\
.oc-output-lang { font-size: 9px; color: var(--accent); background: rgba(255,107,53,0.1); padding: 1px 6px; border-radius: 3px; }\
.oc-output-meta { font-size: 9px; color: var(--text-dim); }\
.oc-output-actions { margin-left: auto; display: flex; gap: 4px; }\
.oc-output-btn { background: none; border: 1px solid var(--border); color: var(--text-dim); cursor: pointer; font-size: 10px; font-family: var(--font-mono); padding: 1px 6px; border-radius: 3px; }\
.oc-output-btn:hover { color: var(--text); border-color: var(--text-dim); }\
.oc-output-body { padding: 8px 10px; white-space: pre-wrap; color: var(--text); line-height: 1.5; font-family: var(--font-mono); font-size: 12px; overflow: auto; height: 100%; user-select: text; }\
.oc-output-body .oc-error { color: var(--error); }\
.oc-output-body .oc-success { color: var(--ok); }\
';
  document.head.appendChild(style);

  // ── Add "Output" tab + pane to bottom panel ──
  var tabsBar = document.querySelector('.bottom-tabs');
  var bottomContent = document.querySelector('.bottom-content');
  var outputTab = null;
  var outputPane = null;

  if (tabsBar && bottomContent) {
    // Add tab button before the spacer
    var spacer = tabsBar.querySelector('.bottom-tabs-spacer');
    outputTab = document.createElement('button');
    outputTab.className = 'bottom-tab';
    outputTab.dataset.bottom = 'output';
    outputTab.textContent = 'Output';
    tabsBar.insertBefore(outputTab, spacer);

    // Add pane
    outputPane = document.createElement('div');
    outputPane.id = 'output-pane';
    outputPane.className = 'bottom-pane';
    outputPane.innerHTML = '<div class="empty-state" style="color:var(--text-dim);font-size:11px;">Run code to see output here (Ctrl+Alt+R)</div>';
    bottomContent.appendChild(outputPane);

    // Wire tab click (integrate with existing tab system)
    outputTab.addEventListener('click', function () {
      // Deactivate all tabs and panes
      var allTabs = tabsBar.querySelectorAll('.bottom-tab');
      var allPanes = bottomContent.querySelectorAll('.bottom-pane');
      for (var i = 0; i < allTabs.length; i++) allTabs[i].classList.remove('active');
      for (var i = 0; i < allPanes.length; i++) allPanes[i].classList.remove('active');
      // Activate output
      outputTab.classList.add('active');
      outputPane.classList.add('active');
      // Make sure bottom panel is visible
      var mainArea = document.getElementById('main-area');
      if (mainArea) mainArea.classList.remove('bottom-collapsed');
    });
  }

  function switchToOutputTab() {
    if (outputTab) outputTab.click();
  }

  function showOutput(language, result, elapsed) {
    if (!outputPane) return;

    var hasError = (result.stderr && result.stderr.trim()) || result.exception;
    var output = '';
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? '\n' : '') + result.stderr;
    if (result.exception) output += (output ? '\n' : '') + result.exception;
    if (!output.trim()) output = '(no output)';

    var meta = '';
    if (result.compilationTime) meta += 'compile: ' + result.compilationTime + 'ms  ';
    if (result.executionTime) meta += 'exec: ' + result.executionTime + 'ms  ';
    if (result.memoryUsed) meta += 'mem: ' + Math.round(result.memoryUsed / 1024) + 'KB';

    outputPane.innerHTML = '\
      <div class="oc-output-header">\
        <span class="oc-output-lang">' + language + '</span>\
        <span class="oc-output-meta">' + (meta || elapsed + 'ms') + '</span>\
        <div class="oc-output-actions">\
          <button class="oc-output-btn" id="oc-copy" title="Copy output">Copy</button>\
          <button class="oc-output-btn" id="oc-clear" title="Clear output">Clear</button>\
        </div>\
      </div>\
      <div class="oc-output-body"></div>\
    ';

    var bodyEl = outputPane.querySelector('.oc-output-body');
    var span = document.createElement('span');
    span.className = hasError ? 'oc-error' : 'oc-success';
    span.textContent = output;
    bodyEl.appendChild(span);

    outputPane.querySelector('#oc-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(output).then(function () {
        bus.emit('toast:show', { message: 'Output copied', type: 'ok' });
      });
    });

    outputPane.querySelector('#oc-clear').addEventListener('click', function () {
      outputPane.innerHTML = '<div class="empty-state" style="color:var(--text-dim);font-size:11px;">Run code to see output here (Ctrl+Alt+R)</div>';
    });

    switchToOutputTab();
  }

  // ── Main run function ──
  async function executeCurrentFile(useSelection) {
    if (isRunning) {
      bus.emit('toast:show', { message: 'Already running...', type: 'warn' });
      return;
    }

    var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
    var filePath = PiPilot.editor.getActiveFile();
    if (!ace || !filePath) {
      bus.emit('toast:show', { message: 'No file open', type: 'warn' });
      return;
    }

    var language = detectLanguage(filePath);
    if (!language) {
      bus.emit('toast:show', { message: 'Unsupported language for online compilation', type: 'error' });
      return;
    }

    var code = useSelection && ace.getSelectedText() ? ace.getSelectedText() : ace.getValue();
    if (!code.trim()) {
      bus.emit('toast:show', { message: 'No code to run', type: 'warn' });
      return;
    }

    isRunning = true;
    statusBtn.textContent = '⏳ Running...';
    statusBtn.style.color = 'var(--info)';

    var startTime = Date.now();
    try {
      var result = await runCode(code, language, '');
      var elapsed = Date.now() - startTime;
      showOutput(language, result, elapsed);

      // Track usage
      if (db) {
        var count = await db.get('runCount') || 0;
        await db.set('runCount', count + 1);
      }
    } catch (err) {
      bus.emit('toast:show', { message: err.message, type: 'error' });
      showOutput(language, { stderr: err.message }, Date.now() - startTime);
    } finally {
      isRunning = false;
      statusBtn.textContent = '▶ Compile';
      statusBtn.style.color = 'var(--ok)';
    }
  }

  // ── Status bar button ──
  var statusBar = document.querySelector('.status-right');
  var statusBtn = document.createElement('span');
  statusBtn.className = 'status-item status-item-btn';
  statusBtn.textContent = '▶ Compile';
  statusBtn.style.color = 'var(--ok)';
  statusBtn.title = 'Run code online (Ctrl+Alt+R)';
  statusBtn.addEventListener('click', function () { executeCurrentFile(false); });
  if (statusBar) statusBar.insertBefore(statusBtn, statusBar.firstChild);

  // ── Keyboard shortcuts ──
  if (PiPilot.shortcuts) {
    PiPilot.shortcuts.register('ctrl+alt+r', function () { executeCurrentFile(false); });
  }

  // ── Context menu ──
  var editorHost = document.getElementById('monaco-host');
  if (editorHost) {
    editorHost.addEventListener('contextmenu', function (e) {
      var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
      var hasSelection = ace && ace.getSelectedText();
      var items = [
        { label: '▶ Compile & Run', onClick: function () { executeCurrentFile(false); } },
      ];
      if (hasSelection) {
        items.push({ label: '▶ Run Selection', onClick: function () { executeCurrentFile(true); } });
      }
      items.push({ type: 'separator' });
      items.push({
        label: '⚙ Set API Key', onClick: async function () {
          var key = await PiPilot.modal.prompt({
            title: 'OneCompiler API Key',
            label: 'Enter your API key (get one at allthingsdev.co)',
            placeholder: 'Your API key...',
          });
          if (key && key.trim()) {
            await saveApiKey(key.trim());
            bus.emit('toast:show', { message: 'API key saved', type: 'ok' });
          }
        }
      });
      // Append to existing context menu items if possible
      setTimeout(function () {
        bus.emit('contextmenu:show', { x: e.clientX, y: e.clientY, items: items });
      }, 10);
    });
  }

  // ── Track usage ──
  if (db) {
    db.get('runCount').then(function (count) {
      if (count && count >= 45 && !cachedApiKey) {
        bus.emit('toast:show', {
          message: 'You have ' + (50 - count) + ' free compilations left. Get your own API key at allthingsdev.co',
          type: 'warn'
        });
      }
    });
  }

  console.log('[ext:online-compiler] Online Compiler extension loaded (OneCompiler API)');

})(PiPilot, bus, api, state, db);
