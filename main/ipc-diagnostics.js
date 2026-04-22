// PiPilot IDE — Diagnostics IPC
// Uses the TypeScript Compiler API directly.
// Runs on-demand (not on a file watcher) to avoid performance issues.

const path = require('path');
const fs = require('fs');

const isWindows = process.platform === 'win32';

// ── Load TypeScript from project or bundled ──
function loadTypeScript(workDir) {
  try {
    const local = path.join(workDir, 'node_modules', 'typescript');
    if (fs.existsSync(local)) return require(local);
  } catch {}
  try { return require('typescript'); } catch {}
  return null;
}

// ── Run TypeScript diagnostics via Compiler API ──
async function runTypeScriptAPI(workDir) {
  const hasTsConfig = fs.existsSync(path.join(workDir, 'tsconfig.json'));
  const hasJsConfig = fs.existsSync(path.join(workDir, 'jsconfig.json'));
  if (!hasTsConfig && !hasJsConfig) return [];

  const ts = loadTypeScript(workDir);
  if (!ts) return [];

  const configFile = hasTsConfig ? 'tsconfig.json' : 'jsconfig.json';
  const configPath = path.join(workDir, configFile);

  const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configRead.error) return [];

  const parsed = ts.parseJsonConfigFileContent(configRead.config, ts.sys, workDir, {}, configPath);
  if (parsed.errors.length > 0) return [];

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const allDiags = ts.getPreEmitDiagnostics(program);

  return allDiags.map(d => {
    let severity = 'error';
    if (d.category === ts.DiagnosticCategory.Warning) severity = 'warning';
    else if (d.category === ts.DiagnosticCategory.Suggestion || d.category === ts.DiagnosticCategory.Message) severity = 'info';

    let line = 1, col = 1, filePath = '';
    if (d.file && d.start !== undefined) {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      line = pos.line + 1;
      col = pos.character + 1;
      filePath = d.file.fileName;
      if (path.isAbsolute(filePath)) filePath = path.relative(workDir, filePath).replace(/\\/g, '/');
      if (filePath.includes('node_modules/')) return null;
    } else {
      return null;
    }

    return {
      file: filePath, path: path.join(workDir, filePath),
      line, col, severity,
      code: `TS${d.code}`,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      source: 'typescript',
    };
  }).filter(Boolean);
}

module.exports = function registerDiagnosticsHandlers(ipcMain, ctx) {
  let lastProjectPath = null;
  let running = false;

  ipcMain.handle('diagnostics:stop', async (event) => {
    lastProjectPath = null;
    try {
      event.sender.send('diagnostics:updated', {
        ok: true, projectPath: '', items: [],
        counts: { errors: 0, warnings: 0, total: 0 }, byFile: {},
      });
    } catch {}
    return { ok: true };
  });

  ipcMain.handle('diagnostics:start', async (event, { projectPath }) => {
    if (!projectPath) return { ok: false, error: 'Missing projectPath' };
    lastProjectPath = projectPath;

    // Run once on start — no watcher, no polling
    // Further runs triggered by renderer on file save via diagnostics:run
    runDiagnosticsFor(event, projectPath);
    return { ok: true };
  });

  // On-demand run (called by renderer after file save)
  ipcMain.handle('diagnostics:run', async (event, { projectPath }) => {
    if (!projectPath) return { ok: false };
    runDiagnosticsFor(event, projectPath);
    return { ok: true };
  });

  async function runDiagnosticsFor(event, projectPath) {
    if (running) return;
    running = true;
    try {
      const items = await runTypeScriptAPI(projectPath).catch(() => []);
      const byFile = {};
      let errors = 0, warnings = 0;

      for (const it of items) {
        const p = it.path || it.file;
        if (!byFile[p]) byFile[p] = [];
        byFile[p].push(it);
        if (it.severity === 'error') errors++;
        else if (it.severity === 'warning') warnings++;
      }

      for (const p of Object.keys(byFile)) {
        byFile[p].sort((a, b) => (a.line - b.line) || (a.col - b.col));
      }

      try {
        event.sender.send('diagnostics:updated', {
          ok: true, projectPath, items,
          counts: { errors, warnings, total: items.length },
          byFile,
        });
      } catch {}
    } catch (err) {
      try {
        event.sender.send('diagnostics:updated', {
          ok: false, projectPath, error: err.message,
          items: [], counts: { errors: 0, warnings: 0, total: 0 }, byFile: {},
        });
      } catch {}
    } finally {
      running = false;
    }
  }

  ipcMain.on('renderer:closed', () => { lastProjectPath = null; });
};
