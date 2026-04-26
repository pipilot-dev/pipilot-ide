// PiPilot IDE — GitHub API proxy for the renderer
//
// The renderer needs to list repos / branches for the Missions cloud
// picker, but the PAT lives encrypted in main and we don't want to ship
// it across IPC just to make a fetch call. So main owns the fetch and
// returns shaped JSON to the renderer.
//
// Cached for 5 min in-memory to avoid hammering the API while the user
// scrolls the picker. The cache is keyed by endpoint path.

const CACHE_TTL_MS = 5 * 60_000;

module.exports = function register(ipcMain, ctx, deps = {}) {
  const { getSecret } = deps;
  if (typeof getSecret !== 'function') {
    throw new Error('[github] requires deps.getSecret from secrets module');
  }

  const cache = new Map();   // path -> { at, value }

  async function authedFetch(pathOrUrl, opts = {}) {
    const pat = await getSecret('githubPat');
    if (!pat) throw new Error('GitHub not connected');
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : 'https://api.github.com' + pathOrUrl;
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: 'token ' + pat,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'PiPilot-IDE',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`GitHub ${res.status}: ${text.slice(0, 200) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function cached(key, fetcher) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const promise = (async () => {
      try {
        const value = await fetcher();
        cache.set(key, { at: Date.now(), value });
        return value;
      } catch (err) {
        cache.delete(key);
        throw err;
      }
    })();
    return promise;
  }

  // List the user's repos (their own + collaborator + org). Paginates up
  // to 200 (2 pages of 100) — enough for the picker.
  ipcMain.handle('github:list-repos', async (_e, { refresh } = {}) => {
    try {
      if (refresh) cache.delete('repos');
      const value = await cached('repos', async () => {
        const all = [];
        for (const page of [1, 2]) {
          const list = await authedFetch(`/user/repos?per_page=100&sort=updated&page=${page}&affiliation=owner,collaborator,organization_member`);
          if (!Array.isArray(list) || !list.length) break;
          for (const r of list) {
            all.push({
              fullName: r.full_name,
              name: r.name,
              owner: r.owner?.login,
              private: !!r.private,
              defaultBranch: r.default_branch || 'main',
              description: r.description || '',
              updatedAt: r.updated_at,
              language: r.language || null,
            });
          }
          if (list.length < 100) break;
        }
        // Most-recently-updated first.
        all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        return all;
      });
      return { ok: true, repos: value };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), status: err?.status };
    }
  });

  ipcMain.handle('github:list-branches', async (_e, { repo, refresh } = {}) => {
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return { ok: false, error: 'invalid repo (expected owner/name)' };
    }
    try {
      const key = 'branches:' + repo;
      if (refresh) cache.delete(key);
      const value = await cached(key, async () => {
        const list = await authedFetch(`/repos/${repo}/branches?per_page=100`);
        if (!Array.isArray(list)) return [];
        return list.map(b => ({ name: b.name, protected: !!b.protected }));
      });
      return { ok: true, branches: value };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), status: err?.status };
    }
  });

  // Verify the connection — used by the PAT modal too.
  ipcMain.handle('github:whoami', async () => {
    try {
      const u = await authedFetch('/user');
      return { ok: true, login: u.login, name: u.name, avatar: u.avatar_url };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), status: err?.status };
    }
  });

  // Invalidate everything cached when the PAT changes.
  return {
    invalidate() { cache.clear(); },
  };
};
