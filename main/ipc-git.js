// PiPilot IDE — Git IPC handlers (Phase 5)

const path = require('path');
const fs = require('fs');

let simpleGit = null;
try {
  simpleGit = require('simple-git');
} catch (e) {
  console.warn('[ipc-git] simple-git not available:', e.message);
}

module.exports = function register(ipcMain, ctx) {
  function ensureGit() {
    if (!simpleGit) throw new Error('simple-git is not installed. Run `npm install` to enable Git features.');
  }

  function g(p) {
    ensureGit();
    if (!p) throw new Error('projectPath required');
    return simpleGit({ baseDir: p, binary: 'git', maxConcurrentProcesses: 3 });
  }

  function ok(data) { return { ok: true, ...(data || {}) }; }
  function fail(err) {
    const msg = err && err.message ? err.message : String(err);
    return { ok: false, error: msg };
  }

  function notifyChanged() {
    try {
      const win = ctx.getWindow && ctx.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('git:changed', { at: Date.now() });
      }
    } catch {}
  }

  function normalizeStatus(s) {
    return {
      branch: s.current || null,
      tracking: s.tracking || null,
      ahead: s.ahead || 0,
      behind: s.behind || 0,
      detached: !!s.detached,
      files: (s.files || []).map(f => ({
        path: f.path,
        index: f.index,
        working_dir: f.working_dir,
        status: (f.index && f.index !== ' ' ? f.index : '') + (f.working_dir && f.working_dir !== ' ' ? f.working_dir : ''),
      })),
      staged: s.staged || [],
      modified: s.modified || [],
      not_added: s.not_added || [],
      conflicted: s.conflicted || [],
      deleted: s.deleted || [],
      renamed: (s.renamed || []).map(r => typeof r === 'string' ? r : (r.to || r.from || '')),
      created: s.created || [],
    };
  }

  // Ensure .pipilot/ is in .gitignore so checkpoints and internal files don't leak into git
  const ensuredProjects = new Set();
  async function ensureGitignore(projectPath) {
    if (ensuredProjects.has(projectPath)) return;
    ensuredProjects.add(projectPath);
    try {
      const gitDir = path.join(projectPath, '.git');
      await fs.promises.access(gitDir);
      const ignorePath = path.join(projectPath, '.gitignore');
      let content = '';
      try { content = await fs.promises.readFile(ignorePath, 'utf8'); } catch {}
      const lines = content.split(/\r?\n/).map(l => l.trim());
      let additions = '';
      if (!lines.some(l => l === '.pipilot/checkpoints' || l === '.pipilot/checkpoints/')) {
        additions += '.pipilot/checkpoints/\n';
      }
      if (!lines.some(l => l === '.pipilot/search-index.json')) {
        additions += '.pipilot/search-index.json\n';
      }
      if (additions) {
        const nl = content.length && !content.endsWith('\n') ? '\n' : '';
        await fs.promises.writeFile(ignorePath, content + nl + additions, 'utf8');
      }
    } catch {}
  }

  ipcMain.handle('git:status', async (_e, projectPath) => {
    try {
      await ensureGitignore(projectPath);
      const s = await g(projectPath).status();
      return ok({ status: normalizeStatus(s), ...normalizeStatus(s) });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:log', async (_e, payload) => {
    try {
      const { projectPath, opts } = payload || {};
      const limit = (opts && opts.limit) || 50;
      const file = opts && opts.file;
      const args = { maxCount: limit };
      if (file) args.file = file;
      const log = await g(projectPath).log(args);
      const commits = (log.all || []).map(c => ({
        hash: c.hash,
        abbreviatedHash: (c.hash || '').slice(0, 7),
        author: c.author_name,
        email: c.author_email,
        date: c.date,
        message: c.message,
        body: c.body,
        refs: c.refs,
      }));
      return ok({ commits, total: log.total });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:diff', async (_e, payload) => {
    try {
      const { projectPath, file, staged } = payload || {};
      const args = [];
      if (staged) args.push('--staged');
      if (file) args.push('--', file);
      const diff = await g(projectPath).diff(args);
      return ok({ diff: diff || '' });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:add', async (_e, payload) => {
    try {
      const { projectPath, files } = payload || {};
      const target = Array.isArray(files) ? files : (files ? [files] : ['.']);
      await g(projectPath).add(target);
      notifyChanged();
      return ok();
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:commit', async (_e, payload) => {
    try {
      const { projectPath, msg } = payload || {};
      if (!msg || !msg.trim()) throw new Error('Commit message is required');
      const result = await g(projectPath).commit(msg);
      notifyChanged();
      return ok({ hash: result.commit, summary: result.summary, branch: result.branch });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:push', async (_e, payload) => {
    try {
      const { projectPath, opts } = payload || {};
      const repo = g(projectPath);
      const status = await repo.status();
      const branch = (opts && opts.branch) || status.current;
      const remote = (opts && opts.remote) || 'origin';
      if (!branch) throw new Error('No current branch to push');
      let result;
      if (!status.tracking) {
        result = await repo.push(['-u', remote, branch]);
      } else {
        result = await repo.push(remote, branch);
      }
      notifyChanged();
      return ok({ pushed: true, result });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:pull', async (_e, payload) => {
    try {
      const { projectPath, opts } = payload || {};
      const repo = g(projectPath);
      const remote = (opts && opts.remote) || 'origin';
      const status = await repo.status();
      const branch = (opts && opts.branch) || status.current;
      let result;
      if (opts && opts.rebase && branch) {
        result = await repo.pull(remote, branch, { '--rebase': null });
      } else {
        result = branch ? await repo.pull(remote, branch) : await repo.pull();
      }
      notifyChanged();
      return ok({ result });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:fetch', async (_e, payload) => {
    try {
      const { projectPath, remote } = payload || {};
      const repo = g(projectPath);
      const r = await repo.fetch(remote || 'origin');
      notifyChanged();
      return ok({ result: r });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:branches', async (_e, projectPath) => {
    try {
      const repo = g(projectPath);
      const local = await repo.branchLocal();
      let remote = { all: [] };
      try { remote = await repo.branch(['-r']); } catch {}
      return ok({
        current: local.current,
        all: local.all,
        local: local.all,
        remote: remote.all || [],
        branches: local.branches,
      });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:checkout', async (_e, payload) => {
    try {
      const { projectPath, branch } = payload || {};
      if (!branch) throw new Error('Branch name required');
      await g(projectPath).checkout(branch);
      notifyChanged();
      return ok();
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:create-branch', async (_e, payload) => {
    try {
      const { projectPath, name } = payload || {};
      if (!name) throw new Error('Branch name required');
      await g(projectPath).checkoutLocalBranch(name);
      notifyChanged();
      return ok({ branch: name });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:clone', async (_e, payload) => {
    try {
      const { streamId, url, dir } = payload || {};
      if (!url) throw new Error('Repo URL required');
      if (!dir) throw new Error('Target directory required');
      if (!simpleGit) throw new Error('simple-git not available');

      const win = ctx.getWindow && ctx.getWindow();
      const sendProgress = (progress) => {
        if (win && !win.isDestroyed() && streamId) {
          win.webContents.send(`git:clone:progress:${streamId}`, progress);
        }
      };

      const progressHandler = ({ method, stage, progress }) => {
        sendProgress({
          phase: stage || method || 'clone',
          percent: typeof progress === 'number' ? progress : null,
          message: `${method || 'clone'}:${stage || ''} ${progress != null ? progress + '%' : ''}`.trim(),
        });
      };

      const git = simpleGit({ progress: progressHandler });
      git.outputHandler((_cmd, _stdout, stderr) => {
        stderr.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          const lines = text.split(/\r?\n/);
          for (const line of lines) {
            if (!line.trim()) continue;
            const m = line.match(/(\d+)%/);
            sendProgress({
              phase: 'clone',
              percent: m ? parseInt(m[1], 10) : null,
              message: line.trim(),
            });
          }
        });
      });

      await git.clone(url, dir, ['--progress']);
      sendProgress({ phase: 'done', percent: 100, message: 'Clone complete' });
      return ok({ dir });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:merge', async (_e, payload) => {
    try {
      const { projectPath, branch } = payload || {};
      if (!branch) throw new Error('Branch name required');
      const r = await g(projectPath).merge([branch]);
      notifyChanged();
      return ok({ result: r });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:cherry-pick', async (_e, payload) => {
    try {
      const { projectPath, oid } = payload || {};
      if (!oid) throw new Error('Commit hash required');
      const repo = g(projectPath);
      const r = await repo.raw(['cherry-pick', oid]);
      notifyChanged();
      return ok({ result: r });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:delete-branch', async (_e, payload) => {
    try {
      const { projectPath, name, force } = payload || {};
      if (!name) throw new Error('Branch name required');
      const r = await g(projectPath).deleteLocalBranch(name, !!force);
      notifyChanged();
      return ok({ result: r });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:reset', async (_e, payload) => {
    try {
      const { projectPath, mode, ref } = payload || {};
      const m = mode || 'mixed';
      const target = ref || 'HEAD';
      const flag = m === 'soft' ? '--soft' : m === 'hard' ? '--hard' : '--mixed';
      const r = await g(projectPath).reset([flag, target]);
      notifyChanged();
      return ok({ result: r });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:add-remote', async (_e, payload) => {
    try {
      const { projectPath, name, url } = payload || {};
      if (!name) throw new Error('Remote name required');
      if (!url) throw new Error('Remote url required');
      const r = await g(projectPath).addRemote(name, url);
      notifyChanged();
      return ok({ result: r });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:stash', async (_e, payload) => {
    try {
      const { projectPath, opts } = payload || {};
      const repo = g(projectPath);
      const action = (opts && opts.action) || 'push';
      let result;
      switch (action) {
        case 'push': {
          const args = ['push'];
          if (opts && opts.message) args.push('-m', opts.message);
          result = await repo.stash(args);
          break;
        }
        case 'pop': result = await repo.stash(['pop']); break;
        case 'apply': result = await repo.stash(['apply']); break;
        case 'drop': result = await repo.stash(['drop']); break;
        case 'list': result = await repo.stash(['list']); break;
        default: throw new Error('Unknown stash action: ' + action);
      }
      notifyChanged();
      return ok({ result });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:discard', async (_e, payload) => {
    try {
      const { projectPath, file } = payload || {};
      if (!file) throw new Error('File path required');
      await g(projectPath).checkout(['--', file]);
      notifyChanged();
      return ok();
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:unstage', async (_e, payload) => {
    try {
      const { projectPath, files } = payload || {};
      if (!projectPath) throw new Error('projectPath required');
      const fileList = Array.isArray(files) ? files : [files];
      await g(projectPath).reset(['HEAD', '--', ...fileList]);
      notifyChanged(projectPath);
      return ok({});
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:init', async (_e, projectPath) => {
    try {
      await g(projectPath).init();
      notifyChanged();
      return ok();
    } catch (err) { return fail(err); }
  });

  // Show — full info for one commit: message, parent, files changed, full diff
  ipcMain.handle('git:show', async (_e, payload) => {
    try {
      const { projectPath, hash } = payload || {};
      if (!projectPath || !hash) throw new Error('projectPath and hash required');
      const repo = g(projectPath);
      const stat = await repo.show(['--stat', '--format=fuller', hash]);
      const diff = await repo.show(['--patch', '--format=', hash]);
      // Pull commit metadata via show with a delimited format we can parse
      const meta = await repo.show([
        '--no-patch',
        '--format=%H%n%h%n%an%n%ae%n%ad%n%cn%n%ce%n%cd%n%P%n%s%n%b',
        hash,
      ]);
      const lines = (meta || '').split('\n');
      const commit = {
        hash: lines[0] || hash,
        abbreviatedHash: lines[1] || hash.slice(0, 7),
        author: lines[2] || '',
        email: lines[3] || '',
        date: lines[4] || '',
        committer: lines[5] || '',
        committerEmail: lines[6] || '',
        commitDate: lines[7] || '',
        parents: (lines[8] || '').split(/\s+/).filter(Boolean),
        subject: lines[9] || '',
        body: lines.slice(10).join('\n'),
      };
      return ok({ commit, stat, diff });
    } catch (err) { return fail(err); }
  });

  // Diff a single file vs HEAD (or vs index when staged=true). Returns the
  // raw "old" and "new" file contents so the renderer can show them in a
  // Monaco diff editor instead of a unified-text patch.
  ipcMain.handle('git:file-versions', async (_e, payload) => {
    try {
      const { projectPath, file, staged } = payload || {};
      if (!projectPath || !file) throw new Error('projectPath and file required');
      const repo = g(projectPath);
      const fsp = require('fs').promises;
      const path = require('path');
      let original = '';
      let modified = '';
      try {
        original = await repo.show([`HEAD:${file}`]);
      } catch { original = ''; }
      if (staged) {
        try { modified = await repo.show([`:${file}`]); } catch { modified = ''; }
      } else {
        try { modified = await fsp.readFile(path.join(projectPath, file), 'utf8'); } catch { modified = ''; }
      }
      return ok({ original, modified });
    } catch (err) { return fail(err); }
  });
};
