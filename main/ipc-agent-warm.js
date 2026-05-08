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
        // Counts user turns we've sent into this warm session. Used to
        // decide whether to inject prior-conversation context into the
        // prompt: yes on turn 0 (the SDK process is fresh, has no
        // memory of pre-restart history), no thereafter (SDK retains
        // context within a session, re-injecting would just waste tokens).
        turnCount: 0,
      };
      sessions.set(projectPath, entry);

      await session.start((msg) => {
        const t = entry.currentTurn;
        if (!t) return; // Stray message between turns — drop.
        dispatchSdkMessage(msg, (payload) => send(t.channel, payload), {
          onSessionId: (sid) => {
            entry.sessionId = sid;
            persistSessionId(projectPath, sid);
          },
        });
        // Accumulate assistant text for the current turn so we can
        // write a single history entry at result-time. Cold path does
        // the same — chat.js shows a stream of bubbles, the persisted
        // log keeps just the final text (capped to 300 chars by
        // appendHistoryEntry).
        if (msg && msg.type === 'assistant') {
          for (const b of (msg.message?.content || [])) {
            if (b?.type === 'text' && typeof b.text === 'string') {
              t.assistantText = (t.assistantText || '') + b.text;
            }
          }
        }
        if (msg && msg.type === 'result') {
          // Persist the assistant turn before we clear state.
          if (t.assistantText) {
            appendHistoryEntry(projectPath, {
              role: 'assistant',
              content: t.assistantText,
              timestamp: new Date().toISOString(),
            });
          }
          // Turn complete — clear so the next agent:warm-send can take.
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
  ipcMain.handle('agent:warm-interrupt', async (_e, { streamId } = {}) => {
    const projectPath = streamToWorkspace.get(streamId);
    if (!projectPath) return { ok: false, error: 'no active turn for streamId' };
    const entry = sessions.get(projectPath);
    if (!entry) return { ok: false, error: 'no session' };
    try {
      await entry.session.interrupt();
      streamToWorkspace.delete(streamId);
      entry.currentTurn = null;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
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
