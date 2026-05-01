// PiPilot IDE — Netlify REST API client.
// Token from cloud-tokens.json. Used by the Deploy Hub for restore-from-
// history (rolls back the published deploy to any prior one) and env vars.

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

  function ok(d) { return { ok: true, ...(d || {}) }; }
  function fail(e) { return { ok: false, error: e?.message || String(e), status: e?.status }; }

  async function readJsonSafe(file, fallback) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
  }

  async function getToken() {
    const all = await readJsonSafe(tokensFile, {});
    return decryptToken(all.netlify);
  }

  async function api(pathOrUrl, opts = {}) {
    const token = await getToken();
    if (!token) throw new Error('Netlify not connected.');
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : 'https://api.netlify.com' + pathOrUrl;
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
      const err = new Error(`Netlify ${res.status}: ${text.slice(0, 200) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return res.json();
    return res.text();
  }

  // Netlify identifies sites by either UUID OR slug — both work for
  // /api/v1/sites/{site}/... endpoints.
  ipcMain.handle('netlify:restore-deploy', async (_e, { siteSlug, deployId } = {}) => {
    try {
      if (!siteSlug || !deployId) throw new Error('siteSlug + deployId required');
      const result = await api(`/api/v1/sites/${encodeURIComponent(siteSlug)}/deploys/${encodeURIComponent(deployId)}/restore`, {
        method: 'POST',
      });
      return ok({ deploy: result });
    } catch (err) { return fail(err); }
  });

  // Per-site env vars (legacy v1 endpoint — works without account_slug).
  ipcMain.handle('netlify:list-env', async (_e, { siteSlug } = {}) => {
    try {
      if (!siteSlug) throw new Error('siteSlug required');
      const list = await api(`/api/v1/sites/${encodeURIComponent(siteSlug)}/env_vars`);
      // Some sites land on the new account-scoped API and return 404 here
      // — caller can fall back if needed.
      const envs = (Array.isArray(list) ? list : []).map(e => ({
        key: e.key,
        value: (e.values && e.values[0]?.value) ?? e.value ?? '',
        targets: (e.values || []).map(v => v.context).filter(Boolean),
      }));
      envs.sort((a, b) => a.key.localeCompare(b.key));
      return ok({ envs });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('netlify:set-env', async (_e, { siteSlug, key, value } = {}) => {
    try {
      if (!siteSlug || !key) throw new Error('siteSlug + key required');
      const body = [{ key, values: [{ value: value ?? '', context: 'all' }] }];
      const r = await api(`/api/v1/sites/${encodeURIComponent(siteSlug)}/env_vars`, {
        method: 'POST', body: JSON.stringify(body),
      });
      return ok({ result: r });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('netlify:delete-env', async (_e, { siteSlug, key } = {}) => {
    try {
      if (!siteSlug || !key) throw new Error('siteSlug + key required');
      await api(`/api/v1/sites/${encodeURIComponent(siteSlug)}/env_vars/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      return ok({});
    } catch (err) { return fail(err); }
  });
};
