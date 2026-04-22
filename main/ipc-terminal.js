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
};
