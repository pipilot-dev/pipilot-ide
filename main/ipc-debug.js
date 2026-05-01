// PiPilot IDE — Node debugger (CDP) handler.
// Spawns `node --inspect-brk=PORT <script>`, connects via WebSocket using the
// Chrome DevTools Protocol, and multiplexes commands/events between the
// renderer and the inspected process.

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

let cachedNodeBinary = null;
function resolveNodeBinary() {
  if (cachedNodeBinary) return cachedNodeBinary;
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  // Search PATH for a real node binary first.
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, exe);
    try { if (fs.existsSync(candidate)) { cachedNodeBinary = candidate; return candidate; } } catch {}
  }
  // Last resort: Electron's binary with ELECTRON_RUN_AS_NODE=1 set by caller.
  cachedNodeBinary = process.execPath;
  return cachedNodeBinary;
}

const sessions = new Map(); // sessionId -> session
let seq = 0;
let nextPort = 9230; // start above the standard 9229

function nextSessionId() { return `dbg-${Date.now()}-${++seq}`; }
function pickPort() { const p = nextPort++; if (nextPort > 9999) nextPort = 9230; return p; }

function fetchJSON(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 2000 }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function discoverWsUrl(port, attempts = 30, delayMs = 100) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const list = await fetchJSON(port, '/json/list');
      const target = Array.isArray(list) ? list.find(t => t.webSocketDebuggerUrl) : null;
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw lastErr || new Error('inspector did not start');
}

function emit(session, type, payload) {
  try {
    const win = session.ctx?.getWindow?.();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('debug:event', { sessionId: session.id, type, payload });
  } catch {}
}

function sendCdp(session, method, params) {
  return new Promise((resolve, reject) => {
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('inspector not connected'));
    }
    const id = ++session.cdpSeq;
    session.pending.set(id, { resolve, reject });
    session.ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => {
      if (session.pending.has(id)) {
        session.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 8000);
  });
}

function attachWs(session, wsUrl) {
  const ws = new WebSocket(wsUrl);
  session.ws = ws;
  session.cdpSeq = 0;
  session.pending = new Map();
  session.scripts = new Map(); // scriptId -> { url, breakpointIds: [] }
  session.fileBreakpoints = session.fileBreakpoints || new Map(); // url -> Set<line>

  ws.on('open', async () => {
    emit(session, 'attached', { wsUrl });
    try {
      await sendCdp(session, 'Runtime.enable');
      await sendCdp(session, 'Debugger.enable');
      await sendCdp(session, 'Runtime.runIfWaitingForDebugger');
    } catch (err) {
      emit(session, 'error', { message: String(err?.message || err) });
    }
  });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.id != null && session.pending.has(msg.id)) {
      const { resolve, reject } = session.pending.get(msg.id);
      session.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      handleCdpEvent(session, msg.method, msg.params || {});
    }
  });

  ws.on('close', () => { emit(session, 'detached', {}); });
  ws.on('error', (err) => { emit(session, 'error', { message: String(err?.message || err) }); });
}

function urlToFilePath(url) {
  if (!url) return null;
  if (url.startsWith('file://')) {
    try {
      let p = decodeURIComponent(url.slice(7));
      if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
      return path.normalize(p);
    } catch { return null; }
  }
  if (path.isAbsolute(url)) return path.normalize(url);
  return null;
}

function filePathToUrl(p) {
  const abs = path.resolve(p);
  if (process.platform === 'win32') {
    return 'file:///' + abs.replace(/\\/g, '/');
  }
  return 'file://' + abs;
}

async function handleCdpEvent(session, method, params) {
  if (method === 'Debugger.scriptParsed') {
    session.scripts.set(params.scriptId, { url: params.url, hash: params.hash });
    const file = urlToFilePath(params.url);
    if (file && session.fileBreakpoints.has(file)) {
      const lines = [...session.fileBreakpoints.get(file)];
      for (const line of lines) {
        try {
          await sendCdp(session, 'Debugger.setBreakpointByUrl', {
            lineNumber: Math.max(0, line - 1),
            url: params.url,
          });
        } catch {}
      }
    }
  } else if (method === 'Debugger.paused') {
    const callFrames = (params.callFrames || []).map((f) => ({
      callFrameId: f.callFrameId,
      functionName: f.functionName || '(anonymous)',
      url: f.url,
      filePath: urlToFilePath(f.url),
      line: (f.location?.lineNumber ?? 0) + 1,
      column: (f.location?.columnNumber ?? 0) + 1,
      scopeChain: (f.scopeChain || []).map((s) => ({
        type: s.type,
        name: s.name,
        objectId: s.object?.objectId,
      })),
      thisObject: f.this ? { objectId: f.this.objectId, type: f.this.type } : null,
    }));
    emit(session, 'paused', { reason: params.reason, callFrames, hitBreakpoints: params.hitBreakpoints || [] });
  } else if (method === 'Debugger.resumed') {
    emit(session, 'resumed', {});
  } else if (method === 'Runtime.consoleAPICalled') {
    const text = (params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type || '')).join(' ');
    emit(session, 'console', { level: params.type || 'log', text });
  } else if (method === 'Runtime.exceptionThrown') {
    const ex = params.exceptionDetails || {};
    emit(session, 'exception', { text: ex.text || 'Exception', message: ex.exception?.description || '' });
  }
}

module.exports = function register(ipcMain, ctx) {
  function ok(d) { return { ok: true, ...(d || {}) }; }
  function fail(e) { return { ok: false, error: e?.message || String(e) }; }

  ipcMain.handle('debug:start', async (_e, opts) => {
    try {
      const { script, cwd, args, env: extraEnv } = opts || {};
      if (!script) throw new Error('script required');
      const port = pickPort();
      const id = nextSessionId();

      const runtimeExecutable = opts?.runtimeExecutable || resolveNodeBinary();
      const runtimeArgs = opts?.runtimeArgs || [];
      // When falling back to Electron's binary, ELECTRON_RUN_AS_NODE makes
      // it behave as plain node (no chromium globals). System `node` ignores
      // this var, so it is harmless when set.
      const baseEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(extraEnv || {}) };

      const child = spawn(runtimeExecutable, [
        ...runtimeArgs,
        `--inspect-brk=127.0.0.1:${port}`,
        script,
        ...(args || []),
      ], {
        cwd: cwd || path.dirname(script),
        env: baseEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const session = { id, port, child, ctx, fileBreakpoints: new Map() };
      sessions.set(id, session);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => emit(session, 'output', { stream: 'stdout', text: chunk }));
      child.stderr.on('data', (chunk) => emit(session, 'output', { stream: 'stderr', text: chunk }));
      child.on('exit', (code, signal) => {
        emit(session, 'exit', { code, signal });
        try { session.ws?.close(); } catch {}
        sessions.delete(id);
      });
      child.on('error', (err) => emit(session, 'error', { message: String(err?.message || err) }));

      // Discover WS URL and attach
      discoverWsUrl(port).then((wsUrl) => attachWs(session, wsUrl)).catch((err) => {
        emit(session, 'error', { message: 'Failed to attach inspector: ' + (err?.message || err) });
      });

      return ok({ sessionId: id, port, pid: child.pid });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('debug:stop', async (_e, payload) => {
    try {
      const session = sessions.get(payload?.sessionId);
      if (!session) return ok({ stopped: false });
      try { session.ws?.close(); } catch {}
      try { session.child?.kill(); } catch {}
      sessions.delete(session.id);
      return ok({ stopped: true });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('debug:set-breakpoints', async (_e, payload) => {
    try {
      const { sessionId, filePath, lines } = payload || {};
      const session = sessions.get(sessionId);
      if (!session) throw new Error('session not found');
      if (!filePath) throw new Error('filePath required');
      session.fileBreakpoints.set(path.normalize(filePath), new Set(lines || []));
      // If already attached, sync now: clear all existing and re-set for this file.
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        const url = filePathToUrl(filePath);
        // Best-effort: we don't track per-line breakpoint IDs, so we rely on
        // `Debugger.setBreakpointsActive` + setBreakpointByUrl idempotency.
        for (const line of (lines || [])) {
          try {
            await sendCdp(session, 'Debugger.setBreakpointByUrl', {
              lineNumber: Math.max(0, line - 1),
              url,
            });
          } catch {}
        }
      }
      return ok({});
    } catch (err) { return fail(err); }
  });

  function controlHandler(method, paramBuilder) {
    return async (_e, payload) => {
      try {
        const session = sessions.get(payload?.sessionId);
        if (!session) throw new Error('session not found');
        const result = await sendCdp(session, method, paramBuilder ? paramBuilder(payload) : {});
        return ok({ result });
      } catch (err) { return fail(err); }
    };
  }
  ipcMain.handle('debug:continue',  controlHandler('Debugger.resume'));
  ipcMain.handle('debug:step-over', controlHandler('Debugger.stepOver'));
  ipcMain.handle('debug:step-into', controlHandler('Debugger.stepInto'));
  ipcMain.handle('debug:step-out',  controlHandler('Debugger.stepOut'));
  ipcMain.handle('debug:pause',     controlHandler('Debugger.pause'));

  ipcMain.handle('debug:eval', async (_e, payload) => {
    try {
      const session = sessions.get(payload?.sessionId);
      if (!session) throw new Error('session not found');
      const { expression, callFrameId } = payload || {};
      const result = callFrameId
        ? await sendCdp(session, 'Debugger.evaluateOnCallFrame', {
            callFrameId, expression, returnByValue: true, generatePreview: true,
          })
        : await sendCdp(session, 'Runtime.evaluate', {
            expression, returnByValue: true, generatePreview: true,
          });
      return ok({ result: result.result, exceptionDetails: result.exceptionDetails });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('debug:get-properties', async (_e, payload) => {
    try {
      const session = sessions.get(payload?.sessionId);
      if (!session) throw new Error('session not found');
      const { objectId } = payload || {};
      if (!objectId) throw new Error('objectId required');
      const result = await sendCdp(session, 'Runtime.getProperties', {
        objectId, ownProperties: true, accessorPropertiesOnly: false, generatePreview: true,
      });
      const props = (result.result || []).map((p) => ({
        name: p.name,
        value: p.value
          ? { type: p.value.type, value: p.value.value, description: p.value.description, objectId: p.value.objectId, subtype: p.value.subtype }
          : null,
      }));
      return ok({ properties: props });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('debug:list-sessions', async () => {
    return ok({ sessions: [...sessions.values()].map(s => ({ id: s.id, port: s.port, pid: s.child?.pid })) });
  });

  // Cleanup on app quit
  if (ctx.app && typeof ctx.app.on === 'function') {
    ctx.app.on('before-quit', () => {
      for (const s of sessions.values()) {
        try { s.ws?.close(); } catch {}
        try { s.child?.kill(); } catch {}
      }
      sessions.clear();
    });
  }
};
