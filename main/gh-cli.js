// PiPilot IDE — Git provisioning for cloud missions
//
// Cloud missions clone the target repo into an OS-temp scratch dir,
// edit locally, then `git push` back. Everything else GitHub-related
// (PRs, issues, search, comments, repo metadata) goes through the
// Copilot HTTP MCP at api.githubcopilot.com/mcp — no `gh` CLI needed
// because the MCP exposes the same surface area to the agent as
// typed tools.
//
// So this module's only job is:
//   1. Verify `git` is on PATH (we don't auto-install — git installs
//      cross-platform are too invasive to do silently from a desktop
//      IDE; we surface a "please install" message and let the user
//      visit https://git-scm.com/downloads).
//   2. Hand the runner a token-embedded clone URL so the spawned
//      `git clone` and subsequent `git push` work without any
//      credential prompt or global config write.

const { execFile } = require('child_process');

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

async function isGitInstalled() {
  const r = await execCmd('git', ['--version'], { timeoutMs: 4000 });
  if (!r.ok) return { installed: false };
  const m = /git version (\S+)/.exec(r.stdout || '');
  return { installed: true, version: m ? m[1] : 'unknown' };
}

module.exports = function register(ipcMain, ctx, deps = {}) {
  const { getSecret } = deps;

  let lastCheck = { at: 0, git: { installed: false } };
  async function check() {
    if (Date.now() - lastCheck.at < 60_000) return lastCheck;
    const git = await isGitInstalled();
    lastCheck = { at: Date.now(), git };
    return lastCheck;
  }

  ipcMain.handle('gh:check', async () => {
    try {
      const r = await check();
      return { ok: true, git: r.git, installed: r.git.installed, version: r.git.version };
    } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });

  // Build an HTTPS clone URL with the PAT inlined as the basic-auth
  // username (the GitHub-recommended pattern for PAT push). Returns
  // null if no PAT is set — caller should branch on that for public
  // repos vs private.
  async function authedRepoUrl(repo) {
    if (typeof getSecret !== 'function') return `https://github.com/${repo}.git`;
    let pat = null;
    try { pat = await getSecret('githubPat'); } catch {}
    if (!pat) return `https://github.com/${repo}.git`;
    // x-access-token is GitHub's documented username for PAT-as-password.
    return `https://x-access-token:${encodeURIComponent(pat)}@github.com/${repo}.git`;
  }

  // Returns the install state of git + an auth helper. No env injection
  // (the token rides in the clone URL instead, scoped strictly to the
  // scratch clone; gh CLI removed entirely — MCP covers all of it).
  async function ensureForMission(mission) {
    const r = await check();
    let cloneUrl = null;
    let hasToken = false;
    if (mission?.target?.kind === 'cloud' && mission.target.repo) {
      cloneUrl = await authedRepoUrl(mission.target.repo);
      try { hasToken = !!(typeof getSecret === 'function' && await getSecret('githubPat')); } catch {}
    }
    return {
      git: r.git,
      gitInstalled: r.git.installed,
      gitVersion: r.git.version,
      cloneUrl,
      hasToken,
    };
  }

  ipcMain.handle('gh:ensure-for-mission', async () => {
    try { return { ok: true, ...(await ensureForMission(null)) }; }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });

  return { check, ensureForMission };
};
