// PiPilot IDE — Per-workspace persistent shell session for the
// agent's run_command tool.
//
// Why this exists: the SDK's built-in Bash tool spawns a fresh shell
// per call (`bash -c "..."`). On Windows that's ~3 s of Git-Bash
// startup for every `ls` or `git status`. Across a turn that fires a
// dozen shell commands the cost dominates the agent's wall-clock
// time. This module spawns ONE bash per workspace, pipes commands
// through stdin, detects completion via a sentinel echoed after each
// command, and returns { stdout, exitCode, elapsedMs }. First command
// pays for spawn, every subsequent command lands in <50 ms.
//
// Scope: bash only. Almost every PiPilot dev on Windows has Git Bash
// (it ships with Git for Windows, which the IDE already requires for
// the in-app git features). If bash isn't on PATH we fail loudly and
// the agent falls back to the SDK's built-in Bash tool. We don't
// reimplement cmd / PowerShell shells — the failure mode is "this
// optimisation isn't available", not "shell access is broken".

const { spawn } = require('node:child_process');
const path = require('node:path');

class PersistentShell {
  /**
   * @param {string} cwd  Working directory the shell starts in. The
   *                      agent can `cd` from here freely; subsequent
   *                      commands inherit the new cwd (that's a
   *                      *feature* of the persistent shell — pass
   *                      `isolated: true` to opt out per-command).
   */
  constructor(cwd) {
    this.cwd = cwd;
    /** Live ChildProcess or null if not yet spawned / has died. */
    this.shell = null;
    /** FIFO of { command, opts, resolve, reject } awaiting the shell. */
    this.queue = [];
    /** True while a command is in flight (sentinel not yet seen). */
    this.busy = false;
    /** Currently-running job; null while the queue drains. */
    this.currentJob = null;
    /** Pending stdout+stderr bytes — sentinel detection scans this. */
    this.outBuf = '';
    /** Promise we hand out from ensureOpen() so concurrent awaiters dedupe. */
    this.opening = null;
  }

  ensureOpen() {
    if (this.shell && !this.shell.killed) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      try {
        // Spawn bash with no profile / login config so it boots fast
        // and doesn't run user dotfiles that might prompt or hang.
        // -i (interactive) is intentionally skipped — non-interactive
        // shells exit cleanly when stdin closes, which is what we want.
        // node child_process accepts native OS paths for `cwd` (it
        // CreateProcess-es into the dir before spawning bash) so the
        // Windows path passes through fine — only commands we send
        // *into* the shell need the /c/Users/... translation.
        const proc = spawn('bash', ['--noprofile', '--norc'], {
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
          // Shell died (Ctrl+D escaped, segfault, kill). Drop our
          // reference; the next exec() call will spawn a fresh one.
          // Reject any in-flight job so the agent learns about it
          // instead of hanging forever.
          if (this.currentJob) {
            const j = this.currentJob;
            this.currentJob = null;
            this.busy = false;
            j.reject(new Error('shell exited mid-command'));
          }
          this.shell = null;
        });
        proc.stdout.on('data', (d) => {
          this.outBuf += d.toString('utf8');
          this._scanForSentinel();
        });
        // Merge stderr into the same buffer. We redirect each command's
        // stderr to stdout via `2>&1` below, so stderr is normally
        // empty — but bash itself can print to stderr (e.g. job-control
        // notices) so we still drain it to keep the pipe from blocking.
        proc.stderr.on('data', (d) => {
          this.outBuf += d.toString('utf8');
          this._scanForSentinel();
        });
        this.shell = proc;
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
   * @param {string} [opts.cwd]        Per-command cwd; uses pushd/popd so
   *                                   the persistent shell's cwd is unchanged.
   * @param {number} [opts.timeoutMs]  Kill the command (SIGINT) after N ms.
   *                                   Default 60 s, hard cap 10 min.
   * @param {boolean} [opts.isolated]  Wrap in a subshell so cd / exports
   *                                   from this command DON'T leak into the
   *                                   next one. Trades persistence for safety.
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
    // Two-stage timeout. The soft timeout sends SIGINT and stub
    // sentinel — bash *should* recover. The hard timeout fires 5 s
    // later if the soft path didn't unstick the job (e.g. SIGINT
    // didn't actually deliver on Windows, bash didn't exit, sentinel
    // never arrived). It rejects the Promise outright + tears down
    // the shell so the next exec respawns. Belt-and-braces — without
    // this the agent's tool call hangs forever.
    this.currentJob.timeoutTimer = setTimeout(() => {
      try { this.shell?.kill('SIGINT'); } catch {}
      try { this.shell?.stdin?.write(`echo "__${id}__:124"\n`); } catch {}
    }, timeoutMs);
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

    // Build the line we send to bash. The sentinel echoes the prior
    // command's exit code, separated from output by a newline, so the
    // parser can pick out exactly the bytes that belonged to this
    // command. Wrapping in `( … )` gives a subshell that contains
    // any cd / export side effects so they don't leak across calls
    // when isolated:true OR when a per-command cwd was specified.
    const cwdNorm = job.opts.cwd ? toBashPath(job.opts.cwd) : '';
    const cdPrefix = cwdNorm ? `cd ${shellSingleQuote(cwdNorm)} && ` : '';
    const inner = `${cdPrefix}${job.command} 2>&1`;
    const wrap = (job.opts.isolated || cwdNorm) ? `( ${inner} )` : inner;
    const fullLine = `${wrap}\necho "__${id}__:$?"\n`;

    try {
      this.shell.stdin.write(fullLine);
    } catch (err) {
      clearTimeout(this.currentJob.timeoutTimer);
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
    // Everything before the sentinel is this command's output.
    const before = this.outBuf.slice(0, idx);
    const afterSentinel = this.outBuf.slice(idx + sentinel.length);
    const eol = afterSentinel.indexOf('\n');
    const exitStr = eol === -1 ? afterSentinel : afterSentinel.slice(0, eol);
    const exitCode = parseInt(String(exitStr).trim(), 10);
    this.outBuf = eol === -1 ? '' : afterSentinel.slice(eol + 1);

    const job = this.currentJob;
    clearTimeout(job.timeoutTimer);
    clearTimeout(job.hardTimeoutTimer);
    this.currentJob = null;
    this.busy = false;

    job.resolve({
      stdout: stripTrailingNewline(before),
      exitCode: Number.isFinite(exitCode) ? exitCode : -1,
      elapsedMs: Date.now() - job.startTs,
    });
    // Drain any queued commands. setImmediate so we don't recurse
    // arbitrarily deep on a long queue.
    setImmediate(() => this._drain());
  }

  close() {
    // Drop pending jobs first so they don't hang forever.
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
  // Escape for bash single-quoting: only ' is special inside '…'.
  return `'${String(s).replace(/'/g, `'"'"'`)}'`;
}
function stripTrailingNewline(s) {
  return s.endsWith('\r\n') ? s.slice(0, -2) : s.endsWith('\n') ? s.slice(0, -1) : s;
}

// Convert a Windows-style path (`C:\Users\big\X`) to one bash can
// actually navigate to. Git Bash / MSYS understands `/c/Users/big/X`
// natively (and a forward-slash form like `C:/Users/big/X` if quoted).
// On non-Windows the path is returned unchanged. Without this,
// `cd 'C:\Users\big\X'` inside Git Bash treated the backslashes as
// escapes and silently failed, leaving the persistent-shell tool
// hung indefinitely waiting for its sentinel.
function toBashPath(p) {
  const s = String(p || '');
  if (process.platform !== 'win32') return s;
  // C:\Users\big → /c/Users/big — works in Git Bash, Cygwin, MSYS.
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(s);
  if (m) return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
  return s.replace(/\\/g, '/');
}

// One PersistentShell per workspace. Different workspaces get
// different shells so cd / env-var state doesn't leak across projects.
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
