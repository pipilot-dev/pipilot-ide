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
      if (!projectPath || !file) throw new Error('projectPath and file required');
      const repo = g(projectPath);
      if (file === '.') {
        // Full discard: revert tracked changes AND remove untracked files+dirs.
        // Matches VS Code's "Discard All Changes".
        try { await repo.checkout(['--', '.']); } catch {}
        try { await repo.clean('f', ['-d']); } catch {}
      } else {
        // Single file: checkout first (works for tracked modifications/deletions).
        // If it fails, the file is untracked — delete it from disk.
        let checkoutErr = null;
        try { await repo.checkout(['--', file]); } catch (err) { checkoutErr = err; }
        if (checkoutErr) {
          try {
            const fsp = require('fs').promises;
            const filePath = path.join(projectPath, file);
            const stat = await fsp.stat(filePath);
            if (stat.isDirectory()) await fsp.rm(filePath, { recursive: true, force: true });
            else await fsp.unlink(filePath);
          } catch (delErr) {
            throw checkoutErr; // surface original git error
          }
        }
      }
      notifyChanged();
      return ok();
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:list-remotes', async (_e, projectPath) => {
    try {
      if (!projectPath) throw new Error('projectPath required');
      const repo = g(projectPath);
      const list = await repo.getRemotes(true);
      const remotes = (list || []).map(r => ({
        name: r.name,
        fetch: r.refs?.fetch || '',
        push: r.refs?.push || r.refs?.fetch || '',
      }));
      return ok({ remotes });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('git:remove-remote', async (_e, payload) => {
    try {
      const { projectPath, name } = payload || {};
      if (!projectPath || !name) throw new Error('projectPath and name required');
      await g(projectPath).removeRemote(name);
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

  // ---------- Blame: per-file line→commit map ----------
  // Cache key = `${projectPath}\0${file}\0${headSha}`. Invalidated implicitly
  // on every commit/checkout (HEAD sha changes), and explicitly via the
  // git:changed broadcast on the renderer side (it just calls again — main
  // re-reads when the cached sha differs).
  const blameCache = new Map();
  async function getHeadSha(projectPath) {
    try {
      const r = await g(projectPath).revparse(['HEAD']);
      return (r || '').trim();
    } catch { return ''; }
  }
  function parseBlamePorcelain(text) {
    // simple-git's blame output: line-porcelain format, one section per line.
    // First line: "<sha> <origLine> <finalLine> [<groupSize>]"
    // Then header lines (only on first appearance of sha): author, author-mail,
    //   author-time, author-tz, summary, etc.
    // Then "\t<line content>"
    const out = [];
    if (!text) return out;
    const commits = new Map(); // sha → meta
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const head = lines[i++];
      if (!head) continue;
      const m = head.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
      if (!m) continue;
      const sha = m[1];
      const finalLine = parseInt(m[3], 10);
      let meta = commits.get(sha);
      if (!meta) meta = { sha };
      while (i < lines.length && !lines[i].startsWith('\t')) {
        const ln = lines[i++];
        if (ln.startsWith('author ')) meta.author = ln.slice(7);
        else if (ln.startsWith('author-mail ')) meta.email = ln.slice(12).replace(/^<|>$/g, '');
        else if (ln.startsWith('author-time ')) meta.timestamp = parseInt(ln.slice(12), 10);
        else if (ln.startsWith('author-tz ')) meta.tz = ln.slice(10);
        else if (ln.startsWith('summary ')) meta.summary = ln.slice(8);
        else if (ln.startsWith('previous ')) meta.previous = ln.slice(9);
      }
      commits.set(sha, meta);
      // Skip the "\t<content>" line
      if (i < lines.length && lines[i].startsWith('\t')) i++;
      out.push({ line: finalLine, sha, meta });
    }
    // Flatten meta into each entry for renderer convenience
    return out.map(e => ({
      line: e.line,
      sha: e.sha,
      author: commits.get(e.sha)?.author || '',
      email: commits.get(e.sha)?.email || '',
      timestamp: commits.get(e.sha)?.timestamp || 0,
      summary: commits.get(e.sha)?.summary || '',
    }));
  }

  ipcMain.handle('git:blame', async (_e, payload) => {
    try {
      const { projectPath, file } = payload || {};
      if (!projectPath || !file) throw new Error('projectPath and file required');
      const head = await getHeadSha(projectPath);
      const key = projectPath + '\0' + file + '\0' + head;
      if (blameCache.has(key)) return ok({ blame: blameCache.get(key), head });
      const repo = g(projectPath);
      const raw = await repo.raw(['blame', '--line-porcelain', '-w', '--', file]);
      const blame = parseBlamePorcelain(raw);
      blameCache.set(key, blame);
      // Cap cache: drop oldest when >40 files
      if (blameCache.size > 40) {
        const firstKey = blameCache.keys().next().value;
        blameCache.delete(firstKey);
      }
      return ok({ blame, head });
    } catch (err) { return fail(err); }
  });

  // ---------- Commit info: hover-card payload ----------
  ipcMain.handle('git:commit-info', async (_e, payload) => {
    try {
      const { projectPath, hash } = payload || {};
      if (!projectPath || !hash) throw new Error('projectPath and hash required');
      const repo = g(projectPath);
      const meta = await repo.show([
        '--no-patch',
        '--format=%H%n%h%n%an%n%ae%n%aI%n%s%n%b',
        hash,
      ]);
      const parts = (meta || '').split('\n');
      const subject = parts[5] || '';
      const body = parts.slice(6).join('\n').trim();
      // Diff numstat: per-file additions/deletions
      let additions = 0, deletions = 0, files = 0;
      try {
        const stat = await repo.raw(['show', '--numstat', '--format=', hash]);
        for (const ln of (stat || '').split('\n')) {
          const m = ln.match(/^(\d+|-)\s+(\d+|-)\s+/);
          if (m) {
            additions += m[1] === '-' ? 0 : parseInt(m[1], 10);
            deletions += m[2] === '-' ? 0 : parseInt(m[2], 10);
            files++;
          }
        }
      } catch {}
      return ok({
        commit: {
          hash: parts[0] || hash,
          shortHash: parts[1] || hash.slice(0, 7),
          author: parts[2] || '',
          email: parts[3] || '',
          date: parts[4] || '',
          subject,
          body,
          additions,
          deletions,
          filesChanged: files,
        },
      });
    } catch (err) { return fail(err); }
  });

  // ---------- Read a file's content at a specific commit ----------
  ipcMain.handle('git:show-file', async (_e, payload) => {
    try {
      const { projectPath, hash, file } = payload || {};
      if (!projectPath || !hash || !file) throw new Error('projectPath, hash and file required');
      const repo = g(projectPath);
      const content = await repo.show([`${hash}:${file}`]);
      return ok({ content: content || '' });
    } catch (err) { return fail(err); }
  });

  // ---------- Read a binary blob at a specific commit (base64) ----------
  // Uses spawn directly so we never UTF-8-decode binary bytes (which would
  // mangle them). Streams stdout into a buffer with a hard size cap to
  // avoid OOM on huge media.
  const BINARY_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
  ipcMain.handle('git:show-file-binary', async (_e, payload) => {
    try {
      const { projectPath, hash, file } = payload || {};
      if (!projectPath || !hash || !file) throw new Error('projectPath, hash and file required');
      const { spawn } = require('child_process');
      // First check size via cat-file -s so we can refuse early
      const sizeBuf = await new Promise((resolve, reject) => {
        const p = spawn('git', ['cat-file', '-s', `${hash}:${file}`], { cwd: projectPath });
        const chunks = []; const errs = [];
        p.stdout.on('data', c => chunks.push(c));
        p.stderr.on('data', c => errs.push(c));
        p.on('error', reject);
        p.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errs).toString() || 'git cat-file failed')));
      });
      const size = parseInt(sizeBuf.toString().trim(), 10) || 0;
      if (size > BINARY_MAX_BYTES) {
        return ok({ tooLarge: true, size, maxBytes: BINARY_MAX_BYTES });
      }
      const buf = await new Promise((resolve, reject) => {
        const p = spawn('git', ['show', `${hash}:${file}`], { cwd: projectPath });
        const chunks = []; const errs = []; let total = 0;
        p.stdout.on('data', c => {
          total += c.length;
          if (total > BINARY_MAX_BYTES) { p.kill(); return reject(new Error('exceeds size cap')); }
          chunks.push(c);
        });
        p.stderr.on('data', c => errs.push(c));
        p.on('error', reject);
        p.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errs).toString() || 'git show failed')));
      });
      return ok({ base64: buf.toString('base64'), size: buf.length });
    } catch (err) { return fail(err); }
  });

  // ---------- Remote info: detect GitHub origin ----------
  ipcMain.handle('git:remote-info', async (_e, projectPath) => {
    try {
      if (!projectPath) throw new Error('projectPath required');
      const repo = g(projectPath);
      let url = '';
      try { url = (await repo.raw(['remote', 'get-url', 'origin'])).trim(); } catch {}
      // Parse owner/repo from common github URLs
      let github = null;
      if (url) {
        const m = url.match(/github\.com[:/]+([^/]+)\/([^/.]+)(\.git)?\/?$/i);
        if (m) github = { owner: m[1], repo: m[2], commitUrl: (sha) => `https://github.com/${m[1]}/${m[2]}/commit/${sha}` };
      }
      return ok({ url, github: github ? { owner: github.owner, repo: github.repo } : null });
    } catch (err) { return fail(err); }
  });
};
