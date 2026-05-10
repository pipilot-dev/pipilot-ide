// PiPilot IDE — Build the pipilot MCP tool list for the agent SDK.
//
// Extracted from ipc-agent.js so both the chat handler AND
// mission-agent.js can wire the same tools into their sdk.query()
// calls. Behaviour is identical to what shipped before — just the
// container module changed.
//
// Each tool wraps a function in main/mcp-ide-tools.js and exposes
// it to the agent via sdk.tool(name, description, zodSchema, impl).

const fs = require('fs');
const path = require('path');
const ideTools = require('./mcp-ide-tools');

function buildIdeTools(sdk, ctx) {
  const { z } = require('zod');
  const browserCtl = require('./browser-control'); // module.browserExec singleton

  function browserToolText(label, payload) {
    if (payload == null) return `${label}: ok`;
    if (typeof payload === 'string') return `${label}: ${payload}`;
    return `${label}:\n${JSON.stringify(payload, null, 2)}`;
  }

  // Spill long browser-tool payloads to disk so we don't blow the
  // agent's context with a 50 KB get_text dump. The full content is
  // saved under <tmp>/pipilot-browser-text/, the response shows the
  // first `inlineLimit` chars + a path the Read tool can pull the
  // rest from. Returns the response text.
  function spillIfLong(label, body, inlineLimit, ext) {
    const text = String(body || '');
    if (text.length <= inlineLimit) return text;
    let savedPath = null;
    try {
      const os = require('os');
      const dir = path.join(os.tmpdir(), 'pipilot-browser-text');
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      savedPath = path.join(dir, `${label}-${ts}-${rand}.${ext || 'txt'}`);
      fs.writeFileSync(savedPath, text, 'utf8');
    } catch (err) {
      // Spill failed — fall back to the old "show head + suffix note"
      // behaviour so the agent at least gets something.
      console.warn('[browser-tools] spill failed:', err.message);
      return text.slice(0, inlineLimit) + `\n…\n[truncated, ${text.length} total chars — could not spill to disk: ${err.message}]`;
    }
    const head = text.slice(0, inlineLimit);
    return [
      head,
      '',
      '…',
      '',
      `[truncated — ${text.length.toLocaleString()} total chars; ${(inlineLimit).toLocaleString()} shown above]`,
      `Full ${ext === 'html' ? 'HTML' : 'text'} written to: ${savedPath}`,
      `Use the Read tool on that path to load the rest.`,
    ].join('\n');
  }

  return [
    sdk.tool('reason',
      'Record your private thinking in ONE call before producing your text reply. Pass the full reasoning as a single `thought` field — synthesize all your analysis (clarify, options, tradeoffs, decision) into one structured markdown block. Do NOT make multiple reason calls per turn. The IDE renders the call in a collapsed Chain of Thought panel separate from your reply. After the call, write your user-facing answer as normal markdown text. The tool returns a short ack — ignore it.',
      {
        thought: z.string().describe('The complete reasoning for this turn as a single markdown block. Use ## headings to delineate sections (Clarify / Options / Decision / Plan), bulleted lists, pipe tables, inline code, fenced code blocks, **bold** for the chosen approach. Treat this like a short engineering note an experienced reader could skim in 15 seconds.'),
      },
      async () => {
        return { content: [{ type: 'text', text:
          'Reasoning recorded.\n\n' +
          '⚠ DO NOT STOP HERE. The user has not seen anything yet — calling `reason` produces zero user-visible output (the IDE shows it in a collapsed side panel). Your turn is incomplete until you EITHER:\n' +
          '  • write your user-facing reply as normal markdown text, OR\n' +
          '  • call another tool to act on the reasoning above.\n\n' +
          'Continue NOW with the next step from your plan. Do not return an empty/no-op turn.'
        }] };
      }
    ),
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
          if (fullText.length <= PREVIEW_SIZE) {
            return { content: [{ type: 'text', text: `Fetched ${result.url} (${fullText.length} chars):\n\n${fullText}` }] };
          }

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
    // ── screenshot_preview is RETIRED ────────────────────────────────
    // The embedded browser tools (browser_open + browser_screenshot)
    // supersede it: same disk-backed output, plus full interactivity
    // (click/type/scroll/console/snapshot), no puppeteer-core dependency,
    // and shares cookies with the user's logged-in browser session.
    // Re-enable only if you remove the embedded browser.
    /*
    sdk.tool('screenshot_preview',
      'Capture a screenshot of the running dev server or any URL using headless Chrome. Returns PNG image + DOM analysis.',
      { url: z.string().describe('URL to screenshot'), width: z.number().optional().default(1440).describe('Viewport width'), height: z.number().optional().default(900).describe('Viewport height') },
      async (args) => {
        try {
          const result = await ideTools.screenshotPreview(args);
          if (result.error) return { content: [{ type: 'text', text: result.error }], isError: true };
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
    */
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

    sdk.tool('run_command',
      'Run a shell command on a PERSISTENT shell session shared across calls in this workspace. ' +
      'Shell is the OS-native default (cmd.exe on Windows, bash on macOS/Linux) — same one the user\'s terminal panel uses, so commands behave identically to typing them there. ' +
      'On Windows that means cmd syntax: `&&` chaining works, `dir` lists files, env vars are `%FOO%`, redirection is `>` and `2>&1`. Native paths like `C:\\Users\\big\\proj` work as-is — no path translation needed. ' +
      'On macOS/Linux it\'s plain bash. ' +
      'PREFER THIS OVER `Bash` for normal shell work — `Bash` spawns a fresh shell per call (~3 s on Windows for `ls`); run_command keeps one shell alive and pipes commands through it, so subsequent calls land in <50 ms. ' +
      'State (cwd, exported vars, command history) PERSISTS across calls — that is by design. Pass `cwd` to run a single command in a different directory (we pushd/popd around it so the persistent shell\'s cwd is unchanged). ' +
      'Combined stdout+stderr is returned (we redirect 2>&1).',
      {
        command: z.string().describe('Shell command to execute (bash syntax)'),
        description: z.string().optional().describe('One-line human description of what the command does. Shown in the tool pill so the user can see your intent at a glance — e.g. "Install dependencies" or "Run unit tests". Optional but recommended.'),
        cwd: z.string().optional().describe('Per-command cwd (uses pushd/popd so the persistent shell\'s cwd is unchanged). Default: workspace root.'),
        timeoutMs: z.number().optional().default(60_000).describe('Kill the command after N ms via SIGINT. Default 60 s, hard cap 10 min. Ignored when run_in_background:true.'),
        isolated: z.boolean().optional().default(false).describe('Wrap in a subshell so cd/exports don\'t leak into subsequent calls. (No-op on Windows cmd.)'),
        run_in_background: z.boolean().optional().default(false).describe('Fire-and-forget mode for long-running processes (dev servers, watchers). Returns immediately with the on-disk log path; the command keeps running. The agent can later poll the log via `tail -n 50 <path>` (bash) or `type <path>` (cmd). Use for `pnpm dev`, `vite`, `next dev`, etc. — anything you don\'t want to block on.'),
      },
      async (args) => {
        try {
          const { getShell } = require('./persistent-shell');
          const cwd = ideTools.workDir ? ideTools.workDir() : (ideTools._currentWorkDir || process.cwd());
          const shell = getShell(cwd);
          const r = await shell.exec(args.command, {
            cwd: args.cwd,
            // Background mode skips the timeout entirely — we return
            // as soon as the shell echoes the sentinel, which is
            // immediate after start /B (Windows) or & (bash). The
            // dev server keeps running.
            timeoutMs: args.run_in_background ? 5_000 : args.timeoutMs,
            isolated: args.isolated,
            run_in_background: args.run_in_background,
          });
          const head = args.run_in_background
            ? `started in background • ${r.elapsedMs} ms`
            : `exit ${r.exitCode} • ${r.elapsedMs} ms`;
          const body = r.stdout || '(no output)';
          // Cap at 16 KB inline; bigger output should use Bash with
          // pipes to file or have the caller chunk.
          const capped = body.length > 16_000
            ? body.slice(0, 16_000) + `\n…\n[truncated, ${body.length} total chars]`
            : body;
          return {
            content: [{ type: 'text', text: `${head}\n${capped}` }],
            isError: r.exitCode !== 0,
          };
        } catch (e) {
          return { content: [{ type: 'text', text: `run_command error: ${e.message}\n\n(Falling back to the built-in Bash tool is fine if bash isn\'t available on PATH.)` }], isError: true };
        }
      }
    ),

    // ─── Embedded browser control ────────────────────────────────────
    // The IDE ships a real Chromium <webview>-based browser. These tools
    // let you drive it: open URLs, find elements by CSS selector, click,
    // type, scroll, screenshot, extract text/HTML, run arbitrary JS.
    // Tabs are addressed by the `tabId` returned from `browser_open` /
    // `browser_list_tabs`. If you omit `tabId`, ops run on the active tab.
    sdk.tool('browser_open',
      'Open a new tab in the embedded web browser at the given URL and return its tabId. Use for any task that needs live web data: research, login flows, scraping a single page, testing a deployed site, watching a video. Subsequent ops (click/type/scroll/screenshot) take this tabId.\n\nRECOMMENDED FLOW for browser tasks:\n  1. Think first via mcp__pipilot__reason — list the goal, the steps, and what evidence you need.\n  2. browser_open → browser_observe (or browser_snapshot) to find refs.\n  3. browser_click_ref / browser_fill_ref using refs from the snapshot.\n  4. After EVERY click, check the returned `confidence` and `verified` fields. If confidence is "no-change", DO NOT assume success — try a different selector.',
      { url: z.string().describe('Full URL to navigate to (https://...). Plain queries also accepted — they go through the configured search engine.'), incognito: z.boolean().default(false).describe('Open in a private session (no cookies, no history persistence)') },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('open', args, 15000);
          const txt = browserToolText('Opened browser tab', r) +
            '\n\nNext: call mcp__pipilot__browser_observe (or browser_snapshot) to see what is on the page and get refs. Use mcp__pipilot__reason to plan if the task is non-trivial.';
          return { content: [{ type: 'text', text: txt }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_open error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_list_tabs',
      'List all open browser tabs with id, url, title, mode (std/inc), and which one is active. Use to discover existing tabs before navigating or operating on them.',
      {},
      async () => {
        try {
          const r = await browserCtl.browserExec('list_tabs', {}, 5000);
          return { content: [{ type: 'text', text: browserToolText('Open browser tabs', r) }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_list_tabs error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_close_tab',
      'Close a browser tab by id.',
      { tabId: z.string().describe('Tab id from browser_open / browser_list_tabs') },
      async (args) => {
        try { const r = await browserCtl.browserExec('close_tab', args, 5000); return { content: [{ type: 'text', text: browserToolText('Closed', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_close_tab error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_navigate',
      'Navigate an existing browser tab to a new URL. Use this instead of opening a new tab when you want to keep cookies/session.',
      { tabId: z.string().optional().describe('Tab id (defaults to active tab)'), url: z.string().describe('Destination URL') },
      async (args) => {
        try { const r = await browserCtl.browserExec('navigate', args, 30000); return { content: [{ type: 'text', text: browserToolText('Navigated', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_navigate error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_back',    'Browser back button.',    { tabId: z.string().optional() }, async (a) => { try { const r = await browserCtl.browserExec('back',    a, 5000); return { content: [{ type: 'text', text: browserToolText('Back', r)    }] }; } catch (e) { return { content: [{ type: 'text', text: 'browser_back error: ' + e.message }], isError: true }; } }),
    sdk.tool('browser_forward', 'Browser forward button.', { tabId: z.string().optional() }, async (a) => { try { const r = await browserCtl.browserExec('forward', a, 5000); return { content: [{ type: 'text', text: browserToolText('Forward', r) }] }; } catch (e) { return { content: [{ type: 'text', text: 'browser_forward error: ' + e.message }], isError: true }; } }),
    sdk.tool('browser_reload',  'Reload the current page.', { tabId: z.string().optional() }, async (a) => { try { const r = await browserCtl.browserExec('reload',  a, 5000); return { content: [{ type: 'text', text: browserToolText('Reloaded', r) }] }; } catch (e) { return { content: [{ type: 'text', text: 'browser_reload error: ' + e.message }], isError: true }; } }),
    sdk.tool('browser_url',     'Current URL of a tab.',    { tabId: z.string().optional() }, async (a) => { try { const r = await browserCtl.browserExec('url',     a, 5000); return { content: [{ type: 'text', text: browserToolText('URL', r)     }] }; } catch (e) { return { content: [{ type: 'text', text: 'browser_url error: ' + e.message }], isError: true }; } }),
    sdk.tool('browser_title',   'Current page title.',      { tabId: z.string().optional() }, async (a) => { try { const r = await browserCtl.browserExec('title',   a, 5000); return { content: [{ type: 'text', text: browserToolText('Title', r)   }] }; } catch (e) { return { content: [{ type: 'text', text: 'browser_title error: ' + e.message }], isError: true }; } }),
    sdk.tool('browser_observe',
      'Observe the active browser tab — captures a screenshot AND emits a Playwright-style accessibility snapshot + the page console log in one call. This is the PRIMARY tool for understanding what is on a page before acting on it; call it after any navigation or interaction. Writes three files to disk and returns their paths — use the Read tool on the image path to view the screenshot, the .snapshot.yaml to find clickable refs ([ref=eN]) for browser_click_ref / browser_fill_ref, and the .console.log to inspect browser console output. Default format is JPEG at quality 92 (visually lossless for UI text, ~5× smaller than PNG); pass format:"png" for lossless or transparency.',
      {
        tabId: z.string().optional(),
        format: z.enum(['jpeg', 'png']).default('jpeg').describe('Image format. JPEG default for compactness; PNG for lossless / transparency.'),
        quality: z.number().min(60).max(100).default(92).describe('JPEG quality 60-100 (ignored for PNG). 92 is visually lossless for typical UIs.'),
        maxWidth: z.number().min(640).max(3840).default(1600).describe('Cap on output pixel width. Wider captures are downscaled (aspect preserved); narrower ones pass through.'),
      },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('screenshot', args, 60000);
          if (!r?.base64 || r.size < 1024) throw new Error('screenshot returned no data');
          const b64Clean = String(r.base64).replace(/\s+/g, '');
          if (b64Clean.length < 200) throw new Error('screenshot base64 was empty after cleanup');
          const os = require('os');
          const dir = path.join(os.tmpdir(), 'pipilot-screenshots');
          try { fs.mkdirSync(dir, { recursive: true }); } catch {}
          const ts = Date.now();
          const ext = r.ext || 'jpg';
          const imgPath  = path.join(dir, `shot-${ts}.${ext}`);
          const snapPath = path.join(dir, `shot-${ts}.snapshot.yaml`);
          const logPath  = path.join(dir, `shot-${ts}.console.log`);

          try { fs.writeFileSync(imgPath, Buffer.from(b64Clean, 'base64')); }
          catch (err) { return { content: [{ type: 'text', text: `browser_observe error: could not write image — ${err.message}` }], isError: true }; }

          const snapYaml = [
            `# url: ${r.url || ''}`,
            `# title: ${(r.title || '').replace(/\n/g, ' ')}`,
            `# refCount: ${r.snapshot?.refCount || 0}`,
            '',
            r.snapshot?.tree || '(no snapshot)',
          ].join('\n');
          try { fs.writeFileSync(snapPath, snapYaml); } catch {}

          const logText = (r.consoleLog || []).map(c => {
            const t = new Date(c.ts || ts).toISOString().slice(11, 23);
            const src = c.source ? ` ${c.source}:${c.line}` : '';
            return `[${t}] ${c.level.toUpperCase()}${src}  ${c.text}`;
          }).join('\n') || '(no console messages)';
          try { fs.writeFileSync(logPath, logText); } catch {}

          const errCount = (r.consoleLog || []).filter(c => c.level === 'error').length;
          const warnCount = (r.consoleLog || []).filter(c => c.level === 'warn').length;
          const fmtLabel = (r.mime || '').toUpperCase().split('/')[1] || ext.toUpperCase();
          const summary = [
            `Screenshot captured (${Math.round(r.size / 1024)}KB, ${fmtLabel}).`,
            ``,
            `Files saved:`,
            `  - Image:    ${imgPath}`,
            `  - Snapshot: ${snapPath}    (${r.snapshot?.refCount || 0} interactive refs)`,
            `  - Console:  ${logPath}     (${(r.consoleLog || []).length} entries, ${errCount} errors, ${warnCount} warnings)`,
            ``,
            `Page: ${r.url || ''}`,
            r.title ? `Title: ${r.title}` : '',
            ``,
            `IMPORTANT: Use the Read tool on "${imgPath}" to view the screenshot image.`,
          ].filter(Boolean).join('\n');

          // Text-only — same shape as the working screenshot_preview tool.
          // MCP image-content validation has been unreliable for large
          // base64 payloads in this host; the agent reads the PNG via Read.
          return { content: [{ type: 'text', text: summary }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_observe error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_snapshot',
      'Emit ONLY the Playwright-style accessibility snapshot of the active browser tab (no PNG). Each interactive element gets a [ref=eN] you can pass to browser_click_ref / browser_fill_ref. Cheaper than browser_screenshot when you only need to find selectors.',
      { tabId: z.string().optional() },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('snapshot', args, 60000);
          const os = require('os');
          const dir = path.join(os.tmpdir(), 'pipilot-screenshots');
          try { fs.mkdirSync(dir, { recursive: true }); } catch {}
          const ts = Date.now();
          const snapPath = path.join(dir, `snap-${ts}.snapshot.yaml`);
          const logPath  = path.join(dir, `snap-${ts}.console.log`);
          const yaml = [
            `# url: ${r.url || ''}`,
            `# title: ${(r.title || '').replace(/\n/g, ' ')}`,
            `# refCount: ${r.refCount || 0}`,
            '',
            r.tree || '(no snapshot)',
          ].join('\n');
          try { fs.writeFileSync(snapPath, yaml); } catch {}
          const logText = (r.consoleLog || []).map(c => {
            const t = new Date(c.ts || ts).toISOString().slice(11, 23);
            return `[${t}] ${c.level.toUpperCase()}${c.source ? ' ' + c.source + ':' + c.line : ''}  ${c.text}`;
          }).join('\n') || '(no console messages)';
          try { fs.writeFileSync(logPath, logText); } catch {}
          // Inline the YAML if small, otherwise just point to disk
          const inline = (r.tree || '').length < 12000 ? '\n\n' + (r.tree || '(empty)') : '\n\n[Tree truncated — read the file]';
          return { content: [{ type: 'text', text: `Snapshot saved to ${snapPath} (${r.refCount || 0} refs). Console log at ${logPath} (${(r.consoleLog || []).length} entries).${inline}` }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_snapshot error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_console_log',
      'Get the captured browser console output (log/warn/error/info) since the last navigation. Pass clear=true to also reset the buffer.',
      { tabId: z.string().optional(), clear: z.boolean().default(false).describe('Clear the buffer after reading') },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('console_log', args, 15000);
          const entries = r?.entries || [];
          if (!entries.length) return { content: [{ type: 'text', text: '(no console messages)' }] };
          const lines = entries.map(c => {
            const t = new Date(c.ts).toISOString().slice(11, 23);
            return `[${t}] ${c.level.toUpperCase()}${c.source ? ' ' + c.source + ':' + c.line : ''}  ${c.text}`;
          });
          // Truncate if it would blow the context
          const out = lines.length > 200 ? lines.slice(-200).join('\n') + `\n…\n[${lines.length - 200} earlier entries dropped]` : lines.join('\n');
          return { content: [{ type: 'text', text: out }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_console_log error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_click_ref',
      'Click an element by its [ref=eN] from a recent snapshot. PREFERRED over CSS selectors when you have a snapshot — refs are stable until the next navigation. Returns the same verification block as browser_click (confidence, urlChanged, modalAppeared, targetGone, domMutationCount). Auto-waits for navigation if the URL changes.',
      {
        tabId: z.string().optional(),
        ref: z.string().describe('Ref id like "e42" from the latest snapshot'),
        settleMs: z.number().optional().describe('How long to wait for DOM to settle (default 350ms)'),
      },
      async (args) => {
        try { const r = await browserCtl.browserExec('click_ref', args, 30000); return { content: [{ type: 'text', text: browserToolText('Click', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_click_ref error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_fill_ref',
      'Fill an input/textarea by its [ref=eN] from a recent snapshot. Set submit=true to press Enter after.',
      { tabId: z.string().optional(), ref: z.string().describe('Ref id like "e42"'), text: z.string(), submit: z.boolean().default(false) },
      async (args) => {
        try { const r = await browserCtl.browserExec('fill_ref', args, 20000); return { content: [{ type: 'text', text: browserToolText('Fill', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_fill_ref error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_click',
      'Click an element. The selector accepts CSS, [ref=eN], text="...", text=/regex/i, role=button[name="..."], or sel:has-text("..."). The IDE picks the BEST match across all candidates (visible, interactive, in viewport, not covered by overlays).\n\nReturns a VERIFICATION block so you can detect "click did nothing" without an extra observe call:\n  - confidence: "high" | "medium" | "low" | "no-change"\n  - verified.urlChanged, verified.modalAppeared, verified.targetGone, verified.titleChanged, verified.scrollChanged, verified.focusChanged\n  - verified.domMutationCount (DOM mutations during the 350ms settle window)\n\nIf the URL changes, the call automatically waits up to 5s for the new page to finish loading before returning. If confidence is "no-change", the click likely did nothing — try a different selector or check if the element was disabled / covered.',
      {
        tabId: z.string().optional(),
        selector: z.string().describe('Selector — CSS, [ref=eN], text="...", text=/regex/i, role=..., or sel:has-text("...")'),
        settleMs: z.number().optional().describe('How long to wait for DOM to settle after the click (default 350ms, range 150-2000)'),
      },
      async (args) => {
        try { const r = await browserCtl.browserExec('click', args, 30000); return { content: [{ type: 'text', text: browserToolText('Click', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_click error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_type',
      'Type text into an input/textarea/contentEditable element. Triggers proper input/change events so React/Vue/etc. detect it. Set submit=true to press Enter after.',
      { tabId: z.string().optional(), selector: z.string().describe('CSS selector for the input'), text: z.string().describe('Text to type'), submit: z.boolean().default(false).describe('Press Enter after typing') },
      async (args) => {
        try { const r = await browserCtl.browserExec('type', args, 20000); return { content: [{ type: 'text', text: browserToolText('Type', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_type error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_press_key',
      'Dispatch a keyboard event (keydown+keypress+keyup) on the focused element. Use for Enter, Escape, Tab, ArrowDown, etc.',
      { tabId: z.string().optional(), key: z.string().describe('Key name — e.g. "Enter", "Escape", "ArrowDown"') },
      async (args) => {
        try { const r = await browserCtl.browserExec('press_key', args, 5000); return { content: [{ type: 'text', text: browserToolText('Key', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_press_key error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_scroll',
      'Scroll the page. Pass `to` for an absolute scrollY position or `dy` for a relative delta.',
      { tabId: z.string().optional(), to: z.number().optional().describe('Absolute scrollY in pixels'), dy: z.number().optional().describe('Pixels to scroll by (positive=down)') },
      async (args) => {
        try { const r = await browserCtl.browserExec('scroll', args, 5000); return { content: [{ type: 'text', text: browserToolText('Scrolled', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_scroll error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_get_text',
      'Extract visible text from the page (or just the matched element if selector is given). Best for reading article body, search results, etc. If the result is longer than ~8 KB the full text is written to a temp file and the response truncates with a path the Read tool can pull the rest from.',
      { tabId: z.string().optional(), selector: z.string().optional().describe('Optional CSS selector — omit to get the whole document body text') },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('get_text', args, 90000);
          const text = r?.text || '';
          return { content: [{ type: 'text', text: spillIfLong('text', text, 8000, 'txt') || '(no text)' }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_get_text error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_get_html',
      'Get outerHTML of the document or a matched element. Useful for parsing structured pages — prefer browser_get_text for readability. If the result is longer than ~12 KB the full HTML is written to a temp file and the response truncates with a path the Read tool can pull the rest from.',
      { tabId: z.string().optional(), selector: z.string().optional() },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('get_html', args, 90000);
          const html = r?.html || '';
          return { content: [{ type: 'text', text: spillIfLong('html', html, 12000, 'html') || '(no html)' }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_get_html error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_wait_for',
      'Wait until a CSS selector matches an element, up to timeoutMs. Use after navigation or click before reading content from dynamic pages.',
      { tabId: z.string().optional(), selector: z.string().describe('CSS selector to wait for'), timeoutMs: z.number().default(10000).describe('Max wait in milliseconds') },
      async (args) => {
        try { const r = await browserCtl.browserExec('wait_for', args, (args.timeoutMs || 10000) + 2000); return { content: [{ type: 'text', text: browserToolText('Wait', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_wait_for error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_eval',
      'Run JavaScript in the page context. Two forms accepted:\n\n  1. Single expression: "document.title" — value is auto-returned.\n  2. Multi-statement block with explicit return: "const c = document.querySelector(\'canvas\'); return c?.getBoundingClientRect();" — wrap any non-trivial logic this way.\n\nThe code runs as an async function so you can `await` Promises. The return value is JSON-serialized; non-serializable types come back as { __error: ... }.',
      { tabId: z.string().optional(), expression: z.string().describe('Either a single expression OR a multi-statement function body that uses `return` to surface the result.') },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('eval', args, 90000);
          return { content: [{ type: 'text', text: browserToolText('Eval', r) }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_eval error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_summary',
      'Get a structured summary of the active page: URL, title, viewport, scroll position, and lists of links / buttons / inputs. Use this BEFORE clicking or typing so you know which selectors are valid.',
      { tabId: z.string().optional() },
      async (args) => {
        try { const r = await browserCtl.browserExec('summary', args, 45000); return { content: [{ type: 'text', text: browserToolText('Page summary', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_summary error: ${e.message}` }], isError: true }; }
      }
    ),
    /* ────────────────────────────────────────────────────────────────
     * RETIRED — coordinate-input + game-bot tool batch
     * To re-enable: remove the surrounding /* and matching closing one
     * (search "end RETIRED batch"). Matching renderer-side OPS + page
     * helpers in renderer/browser-tab.js are commented in lockstep —
     * search "RETIRED — coordinate-input" there. Disabled because the
     * agent's tool discovery layer was unreliable with 50+ browser tools.
     * ──────────────────────────────────────────────────────────────── */
    /*
    sdk.tool('browser_click_at',
      'Click at pixel coordinates (x, y) in the viewport — for canvas games, drawing apps, custom UIs where CSS selectors do not exist. Coordinates are in CSS pixels relative to the viewport top-left. Uses elementFromPoint to find the actual top element under that point and dispatches the full pointer/mouse sequence. Pair with browser_observe to know where to click — you can read pixel positions from the screenshot.',
      { tabId: z.string().optional(), x: z.number().describe('X pixel from viewport left'), y: z.number().describe('Y pixel from viewport top') },
      async (args) => {
        try { const r = await browserCtl.browserExec('click_at', args, 8000); return { content: [{ type: 'text', text: browserToolText('Click at', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_click_at error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_mouse_move',
      'Move the mouse pointer to (x, y) without clicking. Many canvas games (drawing tools, aim trainers, RTS) read mouse position on every animation frame — use this to steer the cursor.',
      { tabId: z.string().optional(), x: z.number(), y: z.number() },
      async (args) => {
        try { const r = await browserCtl.browserExec('mouse_move_at', args, 5000); return { content: [{ type: 'text', text: browserToolText('Move', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_mouse_move error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_drag_at',
      'Drag from (x1, y1) to (x2, y2) with smooth interpolated mouse movement. Coordinate-based equivalent of browser_drag — works on canvas games, drawing surfaces, sliders, etc. `steps` controls the number of intermediate move events (default 12, more = smoother).',
      { tabId: z.string().optional(), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), steps: z.number().optional() },
      async (args) => {
        try { const r = await browserCtl.browserExec('drag_at', args, 10000); return { content: [{ type: 'text', text: browserToolText('Drag', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_drag_at error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_poll_until',
      'Evaluate a JS expression IN THE PAGE every `intervalMs` until it returns truthy, or `timeoutMs` elapses. Critical for time-sensitive games (Aviator multiplier reaching X.XX, a button enabling, a counter changing). Polling runs entirely in the page context — no per-sample IPC roundtrip — so you can poll at ~10Hz reliably. Returns { ok, ms, value } on success; { ok:false, timeout:true } if it never matched.\n\nExample for Aviator: `parseFloat(document.querySelector(".multiplier").textContent) >= 2.5`',
      {
        tabId: z.string().optional(),
        expression: z.string().describe('JS expression evaluated each tick. Returns truthy when condition met.'),
        intervalMs: z.number().default(100).describe('Poll interval (20-1000ms). Default 100ms = 10Hz.'),
        timeoutMs: z.number().default(10000).describe('Max wait (up to 60000).'),
      },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('poll_until', args, (args.timeoutMs || 10000) + 2000);
          return { content: [{ type: 'text', text: browserToolText('Poll', r) }] };
        } catch (e) { return { content: [{ type: 'text', text: `browser_poll_until error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_run_script',
      'Install a long-lived JS bot into the page. The script\'s body is executed every `intervalMs` (or every animation frame if `useRaf:true`) and persists across many ticks. This is the ESCAPE HATCH for real-time game playing: instead of the agent driving each frame from chat (too slow), the agent writes a small game-bot once and lets it run.\n\nThe script body runs as a function with one argument `ctx` providing:\n  ctx.state          — persistent object (carry data between ticks)\n  ctx.log(msg)       — append to a ring-buffer log\n  ctx.find(sel)      — selector resolver (CSS, text=, ref=, role=)\n  ctx.click(sel) / ctx.clickAt(x,y)\n  ctx.type(sel,txt) / ctx.press(key) / ctx.hover(sel)\n  ctx.mouseMoveAt(x,y) / ctx.dragAt(x1,y1,x2,y2)\n  ctx.scroll({to|dy}) / ctx.scrollTo(sel,block)\n  ctx.text(sel) / ctx.html(sel) / ctx.exists(sel)\n  ctx.eval(code) — arbitrary JS\n  ctx.runtime() / ctx.now()\n  ctx.stop(reason)   — terminates the script\n\nReturn `"stop"` or `false` from the body to terminate. Errors are caught and counted (>20 → auto-stop). Multiple named scripts can run concurrently in one tab. Poll progress with browser_script_status, terminate with browser_stop_script.\n\nExample (Chrome dino auto-jumper):\n  source: `\n    const obstacle = document.querySelector(".obstacle");\n    if (obstacle && obstacle.getBoundingClientRect().left < 220) {\n      ctx.press("Space");\n      ctx.state.jumps = (ctx.state.jumps||0) + 1;\n      ctx.log("jump " + ctx.state.jumps);\n    }\n  `\n  intervalMs: 30',
      {
        tabId: z.string().optional(),
        name: z.string().describe('Unique script name (used to stop / poll status)'),
        source: z.string().describe('Function-body JS that uses `ctx.*` helpers. Runs every tick.'),
        intervalMs: z.number().default(100).describe('Tick interval in ms (0-2000). Lower = more responsive, higher CPU.'),
        useRaf: z.boolean().default(false).describe('Use requestAnimationFrame instead of setTimeout — ~60Hz, syncs with browser paint. Best for games.'),
      },
      async (args) => {
        try { const r = await browserCtl.browserExec('run_script', args, 10000); return { content: [{ type: 'text', text: browserToolText('Script started', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_run_script error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_update_script_state',
      'Push new values into a running bot\'s `ctx.state` object — the bot reads them on its next tick. Use this to steer a long-running bot from your strategic loop: screenshot → analyse → update targets → bot reacts at 60Hz against the new targets, no restart needed.\n\nExample (tell an aim-bot to track a new pixel coordinate):\n  { name: "aim-bot", patch: { targetX: 412, targetY: 280, fire: true } }\n\nThe patch is shallow-merged into ctx.state, so existing keys you do not mention are preserved.',
      {
        tabId: z.string().optional(),
        name: z.string().describe('Script name'),
        patch: z.record(z.any()).describe('Object to shallow-merge into the bot\'s ctx.state'),
      },
      async (args) => {
        try { const r = await browserCtl.browserExec('update_script_state', args, 5000); return { content: [{ type: 'text', text: browserToolText('State updated', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_update_script_state error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_stop_script',
      'Stop a running script by name. Returns final stats (ticks, errors, runtime, last 30 log lines, final state). Always call this when done so you can inspect what happened.',
      { tabId: z.string().optional(), name: z.string() },
      async (args) => {
        try { const r = await browserCtl.browserExec('stop_script', args, 5000); return { content: [{ type: 'text', text: browserToolText('Script stopped', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_stop_script error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_script_status',
      'Inspect a running script (or list all running scripts if `name` is omitted). Returns ticks, errors, runtime, current state object, and last 50 log lines.',
      { tabId: z.string().optional(), name: z.string().optional().describe('Script name; omit to list all') },
      async (args) => {
        try { const r = await browserCtl.browserExec('script_status', args, 5000); return { content: [{ type: 'text', text: browserToolText('Script status', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_script_status error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_sample',
      'Sample a JS expression at high frequency for `durationMs`, returning the full timeline. Use to record a fast-changing value (multiplier curve, score graph, position over time) for analysis. The sampling loop runs in-page so it captures values that change faster than IPC can poll.',
      {
        tabId: z.string().optional(),
        expression: z.string().describe('JS expression evaluated each tick.'),
        intervalMs: z.number().default(100).describe('Sample interval ms (20-500). Default 100ms.'),
        durationMs: z.number().default(3000).describe('Total sampling window ms (up to 30000).'),
      },
      async (args) => {
        try { const r = await browserCtl.browserExec('sample', args, (args.durationMs || 3000) + 4000); return { content: [{ type: 'text', text: browserToolText('Samples', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_sample error: ${e.message}` }], isError: true }; }
      }
    ),
    */
    /* ──────────────────── end RETIRED batch ──────────────────── */
    sdk.tool('browser_hover',
      'Hover the mouse over an element. Triggers mouseover/mouseenter/mousemove events — useful for revealing hover menus, tooltips, etc. Selector accepts CSS, [ref=eN], text="...", text=/regex/i, or sel:has-text("...").',
      { tabId: z.string().optional(), selector: z.string() },
      async (args) => {
        try { const r = await browserCtl.browserExec('hover', args, 10000); return { content: [{ type: 'text', text: browserToolText('Hover', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_hover error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_drag',
      'Drag an element from one selector onto another. Synthesizes mousedown / dragstart / dragenter / dragover / drop / dragend / mouseup events.',
      { tabId: z.string().optional(), from: z.string().describe('Source element selector'), to: z.string().describe('Drop-target selector') },
      async (args) => {
        try { const r = await browserCtl.browserExec('drag', args, 15000); return { content: [{ type: 'text', text: browserToolText('Drag', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_drag error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_scroll_to',
      'Scroll an element into view by selector. More precise than browser_scroll for SPA pages.',
      { tabId: z.string().optional(), selector: z.string(), block: z.enum(['start','center','end','nearest']).default('center').describe('Vertical alignment in viewport') },
      async (args) => {
        try { const r = await browserCtl.browserExec('scroll_to', args, 10000); return { content: [{ type: 'text', text: browserToolText('Scrolled to', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_scroll_to error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_upload',
      'Upload one or more files to a file input. Reads each file from disk in the IDE process, ships the bytes to the page, and constructs a real File object so the input fires input/change events normally.',
      {
        tabId: z.string().optional(),
        selector: z.string().describe('Selector for the <input type="file"> element'),
        files: z.array(z.object({
          path: z.string().describe('Absolute path on disk'),
          name: z.string().optional().describe('Override filename presented to the page (defaults to basename)'),
        })).describe('Files to upload'),
      },
      async (args) => {
        try { const r = await browserCtl.browserExec('upload', args, 30000); return { content: [{ type: 'text', text: browserToolText('Upload', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_upload error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_wait_load',
      'Wait for the page network to be idle (no in-flight loading) for `idleMs` consecutive ms, up to `timeoutMs`. Use after navigation or click on SPA links to make sure the new content has rendered before observing it.',
      { tabId: z.string().optional(), idleMs: z.number().default(500).describe('Consecutive idle ms required to consider the page settled'), timeoutMs: z.number().default(15000).describe('Hard timeout') },
      async (args) => {
        try { const r = await browserCtl.browserExec('wait_load', args, (args.timeoutMs || 15000) + 2000); return { content: [{ type: 'text', text: browserToolText('Load', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_wait_load error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_set_viewport',
      'Resize the browser tab to emulate a specific viewport (mobile, tablet, custom). The page sees the new innerWidth/innerHeight and triggers responsive layout. Call browser_reset_viewport to restore.',
      { tabId: z.string().optional(), width: z.number().min(320).max(3840), height: z.number().min(240).max(2160) },
      async (args) => {
        try { const r = await browserCtl.browserExec('set_viewport', args, 5000); return { content: [{ type: 'text', text: browserToolText('Viewport', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_set_viewport error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_reset_viewport',
      'Restore the browser tab to its natural responsive size after browser_set_viewport.',
      { tabId: z.string().optional() },
      async (args) => {
        try { const r = await browserCtl.browserExec('reset_viewport', args, 5000); return { content: [{ type: 'text', text: browserToolText('Viewport reset', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_reset_viewport error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_cookies_get',
      'Read the current page cookies (document.cookie string). For more advanced cookie manipulation (HTTP-only cookies, cross-origin), use browser_eval with the chrome.cookies API.',
      { tabId: z.string().optional() },
      async (args) => {
        try { const r = await browserCtl.browserExec('cookies_get', args, 5000); return { content: [{ type: 'text', text: browserToolText('Cookies', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_cookies_get error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_pdf',
      'Print the current page to PDF and save it to disk. Returns the saved path so you can Read it.',
      { tabId: z.string().optional(), name: z.string().optional().describe('Output base name (no extension)') },
      async (args) => {
        try {
          const r = await browserCtl.browserExec('pdf', args, 30000);
          if (r?.cancelled) return { content: [{ type: 'text', text: 'PDF save cancelled by user.' }] };
          if (r?.savePath) return { content: [{ type: 'text', text: `PDF saved to ${r.savePath}` }] };
          throw new Error(r?.error || 'unknown');
        } catch (e) { return { content: [{ type: 'text', text: `browser_pdf error: ${e.message}` }], isError: true }; }
      }
    ),

    // ── Storage tools (cookies + localStorage + sessionStorage) ──────
    sdk.tool('browser_cookies_set',
      'Set a non-HTTP-only cookie via document.cookie. For HttpOnly or cross-origin cookies, use browser_set_extra_headers with a Cookie header instead.',
      { tabId: z.string().optional(), name: z.string(), value: z.string().optional(), days: z.number().optional().describe('Lifetime in days; omit for session cookie') },
      async (args) => {
        try { const r = await browserCtl.browserExec('cookies_set', args, 5000); return { content: [{ type: 'text', text: browserToolText('Cookie set', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_cookies_set error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_cookies_clear',
      'Delete every cookie visible to document.cookie on the current page (does not touch HttpOnly cookies).',
      { tabId: z.string().optional() },
      async (args) => {
        try { const r = await browserCtl.browserExec('cookies_clear', args, 5000); return { content: [{ type: 'text', text: browserToolText('Cookies cleared', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_cookies_clear error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_storage_get',
      'Read a value from localStorage or sessionStorage. Omit `key` to dump the entire store (capped server-side).',
      { tabId: z.string().optional(), type: z.enum(['local', 'session']).default('local'), key: z.string().optional() },
      async (args) => {
        try { const r = await browserCtl.browserExec('storage_get', args, 5000); return { content: [{ type: 'text', text: browserToolText('Storage', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_storage_get error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_storage_set',
      'Write a string value into localStorage or sessionStorage. Useful for priming auth tokens before navigation.',
      { tabId: z.string().optional(), type: z.enum(['local', 'session']).default('local'), key: z.string(), value: z.string() },
      async (args) => {
        try { const r = await browserCtl.browserExec('storage_set', args, 5000); return { content: [{ type: 'text', text: browserToolText('Storage set', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_storage_set error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_storage_remove',
      'Delete a single key from localStorage or sessionStorage.',
      { tabId: z.string().optional(), type: z.enum(['local', 'session']).default('local'), key: z.string() },
      async (args) => {
        try { const r = await browserCtl.browserExec('storage_remove', args, 5000); return { content: [{ type: 'text', text: browserToolText('Storage remove', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_storage_remove error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_storage_clear',
      'Wipe localStorage or sessionStorage for the current origin.',
      { tabId: z.string().optional(), type: z.enum(['local', 'session']).default('local') },
      async (args) => {
        try { const r = await browserCtl.browserExec('storage_clear', args, 5000); return { content: [{ type: 'text', text: browserToolText('Storage cleared', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_storage_clear error: ${e.message}` }], isError: true }; }
      }
    ),

    // ── Semantic finders (return CSS selectors) ──────────────────────
    sdk.tool('browser_find_by_role',
      'Find elements by ARIA role (with implicit roles for native HTML — e.g. role="button" matches <button>). Returns up to `limit` matches with stable CSS selectors you can pass to browser_click / browser_type.',
      { tabId: z.string().optional(), role: z.string().describe('e.g. "button", "link", "textbox", "checkbox", "heading"'), name: z.string().optional().describe('Optional accessible-name substring filter (case-insensitive)'), limit: z.number().default(5) },
      async (args) => {
        try { const r = await browserCtl.browserExec('find_by_role', args, 5000); return { content: [{ type: 'text', text: browserToolText('Found', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_find_by_role error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_find_by_text',
      'Find visible elements whose textContent matches. Substring by default; pass exact:true for whole-string equality. Searches interactive + leaf elements (a, button, h*, label, li, span, p, etc.).',
      { tabId: z.string().optional(), text: z.string(), exact: z.boolean().default(false), limit: z.number().default(5) },
      async (args) => {
        try { const r = await browserCtl.browserExec('find_by_text', args, 5000); return { content: [{ type: 'text', text: browserToolText('Found', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_find_by_text error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_find_by_label',
      'Find form controls by their associated <label> text, aria-label, or placeholder. Returns the input/select/textarea selector — not the label itself.',
      { tabId: z.string().optional(), label: z.string(), limit: z.number().default(5) },
      async (args) => {
        try { const r = await browserCtl.browserExec('find_by_label', args, 5000); return { content: [{ type: 'text', text: browserToolText('Found', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_find_by_label error: ${e.message}` }], isError: true }; }
      }
    ),

    // ── HTTP request header override ─────────────────────────────────
    sdk.tool('browser_set_extra_headers',
      'Inject extra HTTP headers (Authorization, X-Test-User, Cookie, etc.) on every request from this tab. Persists until clear_extra_headers or tab close. Use sparingly — bad header values can break sites silently.',
      { tabId: z.string().optional(), headers: z.record(z.string(), z.string()).describe('Header name → value map') },
      async (args) => {
        try { const r = await browserCtl.browserExec('set_extra_headers', args, 5000); return { content: [{ type: 'text', text: browserToolText('Headers set', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_set_extra_headers error: ${e.message}` }], isError: true }; }
      }
    ),
    sdk.tool('browser_clear_extra_headers',
      'Remove any extra request headers previously set by browser_set_extra_headers on this tab.',
      { tabId: z.string().optional() },
      async (args) => {
        try { const r = await browserCtl.browserExec('clear_extra_headers', args, 5000); return { content: [{ type: 'text', text: browserToolText('Headers cleared', r) }] }; }
        catch (e) { return { content: [{ type: 'text', text: `browser_clear_extra_headers error: ${e.message}` }], isError: true }; }
      }
    ),

    // ── File downloads ───────────────────────────────────────────────
    sdk.tool('browser_wait_for_download',
      'Block until the next download finishes (or timeoutMs elapses) and return its saved path on disk. Pair with browser_click on a download link. Files land under the user\'s Downloads/PiPilot/ folder. Default cap is 5 minutes — large files / slow CDNs need real time.',
      { tabId: z.string().optional(), timeoutMs: z.number().default(300000).describe('Max wait in ms; default 5 minutes, hard cap 10 minutes.') },
      async (args) => {
        try {
          const cap = Math.max(2000, Math.min(600000, Number(args?.timeoutMs) || 300000));
          const r = await browserCtl.browserExec('wait_for_download', { ...args, timeoutMs: cap }, cap + 5000);
          if (r?.ok && r.savePath) return { content: [{ type: 'text', text: `Downloaded to ${r.savePath}` }] };
          return { content: [{ type: 'text', text: `Download did not complete (state=${r?.state || 'unknown'}).` }], isError: true };
        } catch (e) { return { content: [{ type: 'text', text: `browser_wait_for_download error: ${e.message}` }], isError: true }; }
      }
    ),

    // ──────────────────────────────────────────────────────────────
    // run_in_terminal — DISABLED for now.
    //
    // The agent-spawn UX corrupts the renderer's terminal panel
    // (existing user tabs disappear after the first agent run).
    // The Bash tool covers the same use cases without breaking
    // anything, so we keep that as the AI's only shell entrypoint
    // until the attach-existing-PTY flow is hardened.
    //
    // To re-enable: uncomment this block AND the matching pieces
    // in main/ipc-terminal.js, renderer/terminal.js, preload.js.
    //
    // sdk.tool('run_in_terminal', '...', { ... }, async (args) => { ... }),
    // ──────────────────────────────────────────────────────────────
  ];
}

module.exports = { buildIdeTools };
