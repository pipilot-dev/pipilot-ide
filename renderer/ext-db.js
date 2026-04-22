// PiPilot IDE — Extension Database API (SQLite-backed)
// Provides isolated SQLite storage for each extension.
// Each extension gets its own .sqlite file in userData/ext-databases/
//
// API exposed at: window.PiPilot.extDB
// Extensions receive a scoped `db` argument (5th parameter)

(function () {
  var api = window.electronAPI;

  // Create a scoped DB API for a specific extension
  function scopedAPI(extId) {
    return {
      // ── Key-Value store ──
      get: async function (key) {
        var r = await api.extDB.get(extId, key);
        return r && r.ok ? r.value : null;
      },
      set: async function (key, value) {
        await api.extDB.set(extId, key, value);
      },
      remove: async function (key) {
        await api.extDB.remove(extId, key);
      },
      keys: async function () {
        var r = await api.extDB.keys(extId);
        return r && r.ok ? r.keys : [];
      },
      getAll: async function () {
        var r = await api.extDB.getAll(extId);
        return r && r.ok ? r.entries : [];
      },
      clear: async function () {
        await api.extDB.clear(extId);
      },
      getOrDefault: async function (key, defaultValue) {
        var r = await api.extDB.get(extId, key);
        var val = r && r.ok ? r.value : null;
        return val === null ? defaultValue : val;
      },
      update: async function (key, fn) {
        var r = await api.extDB.get(extId, key);
        var current = r && r.ok ? r.value : null;
        var updated = fn(current);
        await api.extDB.set(extId, key, updated);
        return updated;
      },
      persist: async function () {
        await api.extDB.persist(extId);
      },

      // ── Collections (structured document store) ──
      collection: function (name) {
        return {
          insert: async function (id, data) {
            await api.extDB.collection.insert(extId, name, id, data);
          },
          get: async function (id) {
            var r = await api.extDB.collection.get(extId, name, id);
            return r && r.ok ? r.data : null;
          },
          list: async function () {
            var r = await api.extDB.collection.list(extId, name);
            return r && r.ok ? r.items : [];
          },
          delete: async function (id) {
            await api.extDB.collection.delete(extId, name, id);
          },
          clear: async function () {
            await api.extDB.collection.clear(extId, name);
          },
        };
      },

      // ── Raw SQL (advanced — full SQLite power) ──
      exec: async function (sql, params) {
        var r = await api.extDB.exec(extId, sql, params);
        return r && r.ok ? r.results : [];
      },
      query: async function (sql, params) {
        var r = await api.extDB.query(extId, sql, params);
        return r && r.ok ? r.results : [];
      },
    };
  }

  // Public API
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.extDB = {
    forExtension: scopedAPI,
    destroy: async function (extId) {
      await api.extDB.destroy(extId);
    },
  };

  console.log('[ext-db] Extension SQLite database API ready');
})();
