// PiPilot IDE — Secrets store
//
// Stores small per-user secrets (currently: GitHub PAT used by Missions
// running against cloud repos) at <userData>/secrets.json. Values are
// encrypted with Electron's safeStorage (DPAPI on Windows, Keychain on
// macOS, libsecret/kwallet on Linux). On platforms where encryption
// isn't available (headless Linux without a keyring) safeStorage
// transparently falls back to an obfuscated text encoding — we surface
// that state via secrets:status so the UI can warn the user.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { safeStorage } = require('electron');

module.exports = function register(ipcMain, ctx) {
  const file = path.join(ctx.userDataPath, 'secrets.json');

  async function readAll() {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async function writeAll(obj) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
  }

  function encryptionAvailable() {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  function encrypt(plain) {
    if (!plain) return null;
    try {
      const buf = safeStorage.encryptString(String(plain));
      return { enc: true, value: buf.toString('base64') };
    } catch {
      // Fallback: store plain (better than crashing). Marked enc:false
      // so we know it's unencrypted on disk.
      return { enc: false, value: String(plain) };
    }
  }

  function decrypt(record) {
    if (!record || typeof record !== 'object') return null;
    if (record.enc === false) return record.value || null;
    try {
      return safeStorage.decryptString(Buffer.from(record.value || '', 'base64'));
    } catch {
      return null;
    }
  }

  ipcMain.handle('secrets:status', async () => {
    return {
      ok: true,
      encryptionAvailable: encryptionAvailable(),
      file,
    };
  });

  ipcMain.handle('secrets:set', async (_e, { key, value } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      const all = await readAll();
      if (value == null || value === '') {
        delete all[key];
      } else {
        all[key] = encrypt(value);
      }
      await writeAll(all);
      return { ok: true, encryptionAvailable: encryptionAvailable() };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // has() — returns whether a secret is set without revealing the value.
  ipcMain.handle('secrets:has', async (_e, { key } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      const all = await readAll();
      return { ok: true, has: !!all[key] };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // get() — returns the decrypted value. Used internally by the missions
  // runner; exposed to the renderer for the "test connection" flow only.
  ipcMain.handle('secrets:get', async (_e, { key } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      const all = await readAll();
      const rec = all[key];
      if (!rec) return { ok: true, value: null };
      return { ok: true, value: decrypt(rec) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('secrets:delete', async (_e, { key } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      const all = await readAll();
      delete all[key];
      await writeAll(all);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Synchronous accessor for other main-process modules (missions runner).
  async function getSecret(key) {
    const all = await readAll();
    const rec = all[key];
    return rec ? decrypt(rec) : null;
  }

  return { getSecret };
};
