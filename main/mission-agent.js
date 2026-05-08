// PiPilot IDE — Mission Agent Driver (main process)
//
// Runs a single mission's agent stream in main, emitting normalised
// events to a caller-provided onEvent callback. Mirrors the event
// shape used by ipc-agent so existing renderer-side rendering code
// (missions-stream-tab) needs no changes when consuming via main's
// re-broadcast channel.
//
// Why in main: agent runs need to survive renderer reloads.
// Renderer-driven runs died the moment the user pressed Ctrl+R; the
// SDK kept iterating in main but its events fell into the void
// because the renderer-side listener was gone. Main-driven runs
// keep going regardless of what the renderer does — the renderer
// just resubscribes after reload and replays from the buffer.

const path = require('path');
const crypto = require('node:crypto');
const { loadSdk, resolveAgentRuntime } = require('./sdk-loader');
const ideTools = require('./mcp-ide-tools');
const { buildIdeTools } = require('./ide-tools-mcp');

// ── Per-mission warm-session cache ──────────────────────────────────
// Each mission keeps its own long-lived SDK subprocess. Subsequent
// runs of the same mission (e.g. wiki-auto-update firing after every
// file save, BugBot retrying on a new branch) skip the ~12 s cold
// start. Sessions are keyed by missionId — different missions get
// different sessions because their systemPrompt / allowedTools /
// MCP servers / env are session-scoped, not turn-scoped.
//
// LRU cap = 3 to keep RAM reasonable (each warm session is ~200 MB).
// Eviction closes the oldest idle session.
const MAX_WARM_MISSIONS = 3;
const warmMissions = new Map(); // missionId → { session, optsHash, currentTurn, lastUsed }

function optsHashOf(o) {
  // Anything session-scoped goes in. If any of these change between
  // runs of the same missionId we tear down + reboot the session.
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify({
    systemPrompt: o.systemPrompt || '',
    allowedTools: o.allowedTools || null,
    extraMcpServers: o.extraMcpServers || null,
    extraEnv: o.extraEnv || null,
    model: o.model || null,
    pipilotMcp: o.pipilotMcp !== false,
    workDir: o.workDir || '',
  }));
  return h.digest('hex');
}

function evictOldestIfFull() {
  if (warmMissions.size < MAX_WARM_MISSIONS) return;
  // Find the LRU entry that isn't currently mid-turn.
  let victimId = null;
  let victimAge = -Infinity;
  for (const [id, e] of warmMissions) {
    if (e.currentTurn) continue;
    const age = Date.now() - (e.lastUsed || 0);
    if (age > victimAge) { victimAge = age; victimId = id; }
  }
  if (!victimId) return; // all in flight — let caller pay cold start
  const victim = warmMissions.get(victimId);
  warmMissions.delete(victimId);
  try { victim?.session?.close?.(); } catch {}
}

function closeAllWarmMissions() {
  for (const [id, e] of warmMissions) {
    try { e.session?.close?.(); } catch {}
  }
  warmMissions.clear();
}

// Run a mission agent stream. Returns { promise, abort, controller }.
//   opts: {
//     missionName, missionId,        // for logs/breadcrumbs
//     prompt,                        // the user message to send
//     systemPrompt,                  // override
//     allowedTools,                  // ['Read','Edit',...]
//     model,                         // 'claude-sonnet-4-6' default
//     effort,                        // none/low/medium/high/xhigh
//     workDir,                       // cwd
//     extraMcpServers,               // optional { name: { type, url, headers } }
//     extraEnv,                      // optional env vars for spawned bash
//     pipilotMcp: bool,              // include pipilot IDE tools mcp (default true)
//   }
//   onEvent(evt): receives { type, ... } objects normalized like ipc-agent
function runMissionAgent(opts, onEvent) {
  const {
    missionName,
    missionId,
    prompt,
    systemPrompt,
    allowedTools,
    model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6',
    effort = 'medium',
    workDir,
    extraMcpServers,
    extraEnv,
    pipilotMcp = true,
  } = opts;

  const abortController = new AbortController();
  const safeEmit = (evt) => { try { onEvent && onEvent(evt); } catch (err) { console.warn('[mission-agent] onEvent threw', err); } };

  // Warm-mission fast path: if this missionId already has a warm SDK
  // subprocess sitting idle and its session-scoped opts haven't
  // drifted, push the new prompt straight into it (sub-second to
  // first token). Falls through to the cold path on cache miss,
  // session-closed, or opts drift — that path then BOOTS a warm
  // session for next time.
  const warmHandle = (opts.useWarmSession !== false && missionId)
    ? tryRunMissionWarm(opts, safeEmit, abortController)
    : null;
  if (warmHandle) {
    return {
      promise: warmHandle.promise,
      abort: () => abortController.abort(),
      controller: abortController,
    };
  }

  const promise = (async () => {
    // Hard auth gate — same as the chat agent. Missions run unattended so a
    // missing JWT must surface as a clear, structured error event rather
    // than as a confusing key-missing failure deep inside the SDK.
    let authJwt = null;
    let proxyUrl = null;
    try {
      const auth = require('./ipc-auth');
      authJwt = auth.getJwtSync();
      proxyUrl = auth.getProxyUrl();
    } catch {}
    if (!authJwt) {
      safeEmit({ type: 'error', message: 'Sign in with GitHub to run missions.' });
      safeEmit({ type: 'result', subtype: 'error', is_error: true, totalCostUsd: 0, durationMs: 0, usage: null });
      return { ok: false, error: 'unauthenticated' };
    }

    let sdk;
    try {
      sdk = await loadSdk();
    } catch (err) {
      safeEmit({ type: 'error', message: `Failed to load Agent SDK: ${err.message}` });
      safeEmit({ type: 'result', subtype: 'error', is_error: true, totalCostUsd: 0, durationMs: 0, usage: null });
      return { ok: false, error: err.message };
    }

    if (workDir) {
      try { ideTools.setWorkDir(workDir); } catch {}
    }

    // Build pipilot MCP — same set the chat agent gets, so missions
    // can use search_codebase, get_diagnostics, edit_file_patch, etc.
    const mcpServers = {};
    if (pipilotMcp) {
      try {
        // Missions run unattended — no visible terminal tab to attach to,
        // so we don't expose `run_in_terminal` (it would spawn a tab no
        // one's watching). The standard `Bash` tool covers their needs.
        const tools = buildIdeTools(sdk, null);
        mcpServers.pipilot = sdk.createSdkMcpServer({ name: 'pipilot', version: '1.0.0', tools });
      } catch (err) {
        console.warn('[mission-agent] pipilot mcp register failed', err.message);
      }
    }
    if (extraMcpServers && typeof extraMcpServers === 'object') {
      Object.assign(mcpServers, extraMcpServers);
    }

    // Same Electron-as-Node + asar-unpacked cli.js wiring the chat agent
    // uses — without this the spawn() inside the SDK fails in production.
    const agentRuntime = resolveAgentRuntime();

    const queryOpts = {
      prompt: String(prompt || ''),
      options: {
        systemPrompt: systemPrompt || '',
        cwd: workDir || process.cwd(),
        model,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        executable: agentRuntime.executable,
        executableArgs: agentRuntime.executableArgs,
        pathToClaudeCodeExecutable: agentRuntime.pathToClaudeCodeExecutable,
        abortController,
        mcpServers,
        allowedTools: Array.isArray(allowedTools) && allowedTools.length
          ? allowedTools
          : ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'mcp__pipilot__*'],
        env: {
          ENABLE_TOOL_SEARCH: 'auto',
          // Required so the spawned child Electron behaves as Node.
          ...agentRuntime.extraEnv,
          // Route through the auth-gated proxy with the user's JWT. Mirrors
          // the wiring in ipc-agent.js loadRuntimeEnvVars so missions get
          // the same authenticated transport as the chat agent.
          ANTHROPIC_BASE_URL:  proxyUrl,
          ANTHROPIC_AUTH_TOKEN: authJwt,
          ANTHROPIC_API_KEY:    authJwt,
          // Forward model-name overrides from the parent process if the
          // operator set them in .env.
          ...(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ? { ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL } : {}),
          ...(process.env.ANTHROPIC_DEFAULT_OPUS_MODEL   ? { ANTHROPIC_DEFAULT_OPUS_MODEL:   process.env.ANTHROPIC_DEFAULT_OPUS_MODEL   } : {}),
          ...(process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL  ? { ANTHROPIC_DEFAULT_HAIKU_MODEL:  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL  } : {}),
          ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
        },
        // Auto-allow tool uses — missions are unattended so we never
        // ask the user. (The mission's allowedTools list is the gate.)
        canUseTool: async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }),
      },
    };

    let resultSummary = null;
    try {
      const result = sdk.query(queryOpts);
      for await (const msg of result) {
        if (abortController.signal.aborted) break;

        // Mirror ipc-agent's normalisation so consumers see the same
        // event shapes regardless of which driver produced them.
        if (msg.type === 'assistant') {
          const content = msg.message?.content || [];
          for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'text' && typeof block.text === 'string') {
              safeEmit({ type: 'text', text: block.text });
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
              safeEmit({ type: 'thinking', text: block.thinking });
            } else if (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use') {
              safeEmit({
                type: 'tool_call',
                id: block.id,
                name: block.name,
                input: block.input,
                kind: block.type,
                serverName: block.server_name || null,
                parentToolUseId: msg.parent_tool_use_id || null,
              });
            }
          }
          continue;
        }

        if (msg.type === 'user') {
          const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
          for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'tool_result' || block.type === 'mcp_tool_result' || block.type === 'web_search_tool_result' || block.type === 'code_execution_tool_result' || block.type === 'bash_code_execution_tool_result' || block.type === 'text_editor_code_execution_tool_result') {
              let preview = block.content;
              if (Array.isArray(preview)) {
                preview = preview.map(p => (p && p.type === 'text') ? p.text : JSON.stringify(p)).join('\n');
              } else if (preview && typeof preview === 'object') {
                preview = JSON.stringify(preview);
              }
              let cleanContent = typeof preview === 'string' ? preview : String(preview ?? '');
              cleanContent = cleanContent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');
              safeEmit({
                type: 'tool_result',
                toolUseId: block.tool_use_id,
                content: cleanContent,
                isError: !!block.is_error,
                kind: block.type,
              });
            }
          }
          continue;
        }

        if (msg.type === 'stream_event') {
          const evt = msg.event;
          if (!evt) continue;
          if (evt.type === 'content_block_delta' && evt.delta) {
            if (evt.delta.type === 'text_delta') {
              safeEmit({ type: 'text_delta', text: evt.delta.text || '', index: evt.index });
            }
          } else if (evt.type === 'content_block_stop') {
            safeEmit({ type: 'block_stop', index: evt.index });
          } else if (evt.type === 'message_stop') {
            safeEmit({ type: 'message_stop' });
          }
          continue;
        }

        if (msg.type === 'result') {
          resultSummary = {
            type: 'result',
            subtype: msg.subtype || 'success',
            totalCostUsd: msg.total_cost_usd || 0,
            durationMs: msg.duration_ms || 0,
            num_turns: msg.num_turns || 0,
            is_error: !!msg.is_error,
            usage: msg.usage || null,
            permission_denials: msg.permission_denials || [],
            result: msg.result || null,
          };
          safeEmit(resultSummary);
          continue;
        }
      }
      // Async iterator finished without explicit result event — emit a
      // synthetic one so downstream code always sees a terminal event.
      if (!resultSummary) {
        const wasAborted = abortController.signal.aborted;
        const evt = { type: 'result', subtype: wasAborted ? 'aborted' : 'success', durationMs: 0, totalCostUsd: 0, usage: null, is_error: wasAborted };
        safeEmit(evt);
        resultSummary = evt;
      }
      return { ok: !resultSummary?.is_error, result: resultSummary };
    } catch (err) {
      const aborted = abortController.signal.aborted;
      safeEmit({ type: 'error', message: aborted ? 'Stopped by user.' : (err && err.message) || String(err) });
      const evt = { type: 'result', subtype: aborted ? 'aborted' : 'error', durationMs: 0, totalCostUsd: 0, usage: null, is_error: !aborted };
      safeEmit(evt);
      return { ok: false, error: err && err.message, aborted };
    }
  })();

  return {
    promise,
    abort: () => { try { abortController.abort(); } catch {} },
    controller: abortController,
  };
}

// ── Warm mission runner ─────────────────────────────────────────────
// Lazily boots a WorkspaceAgentSession for missionId on first run,
// reuses it on subsequent runs. Returns the same { promise, abort,
// controller }-shaped handle the cold runner does so the missions/
// runner code doesn't care which path served the run.
function tryRunMissionWarm(opts, safeEmit, abortController) {
  const {
    missionId, missionName, prompt,
    systemPrompt, allowedTools,
    model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6',
    workDir, extraMcpServers, extraEnv,
    pipilotMcp = true,
  } = opts;

  if (!missionId) return null;

  // Reject concurrent runs of the same mission — running the same
  // mission twice in parallel would double-write files / fight on
  // the same git branch / blow the proxy quota. Cold path can't run
  // either (caller would fall through and we'd fork a duplicate).
  const existing = warmMissions.get(missionId);
  if (existing && existing.currentTurn) {
    safeEmit({ type: 'error', message: `Mission "${missionName || missionId}" is already running.` });
    safeEmit({ type: 'result', subtype: 'error', is_error: true, totalCostUsd: 0, durationMs: 0, usage: null });
    return { promise: Promise.resolve({ ok: false, error: 'busy' }) };
  }

  const promise = (async () => {
    // Auth + SDK gating identical to the cold path. If either fails
    // we don't even attempt to cache anything — surface the error
    // and let the caller move on.
    let authJwt = null;
    let proxyUrl = null;
    try {
      const auth = require('./ipc-auth');
      authJwt = auth.getJwtSync();
      proxyUrl = auth.getProxyUrl();
    } catch {}
    if (!authJwt) {
      safeEmit({ type: 'error', message: 'Sign in with GitHub to run missions.' });
      safeEmit({ type: 'result', subtype: 'error', is_error: true, totalCostUsd: 0, durationMs: 0, usage: null });
      return { ok: false, error: 'unauthenticated' };
    }

    let sdk;
    try { sdk = await loadSdk(); }
    catch (err) {
      safeEmit({ type: 'error', message: `Failed to load Agent SDK: ${err.message}` });
      safeEmit({ type: 'result', subtype: 'error', is_error: true, totalCostUsd: 0, durationMs: 0, usage: null });
      return { ok: false, error: err.message };
    }

    if (workDir) {
      try { ideTools.setWorkDir(workDir); } catch {}
    }

    const hash = optsHashOf(opts);
    let cached = warmMissions.get(missionId);
    // Drift / dead-session detection — recreate from scratch.
    if (cached && (cached.optsHash !== hash || cached.session.closed)) {
      try { cached.session.close(); } catch {}
      warmMissions.delete(missionId);
      cached = null;
    }

    if (!cached) {
      // First run for this mission (or after drift) — boot a fresh
      // session. ~12 s cold start; subsequent runs of the same
      // mission skip this entirely.
      evictOldestIfFull();

      const mcpServers = {};
      if (pipilotMcp) {
        try {
          const tools = buildIdeTools(sdk, null);
          mcpServers.pipilot = sdk.createSdkMcpServer({ name: 'pipilot', version: '1.0.0', tools });
        } catch (err) {
          console.warn('[mission-warm] pipilot mcp register failed', err.message);
        }
      }
      if (extraMcpServers && typeof extraMcpServers === 'object') {
        Object.assign(mcpServers, extraMcpServers);
      }

      const { WorkspaceAgentSession } = require('./agent-warm-session');
      const sessionOpts = {
        systemPrompt: systemPrompt || '',
        model,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        mcpServers,
        allowedTools: Array.isArray(allowedTools) && allowedTools.length
          ? allowedTools
          : ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'mcp__pipilot__*'],
        env: {
          ENABLE_TOOL_SEARCH: 'auto',
          ANTHROPIC_BASE_URL: proxyUrl,
          ANTHROPIC_AUTH_TOKEN: authJwt,
          ANTHROPIC_API_KEY: authJwt,
          ...(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ? { ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL } : {}),
          ...(process.env.ANTHROPIC_DEFAULT_OPUS_MODEL   ? { ANTHROPIC_DEFAULT_OPUS_MODEL:   process.env.ANTHROPIC_DEFAULT_OPUS_MODEL   } : {}),
          ...(process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL  ? { ANTHROPIC_DEFAULT_HAIKU_MODEL:  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL  } : {}),
          ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
        },
        // Missions are unattended — auto-allow every tool. The
        // allowedTools list IS the gate; canUseTool is the per-call
        // hook the chat agent uses for AskUserQuestion which doesn't
        // apply here.
        canUseTool: async (_n, input) => ({ behavior: 'allow', updatedInput: input }),
      };

      const session = new WorkspaceAgentSession(workDir || process.cwd(), sessionOpts);

      cached = { session, optsHash: hash, currentTurn: null, lastUsed: Date.now() };
      warmMissions.set(missionId, cached);

      try {
        await session.start((msg) => {
          const turn = cached.currentTurn;
          if (!turn) return; // between turns — drop
          dispatchMissionMessage(msg, turn);
          // Result event marks turn end. Clear so the next mission
          // run for this missionId can claim a fresh turn slot, and
          // any stray messages the SDK emits afterwards get dropped
          // (the !turn guard above).
          if (msg.type === 'result') {
            cached.currentTurn = null;
            cached.lastUsed = Date.now();
          }
        });
      } catch (err) {
        warmMissions.delete(missionId);
        safeEmit({ type: 'error', message: `Mission warm-session boot failed: ${err.message}` });
        safeEmit({ type: 'result', subtype: 'error', is_error: true, totalCostUsd: 0, durationMs: 0, usage: null });
        return { ok: false, error: err.message };
      }
    }

    // We have a session, ready to send. Set up the per-turn state.
    cached.lastUsed = Date.now();
    const turnPromise = new Promise((resolveTurn) => {
      cached.currentTurn = {
        safeEmit,
        abortController,
        resolveTurn,
        resultSummary: null,
      };
    });

    // Abort wires to interrupt — keeps the session warm for the next
    // run. Closing it here would erase the speedup we just built.
    const onAbort = () => {
      try { cached.session.interrupt(); } catch {}
    };
    abortController.signal.addEventListener('abort', onAbort, { once: true });

    try {
      cached.session.send(String(prompt || ''));
    } catch (err) {
      cached.currentTurn = null;
      abortController.signal.removeEventListener?.('abort', onAbort);
      safeEmit({ type: 'error', message: err.message });
      const evt = { type: 'result', subtype: 'error', is_error: true, totalCostUsd: 0, durationMs: 0, usage: null };
      safeEmit(evt);
      return { ok: false, error: err.message };
    }

    const result = await turnPromise;
    abortController.signal.removeEventListener?.('abort', onAbort);
    return { ok: !result?.is_error, result };
  })();

  return { promise };
}

// Per-turn dispatcher — translates raw SDK messages to the
// mission-stream event shape the renderer already knows. Mirrors the
// inline cold-path normalisation; resolves the turn promise on result.
function dispatchMissionMessage(msg, turn) {
  if (!msg || typeof msg !== 'object') return;
  const safeEmit = turn.safeEmit;
  const aborted = turn.abortController.signal.aborted;

  if (msg.type === 'assistant') {
    for (const block of (msg.message?.content || [])) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        safeEmit({ type: 'text', text: block.text });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        safeEmit({ type: 'thinking', text: block.thinking });
      } else if (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use') {
        safeEmit({
          type: 'tool_call',
          id: block.id, name: block.name, input: block.input,
          kind: block.type, serverName: block.server_name || null,
          parentToolUseId: msg.parent_tool_use_id || null,
        });
      }
    }
    return;
  }
  if (msg.type === 'user') {
    for (const block of (Array.isArray(msg.message?.content) ? msg.message.content : [])) {
      if (!block || typeof block !== 'object') continue;
      const TR = ['tool_result','mcp_tool_result','web_search_tool_result','code_execution_tool_result','bash_code_execution_tool_result','text_editor_code_execution_tool_result'];
      if (!TR.includes(block.type)) continue;
      let preview = block.content;
      if (Array.isArray(preview)) preview = preview.map(p => (p && p.type === 'text') ? p.text : JSON.stringify(p)).join('\n');
      else if (preview && typeof preview === 'object') preview = JSON.stringify(preview);
      let cleanContent = typeof preview === 'string' ? preview : String(preview ?? '');
      cleanContent = cleanContent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');
      safeEmit({
        type: 'tool_result', toolUseId: block.tool_use_id,
        content: cleanContent, isError: !!block.is_error, kind: block.type,
      });
    }
    return;
  }
  if (msg.type === 'stream_event') {
    const ev = msg.event;
    if (!ev) return;
    if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'text_delta') {
        safeEmit({ type: 'text_delta', text: ev.delta.text || '', index: ev.index });
      }
    } else if (ev.type === 'content_block_stop') {
      safeEmit({ type: 'block_stop', index: ev.index });
    } else if (ev.type === 'message_stop') {
      safeEmit({ type: 'message_stop' });
    }
    return;
  }
  if (msg.type === 'result') {
    const summary = {
      type: 'result',
      subtype: msg.subtype || (aborted ? 'aborted' : 'success'),
      totalCostUsd: msg.total_cost_usd || 0,
      durationMs: msg.duration_ms || 0,
      num_turns: msg.num_turns || 0,
      is_error: !!msg.is_error || aborted,
      usage: msg.usage || null,
      permission_denials: msg.permission_denials || [],
      result: msg.result || null,
    };
    turn.resultSummary = summary;
    safeEmit(summary);
    // The session pump's caller clears currentTurn; we just resolve here.
    try { turn.resolveTurn(summary); } catch {}
    return;
  }
}

module.exports = { runMissionAgent, closeAllWarmMissions };
