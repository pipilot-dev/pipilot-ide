// End-to-end terminal verification INSIDE Electron's main process.
// Spawns a PTY via the real ipc-terminal handler, writes a command,
// asserts that real shell output comes back, then exits with result.

require('dotenv').config();
const { app, BrowserWindow } = require('electron');
const path = require('path');

const results = { kind: null, output: '', pid: null, exitCode: null, errors: [] };

function makeMockIpc() {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const invoke = async (ch, payload) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error('no handler: ' + ch);
    return await fn({ sender: fakeSender }, payload);
  };
  return { ipcMain, invoke };
}

let fakeSender;

app.whenReady().then(async () => {
  // Hidden window — needed for ctx.getWindow() calls inside handlers
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });

  fakeSender = {
    isDestroyed: () => false,
    send: (ch, data) => {
      if (ch.startsWith('terminal:data:')) results.output += data;
      if (ch.startsWith('terminal:exit:')) results.exitCode = data;
    },
  };

  const { ipcMain, invoke } = makeMockIpc();
  const ctx = { getWindow: () => win, userDataPath: app.getPath('userData') };

  try {
    require('../main/ipc-terminal')(ipcMain, ctx);

    const created = await invoke('terminal:create', { cwd: process.cwd(), cols: 80, rows: 24 });
    results.kind = created.kind;
    results.pid = created.pid;

    // Wait for shell prompt to settle
    await new Promise(r => setTimeout(r, 400));

    // Send a command that produces recognizable output
    await invoke('terminal:write', { id: created.id, data: 'echo PIPILOT_TERMINAL_OK\r' });
    await new Promise(r => setTimeout(r, 600));

    // Test resize
    await invoke('terminal:resize', { id: created.id, cols: 120, rows: 40 });

    await invoke('terminal:destroy', created.id);
    await new Promise(r => setTimeout(r, 200));
  } catch (e) {
    results.errors.push(e.message);
  }

  // Report and exit
  console.log('\n===== ELECTRON TERMINAL VERIFICATION =====');
  console.log('kind:       ', results.kind, results.kind === 'pty' ? '✓ native node-pty' : '✗ FALLBACK (stub)');
  console.log('pid:        ', results.pid);
  console.log('output len: ', results.output.length, 'bytes');
  console.log('output has "PIPILOT_TERMINAL_OK":', results.output.includes('PIPILOT_TERMINAL_OK') ? '✓' : '✗');
  console.log('exit code:  ', results.exitCode);
  console.log('errors:     ', results.errors.length ? results.errors : 'none');
  console.log('==========================================\n');

  const pass = results.kind === 'pty' && results.output.includes('PIPILOT_TERMINAL_OK') && !results.errors.length;
  app.exit(pass ? 0 : 1);
}).catch(err => {
  console.error('FATAL:', err);
  app.exit(2);
});
