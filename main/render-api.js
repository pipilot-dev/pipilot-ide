// PiPilot IDE — Render REST API client.
// Render has no first-class deploy CLI; their model is "service is
// linked to a git repo, deploys trigger a pull + build". So instead of
// uploading files like Vercel/Netlify, we POST to /v1/services/{id}/deploys
// and poll until the build finishes.
//
// Token from cloud-tokens.json. Per-project mapping (which Render
// service does this folder belong to?) lives in
// <userData>/render-service-map.json.

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

function emit(ctx, runId, type, payload) {
  try {
    const win = ctx.getWindow?.();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('deploy:event', { runId, type, ...(payload || {}) });
  } catch {}
}

module.exports = function register(ipcMain, ctx) {
  const tokensFile = path.join(ctx.userDataPath, 'cloud-tokens.json');
  const serviceMapFile = path.join(ctx.userDataPath, 'render-service-map.json');
  const historyFile = path.join(ctx.userDataPath, 'deploy-history.json');

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
    return decryptToken(all.render);
  }

  async function api(pathOrUrl, opts = {}) {
    const token = await getToken();
    if (!token) throw new Error('Render not connected.');
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : 'https://api.render.com' + pathOrUrl;
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PiPilot-IDE',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Render ${res.status}: ${text.slice(0, 200) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  ipcMain.handle('render:list-services', async () => {
    try {
      // Render returns a paginated wrapper: [{ service: {...}, cursor }, ...]
      const wrapped = await api('/v1/services?limit=100');
      const services = (Array.isArray(wrapped) ? wrapped : []).map(w => {
        const s = w.service || w;
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          url: s.serviceDetails?.url || s.url || null,
          repo: s.repo,
          branch: s.branch,
          updatedAt: s.updatedAt,
        };
      });
      services.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return ok({ services });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('render:get-service-map', async (_e, { projectPath } = {}) => {
    const map = await readJsonSafe(serviceMapFile, {});
    return ok({ mapping: map[projectPath] || null });
  });

  ipcMain.handle('render:set-service-map', async (_e, { projectPath, serviceId, serviceName, serviceUrl } = {}) => {
    try {
      if (!projectPath || !serviceId) throw new Error('projectPath + serviceId required');
      const map = await readJsonSafe(serviceMapFile, {});
      map[projectPath] = { id: serviceId, name: serviceName || null, url: serviceUrl || null };
      await writeJson(serviceMapFile, map);
      return ok({});
    } catch (err) { return fail(err); }
  });

  // Trigger a deploy and poll until it's done. Streams progress over
  // deploy:event using the same shape as the CLI-based providers so
  // the deploy-tab dialog works without special-casing.
  ipcMain.handle('render:deploy', async (_e, { projectPath, serviceId, clearCache } = {}) => {
    const runId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = Date.now();
    try {
      if (!serviceId) throw new Error('serviceId required (link a Render service first)');
      emit(ctx, runId, 'log', { line: `[pipilot] Triggering Render deploy for service ${serviceId}…` });

      const created = await api(`/v1/services/${encodeURIComponent(serviceId)}/deploys`, {
        method: 'POST',
        body: JSON.stringify(clearCache ? { clearCache: 'clear' } : {}),
      });
      const deployId = created?.id;
      emit(ctx, runId, 'log', { line: `[pipilot] Deploy ${deployId} queued — polling status…` });

      // Poll status. Render statuses: created, build_in_progress,
      // update_in_progress, live, deactivated, build_failed,
      // update_failed, canceled, pre_deploy_in_progress,
      // pre_deploy_failed.
      const TERMINAL_OK = new Set(['live']);
      const TERMINAL_FAIL = new Set(['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed', 'deactivated']);
      let lastStatus = null;
      let url = null;
      const timeoutAt = Date.now() + 10 * 60_000;  // 10 minute cap

      while (Date.now() < timeoutAt) {
        await new Promise(r => setTimeout(r, 4000));
        let status;
        try {
          const data = await api(`/v1/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`);
          status = data?.status;
          if (data?.url) url = data.url;
        } catch (err) {
          emit(ctx, runId, 'log', { line: `[pipilot] poll error: ${err.message}` });
          continue;
        }
        if (status !== lastStatus) {
          emit(ctx, runId, 'log', { line: `[render] ${status}` });
          lastStatus = status;
        }
        if (TERMINAL_OK.has(status)) break;
        if (TERMINAL_FAIL.has(status)) {
          throw new Error(`Render deploy failed: ${status}`);
        }
      }

      // Service URL — fall back to the service's persistent URL if the
      // deploy response didn't include one.
      if (!url) {
        try {
          const svc = await api(`/v1/services/${encodeURIComponent(serviceId)}`);
          url = svc?.serviceDetails?.url || svc?.url || null;
        } catch {}
      }

      const finishedAt = Date.now();
      emit(ctx, runId, 'done', { url, code: 0 });

      // Append to shared deploy history so the same UI surfaces work.
      const all = await readJsonSafe(historyFile, {});
      const list = all.render || [];
      list.unshift({
        id: runId, provider: 'render', projectPath, target: 'production',
        status: 'success', startedAt, finishedAt, url,
        metadata: { deployId, serviceId },
      });
      all.render = list.slice(0, 30);
      await writeJson(historyFile, all);

      return ok({ runId, url, deployId });
    } catch (err) {
      emit(ctx, runId, 'error', { message: err?.message || String(err) });
      const all = await readJsonSafe(historyFile, {});
      const list = all.render || [];
      list.unshift({
        id: runId, provider: 'render', projectPath, target: 'production',
        status: 'error', startedAt, finishedAt: Date.now(),
        url: null, error: err?.message || String(err),
        metadata: { serviceId },
      });
      all.render = list.slice(0, 30);
      await writeJson(historyFile, all);
      return fail(err);
    }
  });

  ipcMain.handle('render:rollback', async (_e, { serviceId, deployId } = {}) => {
    try {
      if (!serviceId || !deployId) throw new Error('serviceId + deployId required');
      const result = await api(`/v1/services/${encodeURIComponent(serviceId)}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ deployId }),
      });
      return ok({ deploy: result });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('render:list-env', async (_e, { serviceId } = {}) => {
    try {
      if (!serviceId) throw new Error('serviceId required');
      const wrapped = await api(`/v1/services/${encodeURIComponent(serviceId)}/env-vars`);
      const envs = (Array.isArray(wrapped) ? wrapped : []).map(w => {
        const e = w.envVar || w;
        return { key: e.key, value: e.value };
      });
      envs.sort((a, b) => a.key.localeCompare(b.key));
      return ok({ envs });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('render:set-env', async (_e, { serviceId, key, value } = {}) => {
    try {
      if (!serviceId || !key) throw new Error('serviceId + key required');
      // Render uses PUT for upsert on the per-key endpoint.
      const result = await api(`/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: value ?? '' }),
      });
      return ok({ envVar: result });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('render:delete-env', async (_e, { serviceId, key } = {}) => {
    try {
      if (!serviceId || !key) throw new Error('serviceId + key required');
      await api(`/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      return ok({});
    } catch (err) { return fail(err); }
  });
};
