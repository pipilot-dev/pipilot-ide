// PiPilot IDE — Cloud connectors + MCP server management (Phase 5)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

let safeStorage = null;
try {
  ({ safeStorage } = require('electron'));
} catch {}

const CONNECTORS = [
  { id: 'github', name: 'GitHub', desc: 'Repos, PRs, issues', icon: '🐙', authUrl: 'https://github.com/settings/tokens' },
  { id: 'vercel', name: 'Vercel', desc: 'Deploy frontend apps', icon: '▲', authUrl: 'https://vercel.com/account/tokens' },
  { id: 'netlify', name: 'Netlify', desc: 'Deploy & host', icon: '◈', authUrl: 'https://app.netlify.com/user/applications#personal-access-tokens' },
  { id: 'cloudflare', name: 'Cloudflare', desc: 'CDN, Workers, Pages', icon: '☁', authUrl: 'https://dash.cloudflare.com/profile/api-tokens' },
  { id: 'supabase', name: 'Supabase', desc: 'DB & auth backend', icon: '⚡', authUrl: 'https://app.supabase.com/account/tokens' },
  { id: 'npm', name: 'npm', desc: 'Publish packages', icon: '📦', authUrl: 'https://www.npmjs.com/settings/' },
];

module.exports = function register(ipcMain, ctx) {
  const tokensFile = path.join(ctx.userDataPath, 'cloud-tokens.json');
  const mcpFile = path.join(ctx.userDataPath, 'mcp-servers.json');

  function ok(data) { return { ok: true, ...(data || {}) }; }
  function fail(err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }

  async function ensureDir(file) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
  }

  async function readJsonSafe(file, fallback) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async function writeJson(file, data) {
    await ensureDir(file);
    await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }

  function encryptToken(plain) {
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      try {
        const buf = safeStorage.encryptString(String(plain));
        return { enc: 'safeStorage', value: buf.toString('base64') };
      } catch {}
    }
    return { enc: 'base64', value: Buffer.from(String(plain), 'utf8').toString('base64') };
  }

  function decryptToken(entry) {
    if (!entry || !entry.value) return '';
    if (entry.enc === 'safeStorage' && safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
      } catch {
        return '';
      }
    }
    try { return Buffer.from(entry.value, 'base64').toString('utf8'); } catch { return ''; }
  }

  // ---------- Cloud connectors ----------

  ipcMain.handle('cloud:list', async () => {
    try {
      const store = await readJsonSafe(tokensFile, {});
      const list = CONNECTORS.map(c => {
        const entry = store[c.id];
        return {
          ...c,
          connected: !!(entry && entry.token && entry.token.value),
          username: entry && entry.meta ? entry.meta.username : null,
          expiresAt: entry && entry.meta ? entry.meta.expiresAt : null,
          savedAt: entry ? entry.savedAt : null,
        };
      });
      return ok({ connectors: list });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('cloud:save-token', async (_e, payload) => {
    try {
      const { provider, token, meta } = payload || {};
      if (!provider) throw new Error('Provider is required');
      if (!token) throw new Error('Token is required');
      const store = await readJsonSafe(tokensFile, {});
      store[provider] = {
        token: encryptToken(token),
        meta: meta || {},
        savedAt: Date.now(),
      };
      await writeJson(tokensFile, store);
      return ok({ provider, saved: true });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('cloud:get-token', async (_e, provider) => {
    try {
      const store = await readJsonSafe(tokensFile, {});
      const entry = store[provider];
      if (!entry) return ok({ token: null });
      return ok({ token: decryptToken(entry.token), meta: entry.meta || {} });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('cloud:delete-token', async (_e, provider) => {
    try {
      const store = await readJsonSafe(tokensFile, {});
      if (store[provider]) {
        delete store[provider];
        await writeJson(tokensFile, store);
      }
      return ok({ provider, deleted: true });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('cloud:test', async (_e, provider) => {
    try {
      const store = await readJsonSafe(tokensFile, {});
      const entry = store[provider];
      if (!entry) return fail(new Error('Not connected'));
      const token = decryptToken(entry.token);
      if (!token) return fail(new Error('Token could not be decrypted'));

      if (provider === 'github' && typeof fetch === 'function') {
        try {
          const res = await fetch('https://api.github.com/user', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github+json',
              'User-Agent': 'PiPilot-IDE',
            },
          });
          if (!res.ok) throw new Error(`GitHub API ${res.status}`);
          const user = await res.json();
          const meta = { ...(entry.meta || {}), username: user.login, name: user.name };
          store[provider] = { ...entry, meta };
          await writeJson(tokensFile, store);
          return ok({ username: user.login, name: user.name });
        } catch (err) {
          return fail(err);
        }
      }

      if (provider === 'vercel' && typeof fetch === 'function') {
        try {
          const res = await fetch('https://api.vercel.com/v2/user', {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!res.ok) throw new Error(`Vercel API ${res.status}`);
          const data = await res.json();
          const user = data.user || data;
          const meta = { ...(entry.meta || {}), username: user.username || user.email };
          store[provider] = { ...entry, meta };
          await writeJson(tokensFile, store);
          return ok({ username: user.username || user.email });
        } catch (err) { return fail(err); }
      }

      const username = (entry.meta && entry.meta.username) || 'test';
      return ok({ username, stub: true });
    } catch (err) { return fail(err); }
  });

  // ---------- MCP server management ----------

  async function readMcpServers() {
    return await readJsonSafe(mcpFile, { servers: [] });
  }

  async function writeMcpServers(data) {
    await writeJson(mcpFile, data);
  }

  function newId() {
    return 'mcp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  ipcMain.handle('mcp:list', async () => {
    try {
      const data = await readMcpServers();
      return ok({ servers: data.servers || [] });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('mcp:add', async (_e, server) => {
    try {
      if (!server || !server.name) throw new Error('Server name is required');
      const data = await readMcpServers();
      const record = {
        id: server.id || newId(),
        name: server.name,
        type: server.type === 'http' ? 'http' : 'stdio',
        enabled: server.enabled !== false,
        createdAt: Date.now(),
      };
      if (record.type === 'http') {
        record.url = server.url || '';
      } else {
        record.command = server.command || '';
        record.args = Array.isArray(server.args) ? server.args : [];
        record.env = server.env && typeof server.env === 'object' ? server.env : {};
      }
      data.servers = data.servers || [];
      data.servers.push(record);
      await writeMcpServers(data);
      return ok({ server: record });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('mcp:remove', async (_e, id) => {
    try {
      const data = await readMcpServers();
      data.servers = (data.servers || []).filter(s => s.id !== id);
      await writeMcpServers(data);
      return ok({ id, removed: true });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('mcp:toggle', async (_e, payload) => {
    try {
      const { id, enabled } = payload || {};
      const data = await readMcpServers();
      const srv = (data.servers || []).find(s => s.id === id);
      if (!srv) throw new Error('Server not found');
      srv.enabled = !!enabled;
      await writeMcpServers(data);
      return ok({ server: srv });
    } catch (err) { return fail(err); }
  });
};
