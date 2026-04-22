// PiPilot IDE — Extension SQLite Database IPC handlers
// Each extension gets its own .sqlite file in userData/ext-databases/
// Uses sql.js (SQLite compiled to WASM — no native dependencies)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

let SQL = null;
let sqlReady = null;
const openDBs = new Map(); // extId -> { db, filePath, dirty }

module.exports = function register(ipcMain, ctx) {

  function dbDir() {
    return path.join(ctx.userDataPath, 'ext-databases');
  }

  function dbPath(extId) {
    return path.join(dbDir(), extId + '.sqlite');
  }

  async function ensureSQL() {
    if (SQL) return SQL;
    if (sqlReady) return sqlReady;
    sqlReady = require('sql.js')().then(function (s) { SQL = s; return s; });
    return sqlReady;
  }

  async function ensureDir() {
    await fsp.mkdir(dbDir(), { recursive: true });
  }

  async function getDB(extId) {
    if (openDBs.has(extId)) return openDBs.get(extId);
    await ensureSQL();
    await ensureDir();

    var filePath = dbPath(extId);
    var db;
    try {
      var buf = await fsp.readFile(filePath);
      db = new SQL.Database(buf);
    } catch (e) {
      db = new SQL.Database();
    }

    // Ensure the key-value table exists
    db.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)');
    // Ensure a general-purpose table for structured data
    db.run('CREATE TABLE IF NOT EXISTS store (collection TEXT, id TEXT, data TEXT, created_at INTEGER, updated_at INTEGER, PRIMARY KEY (collection, id))');

    var entry = { db: db, filePath: filePath, dirty: false };
    openDBs.set(extId, entry);
    return entry;
  }

  async function persist(extId) {
    var entry = openDBs.get(extId);
    if (!entry || !entry.dirty) return;
    var data = entry.db.export();
    var buffer = Buffer.from(data);
    await fsp.writeFile(entry.filePath, buffer);
    entry.dirty = false;
  }

  // Auto-persist dirty databases every 5 seconds
  setInterval(function () {
    for (var [extId, entry] of openDBs) {
      if (entry.dirty) {
        persist(extId).catch(function (err) {
          console.warn('[ext-db] persist failed for', extId, err.message);
        });
      }
    }
  }, 5000);

  // ── Key-Value operations ──

  ipcMain.handle('ext-db:get', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var stmt = entry.db.prepare('SELECT value FROM kv WHERE key = ?');
      stmt.bind([payload.key]);
      if (stmt.step()) {
        var row = stmt.getAsObject();
        stmt.free();
        return { ok: true, value: JSON.parse(row.value) };
      }
      stmt.free();
      return { ok: true, value: null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:set', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      entry.db.run('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)',
        [payload.key, JSON.stringify(payload.value), Date.now()]);
      entry.dirty = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:remove', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      entry.db.run('DELETE FROM kv WHERE key = ?', [payload.key]);
      entry.dirty = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:keys', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var results = entry.db.exec('SELECT key FROM kv ORDER BY key');
      var keys = results.length ? results[0].values.map(function (r) { return r[0]; }) : [];
      return { ok: true, keys: keys };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:get-all', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var results = entry.db.exec('SELECT key, value FROM kv ORDER BY key');
      var entries = results.length ? results[0].values.map(function (r) {
        return { key: r[0], value: JSON.parse(r[1]) };
      }) : [];
      return { ok: true, entries: entries };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:clear', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      entry.db.run('DELETE FROM kv');
      entry.dirty = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Collection operations (structured data) ──

  ipcMain.handle('ext-db:collection-insert', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var now = Date.now();
      entry.db.run(
        'INSERT OR REPLACE INTO store (collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [payload.collection, payload.id, JSON.stringify(payload.data), now, now]
      );
      entry.dirty = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:collection-get', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var stmt = entry.db.prepare('SELECT data FROM store WHERE collection = ? AND id = ?');
      stmt.bind([payload.collection, payload.id]);
      if (stmt.step()) {
        var row = stmt.getAsObject();
        stmt.free();
        return { ok: true, data: JSON.parse(row.data) };
      }
      stmt.free();
      return { ok: true, data: null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:collection-list', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var results = entry.db.exec(
        'SELECT id, data, created_at, updated_at FROM store WHERE collection = ? ORDER BY updated_at DESC',
        [payload.collection]
      );
      var items = results.length ? results[0].values.map(function (r) {
        return { id: r[0], data: JSON.parse(r[1]), createdAt: r[2], updatedAt: r[3] };
      }) : [];
      return { ok: true, items: items };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:collection-delete', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      entry.db.run('DELETE FROM store WHERE collection = ? AND id = ?', [payload.collection, payload.id]);
      entry.dirty = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:collection-clear', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      entry.db.run('DELETE FROM store WHERE collection = ?', [payload.collection]);
      entry.dirty = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Raw SQL (for advanced extensions) ──

  ipcMain.handle('ext-db:exec', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var results = entry.db.exec(payload.sql, payload.params || []);
      entry.dirty = true;
      return { ok: true, results: results };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:query', async function (_e, payload) {
    try {
      var entry = await getDB(payload.extId);
      var results = entry.db.exec(payload.sql, payload.params || []);
      return { ok: true, results: results };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Lifecycle ──

  ipcMain.handle('ext-db:destroy', async function (_e, payload) {
    try {
      var entry = openDBs.get(payload.extId);
      if (entry) {
        entry.db.close();
        openDBs.delete(payload.extId);
      }
      try { await fsp.unlink(dbPath(payload.extId)); } catch (e) {}
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ext-db:persist', async function (_e, payload) {
    try {
      await persist(payload.extId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
};
