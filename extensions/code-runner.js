// PiPilot IDE Extension: Code Runner
// ctrl+alt+n: Run current file (or selection) in terminal
// ctrl+alt+m: Stop the running process

(function (PiPilot, bus, api, state, db) {
  var TAG = '[ext:code-runner]';

  // ── Default executor map ──────────────────────────────────────────
  var DEFAULT_EXECUTORS = {
    'javascript': 'node $fullFileName',
    'mjs':        'node $fullFileName',
    'cjs':        'node $fullFileName',
    'typescript': 'npx tsx $fullFileName',
    'ts':         'npx tsx $fullFileName',
    'python':     'python $fullFileName',
    'py':         'python $fullFileName',
    'go':         'go run $fullFileName',
    'rust':       'cargo run',
    'rs':         'cargo run',
    'java':       'javac $fileName && java $fileNameWithoutExt',
    'c':          'gcc $fileName -o $fileNameWithoutExt && ./$fileNameWithoutExt',
    'cpp':        'g++ $fileName -o $fileNameWithoutExt && ./$fileNameWithoutExt',
    'ruby':       'ruby $fullFileName',
    'rb':         'ruby $fullFileName',
    'php':        'php $fullFileName',
    'bash':       'bash $fullFileName',
    'sh':         'bash $fullFileName',
    'powershell': 'powershell -File $fullFileName',
    'ps1':        'powershell -File $fullFileName',
    'lua':        'lua $fullFileName',
    'perl':       'perl $fullFileName',
    'pl':         'perl $fullFileName',
    'dart':       'dart run $fullFileName',
    'kotlin':     'kotlinc $fileName -include-runtime -d $fileNameWithoutExt.jar && java -jar $fileNameWithoutExt.jar',
    'kt':         'kotlinc $fileName -include-runtime -d $fileNameWithoutExt.jar && java -jar $fileNameWithoutExt.jar',
    'swift':      'swift $fullFileName',
    'r':          'Rscript $fullFileName'
  };

  // ── State ─────────────────────────────────────────────────────────
  var runnerTerminalId = null;
  var isRunning = false;
  var customExecutors = {};
  var statusBtn = null;
  var exitCleanup = null;

  // ── Load custom executors from db ─────────────────────────────────
  function loadCustomExecutors() {
    if (!db || !db.get) return;
    db.get('customExecutors').then(function (val) {
      if (val && typeof val === 'object') {
        customExecutors = val;
        console.log(TAG, 'Loaded custom executors:', Object.keys(customExecutors));
      }
    }).catch(function () {});
  }
  loadCustomExecutors();

  // ── Helpers ───────────────────────────────────────────────────────

  function getExtension(filePath) {
    if (!filePath) return null;
    var parts = filePath.replace(/\\/g, '/').split('/');
    var name = parts[parts.length - 1] || '';
    var dotIdx = name.lastIndexOf('.');
    if (dotIdx <= 0) return null;
    return name.substring(dotIdx + 1).toLowerCase();
  }

  function getFileName(filePath) {
    if (!filePath) return '';
    var parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  }

  function getFileNameWithoutExt(filePath) {
    var name = getFileName(filePath);
    var dotIdx = name.lastIndexOf('.');
    if (dotIdx <= 0) return name;
    return name.substring(0, dotIdx);
  }

  function getDirPath(filePath) {
    if (!filePath) return '';
    var normalized = filePath.replace(/\\/g, '/');
    var lastSlash = normalized.lastIndexOf('/');
    if (lastSlash < 0) return '.';
    return normalized.substring(0, lastSlash);
  }

  function substituteVars(cmd, filePath) {
    var dir = getDirPath(filePath);
    var fileName = getFileName(filePath);
    var fileNameNoExt = getFileNameWithoutExt(filePath);
    var fullPath = filePath.replace(/\\/g, '/');
    var root = (state && state.projectPath) ? state.projectPath.replace(/\\/g, '/') : dir;

    return cmd
      .replace(/\$dir/g, dir)
      .replace(/\$fullFileName/g, fullPath)
      .replace(/\$fileNameWithoutExt/g, fileNameNoExt)
      .replace(/\$fileName/g, fileName)
      .replace(/\$workspaceRoot/g, root);
  }

  function getExecutor(ext) {
    if (!ext) return null;
    // Custom executors take priority
    if (customExecutors[ext]) return customExecutors[ext];
    if (DEFAULT_EXECUTORS[ext]) return DEFAULT_EXECUTORS[ext];
    return null;
  }

  // ── UI: Status bar button ─────────────────────────────────────────
  function createStatusButton() {
    var statusBar = document.querySelector('.status-right');
    if (!statusBar) return;

    statusBtn = document.createElement('span');
    statusBtn.className = 'status-item status-item-btn';
    statusBtn.style.cursor = 'pointer';
    statusBtn.style.display = 'inline-flex';
    statusBtn.style.alignItems = 'center';
    statusBtn.style.gap = '4px';
    updateStatusButton();
    statusBtn.addEventListener('click', function () {
      if (isRunning) {
        stopRunning();
      } else {
        runFile();
      }
    });
    statusBar.insertBefore(statusBtn, statusBar.firstChild);
  }

  function updateStatusButton() {
    if (!statusBtn) return;
    if (isRunning) {
      statusBtn.innerHTML = '<span style="color:var(--error);">&#9632;</span> Stop';
      statusBtn.title = 'Stop running (Ctrl+Alt+M)';
    } else {
      statusBtn.innerHTML = '<span style="color:var(--ok);">&#9654;</span> Run';
      statusBtn.title = 'Run file (Ctrl+Alt+N)';
    }
  }

  // ── Core: Save before run ─────────────────────────────────────────
  function autoSave(filePath) {
    if (!PiPilot || !PiPilot.editor) return;
    var dirtyFiles = PiPilot.editor.getDirtyFiles ? PiPilot.editor.getDirtyFiles() : [];
    if (!dirtyFiles || !dirtyFiles.length) return;

    var isDirty = false;
    for (var i = 0; i < dirtyFiles.length; i++) {
      if (dirtyFiles[i] === filePath) {
        isDirty = true;
        break;
      }
    }
    if (isDirty && PiPilot.editor.saveFile) {
      PiPilot.editor.saveFile(filePath);
    }
  }

  // ── Core: Destroy existing runner terminal ────────────────────────
  function destroyRunnerTerminal() {
    if (runnerTerminalId && api && api.terminal && api.terminal.destroy) {
      try { api.terminal.destroy(runnerTerminalId); } catch (e) {}
    }
    if (exitCleanup) {
      try { exitCleanup(); } catch (e) {}
      exitCleanup = null;
    }
    runnerTerminalId = null;
    isRunning = false;
    updateStatusButton();
  }

  // ── Core: Stop running ────────────────────────────────────────────
  function stopRunning() {
    if (!isRunning && !runnerTerminalId) {
      bus.emit('toast:show', { message: 'No running process to stop', type: 'warn' });
      return;
    }
    // Send Ctrl+C first to interrupt, then destroy
    if (runnerTerminalId && api && api.terminal && api.terminal.write) {
      try { api.terminal.write(runnerTerminalId, '\x03'); } catch (e) {}
    }
    // Small delay then destroy the terminal
    setTimeout(function () {
      destroyRunnerTerminal();
      bus.emit('toast:show', { message: 'Process stopped', type: 'info' });
    }, 200);
  }

  // ── Core: Run command in terminal ─────────────────────────────────
  function executeInTerminal(cmd, cwd, label) {
    if (!api || !api.terminal || !api.terminal.create) {
      bus.emit('toast:show', { message: 'Terminal API not available', type: 'error' });
      return;
    }

    // Destroy previous runner terminal if exists
    destroyRunnerTerminal();

    isRunning = true;
    updateStatusButton();

    api.terminal.create({ cwd: cwd, name: 'Code Runner' }).then(function (term) {
      if (!term || !term.id) {
        bus.emit('toast:show', { message: 'Failed to create terminal', type: 'error' });
        isRunning = false;
        updateStatusButton();
        return;
      }

      runnerTerminalId = term.id;

      // Show the terminal panel
      bus.emit('bottom:show', 'terminal');

      // Listen for exit to update state
      if (api.terminal.onExit) {
        exitCleanup = api.terminal.onExit(term.id, function () {
          isRunning = false;
          updateStatusButton();
          exitCleanup = null;
        });
      }

      // Write the command
      var fullCmd = cmd + '\n';
      api.terminal.write(term.id, fullCmd);

      bus.emit('toast:show', { message: 'Running: ' + (label || cmd), type: 'ok' });
    }).catch(function (err) {
      console.error(TAG, 'Failed to create runner terminal:', err);
      bus.emit('toast:show', { message: 'Failed to start: ' + (err && err.message || err), type: 'error' });
      isRunning = false;
      updateStatusButton();
    });
  }

  // ── Core: Run file ────────────────────────────────────────────────
  function runFile() {
    if (!PiPilot || !PiPilot.editor) {
      bus.emit('toast:show', { message: 'Editor not available', type: 'error' });
      return;
    }

    var filePath = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    if (!filePath) {
      bus.emit('toast:show', { message: 'No active file to run', type: 'warn' });
      return;
    }

    var ext = getExtension(filePath);
    if (!ext) {
      bus.emit('toast:show', { message: 'Cannot determine file type', type: 'warn' });
      return;
    }

    var executor = getExecutor(ext);
    if (!executor) {
      bus.emit('toast:show', { message: 'No executor configured for .' + ext + ' files', type: 'warn' });
      return;
    }

    // Auto-save before running
    autoSave(filePath);

    var dir = getDirPath(filePath);
    var cmd = substituteVars(executor, filePath);
    var label = getFileName(filePath);

    executeInTerminal(cmd, dir, label);
  }

  // ── Core: Run selection ───────────────────────────────────────────
  function runSelection() {
    if (!PiPilot || !PiPilot.editor) {
      bus.emit('toast:show', { message: 'Editor not available', type: 'error' });
      return;
    }

    var ace = PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
    if (!ace) {
      bus.emit('toast:show', { message: 'Editor not available', type: 'error' });
      return;
    }

    var selectedText = ace.getSelectedText();
    if (!selectedText || !selectedText.trim()) {
      bus.emit('toast:show', { message: 'No text selected to run', type: 'warn' });
      return;
    }

    var filePath = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
    var ext = filePath ? getExtension(filePath) : null;
    if (!ext) {
      bus.emit('toast:show', { message: 'Cannot determine language for selection', type: 'warn' });
      return;
    }

    // Only support interpreted languages for selection run
    var selectionExecutors = {
      'javascript': 'node', 'mjs': 'node', 'cjs': 'node',
      'typescript': 'npx tsx', 'ts': 'npx tsx',
      'python': 'python', 'py': 'python',
      'ruby': 'ruby', 'rb': 'ruby',
      'php': 'php',
      'bash': 'bash', 'sh': 'bash',
      'powershell': 'powershell -Command',
      'ps1': 'powershell -Command',
      'lua': 'lua', 'perl': 'perl', 'pl': 'perl',
      'r': 'Rscript', 'swift': 'swift',
      'dart': 'dart run'
    };

    var selExec = selectionExecutors[ext];
    if (!selExec) {
      bus.emit('toast:show', { message: 'Run Selection not supported for .' + ext + ' (compiled language)', type: 'warn' });
      return;
    }

    // Write selection to a temp file and run it
    var dir = filePath ? getDirPath(filePath) : ((state && state.projectPath) || '.');
    var tempName = '_pipilot_runner_tmp.' + ext;
    var tempPath = dir + '/' + tempName;

    if (!api || !api.files || !api.files.write) {
      bus.emit('toast:show', { message: 'File API not available', type: 'error' });
      return;
    }

    api.files.write(tempPath, selectedText).then(function () {
      // Build the run command and append cleanup
      var runCmd = selExec + ' ' + tempName;
      // Platform-aware cleanup: delete temp file after execution
      var cleanupCmd = 'rm -f ' + tempName + ' 2>/dev/null; del ' + tempName + ' 2>nul';
      var fullCmd = runCmd + ' ; ' + cleanupCmd;

      executeInTerminal(fullCmd, dir, 'Selection (' + ext + ')');
    }).catch(function (err) {
      bus.emit('toast:show', { message: 'Failed to write temp file: ' + (err && err.message || err), type: 'error' });
    });
  }

  // ── Shortcuts ─────────────────────────────────────────────────────
  if (PiPilot && PiPilot.shortcuts && PiPilot.shortcuts.register) {
    // Ctrl+Alt+N: Run file (or selection if text is selected)
    PiPilot.shortcuts.register('ctrl+alt+n', function () {
      var ace = PiPilot.editor ? PiPilot.editor.getAce() : null;
      var hasSelection = ace && ace.getSelectedText && ace.getSelectedText().trim();
      if (hasSelection) {
        runSelection();
      } else {
        runFile();
      }
    });

    // Ctrl+Alt+M: Stop running
    PiPilot.shortcuts.register('ctrl+alt+m', function () {
      stopRunning();
    });
  }

  // ── Context menu ──────────────────────────────────────────────────
  function hookContextMenu() {
    var editorEl = document.getElementById('monaco-host') || document.getElementById('editor-container');
    if (!editorEl) return;

    editorEl.addEventListener('contextmenu', function (e) {
      // Only add items if the click is within the editor area
      // We'll use a brief timeout to let the default context menu fire,
      // then show ours. Actually we intercept and build custom items.

      // Check if we're in the editor
      var target = e.target;
      var inEditor = false;
      var node = target;
      while (node) {
        if (node.id === 'monaco-host' || node.id === 'editor-container' || (node.classList && node.classList.contains('ace_editor'))) {
          inEditor = true;
          break;
        }
        node = node.parentElement;
      }
      if (!inEditor) return;

      e.preventDefault();
      e.stopPropagation();

      var ace = PiPilot.editor ? PiPilot.editor.getAce() : null;
      var hasSelection = ace && ace.getSelectedText && ace.getSelectedText().trim();

      var items = [
        {
          label: '\u25B6 Run File',
          onClick: function () { runFile(); }
        }
      ];

      if (hasSelection) {
        items.push({
          label: '\u25B6 Run Selection',
          onClick: function () { runSelection(); }
        });
      }

      items.push({
        label: '\u25A0 Stop Running',
        disabled: !isRunning,
        onClick: function () { stopRunning(); }
      });

      items.push({ type: 'separator' });

      items.push({
        label: '\u2699 Configure Executor...',
        onClick: function () { configureExecutor(); }
      });

      bus.emit('contextmenu:show', {
        x: e.clientX,
        y: e.clientY,
        items: items
      });
    });
  }

  // ── Configure executor ────────────────────────────────────────────
  function configureExecutor() {
    if (!PiPilot || !PiPilot.modal || !PiPilot.modal.prompt) {
      bus.emit('toast:show', { message: 'Modal API not available', type: 'error' });
      return;
    }

    var filePath = PiPilot.editor ? PiPilot.editor.getActiveFile() : null;
    var ext = filePath ? getExtension(filePath) : '';
    var currentCmd = ext ? getExecutor(ext) : '';

    PiPilot.modal.prompt({
      title: 'Configure Code Runner Executor',
      label: 'File extension (e.g. py, js, go):',
      placeholder: 'py',
      defaultValue: ext || ''
    }).then(function (inputExt) {
      if (!inputExt) return;
      inputExt = inputExt.trim().replace(/^\./, '').toLowerCase();

      var existingCmd = getExecutor(inputExt) || '';

      PiPilot.modal.prompt({
        title: 'Executor Command for .' + inputExt,
        label: 'Command (use $fileName, $fullFileName, $dir, $fileNameWithoutExt, $workspaceRoot):',
        placeholder: 'python $fullFileName',
        defaultValue: existingCmd
      }).then(function (cmd) {
        if (!cmd) return;
        cmd = cmd.trim();
        if (!cmd) return;

        customExecutors[inputExt] = cmd;

        if (db && db.set) {
          db.set('customExecutors', customExecutors).then(function () {
            bus.emit('toast:show', { message: 'Executor for .' + inputExt + ' saved: ' + cmd, type: 'ok' });
          }).catch(function () {
            bus.emit('toast:show', { message: 'Executor set (not persisted)', type: 'warn' });
          });
        } else {
          bus.emit('toast:show', { message: 'Executor for .' + inputExt + ' set: ' + cmd, type: 'ok' });
        }
      });
    });
  }

  // ── Initialize ────────────────────────────────────────────────────
  createStatusButton();
  hookContextMenu();

  console.log(TAG, 'loaded');
})(PiPilot, bus, api, state, db);
