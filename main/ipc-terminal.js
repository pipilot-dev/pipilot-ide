const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let pty = null;
try {
  pty = require('node-pty');
} catch (err) {
  console.warn('[terminal] node-pty failed to load, falling back to child_process:', err.message);
  pty = null;
}

function detectProfiles() {
  const platform = process.platform;
  const profiles = [];
  const defaultShell = process.env.SHELL || '';

  if (platform === 'win32') {
    // Windows: cmd is the default; PowerShell variants + Git Bash also offered.
    // Note: PowerShell can error with "running scripts is disabled" if user/system
    // profiles or startup scripts execute. We start with -NoProfile and set
    // ExecutionPolicy to Bypass for this process to avoid policy blocks.
    const pwshCommonArgs = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'];
    const candidates = [
      { id: 'cmd', name: 'Command Prompt', path: process.env.ComSpec || 'cmd.exe', args: [] },
      { id: 'powershell', name: 'PowerShell', path: 'powershell.exe', args: pwshCommonArgs },
      { id: 'pwsh', name: 'PowerShell Core', path: 'pwsh.exe', args: pwshCommonArgs },
    ];
    const gitBashCandidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const c of candidates) {
      profiles.push({ id: c.id, name: c.name, path: c.path, args: c.args, env: {} });
    }
    for (const gp of gitBashCandidates) {
      if (fs.existsSync(gp)) {
        profiles.push({ id: 'git-bash', name: 'Git Bash', path: gp, args: ['--login', '-i'], env: {} });
        break;
      }
    }
    // cmd is first candidate → default
    if (profiles.length) profiles[0].default = true;
  } else {
    // Linux / macOS: offer zsh, sh, fish. bash intentionally excluded from the
    // surfaced profile list — users who need bash can still launch it from any
    // other shell as `bash`.
    const candidates = [
      { id: 'zsh', name: 'zsh', path: '/bin/zsh' },
      { id: 'zsh-local', name: 'zsh', path: '/usr/local/bin/zsh' },
      { id: 'sh', name: 'sh', path: '/bin/sh' },
      { id: 'fish', name: 'fish', path: '/usr/bin/fish' },
      { id: 'fish-local', name: 'fish', path: '/usr/local/bin/fish' },
    ];
    for (const c of candidates) {
      if (fs.existsSync(c.path)) {
        profiles.push({ id: c.id, name: c.name, path: c.path, args: [], env: {} });
      }
    }
    if (!profiles.length) {
      profiles.push({ id: 'sh', name: 'sh', path: '/bin/sh', args: [], env: {} });
    }
    // Default: honor $SHELL only if it isn't bash (bash is deliberately demoted);
    // otherwise prefer zsh, then first available.
    let defaultSet = false;
    if (defaultShell && !/\/bash$/.test(defaultShell)) {
      for (const p of profiles) {
        if (p.path === defaultShell || p.name === path.basename(defaultShell)) {
          p.default = true;
          defaultSet = true;
          break;
        }
      }
    }
    if (!defaultSet) {
      const zsh = profiles.find(p => p.name === 'zsh');
      (zsh || profiles[0]).default = true;
    }
  }

  return profiles;
}

function resolveProject(ctx) {
  try {
    const win = ctx?.getWindow?.();
    if (win && !win.isDestroyed() && win.webContents) {
      // Intentionally not doing sync renderer query — rely on passed cwd
    }
  } catch {}
  return null;
}

function pickProfile(profiles, profileId) {
  if (profileId) {
    const found = profiles.find(p => p.id === profileId);
    if (found) return found;
  }
  return profiles.find(p => p.default) || profiles[0];
}

function createPtyProcess(profile, opts) {
  const cols = opts.cols || 80;
  const rows = opts.rows || 24;
  const cwd = opts.cwd || os.homedir();
  const env = { ...process.env, ...(profile.env || {}), TERM: 'xterm-256color', COLORTERM: 'truecolor' };

  if (pty) {
    const proc = pty.spawn(profile.path, profile.args || [], {
      name: 'xterm-256color',
      cols, rows, cwd, env,
    });
    return {
      kind: 'pty',
      pid: proc.pid,
      onData: (fn) => proc.onData(fn),
      onExit: (fn) => proc.onExit(({ exitCode }) => fn(exitCode)),
      write: (data) => proc.write(data),
      resize: (c, r) => { try { proc.resize(c, r); } catch {} },
      kill: () => { try { proc.kill(); } catch {} },
    };
  }

  const child = spawn(profile.path, profile.args || [], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
  });
  const dataHandlers = new Set();
  const exitHandlers = new Set();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => dataHandlers.forEach(fn => fn(chunk)));
  child.stderr.on('data', (chunk) => dataHandlers.forEach(fn => fn(chunk)));
  child.on('exit', (code) => exitHandlers.forEach(fn => fn(code == null ? 0 : code)));
  child.on('error', (err) => {
    dataHandlers.forEach(fn => fn(`\r\n\x1b[31m[spawn error] ${err.message}\x1b[0m\r\n`));
  });
  return {
    kind: 'stub',
    pid: child.pid,
    onData: (fn) => { dataHandlers.add(fn); return { dispose: () => dataHandlers.delete(fn) }; },
    onExit: (fn) => { exitHandlers.add(fn); return { dispose: () => exitHandlers.delete(fn) }; },
    write: (data) => { try { child.stdin.write(data); } catch {} },
    resize: () => {},
    kill: () => { try { child.kill(); } catch {} },
  };
}

module.exports = function register(ipcMain, ctx) {
  const ptys = new Map();

  ipcMain.handle('terminal:profiles', () => {
    return detectProfiles();
  });

  ipcMain.handle('terminal:create', (event, opts = {}) => {
    const profiles = detectProfiles();
    const profile = pickProfile(profiles, opts.profileId);
    if (!profile) throw new Error('No shell profile available');

    const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir();
    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const proc = createPtyProcess(profile, { cwd, cols: opts.cols, rows: opts.rows });

    proc.onData((data) => {
      try {
        if (!event.sender.isDestroyed()) event.sender.send(`terminal:data:${id}`, data);
      } catch {}
    });
    proc.onExit((code) => {
      try {
        if (!event.sender.isDestroyed()) event.sender.send(`terminal:exit:${id}`, code);
      } catch {}
      ptys.delete(id);
    });

    ptys.set(id, { proc, profileId: profile.id, cwd, pid: proc.pid });

    return { id, pid: proc.pid, profileId: profile.id, cwd, kind: proc.kind };
  });

  ipcMain.handle('terminal:write', (_e, { id, data }) => {
    const entry = ptys.get(id);
    if (!entry) return false;
    entry.proc.write(data);
    return true;
  });

  ipcMain.handle('terminal:resize', (_e, { id, cols, rows }) => {
    const entry = ptys.get(id);
    if (!entry) return false;
    entry.proc.resize(cols, rows);
    return true;
  });

  ipcMain.handle('terminal:destroy', (_e, id) => {
    const entry = ptys.get(id);
    if (!entry) return false;
    entry.proc.kill();
    ptys.delete(id);
    return true;
  });

  // ── Agent-driven runs ──────────────────────────────────────────────
  //
  // `terminal:run-and-capture` lets the AI agent execute a command in a
  // real, visible terminal tab. We:
  //   1. Pick the user's default shell profile (so `npm` etc. resolve as
  //      they would interactively).
  //   2. Spawn a fresh PTY and broadcast a 'terminal:agent-spawn' event
  //      to the renderer so it mounts a tab around it (real xterm view,
  //      same UX as a manually-opened terminal).
  //   3. Write the command + a sentinel marker. Buffer all PTY output;
  //      resolve when the marker line is seen, with the captured output
  //      and the exit code parsed out of the marker line.
  //   4. Never auto-destroy the PTY — leaves it open so the user can
  //      keep typing in the tab after the AI finishes.
  //
  // background: true → write the command but don't wait. Used for
  // long-running servers like `npm run dev`.

  const MAX_CAPTURE_BYTES = 100 * 1024;                       // 100 KB cap
  const DEFAULT_TIMEOUT_MS = 60_000;
  const MAX_TIMEOUT_MS     = 10 * 60_000;

  function buildSentinel(profile, command) {
    // POSIX shells: `; echo $? __pp_done_<rand>__\n`
    // Windows cmd:  `& echo %ERRORLEVEL% __pp_done_<rand>__\n`
    // PowerShell:   `; Write-Host "$LASTEXITCODE __pp_done_<rand>__"\n`
    // Sentinel is unique per run so we can't false-match prior output.
    const tag = `__pp_done_${Math.random().toString(36).slice(2, 10)}__`;
    const id = profile.id;
    let wrapped;
    if (id === 'cmd') {
      wrapped = `${command} & echo %ERRORLEVEL% ${tag}\r\n`;
    } else if (id === 'powershell' || id === 'pwsh') {
      wrapped = `${command} ; Write-Host "$LASTEXITCODE ${tag}"\r\n`;
    } else {
      // bash, zsh, sh, fish, git-bash
      wrapped = `${command} ; echo $? ${tag}\n`;
    }
    return { tag, wrapped };
  }

  function getMainWindow() {
    try { return ctx.getWindow ? ctx.getWindow() : null; } catch { return null; }
  }

  // Extracted as a plain function so the agent's `run_in_terminal` tool
  // (running in the main process) can call it directly without bouncing
  // through the renderer→main IPC layer.
  async function runAndCapture(opts = {}) {
    const command = String(opts.command || '').trim();
    if (!command) return { ok: false, error: 'command required' };

    const profiles = detectProfiles();
    const profile = pickProfile(profiles, opts.profileId);
    if (!profile) return { ok: false, error: 'no shell profile' };

    const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir();
    const id  = `term-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const proc = createPtyProcess(profile, { cwd, cols: 120, rows: 30 });
    ptys.set(id, { proc, profileId: profile.id, cwd, pid: proc.pid });

    // Tell the renderer to mount a visible tab around this PTY. The
    // renderer already knows how to attach xterm to a 'terminal:data:<id>'
    // event stream (see renderer/terminal.js).
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('terminal:agent-spawn', { id, label: command.slice(0, 40), cwd, profileId: profile.id }); } catch {}
    }

    // Pipe live PTY data out to the renderer so the user watches it scroll.
    proc.onData((data) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send(`terminal:data:${id}`, data);
      } catch {}
    });
    proc.onExit((code) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send(`terminal:exit:${id}`, code);
      } catch {}
      ptys.delete(id);
    });

    // Background mode: kick off, return immediately. Caller can poll or
    // just leave the server running until the user kills it.
    if (opts.background) {
      proc.write(command + (profile.id === 'cmd' || profile.id === 'powershell' || profile.id === 'pwsh' ? '\r\n' : '\n'));
      return { ok: true, terminalId: id, background: true };
    }

    // Foreground mode: write command + sentinel, watch output for the
    // sentinel marker, resolve.
    const { tag, wrapped } = buildSentinel(profile, command);
    const startTs = Date.now();
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, opts.timeoutMs || DEFAULT_TIMEOUT_MS));

    return new Promise((resolve) => {
      let buffer = '';
      let truncated = false;
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { dataDisposable && dataDisposable.dispose && dataDisposable.dispose(); } catch {}
        try { exitDisposable && exitDisposable.dispose && exitDisposable.dispose(); } catch {}
        resolve(result);
      };
      const timer = setTimeout(() => {
        // Don't kill the PTY — leave the tab open for the user to inspect.
        // Just hand back what we have so far.
        finish({
          ok: true, terminalId: id, output: trimSentinel(buffer, tag),
          exitCode: null, truncated, timedOut: true,
          durationMs: Date.now() - startTs,
        });
      }, timeoutMs);

      const dataDisposable = proc.onData((chunk) => {
        if (done) return;
        if (buffer.length + chunk.length > MAX_CAPTURE_BYTES) {
          buffer += chunk.slice(0, Math.max(0, MAX_CAPTURE_BYTES - buffer.length));
          truncated = true;
        } else {
          buffer += chunk;
        }
        // Scan for sentinel on each chunk. Match the form `<exitCode> <tag>`
        // appearing on a line by itself in the captured stream.
        const idx = buffer.indexOf(tag);
        if (idx >= 0) {
          // Find the start of the sentinel line — last \n before idx.
          const lineStart = buffer.lastIndexOf('\n', idx) + 1;
          const sentinelLine = buffer.slice(lineStart, buffer.indexOf('\n', idx) === -1 ? undefined : buffer.indexOf('\n', idx));
          const exitMatch = sentinelLine.match(/(-?\d+)\s+__pp_done_/);
          const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
          finish({
            ok: true, terminalId: id, output: trimSentinel(buffer, tag),
            exitCode, truncated, timedOut: false,
            durationMs: Date.now() - startTs,
          });
        }
      });

      const exitDisposable = proc.onExit((code) => {
        if (done) return;
        finish({
          ok: true, terminalId: id, output: trimSentinel(buffer, tag),
          exitCode: typeof code === 'number' ? code : null,
          truncated, timedOut: false,
          durationMs: Date.now() - startTs,
        });
      });

      // Give the shell a tick to print its prompt before we inject the
      // command, so the visible terminal shows the prompt + command, not
      // just bare output.
      setTimeout(() => proc.write(wrapped), 80);
    });
  }

  // Renderer-facing wrapper. Same shape as the rest of this file's
  // ipcMain.handle calls.
  ipcMain.handle('terminal:run-and-capture', (_e, opts) => runAndCapture(opts));

  // Expose to ctx so the agent SDK tool (`run_in_terminal`) can call
  // it directly from the main process without going through IPC.
  if (ctx) ctx.runInTerminal = runAndCapture;

  // Strip the sentinel line from the captured output so the AI doesn't
  // see our marker noise.
  function trimSentinel(buffer, tag) {
    const idx = buffer.indexOf(tag);
    if (idx < 0) return buffer;
    const lineStart = buffer.lastIndexOf('\n', idx) + 1;
    return buffer.slice(0, lineStart).trimEnd() + '\n';
  }
};
