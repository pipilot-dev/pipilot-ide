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

module.exports = { buildIdeTools };
