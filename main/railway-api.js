// PiPilot IDE — Railway GraphQL client.
// Railway exposes a single GraphQL endpoint for everything (projects,
// services, environments, variables, deployments, custom domains).
// Token from cloud-tokens.json. The local .railway/config.json (created
// by `railway link`) supplies the project/service/environment IDs we
// need for most operations — we read it eagerly and surface a clear
// "run railway link first" error if it's missing.

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

const ENDPOINT = 'https://backboard.railway.app/graphql/v2';

module.exports = function register(ipcMain, ctx) {
  const tokensFile = path.join(ctx.userDataPath, 'cloud-tokens.json');

  function ok(d) { return { ok: true, ...(d || {}) }; }
  function fail(e) { return { ok: false, error: e?.message || String(e), status: e?.status }; }

  async function readJsonSafe(file, fallback) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
  }

  async function getToken() {
    const all = await readJsonSafe(tokensFile, {});
    return decryptToken(all.railway);
  }

  async function gql(query, variables = {}) {
    const token = await getToken();
    if (!token) throw new Error('Railway not connected.');
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'PiPilot-IDE',
      },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errors) {
      const msg = data.errors?.[0]?.message || res.statusText;
      const err = new Error(`Railway: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return data.data;
  }

  // Read the project/service/environment IDs that `railway link`
  // wrote into the project. We tolerate both v1 and v2 formats since
  // the CLI has changed the shape over time.
  async function readLink(projectPath) {
    if (!projectPath) throw new Error('projectPath required');
    const cfg = await readJsonSafe(path.join(projectPath, '.railway', 'config.json'), null);
    if (!cfg) throw new Error('Run `npx @railway/cli@latest link` in the project root first.');
    // Common shapes seen: { project, service, environment } as either
    // ids or nested { id }.
    function id(field) {
      const v = cfg[field];
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') return v.id || v.projectId || null;
      return null;
    }
    return {
      projectId: id('project') || id('projectId'),
      serviceId: id('service') || id('serviceId'),
      environmentId: id('environment') || id('environmentId'),
    };
  }

  ipcMain.handle('railway:whoami', async () => {
    try {
      const data = await gql(`query { me { id name email } }`);
      return ok({ user: data?.me || null });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('railway:link-info', async (_e, { projectPath } = {}) => {
    try {
      const link = await readLink(projectPath);
      return ok({ link });
    } catch (err) { return fail(err); }
  });

  // List the most recent deployments for the linked service so the
  // rollback button has something to target.
  ipcMain.handle('railway:list-deployments', async (_e, { projectPath } = {}) => {
    try {
      const link = await readLink(projectPath);
      if (!link.projectId || !link.serviceId || !link.environmentId) {
        throw new Error('.railway/config.json is missing project/service/environment IDs.');
      }
      const data = await gql(`
        query Deployments($projectId: String!, $environmentId: String!, $serviceId: String!) {
          deployments(
            input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }
            first: 20
          ) {
            edges { node { id status createdAt staticUrl url meta } }
          }
        }
      `, link);
      const deployments = (data?.deployments?.edges || []).map(e => ({
        id: e.node.id,
        status: e.node.status,
        createdAt: e.node.createdAt,
        url: e.node.staticUrl || e.node.url || null,
      }));
      return ok({ deployments });
    } catch (err) { return fail(err); }
  });

  // Roll back to a specific deployment.
  ipcMain.handle('railway:rollback', async (_e, { deploymentId } = {}) => {
    try {
      if (!deploymentId) throw new Error('deploymentId required');
      const data = await gql(`mutation Rollback($id: String!) { deploymentRollback(id: $id) }`, { id: deploymentId });
      return ok({ result: data?.deploymentRollback });
    } catch (err) { return fail(err); }
  });

  // ── Env vars ──────────────────────────────────────────────────────
  ipcMain.handle('railway:list-env', async (_e, { projectPath } = {}) => {
    try {
      const link = await readLink(projectPath);
      const data = await gql(`
        query Vars($projectId: String!, $environmentId: String!, $serviceId: String) {
          variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
        }
      `, link);
      const vars = data?.variables || {};
      const envs = Object.entries(vars).map(([key, value]) => ({ key, value: value ?? '' }));
      envs.sort((a, b) => a.key.localeCompare(b.key));
      return ok({ envs });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('railway:set-env', async (_e, { projectPath, key, value } = {}) => {
    try {
      const link = await readLink(projectPath);
      if (!key) throw new Error('key required');
      await gql(`
        mutation Upsert($input: VariableUpsertInput!) {
          variableUpsert(input: $input)
        }
      `, {
        input: {
          projectId: link.projectId,
          environmentId: link.environmentId,
          serviceId: link.serviceId,
          name: key,
          value: String(value ?? ''),
        },
      });
      return ok({});
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('railway:delete-env', async (_e, { projectPath, key } = {}) => {
    try {
      const link = await readLink(projectPath);
      if (!key) throw new Error('key required');
      await gql(`
        mutation Del($input: VariableDeleteInput!) {
          variableDelete(input: $input)
        }
      `, {
        input: {
          projectId: link.projectId,
          environmentId: link.environmentId,
          serviceId: link.serviceId,
          name: key,
        },
      });
      return ok({});
    } catch (err) { return fail(err); }
  });

  // ── Custom domains ────────────────────────────────────────────────
  ipcMain.handle('railway:list-domains', async (_e, { projectPath } = {}) => {
    try {
      const link = await readLink(projectPath);
      const data = await gql(`
        query Domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
          domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
            customDomains { id domain status }
            serviceDomains { id domain }
          }
        }
      `, link);
      const custom = (data?.domains?.customDomains || []).map(d => ({
        name: d.domain, id: d.id, verified: d.status === 'verified', status: d.status, primary: false,
      }));
      const service = (data?.domains?.serviceDomains || []).map(d => ({
        name: d.domain, id: d.id, verified: true, status: 'service-domain', primary: false, generated: true,
      }));
      return ok({ domains: [...custom, ...service] });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('railway:add-domain', async (_e, { projectPath, domain } = {}) => {
    try {
      if (!domain) throw new Error('domain required');
      const link = await readLink(projectPath);
      const data = await gql(`
        mutation Add($input: CustomDomainCreateInput!) {
          customDomainCreate(input: $input) { id domain }
        }
      `, {
        input: {
          projectId: link.projectId,
          environmentId: link.environmentId,
          serviceId: link.serviceId,
          domain,
        },
      });
      return ok({ domain: data?.customDomainCreate });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('railway:delete-domain', async (_e, { domainId } = {}) => {
    try {
      if (!domainId) throw new Error('domainId required');
      await gql(`mutation Del($id: String!) { customDomainDelete(id: $id) }`, { id: domainId });
      return ok({});
    } catch (err) { return fail(err); }
  });
};
