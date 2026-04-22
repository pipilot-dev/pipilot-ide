// PiPilot IDE Extension: Online Code Compiler
// Powered by OneCompiler API — compile & run 60+ languages online.
// Free 50 executions with built-in key, then users get their own at:
// https://www.allthingsdev.co/apimarketplace/endpoints/onecompiler-apis/665c76be98e9e140d6530c20

(function (PiPilot, bus, api, state, db) {

  var DEFAULT_API_KEY = 'Mkv8n2ggXBuRSIyBCeqGPS43F55PHHrXax3qRrIGIKl4EoBLtW';
  var API_URL = 'https://onecompiler-apis.p.allthingsdev.co/api/v1/run';

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
        'x-atd-key': apiKey,
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
.oc-output-panel { background: var(--surface); border-top: 1px solid var(--border); font-family: var(--font-mono); font-size: 12px; max-height: 300px; overflow: auto; }\
.oc-output-header { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--surface-alt); }\
.oc-output-title { font-size: 10px; font-weight: 600; color: var(--text-mid); text-transform: uppercase; letter-spacing: 0.05em; }\
.oc-output-lang { font-size: 9px; color: var(--accent); background: rgba(255,107,53,0.1); padding: 1px 6px; border-radius: 3px; }\
.oc-output-time { font-size: 9px; color: var(--text-dim); margin-left: auto; }\
.oc-output-close { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 0 4px; }\
.oc-output-close:hover { color: var(--text); }\
.oc-output-body { padding: 8px 10px; white-space: pre-wrap; color: var(--text); line-height: 1.5; }\
.oc-output-body.error { color: var(--error); }\
.oc-output-body.success { color: var(--ok); }\
.oc-stdin-row { display: flex; gap: 4px; padding: 4px 10px; border-bottom: 1px solid var(--border); align-items: center; }\
.oc-stdin-input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 3px; padding: 3px 6px; color: var(--text); font-family: var(--font-mono); font-size: 11px; outline: none; }\
.oc-stdin-input:focus { border-color: var(--accent); }\
';
  document.head.appendChild(style);

  // ── Output panel (reusable) ──
  var outputPanel = null;

  function showOutput(language, result, elapsed) {
    if (outputPanel) outputPanel.remove();

    outputPanel = document.createElement('div');
    outputPanel.className = 'oc-output-panel';

    var hasError = result.stderr && result.stderr.trim();
    var output = '';
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? '\n' : '') + result.stderr;
    if (result.exception) output += (output ? '\n' : '') + result.exception;
    if (!output.trim()) output = '(no output)';

    outputPanel.innerHTML = '\
      <div class="oc-output-header">\
        <span class="oc-output-title">Output</span>\
        <span class="oc-output-lang">' + language + '</span>\
        <span class="oc-output-time">' + elapsed + 'ms</span>\
        <button class="oc-output-close" title="Close">&times;</button>\
      </div>\
      <div class="oc-output-body ' + (hasError ? 'error' : 'success') + '"></div>\
    ';

    outputPanel.querySelector('.oc-output-body').textContent = output;
    outputPanel.querySelector('.oc-output-close').addEventListener('click', function () {
      outputPanel.remove();
      outputPanel = null;
    });

    // Insert above the bottom panel or at the bottom of main area
    var mainArea = document.getElementById('main-area');
    var bottomPanel = mainArea && mainArea.querySelector('.bottom-panel');
    if (bottomPanel) {
      mainArea.insertBefore(outputPanel, bottomPanel);
    } else if (mainArea) {
      mainArea.appendChild(outputPanel);
    } else {
      document.body.appendChild(outputPanel);
    }
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
