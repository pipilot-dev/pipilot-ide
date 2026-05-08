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

  if (msg.type === 'stream_event') {
    sendEvent({ type: 'stream_event', event: msg.event, parent_tool_use_id: msg.parent_tool_use_id }); n++;
    return n;
  }

  if (msg.type === 'assistant') {
    const blocks = msg.message?.content || [];
    for (const b of blocks) {
      if (b.type === 'text') {
        sendEvent({ type: 'text', text: b.text || '' }); n++;
      } else if (b.type === 'tool_use') {
        sendEvent({ type: 'tool_call', id: b.id, name: b.name, input: b.input }); n++;
      } else if (b.type === 'thinking') {
        sendEvent({ type: 'thinking', text: b.thinking || '' }); n++;
      }
    }
    return n;
  }

  if (msg.type === 'user') {
    const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const content = typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content)
            ? b.content.map(c => c.type === 'text' ? c.text : '').join('')
            : JSON.stringify(b.content);
        sendEvent({ type: 'tool_result', toolUseId: b.tool_use_id, content, isError: !!b.is_error }); n++;
      }
    }
    return n;
  }

  if (msg.type === 'result') {
    sendEvent({
      type: 'result',
      subtype: msg.subtype,
      duration_ms: msg.duration_ms,
      duration_api_ms: msg.duration_api_ms,
      num_turns: msg.num_turns,
      total_cost_usd: msg.total_cost_usd,
      usage: msg.usage,
      result: msg.result,
    }); n++;
    return n;
  }

  return n;
}

module.exports = {
  builtinMcpServers,
  BUILTIN_ALLOWED_TOOLS,
  loadUserMcpConfig,
  makeAskUserCanUseTool,
  dispatchSdkMessage,
};
