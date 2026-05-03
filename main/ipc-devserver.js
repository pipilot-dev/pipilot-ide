// PiPilot IDE — Dev server / preview process IPC handlers (Phase 5)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

module.exports = function register(ipcMain, ctx) {
  const servers = new Map();
  const MAX_LOG_LINES = 5000;

  function ok(data) { return { ok: true, ...(data || {}) }; }
  function fail(err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }

  function newId() {
    return 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  async function detectCommand(projectPath) {
    const pkgPath = path.join(projectPath, 'package.json');
    try {
      const raw = await fsp.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts || {};
      if (scripts.dev) return 'npm run dev';
      if (scripts.start) return 'npm start';
      if (scripts.serve) return 'npm run serve';
    } catch {}
    return null;
  }

  function emitLog(id, line) {
    const srv = servers.get(id);
    if (!srv) return;
    srv.logs.push(line);
    if (srv.logs.length > MAX_LOG_LINES) srv.logs.splice(0, srv.logs.length - MAX_LOG_LINES);
    try {
      const win = ctx.getWindow && ctx.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(`devserver:log:${id}`, line);
      }
    } catch {}
  }

  function detectUrl(line) {
    // Strip ANSI escape codes first — Vite/Next/etc output colored URLs
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/[\u001b\u009b]\[[0-9;]*[a-zA-Z]/g, '');
    const m = clean.match(/(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?[^\s]*)/i);
    if (m) return { url: m[1], port: m[2] ? parseInt(m[2], 10) : null };
    const m2 = clean.match(/Local:\s+(https?:\/\/[^\s]+)/i);
    if (m2) {
      const portMatch = m2[1].match(/:(\d+)/);
      return { url: m2[1], port: portMatch ? parseInt(portMatch[1], 10) : null };
    }
    // Also match "port NNNN" or ":NNNN" patterns common in dev server output
    const m3 = clean.match(/(?:port|listening on|started at)\s*:?\s*(\d{4,5})/i);
    if (m3) return { url: `http://localhost:${m3[1]}`, port: parseInt(m3[1], 10) };
    return null;
  }

  function toLines(buffer, chunk) {
    const text = (buffer.tail || '') + chunk.toString('utf8');
    const parts = text.split(/\r?\n/);
    buffer.tail = parts.pop();
    return parts;
  }

  function summarize(srv) {
    return {
      id: srv.id,
      projectPath: srv.projectPath,
      cmd: srv.cmd,
      status: srv.status,
      port: srv.port,
      url: srv.url,
      pid: srv.child && srv.child.pid,
      startedAt: srv.startedAt,
      exitCode: srv.exitCode,
    };
  }

  // Kill any running server for a given project path
  function killServersForProject(projectPath) {
    for (const [id, srv] of servers) {
      if (srv.projectPath === projectPath && srv.status === 'running' && srv.child) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(srv.child.pid), '/T', '/F']);
          } else {
            srv.child.kill('SIGTERM');
          }
        } catch {}
        srv.status = 'stopped';
        emitLog(id, '[pipilot] killed — new server starting for same project');
      }
    }
  }

  ipcMain.handle('devserver:start', async (_e, payload) => {
    try {
      const { projectPath } = payload || {};
      let { cmd } = payload || {};
      if (!projectPath) throw new Error('projectPath required');
      if (!cmd) cmd = await detectCommand(projectPath);
      if (!cmd) throw new Error('No dev/start/serve script found in package.json. Pass cmd explicitly.');

      // Kill any existing server for this project before starting a new one
      killServersForProject(projectPath);

      const id = newId();
      const child = spawn(cmd, {
        cwd: projectPath,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1', NODE_ENV: process.env.NODE_ENV || 'development' },
      });

      const srv = {
        id,
        projectPath,
        cmd,
        child,
        status: 'running',
        port: null,
        url: null,
        logs: [],
        startedAt: Date.now(),
        exitCode: null,
        _stdoutBuf: { tail: '' },
        _stderrBuf: { tail: '' },
      };
      servers.set(id, srv);

      const onChunk = (chunk, buf) => {
        const lines = toLines(buf, chunk);
        for (const line of lines) {
          emitLog(id, line);
          if (!srv.url) {
            const detected = detectUrl(line);
            if (detected) {
              srv.url = detected.url;
              if (detected.port) srv.port = detected.port;
              emitLog(id, `[pipilot] detected-url ${detected.url}`);
            }
          }
        }
      };

      child.stdout.on('data', (c) => onChunk(c, srv._stdoutBuf));
      child.stderr.on('data', (c) => onChunk(c, srv._stderrBuf));

      child.on('exit', (code) => {
        srv.status = 'stopped';
        srv.exitCode = code;
        emitLog(id, `[pipilot] process exited with code ${code}`);
        try {
          const win = ctx.getWindow && ctx.getWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('devserver:status-changed', summarize(srv));
          }
        } catch {}
      });
      child.on('error', (err) => {
        emitLog(id, `[pipilot] error: ${err.message}`);
        srv.status = 'error';
      });

      return ok(summarize(srv));
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('devserver:stop', async (_e, id) => {
    try {
      const srv = servers.get(id);
      if (!srv) throw new Error('Server not found: ' + id);
      if (srv.child && srv.status === 'running') {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(srv.child.pid), '/T', '/F']);
          } else {
            srv.child.kill('SIGTERM');
            setTimeout(() => {
              if (srv.status === 'running') {
                try { srv.child.kill('SIGKILL'); } catch {}
              }
            }, 2000);
          }
        } catch (err) {
          emitLog(id, `[pipilot] kill error: ${err.message}`);
        }
      }
      srv.status = 'stopped';
      return ok(summarize(srv));
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('devserver:status', async (_e, id) => {
    try {
      const srv = servers.get(id);
      if (!srv) return ok({ server: null });
      return ok({ server: summarize(srv) });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('devserver:stop-all', async () => {
    try {
      for (const [id, srv] of servers) {
        if (srv.status === 'running' && srv.child) {
          try {
            if (process.platform === 'win32') {
              spawn('taskkill', ['/pid', String(srv.child.pid), '/T', '/F']);
            } else {
              srv.child.kill('SIGTERM');
            }
          } catch {}
          srv.status = 'stopped';
        }
      }
      return ok({ stopped: servers.size });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('devserver:list', async () => {
    try {
      const list = Array.from(servers.values()).map(summarize);
      return ok({ servers: list });
    } catch (err) { return fail(err); }
  });

  // ── Static file server for projects without dev scripts ──
  const http = require('http');
  const staticServers = new Map(); // projectPath -> { server, port }

  const MIME_MAP = {
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4',
    '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.xml': 'application/xml', '.txt': 'text/plain', '.md': 'text/plain',
    '.pdf': 'application/pdf', '.zip': 'application/zip',
  };

  ipcMain.handle('devserver:static', async (_e, { projectPath }) => {
    if (!projectPath) return fail(new Error('projectPath required'));

    // Reuse existing static server for this project
    const existing = staticServers.get(projectPath);
    if (existing) return ok({ port: existing.port, url: `http://localhost:${existing.port}` });

    // Verify directory exists
    if (!fs.existsSync(projectPath)) {
      return fail(new Error('Directory not found: ' + projectPath));
    }

    return new Promise((resolve) => {
      const normalRoot = path.resolve(projectPath);
      const server = http.createServer((req, res) => {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        // Strip leading slash for path.join on Windows
        const cleanPath = urlPath.replace(/^\/+/, '');

        const filePath = path.resolve(path.join(normalRoot, cleanPath));
        // Security: prevent path traversal (normalize both sides)
        if (!filePath.startsWith(normalRoot)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }

        fs.stat(filePath, (err, stat) => {
          if (err || !stat.isFile()) {
            // SPA fallback: serve index.html for non-file paths
            const fallback = path.join(projectPath, 'index.html');
            if (fs.existsSync(fallback) && filePath !== fallback) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              fs.createReadStream(fallback).pipe(res);
            } else {
              res.writeHead(404); res.end('Not found');
            }
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          const mime = MIME_MAP[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(filePath).pipe(res);
        });
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        staticServers.set(projectPath, { server, port });
        console.log(`[static-server] Serving ${projectPath} on :${port}`);
        resolve(ok({ port, url: `http://localhost:${port}` }));
      });

      server.on('error', (err) => {
        resolve(fail(err));
      });
    });
  });

  ipcMain.handle('devserver:static-stop', async (_e, { projectPath }) => {
    const entry = staticServers.get(projectPath);
    if (entry) {
      entry.server.close();
      staticServers.delete(projectPath);
    }
    return ok({});
  });

  // Detect if project has a dev script or is static-only
  ipcMain.handle('devserver:detect-type', async (_e, { projectPath }) => {
    if (!projectPath) return { type: 'none' };
    const cmd = await detectCommand(projectPath);
    if (cmd) return { type: 'dev-server', cmd };
    if (fs.existsSync(path.join(projectPath, 'index.html'))) return { type: 'static' };
    return { type: 'none' };
  });
};
