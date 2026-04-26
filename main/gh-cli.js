// PiPilot IDE — gh CLI provisioning for cloud missions
//
// Cloud missions get the GitHub Copilot HTTP MCP for tool-based access,
// PLUS the agent can use the `gh` CLI directly via the Bash tool when
// shell ops are easier than MCP calls (search PRs, gh repo clone,
// gh issue list ...). We do two things before each cloud mission:
//
//   1. Check `gh --version` — if missing, attempt platform-native
//      install (winget on Windows, brew on macOS, apt on Debian).
//      Best-effort: failure surfaces a warning, mission still runs.
//   2. Inject GH_TOKEN/GITHUB_TOKEN env vars into the agent's bash
//      subprocess for that run only — `gh` reads GH_TOKEN automatically.
//      No `gh auth login` call (which writes to ~/.config/gh/hosts.yml
//      globally); the env-var path is naturally process-scoped, so the
//      user's existing global gh config is untouched.

const { execFile, spawn } = require('child_process');
const os = require('os');

function execCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const child = execFile(cmd, args, { ...opts, windowsHide: true }, (err, so, se) => {
      if (done) return;
      done = true;
      stdout = so || ''; stderr = se || '';
      resolve({ ok: !err, code: err?.code ?? 0, stdout, stderr, error: err?.message });
    });
    // Hard timeout — install commands can wedge.
    if (opts.timeoutMs) {
      setTimeout(() => {
        if (done) return;
        try { child.kill(); } catch {}
        done = true;
        resolve({ ok: false, code: 124, stdout, stderr, error: 'timeout' });
      }, opts.timeoutMs);
    }
  });
}

async function isGhInstalled() {
  const r = await execCmd('gh', ['--version'], { timeoutMs: 4000 });
  if (!r.ok) return { installed: false };
  const m = /gh version (\S+)/.exec(r.stdout || '');
  return { installed: true, version: m ? m[1] : 'unknown' };
}

async function isGitInstalled() {
  const r = await execCmd('git', ['--version'], { timeoutMs: 4000 });
  if (!r.ok) return { installed: false };
  const m = /git version (\S+)/.exec(r.stdout || '');
  return { installed: true, version: m ? m[1] : 'unknown' };
}

// Platform-specific install. Returns { ok, message }. Best-effort —
// many systems will refuse without elevation; we surface that to the UI.
async function tryInstallGh() {
  const platform = os.platform();
  if (platform === 'win32') {
    // winget is on every Windows 11 by default; older Win10 builds may
    // not have it.
    const winget = await execCmd('winget', ['--version'], { timeoutMs: 4000 });
    if (winget.ok) {
      const r = await execCmd('winget', [
        'install', '--id', 'GitHub.cli',
        '--silent',
        '--accept-source-agreements',
        '--accept-package-agreements',
      ], { timeoutMs: 5 * 60_000 });
      if (r.ok) return { ok: true, via: 'winget', message: 'Installed via winget' };
      return { ok: false, message: 'winget install failed: ' + (r.stderr || r.error || 'unknown') };
    }
    // Try scoop as fallback.
    const scoop = await execCmd('scoop', ['--version'], { timeoutMs: 4000 });
    if (scoop.ok) {
      const r = await execCmd('scoop', ['install', 'gh'], { timeoutMs: 5 * 60_000 });
      if (r.ok) return { ok: true, via: 'scoop', message: 'Installed via scoop' };
    }
    return { ok: false, message: 'gh CLI is not installed and winget/scoop are unavailable. Install manually from https://cli.github.com/.' };
  }
  if (platform === 'darwin') {
    const brew = await execCmd('brew', ['--version'], { timeoutMs: 4000 });
    if (!brew.ok) return { ok: false, message: 'Install Homebrew first (https://brew.sh) or install gh manually.' };
    const r = await execCmd('brew', ['install', 'gh'], { timeoutMs: 5 * 60_000 });
    if (r.ok) return { ok: true, via: 'brew', message: 'Installed via brew' };
    return { ok: false, message: 'brew install gh failed: ' + (r.stderr || r.error || 'unknown') };
  }
  // Linux: try apt, dnf, pacman in that order. None of these will work
  // without sudo + tty. Best to surface a manual-install message here
  // and let the user run it. (Pre-baking the apt key + repo is too
  // invasive for a desktop IDE to do silently.)
  return {
    ok: false,
    message: 'gh CLI is not installed. On Linux, install per the instructions at https://github.com/cli/cli/blob/trunk/docs/install_linux.md',
  };
}

module.exports = function register(ipcMain, ctx, deps = {}) {
  const { getSecret } = deps;

  // Cache the install check for 60s so back-to-back cloud missions
  // don't keep hitting --version on the binaries.
  let lastCheck = { at: 0, gh: { installed: false }, git: { installed: false } };
  async function check() {
    if (Date.now() - lastCheck.at < 60_000) return lastCheck;
    const [gh, git] = await Promise.all([isGhInstalled(), isGitInstalled()]);
    lastCheck = { at: Date.now(), gh, git };
    return lastCheck;
  }

  ipcMain.handle('gh:check', async () => {
    try {
      const r = await check();
      // Backward-compatible flat shape for callers that only want gh.
      return { ok: true, installed: r.gh.installed, version: r.gh.version, gh: r.gh, git: r.git };
    } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });

  ipcMain.handle('gh:install', async () => {
    try {
      const cur = await check();
      if (cur.gh.installed) return { ok: true, alreadyInstalled: true, ...cur };
      const r = await tryInstallGh();
      lastCheck.at = 0;
      const after = await check();
      return { ok: r.ok && after.gh.installed, ...r, ...after };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Ensure: returns the install state of BOTH git and gh, plus the env
  // vars we want to inject into the agent's bash subprocess. Does NOT
  // attempt to install git (cross-platform git installs require running
  // a real installer with elevation — we surface a "please install"
  // message instead and the renderer modal links to the official
  // download).
  async function ensureForMission() {
    const cur = await check();
    let ghInstallResult = null;
    if (!cur.gh.installed) {
      try { ghInstallResult = await tryInstallGh(); } catch (err) { ghInstallResult = { ok: false, message: err?.message }; }
      if (ghInstallResult?.ok) {
        lastCheck.at = 0;
        await check();
      }
    }
    let token = null;
    if (typeof getSecret === 'function') {
      try { token = await getSecret('githubPat'); } catch {}
    }
    const env = token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {};
    return {
      git: lastCheck.git,
      gh: lastCheck.gh,
      ghInstallAttempted: !!ghInstallResult,
      ghInstallOk: ghInstallResult?.ok ?? null,
      ghInstallMessage: ghInstallResult?.message ?? null,
      env,
      hasToken: !!token,
      // Convenience flags for callers.
      gitInstalled: lastCheck.git.installed,
      ghInstalled: lastCheck.gh.installed,
    };
  }

  ipcMain.handle('gh:ensure-for-mission', async () => {
    try { return { ok: true, ...(await ensureForMission()) }; }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });

  return { check, ensureForMission };
};
