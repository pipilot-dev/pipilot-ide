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
        'Manage the design system file at .pipilot/design.md. ALWAYS read this before doing any UI/frontend work. Actions: "read" to get current design tokens, "scan" to extract from CSS/Tailwind and generate, "write" to save a custom design spec.',
        { action: z.enum(['read', 'scan', 'write']).describe('Action to perform'), content: z.string().optional().describe('Content to write (only for write action)') },
        async (args) => {
          try {
            const result = await ideTools.frontendDesignGuide(args);
            if (result.error) return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
            return { content: [{ type: 'text', text: result.content || JSON.stringify(result, null, 2) }] };
          } catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }] }; }
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

  ipcMain.handle('agent:send', async (event, { streamId, sessionId, projectPath, message, mode, attachments }) => {
    const ch = `agent:event:${streamId}`;

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
        const h = readHistory();
        h.push(entry);
        fs.writeFileSync(historyFile, JSON.stringify(h, null, 2), 'utf8');
        console.log(`[agent] History appended (${h.length} entries) to ${historyFile}`);
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
    try {
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
    appendHistory({ role: 'user', content: String(message || ''), timestamp: new Date().toISOString() });
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

    const buildPrompt = `You are PiPilot Agent building a project in ${workDir}.\n\n${contextBootstrap}\n\n## IDE Tools Available\nYou have access to these IDE-specific tools via MCP:\n- \`get_diagnostics\` — Run TypeScript/JSON checks and return all errors and warnings. Use after changes to verify correctness.\n- \`project_context\` — Scan project structure (framework, deps, entry points, config files, file tree).\n- \`update_project_context\` — Scan and write/update .pipilot/project.md.\n- \`frontend_design_guide\` — Manage design system at .pipilot/design.md. Use "read" before UI work, "scan" to extract tokens from CSS/Tailwind, "write" to save custom design.\n- \`screenshot_preview\` — Capture a screenshot of the running dev server or any URL. Returns PNG image + DOM analysis. Use after UI changes to visually verify the result.\n- \`generate_image\` — Generate an image from a text description using AI. Saves to assets/ folder. Use for hero images, backgrounds, avatars, illustrations. Supports 16:9, 1:1, 9:16 aspect ratios.\n- \`run_code\` — **Compile and run code in 60+ languages online.** Use to test code snippets, verify algorithms, run scripts without local setup. Pass language (e.g. "python", "javascript", "java", "cpp", "go", "rust") and code. Returns stdout, stderr, and execution stats. Great for testing logic before writing to files.\n- \`search_codebase\` — **Your primary tool for understanding any codebase.** Multi-mode search with BM25 semantic ranking. Modes: "semantic" (natural language — "how does auth work?"), "grep" (regex), "files" (fuzzy filename), "symbols" (function/class/export defs), "all" (combined). Returns ranked results with file paths, line numbers, and snippets.\n\n## IMPORTANT: Always Use search_codebase First\n**Before writing ANY code, use \`search_codebase\` to understand the codebase.** This is your most powerful tool.\n\n1. **Start EVERY task** with 2-4 semantic searches to understand the relevant code areas. Example queries: "how does the auth system work", "where are API routes defined", "what components render the dashboard".\n2. **Use mode "semantic"** for natural language questions about architecture, flow, or "how does X work?".\n3. **Use mode "symbols"** when looking for specific functions, classes, or exports.\n4. **Use mode "grep"** for exact text/regex patterns.\n5. **Use mode "files"** to find files by name.\n6. **Use mode "all"** when you want comprehensive results across all search types.\n7. **Prefer \`search_codebase\` over reading files blindly** — it returns the most relevant code sections ranked by relevance, saving you from reading entire files to find what matters.\n8. **On large codebases (100+ files)**, make multiple targeted semantic queries to build understanding before making changes. This prevents bugs from misunderstanding existing patterns.\n9. **Fallback to Grep/Glob** — If semantic search doesn\'t return enough detail, fall back to the SDK\'s built-in Grep and Glob tools for precise file-level searching. Use the search_codebase results to know WHERE to grep — don\'t grep blindly across the whole project.\n10. **Use specific queries, not broad ones** — "how does auth work" beats "project structure tech stack framework". Ask targeted questions: "main entry point", "API routes", "database schema", "error handling", "state management".\n\n## Conversation History\nConversation history is stored in .pipilot/_pipilot_history.json.\nRecent history is injected into your prompt automatically. If the user references prior work, check the history file or scan the project files to understand what was built.\n\n## Rules\n- Never create subfolders for the project (no "my-app/", etc.). Files go in the project root.\n- Read CLAUDE.md if it exists for additional project-specific instructions.\n- ALWAYS maintain design consistency — read .pipilot/design.md before any UI work.\n- Use \`get_diagnostics\` after making significant code changes to catch errors early.\n- Use \`project_context\` at the start of complex tasks to understand the codebase.\n- Use \`frontend_design_guide\` with action "read" before writing any UI/frontend code.${memoryCtx}`;

    const planPrompt = `You are PiPilot Agent in PLAN MODE inside ${workDir}.\n\n${contextBootstrap}\n\n## Your Job\nRESEARCH and PLAN — do NOT write or modify any code.\n- **Start by using \`search_codebase\` with mode "semantic" to understand the codebase architecture** — make 3-5 targeted queries.\n- Read specific files only after search has identified the relevant ones.\n- Produce a clear, ordered, step-by-step implementation plan.\n- Do NOT call Write, Edit, or any tool that mutates files.${memoryCtx}`;

    const agentSystemPrompt = mode === 'plan' ? planPrompt : buildPrompt;

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
          if (!srv.enabled || !srv.name || !srv.command) continue;
          const srvName = srv.name.replace(/[^a-zA-Z0-9_-]/g, '_');
          userMcpServers[srvName] = {
            command: srv.command,
            args: srv.args || [],
            env: srv.env || {},
          };
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
            // PiPilot IDE tools — diagnostics, project context, design guide, search, screenshot
            pipilot: ideMcp,
            // Context7 — documentation search for any library/framework
            context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
            // DeepWiki — read wiki docs about any GitHub repo
            deepwiki: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' },
            // Sequential Thinking — structured reasoning
            'sequential-thinking': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
            // User-configured MCP servers
            ...userMcpServers,
          },
          allowedTools: [
            'mcp__pipilot__*',
            'mcp__context7__*',
            'mcp__deepwiki__*',
            'mcp__sequential-thinking__*',
            ...userMcpAllowedTools,
            'Agent',
          ],
          env: {
            ENABLE_TOOL_SEARCH: 'auto',
            ...loadConnectorEnvVars(workDir),
            ...loadRuntimeEnvVars(),
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
              description: 'Build complete features spanning database, API, and frontend layers.',
              prompt: 'You are a senior fullstack developer. Build cohesive, end-to-end solutions. Always use search_codebase (semantic mode) first to understand existing code before making changes. Technology expertise: React, Next.js, Vue, Node.js, Express, PostgreSQL, MongoDB, TypeScript, REST, GraphQL.',
              tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
              mcpServers: ['pipilot'],
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
              const resultBlock = {
                type: 'tool_result',
                toolUseId: block.tool_use_id,
                content: typeof preview === 'string' ? preview : String(preview ?? ''),
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

      // Save assistant response to history file
      const assistantText = assistantEntry.blocks
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('') || '(tool use only)';
      appendHistory({ role: 'assistant', content: assistantText, timestamp: new Date().toISOString() });

      // Auto-compact: reset history if it gets too long (> 30 entries)
      try {
        if (historyFile) {
          const h = readHistory();
          if (h.length > 30) {
            fs.writeFileSync(historyFile, JSON.stringify([{
              role: 'system',
              content: '[Conversation compacted — earlier context summarized]',
              timestamp: new Date().toISOString(),
              compacted: true,
            }], null, 2), 'utf8');
          }
        }
      } catch {}
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
