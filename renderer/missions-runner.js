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

  const TIMEOUT_MS = 6 * 60_000;

  api.missions.onRunNow(async (payload) => {
    const mission = payload?.mission;
    if (!mission?.id) return;
    if (inFlight.has(mission.id)) return;
    inFlight.add(mission.id);

    const startedAt = Date.now();
    const sessionId = '__mission__' + mission.id + '__' + startedAt;
    let stream = null;
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
          if (evt.type === 'tool_call') {
            toolCallCount++;
            console.log('[missions-runner]', mission.id, 'tool_call', evt.name);
          } else if (evt.type === 'text' && typeof evt.text === 'string') {
            finalText += evt.text;
          } else if (evt.type === 'result' || evt.type === 'error') {
            resultEvt = evt;
            resolve();
          }
        });
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

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.missions = window.PiPilot.missions || {};
  window.PiPilot.missions.runner = { inFlightCount: () => inFlight.size };
})();
