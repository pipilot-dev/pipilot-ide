// PiPilot IDE — Cloudflare Pages REST API client.
// Token from cloud-tokens.json. Used by the Deploy Hub for rollback and
// env-var management. Cloudflare requires an account ID for every
// request; if the user didn't supply one in the deploy dialog, we
// auto-discover by listing accessible accounts (only valid when the
// token has access to exactly one).

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
    return decryptToken(all.cloudflare);
  }

  async function api(pathOrUrl, opts = {}) {
    const token = await getToken();
    if (!token) throw new Error('Cloudflare not connected.');
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : 'https://api.cloudflare.com/client/v4' + pathOrUrl;
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'PiPilot-IDE',
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data && data.success === false)) {
      const errMsg = data?.errors?.[0]?.message || data?.error?.message || res.statusText;
      const err = new Error(`Cloudflare ${res.status}: ${errMsg}`);
      err.status = res.status;
      throw err;
    }
    return data?.result ?? data;
  }

  let cachedAccountId = null;
  async function resolveAccountId(provided) {
    if (provided) return provided;
    if (cachedAccountId) return cachedAccountId;
    const list = await api('/accounts?per_page=50');
    if (!Array.isArray(list) || !list.length) throw new Error('No Cloudflare accounts accessible by this token.');
    if (list.length > 1) throw new Error('Multiple Cloudflare accounts available — set "Account ID" in the deploy dialog.');
    cachedAccountId = list[0].id;
    return cachedAccountId;
  }

  ipcMain.handle('cloudflare:rollback-deployment', async (_e, { accountId, projectName, deploymentId } = {}) => {
    try {
      if (!projectName || !deploymentId) throw new Error('projectName + deploymentId required');
      const aid = await resolveAccountId(accountId);
      const result = await api(`/accounts/${encodeURIComponent(aid)}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}/rollback`, {
        method: 'POST',
      });
      return ok({ deployment: result });
    } catch (err) { return fail(err); }
  });

  // Cloudflare Pages stores env vars under deployment_configs.<env>.env_vars
  // on the project itself, not as separate resources.
  ipcMain.handle('cloudflare:list-env', async (_e, { accountId, projectName } = {}) => {
    try {
      if (!projectName) throw new Error('projectName required');
      const aid = await resolveAccountId(accountId);
      const project = await api(`/accounts/${encodeURIComponent(aid)}/pages/projects/${encodeURIComponent(projectName)}`);
      const out = [];
      for (const env of ['production', 'preview']) {
        const vars = project?.deployment_configs?.[env]?.env_vars || {};
        for (const [k, v] of Object.entries(vars)) {
          out.push({ key: k, value: v?.value ?? '', target: env, type: v?.type || 'plain_text' });
        }
      }
      out.sort((a, b) => a.key.localeCompare(b.key) || a.target.localeCompare(b.target));
      return ok({ envs: out });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('cloudflare:set-env', async (_e, { accountId, projectName, key, value, target } = {}) => {
    try {
      if (!projectName || !key) throw new Error('projectName + key required');
      const aid = await resolveAccountId(accountId);
      const targets = Array.isArray(target) && target.length ? target : ['production', 'preview'];
      const patch = { deployment_configs: {} };
      for (const t of targets) {
        patch.deployment_configs[t] = { env_vars: { [key]: { value: String(value ?? ''), type: 'plain_text' } } };
      }
      const result = await api(`/accounts/${encodeURIComponent(aid)}/pages/projects/${encodeURIComponent(projectName)}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      return ok({ project: result });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('cloudflare:delete-env', async (_e, { accountId, projectName, key, target } = {}) => {
    try {
      if (!projectName || !key) throw new Error('projectName + key required');
      const aid = await resolveAccountId(accountId);
      const targets = Array.isArray(target) && target.length ? target : ['production', 'preview'];
      const patch = { deployment_configs: {} };
      for (const t of targets) {
        patch.deployment_configs[t] = { env_vars: { [key]: null } };
      }
      const result = await api(`/accounts/${encodeURIComponent(aid)}/pages/projects/${encodeURIComponent(projectName)}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      return ok({ project: result });
    } catch (err) { return fail(err); }
  });
};
