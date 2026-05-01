// PiPilot IDE — Vercel REST API client.
// Owns env-var management (GET/POST/PATCH/DELETE) and project lookup
// for the Deploy Hub. Token is read from the cloud-tokens.json store
// (cloud:save-token populated it via the Vercel connector card).

const fsp = require('fs').promises;
const path = require('path');

let safeStorage = null;
try { ({ safeStorage } = require('electron')); } catch {}

function decryptToken(rec) {
  if (!rec || !rec.token) return null;
  if (rec.token.enc === 'safeStorage' && safeStorage?.isEncryptionAvailable?.()) {
    try { return safeStorage.decryptString(Buffer.from(rec.token.value, 'base64')); } catch { return null; }
  }
  if (rec.token.enc === 'base64') {
    try { return Buffer.from(rec.token.value, 'base64').toString('utf8'); } catch { return null; }
  }
  return null;
}

module.exports = function register(ipcMain, ctx) {
  const tokensFile = path.join(ctx.userDataPath, 'cloud-tokens.json');
  const projectMapFile = path.join(ctx.userDataPath, 'vercel-project-map.json');

  function ok(d) { return { ok: true, ...(d || {}) }; }
  function fail(e) { return { ok: false, error: e?.message || String(e), status: e?.status }; }

  async function readJsonSafe(file, fallback) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
  }
  async function writeJson(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }

  async function getToken() {
    const all = await readJsonSafe(tokensFile, {});
    return decryptToken(all.vercel);
  }

  async function api(pathOrUrl, opts = {}) {
    const token = await getToken();
    if (!token) throw new Error('Vercel not connected. Connect it from the Deploy Hub first.');
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : 'https://api.vercel.com' + pathOrUrl;
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'PiPilot-IDE',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Vercel ${res.status}: ${text.slice(0, 200) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // List the user's projects. Used by the env-vars dialog so users
  // can confirm we picked the right Vercel project for their local
  // folder. Sorted by updatedAt desc.
  ipcMain.handle('vercel:list-projects', async () => {
    try {
      const data = await api('/v9/projects?limit=100');
      const projects = (data?.projects || []).map(p => ({
        id: p.id,
        name: p.name,
        framework: p.framework,
        updatedAt: p.updatedAt,
        latestUrl: p.targets?.production?.url || null,
      }));
      projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return ok({ projects });
    } catch (err) { return fail(err); }
  });

  // Persist which Vercel project a local folder maps to so we don't
  // re-prompt every time the env-vars dialog opens.
  ipcMain.handle('vercel:set-project-map', async (_e, { projectPath, vercelProjectId, vercelProjectName } = {}) => {
    try {
      if (!projectPath || !vercelProjectId) throw new Error('projectPath + vercelProjectId required');
      const map = await readJsonSafe(projectMapFile, {});
      map[projectPath] = { id: vercelProjectId, name: vercelProjectName || null };
      await writeJson(projectMapFile, map);
      return ok({});
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('vercel:get-project-map', async (_e, { projectPath } = {}) => {
    const map = await readJsonSafe(projectMapFile, {});
    return ok({ mapping: map[projectPath] || null });
  });

  ipcMain.handle('vercel:list-env', async (_e, { vercelProjectId } = {}) => {
    try {
      if (!vercelProjectId) throw new Error('vercelProjectId required');
      // decrypt=true returns the actual values; without it we only get
      // metadata + masked previews — useless for editing.
      const data = await api(`/v9/projects/${encodeURIComponent(vercelProjectId)}/env?decrypt=true`);
      const envs = (data?.envs || []).map(e => ({
        id: e.id,
        key: e.key,
        value: e.value,
        type: e.type,                       // 'plain' | 'encrypted' | 'system' | 'secret' | 'sensitive'
        target: e.target || [],             // ['production', 'preview', 'development']
        gitBranch: e.gitBranch || null,
        updatedAt: e.updatedAt || null,
      }));
      // Stable order: by key alphabetical.
      envs.sort((a, b) => a.key.localeCompare(b.key));
      return ok({ envs });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('vercel:set-env', async (_e, { vercelProjectId, key, value, target } = {}) => {
    try {
      if (!vercelProjectId) throw new Error('vercelProjectId required');
      if (!key) throw new Error('key required');
      const targets = Array.isArray(target) && target.length ? target : ['production', 'preview', 'development'];
      const body = {
        key,
        value: value ?? '',
        type: 'encrypted',
        target: targets,
      };
      // upsert: if a var with the same key+target exists, Vercel returns
      // 400. We catch that, fetch the existing id, and PATCH instead.
      try {
        const created = await api(`/v10/projects/${encodeURIComponent(vercelProjectId)}/env?upsert=true`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return ok({ env: created });
      } catch (err) {
        // Fallback for the rare case upsert doesn't apply (older API).
        if (err.status !== 400) throw err;
        const existing = await api(`/v9/projects/${encodeURIComponent(vercelProjectId)}/env?decrypt=true`);
        const match = (existing?.envs || []).find(e => e.key === key && (e.target || []).some(t => targets.includes(t)));
        if (!match) throw err;
        const updated = await api(`/v9/projects/${encodeURIComponent(vercelProjectId)}/env/${encodeURIComponent(match.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ value: value ?? '', target: targets }),
        });
        return ok({ env: updated });
      }
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('vercel:delete-env', async (_e, { vercelProjectId, envId } = {}) => {
    try {
      if (!vercelProjectId || !envId) throw new Error('vercelProjectId + envId required');
      await api(`/v9/projects/${encodeURIComponent(vercelProjectId)}/env/${encodeURIComponent(envId)}`, {
        method: 'DELETE',
      });
      return ok({});
    } catch (err) { return fail(err); }
  });

  // ── Custom domains ────────────────────────────────────────────────
  ipcMain.handle('vercel:list-domains', async (_e, { vercelProjectId } = {}) => {
    try {
      if (!vercelProjectId) throw new Error('vercelProjectId required');
      const data = await api(`/v9/projects/${encodeURIComponent(vercelProjectId)}/domains`);
      const domains = (data?.domains || []).map(d => ({
        name: d.name,
        verified: !!d.verified,
        verification: d.verification || [],     // [{type, domain, value, reason}, ...] (DNS hints)
        gitBranch: d.gitBranch || null,
      }));
      return ok({ domains });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('vercel:add-domain', async (_e, { vercelProjectId, domain } = {}) => {
    try {
      if (!vercelProjectId || !domain) throw new Error('vercelProjectId + domain required');
      const result = await api(`/v10/projects/${encodeURIComponent(vercelProjectId)}/domains`, {
        method: 'POST',
        body: JSON.stringify({ name: domain }),
      });
      return ok({ domain: result });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('vercel:delete-domain', async (_e, { vercelProjectId, domain } = {}) => {
    try {
      if (!vercelProjectId || !domain) throw new Error('vercelProjectId + domain required');
      await api(`/v9/projects/${encodeURIComponent(vercelProjectId)}/domains/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
      });
      return ok({});
    } catch (err) { return fail(err); }
  });
};
