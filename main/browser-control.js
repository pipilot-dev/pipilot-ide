// PiPilot IDE — Main↔Renderer bridge for AI browser control.
//
// MCP tools call browserExec('click', {selector:'#x'}) — we send a request
// to the renderer over IPC, the renderer runs it on the matching browser
// tab's <webview> and posts a response. We resolve the awaiting Promise.

// Module-level singleton so MCP tools (ide-tools-mcp.js) can lazy-require
// us without ctx threading. `register` is called once at app startup.
let _browserExec = () => Promise.reject(new Error('browser control not initialized'));

function browserExec(op, args, timeoutMs) {
  return _browserExec(op, args, timeoutMs);
}

function register(ipcMain, ctx) {
  const pending = new Map(); // id → { resolve, reject, timer }
  let seq = 0;

  ipcMain.on('browser:control:response', (_e, payload) => {
    const { id, ok, result, error } = payload || {};
    const r = pending.get(id);
    if (!r) return;
    pending.delete(id);
    clearTimeout(r.timer);
    if (ok) r.resolve(result);
    else r.reject(new Error(error || 'browser control failed'));
  });

  _browserExec = (op, args = {}, timeoutMs = 30000) => {
    return new Promise((resolve, reject) => {
      const win = ctx.getWindow && ctx.getWindow();
      if (!win || win.isDestroyed()) return reject(new Error('No window available'));
      const id = ++seq;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Browser control timed out: ' + op));
        }
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      win.webContents.send('browser:control:request', { id, op, args });
    });
  };

  return { browserExec };
}

module.exports = register;
module.exports.browserExec = browserExec;
