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

  // ── Mission transcript builder ─────────────────────────────────
  // Mirrors the chat-panel md export: text + inline tool pills with
  // bash commands fenced, file ops shown with paths + diffs, plus a
  // collapsed reasoning section. Used as the `finalText` on
  // missions:report-run so the persisted log mirrors what the user
  // saw in the stream tab.

  function _trim(s, maxLines = 12, maxChars = 1200) {
    if (!s) return '';
    let out = String(s);
    if (out.length > maxChars) out = out.slice(0, maxChars) + ' …(truncated)';
    const lines = out.split('\n');
    if (lines.length > maxLines) out = lines.slice(0, maxLines).join('\n') + `\n…(${lines.length - maxLines} more lines)`;
    return out;
  }

  function _formatToolCall(call, result) {
    const name = call.name || 'tool';
    const lname = name.replace(/^mcp__[a-zA-Z0-9_-]+__/, '').toLowerCase();
    const input = call.input || {};
    const isError = result?.isError;
    const isMcp = name.startsWith('mcp__');
    const status = isError ? '🔴' : (isMcp ? '🔌' : '🔧');

    const headParts = [`**${status} ${name}**`];
    // Most-meaningful inline preview per tool kind.
    const path = input.file_path || input.filepath || input.path || input.target_file;
    if (lname === 'bash' || lname === 'run_in_terminal' || lname === 'bashoutput') {
      if (input.description) headParts[0] += ` — ${input.description}`;
    } else if (path) {
      headParts[0] += ' `' + path + '`';
    } else if (input.pattern) {
      headParts[0] += ' `' + input.pattern + '`';
    } else if (input.url) {
      headParts[0] += ' ' + input.url;
    } else if (input.query) {
      headParts[0] += ' `' + input.query + '`';
    } else if (input.description) {
      headParts[0] += ` — ${input.description}`;
    }
    const parts = [headParts[0]];

    // Body — fenced details per tool kind.
    if (lname === 'bash' || lname === 'run_in_terminal') {
      if (input.command) parts.push('```bash\n$ ' + _trim(input.command, 12, 1200) + '\n```');
    } else if (lname === 'write' || lname === 'create_file') {
      if (input.content) {
        const ext = (path || '').split('.').pop();
        parts.push('```' + (ext || '') + '\n' + _trim(input.content, 30, 2400) + '\n```');
      }
    } else if (lname === 'edit' || lname === 'multiedit' || lname === 'edit_file_patch') {
      if (input.old_string && input.new_string) {
        const oldLines = _trim(input.old_string, 12, 600).split('\n').map(l => '- ' + l).join('\n');
        const newLines = _trim(input.new_string, 12, 600).split('\n').map(l => '+ ' + l).join('\n');
        parts.push('```diff\n' + oldLines + '\n' + newLines + '\n```');
      } else if (input.searchReplaceBlock) {
        parts.push('```\n' + _trim(input.searchReplaceBlock, 24, 1600) + '\n```');
      }
    } else if (lname === 'todowrite' && Array.isArray(input.todos)) {
      for (const t of input.todos) {
        const mark = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
        parts.push(`- ${mark} ${t.content || t.description || ''}`);
      }
    } else if (lname === 'webfetch' || lname === 'fetch_url') {
      if (input.url) parts.push('URL: ' + input.url);
    } else if (lname === 'websearch') {
      if (input.query) parts.push('Query: `' + input.query + '`');
    } else {
      // Generic small-args dump.
      const inputStr = JSON.stringify(input || {});
      if (inputStr.length > 2 && inputStr.length < 400) {
        parts.push('```json\n' + JSON.stringify(input, null, 2) + '\n```');
      }
    }

    // Result snippet — only when present + non-trivial + small.
    if (result && typeof result.content === 'string' && result.content.length) {
      const snippet = _trim(result.content, 8, 600);
      if (snippet.trim()) {
        const tag = isError ? 'error' : 'output';
        parts.push(`<details>\n<summary>${isError ? '⚠ ' : ''}${tag}</summary>\n\n\`\`\`\n${snippet}\n\`\`\`\n\n</details>`);
      }
    }
    return parts.join('\n');
  }

  function buildMissionTranscript(buf, mission, finalStatus) {
    const events = buf?.events || [];
    if (!events.length) return '(no events captured)';
    // Pre-index tool_results by id so we can colour pills.
    const resultsById = new Map();
    for (const evt of events) {
      if (evt.type === 'tool_result' && evt.toolUseId) resultsById.set(evt.toolUseId, evt);
    }
    const out = [];
    let currentText = '';
    const flushText = () => {
      if (currentText.trim()) {
        // Strip <reasoning>…</reasoning> — caller can opt to keep them
        // separately, but the inline transcript mirrors what the user saw.
        const cleaned = currentText.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim();
        if (cleaned) out.push(cleaned);
      }
      currentText = '';
    };
    let reasoningBlocks = [];
    let inReasoning = false;
    let reasoningBuf = '';
    for (const evt of events) {
      switch (evt.type) {
        case 'text': {
          // Detect inline <reasoning> tags and split them out.
          let s = evt.text || '';
          while (s.length) {
            if (!inReasoning) {
              const open = s.indexOf('<reasoning>');
              if (open === -1) { currentText += s; break; }
              currentText += s.slice(0, open);
              s = s.slice(open + '<reasoning>'.length);
              inReasoning = true;
              reasoningBuf = '';
            } else {
              const close = s.indexOf('</reasoning>');
              if (close === -1) { reasoningBuf += s; break; }
              reasoningBuf += s.slice(0, close);
              if (reasoningBuf.trim()) reasoningBlocks.push(reasoningBuf.trim());
              s = s.slice(close + '</reasoning>'.length);
              inReasoning = false;
              reasoningBuf = '';
            }
          }
          break;
        }
        case 'tool_call': {
          flushText();
          const result = resultsById.get(evt.id);
          out.push(_formatToolCall(evt, result));
          break;
        }
        case 'thinking': {
          if (typeof evt.text === 'string' && evt.text.trim()) reasoningBlocks.push(evt.text.trim());
          break;
        }
        case 'error': {
          flushText();
          if (evt.message) out.push(`> **⚠ Error:** ${evt.message}`);
          break;
        }
      }
    }
    flushText();
    if (reasoningBlocks.length) {
      out.unshift('<details>\n<summary>🧠 Reasoning</summary>\n\n' + reasoningBlocks.join('\n\n---\n\n') + '\n\n</details>');
    }
    if (finalStatus) out.push(`*Final status: \`${finalStatus}\`*`);
    return out.join('\n\n');
  }
  function pushEvent(missionId, evt) {
    const b = buffers.get(missionId);
    if (!b) return;
    const stamped = { ts: Date.now(), ...evt };
    b.events.push(stamped);
    bus.emit('mission:event', { missionId, evt: stamped });
  }

  api.missions.onRunNow(async (payload) => {
    const mission = payload?.mission;
    if (!mission?.id) return;
    if (inFlight.has(mission.id)) return;
    inFlight.add(mission.id);
    // Hold the powerSaveBlocker for this mission run via the background
    // module's refcounted active-agent tracker. Tag is unique per
    // mission so multiple concurrent missions are counted correctly.
    try { api.background?.setAgentActive?.(true, 'mission:' + mission.id); } catch {}

    const startedAt = Date.now();
    const sessionId = '__mission__' + mission.id + '__' + startedAt;
    let stream = null;

    // Initialise buffer + announce start so any open tab can attach.
    buffers.set(mission.id, { mission, events: [], status: 'running', startedAt, endedAt: 0, stream: null, stopped: false });
    bus.emit('mission:start', { mission, startedAt });
    let finalText = '';
    let toolCallCount = 0;
    let resultEvt = null;
    let finalized = false;       // single-shot guard so stop + result can't both finalize

    // No wall-clock timeout. Missions run until the agent finishes
    // naturally, hits an upstream API error, or the user clicks Stop.
    // Long-running refactors / large-clone missions are valid use
    // cases — killing them midway just produced confused stops.

    // Cloud missions: wire the GitHub Copilot HTTP MCP for all
    // GitHub-API ops (PRs, issues, search). The PAT only lives in the
    // Authorization header for that HTTP request. The clone's git
    // remote URL has its own token-inlined HTTPS auth (set up by
    // main/missions.js) so `git push` works without any extra env.
    let extraMcpServers = null;
    if (mission.target?.kind === 'cloud' && payload.githubPat) {
      extraMcpServers = {
        github: {
          type: 'http',
          url: 'https://api.githubcopilot.com/mcp',
          headers: { Authorization: 'Bearer ' + payload.githubPat },
        },
      };
    }

    // Cloud missions get the OS-temp scratch clone as cwd; local
    // missions keep their configured project path.
    const targetWorkDir = mission.target?.kind === 'local'
      ? mission.target.projectPath
      : (payload.cwdOverride || null);

    console.log('[missions-runner] starting', mission.id, mission.name);

    let resolveRun;
    try {
      await new Promise((resolve) => {
        resolveRun = resolve;
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
            if (!finalized) { finalized = true; resolve(); }
          }
        });
        const buf = buffers.get(mission.id);
        if (buf) {
          buf.stream = stream;
          // Allow stopMission() to force-resolve this promise if the
          // SDK's abort doesn't surface a result/error event in time.
          buf._forceFinalize = (reason) => {
            if (finalized) return;
            finalized = true;
            buf.stopped = true;
            resultEvt = { type: 'error', message: reason || 'Stopped by user', subtype: 'aborted' };
            resolve();
          };
        }
      });
    } catch (err) {
      console.warn('[missions-runner] failed:', err);
      resultEvt = { type: 'error', message: err?.message || String(err) };
    }

    const cleanFinal = finalText.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim();
    const tail = cleanFinal.split('\n').slice(-5).join(' ');
    const buf = buffers.get(mission.id);
    let status = 'success';
    let summary = tail.slice(0, 280);
    if (buf?.stopped || resultEvt?.subtype === 'aborted') { status = 'stopped'; summary = 'Stopped by user'; }
    else if (resultEvt?.type === 'error') { status = 'error'; summary = resultEvt.message || 'agent error'; }
    else if (resultEvt?.subtype === 'error' || resultEvt?.is_error) { status = 'error'; summary = summary || 'agent reported failure'; }
    else if (/^skipped:/i.test(tail)) { status = 'skipped'; }
    else if (/^failed:/i.test(tail)) { status = 'error'; }

    const durationMs = Date.now() - startedAt;
    inFlight.delete(mission.id);
    // Release the powerSaveBlocker reference for this mission.
    try { api.background?.setAgentActive?.(false, 'mission:' + mission.id); } catch {}

    // Update buffer + announce end so open tabs can switch to "done" UI.
    if (buf) { buf.status = status; buf.endedAt = Date.now(); }
    bus.emit('mission:end', { missionId: mission.id, status, summary, durationMs, finalText: cleanFinal });

    try { stream && stream.dispose && stream.dispose(); } catch {}

    try {
      const transcript = buildMissionTranscript(buf, mission, status);
      await api.missions.reportRun({
        id: mission.id,
        projectPath: window.PiPilot?.state?.projectPath || null,
        status,
        summary,
        durationMs,
        toolCallCount,
        finalText: transcript,
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
    if (!buf) return false;
    if (buf.status !== 'running') return false;
    buf.stopped = true;
    // Tell the SDK to abort. The agent's main loop will (usually)
    // surface an 'error' or 'result' event we can finalize on.
    try { buf.stream?.stop?.(); } catch {}
    bus.emit('toast:show', { type: 'info', message: 'Mission stop requested' });
    // Belt-and-suspenders: if the abort doesn't reach us within 4s
    // (network delay, SDK eating the error, whatever), force-finalize
    // locally so the UI doesn't sit at "running" forever.
    setTimeout(() => {
      const b = buffers.get(missionId);
      if (b && b.status === 'running' && typeof b._forceFinalize === 'function') {
        console.warn('[missions-runner] forcing finalize after stop —', missionId);
        b._forceFinalize('Stopped by user');
      }
    }, 4000);
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
