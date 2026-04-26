// PiPilot IDE — Claude Agent SDK IPC (Phase 4)

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

module.exports = function register(ipcMain, ctx) {
  const sessions = new Map(); // streamId -> { abortCtrl, projectPath, sessionId, pendingInputs: [] }
  const sessionStorage = new Map(); // sessionId -> { id, title, messages, createdAt, lastMessageAt, projectPath }

  // AskUserQuestion pending map (requestId -> { resolve, question, streamId })
  const pendingInputRequests = new Map();

  const sessionsDir = path.join(ctx.userDataPath, 'sessions');
  try { fs.mkdirSync(sessionsDir, { recursive: true }); } catch {}

  const ideTools = require('./mcp-ide-tools');

  let sdkModule = null;
  let sdkLoadError = null;
  async function loadSdk() {
    if (sdkModule) return sdkModule;
    if (sdkLoadError) throw sdkLoadError;
    try {
      sdkModule = await import('@anthropic-ai/claude-agent-sdk');
      return sdkModule;
    } catch (err) {
      sdkLoadError = err;
      throw err;
    }
  }

  // Build IDE-specific MCP tools using Zod schemas (matching Vite exactly)
  function buildIdeTools(sdk) {
    const { z } = require('zod');

    return [
      sdk.tool('get_working_directory',
        'Authoritative project root. Returns the absolute path (with native OS separators), platform, path separator, and a top-level file listing. ALWAYS call this FIRST on every task — never guess paths like /home/, /workspace/, /c/, /codepilot/, /tmp/, and never run `pwd && ls -la` for orientation. Use the returned path verbatim as the prefix for every file tool call.',
        {},
        async () => {
          try {
            const r = await ideTools.getWorkingDirectory();
            const lines = [
              r.summary,
              '',
              `path: ${r.path}`,
              `platform: ${r.platform}`,
              `pathSeparator: ${JSON.stringify(r.pathSeparator)}`,
              `exists: ${r.exists}`,
              `topLevel: ${r.files.join(', ') || '(empty)'}`,
            ];
            return { content: [{ type: 'text', text: lines.join('\n') }] };
          } catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('get_diagnostics',
        'Run the IDE diagnostics engine on the current project. Returns TypeScript/JSON errors and warnings. Use after changes to verify correctness.',
        { source: z.enum(['all', 'typescript', 'json']).default('all').describe('Which checker to run') },
        async (args) => {
          try {
            const result = await ideTools.getDiagnostics(args);
            if (!result.diagnostics?.length) return { content: [{ type: 'text', text: 'No problems found. All checks passed.' }] };
            const summary = result.diagnostics.map(d =>
              `[${(d.severity || 'error').toUpperCase()}] ${d.file || ''}${d.line ? `:${d.line}` : ''} — ${d.message} (${d.source})`
            ).join('\n');
            return { content: [{ type: 'text', text: `Found ${result.diagnostics.length} problem(s):\n\n${summary}` }] };
          } catch (e) { return { content: [{ type: 'text', text: `Diagnostics error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('project_context',
        'Scan project structure and return framework, dependencies, entry points, config files, and file tree. Use at the start of any task to understand the codebase.',
        { includeDetails: z.boolean().optional().default(true).describe('Include full details') },
        async (args) => {
          try {
            const result = await ideTools.getProjectContext(args);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          } catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('update_project_context',
        'Scan project structure and write/update .pipilot/project.md with framework info, dependencies, entry points, and file tree.',
        {},
        async () => {
          try {
            const result = await ideTools.updateProjectContext();
            return { content: [{ type: 'text', text: `Project context saved to ${result.saved}\nFramework: ${result.framework}\nFiles: ${result.files?.length || 0}` }] };
          } catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('frontend_design_guide',
        'Manage project design system. Workflow: "scan" first (check existing design.md + CSS tokens), if none exists call "load" (get design skill guide), then "write" (save your design system). ALWAYS do this before any UI work.',
        { action: z.enum(['scan', 'load', 'write']).describe('scan=check existing, load=get design guide, write=save design system'), content: z.string().optional().describe('Design system content (for write action)') },
        async (args) => {
          try {
            const result = await ideTools.frontendDesignGuide(args);
            if (result.error) return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
            return { content: [{ type: 'text', text: result.content || JSON.stringify(result, null, 2) }] };
          } catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('project_memory',
        'Persistent project memory — save/read/delete notes that persist across sessions. Use to remember decisions, architecture, preferences, tech stack.',
        {
          action: z.enum(['read', 'save', 'delete']).describe('Action'),
          key: z.string().optional().describe('Memory key (for save/delete)'),
          value: z.string().optional().describe('Memory value (for save)'),
        },
        async (args) => {
          try {
            const result = await ideTools.projectMemory(args);
            if (result.error) return { content: [{ type: 'text', text: result.error }] };
            if (result.memories) {
              if (result.memories.length === 0) return { content: [{ type: 'text', text: 'No memories saved yet.' }] };
              const list = result.memories.map(m => `- **${m.key}**: ${m.value}`).join('\n');
              return { content: [{ type: 'text', text: `${result.count} memories:\n${list}` }] };
            }
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          } catch (e) { return { content: [{ type: 'text', text: `Memory error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('edit_file_patch',
        'Edit a file using search/replace blocks. Supports multiple edits in one call. Fallback when built-in Edit fails. Format: <<<<<<< SEARCH\\nold code\\n=======\\nnew code\\n>>>>>>> REPLACE',
        {
          filepath: z.string().describe('File path'),
          searchReplaceBlock: z.string().describe('Search/replace block(s) with <<<<<<< SEARCH / ======= / >>>>>>> REPLACE markers'),
          useRegex: z.boolean().optional().describe('Treat search as regex (default false)'),
          replaceAll: z.boolean().optional().describe('Replace all occurrences (default false)'),
        },
        async (args) => {
          try {
            const result = await ideTools.editFilePatch(args);
            if (!result.success) return { content: [{ type: 'text', text: result.message }], isError: true };
            return { content: [{ type: 'text', text: result.message }] };
          } catch (e) { return { content: [{ type: 'text', text: `Patch error: ${e.message}` }], isError: true }; }
        }
      ),
      sdk.tool('fetch_url',
        'Fetch any URL as clean readable text via Jina Reader. Large results are saved to disk with a preview in context — use Read to see the full content. Use when WebFetch fails or to read docs, blog posts, API references, READMEs, Stack Overflow.',
        { url: z.string().describe('Full URL to fetch') },
        async (args) => {
          const PREVIEW_SIZE = 3000;
          try {
            const result = await ideTools.fetchUrl(args);
            if (result.error) return { content: [{ type: 'text', text: result.error }], isError: true };

            const fullText = result.content;
            // Small result — return directly
            if (fullText.length <= PREVIEW_SIZE) {
              return { content: [{ type: 'text', text: `Fetched ${result.url} (${fullText.length} chars):\n\n${fullText}` }] };
            }

            // Large result — persist to disk, return preview
            const os = require('os');
            const safeName = (args.url || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
            const fileName = `fetch-${safeName}-${Date.now()}.txt`;
            const persistDir = path.join(os.tmpdir(), 'pipilot-fetch');
            fs.mkdirSync(persistDir, { recursive: true });
            const filePath = path.join(persistDir, fileName);
            fs.writeFileSync(filePath, fullText, 'utf8');

            const preview = fullText.slice(0, PREVIEW_SIZE);
            return { content: [{ type: 'text', text: `Fetched ${result.url} (${fullText.length} chars). Full content saved to: ${filePath}\nUse Read tool on that path for complete content.\n\nPreview:\n${preview}\n\n...(truncated)` }] };
          } catch (e) { return { content: [{ type: 'text', text: `Fetch error: ${e.message}` }], isError: true }; }
        }
      ),
      sdk.tool('search_codebase',
        'Smart codebase search — combines regex grep, fuzzy file name matching, symbol/definition search, and BM25 semantic search in one tool call. Use instead of multiple Grep/Glob calls. Returns ranked results with context. Modes: grep, files, symbols, semantic (natural language), all.',
        {
          query: z.string().describe('Search query — regex, file name, symbol name, or natural language'),
          mode: z.enum(['grep', 'files', 'symbols', 'semantic', 'all']).default('all').describe('Search mode'),
          filePattern: z.string().optional().describe('Optional glob to filter files (e.g. "*.tsx")'),
          maxResults: z.number().optional().default(20).describe('Max results (default 20)'),
          caseSensitive: z.boolean().optional().default(false).describe('Case-sensitive (default false)'),
        },
        async (args) => {
          try {
            const result = await ideTools.searchCodebase(args);
            if (!result.results?.length) return { content: [{ type: 'text', text: `No results found for "${args.query}" (mode: ${args.mode || 'all'})` }] };
            const output = result.results.map(r => {
              let line = `[${r.type}] ${r.file}`;
              if (r.line) line += `:${r.line}`;
              line += ` — ${r.match}`;
              if (r.context) line += `\n${r.context}`;
              return line;
            }).join('\n\n');
            return { content: [{ type: 'text', text: `Found ${result.count} results for "${args.query}":\n\n${output}` }] };
          } catch (e) { return { content: [{ type: 'text', text: `Search error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('screenshot_preview',
        'Capture a screenshot of the running dev server or any URL using headless Chrome. Returns PNG image + DOM analysis.',
        { url: z.string().describe('URL to screenshot'), width: z.number().optional().default(1440).describe('Viewport width'), height: z.number().optional().default(900).describe('Viewport height') },
        async (args) => {
          try {
            const result = await ideTools.screenshotPreview(args);
            if (result.error) return { content: [{ type: 'text', text: result.error }], isError: true };
            // Return file path + analysis only — no raw base64 dump
            // Agent can use Read tool on the saved file to view the image
            return { content: [{ type: 'text', text:
              `Screenshot captured (${result.sizeKB}KB) via headless Chrome.\n` +
              `Saved: ${result.filePath}\n` +
              `URL: ${args.url}\n\n` +
              `IMPORTANT: Use the Read tool on "${result.filePath}" to view the screenshot image and visually inspect the UI.\n\n` +
              result.analysis +
              (result.consoleLogs?.length ? `\n\nConsole output (${result.consoleLogs.length} entries):\n${result.consoleLogs.slice(0, 10).map(l => '  [' + l.level + '] ' + l.text).join('\n')}` : '\n\nConsole: clean (no errors)')
            }] };
          } catch (e) { return { content: [{ type: 'text', text: `Screenshot error: ${e.message}` }] }; }
        }
      ),
      sdk.tool('generate_image',
        'Generate an image from a text description using AI. Saves to assets/ folder. Use for hero images, backgrounds, avatars, illustrations.',
        { description: z.string().describe('Vivid description of the image to generate'), aspect: z.enum(['16:9', '1:1', '9:16']).default('16:9').describe('Aspect ratio'), fileName: z.string().optional().describe('Output file name without extension') },
        async (args) => {
          try {
            const result = await ideTools.generateImage(args);
            if (result.error) return { content: [{ type: 'text', text: result.error }], isError: true };
            return { content: [{ type: 'text', text: `Image generated and saved:\n- Path: ${result.path}\n- Size: ${result.sizeKB}KB\n- Aspect: ${result.aspect}\n\nUsage: ${result.usage}` }] };
          } catch (e) { return { content: [{ type: 'text', text: `Image error: ${e.message}` }] }; }
        }
      ),
    ];
  }

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
    return out;
  }

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

    function readHistory() {
      if (!historyFile) return [];
      try { return JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch { return []; }
    }

    function appendHistory(entry) {
      if (!historyFile) return;
      try {
        if (entry.role === 'assistant' && entry.content && entry.content.length > 300) {
          entry.content = entry.content.slice(0, 300) + '...';
        }
        let h = readHistory();
        h.push(entry);
        if (h.length > 40) h = h.slice(-40);
        fs.writeFileSync(historyFile, JSON.stringify(h, null, 2), 'utf8');
      } catch (err) {
        console.error('[agent] Failed to write history:', err.message);
      }
    }

    let promptText = String(message || '');
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

    const buildPrompt = `You are PiPilot Agent.\n\n## ⛔ RULE #0 (READ FIRST, BEFORE EVERYTHING ELSE) — Always think in <reasoning> tags\n**Your VERY FIRST output for any non-trivial user request MUST begin with a \`<reasoning>...</reasoning>\` block.** No exceptions other than the trivial-task carve-out below. This is the ONLY reasoning mechanism this agent uses — there is no "internal thinking," no extended-thinking blocks, no sequential-thinking tool. If you don't open \`<reasoning>\`, your reasoning is invisible to the user and to history, and you will skip directly to wrong-first-attempt edits.\n\nWhat to do, in order, on every turn:\n1. Read the user's message.\n2. **Open \`<reasoning>\` immediately as your first output token** (before any tool call, before any text reply).\n3. Inside it, walk through CLARIFY → DECOMPOSE → GENERATE → ASSESS → RECOMMEND with proper markdown structure.\n4. Close with \`</reasoning>\`.\n5. Then act — call tools, write code, reply.\n6. If you hit a NEW decision point mid-response, open ANOTHER \`<reasoning>\`...\`</reasoning>\` block right then. Don't silently change direction.\n\nThe IDE renders these blocks live in the Chain of Thought panel and strips them from saved history, so they cost nothing on later turns. Reasoning is FREE for the user but MANDATORY for you.\n\n### ✅ How reasoning content MUST be formatted\nReasoning is rendered as markdown in the UI. Use proper structure — NEVER flat prose. Below is a concrete example showing the difference.\n\n**❌ BAD (do not do this — wall of prose, no structure):**\n\`\`\`\n<reasoning>\nThe user is asking about a bug in their CLI. I need to look at the code first. They might be referring to the TUI not working or the input not being captured or maybe the keyboard handling. Let me check the source files first to figure out what's broken and then decide on a fix.\n</reasoning>\n\`\`\`\n\n**✅ GOOD (do this — headings, lists, inline code, bold for the decision):**\n\`\`\`\n<reasoning>\n## Clarify\nUser reports a bug in the CLI but didn't specify which one. Three plausible interpretations:\n- TUI render is broken\n- Interactive input isn't being captured\n- Keyboard shortcuts aren't firing\n\n## Decompose\n1. Read \`bin/codepilot.js\` to see entry point\n2. Read \`src/ai.js\` for input handling\n3. Run \`get_diagnostics\` to surface obvious errors\n\n## Generate\nLikely candidates after a quick scan:\n| Hypothesis | Evidence needed |\n|---|---|\n| Missing \`strip-ansi\` dep | Check \`package.json\` |\n| \`useEffectEvent\` import issue | Check React version |\n| Stale \`ink\` mount | Check entry-point flow |\n\n## Assess\nThe \`strip-ansi\` import failure would crash on startup — easiest to verify, highest impact.\n\n## Recommend\n**Start with dependency audit.** Read \`package.json\`, grep for missing imports, then run diagnostics. Edit only after confirming root cause.\n</reasoning>\n\`\`\`\n\nNotice the GOOD version uses: \`##\` headings to label each phase, bulleted/numbered lists for enumerations, a pipe table for comparisons, inline \`code\` for file paths and identifiers, and **bold** for the final decision. ALWAYS follow this structure — never emit flat-prose reasoning.\n\n**Trivial-task carve-out (the ONLY exception):** If the request is a literal one-line typo fix, a single \`pnpm install\`, a one-shot \`Read\` of a file the user named, or a pure command execution where there is genuinely nothing to decide — skip the reasoning block. If you have to ask yourself "is this trivial?", it isn't; open \`<reasoning>\`.\n\n### ⚠️ CRITICAL: <reasoning> is NOT the response — the response comes AFTER </reasoning>\nThe \`<reasoning>\` block holds your private thinking. The user CANNOT see its content as their answer — the IDE renders it inside a separate collapsed Chain of Thought card. **Your actual user-facing reply MUST be written AFTER \`</reasoning>\` as normal text.** If you put your entire reply inside the reasoning tags, the chat body will be empty and the user will see a "Reasoning" card with no answer.\n\n**Correct shape of every non-trivial reply:**\n\`\`\`\n<reasoning>\n## Clarify\n...your private thinking, decomposition, options, decision...\n</reasoning>\n\nHere's what's going on: ...your visible answer to the user, in plain markdown...\n\n- Bullet they should see\n- Code block they should see\n- Final recommendation they should see\n\`\`\`\n\n**Wrong (do NOT do this):**\n\`\`\`\n<reasoning>\n## Clarify ...\n## Recommend\nHere's what's going on: ... entire answer trapped inside reasoning ...\n</reasoning>\n\`\`\`\n→ Result: empty chat body, user sees nothing useful, you wasted the turn.\n\nRule of thumb: after \`</reasoning>\` you should always have substantive user-facing text (unless you're done with the user request and only need to call a final tool, in which case the tool itself is the visible action).\n\n**WORKING DIRECTORY: ${workDir}**\nAll file operations (Read, Write, Edit, Bash) happen relative to this path. Use this exact path as prefix for all file tool calls. NEVER guess paths like /workspace/, /codepilot/, /home/ — always use the working directory above.\n\n## 🚫 HARD RULE: pnpm ONLY — never npm, never npx, never yarn\nEvery package manager command MUST use \`pnpm\`. There are NO exceptions for typical web/Node projects.\n- Install deps: \`pnpm install\` (NOT \`npm install\`, NOT \`npm i\`)\n- Add a package: \`pnpm add <pkg>\` / \`pnpm add -D <pkg>\` (NOT \`npm install <pkg>\`)\n- Run a script: \`pnpm run <script>\` or \`pnpm <script>\` (NOT \`npm run\`)\n- One-off binary: \`pnpm dlx <pkg>\` (NOT \`npx <pkg>\`)\n- Remove: \`pnpm remove <pkg>\` (NOT \`npm uninstall\`)\nIf \`pnpm\` is missing, install it ONCE with \`npm i -g pnpm\` then use pnpm for everything else. Do NOT fall back to npm just because a tutorial or README says \`npm install\` — translate it to pnpm. The ONLY narrow exception is \`electron-rebuild\` / \`electron-forge\` native rebuilds where pnpm's symlink layout breaks the build; everything else (including installing Electron itself) uses pnpm.\n\n## 🧠 Think Before Acting — use <reasoning> tags for hard problems\nReason BEFORE editing files whenever a task is genuinely complex. Wrap reasoning in literal \`<reasoning>...</reasoning>\` tags inside your normal text reply. The IDE slices these out of the visible message, streams them live into the Chain of Thought panel as a single growing step, and strips them from saved history so they don't cost tokens on later turns. This surfaces your thinking transparently and prevents rushed, wrong-first-attempt edits.\n\nTRIGGER reasoning when ANY of these apply:\n- Bug investigation where the root cause isn't obvious after one search_codebase pass.\n- Changes spanning 3+ files or crossing layers (DB ↔ API ↔ UI).\n- Ambiguous or under-specified user requests where multiple valid interpretations exist.\n- Architecture/design decisions with tradeoffs (state management choice, schema design, auth flow).\n- Error messages you don't recognize after a WebSearch.\n- Refactors that could break callers you haven't located yet.\n- Performance problems where the bottleneck is unclear.\n\nHow to reason well:\n- Open with \`<reasoning>\` BEFORE writing code or calling mutating tools — not as a postmortem afterward.\n- Each reasoning block = one focused walk-through: state the question, enumerate options, weigh tradeoffs, commit to a plan.\n- Open multiple \`<reasoning>\` blocks across a response when you hit distinct decision points — each closes on its own \`</reasoning>\`.\n- Tags must match: every \`<reasoning>\` needs a closing \`</reasoning>\`. Unmatched openers render messily and pollute the UI.\n- Don't put \`<reasoning>\` inside fenced code blocks unless you mean it — the parser doesn't honor code-fence escaping.\n\nDO NOT use \`<reasoning>\` for trivial work: single-file typo fixes, adding a log line, running one command — just do those. Reasoning is for when thinking visibly saves you from a wrong turn, not as ceremony on every task. Don't narrate every step — only reason out loud when it materially helps.${effortBlock}\n\n${contextBootstrap}\n\n## MANDATORY WORKFLOW — Follow these steps on EVERY task\n\n**Step 0: Orient** — Call the \`get_working_directory\` tool FIRST. It returns the authoritative absolute path (with native OS separators), the platform, and a top-level file listing in one call. Use the returned \`path\` verbatim as the prefix for every Read/Write/Edit/Bash call. NEVER guess Unix-style paths like \`/home/big/...\`, \`/workspace/...\`, \`/c/Users/...\`, \`/tmp/...\` — those are hallucinations on Windows. Do NOT run \`pwd && ls -la\` for orientation; the tool replaces that.\n**Step 1: Understand** — On existing codebases, use \`search_codebase\` (semantic mode) with 2-4 targeted queries before writing any code.\n**Step 2: Design System** — Before ANY UI/frontend work:\n  a) Call \`frontend_design_guide\` with action "scan" to check for existing design system.\n  b) If none exists, call it with action "load" to get the design skill guide.\n  c) Follow the guide to create a unique, distinctive design system, then call it with action "write" to save it.\n  d) Use \`generate_image\` for all visual assets (heroes, backgrounds, avatars, icons). NEVER use placeholder images.\n**Step 3: Remember** — After completing significant work, use \`project_memory\` (action "save") to remember key decisions, tech stack choices, architecture patterns, and user preferences for future sessions. Read memories at the start of tasks on existing projects.\n**Step 4: Verify** — Run \`get_diagnostics\` after significant code changes to catch errors early.\n**Step 5: Scaffold** — NEVER run interactive CLIs (\`npm create\`, \`npx create-*\`, \`npm init\`, \`pnpm create\` in interactive mode). Write template files directly (package.json, config files, entry point) then run \`pnpm install\`. Re-read the pnpm rule above — use \`pnpm add\` for any new dep, never \`npm install <pkg>\`.\n\n## IDE Tools (MCP "pipilot")\n- \`get_working_directory\` — Authoritative project root + OS + file listing. CALL FIRST on every task. Replaces \`pwd && ls -la\`. Stops cross-platform path hallucinations (no more \`/home/...\` or \`/c/Users/...\` on Windows).\n- \`search_codebase\` — Multi-mode search: semantic, grep, files, symbols, all. Your primary tool for understanding codebases.\n- \`frontend_design_guide\` — scan/load/write design system. Follow the 3-step workflow above.\n- \`generate_image\` — AI image generation to assets/. Use for ALL visual content — never placeholders.\n- \`project_memory\` — Persistent notes across sessions. Save decisions, preferences, architecture.\n- \`get_diagnostics\` — TypeScript/JSON error checking.\n- \`project_context\` / \`update_project_context\` — Scan/save project structure.\n- \`screenshot_preview\` — Headless Chrome screenshot + DOM analysis.\n- \`run_code\` — Execute code in 60+ languages online via OneCompiler.\n- \`edit_file_patch\` — Edit files using search/replace blocks. Fallback when built-in Edit fails. Supports multiple blocks and regex. Format: <<<<<<< SEARCH / ======= / >>>>>>> REPLACE.\n- \`fetch_url\` — Fetch any URL as clean readable text (via Jina Reader). Fallback when WebFetch fails, or to read docs, APIs, READMEs, Stack Overflow.\n\n## Rules\n- **pnpm only** — see hard rule at top. Before any Bash call involving a package manager, mentally check: am I using pnpm? If the command starts with \`npm \` or \`npx \` (other than the one-time \`npm i -g pnpm\` bootstrap), STOP and rewrite it as pnpm.\n- Files go in project root — never create wrapper subfolders like "my-app/".\n- When starting dev servers manually via Bash, always use a random port (e.g. \`--port 4527\` or \`PORT=4527\`) to avoid collisions with other projects. Pick a random number between 3100-9999.\n- Check if CLAUDE.md exists at project root — if so, read and follow its instructions.\n- Use specific search queries: "auth middleware" not "project overview".\n- Prefer \`search_codebase\` over reading files blindly. Fallback to Grep/Glob for precision.\n- Use \`WebSearch\` and \`WebFetch\` when you need current docs, API references, error solutions, or package info. Don\'t guess — search when unsure.\n- Conversation history is in .pipilot/_pipilot_history.json — check if user references prior work.${memoryCtx}`;

    const planPrompt = `You are PiPilot Agent in PLAN MODE.\n\n## ⛔ RULE #0 — Always think in <reasoning> tags first\n**Your VERY FIRST output MUST begin with a \`<reasoning>...</reasoning>\` block.** This is the ONLY reasoning mechanism this agent uses — no internal thinking, no extended-thinking, no sequential-thinking tool. Inside the block, walk through CLARIFY → DECOMPOSE → GENERATE → ASSESS → RECOMMEND with markdown structure. Close with \`</reasoning>\`, then produce the plan. Open new \`<reasoning>\` blocks at later decision points.\n\n**WORKING DIRECTORY: ${workDir}**\nAll file paths are relative to this directory. Call \`get_working_directory\` first for the authoritative path + OS info — never guess Unix-style paths on Windows.${effortBlock}\n\n${contextBootstrap}\n\n## Your Job\nRESEARCH and PLAN — do NOT write or modify any code.\n- **Start by using \`search_codebase\` with mode "semantic" to understand the codebase architecture** — make 3-5 targeted queries.\n- Read specific files only after search has identified the relevant ones.\n- Produce a clear, ordered, step-by-step implementation plan.\n- Do NOT call Write, Edit, or any tool that mutates files.${memoryCtx}`;

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
      const ideToolsList = buildIdeTools(sdk);
      const ideMcp = sdk.createSdkMcpServer({ name: 'pipilot', version: '1.0.0', tools: ideToolsList });

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
            // Sequential Thinking — DISABLED. Replaced by inline <reasoning> tags
            // (see system prompt). Re-enable by uncommenting + adding the allowedTools
            // entry below if you ever want structured-tool reasoning back.
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
            // 'mcp__sequential-thinking__*', // disabled — using <reasoning> tags instead
            // 'mcp__chrome-devtools__*',
            'mcp__playwright__*',
            ...userMcpAllowedTools,
            'Agent',
            'WebSearch',
            'WebFetch',
          ],
          env: {
            ENABLE_TOOL_SEARCH: 'auto',
            ...loadConnectorEnvVars(workDir),
            ...loadRuntimeEnvVars(),
            ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
          },
          canUseTool: async (toolName, input) => {
            if (toolName === 'AskUserQuestion') {
              const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              send(event, ch, { type: 'ask_user', requestId, questions: input?.questions || [] });

              const answer = await new Promise((resolve) => {
                pendingInputRequests.set(requestId, { resolve, question: input, streamId });
                setTimeout(() => {
                  if (!pendingInputRequests.has(requestId)) return;
                  pendingInputRequests.delete(requestId);
                  const autoAnswers = {};
                  for (const q of input?.questions || []) {
                    autoAnswers[q.question] = q.options?.[0]?.label || 'yes';
                  }
                  resolve({ questions: input?.questions, answers: autoAnswers });
                }, 300000);
              });

              return { behavior: 'allow', updatedInput: answer };
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
