// PiPilot IDE — Git decorations service
// Centralizes git status fetching for the file-tree letters and status-bar
// branch/dirty/ahead/behind indicators. Exposes a sync lookup so the
// sidebar's tree renderer can paint without awaiting per-row.
//
// Bus events emitted:
//   git:decorations:updated  — file map changed; sidebar should re-render
//   git:summary:updated      — branch/ahead/behind/dirty changed; statusbar reads
//
// Sync API:
//   window.PiPilot.gitDecorations.fileLetter(absPath)  -> 'M'|'A'|'D'|'U'|'R'|'?'|null
//   window.PiPilot.gitDecorations.folderCount(absPath) -> integer (changed descendants)
//   window.PiPilot.gitDecorations.summary()            -> { branch, ahead, behind, tracking, dirty, hasRepo }

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;
  const debounce = window.PiPilot.debounce;

  // path → status letter
  let fileMap = new Map();
  // folder absolute path (norm'd) → count of changed descendants
  let folderCounts = new Map();
  let summary = { branch: null, ahead: 0, behind: 0, tracking: null, dirty: 0, hasRepo: false };
  let pollTimer = null;
  let inFlight = false;

  function norm(p) {
    if (!p) return '';
    return String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  }

  // simple-git status codes (index, working_dir):
  //   M=modified  A=added  D=deleted  R=renamed  C=copied  U=conflicted  ?=untracked
  // VS Code convention: working tree letter wins; staged-only shows index letter.
  function pickLetter(f) {
    const w = (f.working_dir || '').trim();
    const i = (f.index || '').trim();
    // untracked
    if (w === '?' || i === '?') return '?';
    // conflicted
    if (w === 'U' || i === 'U' || (w && i && w !== ' ' && i !== ' ' && w === i && w === 'A')) return 'U';
    if (w) return w;
    if (i) return i;
    return null;
  }

  function rebuildFolderCounts(projectPath) {
    folderCounts = new Map();
    if (!projectPath) return;
    const projNorm = norm(projectPath);
    for (const absPath of fileMap.keys()) {
      // Walk up the parents inside projectPath
      let p = absPath;
      while (p.length > projNorm.length) {
        const slash = p.lastIndexOf('/');
        if (slash <= 0) break;
        p = p.slice(0, slash);
        if (p.length < projNorm.length) break;
        folderCounts.set(p, (folderCounts.get(p) || 0) + 1);
      }
    }
  }

  async function refresh() {
    if (inFlight) return;
    if (!state.projectPath) {
      if (fileMap.size || summary.hasRepo) {
        fileMap = new Map();
        folderCounts = new Map();
        summary = { branch: null, ahead: 0, behind: 0, tracking: null, dirty: 0, hasRepo: false };
        bus.emit('git:decorations:updated');
        bus.emit('git:summary:updated', summary);
      }
      return;
    }
    inFlight = true;
    try {
      const r = await api.git.status(state.projectPath);
      if (!r || r.ok === false) {
        // No repo, or git missing — clear everything
        if (fileMap.size || summary.hasRepo) {
          fileMap = new Map();
          folderCounts = new Map();
          summary = { branch: null, ahead: 0, behind: 0, tracking: null, dirty: 0, hasRepo: false };
          bus.emit('git:decorations:updated');
          bus.emit('git:summary:updated', summary);
        }
        return;
      }
      const s = r.status || r;
      const projectPath = state.projectPath;
      const projNorm = norm(projectPath);
      const next = new Map();
      const files = Array.isArray(s.files) ? s.files : [];
      for (const f of files) {
        if (!f || !f.path) continue;
        const letter = pickLetter(f);
        if (!letter) continue;
        const abs = norm(projNorm + '/' + f.path);
        next.set(abs, letter);
      }
      fileMap = next;
      rebuildFolderCounts(projectPath);
      summary = {
        branch: s.branch || null,
        ahead: s.ahead || 0,
        behind: s.behind || 0,
        tracking: s.tracking || null,
        dirty: files.length,
        hasRepo: true,
      };
      bus.emit('git:decorations:updated');
      bus.emit('git:summary:updated', summary);
    } catch {
      // ignore
    } finally {
      inFlight = false;
    }
  }

  const debouncedRefresh = debounce(refresh, 250);

  function startPolling() {
    if (pollTimer) return;
    refresh();
    pollTimer = setInterval(refresh, 8000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  bus.on('project:opened', () => { startPolling(); });
  bus.on('project:closed', () => {
    stopPolling();
    fileMap = new Map();
    folderCounts = new Map();
    summary = { branch: null, ahead: 0, behind: 0, tracking: null, dirty: 0, hasRepo: false };
    bus.emit('git:decorations:updated');
    bus.emit('git:summary:updated', summary);
  });
  bus.on('git:changed', () => debouncedRefresh());
  bus.on('files:refresh', () => debouncedRefresh());
  bus.on('file:saved', () => debouncedRefresh());
  bus.on('file:external-change', () => debouncedRefresh());
  bus.on('agent:file-edit', () => debouncedRefresh());

  // Boot if a project is already open at script load.
  if (state.projectPath) startPolling();

  window.PiPilot.gitDecorations = {
    fileLetter: (absPath) => fileMap.get(norm(absPath)) || null,
    folderCount: (absPath) => folderCounts.get(norm(absPath)) || 0,
    summary: () => summary,
    refresh,
  };
})();
