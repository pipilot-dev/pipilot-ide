// PiPilot IDE — Per-workspace persistent shell session for the
// agent's run_command tool.
//
// One shell stays alive per workspace; commands flow through stdin
// and we delimit each command's output with a sentinel echoed at
// the end. First call pays for shell spawn; every call after lands
// in <50 ms (vs ~3 s cold-spawn that the SDK's built-in Bash pays
// per call on Windows).
//
// Shell choice mirrors the IDE's terminal panel — OS-native default
// shell. cmd.exe on Windows, bash on macOS/Linux. On Windows this
// also dodges the Git-Bash-vs-WSL-bash-vs-MSYS path-translation mess
// (cmd accepts native `C:\Users\big\...` paths verbatim). bash on
// macOS/Linux is the universal lingua franca for Unix and the agent
// already speaks it natively.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Per-background-job log file. We keep them under a single dir so
// the agent + user can find/clean them up easily. Created lazily.
const BG_LOG_DIR = path.join(os.tmpdir(), 'pipilot-run-command-bg');
function bgLogPath(id) {
  try { fs.mkdirSync(BG_LOG_DIR, { recursive: true }); } catch {}
  return path.join(BG_LOG_DIR, `${id}.log`);
}

// ── Shell strategies ───────────────────────────────────────────────
// Each strategy abstracts the per-shell pieces:
//   spawn  : argv to start the shell with stdin pipe open
//   init   : line to send first to suppress echo / prompt noise
//   wrap   : turn a (command, opts) pair into the script bash/cmd
//            should evaluate
//   eol    : line ending (\n on Unix, \r\n on Windows)
const STRATEGIES = {
  bash: {
    spawn: () => ({ cmd: 'bash', args: ['--noprofile', '--norc'] }),
    init: '',
    wrap(command, opts, id) {
      const cwdNorm = opts.cwd ? String(opts.cwd) : '';
      const cd = cwdNorm ? `cd ${shellSingleQuote(cwdNorm)} && ` : '';
      // Background mode: redirect output to a temp log, fork via &,
      // echo the pid + log path, and report exit 0 immediately. The
      // command keeps running after we return; when the persistent
      // shell dies (app quit) SIGHUP propagates and the bg process
      // dies with it — which is what we want for dev-server use cases.
      if (opts.run_in_background) {
        const logPath = bgLogPath(id);
        const inner = `${cd}${command}`;
        return (
          `${inner} > ${shellSingleQuote(logPath)} 2>&1 &\n` +
          `echo "[run_command background] pid=$!  log=${logPath}"\n` +
          `echo "__${id}__:0"\n`
        );
      }
      const inner = `${cd}${command} 2>&1`;
      const wrapped = (opts.isolated || cwdNorm) ? `( ${inner} )` : inner;
      // Sentinel echoed AFTER the command runs. `$?` is the prior
      // line's exit code at parse time of THIS line — which is after
      // the command finishes because bash reads stdin line by line.
      return `${wrapped}\necho "__${id}__:$?"\n`;
    },
    parseExit: (s) => parseInt(String(s).trim(), 10),
  },

  cmd: {
    // /Q  → @echo off implicitly
    // /D  → don't run AutoRun (HKCU\…\AutoRun) which can reset prompt
    // /K  → keep alive after running the (empty) start command,
    //       so subsequent stdin lines execute as new commands
    // /V:ON → enable delayed expansion so !ERRORLEVEL! evaluates
    //         after a command in the same line runs (we still don't
    //         rely on it heavily, but it keeps the door open).
    spawn: () => ({ cmd: 'cmd.exe', args: ['/Q', '/D', '/V:ON', '/K'] }),
    // Silence the prompt — without this every command would be
    // followed by a line like "C:\path>", noise the agent has to
    // skim around. `prompt $H` writes a single backspace which most
    // terminals consume invisibly; if it leaks it's still tiny.
    init: '@echo off\r\nprompt $H\r\n',
    wrap(command, opts, id) {
      const cwd = opts.cwd ? String(opts.cwd) : '';
      const lines = [];
      // Background mode on Windows: `start /B` runs the program in
      // the background without a new console window, returning
      // control immediately. We wrap it in a child cmd so we can
      // redirect its output to a log file. The agent gets the log
      // path back so it can poll `type <log>` for status / errors.
      if (opts.run_in_background) {
        const logPath = bgLogPath(id);
        if (cwd) {
          lines.push(`pushd ${cmdQuote(cwd)} || (echo __${id}__:1 & exit /b)`);
        }
        lines.push(`start /B "" cmd /C "${command.replace(/"/g, '""')} > ${cmdQuote(logPath)} 2>&1"`);
        if (cwd) lines.push(`popd`);
        lines.push(`echo [run_command background] log=${logPath}`);
        lines.push(`echo __${id}__:0`);
        return lines.join('\r\n') + '\r\n';
      }
      // pushd handles drive letters natively (`pushd C:\x` switches
      // drives transparently, popd returns). %ERRORLEVEL% is captured
      // into a temp var BEFORE popd so popd's own success doesn't
      // clobber the command's exit status.
      if (cwd) {
        lines.push(`pushd ${cmdQuote(cwd)} || (echo __${id}__:1 & exit /b)`);
        lines.push(`${command} 2>&1`);
        lines.push(`set "_PIPILOT_EC=%ERRORLEVEL%"`);
        lines.push(`popd`);
        lines.push(`echo __${id}__:%_PIPILOT_EC%`);
      } else {
        lines.push(`${command} 2>&1`);
        lines.push(`echo __${id}__:%ERRORLEVEL%`);
      }
      // Note: cmd doesn't have real subshells; `isolated:true` is a
      // no-op on Windows. `pushd`/`popd` already insulates cwd
      // changes, which is the most common leak.
      return lines.join('\r\n') + '\r\n';
    },
    parseExit: (s) => {
      // Trim any leading backspace bytes from the silenced prompt.
      const cleaned = String(s).replace(/^[\b\r\n\s]+/, '').trim();
      return parseInt(cleaned, 10);
    },
  },
};

function pickStrategy() {
  return process.platform === 'win32' ? STRATEGIES.cmd : STRATEGIES.bash;
}

class PersistentShell {
  /**
   * @param {string} cwd  Working directory the shell starts in. The
   *                      agent can `cd` from here freely; subsequent
   *                      commands inherit the new cwd (that's a
   *                      *feature* of the persistent shell — pass
   *                      `isolated: true` to opt out per-command
   *                      where the strategy supports it).
   */
  constructor(cwd) {
    this.cwd = cwd;
    this.strategy = pickStrategy();
    this.shell = null;
    this.queue = [];
    this.busy = false;
    this.currentJob = null;
    this.outBuf = '';
    this.opening = null;
  }

  ensureOpen() {
    if (this.shell && !this.shell.killed) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      try {
        const { cmd, args } = this.strategy.spawn();
        const proc = spawn(cmd, args, {
          cwd: this.cwd,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        proc.on('error', (err) => {
          this.shell = null;
          this.opening = null;
          reject(err);
        });
        proc.on('exit', () => {
          if (this.currentJob) {
            const j = this.currentJob;
            clearTimeout(j.timeoutTimer);
            clearTimeout(j.hardTimeoutTimer);
            this.currentJob = null;
            this.busy = false;
            j.reject(new Error('shell exited mid-command'));
          }
          this.shell = null;
        });
        const onData = (d) => {
          this.outBuf += d.toString('utf8');
          this._scanForSentinel();
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        this.shell = proc;
        // Send strategy-specific init (e.g. cmd's prompt-silence)
        // so subsequent commands get clean output.
        if (this.strategy.init) {
          try { proc.stdin.write(this.strategy.init); } catch {}
        }
        this.opening = null;
        resolve();
      } catch (err) {
        this.opening = null;
        reject(err);
      }
    });
    return this.opening;
  }

  /**
   * Run a single command. Resolves with { stdout, exitCode, elapsedMs }.
   * Commands queue and run serially — concurrent calls don't interleave.
   *
   * @param {string} command
   * @param {object} opts
   * @param {string} [opts.cwd]        Per-command cwd.
   * @param {number} [opts.timeoutMs]  Default 60 s, hard cap 10 min.
   * @param {boolean} [opts.isolated]  Subshell wrap on bash; no-op on cmd.
   */
  async exec(command, opts = {}) {
    if (!command || typeof command !== 'string') {
      throw new Error('command (string) is required');
    }
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      this.queue.push({ command, opts, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    if (this.busy || !this.queue.length || !this.shell) return;
    const job = this.queue.shift();
    this.busy = true;
    const id = `pipilot_done_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTs = Date.now();
    this.currentJob = { ...job, id, startTs };

    const timeoutMs = Math.max(100, Math.min(600_000, Number(job.opts.timeoutMs) || 60_000));

    // Soft timeout: try to interrupt the running command via signal
    // and a stub sentinel. Often unsticks bash. On Windows kill('SIGINT')
    // = TerminateProcess so cmd will die outright; that's also fine —
    // the proc.exit handler rejects the job and the next exec respawns.
    this.currentJob.timeoutTimer = setTimeout(() => {
      try { this.shell?.kill('SIGINT'); } catch {}
      try {
        const sentinel = process.platform === 'win32'
          ? `echo __${id}__:124\r\n`
          : `echo "__${id}__:124"\n`;
        this.shell?.stdin?.write(sentinel);
      } catch {}
    }, timeoutMs);

    // Hard timeout: belt-and-braces guarantee the Promise always
    // settles. If the soft path didn't unstick the job (signal lost,
    // proc.on('exit') didn't fire, sentinel buffered behind a hung
    // pipe) this resolves with a clear timed-out result and tears
    // down the shell so the next call respawns clean.
    this.currentJob.hardTimeoutTimer = setTimeout(() => {
      if (!this.currentJob || this.currentJob.id !== id) return;
      const j = this.currentJob;
      this.currentJob = null;
      this.busy = false;
      try { this.shell?.kill(); } catch {}
      this.shell = null;
      try {
        j.resolve({
          stdout: stripTrailingNewline(this.outBuf) + '\n[run_command timed out and the shell was killed]',
          exitCode: 124,
          elapsedMs: Date.now() - startTs,
          timedOut: true,
        });
      } catch {}
      this.outBuf = '';
      setImmediate(() => this._drain());
    }, timeoutMs + 5000);

    const fullLine = this.strategy.wrap(job.command, job.opts, id);

    try {
      this.shell.stdin.write(fullLine);
    } catch (err) {
      clearTimeout(this.currentJob.timeoutTimer);
      clearTimeout(this.currentJob.hardTimeoutTimer);
      this.currentJob = null;
      this.busy = false;
      job.reject(err);
      this._drain();
    }
  }

  _scanForSentinel() {
    if (!this.currentJob) return;
    const sentinel = `__${this.currentJob.id}__:`;
    const idx = this.outBuf.indexOf(sentinel);
    if (idx === -1) return;
    const before = this.outBuf.slice(0, idx);
    const afterSentinel = this.outBuf.slice(idx + sentinel.length);
    const eol = afterSentinel.search(/[\r\n]/);
    const exitStr = eol === -1 ? afterSentinel : afterSentinel.slice(0, eol);
    const exitCode = this.strategy.parseExit(exitStr);
    this.outBuf = eol === -1 ? '' : afterSentinel.slice(eol).replace(/^[\r\n]+/, '');

    const job = this.currentJob;
    clearTimeout(job.timeoutTimer);
    clearTimeout(job.hardTimeoutTimer);
    this.currentJob = null;
    this.busy = false;

    job.resolve({
      stdout: cleanCmdOutput(stripTrailingNewline(before)),
      exitCode: Number.isFinite(exitCode) ? exitCode : -1,
      elapsedMs: Date.now() - job.startTs,
    });
    setImmediate(() => this._drain());
  }

  close() {
    while (this.queue.length) {
      const j = this.queue.shift();
      try { j.reject(new Error('shell closed')); } catch {}
    }
    if (this.currentJob) {
      try { this.currentJob.reject(new Error('shell closed')); } catch {}
      clearTimeout(this.currentJob.timeoutTimer);
      clearTimeout(this.currentJob.hardTimeoutTimer);
      this.currentJob = null;
    }
    this.busy = false;
    if (this.shell) {
      try { this.shell.stdin.end(); } catch {}
      try { this.shell.kill(); } catch {}
      this.shell = null;
    }
  }
}

function shellSingleQuote(s) {
  return `'${String(s).replace(/'/g, `'"'"'`)}'`;
}
function cmdQuote(s) {
  // cmd quoting: wrap in double quotes, escape internal " by doubling.
  return `"${String(s).replace(/"/g, '""')}"`;
}
function stripTrailingNewline(s) {
  return s.replace(/[\r\n]+$/, '');
}
function cleanCmdOutput(s) {
  // The silenced cmd prompt occasionally bleeds a backspace + cr/lf
  // pair before the next command's output. Trim leading control
  // bytes so the agent gets clean stdout.
  return process.platform === 'win32'
    ? s.replace(/^[\b\r\n]+/, '')
    : s;
}

const shellsByCwd = new Map();
function getShell(cwd) {
  const key = path.resolve(cwd || process.cwd());
  let s = shellsByCwd.get(key);
  if (!s) {
    s = new PersistentShell(key);
    shellsByCwd.set(key, s);
  }
  return s;
}
function closeAllShells() {
  for (const [, s] of shellsByCwd) {
    try { s.close(); } catch {}
  }
  shellsByCwd.clear();
}

module.exports = { PersistentShell, getShell, closeAllShells };
