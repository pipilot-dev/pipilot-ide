// PiPilot IDE — Shared agent constants & helpers.
//
// Exists so the warm-session path (ipc-agent-warm.js) can build SDK
// options that match the cold-spawn path (ipc-agent.js's agent:send)
// without copy-pasting MCP discovery + canUseTool wiring.
//
// Scope intentionally narrow: just the bits that vary by workspace and
// don't depend on per-call mode/effort/model. The cold path still
// constructs its full options inline — these helpers are for the warm
// path. If we later converge them, this is the file the cold path
// should import from too.

const fs = require('node:fs');
const path = require('node:path');

// Builtin MCP servers — same set the cold path wires up.
function builtinMcpServers(ideMcp) {
  return {
    pipilot: ideMcp,
    context7:  { type: 'http', url: 'https://mcp.context7.com/mcp' },
    appdeploy: { type: 'http', url: 'https://api-v2.appdeploy.ai/mcp' },
    deepwiki:  { type: 'http', url: 'https://mcp.deepwiki.com/mcp' },
    playwright: { command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-playwright@latest'] },
  };
}

// Default allowed tool patterns for the chat agent. Mirrors cold path.
const BUILTIN_ALLOWED_TOOLS = [
  'mcp__pipilot__*',
  'mcp__context7__*',
  'mcp__appdeploy__*',
  'mcp__deepwiki__*',
  'mcp__playwright__*',
  'Agent',
  'WebSearch',
  'WebFetch',
];

// Reads user-defined MCP servers from
//   1) <projectPath>/.pipilot/mcp.json    — committed per project
//   2) <userData>/mcp-servers.json        — UI-managed
// and returns { servers, allowedTools } the SDK can merge into its
// mcpServers + allowedTools options.
function loadUserMcpConfig(projectPath, userDataPath) {
  const servers = {};
  const allowedTools = [];
  if (projectPath) {
    try {
      const f = path.join(projectPath, '.pipilot', 'mcp.json');
      if (fs.existsSync(f)) {
        const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (cfg.servers && typeof cfg.servers === 'object') {
          Object.assign(servers, cfg.servers);
          for (const name of Object.keys(cfg.servers)) {
            allowedTools.push(`mcp__${name}__*`);
          }
        }
      }
    } catch {}
  }
  if (userDataPath) {
    try {
      const f = path.join(userDataPath, 'mcp-servers.json');
      if (fs.existsSync(f)) {
        const list = JSON.parse(fs.readFileSync(f, 'utf8'));
        for (const srv of (Array.isArray(list) ? list : [])) {
          if (!srv.enabled || !srv.name) continue;
          const name = srv.name.replace(/[^a-zA-Z0-9_-]/g, '_');
          if (srv.type === 'http' && srv.url) {
            const cfg = { type: 'http', url: srv.url };
            if (srv.headers && typeof srv.headers === 'object' && Object.keys(srv.headers).length) {
              cfg.headers = srv.headers;
            }
            servers[name] = cfg;
          } else if (srv.command) {
            servers[name] = {
              command: srv.command,
              args: srv.args || [],
              env: srv.env || {},
            };
          } else continue;
          allowedTools.push(`mcp__${name}__*`);
        }
      }
    } catch {}
  }
  return { servers, allowedTools };
}

// Factory for the canUseTool callback that bridges AskUserQuestion to
// the renderer (same protocol as cold path: emits 'ask_user' / waits
// for the renderer to call agent:answer-question, denies after 30 min).
//
// Required deps:
//   sendEvent(payload)         → forward an SDK-shaped message to the renderer
//   pendingInputRequests       → shared Map<requestId, {resolve, ...}>
//   streamId                   → identifies the current turn for cancellation
function makeAskUserCanUseTool({ sendEvent, pendingInputRequests, streamId }) {
  return async (toolName, input) => {
    if (toolName !== 'AskUserQuestion') {
      return { behavior: 'allow', updatedInput: input };
    }
    const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    sendEvent({ type: 'ask_user', requestId, questions: input?.questions || [] });

    const outcome = await new Promise((resolve) => {
      pendingInputRequests.set(requestId, {
        resolve: (a) => resolve({ kind: 'answer', value: a }),
        question: input,
        streamId,
      });
      setTimeout(() => {
        if (!pendingInputRequests.has(requestId)) return;
        pendingInputRequests.delete(requestId);
        resolve({ kind: 'timeout' });
      }, 30 * 60 * 1000);
    });

    if (outcome.kind === 'timeout') {
      sendEvent({ type: 'ask_user_timeout', requestId });
      return {
        behavior: 'deny',
        message: 'AskUserQuestion was not answered within 30 minutes. Do not assume any choice on the user\'s behalf — proceed only with information you already have, or ask again with a clearer question.',
      };
    }
    return { behavior: 'allow', updatedInput: outcome.value };
  };
}

// ── Tool-execution timing instrumentation ────────────────────────
// Records the wall time between an SDK tool_use arriving and the
// matching tool_result coming back, so we can see where Bash (and
// any other tool) actually spends its time. Triggered on every call;
// logs to the main-process console with name + duration + input
// preview. Toggle off by setting PIPILOT_TOOL_TIMING=0.
const TOOL_TIMING_ENABLED = process.env.PIPILOT_TOOL_TIMING !== '0';
const _toolStartTimes = new Map(); // tool_use_id → { name, ts, inputPreview }

function _previewInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  if (name === 'Bash' || name === 'BashOutput' || name === 'run_in_terminal') {
    return String(input.command || '').slice(0, 80);
  }
  if (input.file_path) return String(input.file_path).split(/[\\/]/).pop();
  if (input.path)      return String(input.path).split(/[\\/]/).pop();
  if (input.pattern)   return String(input.pattern);
  if (input.url)       return String(input.url).slice(0, 60);
  if (input.query)     return String(input.query).slice(0, 60);
  return '';
}

// Translate raw SDK messages into the wire-format the renderer's
// chat.js already speaks. Lifted from ipc-agent.js's `for await msg
// of result` loop, preserved 1:1 so the renderer doesn't need to
// learn a second event vocabulary for warm sessions. Returns the
// number of events emitted (mostly for diagnostics).
function dispatchSdkMessage(msg, sendEvent, opts = {}) {
  if (!msg || typeof msg !== 'object') return 0;
  const onSessionId = opts.onSessionId; // optional callback for init session_id
  let n = 0;

  if (msg.type === 'system') {
    if (msg.subtype === 'init') {
      if (onSessionId && msg.session_id) {
        try { onSessionId(msg.session_id); } catch {}
      }
      sendEvent({
        type: 'system', subtype: 'init',
        model: msg.model, cwd: msg.cwd, tools: msg.tools || [],
        mcp_servers: msg.mcp_servers || [],
        permission_mode: msg.permissionMode,
        slash_commands: msg.slash_commands || [],
        session_id: msg.session_id,
      }); n++;
    } else if (msg.subtype === 'compact_boundary') {
      sendEvent({ type: 'compact_boundary', trigger: msg.compact_metadata?.trigger, preTokens: msg.compact_metadata?.pre_tokens }); n++;
    } else if (msg.subtype === 'status') {
      sendEvent({ type: 'status', status: msg.status }); n++;
    } else if (msg.subtype === 'hook_response') {
      sendEvent({ type: 'hook', hook: msg.hook_name, event: msg.hook_event, exitCode: msg.exit_code }); n++;
    } else {
      sendEvent({ type: 'system', subtype: msg.subtype || null }); n++;
    }
    return n;
  }

  // stream_event carries the partial-message deltas when
  // includePartialMessages: true. Unpack the same shapes the cold
  // path emits so chat.js's text_delta / block_start / block_stop /
  // message_stop cases all fire.
  if (msg.type === 'stream_event') {
    const ev = msg.event;
    if (!ev) return n;
    if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'text_delta') {
        sendEvent({ type: 'text_delta', text: ev.delta.text || '', index: ev.index }); n++;
      } else if (ev.delta.type === 'thinking_delta') {
        sendEvent({ type: 'thinking_delta', text: ev.delta.thinking || '', index: ev.index }); n++;
      } else if (ev.delta.type === 'input_json_delta') {
        sendEvent({ type: 'input_delta', partial: ev.delta.partial_json || '', index: ev.index }); n++;
      }
    } else if (ev.type === 'content_block_start') {
      sendEvent({ type: 'block_start', block: ev.content_block, index: ev.index }); n++;
    } else if (ev.type === 'content_block_stop') {
      sendEvent({ type: 'block_stop', index: ev.index }); n++;
    } else if (ev.type === 'message_stop') {
      sendEvent({ type: 'message_stop' }); n++;
    }
    return n;
  }

  if (msg.type === 'assistant') {
    const blocks = msg.message?.content || [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') {
        sendEvent({ type: 'text', text: b.text }); n++;
      } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
        sendEvent({ type: 'thinking', text: b.thinking }); n++;
      } else if (b.type === 'redacted_thinking') {
        sendEvent({ type: 'thinking', text: '[redacted]', redacted: true }); n++;
      } else if (b.type === 'tool_use' || b.type === 'mcp_tool_use' || b.type === 'server_tool_use') {
        // Mark the start so the matching tool_result can compute
        // the round-trip elapsed below. Includes the input preview
        // so the log line is grep-able by command.
        if (TOOL_TIMING_ENABLED && b.id) {
          _toolStartTimes.set(b.id, {
            name: b.name || '?',
            ts: Date.now(),
            inputPreview: _previewInput(b.name, b.input),
          });
        }
        sendEvent({
          type: 'tool_call',
          id: b.id, name: b.name, input: b.input,
          kind: b.type,
          serverName: b.server_name || null,
          parentToolUseId: msg.parent_tool_use_id || null,
        }); n++;
      }
    }
    return n;
  }

  if (msg.type === 'user') {
    const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const TR_KINDS = ['tool_result', 'mcp_tool_result', 'web_search_tool_result',
        'code_execution_tool_result', 'bash_code_execution_tool_result',
        'text_editor_code_execution_tool_result'];
      if (TR_KINDS.includes(b.type)) {
        // Close the timing record for this tool use and log it.
        // Format: "[tool-timing] Bash 234 ms ✓: ls -la"
        if (TOOL_TIMING_ENABLED && b.tool_use_id) {
          const start = _toolStartTimes.get(b.tool_use_id);
          if (start) {
            _toolStartTimes.delete(b.tool_use_id);
            const elapsed = Date.now() - start.ts;
            const status = b.is_error ? '✗' : '✓';
            const tag = start.inputPreview ? `: ${start.inputPreview}` : '';
            console.log(`[tool-timing] ${start.name} ${elapsed} ms ${status}${tag}`);
          }
        }
        let preview = b.content;
        if (Array.isArray(preview)) {
          preview = preview.map(p => (p && p.type === 'text') ? p.text : JSON.stringify(p)).join('\n');
        } else if (preview && typeof preview === 'object') {
          preview = JSON.stringify(preview);
        }
        let cleanContent = typeof preview === 'string' ? preview : String(preview ?? '');
        cleanContent = cleanContent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');
        sendEvent({
          type: 'tool_result',
          toolUseId: b.tool_use_id,
          content: cleanContent,
          isError: !!b.is_error,
          kind: b.type,
        }); n++;
      }
    }
    return n;
  }

  if (msg.type === 'tool_progress') {
    sendEvent({
      type: 'tool_progress',
      toolUseId: msg.tool_use_id,
      toolName: msg.tool_name,
      elapsedSeconds: msg.elapsed_time_seconds,
    }); n++;
    return n;
  }
  if (msg.type === 'auth_status') {
    sendEvent({
      type: 'auth_status',
      isAuthenticating: msg.isAuthenticating,
      output: msg.output,
      error: msg.error,
    }); n++;
    return n;
  }

  if (msg.type === 'result') {
    sendEvent({
      type: 'result',
      subtype: msg.subtype || 'success',
      total_cost_usd: msg.total_cost_usd || 0,
      totalCostUsd: msg.total_cost_usd || 0,
      duration_ms: msg.duration_ms || 0,
      durationMs: msg.duration_ms || 0,
      duration_api_ms: msg.duration_api_ms || 0,
      num_turns: msg.num_turns || 0,
      is_error: !!msg.is_error,
      usage: msg.usage || null,
      modelUsage: msg.modelUsage || null,
      permission_denials: msg.permission_denials || [],
      result: msg.result || null,
      errors: msg.errors || null,
    }); n++;
    return n;
  }

  return n;
}

// One-line "current time" prefix injected into every user prompt so
// the agent never has to guess the date for things like commit
// trailers, scheduled-task references, or "today's" anything. Format
// is the host-local time (with offset) AND the absolute ISO so the
// model has both human-readable and machine-parseable forms.
function formatCurrentTimePrefix() {
  const now = new Date();
  // Pretty local time, e.g. "Fri, May 8, 2026, 08:34 AM (-04:00)".
  let pretty;
  try {
    pretty = now.toLocaleString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset',
    });
  } catch {
    pretty = now.toString();
  }
  return `[Current time: ${pretty} • ISO ${now.toISOString()}]`;
}

module.exports = {
  builtinMcpServers,
  BUILTIN_ALLOWED_TOOLS,
  loadUserMcpConfig,
  makeAskUserCanUseTool,
  dispatchSdkMessage,
  formatCurrentTimePrefix,
};
