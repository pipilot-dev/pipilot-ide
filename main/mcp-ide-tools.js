// PiPilot IDE — Local MCP server providing IDE-specific tools to the agent
// These match the Vite version's custom tools: diagnostics, project context,
// design guide, dev server control, and screenshot.

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const { CodeSearchIndex } = require('./search-index');

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
  const action = p?.action || 'read';
  const designPath = path.join(dir, '.pipilot', 'design.md');

  if (action === 'read') {
    try {
      if (fs.existsSync(designPath)) return { content: fs.readFileSync(designPath, 'utf8') };
      return { content: null, message: 'No design.md found. Use action "scan" to generate one from CSS/Tailwind.' };
    } catch (e) { return { error: e.message }; }
  }

  if (action === 'write') {
    try {
      fs.mkdirSync(path.dirname(designPath), { recursive: true });
      fs.writeFileSync(designPath, p.content || '', 'utf8');
      return { success: true, path: designPath };
    } catch (e) { return { error: e.message }; }
  }

  if (action === 'scan') {
    // Extract design tokens from CSS files
    const tokens = { colors: [], fonts: [], spacing: [] };
    const cssFiles = [];
    function findCSS(d) {
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
          if (e.isDirectory()) findCSS(path.join(d, e.name));
          else if (/\.(css|scss|less)$/.test(e.name)) cssFiles.push(path.join(d, e.name));
        }
      } catch {}
    }
    findCSS(dir);

    for (const f of cssFiles.slice(0, 10)) {
      try {
        const css = fs.readFileSync(f, 'utf8');
        // Extract CSS custom properties
        const varMatches = css.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+)/g);
        for (const m of varMatches) {
          if (/color|bg|text|border|accent/i.test(m[1])) tokens.colors.push(`--${m[1]}: ${m[2].trim()}`);
          else if (/font|family/i.test(m[1])) tokens.fonts.push(`--${m[1]}: ${m[2].trim()}`);
          else if (/space|gap|padding|margin|size/i.test(m[1])) tokens.spacing.push(`--${m[1]}: ${m[2].trim()}`);
        }
      } catch {}
    }

    // Check for Tailwind
    const hasTailwind = fs.existsSync(path.join(dir, 'tailwind.config.js')) || fs.existsSync(path.join(dir, 'tailwind.config.ts'));

    const content = `# Design System\n\n## Framework\n${hasTailwind ? 'Tailwind CSS' : 'Custom CSS'}\n\n## Colors\n${tokens.colors.slice(0, 30).map(c => `- \`${c}\``).join('\n') || 'No custom properties found'}\n\n## Typography\n${tokens.fonts.slice(0, 10).map(f => `- \`${f}\``).join('\n') || 'Default'}\n\n## Spacing\n${tokens.spacing.slice(0, 10).map(s => `- \`${s}\``).join('\n') || 'Default'}\n`;

    try {
      fs.mkdirSync(path.dirname(designPath), { recursive: true });
      fs.writeFileSync(designPath, content, 'utf8');
    } catch {}

    return { content, tokens, hasTailwind };
  }

  return { error: `Unknown action: ${action}` };
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
const ONECOMPILER_KEY = process.env.ONECOMPILER_API_KEY || '4e3cf87d-56c0-4dc2-88b4-c63c0a3ac6df';
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
  const { language, code, stdin, fileName } = params;
  if (!language || !code) return { error: 'language and code are required' };

  const fname = fileName || LANG_FILE_NAMES[language.toLowerCase()] || 'main';

  try {
    const resp = await fetch(ONECOMPILER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-apihub-key': ONECOMPILER_KEY,
        'x-apihub-host': ONECOMPILER_HOST,
        'x-apihub-endpoint': ONECOMPILER_ENDPOINT,
      },
      body: JSON.stringify({
        language: language.toLowerCase(),
        stdin: stdin || '',
        files: [{ name: fname, content: code }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { error: `OneCompiler API ${resp.status}: ${errText.slice(0, 300)}` };
    }

    const result = await resp.json();
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

function getToolDefinitions() {
  return [
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
      description: 'Manage the design system file at .pipilot/design.md. Use "read" to get current design tokens, "scan" to extract from CSS/Tailwind and generate, "write" to save a custom design spec. ALWAYS read this before doing any UI/frontend work.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'scan', 'write'], description: 'Action to perform' },
          content: { type: 'string', description: 'Content to write (only for "write" action)' },
        },
        required: ['action'],
      },
      handler: frontendDesignGuide,
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

module.exports = { setWorkDir, getToolDefinitions, getDiagnostics, getProjectContext, updateProjectContext, frontendDesignGuide, searchCodebase, screenshotPreview, generateImage, runCode, getSearchIndex, handleFileChange };
