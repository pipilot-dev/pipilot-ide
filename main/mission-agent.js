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
const { loadSdk, resolveAgentRuntime } = require('./sdk-loader');
const ideTools = require('./mcp-ide-tools');
const { buildIdeTools } = require('./ide-tools-mcp');

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

module.exports = { runMissionAgent };
