// PiPilot IDE — Local MCP server providing IDE-specific tools to the agent
// These match the Vite version's custom tools: diagnostics, project context,
// design guide, dev server control, and screenshot.

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const { CodeSearchIndex } = require('./search-index');
// diff package available but we use search/replace blocks instead

// Shared state — set by the agent handler before each query
let currentWorkDir = '';
const searchIndexes = new Map(); // projectPath -> CodeSearchIndex

function setWorkDir(dir) { currentWorkDir = dir; }

function workDir() { return currentWorkDir || process.cwd(); }

// ── get_diagnostics ──
async function getDiagnostics(params) {
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const dir = workDir();
  const source = p?.source || 'all';
  const results = [];

  // TypeScript diagnostics via compiler API
  if (source === 'all' || source === 'typescript') {
    try {
      const hasTsConfig = fs.existsSync(path.join(dir, 'tsconfig.json'));
      const hasJsConfig = fs.existsSync(path.join(dir, 'jsconfig.json'));
      if (hasTsConfig || hasJsConfig) {
        let ts;
        try { ts = require(path.join(dir, 'node_modules', 'typescript')); } catch {}
        if (!ts) try { ts = require('typescript'); } catch {}
        if (ts) {
          const configFile = hasTsConfig ? 'tsconfig.json' : 'jsconfig.json';
          const configRead = ts.readConfigFile(path.join(dir, configFile), ts.sys.readFile);
          if (!configRead.error) {
            const parsed = ts.parseJsonConfigFileContent(configRead.config, ts.sys, dir, {}, path.join(dir, configFile));
            if (!parsed.errors.length) {
              const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
              const diags = ts.getPreEmitDiagnostics(program);
              for (const d of diags) {
                if (!d.file || d.start === undefined) continue;
                const pos = d.file.getLineAndCharacterOfPosition(d.start);
                let fp = d.file.fileName;
                if (path.isAbsolute(fp)) fp = path.relative(dir, fp).replace(/\\/g, '/');
                if (fp.includes('node_modules/')) continue;
                results.push({
                  file: fp, line: pos.line + 1, column: pos.character + 1,
                  severity: d.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
                  code: `TS${d.code}`,
                  message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
                  source: 'typescript',
                });
              }
            }
          }
        }
      }
    } catch (e) {
      results.push({ file: '', line: 0, column: 0, severity: 'info', code: '', message: `TypeScript check skipped: ${e.message}`, source: 'typescript' });
    }
  }

  // JSON validation
  if (source === 'all') {
    try {
      const jsonFiles = ['package.json', 'tsconfig.json', 'jsconfig.json'];
      for (const f of jsonFiles) {
        const fp = path.join(dir, f);
        if (!fs.existsSync(fp)) continue;
        try { JSON.parse(fs.readFileSync(fp, 'utf8')); }
        catch (e) {
          results.push({ file: f, line: 1, column: 1, severity: 'error', code: 'JSON', message: e.message, source: 'json' });
        }
      }
    } catch {}
  }

  const errors = results.filter(r => r.severity === 'error').length;
  const warnings = results.filter(r => r.severity === 'warning').length;

  return {
    diagnostics: results,
    summary: `${results.length} issue(s): ${errors} error(s), ${warnings} warning(s)`,
    counts: { total: results.length, errors, warnings },
  };
}

// ── get_working_directory ──
// Authoritative source of truth for the project root. Returns the exact
// absolute path (with native OS separators) plus a top-level file listing
// so the agent never has to guess paths or run `pwd && ls -la` first.
async function getWorkingDirectory() {
  const dir = workDir();
  const platform = process.platform;
  const sep = path.sep;
  const isWindows = platform === 'win32';
  const result = {
    path: dir,
    platform,
    isWindows,
    pathSeparator: sep,
    home: require('os').homedir(),
    exists: false,
    files: [],
    summary: '',
  };

  try {
    const stat = await fsp.stat(dir);
    if (stat.isDirectory()) {
      result.exists = true;
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      result.files = entries
        .filter(e => !e.name.startsWith('.') || ['.pipilot', '.claude', '.env'].includes(e.name))
        .slice(0, 50)
        .map(e => e.isDirectory() ? `${e.name}/` : e.name)
        .sort();
    }
  } catch {}

  // Friendly one-line summary the agent can quote back / reason against.
  result.summary = result.exists
    ? `Project root is "${dir}" on ${platform}. All file paths in tool calls MUST use this exact prefix (Windows uses backslashes; on Windows you can also use forward slashes — both work — but never invent /home/, /workspace/, /c/, /codepilot/, /tmp/, etc.). ${result.files.length} top-level entries.`
    : `Working directory "${dir}" does not exist on disk — open a project first.`;

  return result;
}

// ── project_context ──
async function getProjectContext(params) {
  const dir = workDir();
  const result = { framework: 'unknown', files: [], dependencies: {}, entryPoints: [], configFiles: [] };

  // Read package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    result.dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    result.name = pkg.name;
    result.scripts = pkg.scripts;

    // Detect framework
    const deps = Object.keys(result.dependencies);
    if (deps.includes('next')) result.framework = 'Next.js';
    else if (deps.includes('nuxt')) result.framework = 'Nuxt';
    else if (deps.includes('@sveltejs/kit')) result.framework = 'SvelteKit';
    else if (deps.includes('vite')) result.framework = 'Vite';
    else if (deps.includes('react')) result.framework = 'React';
    else if (deps.includes('vue')) result.framework = 'Vue';
    else if (deps.includes('express')) result.framework = 'Express';
    else if (deps.includes('fastify')) result.framework = 'Fastify';
  } catch {}

  // Scan config files
  const configCandidates = [
    'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs',
    'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js', '.eslintrc.json',
    'eslint.config.js', 'jest.config.js', 'vitest.config.ts', 'prisma/schema.prisma',
  ];
  for (const c of configCandidates) {
    if (fs.existsSync(path.join(dir, c))) result.configFiles.push(c);
  }

  // Entry points
  const entryFiles = ['src/index.ts', 'src/index.tsx', 'src/main.ts', 'src/main.tsx', 'src/App.tsx',
    'src/app.ts', 'index.ts', 'index.js', 'app.ts', 'app.js', 'server.ts', 'server.js'];
  for (const e of entryFiles) {
    if (fs.existsSync(path.join(dir, e))) result.entryPoints.push(e);
  }

  // File tree (shallow, max 200 files)
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo']);
  let fileCount = 0;
  function walk(d, rel) {
    if (fileCount > 200) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (fileCount > 200) return;
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(path.join(d, e.name), r); }
      else { result.files.push(r); fileCount++; }
    }
  }
  walk(dir, '');

  return result;
}

// ── frontend_design_guide ──
async function frontendDesignGuide(params) {
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const dir = workDir();
  const action = p?.action || 'scan';
  const designPath = path.join(dir, '.pipilot', 'design.md');

  // ── scan: read existing design system from .pipilot/design.md + extract CSS tokens ──
  if (action === 'scan') {
    let existing = null;
    try {
      if (fs.existsSync(designPath)) existing = fs.readFileSync(designPath, 'utf8');
    } catch {}

    // Found a real design system — return it verbatim. The agent
    // should READ this and follow it for any UI work; no further
    // action calls needed.
    if (existing) {
      return {
        content:
          `# Design system found\n\n` +
          `Path: ${designPath}\n\n` +
          `Use the rules below for any UI work in this project. Do NOT call \`load\` or \`write\` — the design system already exists.\n\n` +
          `---\n\n${existing}`,
      };
    }

    // No design.md. Don't dump random CSS-var sniffing here — those
    // tokens come from generic Tailwind / vendor stylesheets and the
    // agent would mistake them for a real design system. Tell it
    // exactly what to do next instead.
    const hasTailwind = fs.existsSync(path.join(dir, 'tailwind.config.js'))
      || fs.existsSync(path.join(dir, 'tailwind.config.ts'));
    return {
      content:
        `# No design system found\n\n` +
        `\`${designPath}\` does not exist yet. ` +
        (hasTailwind
          ? 'Tailwind is configured but no PiPilot design system has been authored. '
          : '') +
        `Create one before doing any UI work — bold, distinctive, intentional design starts here.\n\n` +
        `## Next steps (call this tool twice)\n\n` +
        `**Step 1 — load the design skill guide:**\n` +
        `\`\`\`json\n` +
        `{ "action": "load" }\n` +
        `\`\`\`\n` +
        `That returns the PiPilot Frontend Design Skill Guide (typography, color, motion, spatial-composition rules + a checklist of what to include).\n\n` +
        `**Step 2 — write a design system tailored to THIS project:**\n` +
        `\`\`\`json\n` +
        `{\n` +
        `  "action": "write",\n` +
        `  "content": "<your design system as a markdown document>"\n` +
        `}\n` +
        `\`\`\`\n` +
        `The \`content\` should be a complete markdown document covering:\n` +
        `  1. **Aesthetic direction & tone** (1 short paragraph — pick ONE bold direction)\n` +
        `  2. **Color palette** as CSS variables (\`--color-primary\`, \`--color-bg\`, \`--color-text\`, \`--color-accent\`, etc.)\n` +
        `  3. **Typography** — chosen display + body fonts, scale, weights\n` +
        `  4. **Spacing scale** (e.g. 4 / 8 / 16 / 24 / 32 / 48 / 64 px)\n` +
        `  5. **Component patterns** — buttons, cards, inputs, navigation\n` +
        `  6. **Animation approach** — which library, which moments\n\n` +
        `Then implement UI to that spec. Don't skip step 1 — the skill guide has critical "NEVER use" rules (no Inter / Roboto, no cliched purple gradients on white) that distinguish PiPilot output.`,
    };
  }

  // ── load: return the frontend design skill guide for the AI to follow ──
  if (action === 'load') {
    return { content: `# Frontend Design Skill Guide

## Design Thinking
Before coding, understand the context and commit to a BOLD aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick a strong direction: brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc.
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

CRITICAL: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality.

## Aesthetics Guidelines

**Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial, Inter, Roboto, system fonts. Pair a distinctive display font with a refined body font. NEVER converge on common choices (Space Grotesk, etc.) across designs.

**Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.

**Motion**: Use animations for effects and micro-interactions. CSS-only for HTML, Motion library for React. Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions.

**Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.

**Backgrounds & Visual Details**: Create atmosphere and depth — not solid colors. Gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, grain overlays.

## NEVER Use
- Overused fonts (Inter, Roboto, Arial, system fonts)
- Cliched purple gradients on white backgrounds
- Predictable layouts and cookie-cutter patterns
- Generic AI aesthetics — every design should feel unique

## How to Create a Design System
After reading this guide, create a design system for the project by calling this tool with action "write" and content containing:
1. Chosen aesthetic direction and tone
2. Color palette (CSS variables: --color-primary, --color-bg, --color-text, --color-accent, etc.)
3. Typography (font families, sizes, weights)
4. Spacing scale
5. Component patterns (buttons, cards, inputs, etc.)
6. Animation approach

Match implementation complexity to the vision. Maximalist = elaborate code with extensive animations. Minimalist = restraint, precision, careful spacing and typography.

## Assets
Use the \`generate_image\` tool to create real images for heroes, backgrounds, avatars, illustrations, and product photos. NEVER use placeholder images or generic stock photos — generate contextual, high-quality visuals that match your design direction.

Remember: PiPilot is capable of extraordinary creative work. Don't hold back — commit fully to a distinctive vision.` };
  }

  // ── write: save design system to .pipilot/design.md ──
  if (action === 'write') {
    try {
      fs.mkdirSync(path.dirname(designPath), { recursive: true });
      fs.writeFileSync(designPath, p.content || '', 'utf8');
      return { success: true, path: designPath };
    } catch (e) { return { error: e.message }; }
  }

  return { error: `Unknown action: ${action}. Use "scan", "load", or "write".` };
}

// ── update_project_context ──
async function updateProjectContext() {
  const ctx = await getProjectContext({});
  const dir = workDir();
  const mdPath = path.join(dir, '.pipilot', 'project.md');

  const content = `# Project Context\n\n## Name: ${ctx.name || path.basename(dir)}\n## Framework: ${ctx.framework}\n\n## Entry Points\n${ctx.entryPoints.map(e => `- ${e}`).join('\n') || 'None detected'}\n\n## Config Files\n${ctx.configFiles.map(c => `- ${c}`).join('\n') || 'None'}\n\n## Dependencies\n${Object.keys(ctx.dependencies || {}).slice(0, 30).map(d => `- ${d}`).join('\n') || 'None'}\n\n## File Structure (${ctx.files.length} files)\n${ctx.files.slice(0, 100).map(f => `- ${f}`).join('\n')}\n`;

  try {
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, content, 'utf8');
  } catch {}

  return { ...ctx, saved: mdPath };
}

// ── project_memory — persistent key/value notes across sessions ──
async function projectMemory(params) {
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const dir = workDir();
  const memDir = path.join(dir, '.pipilot', 'memory');
  const memFile = path.join(memDir, 'MEMORY.md');
  const action = p?.action || 'read';

  try { fs.mkdirSync(memDir, { recursive: true }); } catch {}

  function loadMemories() {
    try {
      if (!fs.existsSync(memFile)) return [];
      const raw = fs.readFileSync(memFile, 'utf8');
      const entries = [];
      const lines = raw.split('\n');
      for (const line of lines) {
        const m = line.match(/^- \*\*(.+?)\*\*: (.+)$/);
        if (m) entries.push({ key: m[1], value: m[2] });
      }
      return entries;
    } catch { return []; }
  }

  function saveMemories(entries) {
    const header = '# Project Memory\n\nPersistent notes saved by PiPilot Agent across sessions.\n\n';
    const body = entries.map(e => `- **${e.key}**: ${e.value}`).join('\n');
    fs.writeFileSync(memFile, header + body + '\n', 'utf8');
  }

  if (action === 'read') {
    const entries = loadMemories();
    if (entries.length === 0) return { memories: [], message: 'No memories saved yet. Use action "save" to store project notes.' };
    return { memories: entries, count: entries.length };
  }

  if (action === 'save') {
    const key = p?.key;
    const value = p?.value;
    if (!key || !value) return { error: 'Both "key" and "value" are required for save.' };
    const entries = loadMemories();
    const existing = entries.findIndex(e => e.key.toLowerCase() === key.toLowerCase());
    if (existing >= 0) {
      entries[existing].value = value;
    } else {
      entries.push({ key, value });
    }
    saveMemories(entries);
    return { success: true, action: existing >= 0 ? 'updated' : 'created', key, count: entries.length };
  }

  if (action === 'delete') {
    const key = p?.key;
    if (!key) return { error: '"key" is required for delete.' };
    const entries = loadMemories();
    const filtered = entries.filter(e => e.key.toLowerCase() !== key.toLowerCase());
    if (filtered.length === entries.length) return { error: `Memory "${key}" not found.` };
    saveMemories(filtered);
    return { success: true, deleted: key, count: filtered.length };
  }

  return { error: `Unknown action: ${action}. Use "read", "save", or "delete".` };
}

// ── dev_server_start/stop/status/logs (delegates to ipc-devserver) ──
// These are thin wrappers that will be wired to the actual dev server IPC

// ── search_codebase (matches Vite's powerful multi-mode search) ──
async function searchCodebase(params) {
  console.log('[search_codebase] raw params:', JSON.stringify(params));
  const dir = workDir();
  // Defensive: handle both direct args and wrapped args
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const query = p?.query || '';
  const mode = p?.mode || 'all';
  const filePattern = p?.filePattern || null;
  const maxResults = p?.maxResults || 20;
  const caseSensitive = !!p?.caseSensitive;
  const results = [];
  const SKIP = new Set(['node_modules', '.git', '.next', '.cache', 'dist', 'build', '.pipilot', 'coverage', '__pycache__', '.turbo']);
  const MAX_SIZE = 500 * 1024;

  function listFiles(d, base) {
    const out = [];
    try {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
          out.push(...listFiles(path.join(d, e.name), base ? `${base}/${e.name}` : e.name));
        } else if (e.isFile()) {
          const rel = base ? `${base}/${e.name}` : e.name;
          if (filePattern) {
            const pat = filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
            if (!new RegExp(pat, 'i').test(rel)) continue;
          }
          out.push(rel);
        }
      }
    } catch {}
    return out;
  }

  // Grep: exact/regex pattern matching
  if (mode === 'grep' || mode === 'all') {
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      let re;
      try { re = new RegExp(query, flags); } catch { re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags); }
      const files = listFiles(dir, '');
      let found = 0;
      for (const rel of files) {
        if (found >= maxResults) break;
        const abs = path.join(dir, rel);
        try {
          const stat = fs.statSync(abs);
          if (stat.size > MAX_SIZE) continue;
          const content = fs.readFileSync(abs, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && found < maxResults; i++) {
            if (re.test(lines[i])) {
              results.push({ type: 'grep', file: rel, line: i + 1, match: lines[i].trim().slice(0, 200), score: 10 });
              found++;
            }
            re.lastIndex = 0;
          }
        } catch {}
      }
    } catch {}
  }

  // Files: fuzzy file name search
  if (mode === 'files' || mode === 'all') {
    try {
      const allFiles = listFiles(dir, '');
      const q = query.toLowerCase();
      const scored = allFiles.map(f => {
        const name = path.basename(f).toLowerCase();
        const rel = f.toLowerCase();
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (name.includes(q)) score = 60;
        else if (rel.includes(q)) score = 40;
        else {
          let qi = 0;
          for (const c of rel) { if (c === q[qi]) qi++; if (qi >= q.length) break; }
          if (qi >= q.length) score = 20;
        }
        return { file: f, score };
      }).filter(f => f.score > 0).sort((a, b) => b.score - a.score).slice(0, maxResults);
      for (const f of scored) results.push({ type: 'file', file: f.file, match: path.basename(f.file), score: f.score });
    } catch {}
  }

  // Symbols: function/class/export/interface definitions
  if (mode === 'symbols' || mode === 'all') {
    try {
      const flags = caseSensitive ? '' : 'i';
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const defLineRe = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\*?|class|interface|type|enum|const|let|var|def|func|fn)\s+/;
      const queryRe = new RegExp(escaped, flags);
      const symRe = new RegExp(`(?:function\\*?|class|interface|type|enum|const|let|var|def|func|fn)\\s+${escaped}`, flags);
      const files = listFiles(dir, '');
      let found = 0;
      for (const rel of files) {
        if (found >= maxResults) break;
        const abs = path.join(dir, rel);
        try {
          const stat = fs.statSync(abs);
          if (stat.size > MAX_SIZE) continue;
          const content = fs.readFileSync(abs, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && found < maxResults; i++) {
            const line = lines[i];
            if ((defLineRe.test(line) && queryRe.test(line)) || symRe.test(line)) {
              const start = Math.max(0, i - 2);
              const end = Math.min(lines.length, i + 3);
              const context = lines.slice(start, end).map((l, j) => `${start + j + 1}: ${l}`).join('\n');
              results.push({ type: 'symbol', file: rel, line: i + 1, match: line.trim().slice(0, 200), context, score: 50 });
              found++;
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Semantic: BM25 relevance search (matches Vite's CodeSearchIndex)
  if (mode === 'semantic' || mode === 'all') {
    try {
      let index = searchIndexes.get(dir);
      if (!index) {
        index = new CodeSearchIndex(dir);
        searchIndexes.set(dir, index);
      }
      if (!index.getStats().ready) {
        await index.indexProject();
      }
      const semanticResults = index.search(query, maxResults);
      for (const sr of semanticResults) {
        results.push({
          type: 'semantic', file: sr.file, line: sr.startLine,
          match: sr.snippet.split('\n')[0]?.trim().slice(0, 200) || '',
          context: `Lines ${sr.startLine}-${sr.endLine}\n${sr.snippet}`,
          score: sr.score,
        });
      }
    } catch {}
  }

  // Dedupe and sort
  const seen = new Set();
  const deduped = results.sort((a, b) => b.score - a.score).filter(r => {
    const key = `${r.file}:${r.line || 0}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, maxResults);

  return { query, mode, count: deduped.length, results: deduped };
}

// ── screenshot_preview (matches Vite's screenshot tool) ──
let _chromePath = null;
function findChrome() {
  if (_chromePath) return _chromePath;
  const os = require('os');
  const paths = {
    win32: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
      path.join(os.homedir(), 'AppData/Local/Microsoft/Edge/Application/msedge.exe'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/microsoft-edge'],
  };
  for (const p of (paths[process.platform] || [])) {
    if (fs.existsSync(p)) { _chromePath = p; return p; }
  }
  return null;
}

let _browser = null;
async function screenshotPreview(params) {
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const url = p?.url;
  if (!url) return { error: 'URL is required. Start the dev server first.' };

  const chromePath = findChrome();
  if (!chromePath) return { error: 'Chrome/Edge not found. Install Google Chrome or Microsoft Edge.' };

  const puppeteer = require('puppeteer-core');
  const os = require('os');

  try {
    if (!_browser || !_browser.isConnected()) {
      _browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      });
    }

    const page = await _browser.newPage();
    await page.setViewport({ width: p?.width || 1440, height: p?.height || 900 });

    // Capture console logs
    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push({ level: msg.type(), text: msg.text() }));

    await page.goto(url, { waitUntil: 'networkidle2', timeout: p?.timeout || 20000 });

    // Take screenshot
    const tmpDir = path.join(os.tmpdir(), 'pipilot-screenshots');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `screenshot-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: false });

    const base64 = fs.readFileSync(filePath).toString('base64');
    const sizeKB = Math.round(fs.statSync(filePath).size / 1024);

    // DOM analysis
    const analysis = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map(h => `${h.tagName}: "${h.textContent?.trim().slice(0, 60)}"`);
      const buttons = [...document.querySelectorAll('button,a[role=button]')].map(b => b.textContent?.trim().slice(0, 30)).filter(Boolean);
      const inputs = [...document.querySelectorAll('input,textarea,select')].map(i => `${i.tagName.toLowerCase()}[${i.getAttribute('type') || i.getAttribute('name') || ''}]`);
      const images = document.querySelectorAll('img').length;
      return { title: document.title, headings, buttons: buttons.slice(0, 10), inputs: inputs.slice(0, 10), images };
    });

    await page.close();

    const report = [
      `=== UI Analysis ===`,
      `Title: ${analysis.title}`,
      analysis.headings.length ? `Headings: ${analysis.headings.join(', ')}` : '',
      analysis.buttons.length ? `Buttons: ${analysis.buttons.join(', ')}` : '',
      analysis.inputs.length ? `Inputs: ${analysis.inputs.join(', ')}` : '',
      `Images: ${analysis.images}`,
      consoleLogs.length ? `\nConsole (${consoleLogs.length}):\n${consoleLogs.slice(0, 10).map(l => `  [${l.level}] ${l.text}`).join('\n')}` : 'Console: clean',
    ].filter(Boolean).join('\n');

    return { filePath, base64, sizeKB, url, analysis: report, consoleLogs };
  } catch (err) {
    return { error: `Screenshot failed: ${err.message}` };
  }
}

// ── generate_image (matches Vite's a0.dev image generation) ──
async function generateImage(params) {
  const dir = workDir();
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const description = p?.description;
  if (!description) return { error: 'Description is required' };
  const aspect = p?.aspect || '16:9';

  try {
    const encodedDesc = encodeURIComponent(description);
    const imageUrl = `https://api.a0.dev/assets/image?text=${encodedDesc}&aspect=${aspect}`;

    const response = await fetch(imageUrl);
    if (!response.ok) return { error: `Image generation failed: HTTP ${response.status}` };

    const contentType = response.headers.get('content-type') || 'image/png';
    const ext = (contentType.includes('jpeg') || contentType.includes('jpg')) ? 'jpg' : 'png';

    const safeName = p?.fileName
      ? params.fileName.replace(/[^a-zA-Z0-9_-]/g, '-')
      : description.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const fileName = `${safeName}.${ext}`;

    const assetsDir = path.join(dir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const filePath = path.join(assetsDir, fileName);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const relPath = `assets/${fileName}`;
    const sizeKB = Math.round(buffer.length / 1024);

    return {
      path: relPath, filePath, sizeKB, aspect, description,
      usage: `<img src="${relPath}" alt="${description.slice(0, 80)}" />`,
    };
  } catch (err) {
    return { error: `Image generation error: ${err.message}` };
  }
}

// Export tool definitions for MCP registration
// ── run_code (OneCompiler API) ──
const ONECOMPILER_URL = 'https://OneCompiler-APIs.proxy-production.allthingsdev.co/api/v1/run';
const ONECOMPILER_KEYS = [
  process.env.ONECOMPILER_API_KEY,
  'Mkv8n2ggXBuRSIyBCeqGPS43F55PHHrXax3qRrIGIKl4EoBLtW',
  '4e3cf87d-56c0-4dc2-88b4-c63c0a3ac6df',
].filter(Boolean);
const ONECOMPILER_HOST = 'OneCompiler-APIs.allthingsdev.co';
const ONECOMPILER_ENDPOINT = '4e3cf87d-56c0-4dc2-88b4-c63c0a3ac6df';

const LANG_FILE_NAMES = {
  python: 'main.py', javascript: 'main.js', typescript: 'main.ts', java: 'Main.java',
  c: 'main.c', cpp: 'main.cpp', csharp: 'Main.cs', go: 'main.go', rust: 'main.rs',
  ruby: 'main.rb', php: 'main.php', kotlin: 'Main.kt', swift: 'main.swift',
  dart: 'main.dart', haskell: 'Main.hs', scala: 'Main.scala', r: 'main.r',
  lua: 'main.lua', perl: 'main.pl', bash: 'main.sh', groovy: 'main.groovy',
  elixir: 'main.exs', erlang: 'main.erl', clojure: 'main.clj', nim: 'main.nim',
  zig: 'main.zig', julia: 'main.jl', crystal: 'main.cr', ocaml: 'main.ml',
  fortran: 'main.f90', cobol: 'main.cob', pascal: 'main.pas', prolog: 'main.pl',
};

async function runCode(params) {
  console.log('[run_code] called:', params.language, 'code length:', (params.code || '').length);
  const { language, code, stdin, fileName } = params;
  if (!language || !code) return { error: 'language and code are required' };

  const fname = fileName || LANG_FILE_NAMES[language.toLowerCase()] || 'main';

  try {
    const body = JSON.stringify({
      language: language.toLowerCase(),
      stdin: stdin || '',
      files: [{ name: fname, content: code }],
    });

    let result = null;
    let lastError = '';
    for (const key of ONECOMPILER_KEYS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const resp = await fetch(ONECOMPILER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-apihub-key': key,
            'x-apihub-host': ONECOMPILER_HOST,
            'x-apihub-endpoint': ONECOMPILER_ENDPOINT,
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (resp.ok) {
          result = await resp.json();
          break;
        }
        lastError = 'HTTP ' + resp.status;
      } catch (e) {
        lastError = e.name === 'AbortError' ? 'Request timed out (30s)' : e.message;
      }
    }

    if (!result) {
      console.log('[run_code] all keys failed:', lastError);
      return { error: 'Code execution failed: ' + lastError };
    }
    console.log('[run_code] success:', result.status, 'stdout length:', (result.stdout || '').length);
    let output = '';
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? '\n--- stderr ---\n' : '') + result.stderr;
    if (result.exception) output += (output ? '\n--- exception ---\n' : '') + result.exception;
    if (!output.trim()) output = '(no output)';

    return {
      status: result.status || (result.exception ? 'error' : 'success'),
      output: output,
      compilationTime: result.compilationTime ? result.compilationTime + 'ms' : null,
      executionTime: result.executionTime ? result.executionTime + 'ms' : null,
      memoryUsed: result.memoryUsed ? Math.round(result.memoryUsed / 1024) + 'KB' : null,
    };
  } catch (err) {
    return { error: 'run_code failed: ' + err.message };
  }
}

// ── edit_file_patch — search/replace block editing (robust alternative to old_string/new_string) ──
// Uses <<<<<<< SEARCH / ======= / >>>>>>> REPLACE markers
// Supports multiple blocks in one call, regex mode, and replaceAll

function parseSearchReplaceBlocks(blockText) {
  const SEARCH_START = '<<<<<<< SEARCH';
  const DIVIDER = '=======';
  const REPLACE_END = '>>>>>>> REPLACE';
  const lines = blockText.split('\n');
  const blocks = [];
  let searchLines = [];
  let replaceLines = [];
  let mode = 'none';

  for (const line of lines) {
    if (line.trim() === SEARCH_START) {
      searchLines = [];
      replaceLines = [];
      mode = 'search';
    } else if (line.trim() === DIVIDER && mode === 'search') {
      mode = 'replace';
    } else if (line.trim() === REPLACE_END && mode === 'replace') {
      const hasContent = searchLines.some(l => l.trim() !== '') || replaceLines.some(l => l.trim() !== '');
      if (hasContent) blocks.push({ search: searchLines.join('\n'), replace: replaceLines.join('\n') });
      mode = 'none';
    } else if (mode === 'search') {
      searchLines.push(line);
    } else if (mode === 'replace') {
      replaceLines.push(line);
    }
  }
  return blocks;
}

// Fuzzy find: when exact match fails, find the closest matching region in the file
// Uses line-by-line similarity scoring to locate drifted code
function fuzzyFindInContent(content, searchText) {
  const searchLines = searchText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (searchLines.length === 0) return null;

  const contentLines = content.split('\n');
  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;

  // Slide a window of searchLines.length over contentLines
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matchCount = 0;
    for (let j = 0; j < searchLines.length; j++) {
      const contentTrimmed = contentLines[i + j].trim();
      const searchTrimmed = searchLines[j];
      // Exact line match (ignoring leading/trailing whitespace)
      if (contentTrimmed === searchTrimmed) {
        matchCount++;
      } else if (contentTrimmed.includes(searchTrimmed) || searchTrimmed.includes(contentTrimmed)) {
        matchCount += 0.5; // partial match
      }
    }
    const score = matchCount / searchLines.length;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
      bestEnd = i + searchLines.length;
    }
  }

  // Require at least 60% line match to consider it a fuzzy hit
  if (bestScore >= 0.6 && bestStart >= 0) {
    const matchedText = contentLines.slice(bestStart, bestEnd).join('\n');
    return { matchedText, startLine: bestStart, endLine: bestEnd, score: bestScore };
  }
  return null;
}

async function editFilePatch(params) {
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const filepath = p?.filepath;
  const searchReplaceBlock = p?.searchReplaceBlock;
  const useRegex = !!p?.useRegex;
  const replaceAll = !!p?.replaceAll;
  if (!filepath || !searchReplaceBlock) return { success: false, message: 'Both "filepath" and "searchReplaceBlock" are required.' };

  try {
    const dir = workDir();
    const absPath = path.isAbsolute(filepath) ? filepath : path.resolve(dir, filepath);

    let content;
    try {
      content = await fsp.readFile(absPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { success: false, message: `File not found: ${filepath}` };
      return { success: false, message: `Read error: ${err.message}` };
    }

    const editBlocks = parseSearchReplaceBlocks(searchReplaceBlock);
    if (editBlocks.length === 0) return { success: false, message: 'No valid search/replace blocks found. Use <<<<<<< SEARCH / ======= / >>>>>>> REPLACE markers.' };

    let newContent = content;
    const applied = [];
    const failed = [];

    for (const { search, replace } of editBlocks) {
      if (useRegex) {
        const flags = replaceAll ? 'g' : '';
        try {
          const regex = new RegExp(search, flags);
          if (regex.test(newContent)) {
            const count = replaceAll ? (newContent.match(regex) || []).length : 1;
            newContent = newContent.replace(regex, replace);
            applied.push({ search: search.slice(0, 60), occurrences: count });
          } else {
            failed.push({ search: search.slice(0, 60), reason: 'Regex pattern not found' });
          }
        } catch (e) {
          failed.push({ search: search.slice(0, 60), reason: `Invalid regex: ${e.message}` });
        }
      } else {
        // Try 1: Exact match
        if (newContent.includes(search)) {
          if (replaceAll) {
            const count = newContent.split(search).length - 1;
            newContent = newContent.split(search).join(replace);
            applied.push({ search: search.slice(0, 60), occurrences: count });
          } else {
            newContent = newContent.replace(search, replace);
            applied.push({ search: search.slice(0, 60), occurrences: 1 });
          }
        }
        // Try 2: Case-insensitive match
        else if (newContent.toLowerCase().includes(search.toLowerCase())) {
          const idx = newContent.toLowerCase().indexOf(search.toLowerCase());
          newContent = newContent.substring(0, idx) + replace + newContent.substring(idx + search.length);
          applied.push({ search: search.slice(0, 60), occurrences: 1, method: 'case-insensitive' });
        }
        // Try 3: Whitespace-normalized match (collapse spaces/tabs, ignore leading/trailing)
        else {
          const normalizeWS = s => s.split('\n').map(l => l.trim().replace(/\s+/g, ' ')).join('\n');
          const normSearch = normalizeWS(search);
          const normContent = normalizeWS(newContent);
          if (normContent.includes(normSearch)) {
            // Found with normalized whitespace — use fuzzy find to locate exact region
            const fuzzy = fuzzyFindInContent(newContent, search);
            if (fuzzy) {
              const lines = newContent.split('\n');
              const before = lines.slice(0, fuzzy.startLine).join('\n');
              const after = lines.slice(fuzzy.endLine).join('\n');
              newContent = before + (before ? '\n' : '') + replace + (after ? '\n' : '') + after;
              applied.push({ search: search.slice(0, 60), occurrences: 1, method: 'fuzzy', score: fuzzy.score });
            } else {
              failed.push({ search: search.slice(0, 60), reason: 'Fuzzy match failed' });
            }
          }
          // Try 4: Pure fuzzy line matching (last resort)
          else {
            const fuzzy = fuzzyFindInContent(newContent, search);
            if (fuzzy) {
              const lines = newContent.split('\n');
              const before = lines.slice(0, fuzzy.startLine).join('\n');
              const after = lines.slice(fuzzy.endLine).join('\n');
              newContent = before + (before ? '\n' : '') + replace + (after ? '\n' : '') + after;
              applied.push({ search: search.slice(0, 60), occurrences: 1, method: 'fuzzy', score: fuzzy.score });
            } else {
              failed.push({ search: search.slice(0, 60), reason: 'Not found (tried exact, case-insensitive, whitespace-normalized, and fuzzy)' });
            }
          }
        }
      }
    }

    if (applied.length === 0) {
      return { success: false, message: `All ${failed.length} edit(s) failed. Re-read the file to get current content.\n` + failed.map(f => `  - "${f.search}..." — ${f.reason}`).join('\n') };
    }

    // Write atomically
    const tempPath = absPath + '.tmp-' + Date.now();
    await fsp.writeFile(tempPath, newContent, 'utf8');
    await fsp.rename(tempPath, absPath);

    let msg = `Edited ${filepath}: ${applied.length} block(s) applied`;
    if (failed.length > 0) msg += `, ${failed.length} failed`;
    const methods = applied.filter(a => a.method).map(a => a.method);
    if (methods.length > 0) msg += ` (used: ${[...new Set(methods)].join(', ')})`;
    return { success: true, message: msg, applied: applied.length, failed: failed.length };
  } catch (err) {
    return { success: false, message: `Edit error: ${err.message}` };
  }
}

// ── fetch_url — readable web content via Jina Reader API ──
async function fetchUrl(params) {
  const p = (params?.input && typeof params.input === 'object') ? params.input : params;
  const url = p?.url;
  if (!url) return { error: 'URL is required.' };

  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const resp = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'text',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { error: `Jina Reader returned HTTP ${resp.status} for ${url}` };
    }

    let content = await resp.text();
    // Truncate to avoid context bloat
    const MAX_CHARS = 15000;
    const truncated = content.length > MAX_CHARS;
    if (truncated) content = content.slice(0, MAX_CHARS) + '\n\n... (truncated — ' + content.length + ' chars total)';

    return { url, content, chars: content.length, truncated };
  } catch (err) {
    if (err.name === 'AbortError') return { error: `Fetch timed out (60s) for ${url}` };
    return { error: `Fetch failed: ${err.message}` };
  }
}

function getToolDefinitions() {
  return [
    {
      name: 'get_working_directory',
      description: 'Return the absolute path of the current project root, the OS, the path separator, and a top-level file listing. ALWAYS call this FIRST on every task — never guess paths and never run `pwd && ls -la` for orientation. Cheaper, faster, and 100% authoritative.',
      inputSchema: { type: 'object', properties: {} },
      handler: getWorkingDirectory,
    },
    {
      name: 'get_diagnostics',
      description: 'Run the IDE diagnostics engine on the current project and return all errors, warnings, and info messages. Use after making changes to verify correctness.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['all', 'typescript', 'json'], default: 'all', description: 'Which checker to run' },
        },
      },
      handler: getDiagnostics,
    },
    {
      name: 'project_context',
      description: 'Scan project structure and return framework, dependencies, entry points, config files, and file tree. Use at the start of any task to understand the codebase.',
      inputSchema: {
        type: 'object',
        properties: {
          includeDetails: { type: 'boolean', default: true },
        },
      },
      handler: getProjectContext,
    },
    {
      name: 'update_project_context',
      description: 'Scan project structure and write/update .pipilot/project.md with framework info, dependencies, entry points, and file tree.',
      inputSchema: { type: 'object', properties: {} },
      handler: updateProjectContext,
    },
    {
      name: 'frontend_design_guide',
      description: 'Manage the project design system. Actions: "scan" — check existing .pipilot/design.md + extract CSS tokens; "load" — get the frontend design skill guide with aesthetics rules; "write" — save a design system to .pipilot/design.md. Workflow: scan first, if no design system exists call load to get the guide, then write your design system.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['scan', 'load', 'write'], description: 'Action: scan (check existing), load (get design skill guide), write (save design system)' },
          content: { type: 'string', description: 'Design system content to write (only for "write" action)' },
        },
        required: ['action'],
      },
      handler: frontendDesignGuide,
    },
    {
      name: 'project_memory',
      description: 'Persistent project memory — save, read, or delete key/value notes that persist across sessions. Use to remember project decisions, architecture choices, user preferences, tech stack details, or anything the agent should recall in future conversations.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'save', 'delete'], description: 'Action: "read" all memories, "save" a key/value pair, "delete" a key' },
          key: { type: 'string', description: 'Memory key (required for save/delete). E.g. "auth_system", "db_choice", "user_preference"' },
          value: { type: 'string', description: 'Memory value (required for save). E.g. "JWT with refresh tokens via Prisma"' },
        },
        required: ['action'],
      },
      handler: projectMemory,
    },
    {
      name: 'search_codebase',
      description: 'Smart codebase search — combines regex grep, fuzzy file name matching, symbol/definition search, and BM25 semantic search in one tool call. Use this instead of multiple Grep/Glob calls. Modes: "grep" for exact/regex matching, "files" for fuzzy file name search, "symbols" for function/class/export definitions, "semantic" for natural language queries (e.g. "how does authentication work?"), "all" to run all four.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — regex pattern, file name, symbol name, or natural language description' },
          mode: { type: 'string', enum: ['grep', 'files', 'symbols', 'semantic', 'all'], description: 'Search mode' },
          filePattern: { type: 'string', description: 'Optional glob to filter files (e.g. "*.tsx", "src/**/*.ts")' },
          maxResults: { type: 'number', description: 'Max results to return (default 20)' },
          caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default false)' },
        },
        required: ['query'],
      },
      handler: searchCodebase,
    },
    {
      name: 'screenshot_preview',
      description: 'Capture a screenshot of the project\'s running dev server or any URL using headless Chrome. Returns a PNG image + DOM analysis (headings, buttons, inputs, console logs). The dev server must be running first.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to screenshot (e.g. http://localhost:5173)' },
          width: { type: 'number', description: 'Viewport width (default 1440)' },
          height: { type: 'number', description: 'Viewport height (default 900)' },
        },
        required: ['url'],
      },
      handler: screenshotPreview,
    },
    {
      name: 'generate_image',
      description: 'Generate an image from a text description using AI. Saves to the project\'s assets/ folder and returns the relative path. Use for hero images, backgrounds, avatars, product photos, illustrations — any visual content the project needs.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Vivid, specific description of the image to generate' },
          aspect: { type: 'string', enum: ['16:9', '1:1', '9:16'], description: 'Aspect ratio: 16:9 (landscape), 1:1 (square), 9:16 (portrait)' },
          fileName: { type: 'string', description: 'Output file name without extension (auto-generated if not provided)' },
        },
        required: ['description'],
      },
      handler: generateImage,
    },
    {
      name: 'run_code',
      description: 'Compile and run code in 60+ programming languages online using OneCompiler API. Use this to test code snippets, verify logic, run scripts in any language (Python, Java, C, C++, Go, Rust, JavaScript, TypeScript, Ruby, PHP, Haskell, Kotlin, Swift, Dart, and many more). Returns stdout, stderr, compilation time, execution time, and memory used.',
      inputSchema: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Programming language ID (e.g. "python", "javascript", "java", "c", "cpp", "go", "rust", "typescript", "ruby", "php", "kotlin", "swift", "dart", "haskell", "scala", "r", "lua", "perl", "bash", "csharp", "assembly", "groovy", "prolog", "elixir", "erlang", "fortran", "cobol", "ocaml", "clojure", "nim", "zig", "julia", "crystal", "deno", "bun")' },
          code: { type: 'string', description: 'Source code to compile and run' },
          stdin: { type: 'string', description: 'Standard input to pass to the program (optional)' },
          fileName: { type: 'string', description: 'File name (optional, auto-generated based on language)' },
        },
        required: ['language', 'code'],
      },
      handler: runCode,
    },
    {
      name: 'edit_file_patch',
      description: 'Edit a file using search/replace blocks. Supports multiple edits in one call. Use when the built-in Edit tool fails. Format: <<<<<<< SEARCH\\nold code\\n=======\\nnew code\\n>>>>>>> REPLACE',
      inputSchema: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Path to file (relative or absolute)' },
          searchReplaceBlock: { type: 'string', description: 'One or more search/replace blocks using markers:\\n<<<<<<< SEARCH\\ncode to find\\n=======\\nreplacement code\\n>>>>>>> REPLACE' },
          useRegex: { type: 'boolean', description: 'Treat search as regex pattern (default false)' },
          replaceAll: { type: 'boolean', description: 'Replace all occurrences (default false)' },
        },
        required: ['filepath', 'searchReplaceBlock'],
      },
      handler: editFilePatch,
    },
    {
      name: 'fetch_url',
      description: 'Fetch any URL and return clean, readable text content (HTML stripped, markdown formatted). Uses Jina Reader API. Use as fallback when WebFetch fails, or to read documentation pages, blog posts, API docs, GitHub READMEs, Stack Overflow answers, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to fetch (e.g. "https://docs.example.com/api")' },
        },
        required: ['url'],
      },
      handler: fetchUrl,
    },
  ];
}

// Get or create search index for a project (exposed for live update wiring)
function getSearchIndex(projectPath) {
  if (!projectPath) return null;
  let index = searchIndexes.get(projectPath);
  if (!index) {
    index = new CodeSearchIndex(projectPath);
    searchIndexes.set(projectPath, index);
  }
  return index;
}

// Handle a file change event from the chokidar watcher
function handleFileChange(projectPath, evt) {
  if (!evt || !evt.path || !projectPath) return;
  const index = searchIndexes.get(projectPath);
  if (!index || !index._ready) return;
  if (evt.type === 'change' || evt.type === 'add') {
    index.indexFile(evt.path);
  } else if (evt.type === 'unlink') {
    index.removeFile(evt.path);
  }
}

module.exports = { setWorkDir, workDir, getToolDefinitions, getWorkingDirectory, getDiagnostics, getProjectContext, updateProjectContext, frontendDesignGuide, projectMemory, searchCodebase, screenshotPreview, generateImage, runCode, editFilePatch, fetchUrl, getSearchIndex, handleFileChange };
