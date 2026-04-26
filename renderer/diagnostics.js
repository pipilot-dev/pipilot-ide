(() => {
  const api = window.electronAPI;
  const { bus, state } = window.PiPilot;

  let removeListener = null;
  let running = false;
  let tscAvailable = false;
  let previousDiagFiles = new Set(); // tracks files that had diagnostics last run

  function onDiagnosticsUpdated(payload) {
    if (!payload || payload.ok === false) {
      tscAvailable = false;
      return;
    }

    tscAvailable = true;
    const byFile = payload.byFile || {};
    const items = payload.items || [];
    const counts = payload.counts || { errors: 0, warnings: 0, total: 0 };
    const currentFiles = new Set(Object.keys(byFile));

    // Clear diagnostics for files that had errors before but are now clean
    for (const oldPath of previousDiagFiles) {
      if (!currentFiles.has(oldPath)) {
        bus.emit('diagnostics:set', { path: oldPath, diagnostics: [] });
      }
    }
    previousDiagFiles = currentFiles;

    for (const [path, diagnostics] of Object.entries(byFile)) {
      bus.emit('diagnostics:set', {
        path,
        diagnostics: (diagnostics || []).map((d) => ({
          line: d.line,
          startCol: Math.max(0, (d.col || 1) - 1),
          endCol: Math.max(0, (d.col || 1)),
          severity: d.severity === 'warning' ? 2 : 1,
          message: d.message,
          code: d.code,
          source: d.source,
        })),
      });
    }

    bus.emit('problems:updated', { items, counts, byFile, error: null });
    bus.emit('problems:count', counts);
  }

  // Lightweight: lint ONLY the file that was just saved (no tree walk, no bulk read)
  function lintOpenFile(filePath, content) {
    if (!filePath || !content || tscAvailable) return;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) return;

    const diags = lintFile(filePath, content);
    if (diags.length) {
      bus.emit('diagnostics:set', {
        path: filePath,
        diagnostics: diags.map((d) => ({
          line: d.line,
          startCol: Math.max(0, (d.col || 1) - 1),
          endCol: d.endCol || Math.max(0, (d.col || 1)),
          severity: d.severity === 'warning' ? 2 : 1,
          message: d.message,
          code: d.code,
          source: d.source,
        })),
      });

      let errors = 0, warnings = 0;
      for (const d of diags) {
        if (d.severity === 'error') errors++;
        else warnings++;
      }
      bus.emit('problems:updated', {
        items: diags,
        counts: { errors, warnings, total: diags.length },
        byFile: { [filePath]: diags },
        error: null,
      });
      bus.emit('problems:count', { errors, warnings, total: diags.length });
    }
  }

  function lintFile(filePath, content) {
    const lines = content.split('\n');
    const diags = [];

    for (let row = 0; row < lines.length; row++) {
      const line = lines[row];
      const lineNum = row + 1;

      const varMatch = line.match(/\bvar\s+\w+/);
      if (varMatch) {
        const col = line.indexOf('var') + 1;
        diags.push({ path: filePath, file: filePath, line: lineNum, col, endCol: col + 3,
          severity: 'warning', source: 'lint', code: 'no-var', message: 'Unexpected var, use let or const instead.' });
      }

      const eqMatch = line.match(/[^=!]==[^=]/);
      if (eqMatch) {
        const col = line.indexOf('==', eqMatch.index) + 1;
        diags.push({ path: filePath, file: filePath, line: lineNum, col, endCol: col + 2,
          severity: 'warning', source: 'lint', code: 'eqeqeq', message: "Expected '===' and instead saw '=='." });
      }

      const todoMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i);
      if (todoMatch) {
        const col = line.indexOf(todoMatch[0]) + 1;
        diags.push({ path: filePath, file: filePath, line: lineNum, col, endCol: col + todoMatch[0].length,
          severity: 'info', source: 'lint', code: todoMatch[1].toLowerCase(), message: line.slice(line.indexOf(todoMatch[0])).trim() });
      }
    }
    return diags;
  }

  async function start(projectPath) {
    if (!projectPath || running) return;

    if (!removeListener) {
      removeListener = api.diagnostics?.onUpdate?.(onDiagnosticsUpdated) || null;
    }

    running = true;
    // We deliberately DO NOT call api.diagnostics.start(projectPath)
    // here any more — that immediately spawns a TypeScript compiler
    // pass over the whole project, which can pin the main process
    // CPU for 10-30s on large repos and makes the IDE feel frozen
    // on launch. Diagnostics now only run on demand:
    //   - when the user saves a file (file:saved bus event)
    //   - when the agent edits a file (file:external-change event)
    //   - when the user clicks the manual refresh button in the
    //     Problems panel
    // No initial scan, no watcher pinning startup. The Problems
    // panel will sit empty until the first edit triggers a run.

    // Debounced server-side tsc recheck (shared by save + external change)
    let diagTimer = null;
    function scheduleDiagnosticsRun() {
      clearTimeout(diagTimer);
      diagTimer = setTimeout(() => {
        if (state.projectPath) api.diagnostics?.run?.(state.projectPath);
      }, 1500);
    }

    // On file save: run lightweight client-side lint + trigger server-side tsc
    bus.on('file:saved', ({ path: filePath }) => {
      if (filePath) {
        const editor = window.PiPilot?.editor;
        if (editor) {
          const session = editor.getSession?.(filePath);
          if (session) lintOpenFile(filePath, session.getValue());
        }
      }
      scheduleDiagnosticsRun();
    });

    // On external file change (agent edits seen via chokidar — only
    // fires when the user has expanded a folder and the watcher is
    // active): re-run diagnostics.
    bus.on('file:external-change', (evt) => {
      if (!evt || (evt.type !== 'change' && evt.type !== 'add' && evt.type !== 'unlink')) return;
      scheduleDiagnosticsRun();
    });

    // Direct agent-edit signal — fires from chat / missions / wiki
    // runners when their stream contains a file-mutating tool call.
    // Reliable even when chokidar isn't watching yet (lazy boot).
    bus.on('agent:file-edit', (payload) => {
      // Only re-check if the edit looks like source — skip lockfiles,
      // tests inside generated dirs, .pipilot artifacts.
      const p = String(payload?.path || '').replace(/\\/g, '/');
      if (!p) { scheduleDiagnosticsRun(); return; }
      if (/\/(node_modules|\.pipilot\/(wikis|sessions|missions))\//.test(p)) return;
      if (/(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(p)) return;
      scheduleDiagnosticsRun();
    });
  }

  async function stop() {
    if (!running) return;
    running = false;
    try { await api.diagnostics?.stop(); } catch {}
    bus.emit('problems:updated', { items: [], counts: { errors: 0, warnings: 0, total: 0 }, byFile: {}, error: null });
    bus.emit('problems:count', { errors: 0, warnings: 0, total: 0 });
  }

  function init() {
    // Delay diagnostics start so file tree loads first (4s stagger)
    bus.on('project:opened', () => {
      setTimeout(() => { if (state.projectPath) start(state.projectPath); }, 4000);
    });
    bus.on('project:closed', stop);
    if (state.projectPath) setTimeout(() => start(state.projectPath), 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
