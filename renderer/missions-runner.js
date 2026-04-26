// PiPilot IDE — Missions runner (renderer side, thin)
//
// Used to drive the agent from here via api.agent.send. Now main owns
// the agent loop (so missions survive renderer reloads, see
// main/mission-agent.js + main/missions.js). This module is reduced
// to a thin event relay:
//
//   1. Receives missions:event / missions:start / missions:end / missions:bg-active
//      broadcasts from main and re-emits them on the renderer bus so
//      existing UI (stream tab, panel cards, BugBot processor) keeps
//      working without rewrites.
//   2. Reflects main's "is X running" set so window.PiPilot.missions.runner
//      .isRunning(id) still works for the stream tab's initial-state
//      heuristic.
//   3. Handles bg-active broadcasts by acquiring/releasing the
//      powerSaveBlocker via api.background.setAgentActive — main
//      can't talk to background-mode directly because the refcounted
//      tracker lives in main too, but bg-active is one tag per
//      mission so the count stays correct.
//   4. Post-processes BugBot findings file when a tagged mission ends.

(function () {
  'use strict';
  if (window.__pipilotMissionsRunnerLoaded) return;
  window.__pipilotMissionsRunnerLoaded = true;

  const bus = window.PiPilot && window.PiPilot.bus;
  const api = (window.PiPilot && window.PiPilot.api) || window.electronAPI;
  if (!bus || !api?.missions) {
    console.warn('[missions-runner] dependencies missing — disabled');
    return;
  }

  // Mirror main's in-flight set for fast renderer-side queries.
  const runningIds = new Set();
  // Thin per-mission buffer mirror, kept warm for the stream tab.
  const buffers = new Map();   // id -> { mission, events, status, startedAt, endedAt }

  function getBuffer(id) { return buffers.get(id) || null; }

  // ── Main → renderer: live event stream ───────────────────────────
  api.missions.onStart(({ mission, startedAt }) => {
    if (!mission?.id) return;
    runningIds.add(mission.id);
    buffers.set(mission.id, { mission, events: [], status: 'running', startedAt, endedAt: 0 });
    bus.emit('mission:start', { mission, startedAt });
  });

  api.missions.onEvent(({ missionId, evt }) => {
    if (!missionId || !evt) return;
    const b = buffers.get(missionId);
    if (b) b.events.push(evt);
    bus.emit('mission:event', { missionId, evt });
  });

  api.missions.onEnd((payload) => {
    const id = payload?.missionId;
    if (!id) return;
    runningIds.delete(id);
    const b = buffers.get(id);
    if (b) { b.status = payload.status || 'success'; b.endedAt = Date.now(); }
    bus.emit('mission:end', payload);
    bus.emit('missions:refresh');
    // BugBot post-processing — read findings file and surface in
    // Problems panel when a bugbot-tagged mission completes.
    const m = b?.mission || payload?.mission;
    if (m && Array.isArray(m.tags) && m.tags.includes('bugbot') && m.target?.kind === 'local' && payload.status !== 'error') {
      processBugBotFindings(m).catch(err => console.warn('[missions-runner] bugbot post-process', err));
    }
    // Outcome toast based on the mission's notify prefs.
    if (m) {
      const notify = m.notify || {};
      const allow =
        (payload.status === 'success' && notify.onSuccess !== false) ||
        (payload.status === 'error'   && notify.onError   !== false) ||
        (payload.status === 'skipped' && notify.onSkip    === true);
      if (allow) {
        const type = payload.status === 'success' ? 'ok' : payload.status === 'error' ? 'warn' : 'info';
        bus.emit('toast:show', { type, message: `Mission "${m.name}": ${payload.status}` });
      }
    }
  });

  // bg-active: bridge to background-mode's refcounted blocker.
  api.missions.onBgActive(({ id, active }) => {
    try { api.background?.setAgentActive?.(active, 'mission:' + id); } catch {}
  });

  // ── Cold start / reload: reconcile with main's in-flight state ──
  // After a renderer reload, main is the source of truth. Pull all
  // currently-running missions and pre-fill our buffers so the
  // first stream-tab open replays correctly.
  (async () => {
    try {
      const r = await api.missions.inFlightState();
      const list = (r?.missions || []).filter(x => x.running);
      for (const item of list) {
        runningIds.add(item.id);
        // Pull events buffer for replay.
        try {
          const st = await api.missions.getState(item.id);
          if (st?.ok) {
            buffers.set(item.id, {
              mission: item.mission,
              events: st.events || [],
              status: st.running ? 'running' : (st.status || 'success'),
              startedAt: st.startedAt || item.startedAt,
              endedAt: st.running ? 0 : Date.now(),
            });
          }
        } catch {}
      }
      if (list.length) {
        console.log(`[missions-runner] reconnected to ${list.length} running mission(s) from main`);
        bus.emit('missions:refresh');
      }
    } catch (err) {
      console.warn('[missions-runner] cold-start reconcile failed', err);
    }
  })();

  // ── BugBot integration ──────────────────────────────────────────
  async function processBugBotFindings(mission) {
    const projectPath = mission.target.projectPath;
    if (!projectPath) return;
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const findingsPath = projectPath + sep + '.pipilot' + sep + 'bug-findings.jsonl';
    let raw = '';
    try {
      const r = await api.files.read(findingsPath);
      raw = r?.content || (typeof r === 'string' ? r : '');
    } catch { return; }
    if (!raw.trim()) return;
    const items = [];
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (!obj || !obj.path || !obj.message) continue;
        items.push({
          path: obj.path,
          line: typeof obj.line === 'number' ? obj.line : 1,
          column: typeof obj.column === 'number' ? obj.column : 1,
          severity: obj.severity || 'warning',
          message: String(obj.message).slice(0, 400),
          code: obj.code || 'BugBot',
          source: 'BugBot',
        });
      } catch {}
    }
    if (!items.length) return;
    const counts = {
      errors: items.filter(i => i.severity === 'error').length,
      warnings: items.filter(i => i.severity === 'warning').length,
      info: items.filter(i => i.severity === 'info').length,
      total: items.length,
    };
    const byFile = items.reduce((acc, it) => {
      (acc[it.path] = acc[it.path] || []).push(it);
      return acc;
    }, {});
    bus.emit('problems:updated', { items, counts, byFile, error: null });
    bus.emit('bottom:show', 'problems');
    bus.emit('toast:show', { type: 'info', message: `BugBot: ${items.length} finding${items.length === 1 ? '' : 's'}` });
  }

  // Public API consumed by the stream tab + others.
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.missions = window.PiPilot.missions || {};
  window.PiPilot.missions.runner = {
    isRunning: (id) => runningIds.has(id),
    inFlightCount: () => runningIds.size,
    getBuffer,
    stopMission: (id) => api.missions.stop(id),
  };
})();
