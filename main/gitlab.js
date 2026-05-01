// PiPilot IDE — GitLab API proxy.
// Mirrors the shape of main/github.js: PAT lives in the secrets store
// under `gitlabPat`, this module owns the fetch and returns shaped JSON.
//
// Defaults to gitlab.com but `getSecret('gitlabHost')` lets users point
// at a self-hosted instance (e.g. https://gitlab.example.com).

const CACHE_TTL_MS = 5 * 60_000;

module.exports = function register(ipcMain, ctx, deps = {}) {
  const { getSecret } = deps;
  if (typeof getSecret !== 'function') {
    throw new Error('[gitlab] requires deps.getSecret from secrets module');
  }

  const cache = new Map();

  async function host() {
    const h = (await getSecret('gitlabHost')) || 'https://gitlab.com';
    return h.replace(/\/+$/, '');
  }

  async function authedFetch(pathOrUrl, opts = {}) {
    const pat = await getSecret('gitlabPat');
    if (!pat) throw new Error('GitLab not connected');
    const base = await host();
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : base + '/api/v4' + pathOrUrl;
    const res = await fetch(url, {
      ...opts,
      headers: {
        'PRIVATE-TOKEN': pat,
        'Content-Type': 'application/json',
        'User-Agent': 'PiPilot-IDE',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`GitLab ${res.status}: ${text.slice(0, 200) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function cached(key, fetcher) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const promise = (async () => {
      try { const v = await fetcher(); cache.set(key, { at: Date.now(), value: v }); return v; }
      catch (err) { cache.delete(key); throw err; }
    })();
    return promise;
  }

  ipcMain.handle('gitlab:whoami', async () => {
    try {
      const u = await authedFetch('/user');
      return { ok: true, login: u.username, name: u.name, avatar: u.avatar_url, host: await host() };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), status: err?.status };
    }
  });

  // List the user's namespaces (personal + groups). Used by the deploy
  // tab's "owner" picker so users can publish into a group they manage.
  ipcMain.handle('gitlab:list-namespaces', async (_e, { refresh } = {}) => {
    try {
      if (refresh) cache.delete('namespaces');
      const value = await cached('namespaces', async () => {
        const list = await authedFetch('/namespaces?per_page=100');
        if (!Array.isArray(list)) return [];
        return list.map(n => ({
          id: n.id,
          path: n.full_path,        // gitlab path used in URLs
          name: n.name,
          kind: n.kind,             // 'user' | 'group'
        }));
      });
      return { ok: true, namespaces: value };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), status: err?.status };
    }
  });

  async function createProject({ name, description, visibility, namespaceId } = {}) {
    if (!name) throw new Error('name required');
    const body = {
      name,
      description: description || '',
      visibility: visibility || 'private',
      initialize_with_readme: false,
    };
    if (namespaceId) body.namespace_id = namespaceId;
    const proj = await authedFetch('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    cache.delete('namespaces');
    return {
      ok: true,
      project: {
        id: proj.id,
        path: proj.path_with_namespace,
        httpUrl: proj.http_url_to_repo,
        sshUrl: proj.ssh_url_to_repo,
        webUrl: proj.web_url,
        defaultBranch: proj.default_branch || 'main',
        visibility: proj.visibility,
      },
    };
  }

  ipcMain.handle('gitlab:create-project', async (_e, payload) => {
    try { return await createProject(payload || {}); }
    catch (err) { return { ok: false, error: err?.message || String(err), status: err?.status }; }
  });

  return { invalidate() { cache.clear(); }, createProject };
};
