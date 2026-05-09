// PiPilot IDE — Warm-session IPC handlers (opt-in, additive).
//
// The cold path (ipc-agent.js's `agent:send`) spawns a fresh CLI
// subprocess per message — ~12 s boot every time. This module keeps
// one long-lived `query()` per workspace so subsequent messages cost
// no boot. Same wire format as cold path so the renderer's existing
// dispatcher works unchanged.
//
// Renderer adoption is opt-in: cold `agent:send` is untouched and
// remains the source of truth for missions, plan-mode-with-system-
// prompt-overrides, mid-call MCP injection, etc. Chat tab can switch
// to the warm IPC once it's been verified.

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const { loadSdk } = require('./sdk-loader');
const ideTools = require('./mcp-ide-tools');
const { buildIdeTools } = require('./ide-tools-mcp');
const { WorkspaceAgentSession } = require('./agent-warm-session');
const {
  builtinMcpServers,
  BUILTIN_ALLOWED_TOOLS,
  loadUserMcpConfig,
  makeAskUserCanUseTool,
  dispatchSdkMessage,
  formatCurrentTimePrefix,
} = require('./agent-shared');

// Auto-compact when the prior turn's input_tokens crossed this line.
// Some fallback models in the proxy chain cap as low as 131k tokens
// (and the typical "OOC at 292k" failures we saw came from one
// turn's context already being > 200k). Compacting at 100k leaves
// real headroom for the /compact step's own overhead + the user's
// next prompt + system prompt + tool defs even on the smallest
// endpoint, without forcing aggressive compaction on big-context
// models.
const COMPACT_THRESHOLD_TOKENS = 100_000;

module.exports = function registerAgentWarmHandlers(ipcMain, ctx) {
  // pendingInputRequests is shared with the cold path so the existing
  // `agent:answer-question` handler can resolve answers from either.
  // ipc-agent.js stores the same Map on ctx (lazy-init below).
  const pendingInputRequests = ctx.pendingInputRequests
    || (ctx.pendingInputRequests = new Map());

  // workspaceDir → { session, sessionId, currentTurn, openedAt }
  const sessions = new Map();
  // streamId → workspaceDir, for interrupt routing.
  const streamToWorkspace = new Map();

  function send(channel, payload) {
    const win = ctx.getWindow && ctx.getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  // Read the session_id stamped at the top of .pipilot history (step 1)
  // so warm sessions resume the same conversation across IDE restarts.
  function readPersistedSessionId(workDir) {
    if (!workDir) return null;
    try {
      const f = path.join(workDir, '.pipilot', '_pipilot_history.json');
      if (!fs.existsSync(f)) return null;
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (raw && typeof raw === 'object' && raw.sessionId) return raw.sessionId;
      return null;
    } catch { return null; }
  }
  // Read+modify+write the history object. Returns the saved object so
  // callers can chain reads (e.g. recent-history injection) without a
  // second disk hit.
  function readHistoryRaw(workDir) {
    const empty = { sessionId: null, updatedAt: null, messages: [] };
    if (!workDir) return empty;
    try {
      const f = path.join(workDir, '.pipilot', '_pipilot_history.json');
      if (!fs.existsSync(f)) return empty;
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(parsed)) return { sessionId: null, updatedAt: null, messages: parsed };
      if (parsed && typeof parsed === 'object') return {
        sessionId: parsed.sessionId || null,
        updatedAt: parsed.updatedAt || null,
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      };
      return empty;
    } catch { return empty; }
  }
  function writeHistoryRaw(workDir, raw) {
    if (!workDir) return;
    try {
      const dir = path.join(workDir, '.pipilot');
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const f = path.join(dir, '_pipilot_history.json');
      const out = {
        sessionId: raw.sessionId || null,
        updatedAt: new Date().toISOString(),
        messages: Array.isArray(raw.messages) ? raw.messages : [],
      };
      fs.writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');
    } catch (err) {
      console.error('[agent-warm] writeHistoryRaw failed:', err.message);
    }
  }
  // Append a {role, content, timestamp} entry. Same shape + 40-message
  // cap the cold path uses, so the wiki + recent-conversation viewers
  // can't tell which path produced an entry.
  function appendHistoryEntry(workDir, entry) {
    if (!workDir || !entry) return;
    try {
      if (entry.role === 'assistant' && entry.content && entry.content.length > 300) {
        entry.content = entry.content.slice(0, 300) + '...';
      }
      const raw = readHistoryRaw(workDir);
      raw.messages.push(entry);
      if (raw.messages.length > 40) raw.messages = raw.messages.slice(-40);
      writeHistoryRaw(workDir, raw);
    } catch (err) {
      console.error('[agent-warm] appendHistoryEntry failed:', err.message);
    }
  }

  // Update the same file when a fresh session_id is issued by the SDK.
  function persistSessionId(workDir, sessionId) {
    if (!workDir || !sessionId) return;
    const raw = readHistoryRaw(workDir);
    if (raw.sessionId === sessionId) return;
    raw.sessionId = sessionId;
    writeHistoryRaw(workDir, raw);
  }

  // Build the SDK options for a fresh warm session. Workspace-stable;
  // model and permissionMode can be mutated mid-session via setModel /
  // setPermissionMode without restarting the subprocess.
  async function buildSessionOptions(workDir, opts = {}) {
    const sdk = await loadSdk();
    ideTools.setWorkDir(workDir);
    const ideToolsList = buildIdeTools(sdk, ctx);
    const ideMcp = sdk.createSdkMcpServer({ name: 'pipilot', version: '1.0.0', tools: ideToolsList });

    const userMcp = loadUserMcpConfig(workDir, ctx.userDataPath);

    return {
      // Session-stable
      cwd: workDir,
      includePartialMessages: true,
      permissionMode: opts.permissionMode || 'bypassPermissions',
      model: opts.model || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6',
      mcpServers: {
        ...builtinMcpServers(ideMcp),
        ...userMcp.servers,
      },
      allowedTools: [
        ...BUILTIN_ALLOWED_TOOLS,
        ...userMcp.allowedTools,
      ],
      env: {
        ENABLE_TOOL_SEARCH: 'auto',
        // The auth-gated proxy URL + JWT live in loadRuntimeEnvVars
        // (sets ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN). Without
        // those the SDK can't reach the model and the turn hangs
        // silently — this was step-3's biggest gotcha. Pull from ctx
        // (populated by ipc-agent.js's register fn).
        ...(typeof ctx.loadConnectorEnvVars === 'function' ? ctx.loadConnectorEnvVars(workDir) : {}),
        ...(typeof ctx.loadRuntimeEnvVars === 'function' ? ctx.loadRuntimeEnvVars() : {}),
      },
      // NOTE: `resume` deliberately omitted. We persist the sessionId
      // at the top of .pipilot/_pipilot_history.json (step 1) for
      // future use, but auto-resuming a stale id where the on-disk
      // session has been deleted causes the SDK to hang silently.
      // Once we wire a "continue last conversation?" UI we can opt in.
    };
  }

  // ── agent:warm-open ──
  // Boots a long-lived session for a workspace. Idempotent — calling
  // again returns the existing session's status.
  ipcMain.handle('agent:warm-open', async (_e, { projectPath } = {}) => {
    if (!projectPath) return { ok: false, error: 'projectPath required' };
    const existing = sessions.get(projectPath);
    if (existing && !existing.session.closed) {
      return { ok: true, reused: true, sessionId: existing.sessionId || null };
    }
    try {
      const baseOptions = await buildSessionOptions(projectPath);
      // Per-turn canUseTool capturer — the warm session's onMessage
      // already routes to `entry.currentTurn.sendEvent`, so the bridge
      // function only needs to know which streamId is active right now.
      const dynamicCanUseTool = async (toolName, input) => {
        const t = entry.currentTurn;
        if (!t) return { behavior: 'allow', updatedInput: input };
        const sendForTurn = (payload) => send(t.channel, payload);
        const cb = makeAskUserCanUseTool({
          sendEvent: sendForTurn,
          pendingInputRequests,
          streamId: t.streamId,
        });
        return cb(toolName, input);
      };

      const session = new WorkspaceAgentSession(projectPath, {
        ...baseOptions,
        canUseTool: dynamicCanUseTool,
      });

      const entry = {
        session,
        sessionId: baseOptions.resume || null,
        currentTurn: null,
        openedAt: Date.now(),
        turnCount: 0,
        // Last turn's input-token count. We track this so the next
        // send() can decide whether to fire /compact preemptively
        // before the model OOCs. The proxy was hitting 292k+ token
        // requests against models that cap at 196–262k — by then
        // every fallback model rejected the call. Compacting at 150k
        // leaves headroom for any of them.
        lastInputTokens: 0,
      };
      sessions.set(projectPath, entry);

      await session.start((msg) => {
        const t = entry.currentTurn;
        if (!t) return; // Stray message between turns — drop.

        // Compaction phase. We inject /compact before the user's real
        // turn when context is large; while it runs we don't want the
        // renderer to see the /compact's text/result as if it were
        // the user's reply. We DO forward compact_boundary so the UI
        // can show its "Context compacted" indicator.
        if (t.compacting) {
          if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
            dispatchSdkMessage(msg, (payload) => send(t.channel, payload));
          }
          if (msg.type === 'result') {
            // /compact done. Reset token tally — post-compact context
            // is dramatically smaller. Resolve so the awaiting send()
            // can fire the user's actual prompt.
            entry.lastInputTokens = 0;
            // Belt-and-braces: tell the renderer to hide its shimmer
            // even if the SDK never emitted compact_boundary above
            // (the renderer's case 'compact_boundary' is the normal
            // hide path; this is the fallback).
            try { send(t.channel, { type: 'compacting_end' }); } catch {}
            const fn = t.onCompactDone;
            t.onCompactDone = null;
            t.compacting = false;
            try { fn && fn(); } catch {}
          }
          return;
        }

        dispatchSdkMessage(msg, (payload) => send(t.channel, payload), {
          onSessionId: (sid) => {
            entry.sessionId = sid;
            persistSessionId(projectPath, sid);
          },
        });
        if (msg && msg.type === 'assistant') {
          for (const b of (msg.message?.content || [])) {
            if (b?.type === 'text' && typeof b.text === 'string') {
              t.assistantText = (t.assistantText || '') + b.text;
            }
          }
        }
        if (msg && msg.type === 'result') {
          // Capture TOTAL context tokens for the next-send compaction
          // decision. With prompt caching (which the SDK enables by
          // default once context grows), `input_tokens` only counts
          // the new uncached portion — the bulk of the conversation
          // hides in `cache_read_input_tokens`. Both occupy the
          // model's context window, so both must count toward the
          // threshold. We also fall back to OpenAI-shape `prompt_tokens`
          // in case the proxy translates it.
          const u = msg.usage || {};
          const total = (u.input_tokens || u.prompt_tokens || 0)
            + (u.cache_read_input_tokens || 0)
            + (u.cache_creation_input_tokens || 0);
          if (total > 0) entry.lastInputTokens = total;
          if (t.assistantText) {
            appendHistoryEntry(projectPath, {
              role: 'assistant',
              content: t.assistantText,
              timestamp: new Date().toISOString(),
            });
          }
          streamToWorkspace.delete(t.streamId);
          entry.currentTurn = null;
        }
      });

      return { ok: true, reused: false, sessionId: entry.sessionId };
    } catch (err) {
      console.error('[agent-warm] open failed:', err);
      sessions.delete(projectPath);
      return { ok: false, error: err.message };
    }
  });

  // ── agent:warm-send ──
  // Push a user message into the running session. Streams responses
  // back on `agent:stream:<streamId>` — same channel format as cold path.
  ipcMain.handle('agent:warm-send', async (_e, { streamId, projectPath, message } = {}) => {
    if (!streamId || !projectPath || !message) {
      return { ok: false, error: 'streamId, projectPath, message all required' };
    }
    const entry = sessions.get(projectPath);
    if (!entry || entry.session.closed) {
      return { ok: false, error: 'no warm session — call agent:warm-open first' };
    }
    if (entry.currentTurn) {
      // Chat UI should disable send while a turn is in flight; this is a
      // belt-and-braces guard so we don't interleave streams.
      return { ok: false, error: 'turn already in progress on this workspace' };
    }
    // Match the cold path's channel format so the renderer's existing
    // `agent.send` listener machinery (preload streamListeners) works
    // without a second subscription path.
    const channel = `agent:event:${streamId}`;
    entry.currentTurn = { streamId, channel, assistantText: '' };
    streamToWorkspace.set(streamId, projectPath);
    try {
      // Persist the user turn (raw text, no injection) BEFORE we touch
      // the SDK. Same shape + 40-message cap as cold so wiki / recent-
      // conversation viewers can't tell the paths apart on disk.
      appendHistoryEntry(projectPath, {
        role: 'user',
        content: String(message),
        timestamp: new Date().toISOString(),
      });

      // Always prefix every user prompt with the current local time +
      // ISO timestamp so the agent never has to guess "today". Cold
      // path does the same (see agent-shared.formatCurrentTimePrefix).
      const timed = `${formatCurrentTimePrefix()}\n\n${String(message)}`;

      // First turn of a fresh warm session: inject prior-conversation
      // context the same way cold path's agent:send does. The SDK
      // process holds no memory of pre-restart turns; subsequent turns
      // inside this session don't need it (SDK keeps context natively).
      let promptForSdk = timed;
      if (entry.turnCount === 0) {
        try {
          const raw = readHistoryRaw(projectPath);
          // Drop the user entry we just appended above (it'd be a
          // self-reference in the "Previous conversation:" block).
          const prior = (raw.messages || []).slice(0, -1);
          const recent = prior
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6); // last 3 pairs, same cap as cold
          if (recent.length > 0) {
            const MAX_MSG_LEN = 400;
            const ctxBlock = recent.map(m => {
              const c = m.content || '';
              const trimmed = c.length > MAX_MSG_LEN ? c.slice(0, MAX_MSG_LEN) + '...[truncated]' : c;
              return `${m.role === 'user' ? 'Human' : 'Assistant'}: ${trimmed}`;
            }).join('\n\n');
            promptForSdk = `Previous conversation:\n${ctxBlock}\n\nCurrent request: ${timed}`;
            console.log(`[agent-warm] Injected ${recent.length} prior entries on turn 0`);
          }
        } catch (err) {
          console.warn('[agent-warm] history injection failed:', err.message);
        }
      }

      // Auto-compact when the previous turn pushed input tokens past
      // our safety threshold. The smallest free model in the proxy
      // chain caps at 196k tokens — we compact at 150k so even after
      // /compact's own overhead and a moderately-sized next prompt
      // we stay well under every fallback's ceiling.
      if (entry.lastInputTokens > COMPACT_THRESHOLD_TOKENS) {
        try {
          // Tell the chat panel to show its shimmer indicator while
          // /compact runs. We end it on compact_boundary (or on the
          // 60s safety timeout below).
          send(channel, {
            type: 'compacting_start',
            preTokens: entry.lastInputTokens,
            // Same friendly phrasing as the SDK-internal auto-compact
            // pill — users see one consistent indicator regardless of
            // who triggered the compaction.
            label: 'Optimizing context…',
          });
          entry.currentTurn.compacting = true;
          await new Promise((resolve) => {
            entry.currentTurn.onCompactDone = resolve;
            entry.session.send('/compact');
            // Hard cap — if /compact silently never finishes (rare,
            // but the SDK has had streaming bugs in this area), give
            // up and proceed with the original prompt anyway. The
            // user will see the OOC error and can /clear manually.
            setTimeout(() => {
              if (entry.currentTurn?.onCompactDone === resolve) {
                console.warn('[agent-warm] /compact timed out after 60s — proceeding without it');
                try { send(channel, { type: 'compacting_end' }); } catch {}
                entry.currentTurn.onCompactDone = null;
                entry.currentTurn.compacting = false;
                entry.lastInputTokens = 0;
                resolve();
              }
            }, 60000);
          });
        } catch (err) {
          console.warn('[agent-warm] auto-compact failed:', err.message);
          if (entry.currentTurn) entry.currentTurn.compacting = false;
        }
      }

      entry.session.send(promptForSdk);
      entry.turnCount += 1;
      return { ok: true, channel };
    } catch (err) {
      entry.currentTurn = null;
      streamToWorkspace.delete(streamId);
      return { ok: false, error: err.message };
    }
  });

  // ── agent:warm-interrupt ──
  // Synthesize the terminal `result` event BEFORE awaiting
  // session.interrupt(). Two reasons:
  //   1. Query.interrupt() can be slow or even hang (it's awaiting
  //      the SDK's IPC ack); the renderer would stay at "Working…"
  //      until it returned.
  //   2. After currentTurn is cleared the dispatcher drops every
  //      message the SDK sends, including any natural result event
  //      — so we can't rely on the SDK to terminate the turn cleanly.
  // Emitting first means the renderer hides the spinner and finalises
  // the message immediately, while interrupt() runs in the background.
  ipcMain.handle('agent:warm-interrupt', async (_e, { streamId } = {}) => {
    const projectPath = streamToWorkspace.get(streamId);
    if (!projectPath) return { ok: false, error: 'no active turn for streamId' };
    const entry = sessions.get(projectPath);
    if (!entry) return { ok: false, error: 'no session' };
    const turn = entry.currentTurn;

    // 1. Emit synthetic result FIRST.
    if (turn) {
      try {
        send(turn.channel, {
          type: 'result',
          subtype: 'aborted',
          total_cost_usd: 0, totalCostUsd: 0,
          duration_ms: 0,    durationMs: 0,
          duration_api_ms: 0,
          num_turns: 0,
          is_error: false,
          usage: null,
          modelUsage: null,
          permission_denials: [],
          result: null,
          errors: null,
        });
      } catch {}
    }
    // 2. Clear turn state so post-interrupt SDK messages are dropped.
    streamToWorkspace.delete(streamId);
    entry.currentTurn = null;
    // 3. Tell the SDK to actually stop generating. Doesn't kill the
    //    subprocess — the warm session lives on, ready for the next
    //    turn. We don't await this; the user already got their
    //    "stopped" event.
    Promise.resolve().then(() => entry.session.interrupt())
      .catch((err) => console.warn('[agent-warm] interrupt failed:', err.message));
    return { ok: true };
  });

  // ── agent:warm-set-model / set-permission-mode ──
  // Live-mutate the running session without restart.
  ipcMain.handle('agent:warm-set-model', async (_e, { projectPath, model } = {}) => {
    const entry = sessions.get(projectPath);
    if (!entry) return { ok: false, error: 'no session' };
    try { await entry.session.setModel(model); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('agent:warm-set-permission-mode', async (_e, { projectPath, mode } = {}) => {
    const entry = sessions.get(projectPath);
    if (!entry) return { ok: false, error: 'no session' };
    try { await entry.session.setPermissionMode(mode); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // ── agent:warm-close ──
  ipcMain.handle('agent:warm-close', async (_e, { projectPath } = {}) => {
    const entry = sessions.get(projectPath);
    if (!entry) return { ok: true, alreadyClosed: true };
    try { await entry.session.close(); }
    catch (err) { console.warn('[agent-warm] close error:', err.message); }
    sessions.delete(projectPath);
    if (entry.currentTurn) streamToWorkspace.delete(entry.currentTurn.streamId);
    return { ok: true };
  });

  // ── agent:warm-status ──
  // Diagnostics for the renderer / settings panel.
  ipcMain.handle('agent:warm-status', async () => {
    return {
      sessions: Array.from(sessions.entries()).map(([projectPath, e]) => ({
        projectPath,
        sessionId: e.sessionId,
        openedAt: e.openedAt,
        ageMs: Date.now() - e.openedAt,
        busy: !!e.currentTurn,
        closed: !!e.session.closed,
      })),
    };
  });

  // Best-effort cleanup on app quit so the spawned CLI subprocesses
  // don't outlive the IDE. Includes warm mission sessions (kept in a
  // separate cache inside main/mission-agent.js).
  app.on('before-quit', async () => {
    await Promise.all(
      Array.from(sessions.values()).map((e) => e.session.close().catch(() => {}))
    );
    sessions.clear();
    try {
      const { closeAllWarmMissions } = require('./mission-agent');
      if (typeof closeAllWarmMissions === 'function') closeAllWarmMissions();
    } catch (err) {
      console.warn('[agent-warm] warm-mission cleanup failed:', err.message);
    }
  });
};
