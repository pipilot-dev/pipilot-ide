// PiPilot IDE — Missions Runner (renderer side)
//
// Subscribes to the main process's `missions:run-now` broadcast and
// spawns a silent agent via api.agent.send — the same plumbing the
// wiki-auto-update agent uses. Reports the outcome back to main via
// api.missions.reportRun so stats + log are persisted in one place.

(function () {
  'use strict';
  if (window.__pipilotMissionsRunnerLoaded) return;
  window.__pipilotMissionsRunnerLoaded = true;

  const bus = window.PiPilot && window.PiPilot.bus;
  const api = (window.PiPilot && window.PiPilot.api) || window.electronAPI;
  if (!bus || !api?.agent?.send || !api?.missions?.onRunNow) {
    console.warn('[missions-runner] dependencies missing — disabled');
    return;
  }

  // Single-flight guard. The main-process tracker is authoritative, but
  // we also guard here so if two run-now broadcasts arrive back-to-back
  // (rare, but possible during reconnects), we drop the duplicate.
  const inFlight = new Set();

  // Per-mission event buffer so a tab opened mid-run can replay
  // everything it missed. Mapped by mission.id -> { mission, events,
  // status, startedAt, endedAt, stream }.
  // events: array of { ts, ...evt } so tab renderers can scrub or reflow.
  const buffers = new Map();
  function pushEvent(missionId, evt) {
    const b = buffers.get(missionId);
    if (!b) return;
    const stamped = { ts: Date.now(), ...evt };
    b.events.push(stamped);
    bus.emit('mission:event', { missionId, evt: stamped });
  }

  const TIMEOUT_MS = 6 * 60_000;

  api.missions.onRunNow(async (payload) => {
    const mission = payload?.mission;
    if (!mission?.id) return;
    if (inFlight.has(mission.id)) return;
    inFlight.add(mission.id);

    const startedAt = Date.now();
    const sessionId = '__mission__' + mission.id + '__' + startedAt;
    let stream = null;

    // Initialise buffer + announce start so any open tab can attach.
    buffers.set(mission.id, { mission, events: [], status: 'running', startedAt, endedAt: 0, stream: null });
    bus.emit('mission:start', { mission, startedAt });
    let finalText = '';
    let toolCallCount = 0;
    let timedOut = false;
    let resultEvt = null;

    const timer = setTimeout(() => {
      timedOut = true;
      try { stream && stream.stop && stream.stop(); } catch {}
    }, TIMEOUT_MS);

    // Cloud missions need github MCP with the PAT injected. The main
    // process passes the PAT once on run-now; we forward it via
    // extraMcpServers, never store it in the renderer.
    let extraMcpServers = null;
    if (mission.target?.kind === 'cloud' && payload.githubPat) {
      extraMcpServers = {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: payload.githubPat },
        },
      };
    }

    const targetWorkDir = mission.target?.kind === 'local'
      ? mission.target.projectPath
      : null;   // cloud: SDK gets no cwd; tools operate via mcp__github__*

    console.log('[missions-runner] starting', mission.id, mission.name);

    try {
      await new Promise((resolve) => {
        stream = api.agent.send({
          sessionId,
          projectPath: targetWorkDir,
          message: `Run the mission described in your system prompt now. Today's date: ${new Date().toISOString().slice(0,10)}.`,
          mode: 'agent',
          effort: payload.effort || mission.effort || 'medium',
          silent: true,
          systemPromptOverride: payload.systemPrompt,
          allowedToolsOverride: payload.allowedTools,
          extraMcpServers,
        }, (evt) => {
          if (!evt) return;
          if (evt.type === 'tool_call') toolCallCount++;
          if (evt.type === 'text' && typeof evt.text === 'string') finalText += evt.text;
          // Forward EVERY event to the per-mission buffer + bus so
          // open tabs render the live stream.
          pushEvent(mission.id, evt);
          if (evt.type === 'result' || evt.type === 'error') {
            resultEvt = evt;
            resolve();
          }
        });
        const buf = buffers.get(mission.id);
        if (buf) buf.stream = stream;
      });
    } catch (err) {
      console.warn('[missions-runner] failed:', err);
      resultEvt = { type: 'error', message: err?.message || String(err) };
    }
    clearTimeout(timer);

    const cleanFinal = finalText.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim();
    const tail = cleanFinal.split('\n').slice(-5).join(' ');
    let status = 'success';
    let summary = tail.slice(0, 280);
    if (timedOut) { status = 'timeout'; summary = 'agent ran past timeout'; }
    else if (resultEvt?.type === 'error') { status = 'error'; summary = resultEvt.message || 'agent error'; }
    else if (resultEvt?.subtype === 'error' || resultEvt?.is_error) { status = 'error'; summary = summary || 'agent reported failure'; }
    else if (/^skipped:/i.test(tail)) { status = 'skipped'; }
    else if (/^failed:/i.test(tail)) { status = 'error'; }

    const durationMs = Date.now() - startedAt;
    inFlight.delete(mission.id);

    // Update buffer + announce end so open tabs can switch to "done" UI.
    const buf = buffers.get(mission.id);
    if (buf) { buf.status = status; buf.endedAt = Date.now(); }
    bus.emit('mission:end', { missionId: mission.id, status, summary, durationMs, finalText: cleanFinal });

    try { stream && stream.dispose && stream.dispose(); } catch {}

    try {
      await api.missions.reportRun({
        id: mission.id,
        projectPath: window.PiPilot?.state?.projectPath || null,
        status,
        summary,
        durationMs,
        toolCallCount,
        finalText: cleanFinal,
      });
    } catch (err) {
      console.warn('[missions-runner] reportRun failed:', err);
    }

    // BugBot: read findings file and surface in Problems panel.
    if (Array.isArray(mission.tags) && mission.tags.includes('bugbot') && mission.target?.kind === 'local' && status !== 'error') {
      try { await processBugBotFindings(mission); } catch (err) { console.warn('[missions-runner] bugbot post-process failed', err); }
    }

    // User-facing toast based on the mission's notify prefs.
    const notify = mission.notify || {};
    const allow =
      (status === 'success' && notify.onSuccess !== false) ||
      (status === 'error'   && notify.onError   !== false) ||
      (status === 'skipped' && notify.onSkip    === true);
    if (allow) {
      const type = status === 'success' ? 'ok' : status === 'error' ? 'warn' : 'info';
      bus.emit('toast:show', { type, message: `Mission "${mission.name}": ${status}` });
    }

    // Let any open Missions panel re-render with fresh stats.
    bus.emit('missions:refresh');
  });

  // ── BugBot → Problems panel ─────────────────────────────────────
  // The BugBot prompt instructs the agent to write findings as JSON
  // Lines (one object per line) to <projectPath>/.pipilot/bug-findings.jsonl.
  // We read it after the run, normalize each entry, and emit a
  // problems:updated event so the Problems panel surfaces them.
  async function processBugBotFindings(mission) {
    const projectPath = mission.target.projectPath;
    if (!projectPath) return;
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const findingsPath = projectPath + sep + '.pipilot' + sep + 'bug-findings.jsonl';

    let raw = '';
    try {
      const r = await api.files.read(findingsPath);
      raw = r?.content || (typeof r === 'string' ? r : '');
    } catch {
      return;   // file probably absent — agent reported no bugs
    }
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

  // Stop a running mission. We can only abort our own renderer-side
  // stream — main-process state is updated via missions:report-run
  // when the agent stream ends naturally, so we synthesize a final
  // event by stopping the stream (the SDK abort triggers a 'result'
  // event with subtype:'aborted').
  function stopMission(missionId) {
    const buf = buffers.get(missionId);
    if (!buf || !buf.stream) return false;
    try { buf.stream.stop?.(); } catch {}
    bus.emit('toast:show', { type: 'info', message: 'Mission stop requested' });
    return true;
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.missions = window.PiPilot.missions || {};
  window.PiPilot.missions.runner = {
    inFlightCount: () => inFlight.size,
    isRunning: (id) => inFlight.has(id),
    getBuffer: (id) => buffers.get(id) || null,
    stopMission,
  };
})();
