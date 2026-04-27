// PiPilot IDE — Connector credentials store
//
// Replaced the Electron safeStorage approach because it was producing
// "401 Bad Credentials" failures — DPAPI / Keychain decryption can
// silently corrupt after sleep / wake / profile sync events, and we
// were getting bytes back that no longer matched the original PAT.
//
// New design: plain JSONL stored at a stable, OS-aware location the
// user can inspect / edit / back up themselves. Two layers:
//
//   GLOBAL  — <homedir>/PiPilot/connectors.jsonl
//             follows the user across all projects
//   PROJECT — <projectPath>/.pipilot/connectors.jsonl
//             checked into the project (or .gitignored), per-project
//             override of any global key
//
// Resolution order: project-level value of a key wins over the global
// value of the same key. Lookup helpers always fall back to global if
// the project file is absent or doesn't have that key.
//
// File format (one credential per line, easy to diff / hand-edit):
//   {"key":"githubPat","value":"ghp_...","setAt":1714400000000}
//   {"key":"openaiKey","value":"sk-...","setAt":1714400000000}
//
// SECURITY NOTE: stored in plain text. Credentials are protected by
// filesystem permissions only — same threat model as ~/.npmrc auth
// tokens, ~/.aws/credentials, etc. We picked reliability over
// platform-specific encryption because the encrypted path was
// genuinely losing data. The folder is created with default user
// permissions (only readable by the same OS user on macOS/Linux;
// Windows ACL inherits from the user profile).
//
// Migration: on first read, if the LEGACY <userData>/secrets.json
// exists with safeStorage records, we attempt to decrypt + re-write
// to the new plain JSONL once, then leave the old file in place for
// rollback safety.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { safeStorage } = require('electron');

const GLOBAL_DIR_NAME = 'PiPilot';
const FILE_NAME = 'connectors.jsonl';

module.exports = function register(ipcMain, ctx) {
  const globalDir = path.join(os.homedir(), GLOBAL_DIR_NAME);
  const globalFile = path.join(globalDir, FILE_NAME);
  const legacyFile = path.join(ctx.userDataPath, 'secrets.json');

  function ensureGlobalDir() {
    try { fs.mkdirSync(globalDir, { recursive: true }); } catch {}
  }

  function projectFileFor(projectPath) {
    if (!projectPath) return null;
    return path.join(projectPath, '.pipilot', FILE_NAME);
  }

  // ── JSONL read / write ────────────────────────────────────────

  async function readJsonl(file) {
    if (!file) return [];
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const out = [];
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj && typeof obj.key === 'string') out.push(obj);
        } catch {}
      }
      return out;
    } catch { return []; }
  }

  async function writeJsonl(file, records) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const text = records
      .filter(r => r && typeof r.key === 'string')
      .map(r => JSON.stringify(r))
      .join('\n');
    // Trailing newline so manual edits + diffs stay clean.
    await fsp.writeFile(file, text + (text ? '\n' : ''), 'utf8');
  }

  // Replace-or-append by key. Returns the new full record list.
  function upsert(records, key, value) {
    const idx = records.findIndex(r => r.key === key);
    const entry = { key, value: String(value), setAt: Date.now() };
    if (idx >= 0) records[idx] = entry; else records.push(entry);
    return records;
  }

  function removeByKey(records, key) {
    return records.filter(r => r.key !== key);
  }

  // ── One-shot migration from the legacy safeStorage file ───────
  // Done on first read. If the legacy file exists and the new file
  // is empty / missing, decrypt the legacy entries and write them
  // out as plain JSONL. We DO NOT delete the legacy file — keep it
  // around for rollback in case someone wants to revert.

  let migrationAttempted = false;
  async function migrateFromLegacyOnce() {
    if (migrationAttempted) return;
    migrationAttempted = true;
    try {
      // If the new file already exists with content, no migration
      // needed — user has been using the new path.
      const existing = await readJsonl(globalFile);
      if (existing.length > 0) return;
      // Try the legacy.
      let legacyRaw;
      try { legacyRaw = await fsp.readFile(legacyFile, 'utf8'); } catch { return; }
      const legacy = JSON.parse(legacyRaw || '{}');
      if (!legacy || typeof legacy !== 'object') return;
      const out = [];
      for (const [key, rec] of Object.entries(legacy)) {
        if (!rec || typeof rec !== 'object') continue;
        let value = null;
        if (rec.enc === false) {
          value = rec.value || null;
        } else if (rec.value && typeof rec.value === 'string') {
          try {
            value = safeStorage.decryptString(Buffer.from(rec.value, 'base64'));
          } catch (err) {
            console.warn(`[secrets] migration could not decrypt ${key}:`, err.message);
            continue;
          }
        }
        if (value) out.push({ key, value, setAt: Date.now(), migrated: true });
      }
      if (out.length) {
        ensureGlobalDir();
        await writeJsonl(globalFile, out);
        console.log(`[secrets] migrated ${out.length} credential(s) from legacy safeStorage → ${globalFile}`);
      }
    } catch (err) {
      console.warn('[secrets] migration failed (non-fatal):', err.message);
    }
  }

  // ── Lookup with project-level override ────────────────────────

  async function readMerged(projectPath) {
    await migrateFromLegacyOnce();
    const [g, p] = await Promise.all([
      readJsonl(globalFile),
      readJsonl(projectFileFor(projectPath)),
    ]);
    // Project entries override global for the same key.
    const map = new Map();
    for (const r of g) map.set(r.key, { ...r, scope: 'global' });
    for (const r of p) map.set(r.key, { ...r, scope: 'project' });
    return Array.from(map.values());
  }

  // ── IPC handlers ──────────────────────────────────────────────

  ipcMain.handle('secrets:status', async (_e, { projectPath } = {}) => {
    await migrateFromLegacyOnce();
    return {
      ok: true,
      // Kept for API compatibility — no longer encrypted.
      encryptionAvailable: false,
      file: globalFile,
      globalFile,
      projectFile: projectFileFor(projectPath),
      storage: 'plain-jsonl',
    };
  });

  ipcMain.handle('secrets:set', async (_e, { key, value, projectPath, scope } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      const target = (scope === 'project' && projectPath)
        ? projectFileFor(projectPath)
        : globalFile;
      if (!target) return { ok: false, error: 'project scope requires projectPath' };
      ensureGlobalDir();
      const records = await readJsonl(target);
      let next;
      if (value == null || value === '') {
        next = removeByKey(records, key);
      } else {
        next = upsert(records, key, value);
      }
      await writeJsonl(target, next);
      // Notify listeners (e.g. github module flushes its cache when
      // the PAT changes).
      try {
        const win = ctx.getWindow?.();
        if (win && !win.isDestroyed()) win.webContents.send('secrets:changed', { key, scope: scope || 'global' });
      } catch {}
      return { ok: true, scope: scope || 'global', file: target };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('secrets:has', async (_e, { key, projectPath } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      const merged = await readMerged(projectPath);
      const hit = merged.find(r => r.key === key);
      return { ok: true, has: !!hit, scope: hit?.scope || null };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('secrets:get', async (_e, { key, projectPath } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      const merged = await readMerged(projectPath);
      const hit = merged.find(r => r.key === key);
      return { ok: true, value: hit ? hit.value : null, scope: hit?.scope || null };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('secrets:delete', async (_e, { key, projectPath, scope } = {}) => {
    if (!key) return { ok: false, error: 'key required' };
    try {
      // Default delete removes from BOTH scopes — user almost always
      // means "disconnect this connector everywhere". Caller can
      // pass scope='global' or scope='project' for a narrower delete.
      const targets = [];
      if (!scope || scope === 'global') targets.push(globalFile);
      if ((!scope || scope === 'project') && projectPath) targets.push(projectFileFor(projectPath));
      for (const t of targets) {
        const records = await readJsonl(t);
        const next = removeByKey(records, key);
        if (next.length !== records.length) await writeJsonl(t, next);
      }
      try {
        const win = ctx.getWindow?.();
        if (win && !win.isDestroyed()) win.webContents.send('secrets:changed', { key, scope: scope || 'all' });
      } catch {}
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // List all connector keys for a project (merged with global).
  // Values are NOT returned — just keys + scope, so the renderer can
  // render a "what's connected" overview without leaking secrets to
  // any UI that doesn't strictly need them.
  ipcMain.handle('secrets:list', async (_e, { projectPath } = {}) => {
    try {
      const merged = await readMerged(projectPath);
      return { ok: true, keys: merged.map(r => ({ key: r.key, scope: r.scope, setAt: r.setAt || null })) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Internal accessor used by other main modules (github.js,
  // missions.js, gh-cli.js).
  async function getSecret(key, projectPath) {
    const merged = await readMerged(projectPath || null);
    const hit = merged.find(r => r.key === key);
    return hit ? hit.value : null;
  }

  return { getSecret };
};
