// PiPilot IDE — Claude Agent SDK IPC (Phase 4)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

module.exports = function register(ipcMain, ctx) {
  const sessions = new Map(); // streamId -> { abortCtrl, projectPath, sessionId, pendingInputs: [] }
  const sessionStorage = new Map(); // sessionId -> { id, title, messages, createdAt, lastMessageAt, projectPath }

  // AskUserQuestion pending map (requestId -> { resolve, question, streamId })
  // Shared with the warm-session path (ipc-agent-warm.js) via ctx so a
  // single agent:answer-question handler resolves AskUserQuestion
  // bridges from either path. Lazy-init so register order doesn't matter.
  const pendingInputRequests = ctx.pendingInputRequests
    || (ctx.pendingInputRequests = new Map());

  const sessionsDir = path.join(ctx.userDataPath, 'sessions');
  try { fs.mkdirSync(sessionsDir, { recursive: true }); } catch {}

  const ideTools = require('./mcp-ide-tools');

  // Use the shared loader so both ipc-agent and mission-agent get the
  // same module instance + same agent-runtime resolution (Electron-as-Node
  // executable + asar-unpacked cli.js path).
  const { loadSdk, resolveAgentRuntime } = require('./sdk-loader');
  const { formatCurrentTimePrefix } = require('./agent-shared');

  // Build IDE-specific MCP tools — shared with mission agents.
  const { buildIdeTools } = require('./ide-tools-mcp');


  function sessionFile(sessionId) {
    const safe = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(sessionsDir, safe + '.json');
  }

  function loadSessionFromDisk(sessionId) {
    if (sessionStorage.has(sessionId)) return sessionStorage.get(sessionId);
    try {
      const raw = fs.readFileSync(sessionFile(sessionId), 'utf8');
      const parsed = JSON.parse(raw);
      sessionStorage.set(sessionId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  function saveSessionToDisk(session) {
    if (!session || !session.id) return;
    try {
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8');
    } catch (err) {
      console.error('session save failed:', err);
    }
  }

  function listSessionsForProject(projectPath) {
    let files = [];
    try { files = fs.readdirSync(sessionsDir); } catch { return []; }
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, f), 'utf8');
        const s = JSON.parse(raw);
        if (projectPath && s.projectPath && s.projectPath !== projectPath) continue;
        if (s.id && String(s.id).startsWith('__wiki__')) continue;
        out.push({
          id: s.id,
          title: s.title || 'Untitled',
          lastMessageAt: s.lastMessageAt || s.createdAt || 0,
          messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
          projectPath: s.projectPath || null,
        });
      } catch {}
    }
    out.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    return out;
  }

  function send(event, channel, payload) {
    try {
      const win = ctx.getWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      } else if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send(channel, payload);
      }
    } catch (err) {
      console.error('send failed:', err);
    }
  }

  // ── Connector env vars (match Vite app behavior) ──
  const CONNECTOR_ENV_MAP = {
    github:     (t) => ({ GITHUB_TOKEN: t }),
    vercel:     (t) => ({ VERCEL_TOKEN: t }),
    netlify:    (t) => ({ NETLIFY_AUTH_TOKEN: t }),
    npm:        (t) => ({ NPM_TOKEN: t }),
    neon:       (t) => ({ NEON_API_KEY: t }),
    cloudflare: (t) => ({ CLOUDFLARE_API_TOKEN: t }),
    railway:    (t) => ({ RAILWAY_TOKEN: t }),
    turso:      (t) => ({ TURSO_AUTH_TOKEN: t }),
    stripe:     (t) => ({ STRIPE_SECRET_KEY: t }),
    sentry:     (t) => ({ SENTRY_AUTH_TOKEN: t }),
    supabase:   (t) => ({ SUPABASE_ACCESS_TOKEN: t }),
  };

  function loadJsonSafe(p) {
    try {
      if (!p || !fs.existsSync(p)) return {};
      return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  // Exposed on ctx so the warm-session path (ipc-agent-warm.js) reuses
  // the same connector + dotenv + auth-token wiring without duplicating.
  function loadConnectorEnvVars(workDir) {
    const envs = {};
    try {
      // 1) Config-file connectors
      const globalPath = path.join(ctx.userDataPath, 'config', 'connectors.json');
      const globalConnectors = loadJsonSafe(globalPath).connectors || {};
      const projectConnectors = loadJsonSafe(path.join(workDir, '.pipilot', 'connectors.json')).connectors || {};
      const merged = { ...globalConnectors, ...projectConnectors };

      for (const [id, cfg] of Object.entries(merged)) {
        const c = cfg || {};
        if (!c.enabled || !c.token) continue;
        const mapper = CONNECTOR_ENV_MAP[id];
        if (mapper) {
          Object.assign(envs, mapper(c.token));
        } else if (c.envVar) {
          envs[c.envVar] = c.token;
        }
      }

      // 2) UI-saved cloud tokens (Extensions panel → Connectors tab)
      const uiTokens = loadJsonSafe(path.join(ctx.userDataPath, 'cloud-tokens.json'));
      for (const [id, tokenData] of Object.entries(uiTokens)) {
        const token = typeof tokenData === 'string' ? tokenData : (tokenData && tokenData.token);
        if (!token) continue;
        const mapper = CONNECTOR_ENV_MAP[id];
        if (mapper) Object.assign(envs, mapper(token));
      }
    } catch {}
    return envs;
  }

  // ── Runtime env vars (.env) for vanilla/Electron builds ──
  // Vite normally injects these via its server process env; the fiddle needs
  // to load them explicitly so the Agent SDK and related tools can see them.
  function loadDotEnvFile(envPath) {
    const out = {};
    try {
      if (!envPath || !fs.existsSync(envPath)) return out;
      const raw = fs.readFileSync(envPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key) out[key] = val;
      }
    } catch {}
    return out;
  }

  function loadRuntimeEnvVars() {
    // Only forward the env vars we intentionally support.
    const prefixes = ['ANTHROPIC_', 'CLAUDE_', 'PLAYWRIGHT_', 'CODESTRAL_', 'VITE_PREVIEW_'];
    const allowKey = (k) => prefixes.some(p => k.startsWith(p));

    const fileEnv = loadDotEnvFile(path.join(__dirname, '..', '.env'));
    const merged = { ...fileEnv, ...process.env };
    const out = {};
    for (const [k, v] of Object.entries(merged)) {
      if (!allowKey(k)) continue;
      if (typeof v === 'string' && v.length) out[k] = v;
    }

    // Auth-gated overrides — the bundled (or .env-supplied) Anthropic key
    // is replaced with the user's JWT, and the base URL is rewritten to
    // point at our proxy. The Worker validates the JWT, swaps in the real
    // upstream key, and forwards.
    //
    // If the user is not logged in, we deliberately *delete* the key so
    // the SDK fails fast with a clear "not authenticated" error rather
    // than secretly falling back to a bundled key.
    try {
      const auth = require('./ipc-auth');
      const jwt = auth.getJwtSync();
      if (jwt) {
        const proxyUrl = auth.getProxyUrl();
        out.ANTHROPIC_BASE_URL  = proxyUrl;
        out.ANTHROPIC_AUTH_TOKEN = jwt;
        out.ANTHROPIC_API_KEY    = jwt;   // SDK falls back to API_KEY if AUTH_TOKEN missing
      } else {
        delete out.ANTHROPIC_BASE_URL;
        delete out.ANTHROPIC_AUTH_TOKEN;
        delete out.ANTHROPIC_API_KEY;
      }
    } catch (err) {
      console.warn('[agent] auth module not available:', err?.message);
    }

    return out;
  }

  // Make these available to the warm-session register fn. ipc-agent
  // registers first so the assignments are present before warm runs.
  ctx.loadConnectorEnvVars = loadConnectorEnvVars;
  ctx.loadRuntimeEnvVars = loadRuntimeEnvVars;

  function buildEnvDebugSnapshot(workDir) {
    // IMPORTANT: Never include actual env values. Booleans only.
    const fileEnv = loadDotEnvFile(path.join(__dirname, '..', '.env'));
    const merged = { ...fileEnv, ...process.env };
    const runtimeEnv = loadRuntimeEnvVars();
    const connectorEnv = loadConnectorEnvVars(workDir);

    const has = (obj, key) => typeof obj?.[key] === 'string' && obj[key].length > 0;
    const anyPrefix = (obj, prefix) => Object.keys(obj || {}).some(k => k.startsWith(prefix) && has(obj, k));

    return {
      dotenvPath: path.join(__dirname, '..', '.env'),
      hasDotenvFile: fs.existsSync(path.join(__dirname, '..', '.env')),

      // Where keys appear
      file_has_anthropic_auth_token: has(fileEnv, 'ANTHROPIC_AUTH_TOKEN'),
      file_has_anthropic_api_key: has(fileEnv, 'ANTHROPIC_API_KEY'),
      file_has_anthropic_base_url: has(fileEnv, 'ANTHROPIC_BASE_URL'),

      proc_has_anthropic_auth_token: has(process.env, 'ANTHROPIC_AUTH_TOKEN'),
      proc_has_anthropic_api_key: has(process.env, 'ANTHROPIC_API_KEY'),
      proc_has_anthropic_base_url: has(process.env, 'ANTHROPIC_BASE_URL'),

      merged_has_anthropic_auth_token: has(merged, 'ANTHROPIC_AUTH_TOKEN'),
      merged_has_anthropic_api_key: has(merged, 'ANTHROPIC_API_KEY'),
      merged_has_anthropic_base_url: has(merged, 'ANTHROPIC_BASE_URL'),

      // What we forward into sdk.query({ options.env })
      forwarded_has_anthropic_auth_token: has(runtimeEnv, 'ANTHROPIC_AUTH_TOKEN'),
      forwarded_has_anthropic_api_key: has(runtimeEnv, 'ANTHROPIC_API_KEY'),
      forwarded_has_anthropic_base_url: has(runtimeEnv, 'ANTHROPIC_BASE_URL'),

      forwarded_has_preview: anyPrefix(runtimeEnv, 'VITE_PREVIEW_'),
      forwarded_has_codestral: anyPrefix(runtimeEnv, 'CODESTRAL_'),
      forwarded_has_model_overrides: anyPrefix(runtimeEnv, 'ANTHROPIC_DEFAULT_'),

      connector_env_keys_count: Object.keys(connectorEnv || {}).length,
      forwarded_runtime_keys_count: Object.keys(runtimeEnv || {}).length,
    };
  }

  function newSessionId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  ipcMain.handle('agent:send', async (event, { streamId, sessionId, projectPath, message, mode, effort, attachments, silent, systemPromptOverride, allowedToolsOverride, extraMcpServers, extraEnv }) => {
    const ch = `agent:event:${streamId}`;
    const isSilent = !!silent;

    // Hard auth gate: no JWT → no agent. The SDK would otherwise emit a
    // confusing "x-api-key missing" error from the upstream; we want a
    // clear "please log in" instead so the renderer can prompt re-auth.
    try {
      const auth = require('./ipc-auth');
      if (!auth.getJwtSync()) {
        send(event, ch, { type: 'error', message: 'Sign in with GitHub to use the AI agent.' });
        send(event, ch, { type: 'result', subtype: 'error', totalCostUsd: 0, durationMs: 0, usage: null });
        return { ok: false, error: 'unauthenticated' };
      }
    } catch {}

    let sdk;
    try {
      sdk = await loadSdk();
    } catch (err) {
      send(event, ch, { type: 'error', message: `Failed to load Claude Agent SDK: ${err.message}. Is @anthropic-ai/claude-agent-sdk installed?` });
      send(event, ch, { type: 'result', subtype: 'error', totalCostUsd: 0, durationMs: 0, usage: null });
      return { ok: false, error: err.message };
    }

    let session = sessionId ? loadSessionFromDisk(sessionId) : null;
    if (!session) {
      session = {
        id: sessionId || newSessionId(),
        title: (message || 'New Chat').slice(0, 60),
        messages: [],
        createdAt: Date.now(),
        lastMessageAt: Date.now(),
        projectPath: projectPath || null,
      };
      sessionStorage.set(session.id, session);
    }
    if (projectPath && !session.projectPath) session.projectPath = projectPath;

    const abortCtrl = new AbortController();
    sessions.set(streamId, { abortCtrl, projectPath, sessionId: session.id, pendingInputs: [] });

    // ── Conversation history file (.pipilot/_pipilot_history.json in project) ──
    let historyFile = null;
    if (projectPath) {
      const pipilotDir = path.join(projectPath, '.pipilot');
      try {
        fs.mkdirSync(pipilotDir, { recursive: true });
      } catch (err) {
        console.error('[agent] Failed to create .pipilot dir:', pipilotDir, err.message);
      }
      historyFile = path.join(pipilotDir, '_pipilot_history.json');
      console.log('[agent] History file path:', historyFile);
    } else {
      console.warn('[agent] No projectPath — history file will NOT be created');
    }

    // History file format. Was a bare array of message entries; we
    // upgraded it to an object so the SDK's session_id (handed out by
    // the system/init message) can ride at the top of the file. Step 2
    // will use that id to resume warm sessions across IDE restarts —
    // for now we just persist it.
    //
    //   {
    //     "sessionId": "abc-123-...",      // SDK session, may be null
    //     "updatedAt": "2026-...",         // ISO timestamp of last write
    //     "messages": [{ role, content, timestamp }, ...]
    //   }
    //
    // readHistoryRaw returns the full object (creating an empty shell if
    // the file is missing/corrupt). readHistory returns just the
    // messages array — every existing caller that did `for (const m of
    // history)` keeps working unchanged.
    function readHistoryRaw() {
      const empty = { sessionId: null, updatedAt: null, messages: [] };
      if (!historyFile) return empty;
      try {
        const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        // Legacy: file is a bare array of messages.
        if (Array.isArray(parsed)) return { sessionId: null, updatedAt: null, messages: parsed };
        if (parsed && typeof parsed === 'object') {
          return {
            sessionId: parsed.sessionId || null,
            updatedAt: parsed.updatedAt || null,
            messages: Array.isArray(parsed.messages) ? parsed.messages : [],
          };
        }
        return empty;
      } catch { return empty; }
    }
    function readHistory() { return readHistoryRaw().messages; }

    function writeHistoryRaw(obj) {
      if (!historyFile) return;
      try {
        const out = {
          sessionId: obj.sessionId || null,
          updatedAt: new Date().toISOString(),
          messages: Array.isArray(obj.messages) ? obj.messages : [],
        };
        fs.writeFileSync(historyFile, JSON.stringify(out, null, 2), 'utf8');
      } catch (err) {
        console.error('[agent] Failed to write history:', err.message);
      }
    }

    function appendHistory(entry) {
      if (!historyFile) return;
      try {
        if (entry.role === 'assistant' && entry.content && entry.content.length > 300) {
          entry.content = entry.content.slice(0, 300) + '...';
        }
        const raw = readHistoryRaw();
        raw.messages.push(entry);
        if (raw.messages.length > 40) raw.messages = raw.messages.slice(-40);
        writeHistoryRaw(raw);
      } catch (err) {
        console.error('[agent] Failed to write history:', err.message);
      }
    }

    // Stamp the SDK's session_id at the top of the history file the
    // first time we see it for this turn. Cheap (single read+write of a
    // small file) and idempotent — only writes if the id actually
    // changed, so we don't churn updatedAt on every init message.
    function persistSessionId(sessionId) {
      if (!historyFile || !sessionId) return;
      try {
        const raw = readHistoryRaw();
        if (raw.sessionId === sessionId) return;
        raw.sessionId = sessionId;
        writeHistoryRaw(raw);
      } catch (err) {
        console.error('[agent] Failed to persist sessionId:', err.message);
      }
    }

    // Always prefix every user prompt with the current local time +
    // ISO timestamp. The agent otherwise has to guess "today" and
    // gets it wrong on commit trailers, scheduled-task references,
    // anything time-relative.
    let promptText = `${formatCurrentTimePrefix()}\n\n${String(message || '')}`;
    if (Array.isArray(attachments) && attachments.length) {
      const lines = attachments.map(a => `@${typeof a === 'string' ? a : a.path}`).join('\n');
      promptText = `${promptText}\n\nAttached files:\n${lines}\n\nInstruction: Read the attached files directly from the paths above before answering.`.trim();
    }

    // Inject recent history as context (last 3 user+assistant pairs)
    if (!isSilent) try {
      const history = readHistory();
      const MAX_PAIRS = 3;
      const MAX_MSG_LEN = 400;
      const recent = history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-(MAX_PAIRS * 2));
      if (recent.length > 0) {
        const ctx = recent.map(m => {
          const content = m.content.length > MAX_MSG_LEN ? m.content.slice(0, MAX_MSG_LEN) + '...[truncated]' : m.content;
          return `${m.role === 'user' ? 'Human' : 'Assistant'}: ${content}`;
        }).join('\n\n');
        promptText = `Previous conversation:\n${ctx}\n\nCurrent request: ${promptText}`;
        console.log(`[agent] Injected ${recent.length} history entries into prompt`);
      }
    } catch (err) {
      console.error('[agent] History injection failed:', err.message);
    }

    // Save user message to history file
    if (!isSilent) appendHistory({ role: 'user', content: String(message || ''), timestamp: new Date().toISOString() });
    console.log(`[agent] Sending prompt (${promptText.length} chars), projectPath=${projectPath}`);

    const userEntry = {
      role: 'user',
      blocks: [{ type: 'text', text: promptText }],
      attachments: attachments || [],
      at: Date.now(),
    };
    session.messages.push(userEntry);

    const assistantEntry = {
      role: 'assistant',
      blocks: [],
      at: Date.now(),
    };
    session.messages.push(assistantEntry);

    const model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6';
    const permissionMode = mode === 'plan' ? 'plan' : 'bypassPermissions';
    const workDir = projectPath || process.cwd();

    // ── Build system prompt (matching Vite server) ──
    const pipilotDir = path.join(workDir, '.pipilot');
    const hasProjectMd = fs.existsSync(path.join(pipilotDir, 'project.md'));
    const hasDesignMd = fs.existsSync(path.join(pipilotDir, 'design.md'));

    let contextBootstrap;
    if (!hasProjectMd && !hasDesignMd) {
      contextBootstrap = `## Project Context\nNeither .pipilot/project.md nor .pipilot/design.md exist yet.\nScan the project structure and create them if doing significant work.`;
    } else if (hasProjectMd && hasDesignMd) {
      contextBootstrap = `## Project Context\nBoth .pipilot/project.md and .pipilot/design.md exist.\n- Read .pipilot/project.md for project structure, tech stack, features.\n- Read .pipilot/design.md BEFORE writing any visual/UI code.`;
    } else {
      contextBootstrap = `## Project Context\n${hasProjectMd ? 'Read .pipilot/project.md for project context.' : '.pipilot/project.md is missing — consider generating it.'}\n${hasDesignMd ? 'Read .pipilot/design.md before UI work.' : '.pipilot/design.md is missing — consider generating it.'}`;
    }

    // Load memory index
    let memoryCtx = '';
    try {
      const memIdx = path.join(pipilotDir, 'memory', 'MEMORY.md');
      if (fs.existsSync(memIdx)) {
        const raw = fs.readFileSync(memIdx, 'utf8');
        const lines = raw.split('\n').slice(0, 200).join('\n');
        if (lines.trim()) memoryCtx = `\n## Project Memory\n${lines.slice(0, 25000)}\n`;
      }
    } catch {}

    // Effort-specific guidance built from the UI selector. Five levels —
    // none/low/medium/high/xhigh — modulate how aggressively the agent
    // reasons before acting. The structured 5-step pattern (CLARIFY →
    // DECOMPOSE → GENERATE → ASSESS → RECOMMEND, the coding-task variant)
    // is appended for medium+ levels because forcing structured reasoning
    // demonstrably improves accuracy on cross-layer / ambiguous tasks.
    const STRUCTURED_PATTERN = '\n\n### Structured Reasoning Pattern\nInside <reasoning>...</reasoning> blocks, follow this 5-step pattern (coding-task variant):\n\n1. **CLARIFY** — What is the user actually asking? Implicit constraints? Success criterion?\n2. **DECOMPOSE** — Break the work into smallest meaningful sub-problems. Identify dependencies.\n3. **GENERATE** — Enumerate plausible approaches/hypotheses. Don\'t commit yet.\n4. **ASSESS** — Evaluate each option: correctness, maintainability, perf, scope creep, risk.\n5. **RECOMMEND** — Commit to ONE approach with the explicit reason. State what you\'ll do next.\n\nThis isn\'t ceremony — it prevents wrong-first-attempt edits and makes your reasoning transparent in the Chain of Thought UI.';
    const FORMAT_GUIDANCE = '\n\n### Format reasoning content like a real engineering note\nReasoning inside <reasoning> tags is rendered as MARKDOWN in the UI. Structure it:\n- **Headings** (`##`, `###`) to label phases ("## Clarify", "## Options", "## Decision").\n- **Bulleted / numbered lists** for enumerations (constraints, candidates, tradeoffs).\n- **Pipe tables** when comparing options across criteria.\n- **Inline code** (`backticks`) for symbols, file paths, identifiers.\n- **Fenced code blocks** (```lang ... ```) for snippets under consideration.\n- **Bold** the chosen option / final decision so it\'s scannable.\n\nNo wall-of-prose dumps. Reasoning should read like a short, well-organized engineering note that another engineer could skim in 10 seconds.';

    const effortLevel = (effort || 'medium').toLowerCase();
    let effortBlock;
    switch (effortLevel) {
      case 'none':
        effortBlock = '\n\n## ⚙️ Reasoning Effort: NONE\nThe user has set reasoning effort to NONE for this turn. Skip ALL reasoning ceremony:\n- Do NOT emit <reasoning>...</reasoning> tags.\n- Just execute the request directly. Trust your first read of the problem.\n- This is the user\'s explicit choice — respect it. Treat the "Think Before Acting" section above as muted for this turn.';
        break;
      case 'low':
        effortBlock = '\n\n## ⚙️ Reasoning Effort: LOW\nKeep reasoning minimal this turn:\n- Use <reasoning>...</reasoning> ONLY when a choice is genuinely non-obvious — at most 1-2 short sentences.\n- Prefer action over deliberation.' + FORMAT_GUIDANCE;
        break;
      case 'medium':
        effortBlock = '\n\n## ⚙️ Reasoning Effort: MEDIUM (default)\nReason when it pays off:\n- Use <reasoning>...</reasoning> for non-obvious choices (1-4 sentences each).\n- Open multiple <reasoning> blocks across a response when you hit distinct decision points (e.g. one for "which approach", a later one for "edge case handling").\n- Skip reasoning for trivial tasks.' + STRUCTURED_PATTERN + FORMAT_GUIDANCE;
        break;
      case 'high':
        effortBlock = '\n\n## ⚙️ Reasoning Effort: HIGH\nReason BEFORE most non-trivial actions:\n- Open a <reasoning>...</reasoning> block at the START of any 2+ file change or any architectural decision. Walk through CLARIFY → DECOMPOSE → GENERATE → ASSESS → RECOMMEND inside it.\n- Open additional <reasoning> blocks at later decision points in the same response (don\'t cram everything into one giant block).\n- Articulate tradeoffs explicitly — don\'t commit silently.\n- Still skip reasoning for true one-line typo fixes.' + STRUCTURED_PATTERN + FORMAT_GUIDANCE;
        break;
      case 'xhigh':
      case 'x-high':
        effortBlock = '\n\n## ⚙️ Reasoning Effort: X-HIGH (maximum)\nReason DEEPLY before EVERY non-trivial action:\n- Open a substantial <reasoning>...</reasoning> block at the START of any meaningful task — multi-section with headings, lists, code-block snippets, the full 5-step pattern.\n- Walk through hypotheses, check evidence, rule out alternatives, identify edge cases, anticipate failure modes.\n- Open additional <reasoning> blocks at every subsequent decision point — don\'t silently switch directions.\n- **Pre-mortem before non-trivial edits**: inside the reasoning block, ask "what could go wrong?" and address it before writing code.\n- Skip reasoning ONLY for true single-line typo fixes or pure command execution.' + STRUCTURED_PATTERN + FORMAT_GUIDANCE;
        break;
      default:
        effortBlock = '';
    }

    const buildPrompt = `You are PiPilot Agent.\n\n## RULE #0 — Reasoning is a SINGLE TOOL CALL, never inline text\n\nWhen you need to think before answering, call \`mcp__pipilot__reason\` ONCE — exactly one call per turn — with your full reasoning in the \`thought\` field. Synthesize all your analysis (clarify, options, tradeoffs, decision) into one structured markdown block. Then write your user-facing answer as normal markdown text.\n\nDO NOT call \`reason\` multiple times per turn. DO NOT split thinking into phase-by-phase calls. ONE call captures everything; the next thing you produce should be your text reply (or a tool call to act on the user's request).\n\nSkip reasoning entirely for trivial tasks (one-line typo fix, single command, pure read of a file the user named).\n\nThe \`thought\` field renders as MARKDOWN — use ## headings to delineate sections (Clarify / Options / Decision / Plan), bulleted lists, pipe tables, inline code, fenced code blocks, **bold** for the chosen approach. NO wall-of-prose dumps.\n\n### Hard prohibitions\n- NEVER emit \`<reasoning>...</reasoning>\` tags in text. Deprecated.\n- NEVER simulate a tool call by writing \`<mcp__pipilot__reason>...{json}...</tool_call>\` or any XML-shaped imitation in text. Just call the tool.\n- NEVER put your user-facing answer inside the \`thought\` field. Thoughts are private; answers go in the text reply that follows the tool calls.${effortBlock}\n\n${contextBootstrap}\n\n**WORKING DIRECTORY: ${workDir}**\nAll file operations (Read, Write, Edit, Bash) happen relative to this path. Use this exact path verbatim. NEVER guess Unix-style paths on Windows.\n\n## HARD RULE — Do NOT spawn sub-agents (Task / Agent / SubAgent) for routine work\n\nThe Task / Agent tool is RESERVED for genuinely independent, large, parallelizable research that produces a written report. It is NOT for:\n  • Loading tools / discovering MCP tools / setting up browser tools (sub-agents have a restricted toolset that lacks ToolSearch and the pipilot MCP namespace — they will report "those tools don't exist" and your turn will fail).\n  • Browser interaction (open / observe / click / type / screenshot — state is per-turn and per-tab; sub-agents can't address tabs you opened).\n  • File system reads/writes, code edits, terminal commands.\n  • "Quick research" you can do yourself with WebSearch / WebFetch / search_codebase in 1-2 calls.\n  • Any task where the output is "I'll continue with X" — just continue with X yourself.\n\nDefault answer: do the task in YOUR own turn. Only consider Task when ALL of these are true:\n  1. The work is genuinely large (>10 tool calls of independent research)\n  2. The output is a self-contained report you'll quote back to the user\n  3. You won't need to chain follow-up actions on the result in this same turn\n\nIf in doubt, do not delegate.\n\n## HARD RULE: pnpm ONLY — never npm, never npx, never yarn\nEvery package manager command MUST use \`pnpm\`. Install: \`pnpm install\`. Add: \`pnpm add <pkg>\`. Run: \`pnpm <script>\`. One-off binary: \`pnpm dlx <pkg>\`. Remove: \`pnpm remove <pkg>\`. If pnpm is missing, install ONCE with \`npm i -g pnpm\`. The ONLY narrow exception is electron-rebuild / electron-forge native rebuilds.\n\n## MANDATORY WORKFLOW\n**Step 0: Orient** — \`get_working_directory\` FIRST.\n**Step 1: Understand** — \`search_codebase\` (semantic) with 2-4 targeted queries.\n**Step 2: Design System** — Before any UI work: \`frontend_design_guide\` action=scan, then load+write if absent. Use \`generate_image\` for assets.\n**Step 3: Remember** — \`project_memory\` action=save for key decisions.\n**Step 4: Verify** — \`get_diagnostics\` after significant code changes.\n**Step 5: Scaffold** — NEVER run interactive CLIs. Write template files directly, then \`pnpm install\`.\n\n## IDE Tools (MCP \"pipilot\")\n- \`reason\` — record private thinking phases (see Rule #0).\n- \`get_working_directory\` — authoritative project root + OS + file listing. CALL FIRST.\n- \`search_codebase\` — multi-mode (semantic/grep/files/symbols/all). Primary discovery tool.\n- \`frontend_design_guide\` — scan/load/write design system.\n- \`generate_image\` — AI image generation. Never placeholders.\n- \`project_memory\` — persistent notes across sessions.\n- \`get_diagnostics\` — TS/JSON errors.\n- \`project_context\` / \`update_project_context\` — scan/save project structure.\n- \`run_code\` — execute code in 60+ languages via OneCompiler.\n- \`edit_file_patch\` — search/replace blocks fallback when Edit fails.\n- \`fetch_url\` — clean readable text via Jina Reader. Fallback when WebFetch fails.\n\nThe IDE also has a built-in Chromium browser exposed as \`mcp__pipilot__browser_*\` tools (browser_open, browser_navigate, browser_observe, browser_click_ref, browser_type, browser_press_key, browser_eval, etc.). Use these — never \`Bash\`/\`curl\`/\`start\` — to navigate URLs or interact with web pages. If the tool defs aren't loaded yet, fetch them via ToolSearch (e.g. \`ToolSearch({ query: "select:mcp__pipilot__browser_open,mcp__pipilot__browser_observe,mcp__pipilot__browser_click_ref,mcp__pipilot__browser_type,mcp__pipilot__browser_press_key", max_results: 10 })\`) before calling them. Do NOT delegate browser work to a sub-agent — sub-agents lack the pipilot MCP namespace.\n\n## Rules\n- pnpm only (see hard rule above). Translate \`npm install\` from tutorials to \`pnpm install\`.\n- Files in project root — never wrapper subfolders like \"my-app/\".\n- Dev servers via Bash: random port 3100-9999.\n- Read CLAUDE.md at project root if it exists.\n- Specific search queries: \"auth middleware\" not \"project overview\".\n- Prefer \`search_codebase\` over blind file reads.\n- WebSearch / WebFetch for current docs. Don't guess.\n- Conversation history at .pipilot/_pipilot_history.json — check if user references prior work.\n- **Branding & attribution rule** — NEVER include \"🤖 Generated with [Claude Code]\", \"Co-Authored-By: Claude\", or any other \"Generated with X\" / \"Co-Authored-By: X\" trailer learned from external CLI tools.\n\n  When you produce text on a GITHUB SURFACE — commit message, PR description, PR review body, issue/PR comment, new issue body — and ONLY on those surfaces, you MUST add this exact footer:\n\n      Co-Authored-By: PiPilot <agent@pipilot.dev>\n\n  Format: blank line before the trailer, trailer alone on its own line, no leading spaces, exact spelling/casing, one trailer per piece of text, no emoji.\n\n  Surfaces that REQUIRE the trailer:\n  • git commit -m messages\n  • mcp__github__create_pull_request body / gh pr create --body\n  • mcp__github__add_issue_comment / mcp__github__create_pull_request_review / gh pr review --body / curl-issued issue/PR comments\n  • mcp__github__create_issue body\n\n  Surfaces that MUST NOT carry the trailer:\n  • Your replies in the chat panel — these are conversational, the user reads them inline. NEVER append \"Co-Authored-By:\" to them.\n  • Code you write into source files (the trailer belongs in the COMMIT, not in the code).\n  • Code-review comments inline in the chat (only on actual GitHub PR review surfaces).\n  • Markdown documents you create unless they're a PR body / issue body.\n\n  Quick check: if the text is being posted to github.com on the user's behalf, attach the trailer. If it's being shown to the user inside PiPilot's UI, do not.${memoryCtx}`;

    const planPrompt = `You are PiPilot Agent in PLAN MODE.\n\n## RULE #0 — Reasoning via ONE \`mcp__pipilot__reason\` call, never inline tags\nCall the tool ONCE with your full reasoning in the \`thought\` field before writing your plan. Synthesize Clarify / Options / Decision into one structured markdown block. The tool routes to the Chain of Thought UI; your text reply is the plan itself. Do NOT split reasoning across multiple calls.\n\n**WORKING DIRECTORY: ${workDir}**\nAll file paths are relative to this directory. Call \`get_working_directory\` first.${effortBlock}\n\n${contextBootstrap}\n\n## Your Job\nRESEARCH and PLAN — do NOT write or modify any code.\n- Start by using \`search_codebase\` with mode \"semantic\" to understand the codebase architecture — make 3-5 targeted queries.\n- Read specific files only after search has identified the relevant ones.\n- Produce a clear, ordered, step-by-step implementation plan.\n- Do NOT call Write, Edit, or any tool that mutates files.${memoryCtx}`;

    const agentSystemPrompt = systemPromptOverride
      ? String(systemPromptOverride)
      : (mode === 'plan' ? planPrompt : buildPrompt);

    // ── Load user MCP servers from .pipilot/mcp.json + UI-configured servers ──
    let userMcpServers = {};
    let userMcpAllowedTools = [];
    // 1) Project-level MCP config (.pipilot/mcp.json)
    try {
      const mcpFile = path.join(pipilotDir, 'mcp.json');
      if (fs.existsSync(mcpFile)) {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
        if (mcpConfig.servers && typeof mcpConfig.servers === 'object') {
          userMcpServers = { ...mcpConfig.servers };
          for (const name of Object.keys(mcpConfig.servers)) {
            userMcpAllowedTools.push(`mcp__${name}__*`);
          }
        }
      }
    } catch {}
    // 2) UI-configured MCP servers (Extensions panel → MCP Servers tab)
    try {
      const uiMcpFile = path.join(ctx.userDataPath, 'mcp-servers.json');
      if (fs.existsSync(uiMcpFile)) {
        const uiServers = JSON.parse(fs.readFileSync(uiMcpFile, 'utf8'));
        for (const srv of (Array.isArray(uiServers) ? uiServers : [])) {
          if (!srv.enabled || !srv.name) continue;
          const srvName = srv.name.replace(/[^a-zA-Z0-9_-]/g, '_');
          if (srv.type === 'http' && srv.url) {
            // HTTP MCP server (remote) — with optional auth headers
            var httpConfig = { type: 'http', url: srv.url };
            if (srv.headers && typeof srv.headers === 'object' && Object.keys(srv.headers).length) {
              httpConfig.headers = srv.headers;
            }
            userMcpServers[srvName] = httpConfig;
          } else if (srv.command) {
            // Stdio MCP server (local command)
            userMcpServers[srvName] = {
              command: srv.command,
              args: srv.args || [],
              env: srv.env || {},
            };
          } else {
            continue;
          }
          userMcpAllowedTools.push(`mcp__${srvName}__*`);
        }
      }
    } catch {}

    let resultSummary = null;
    let lastError = null;

    try {
      // Optional env debug snapshot for verifying which credentials are in play.
      // Enable with PIPILOT_ENV_DEBUG=1 in your environment.
      if (String(process.env.PIPILOT_ENV_DEBUG || '') === '1') {
        const snap = buildEnvDebugSnapshot(workDir);
        try { console.log('[pipilot:fiddle env debug]', snap); } catch {}
        send(event, ch, { type: 'env_debug', snapshot: snap });
      }

      // Set work directory for IDE tools
      ideTools.setWorkDir(workDir);

      // Build IDE MCP server with custom tools (matches Vite: name="pipilot")
      const ideToolsList = buildIdeTools(sdk, ctx);
      const ideMcp = sdk.createSdkMcpServer({ name: 'pipilot', version: '1.0.0', tools: ideToolsList });

      // Resolve Electron-as-Node + the unpacked cli.js path so the SDK's
      // child process spawns work in a packaged install (where 'node'
      // isn't on PATH and cli.js sits inside app.asar).
      const agentRuntime = resolveAgentRuntime();

      const result = sdk.query({
        prompt: promptText,
        options: {
          systemPrompt: agentSystemPrompt,
          cwd: workDir,
          model,
          permissionMode,
          allowDangerouslySkipPermissions: mode !== 'plan',
          includePartialMessages: true,
          abortController: abortCtrl,
          executable: agentRuntime.executable,
          executableArgs: agentRuntime.executableArgs,
          pathToClaudeCodeExecutable: agentRuntime.pathToClaudeCodeExecutable,
          // MCP servers (matching Vite setup)
          mcpServers: {
            // PiPilot IDE tools — diagnostics, project context, design guide, search, screenshot, run_code
            pipilot: ideMcp,
            // Context7 — documentation search for any library/framework
            context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
            // AppDeploy — deploy full-stack web apps from chat
            appdeploy: { type: 'http', url: 'https://api-v2.appdeploy.ai/mcp' },
            // DeepWiki — read wiki docs about any GitHub repo
            deepwiki: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' },
            // Sequential Thinking — PERMANENTLY DISABLED. Replaced by our
            // own `mcp__pipilot__reason` tool (see ide-tools-mcp.js).
            // The pipilot tool gives the same structured reasoning UI but
            // doesn't require an external npm package and routes through
            // the same Chain of Thought rendering. Do NOT re-enable.
            // 'sequential-thinking': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
            // Chrome DevTools — temporarily disabled
            // 'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@latest', '--autoConnect'] },
            // Playwright — browser automation, navigate, click, fill forms, screenshots
            playwright: { command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-playwright@latest'] },
            // User-configured MCP servers
            ...userMcpServers,
            // Per-call extras (e.g. Missions injecting github MCP with PAT)
            ...(extraMcpServers && typeof extraMcpServers === 'object' ? extraMcpServers : {}),
          },
          allowedTools: Array.isArray(allowedToolsOverride) && allowedToolsOverride.length
            ? allowedToolsOverride
            : [
            'mcp__pipilot__*',
            'mcp__context7__*',
            'mcp__appdeploy__*',
            'mcp__deepwiki__*',
            // 'mcp__sequential-thinking__*', // permanently disabled — use mcp__pipilot__reason instead
            // 'mcp__chrome-devtools__*',
            'mcp__playwright__*',
            ...userMcpAllowedTools,
            'Agent',
            'WebSearch',
            'WebFetch',
          ],
          env: {
            // Tool-search policy — see https://code.claude.com/docs/agents/tool-search
            //   'true' / unset → always on, defs never loaded into context
            //   'auto'         → on only when defs > 10% of context window
            //   'auto:N'       → custom %; lower = activates sooner
            //   'false'        → always off, all defs in every turn
            ENABLE_TOOL_SEARCH: 'auto',
            // Required so the spawned child Electron behaves as Node.
            ...agentRuntime.extraEnv,
            ...loadConnectorEnvVars(workDir),
            ...loadRuntimeEnvVars(),
            ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
          },
          canUseTool: async (toolName, input) => {
            if (toolName === 'AskUserQuestion') {
              const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              send(event, ch, { type: 'ask_user', requestId, questions: input?.questions || [] });

              // Wait for the user to answer. We previously auto-picked
              // option[0] after 5 minutes, which silently lied to the
              // agent — e.g. an idle "Racing game (e.g., car, bike)"
              // reply when the user actually didn't see the dialog. That
              // was always wrong: the agent then committed to a choice
              // the user never made.
              //
              // New policy: 30-minute hard cap, then DENY the tool with
              // a clear message so the agent knows it has no answer and
              // must either ask differently or give up. The user can
              // also abort the run via the interrupt button at any time
              // — the abort path clears pendingInputRequests cleanly.
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
                // Tell the renderer to clear the (possibly still-open) dialog.
                send(event, ch, { type: 'ask_user_timeout', requestId });
                return {
                  behavior: 'deny',
                  message: 'AskUserQuestion was not answered within 30 minutes. Do not assume any choice on the user\'s behalf — proceed only with information you already have, or ask again with a clearer question.',
                };
              }

              return { behavior: 'allow', updatedInput: outcome.value };
            }

            return { behavior: 'allow', updatedInput: input };
          },
          // Subagents (matching Vite setup)
          agents: {
            'fullstack-developer': {
              description: 'Use this agent when you need to build complete features spanning database, API, and frontend layers together as a cohesive unit.',
              prompt: `You are a senior fullstack developer specializing in complete feature development with expertise across backend and frontend technologies. Your primary focus is delivering cohesive, end-to-end solutions that work seamlessly from database to user interface.

When invoked:
1. Use \`search_codebase\` (semantic mode) first to understand existing full-stack architecture and patterns.
2. Analyze data flow from database through API to frontend.
3. Review authentication and authorization across all layers.
4. Design cohesive solution maintaining consistency throughout stack.

Fullstack development checklist:
- Database schema aligned with API contracts
- Type-safe API implementation with shared types
- Frontend components matching backend capabilities
- Authentication flow spanning all layers
- Consistent error handling throughout stack
- End-to-end testing covering user journeys
- Performance optimization at each layer
- Deployment pipeline for entire feature

Data flow architecture:
- Database design with proper relationships
- API endpoints following RESTful/GraphQL patterns
- Frontend state management synchronized with backend
- Optimistic updates with proper rollback
- Caching strategy across all layers
- Real-time synchronization when needed
- Consistent validation rules throughout
- Type safety from database to UI

Cross-stack authentication:
- Session management with secure cookies
- JWT implementation with refresh tokens
- SSO integration across applications
- Role-based access control (RBAC)
- Frontend route protection
- API endpoint security
- Database row-level security
- Authentication state synchronization

Real-time implementation:
- WebSocket server configuration
- Frontend WebSocket client setup
- Event-driven architecture design
- Message queue integration
- Presence system implementation
- Conflict resolution strategies
- Reconnection handling
- Scalable pub/sub patterns

Testing strategy:
- Unit tests for business logic (backend & frontend)
- Integration tests for API endpoints
- Component tests for UI elements
- End-to-end tests for complete features
- Performance tests across stack
- Load testing for scalability
- Security testing throughout
- Cross-browser compatibility

Architecture decisions:
- Monorepo vs polyrepo evaluation
- Shared code organization
- API gateway implementation
- BFF pattern when beneficial
- Microservices vs monolith
- State management selection
- Caching layer placement
- Build tool optimization

Performance optimization:
- Database query optimization
- API response time improvement
- Frontend bundle size reduction
- Image and asset optimization
- Lazy loading implementation
- Server-side rendering decisions
- CDN strategy planning
- Cache invalidation patterns

Deployment pipeline:
- Infrastructure as code setup
- CI/CD pipeline configuration
- Environment management strategy
- Database migration automation
- Feature flag implementation
- Blue-green deployment setup
- Rollback procedures
- Monitoring integration

## Implementation Workflow

### 1. Architecture Planning
Analyze the entire stack to design cohesive solutions. Consider: data model design and relationships, API contract definition, frontend component architecture, authentication flow design, caching strategy placement, performance requirements, scalability considerations, security boundaries. Evaluate framework compatibility, library selection, database technology choice, state management approach, build tool configuration, testing framework, deployment target, monitoring solution.

### 2. Integrated Development
Build features with stack-wide consistency and optimization: database schema implementation, API endpoint creation, frontend component building, authentication integration, state management setup, real-time features if needed, comprehensive testing, documentation.

### 3. Stack-Wide Delivery
Complete feature delivery with all layers properly integrated: database migrations ready, API documentation complete, frontend build optimized, tests passing at all levels, deployment scripts prepared, monitoring configured, performance validated, security verified.

Shared code management:
- TypeScript interfaces for API contracts
- Validation schema sharing (Zod/Yup)
- Utility function libraries
- Configuration management
- Error handling patterns
- Logging standards
- Style guide enforcement

Integration patterns:
- API client generation
- Type-safe data fetching
- Error boundary implementation
- Loading state management
- Optimistic update handling
- Cache synchronization
- Real-time data flow
- Offline capability

Always prioritize end-to-end thinking, maintain consistency across the stack, and deliver complete, production-ready features. Use pnpm (never npm/npx) for all package manager commands in this environment.

## Available Tools
- **File I/O** — Read, Write, Edit, Glob, Grep for local code navigation and mutation.
- **Bash** — shell commands (use pnpm, not npm/npx).
- **WebSearch** — current documentation, error lookups, package info, best-practice discovery. Use liberally instead of guessing.
- **WebFetch** — fetch a specific URL when you already know it.
- **pipilot MCP** — \`search_codebase\` (semantic/grep/symbols/files), \`frontend_design_guide\`, \`generate_image\`, \`project_memory\`, \`project_context\`, \`get_diagnostics\`, \`run_code\`, \`screenshot_preview\`, \`edit_file_patch\`, \`fetch_url\` (Jina Reader fallback).
- **context7 MCP** — authoritative, up-to-date library/framework/SDK documentation. Use BEFORE writing code against any library (React, Next.js, Prisma, Express, Tailwind, Django, Spring, etc.) — training data may be stale.
- **deepwiki MCP** — AI-answered questions about specific GitHub repositories. Use when integrating with or researching an open-source project.
- **<reasoning> tags** — Wrap multi-step reasoning in literal \`<reasoning>...</reasoning>\` blocks inside your normal text reply. The IDE streams them into the Chain of Thought panel and strips them from history so they don't bloat later turns. USE FOR: bug hunts where the root cause isn't obvious, changes spanning 3+ files or layers, ambiguous requirements, architecture tradeoffs, refactors with unknown callers. Format with markdown headings/lists/code blocks. Skip for trivial one-line fixes.
- **playwright MCP** — headless browser automation. Use for end-to-end testing, smoke-testing the frontend after changes, capturing screenshots, verifying auth flows across the full stack.

Tool-selection rules:
- Before writing code against ANY third-party library/framework, query context7 for current docs.
- Before editing an existing file, run \`search_codebase\` (semantic) to understand its role.
- After frontend changes that affect runtime, use playwright or \`screenshot_preview\` to verify visually — don't ship UI changes unseen.
- After backend changes, run \`get_diagnostics\` and consider a playwright E2E click-through of the affected user journey.
- Use WebSearch when encountering an error you don't recognize; don't invent solutions.`,
              tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
              mcpServers: ['pipilot', 'context7', 'deepwiki', 'playwright'],
              model: 'sonnet',
            },
            'ai-engineer': {
              description: 'Architect, implement, or optimize AI systems — LLM integration, prompt engineering, RAG pipelines.',
              prompt: 'You are a senior AI engineer. Always use search_codebase (semantic mode) first to understand existing code before making changes. Design effective prompts, implement RAG pipelines, build streaming response handlers. Technology expertise: OpenAI API, Anthropic API, LangChain, vector databases.',
              tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
              mcpServers: ['pipilot'],
              model: 'sonnet',
            },
            'security-engineer': {
              description: 'Implement security solutions, perform vulnerability assessments, review code for security issues.',
              prompt: 'You are a senior security engineer. Always use search_codebase (semantic mode) first to understand existing code before reviewing. Review code for OWASP Top 10 vulnerabilities, implement auth, configure secrets management. Technology expertise: OWASP, SOC2, container security.',
              tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
              mcpServers: ['pipilot'],
              model: 'sonnet',
            },
            'wiki-generator': {
              description: 'Scan a codebase and generate comprehensive wiki documentation in .pipilot/wikis/.',
              prompt: `You are a technical documentation expert. Your job is to scan a project codebase and generate clear, comprehensive wiki documentation.

Output location: .pipilot/wikis/ (create this directory if it doesn't exist).

Generate these pages:
1. index.md — Project overview with file tree, tech stack summary, and navigation links to other wiki pages.
2. architecture.md — Architecture overview with Mermaid diagrams (use graph TD, alphanumeric node IDs, square brackets for labels, --> arrows). Show component relationships, data flow, and key abstractions.
3. modules.md — Document each key module/component: purpose, exports, dependencies, usage examples.
4. api.md — API endpoints (if applicable): method, path, params, response format, auth requirements.
5. setup.md — Setup guide: prerequisites, install steps, env vars, dev server commands, build/deploy instructions.

Rules:
- Read the actual source code before writing — don't guess.
- Use relative markdown links between pages: [Architecture](architecture.md)
- Keep language precise and examples real (from the actual codebase).
- For Mermaid diagrams, validate syntax: graph TD, no special chars in node IDs.
- Write files using the Write tool to .pipilot/wikis/{pageId}.md.`,
              tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
              mcpServers: ['pipilot', 'context7'],
              model: 'sonnet',
            },
            'api-designer': {
              description: 'Design REST/GraphQL APIs, create OpenAPI specs, implement auth patterns and API versioning.',
              prompt: 'You are a senior API designer. Always use search_codebase first. Design intuitive, scalable APIs with proper HTTP methods, status codes, pagination, auth (OAuth 2.0, JWT, API keys), error formats, and versioning. Technology expertise: REST, GraphQL, gRPC, OpenAPI/Swagger, API gateways.',
              tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
              mcpServers: ['pipilot'],
              model: 'sonnet',
            },
            'frontend-designer': {
              description: 'Create distinctive, production-grade frontend interfaces with high design quality.',
              prompt: 'You are a senior frontend designer. Always read .pipilot/design.md before any UI work using frontend_design_guide. Create distinctive, polished UIs that avoid generic AI aesthetics. Use real content, not lorem ipsum. Vary between light/dark, different fonts, different aesthetics. Technology expertise: React, Vue, Tailwind, CSS, animations, responsive design.',
              tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
              mcpServers: ['pipilot'],
              model: 'sonnet',
            },
            'agent-installer': {
              description: 'Browse and install Claude Code subagents from the awesome-claude-code-subagents repository.',
              prompt: `You are an agent installer. Help users browse and install agents from GitHub.

GitHub API: https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/contents/categories
Raw files: https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/main/categories/{category}/{agent}.md

Workflow: Fetch categories → list agents → download .md file → save to .claude/agents/ in the project.
Always confirm before installing. Show description first. Use Bash with curl -s for downloads.`,
              tools: ['Bash', 'Read', 'Write', 'Glob'],
              model: 'sonnet',
            },
            'mcp-installer': {
              description: 'Search and install MCP servers from the official MCP registry.',
              prompt: `You are an MCP server installer. Help users discover, install, and configure MCP servers.

Registry API: GET https://registry.modelcontextprotocol.io/v0/servers?search={query}&limit=20&version=latest

Response has servers[].server with: name, title, description, version, remotes[{type, url}].

For stdio servers: Add to .pipilot/mcp.json with command + args.
For HTTP servers: Add to .pipilot/mcp.json with type: "http" + url + headers.

Always show available servers first, let user choose, then configure.`,
              tools: ['Bash', 'Read', 'Write', 'Glob'],
              model: 'sonnet',
            },
          },
        },
      });

      for await (const msg of result) {
        if (!msg || typeof msg !== 'object') continue;

        if (msg.type === 'system') {
          if (msg.subtype === 'init') {
            // Stamp the SDK session id at the top of .pipilot history
            // so step 2 (warm-session wiring) can pass it as `resume`.
            persistSessionId(msg.session_id);
            send(event, ch, {
              type: 'system',
              subtype: 'init',
              model: msg.model,
              cwd: msg.cwd,
              tools: msg.tools || [],
              mcp_servers: msg.mcp_servers || [],
              permission_mode: msg.permissionMode,
              slash_commands: msg.slash_commands || [],
              session_id: msg.session_id,
            });
          } else if (msg.subtype === 'compact_boundary') {
            send(event, ch, { type: 'compact_boundary', trigger: msg.compact_metadata?.trigger, preTokens: msg.compact_metadata?.pre_tokens });
          } else if (msg.subtype === 'status') {
            send(event, ch, { type: 'status', status: msg.status });
          } else if (msg.subtype === 'hook_response') {
            send(event, ch, { type: 'hook', hook: msg.hook_name, event: msg.hook_event, exitCode: msg.exit_code });
          } else {
            send(event, ch, { type: 'system', subtype: msg.subtype || null });
          }
          continue;
        }

        if (msg.type === 'assistant') {
          const content = msg.message?.content || [];
          for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'text' && typeof block.text === 'string') {
              assistantEntry.blocks.push({ type: 'text', text: block.text });
              send(event, ch, { type: 'text', text: block.text });
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
              assistantEntry.blocks.push({ type: 'thinking', text: block.thinking });
              send(event, ch, { type: 'thinking', text: block.thinking });
            } else if (block.type === 'redacted_thinking') {
              send(event, ch, { type: 'thinking', text: '[redacted]', redacted: true });
            } else if (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use') {
              const call = {
                type: 'tool_call',
                id: block.id,
                name: block.name,
                input: block.input,
                kind: block.type,
                serverName: block.server_name || null,
                parentToolUseId: msg.parent_tool_use_id || null,
              };
              assistantEntry.blocks.push(call);
              send(event, ch, call);

              // Detect wiki-generator subagent starting
              const toolName = block.name || '';
              const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input || '');
              if ((toolName === 'Agent' || toolName === 'SubAgent' || toolName.includes('agent')) && inputStr.toLowerCase().includes('wiki')) {
                send(event, ch, { type: 'wiki_generating', generating: true });
              }
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
              // Strip ANSI escape codes from tool output
              let cleanContent = typeof preview === 'string' ? preview : String(preview ?? '');
              cleanContent = cleanContent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');
              const resultBlock = {
                type: 'tool_result',
                toolUseId: block.tool_use_id,
                content: cleanContent,
                isError: !!block.is_error,
                kind: block.type,
              };
              assistantEntry.blocks.push(resultBlock);
              send(event, ch, resultBlock);
            }
          }
          continue;
        }

        if (msg.type === 'stream_event') {
          const evt = msg.event;
          if (!evt) continue;
          if (evt.type === 'content_block_delta' && evt.delta) {
            if (evt.delta.type === 'text_delta') {
              send(event, ch, { type: 'text_delta', text: evt.delta.text || '', index: evt.index });
            } else if (evt.delta.type === 'thinking_delta') {
              send(event, ch, { type: 'thinking_delta', text: evt.delta.thinking || '', index: evt.index });
            } else if (evt.delta.type === 'input_json_delta') {
              send(event, ch, { type: 'input_delta', partial: evt.delta.partial_json || '', index: evt.index });
            }
          } else if (evt.type === 'content_block_start') {
            send(event, ch, { type: 'block_start', block: evt.content_block, index: evt.index });
          } else if (evt.type === 'content_block_stop') {
            send(event, ch, { type: 'block_stop', index: evt.index });
          } else if (evt.type === 'message_stop') {
            send(event, ch, { type: 'message_stop' });
          }
          continue;
        }

        if (msg.type === 'tool_progress') {
          send(event, ch, { type: 'tool_progress', toolUseId: msg.tool_use_id, toolName: msg.tool_name, elapsedSeconds: msg.elapsed_time_seconds });
          continue;
        }

        if (msg.type === 'auth_status') {
          send(event, ch, { type: 'auth_status', isAuthenticating: msg.isAuthenticating, output: msg.output, error: msg.error });
          continue;
        }

        if (msg.type === 'result') {
          resultSummary = {
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
          };
          send(event, ch, { type: 'result', ...resultSummary });
          continue;
        }
      }
    } catch (err) {
      lastError = err;
      const aborted = abortCtrl.signal.aborted;
      send(event, ch, {
        type: 'error',
        message: aborted ? 'Stopped by user.' : (err && err.message) || String(err),
      });
      if (!resultSummary) {
        send(event, ch, {
          type: 'result',
          subtype: aborted ? 'aborted' : 'error',
          totalCostUsd: 0,
          durationMs: 0,
          usage: null,
        });
      }
    } finally {
      session.lastMessageAt = Date.now();
      if (!session.title || session.title === 'New Chat' || session.title === 'Untitled') {
        const first = (message || '').trim().split('\n')[0];
        if (first) session.title = first.slice(0, 60);
      }
      saveSessionToDisk(session);
      sessions.delete(streamId);

      // Save assistant response — only the last user-facing text block, skip tool-only turns
      const textBlocks = assistantEntry.blocks.filter(b => b.type === 'text');
      const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1] : null;
      if (!isSilent && lastText && lastText.text && lastText.text.trim().length > 5) {
        let clean = lastText.text.trim();
        if (clean.startsWith('Assistant:')) clean = clean.slice(10).trim();
        // Strip <reasoning>...</reasoning> regions before persisting — the
        // agent shouldn't pay output tokens to re-read its own old thinking
        // on every subsequent turn. Tolerates unmatched/dangling open tags.
        clean = clean.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').replace(/<reasoning>[\s\S]*$/g, '').trim();
        if (clean.length > 5) {
          appendHistory({ role: 'assistant', content: clean, timestamp: new Date().toISOString() });
        }
      }
    }

    return { ok: !lastError, sessionId: session.id, result: resultSummary };
  });

  ipcMain.handle('agent:stop', async (_e, streamId) => {
    const s = sessions.get(streamId);
    if (s?.abortCtrl) {
      try { s.abortCtrl.abort(); } catch {}
    }
    return { ok: true };
  });

  ipcMain.handle('agent:answer', async (_e, { streamId, text }) => {
    const s = sessions.get(streamId);
    if (!s) return { ok: false, error: 'no active session' };
    s.pendingInputs.push(text);
    return { ok: true };
  });

  ipcMain.handle('agent:answer-question', async (_e, { requestId, answers }) => {
    const pending = pendingInputRequests.get(requestId);
    if (!pending) return { ok: false, error: 'no pending request' };
    pendingInputRequests.delete(requestId);
    try {
      pending.resolve({ questions: pending.question?.questions, answers: answers || {} });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('agent:list-sessions', async (_e, projectPath) => {
    return listSessionsForProject(projectPath);
  });

  ipcMain.handle('agent:load-session', async (_e, { projectPath, sessionId }) => {
    const s = loadSessionFromDisk(sessionId);
    if (!s) return null;
    if (projectPath && s.projectPath && s.projectPath !== projectPath) return null;
    return {
      id: s.id,
      title: s.title,
      messages: s.messages || [],
      createdAt: s.createdAt,
      lastMessageAt: s.lastMessageAt,
      projectPath: s.projectPath,
    };
  });

  ipcMain.handle('agent:delete-session', async (_e, { projectPath, sessionId }) => {
    try {
      const s = loadSessionFromDisk(sessionId);
      if (s && projectPath && s.projectPath && s.projectPath !== projectPath) {
        return { ok: false, error: 'project mismatch' };
      }
      sessionStorage.delete(sessionId);
      await fsp.unlink(sessionFile(sessionId));
    } catch {}
    return { ok: true };
  });

  ipcMain.handle('agent:new-session', async (_e, { projectPath, title }) => {
    const id = newSessionId();
    const session = {
      id,
      title: title || `Chat ${new Date().toLocaleString()}`,
      messages: [],
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      projectPath: projectPath || null,
    };
    sessionStorage.set(id, session);
    saveSessionToDisk(session);
    return { id: session.id, title: session.title };
  });
};
