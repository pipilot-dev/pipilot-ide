// PiPilot IDE — Publish: one-click "push my project to GitHub / GitLab".
//
// Owns the local-git side of the flow:
//   1. Read git state at projectPath (initialized? branch? remote? commits?).
//   2. Create the repo on the remote provider via the existing
//      github:create-repo / gitlab:create-project IPC handlers (called
//      directly from JS — they already validate the PAT for us).
//   3. git init if needed → write a default README + .gitignore if the
//      working tree is empty → git add -A → git commit -m "Initial commit
//      from PiPilot" → git remote add origin <url> → git push -u origin
//      <branch>.
//   4. Stream every step to the renderer via `publish:event` so the
//      deploy tab can show a live progress log.

const path = require('path');
const fsp = require('fs').promises;

let simpleGit;
try { simpleGit = require('simple-git'); } catch {}

const SUPPORTED_PROVIDERS = ['github', 'gitlab'];

function emit(ctx, requestId, type, payload) {
  try {
    const win = ctx.getWindow && ctx.getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('publish:event', { requestId, type, ...(payload || {}) });
  } catch {}
}

async function fileExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

const DEFAULT_GITIGNORE = `node_modules/
.env
.env.local
dist/
build/
.next/
.cache/
.DS_Store
.pipilot/checkpoints/
.pipilot/search-index.json
`;

function defaultReadme(projectName) {
  return `# ${projectName}\n\nProject created with [PiPilot](https://pipilot.dev).\n`;
}

module.exports = function register(ipcMain, ctx, deps = {}) {
  function ok(d) { return { ok: true, ...(d || {}) }; }
  function fail(e) { return { ok: false, error: e?.message || String(e) }; }

  // Quick read-only state probe — feeds the deploy tab header.
  ipcMain.handle('publish:get-state', async (_e, { projectPath } = {}) => {
    try {
      if (!projectPath) throw new Error('projectPath required');
      if (!simpleGit) throw new Error('simple-git unavailable');
      const exists = await fileExists(projectPath);
      if (!exists) throw new Error('project path does not exist');

      const git = simpleGit({ baseDir: projectPath });
      const inited = await git.checkIsRepo().catch(() => false);
      let state = { initialized: !!inited, branch: null, hasCommits: false, remotes: [], lastCommit: null };

      if (inited) {
        try {
          const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
          state.branch = String(branch || '').trim() || null;
        } catch { state.branch = null; }

        try {
          const log = await git.log(['-1']).catch(() => null);
          if (log?.latest) {
            state.hasCommits = true;
            state.lastCommit = {
              hash: log.latest.hash,
              shortHash: String(log.latest.hash || '').slice(0, 7),
              message: log.latest.message,
              date: log.latest.date,
              author: log.latest.author_name,
            };
          }
        } catch {}

        try {
          const rem = await git.getRemotes(true);
          state.remotes = (rem || []).map(r => ({
            name: r.name,
            url: r.refs?.fetch || r.refs?.push || '',
          }));
        } catch {}
      }

      const folderName = path.basename(path.normalize(projectPath));
      return ok({ state, projectName: folderName });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('publish:create-and-push', async (event, payload = {}) => {
    const requestId = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { provider, projectPath, name, description, isPrivate, owner, namespaceId, branch } = payload;
      if (!SUPPORTED_PROVIDERS.includes(provider)) throw new Error(`unsupported provider: ${provider}`);
      if (!projectPath) throw new Error('projectPath required');
      if (!name) throw new Error('name required');
      if (!simpleGit) throw new Error('simple-git unavailable');

      emit(ctx, requestId, 'log', { message: `Starting publish to ${provider} as "${name}"…` });

      // ── 1. Create the remote repo ────────────────────────────────
      emit(ctx, requestId, 'step', { step: 'create-remote', message: `Creating repo on ${provider}…` });
      let createResp;
      if (provider === 'github') {
        createResp = await deps.createGithubRepo({ name, description, isPrivate, owner });
      } else {
        createResp = await deps.createGitlabProject({ name, description, visibility: isPrivate ? 'private' : 'public', namespaceId });
      }
      if (!createResp?.ok) throw new Error(`remote create failed: ${createResp?.error || 'unknown'}`);

      const repo = provider === 'github' ? createResp.repo : createResp.project;
      const httpUrl = repo.httpUrl;
      const webUrl = repo.webUrl;
      const remoteBranch = branch || repo.defaultBranch || 'main';
      emit(ctx, requestId, 'log', { message: `Created ${webUrl}` });

      // Build an authenticated push URL so we don't need a credential helper
      // configured on the user's machine. Only used for the single push;
      // never written to disk via `git remote set-url`.
      let pushUrl = httpUrl;
      try {
        const u = new URL(httpUrl);
        const pat = await deps.getSecret(provider === 'github' ? 'githubPat' : 'gitlabPat');
        if (pat) {
          if (provider === 'github') {
            u.username = 'x-access-token';
            u.password = pat;
          } else {
            u.username = 'oauth2';
            u.password = pat;
          }
          pushUrl = u.toString();
        }
      } catch {}

      const git = simpleGit({ baseDir: projectPath });

      // ── 2. Initialize git if needed ──────────────────────────────
      const isRepo = await git.checkIsRepo().catch(() => false);
      if (!isRepo) {
        emit(ctx, requestId, 'step', { step: 'git-init', message: 'git init …' });
        await git.init();
        // Set the initial branch name to match the remote's default.
        try { await git.raw(['symbolic-ref', 'HEAD', `refs/heads/${remoteBranch}`]); } catch {}
      }

      // Seed README + .gitignore if the working tree is empty so the
      // first push doesn't fail with "nothing to commit".
      const entries = await fsp.readdir(projectPath).catch(() => []);
      const onlyMeta = entries.every(e => e === '.git' || e === '.pipilot');
      if (onlyMeta) {
        emit(ctx, requestId, 'log', { message: 'Project is empty — seeding README + .gitignore' });
        await fsp.writeFile(path.join(projectPath, 'README.md'), defaultReadme(name), 'utf8');
        await fsp.writeFile(path.join(projectPath, '.gitignore'), DEFAULT_GITIGNORE, 'utf8');
      } else if (!(await fileExists(path.join(projectPath, '.gitignore')))) {
        await fsp.writeFile(path.join(projectPath, '.gitignore'), DEFAULT_GITIGNORE, 'utf8');
      }

      // ── 3. Commit if there are unstaged changes ──────────────────
      const status = await git.status();
      if (status.files.length > 0 || !(await git.log(['-1']).catch(() => null))?.latest) {
        emit(ctx, requestId, 'step', { step: 'git-commit', message: 'git add -A && git commit …' });
        await git.add('-A');
        // Configure user.name/email locally if missing — git refuses to
        // commit otherwise on fresh installs.
        try {
          const name = (await git.raw(['config', 'user.name']).catch(() => '')).trim();
          if (!name) await git.raw(['config', 'user.name', 'PiPilot User']);
          const email = (await git.raw(['config', 'user.email']).catch(() => '')).trim();
          if (!email) await git.raw(['config', 'user.email', 'noreply@pipilot.dev']);
        } catch {}
        await git.commit('Initial commit from PiPilot');
      }

      // ── 4. Remote + push ─────────────────────────────────────────
      emit(ctx, requestId, 'step', { step: 'git-remote', message: `git remote add origin ${httpUrl}` });
      const remotes = await git.getRemotes(true);
      const hasOrigin = remotes.find(r => r.name === 'origin');
      if (hasOrigin) {
        await git.removeRemote('origin').catch(() => {});
      }
      await git.addRemote('origin', httpUrl);

      emit(ctx, requestId, 'step', { step: 'git-push', message: `git push -u origin ${remoteBranch}` });
      await git.push(['-u', pushUrl, `HEAD:${remoteBranch}`]);

      emit(ctx, requestId, 'done', { webUrl, httpUrl, branch: remoteBranch });
      return ok({ requestId, webUrl, httpUrl, branch: remoteBranch });
    } catch (err) {
      emit(ctx, requestId, 'error', { message: err?.message || String(err) });
      return fail(err);
    }
  });
};
