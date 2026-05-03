// PiPilot IDE — Notification bindings
//
// Central wire-up: subscribes to existing bus / IPC events and posts the
// right notifications. Keep new event-to-notification mappings here so the
// policy lives in ONE file instead of being scattered across modules.
//
// Coverage:
//   - Toast bridge: every `toast:show` is mirrored into the notification
//     center's history. Errors and toasts that ship an action are also
//     escalated to a persistent notification card (so the user can't miss
//     them or click into them after the fact).
//   - Missions: start (info, transient) + end (success/error card with an
//     "Open" action that surfaces the mission tab).
//   - Search index: a single sticky progress card that updates % and
//     auto-dismisses on done.
//   - Project opened: info card.
//   - Wiki: escalate errors only (status spam stays in the toast lane).
//   - Dev server: info card with an "Open" action when a URL is detected.
//   - Extension install events bridged in panels.js continue to use toasts;
//     this file additionally surfaces install failures as error cards.

(function () {
  const bus = window.PiPilot?.bus;
  const api = window.electronAPI;
  const notif = window.PiPilot?.notifications;
  if (!bus || !notif) return;

  // Note: toast.js handles the toast→notification dispatch policy itself
  // (escalates errors/actionable toasts to notification cards, records all
  // toasts in history). This file only adds new event sources beyond toasts.

  // ---------- Missions ----------
  bus.on('mission:start', ({ mission } = {}) => {
    if (!mission) return;
    notif.show({
      severity: 'info',
      message: `Mission "${mission.name}" started`,
      source: 'Missions',
      duration: 3000,
    });
  });

  bus.on('mission:end', (payload = {}) => {
    const m = payload.mission;
    const status = payload.status || 'success';
    const name = m?.name || payload.missionId || 'Mission';
    const sev = status === 'success' ? 'info' : status === 'error' ? 'error' : 'warn';
    const message =
      status === 'success' ? `Mission "${name}" finished`  :
      status === 'error'   ? `Mission "${name}" failed`    :
      status === 'skipped' ? `Mission "${name}" skipped`   :
                             `Mission "${name}": ${status}`;
    const detail = payload.summary || (payload.error && String(payload.error)) || '';
    notif.show({
      severity: sev,
      message,
      detail: detail.length > 200 ? detail.slice(0, 200) + '…' : detail,
      source: 'Missions',
      sticky: sev !== 'info',
      actions: m?.id ? [{
        label: 'Open',
        primary: true,
        onClick: () => bus.emit('missions:open-stream', { id: m.id }),
      }] : undefined,
    });
  });

  // ---------- Search index ----------
  // Single rolling progress card that updates as the indexer streams.
  let indexHandle = null;
  let indexDoneTimer = null;
  if (api?.searchIndex?.onProgress) {
    api.searchIndex.onProgress((p) => {
      if (!p) return;
      const phase = p.phase || p.status || '';
      const pct = typeof p.percent === 'number' ? p.percent
                : (p.processed && p.total ? Math.round((p.processed / p.total) * 100) : null);
      const msg = p.message || (phase ? `Search index: ${phase}` : 'Indexing project…');

      if (phase === 'done' || phase === 'ready' || pct === 100) {
        if (indexHandle) indexHandle.update({
          severity: 'info',
          message: 'Search index ready',
          progress: { percent: 100 },
          source: 'Search',
        });
        if (indexDoneTimer) clearTimeout(indexDoneTimer);
        indexDoneTimer = setTimeout(() => {
          if (indexHandle) { indexHandle.dismiss(); indexHandle = null; }
        }, 1500);
        return;
      }

      const progress = pct != null ? { percent: pct } : { indeterminate: true };
      if (!indexHandle) {
        indexHandle = notif.show({
          severity: 'progress',
          message: msg,
          source: 'Search',
          sticky: true,
          progress,
        });
      } else {
        indexHandle.update({ message: msg, progress });
      }
    });
  }

  // ---------- Project opened ----------
  bus.on('project:opened', (payload = {}) => {
    if (!payload.path) return;
    const name = payload.name || payload.path.split(/[\\/]/).pop();
    notif.show({
      severity: 'info',
      message: `Opened ${name}`,
      detail: payload.path,
      source: 'Workspace',
      duration: 2500,
    });
  });

  // ---------- Wiki ----------
  bus.on('wiki:auto-status', (payload = {}) => {
    if (payload.status !== 'error') return;
    notif.show({
      severity: 'warn',
      message: payload.message || 'Wiki update failed',
      source: 'Wiki',
      sticky: true,
    });
  });

  // ---------- Dev server ----------
  bus.on('devserver:start', (payload = {}) => {
    if (!payload.url && !payload.port) return;
    const url = payload.url || `http://localhost:${payload.port}`;
    notif.show({
      severity: 'info',
      message: 'Dev server running',
      detail: url,
      source: 'Dev Server',
      sticky: true,
      actions: [{
        label: 'Open Preview',
        primary: true,
        onClick: () => bus.emit('devserver:open-url', { url }),
      }],
    });
  });

  // ---------- Settings ----------
  bus.on('settings:loaded', () => {
    // intentionally silent — first-load shouldn't ping the user
  });

  // ---------- Background mode (info, when long-running) ----------
  bus.on('agent:status', (payload = {}) => {
    // Surface only on terminal transitions to prevent spam. The chat
    // pipeline emits this on every state change; we just want
    // 'idle-after-running' so the user knows the agent finished if the
    // window was hidden.
    if (payload.state !== 'idle' || !payload.fromRunning) return;
    if (document.hasFocus()) return;
    notif.show({
      severity: 'info',
      message: 'Agent finished',
      source: 'Chat',
      duration: 3500,
    });
  });
})();
