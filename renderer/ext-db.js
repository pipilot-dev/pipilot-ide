// PiPilot IDE — Extension Database API
// Provides isolated IndexedDB storage for each extension.
// Each extension gets its own database: "pipilot-ext-{extensionId}"
//
// API exposed at: window.PiPilot.extDB
// Extensions receive it via: PiPilot.extDB (scoped to their own ID)

(function () {
  var DB_VERSION = 1;
  var STORE_NAME = 'data';
  var openDBs = {}; // cache: extensionId -> db instance

  function dbName(extId) {
    return 'pipilot-ext-' + extId;
  }

  function openDB(extId) {
    if (openDBs[extId]) return Promise.resolve(openDBs[extId]);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(dbName(extId), DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function (e) {
        openDBs[extId] = e.target.result;
        resolve(e.target.result);
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  // ── Core operations (all return Promises) ──

  // Get a single value by key
  async function get(extId, key) {
    var db = await openDB(extId);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = function () { resolve(req.result === undefined ? null : req.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  // Set a value by key (any JSON-serializable value)
  async function set(extId, key, value) {
    var db = await openDB(extId);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  // Delete a key
  async function remove(extId, key) {
    var db = await openDB(extId);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  // Get all keys
  async function keys(extId) {
    var db = await openDB(extId);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  // Get all entries as { key, value } array
  async function getAll(extId) {
    var db = await openDB(extId);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var keysReq = store.getAllKeys();
      var valsReq = store.getAll();
      tx.oncomplete = function () {
        var k = keysReq.result || [];
        var v = valsReq.result || [];
        var entries = [];
        for (var i = 0; i < k.length; i++) {
          entries.push({ key: k[i], value: v[i] });
        }
        resolve(entries);
      };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  // Clear all data for an extension
  async function clear(extId) {
    var db = await openDB(extId);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  }

  // Delete the entire database for an extension (used on uninstall)
  async function destroy(extId) {
    // Close the db first if open
    if (openDBs[extId]) {
      try { openDBs[extId].close(); } catch (e) {}
      delete openDBs[extId];
    }
    return new Promise(function (resolve, reject) {
      var req = indexedDB.deleteDatabase(dbName(extId));
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e.target.error); };
      req.onblocked = function () { resolve(); }; // still counts as success
    });
  }

  // ── Scoped API factory ──
  // Creates an API object scoped to a specific extension ID.
  // Extensions only see their own data.
  function scopedAPI(extId) {
    return {
      get: function (key) { return get(extId, key); },
      set: function (key, value) { return set(extId, key, value); },
      remove: function (key) { return remove(extId, key); },
      keys: function () { return keys(extId); },
      getAll: function () { return getAll(extId); },
      clear: function () { return clear(extId); },
      // Convenience: get with default value
      getOrDefault: async function (key, defaultValue) {
        var val = await get(extId, key);
        return val === null ? defaultValue : val;
      },
      // Convenience: update a value using a function
      update: async function (key, fn) {
        var current = await get(extId, key);
        var updated = fn(current);
        await set(extId, key, updated);
        return updated;
      },
    };
  }

  // ── Public API ──
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.extDB = {
    // For the IDE: access any extension's data by ID
    forExtension: scopedAPI,
    // For the IDE: destroy an extension's database (on uninstall)
    destroy: destroy,
    // List all extension databases
    listDatabases: async function () {
      if (indexedDB.databases) {
        var dbs = await indexedDB.databases();
        return dbs
          .filter(function (d) { return d.name && d.name.startsWith('pipilot-ext-'); })
          .map(function (d) { return d.name.replace('pipilot-ext-', ''); });
      }
      return []; // Firefox doesn't support indexedDB.databases()
    },
  };

  console.log('[ext-db] Extension database API ready');
})();
