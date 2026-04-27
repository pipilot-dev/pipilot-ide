// PiPilot IDE — Preload script
// Exposes a safe IPC bridge to the renderer via window.electronAPI.

const { contextBridge, ipcRenderer, clipboard } = require('electron');

// Track active streams so renderer can clean them up
const streamListeners = new Map();

contextBridge.exposeInMainWorld('electronAPI', {
  // ---------- Clipboard ----------
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(String(text ?? '')),
  },

  // ---------- App ----------
  pickFolder: () => ipcRenderer.invoke('app:pick-folder'),
  pickFile: (opts) => ipcRenderer.invoke('app:pick-file', opts),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getHome: () => ipcRenderer.invoke('app:get-home'),
  pickSavePath: (opts) => ipcRenderer.invoke('app:pick-save-path', opts),
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },
  // Background mode + power management. Renderer signals when the agent
  // is active so the main process can hold a powerSaveBlocker, and
  // listens for power events so the UI can show "paused on suspend".
  background: {
    setAgentActive: (active, tag) => ipcRenderer.invoke('background:agent-active',
      tag ? { active: !!active, tag } : !!active),
    status: () => ipcRenderer.invoke('background:status'),
    setPrefs: (prefs) => ipcRenderer.invoke('background:set-prefs', prefs),
    onSuspend: (cb) => { const fn = (_e, p) => cb(p); ipcRenderer.on('power:suspend', fn); return () => ipcRenderer.removeListener('power:suspend', fn); },
    onResume:  (cb) => { const fn = (_e, p) => cb(p); ipcRenderer.on('power:resume',  fn); return () => ipcRenderer.removeListener('power:resume',  fn); },
    onLock:    (cb) => { const fn = ()      => cb();  ipcRenderer.on('power:lock',    fn); return () => ipcRenderer.removeListener('power:lock',    fn); },
    onUnlock:  (cb) => { const fn = ()      => cb();  ipcRenderer.on('power:unlock',  fn); return () => ipcRenderer.removeListener('power:unlock',  fn); },
  },
  // Resumption diary — last-session breadcrumbs persisted under
  // `<projectPath>/.pipilot/diary.md`. Powers the Yesterday Card and
  // the Dormant Project Whisper on the welcome tab.
  diary: {
    write: (projectPath, entry) => ipcRenderer.invoke('diary:write', { projectPath, entry }),
    read: (projectPath, limit) => ipcRenderer.invoke('diary:read', { projectPath, limit }),
  },
  recentProjects: {
    get: () => ipcRenderer.invoke('app:recent-projects:get'),
    add: (p) => ipcRenderer.invoke('app:recent-projects:add', p),
    remove: (p) => ipcRenderer.invoke('app:recent-projects:remove', p),
  },

  onMenu: (event, handler) => {
    const ch = `menu:${event}`;
    const fn = (_e, ...args) => handler(...args);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },

  // ---------- Files ----------
  files: {
    tree: (projectPath) => ipcRenderer.invoke('files:tree', projectPath),
    listDir: (dirPath) => ipcRenderer.invoke('files:list-dir', dirPath),
    zip: (paths, projectPath, savePath) => ipcRenderer.invoke('files:zip', { paths, projectPath, savePath }),
    saveTemp: (fileName, base64) => ipcRenderer.invoke('files:save-temp', { fileName, base64 }),
    read: (filePath) => ipcRenderer.invoke('files:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('files:write', { filePath, content }),
    mkdir: (dirPath) => ipcRenderer.invoke('files:mkdir', dirPath),
    delete: (targetPath) => ipcRenderer.invoke('files:delete', targetPath),
    rename: (from, to) => ipcRenderer.invoke('files:rename', { from, to }),
    stat: (p) => ipcRenderer.invoke('files:stat', p),
    list: (dirPath) => ipcRenderer.invoke('files:list', dirPath),
    search: (projectPath, query, opts) => ipcRenderer.invoke('files:search', { projectPath, query, opts }),
    watch: (projectPath, onEvent) => {
      const streamId = `watch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ch = `files:watch:${streamId}`;
      const fn = (_e, evt) => onEvent(evt);
      ipcRenderer.on(ch, fn);
      streamListeners.set(streamId, { ch, fn });
      ipcRenderer.invoke('files:watch:start', { streamId, projectPath });
      return () => {
        ipcRenderer.invoke('files:watch:stop', streamId);
        ipcRenderer.removeListener(ch, fn);
        streamListeners.delete(streamId);
      };
    },
  },

  fs: {
    home: () => ipcRenderer.invoke('fs:home'),
    list: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
  },

  // ---------- Terminal ----------
  terminal: {
    profiles: () => ipcRenderer.invoke('terminal:profiles'),
    create: (opts) => ipcRenderer.invoke('terminal:create', opts),
    write: (id, data) => ipcRenderer.invoke('terminal:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
    destroy: (id) => ipcRenderer.invoke('terminal:destroy', id),
    onData: (id, handler) => {
      const ch = `terminal:data:${id}`;
      const fn = (_e, data) => handler(data);
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
    onExit: (id, handler) => {
      const ch = `terminal:exit:${id}`;
      const fn = (_e, code) => handler(code);
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
  },

  // ---------- Agent (AI) ----------
  agent: {
    send: (payload, onEvent) => {
      const streamId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ch = `agent:event:${streamId}`;
      const fn = (_e, evt) => onEvent(evt);
      ipcRenderer.on(ch, fn);
      streamListeners.set(streamId, { ch, fn });
      ipcRenderer.invoke('agent:send', { streamId, ...payload });
      return {
        stop: () => ipcRenderer.invoke('agent:stop', streamId),
        answer: (text) => ipcRenderer.invoke('agent:answer', { streamId, text }),
        dispose: () => {
          ipcRenderer.removeListener(ch, fn);
          streamListeners.delete(streamId);
        },
      };
    },
    stop: (streamId) => ipcRenderer.invoke('agent:stop', streamId),
    // AskUserQuestion (human-in-the-loop)
    answerQuestion: (requestId, answers) => ipcRenderer.invoke('agent:answer-question', { requestId, answers }),
    listSessions: (projectPath) => ipcRenderer.invoke('agent:list-sessions', projectPath),
    loadSession: (projectPath, sessionId) => ipcRenderer.invoke('agent:load-session', { projectPath, sessionId }),
    deleteSession: (projectPath, sessionId) => ipcRenderer.invoke('agent:delete-session', { projectPath, sessionId }),
    newSession: (projectPath, title) => ipcRenderer.invoke('agent:new-session', { projectPath, title }),
  },

  // ---------- Git ----------
  git: {
    status: (p) => ipcRenderer.invoke('git:status', p),
    log: (p, opts) => ipcRenderer.invoke('git:log', { projectPath: p, opts }),
    diff: (p, file, staged) => ipcRenderer.invoke('git:diff', { projectPath: p, file, staged }),
    add: (p, files) => ipcRenderer.invoke('git:add', { projectPath: p, files }),
    commit: (p, msg) => ipcRenderer.invoke('git:commit', { projectPath: p, msg }),
    push: (p, opts) => ipcRenderer.invoke('git:push', { projectPath: p, opts }),
    pull: (p, opts) => ipcRenderer.invoke('git:pull', { projectPath: p, opts }),
    fetch: (p, remote) => ipcRenderer.invoke('git:fetch', { projectPath: p, remote }),
    branches: (p) => ipcRenderer.invoke('git:branches', p),
    checkout: (p, branch) => ipcRenderer.invoke('git:checkout', { projectPath: p, branch }),
    createBranch: (p, name) => ipcRenderer.invoke('git:create-branch', { projectPath: p, name }),
    merge: (p, branch) => ipcRenderer.invoke('git:merge', { projectPath: p, branch }),
    cherryPick: (p, oid) => ipcRenderer.invoke('git:cherry-pick', { projectPath: p, oid }),
    deleteBranch: (p, name, force) => ipcRenderer.invoke('git:delete-branch', { projectPath: p, name, force }),
    reset: (p, mode, ref) => ipcRenderer.invoke('git:reset', { projectPath: p, mode, ref }),
    addRemote: (p, name, url) => ipcRenderer.invoke('git:add-remote', { projectPath: p, name, url }),
    clone: (url, dir, onProgress) => {
      const streamId = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ch = `git:clone:progress:${streamId}`;
      const fn = (_e, progress) => onProgress?.(progress);
      ipcRenderer.on(ch, fn);
      const done = ipcRenderer.invoke('git:clone', { streamId, url, dir });
      done.finally(() => ipcRenderer.removeListener(ch, fn));
      return done;
    },
    stash: (p, opts) => ipcRenderer.invoke('git:stash', { projectPath: p, opts }),
    discard: (p, file) => ipcRenderer.invoke('git:discard', { projectPath: p, file }),
    unstage: (p, files) => ipcRenderer.invoke('git:unstage', { projectPath: p, files }),
    init: (p) => ipcRenderer.invoke('git:init', p),
    show: (p, hash) => ipcRenderer.invoke('git:show', { projectPath: p, hash }),
    fileVersions: (p, file, staged) => ipcRenderer.invoke('git:file-versions', { projectPath: p, file, staged }),
  },

  // ---------- Cloud connectors ----------
  cloud: {
    listConnectors: () => ipcRenderer.invoke('cloud:list'),
    saveToken: (provider, token, meta) => ipcRenderer.invoke('cloud:save-token', { provider, token, meta }),
    getToken: (provider) => ipcRenderer.invoke('cloud:get-token', provider),
    deleteToken: (provider) => ipcRenderer.invoke('cloud:delete-token', provider),
    testConnection: (provider) => ipcRenderer.invoke('cloud:test', provider),
  },

  mcp: {
    listServers: () => ipcRenderer.invoke('mcp:list'),
    addServer: (server) => ipcRenderer.invoke('mcp:add', server),
    removeServer: (id) => ipcRenderer.invoke('mcp:remove', id),
    toggleServer: (id, enabled) => ipcRenderer.invoke('mcp:toggle', { id, enabled }),
  },

  // ---------- Checkpoints ----------
  checkpoints: {
    list: (p) => ipcRenderer.invoke('checkpoints:list', p),
    create: (p, label) => ipcRenderer.invoke('checkpoints:create', { projectPath: p, label }),
    restore: (p, id) => ipcRenderer.invoke('checkpoints:restore', { projectPath: p, id }),
    delete: (p, id) => ipcRenderer.invoke('checkpoints:delete', { projectPath: p, id }),
  },

  // ---------- Dev server / preview ----------
  devServer: {
    start: (p, cmd) => ipcRenderer.invoke('devserver:start', { projectPath: p, cmd }),
    stop: (id) => ipcRenderer.invoke('devserver:stop', id),
    stopAll: () => ipcRenderer.invoke('devserver:stop-all'),
    status: (id) => ipcRenderer.invoke('devserver:status', id),
    list: () => ipcRenderer.invoke('devserver:list'),
    detectType: (p) => ipcRenderer.invoke('devserver:detect-type', { projectPath: p }),
    startStatic: (p) => ipcRenderer.invoke('devserver:static', { projectPath: p }),
    stopStatic: (p) => ipcRenderer.invoke('devserver:static-stop', { projectPath: p }),
    onLog: (id, handler) => {
      const ch = `devserver:log:${id}`;
      const fn = (_e, line) => handler(line);
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
  },

  // ---------- Diagnostics (Problems) ----------
  wiki: {
    tree: (p) => ipcRenderer.invoke('wiki:tree', { projectPath: p }),
    page: (p, pageId) => ipcRenderer.invoke('wiki:page', { projectPath: p, pageId }),
    save: (p, pageId, content) => ipcRenderer.invoke('wiki:save', { projectPath: p, pageId, content }),
    delete: (p, pageId) => ipcRenderer.invoke('wiki:delete', { projectPath: p, pageId }),
    scan: (p) => ipcRenderer.invoke('wiki:scan', { projectPath: p }),
  },

  diagnostics: {
    start: (projectPath) => ipcRenderer.invoke('diagnostics:start', { projectPath }),
    stop: () => ipcRenderer.invoke('diagnostics:stop'),
    run: (projectPath) => ipcRenderer.invoke('diagnostics:run', { projectPath }),
    onUpdate: (handler) => {
      const ch = 'diagnostics:updated';
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
  },

  // ---------- Extensions ----------
  extensions: {
    registry: () => ipcRenderer.invoke('extensions:registry'),
    installed: () => ipcRenderer.invoke('extensions:installed'),
    install: (id, url, manifest) => ipcRenderer.invoke('extensions:install', { id, url, manifest }),
    uninstall: (id) => ipcRenderer.invoke('extensions:uninstall', { id }),
    toggle: (id, enabled) => ipcRenderer.invoke('extensions:toggle', { id, enabled }),
    load: (id) => ipcRenderer.invoke('extensions:load', { id }),
    loadAll: () => ipcRenderer.invoke('extensions:load-all'),
    listBuiltins: () => ipcRenderer.invoke('extensions:list-builtins'),
    loadBuiltins: (enabledIds) => ipcRenderer.invoke('extensions:load-builtins', { enabledIds }),
  },

  // ---------- Extension Database (SQLite) ----------
  extDB: {
    get: (extId, key) => ipcRenderer.invoke('ext-db:get', { extId, key }),
    set: (extId, key, value) => ipcRenderer.invoke('ext-db:set', { extId, key, value }),
    remove: (extId, key) => ipcRenderer.invoke('ext-db:remove', { extId, key }),
    keys: (extId) => ipcRenderer.invoke('ext-db:keys', { extId }),
    getAll: (extId) => ipcRenderer.invoke('ext-db:get-all', { extId }),
    clear: (extId) => ipcRenderer.invoke('ext-db:clear', { extId }),
    destroy: (extId) => ipcRenderer.invoke('ext-db:destroy', { extId }),
    persist: (extId) => ipcRenderer.invoke('ext-db:persist', { extId }),
    // Collections (structured data)
    collection: {
      insert: (extId, collection, id, data) => ipcRenderer.invoke('ext-db:collection-insert', { extId, collection, id, data }),
      get: (extId, collection, id) => ipcRenderer.invoke('ext-db:collection-get', { extId, collection, id }),
      list: (extId, collection) => ipcRenderer.invoke('ext-db:collection-list', { extId, collection }),
      delete: (extId, collection, id) => ipcRenderer.invoke('ext-db:collection-delete', { extId, collection, id }),
      clear: (extId, collection) => ipcRenderer.invoke('ext-db:collection-clear', { extId, collection }),
    },
    // Raw SQL (advanced)
    exec: (extId, sql, params) => ipcRenderer.invoke('ext-db:exec', { extId, sql, params }),
    query: (extId, sql, params) => ipcRenderer.invoke('ext-db:query', { extId, sql, params }),
  },

  // ---------- Search Index ----------
  searchIndex: {
    start: (projectPath) => ipcRenderer.invoke('search-index:start', { projectPath }),
    stats: (projectPath) => ipcRenderer.invoke('search-index:stats', { projectPath }),
    fileChanged: (projectPath, evt) => ipcRenderer.invoke('search-index:file-changed', { projectPath, evt }),
    onProgress: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('search-index:progress', fn);
      return () => ipcRenderer.removeListener('search-index:progress', fn);
    },
  },

  // ---------- Speech (voice input) ----------
  speech: {
    info: () => ipcRenderer.invoke('speech:info'),
    transcribe: (audioBase64) => ipcRenderer.invoke('speech:transcribe', { audio: audioBase64 }),
    startNative: () => ipcRenderer.invoke('speech:start-native'),
    stopNative: () => ipcRenderer.invoke('speech:stop-native'),
    onResult: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('speech:result', fn);
      return () => ipcRenderer.removeListener('speech:result', fn);
    },
  },

  // ---------- Codestral (FIM completions + inline chat) ----------
  codestral: {
    status: () => ipcRenderer.invoke('codestral:status'),
    fim: (payload) => ipcRenderer.invoke('codestral:fim', payload),
    cancel: (requestId) => ipcRenderer.invoke('codestral:cancel', requestId),
    chat: (payload) => ipcRenderer.invoke('codestral:chat', payload),
    commitMessage: (payload) => ipcRenderer.invoke('codestral:commit-message', payload),
    chatStream: (payload, onEvent) => {
      const streamId = `codestral-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ch = `codestral:chat:${streamId}`;
      const fn = (_e, evt) => onEvent(evt);
      ipcRenderer.on(ch, fn);
      const done = ipcRenderer.invoke('codestral:chat-stream', { streamId, ...payload });
      return {
        streamId,
        done,
        stop: () => ipcRenderer.invoke('codestral:cancel', streamId),
        dispose: () => ipcRenderer.removeListener(ch, fn),
      };
    },
  },

  // ---------- Settings ----------
  // ---------- Connector credentials (plain JSONL at <home>/PiPilot) ----------
  // Two scopes: global (follows user across projects) and project
  // (per-project override stored at <projectPath>/.pipilot/connectors.jsonl).
  // Project value wins over global on key collisions during read.
  secrets: {
    status: (projectPath) => ipcRenderer.invoke('secrets:status', { projectPath }),
    has: (key, projectPath) => ipcRenderer.invoke('secrets:has', { key, projectPath }),
    get: (key, projectPath) => ipcRenderer.invoke('secrets:get', { key, projectPath }),
    // scope: 'global' (default) or 'project' (requires projectPath)
    set: (key, value, opts) => ipcRenderer.invoke('secrets:set', { key, value, ...(opts || {}) }),
    delete: (key, opts) => ipcRenderer.invoke('secrets:delete', { key, ...(opts || {}) }),
    list: (projectPath) => ipcRenderer.invoke('secrets:list', { projectPath }),
    onChanged: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('secrets:changed', fn);
      return () => ipcRenderer.removeListener('secrets:changed', fn);
    },
  },

  // ---------- GitHub API proxy (uses stored PAT, never exposed) ----------
  github: {
    whoami: () => ipcRenderer.invoke('github:whoami'),
    listRepos: (refresh) => ipcRenderer.invoke('github:list-repos', { refresh: !!refresh }),
    listBranches: (repo, refresh) => ipcRenderer.invoke('github:list-branches', { repo, refresh: !!refresh }),
  },

  // ---------- gh CLI provisioning (used by cloud missions) ----------
  gh: {
    check: () => ipcRenderer.invoke('gh:check'),
    install: () => ipcRenderer.invoke('gh:install'),
    ensureForMission: () => ipcRenderer.invoke('gh:ensure-for-mission'),
  },

  // ---------- Missions (scheduled/reactive background agents) ----------
  missions: {
    list: (projectPath) => ipcRenderer.invoke('missions:list', { projectPath }),
    save: (scope, projectPath, mission) => ipcRenderer.invoke('missions:save', { scope, projectPath, mission }),
    delete: (scope, projectPath, id) => ipcRenderer.invoke('missions:delete', { scope, projectPath, id }),
    run: (id, projectPath, force) => ipcRenderer.invoke('missions:run', { id, projectPath, force }),
    stop: (id) => ipcRenderer.invoke('missions:stop', { id }),
    sendMessage: (id, message, projectPath) => ipcRenderer.invoke('missions:send-message', { id, message, projectPath }),
    getState: (id) => ipcRenderer.invoke('missions:get-state', { id }),
    inFlightState: () => ipcRenderer.invoke('missions:in-flight-state'),
    listRuns: (id) => ipcRenderer.invoke('missions:list-runs', { id }),
    loadRun: (id, file) => ipcRenderer.invoke('missions:load-run', { id, file }),
    readLog: (projectPath) => ipcRenderer.invoke('missions:read-log', { projectPath }),
    onEvent: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:event', fn);
      return () => ipcRenderer.removeListener('missions:event', fn);
    },
    onStart: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:start', fn);
      return () => ipcRenderer.removeListener('missions:start', fn);
    },
    onEnd: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:end', fn);
      return () => ipcRenderer.removeListener('missions:end', fn);
    },
    onBgActive: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:bg-active', fn);
      return () => ipcRenderer.removeListener('missions:bg-active', fn);
    },
    onTurnEnd: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:turn-end', fn);
      return () => ipcRenderer.removeListener('missions:turn-end', fn);
    },
    onQueued: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:queued', fn);
      return () => ipcRenderer.removeListener('missions:queued', fn);
    },
    onStatus: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:status', fn);
      return () => ipcRenderer.removeListener('missions:status', fn);
    },
    onChanged: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:changed', fn);
      return () => ipcRenderer.removeListener('missions:changed', fn);
    },
    onInstallRequired: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('missions:install-required', fn);
      return () => ipcRenderer.removeListener('missions:install-required', fn);
    },
  },

  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
    all: () => ipcRenderer.invoke('settings:all'),
    onChanged: (handler) => {
      const fn = (_e, payload) => { try { handler(payload); } catch {} };
      ipcRenderer.on('settings:changed', fn);
      return () => ipcRenderer.removeListener('settings:changed', fn);
    },
  },

  // ---------- Shell ----------
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    showItemInFolder: (p) => ipcRenderer.invoke('shell:show-in-folder', p),
  },
});

// Best-effort cleanup signal to main process.
window.addEventListener('beforeunload', () => {
  try { ipcRenderer.send('renderer:closed'); } catch {}
});
