// PiPilot IDE — Symbol resolver for the docs hover/generation service
//
// Given a symbol name and the current file's text, resolves what that
// symbol actually IS so the AI gets to see the real declaration instead
// of just the call site. Three resolution paths:
//
//   1. LOCAL  — the symbol is declared somewhere in the current file
//               (function, class, interface, type, enum, const/let/var).
//   2. RELATIVE IMPORT — the symbol is imported via `./foo`, `../foo`.
//                Resolve the path with extension fallbacks
//                (.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts) and index files,
//                read the file, find the matching `export`, slice it.
//   3. BARE PACKAGE — the symbol is from `react`, `lodash`, etc.
//                Look up node_modules/<pkg>/package.json → `types`/`main`,
//                read that file, find the export. Bounded slice.
//
// Output: a single best definition slice + source path + line number, or
// null if nothing was found. The hover service stitches it into the AI
// context as a "## Definition" section so the model can see what the
// symbol actually is rather than guessing from usage.
//
// Cache: in-memory keyed by (symbol, filePath) for 5 minutes. Imports
// rarely change during a session, so this is mostly free after first hit.
//
// Scope: deliberately bounded. Won't follow re-export chains beyond one
// hop, won't parse tsconfig path aliases (TODO), won't do generics or
// type checking. The AI handles the cleverness; the resolver only feeds
// it the right text.

(function () {
  'use strict';
  if (window.__pipilotDocsResolverLoaded) return;
  window.__pipilotDocsResolverLoaded = true;

  const api = window.electronAPI;
  if (!api?.files?.read) {
    console.warn('[docs/resolver] api.files unavailable');
    return;
  }

  // ── Path utilities (browser-side, OS-agnostic) ────────────────────
  function dirname(p) {
    if (!p) return '';
    const norm = String(p).replace(/\\/g, '/');
    const idx = norm.lastIndexOf('/');
    return idx >= 0 ? norm.slice(0, idx) : '';
  }
  function joinPath(...parts) {
    const joined = parts.map(p => String(p || '').replace(/\\/g, '/')).join('/');
    const segments = joined.split('/').filter((s, i) => s !== '' || i === 0);
    const out = [];
    for (const s of segments) {
      if (s === '' || s === '.') continue;
      if (s === '..') { out.pop(); continue; }
      out.push(s);
    }
    let prefix = '';
    if (/^[A-Za-z]:$/.test(segments[0])) prefix = segments[0] + '/';
    else if (joined.startsWith('/')) prefix = '/';
    return prefix + out.filter(Boolean).join('/');
  }

  // Walk upward from `start` looking for a directory matching `name`.
  // Used to find node_modules / package roots.
  async function findUp(name, fromDir, maxHops = 10) {
    let d = fromDir;
    for (let i = 0; i < maxHops && d; i++) {
      const candidate = joinPath(d, name);
      if (await fileExists(candidate, true)) return candidate;
      const parent = dirname(d);
      if (!parent || parent === d) break;
      d = parent;
    }
    return null;
  }

  async function fileExists(absPath, asDir = false) {
    try {
      const r = await api.files.stat(absPath);
      if (!r || !r.exists) return false;
      return asDir ? !!r.isDir : !r.isDir;
    } catch { return false; }
  }
  async function readFileSafe(absPath) {
    try {
      const r = await api.files.read(absPath);
      if (!r) return null;
      if (typeof r === 'string') return r;
      if (r.content) return r.content;
      return null;
    } catch { return null; }
  }

  const SOURCE_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

  // Resolve `./foo` against fromDir → absolute path of an existing source file.
  async function resolveRelative(importStr, fromDir) {
    if (!fromDir) return null;
    const base = joinPath(fromDir, importStr);
    // 1. Direct extension match
    for (const ext of SOURCE_EXTS) {
      const candidate = base + ext;
      if (await fileExists(candidate)) return candidate;
    }
    // 2. <base>/index.<ext>
    for (const ext of SOURCE_EXTS) {
      const candidate = joinPath(base, 'index' + ext);
      if (await fileExists(candidate)) return candidate;
    }
    return null;
  }

  // ── package.json `exports` field resolution ──────────────────────
  // Modern npm packages use the `exports` field for fine-grained module
  // resolution with condition keys (`types`, `import`, `require`, etc.).
  // For a documentation-focused IDE we ALWAYS prefer `types` so hover
  // shows the type-annotated `.d.ts` instead of the minified JS bundle.
  const CONDITION_PRIORITY = ['types', 'typings', 'import', 'module', 'require', 'default', 'node', 'browser'];

  function resolveConditionalValue(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      for (const v of value) {
        const r = resolveConditionalValue(v);
        if (r) return r;
      }
      return null;
    }
    if (typeof value === 'object') {
      for (const cond of CONDITION_PRIORITY) {
        if (cond in value) {
          const r = resolveConditionalValue(value[cond]);
          if (r) return r;
        }
      }
      // Unknown condition map — take first value as last resort.
      for (const k of Object.keys(value)) {
        const r = resolveConditionalValue(value[k]);
        if (r) return r;
      }
    }
    return null;
  }

  // exportsField may be a string, an array, or an object that's either a
  // pure condition map (root export) or a subpath map (`{ "./foo": ... }`).
  // Returns a relative path inside the package, or null.
  function resolveExportsField(exportsField, subpath) {
    if (exportsField == null) return null;
    if (typeof exportsField === 'string') {
      return subpath === '.' ? exportsField : null;
    }
    if (Array.isArray(exportsField)) {
      return resolveConditionalValue(exportsField);
    }
    const keys = Object.keys(exportsField);
    const isSubpathMap = keys.some(k => k.startsWith('.'));
    if (!isSubpathMap) {
      // Conditional map applies to the root export only.
      return subpath === '.' ? resolveConditionalValue(exportsField) : null;
    }
    // Exact subpath match
    if (exportsField[subpath] !== undefined) {
      return resolveConditionalValue(exportsField[subpath]);
    }
    // Wildcard match — `./icons/*` matches `./icons/arrow-right`.
    let bestKey = null;
    let bestPrefix = '';
    for (const key of keys) {
      if (!key.endsWith('/*') && !key.endsWith('*')) continue;
      const prefix = key.replace(/\*$/, '').replace(/\/$/, '');
      if (subpath === prefix || subpath.startsWith(prefix + '/')) {
        if (prefix.length > bestPrefix.length) {
          bestPrefix = prefix;
          bestKey = key;
        }
      }
    }
    if (bestKey) {
      const tail = subpath === bestPrefix ? '' : subpath.slice(bestPrefix.length + 1);
      const target = resolveConditionalValue(exportsField[bestKey]);
      if (!target) return null;
      // Substitute `*` with the captured tail. If no `*`, append the tail.
      if (target.includes('*')) return target.replace(/\*/g, tail);
      return tail ? joinPath(target, tail) : target;
    }
    return null;
  }

  // Cache parsed package.json blobs — they don't change during a session.
  const pkgJsonCache = new Map();
  async function readPkgJson(pkgRoot) {
    if (pkgJsonCache.has(pkgRoot)) return pkgJsonCache.get(pkgRoot);
    const text = await readFileSafe(joinPath(pkgRoot, 'package.json'));
    let parsed = null;
    if (text) { try { parsed = JSON.parse(text); } catch {} }
    pkgJsonCache.set(pkgRoot, parsed);
    return parsed;
  }

  // For a package without its own type declarations, look up the
  // companion `@types/<pkg>` package (DefinitelyTyped). Scoped packages
  // map by convention: `@scope/foo` → `@types/scope__foo`.
  async function resolveTypesPackage(pkgName, fromDir) {
    let typesName;
    if (pkgName.startsWith('@')) {
      const [scope, name] = pkgName.split('/');
      if (!name) return null;
      typesName = '@types/' + scope.slice(1) + '__' + name;
    } else {
      typesName = '@types/' + pkgName.split('/')[0];
    }
    const nm = await findUp('node_modules', fromDir);
    if (!nm) return null;
    const root = joinPath(nm, typesName);
    if (!(await fileExists(root, true))) return null;
    // @types packages have index.d.ts at root by convention.
    for (const file of ['index.d.ts', 'index.ts']) {
      const c = joinPath(root, file);
      if (await fileExists(c)) return c;
    }
    return null;
  }

  // Resolve `react-router-dom` (or `lucide-react/icons/arrow-right`) → an
  // absolute path inside node_modules. Strategy:
  //   1. Check the package's `exports` field (modern, condition-aware).
  //   2. Fall back to legacy `types`/`typings`/`module`/`main` fields.
  //   3. Fall back to `index.<ext>` in the package or sub-path directory.
  //   4. If none of the above yield a TYPE-bearing file, look for a
  //      DefinitelyTyped companion at `@types/<pkg>`.
  async function resolvePackage(pkgName, fromDir) {
    // Split scoped/nested specifiers
    let pkg, sub;
    const segs = pkgName.split('/');
    if (pkgName.startsWith('@')) {
      pkg = segs.slice(0, 2).join('/');
      sub = segs.slice(2).join('/');
    } else {
      pkg = segs[0];
      sub = segs.slice(1).join('/');
    }
    const nm = await findUp('node_modules', fromDir);
    if (!nm) return null;
    const pkgRoot = joinPath(nm, pkg);
    if (!(await fileExists(pkgRoot, true))) {
      // Package missing — try @types/<pkg> directly
      return await resolveTypesPackage(pkgName, fromDir);
    }
    const pkgJson = await readPkgJson(pkgRoot);

    // 1) Modern `exports` field — preferred. Always evaluated with the
    // `types` condition first so we land on .d.ts when possible.
    if (pkgJson?.exports) {
      const subpath = sub ? './' + sub : '.';
      const target = resolveExportsField(pkgJson.exports, subpath);
      if (target) {
        const candidate = joinPath(pkgRoot, target);
        if (await fileExists(candidate)) return candidate;
        for (const ext of SOURCE_EXTS) {
          if (await fileExists(candidate + ext)) return candidate + ext;
        }
      }
    }

    // 2) Sub-path direct file (legacy resolution)
    if (sub) {
      for (const ext of SOURCE_EXTS) {
        const c = joinPath(pkgRoot, sub) + ext;
        if (await fileExists(c)) return c;
      }
      for (const ext of SOURCE_EXTS) {
        const c = joinPath(pkgRoot, sub, 'index' + ext);
        if (await fileExists(c)) return c;
      }
    }

    // 3) Legacy package.json fields, still preferring types-bearing ones.
    if (pkgJson) {
      const candidates = [
        pkgJson.types, pkgJson.typings,
        // typesVersions is for TS-version-specific overrides; just take *
        pkgJson.typesVersions?.['*']?.['*']?.[0],
        pkgJson.module, pkgJson.main,
        'index.d.ts', 'index.ts', 'index.js',
      ].filter(Boolean);
      for (const c of candidates) {
        const candidate = joinPath(pkgRoot, c);
        if (await fileExists(candidate)) return candidate;
        for (const ext of SOURCE_EXTS) {
          if (await fileExists(candidate + ext)) return candidate + ext;
        }
      }
    }

    // 4) Bare index files in the package root.
    for (const ext of SOURCE_EXTS) {
      const c = joinPath(pkgRoot, 'index' + ext);
      if (await fileExists(c)) return c;
    }

    // 5) Last resort — DefinitelyTyped companion package.
    return await resolveTypesPackage(pkgName, fromDir);
  }

  // ── Symbol scanning (regex-based, light AST-ish) ──────────────────
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function findLocalDeclaration(text, symbol) {
    const sym = escRe(symbol);
    const patterns = [
      new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s*${sym}\\b`),
      new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:var|let|const)\\s+${sym}\\b`),
      new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+(?:default\\s+)?)?(?:abstract\\s+)?class\\s+${sym}\\b`),
      new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?interface\\s+${sym}\\b`),
      new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?type\\s+${sym}\\b`),
      new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?enum\\s+${sym}\\b`),
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) return m.index + (m[0].startsWith('\n') ? 1 : 0);
    }
    return -1;
  }

  function findExportInFile(text, symbol) {
    const sym = escRe(symbol);
    const patterns = [
      new RegExp(`(?:^|\\n)[ \\t]*export\\s+(?:async\\s+)?(?:var|let|const)\\s+${sym}\\b`),
      new RegExp(`(?:^|\\n)[ \\t]*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|interface|type|enum)\\s+${sym}\\b`),
      // re-export: `export { Symbol }` (best-effort — not following the chain)
      new RegExp(`(?:^|\\n)[ \\t]*export\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}`),
      // declared then exported separately: `export { Symbol as ... }` or just declared — fall through
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) return m.index + (m[0].startsWith('\n') ? 1 : 0);
    }
    return findLocalDeclaration(text, symbol);
  }

  function findDefaultExport(text) {
    // export default function|class NAME → resolve NAME
    let m = /export\s+default\s+(?:async\s+)?(?:function\s*\*?|class)\s+(\w+)/.exec(text);
    if (m) return findLocalDeclaration(text, m[1]) || m.index;
    // export default <Identifier>
    m = /export\s+default\s+(\w+)\s*;?\s*$/m.exec(text);
    if (m) return findLocalDeclaration(text, m[1]) || m.index;
    // export default <expression> — return the line itself
    m = /(?:^|\n)[ \t]*export\s+default\s/.exec(text);
    if (m) return m.index + (m[0].startsWith('\n') ? 1 : 0);
    return -1;
  }

  function findImportPath(text, symbol) {
    const sym = escRe(symbol);
    let m;
    // import { …, SYMBOL, … } from '...'
    m = new RegExp(`import\\s*\\{[^}]*\\b${sym}\\b(?:\\s+as\\s+\\w+)?[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`).exec(text);
    if (m) return { path: m[1], kind: 'named' };
    // import SYMBOL, { … } from '...'  OR  import SYMBOL from '...'
    m = new RegExp(`import\\s+${sym}(?:\\s*,\\s*\\{[^}]*\\})?\\s*from\\s*['"]([^'"]+)['"]`).exec(text);
    if (m) return { path: m[1], kind: 'default' };
    // import Default, { …, SYMBOL, … } from '...'
    m = new RegExp(`import\\s+\\w+\\s*,\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`).exec(text);
    if (m) return { path: m[1], kind: 'named' };
    // import * as SYMBOL from '...'
    m = new RegExp(`import\\s*\\*\\s+as\\s+${sym}\\s+from\\s*['"]([^'"]+)['"]`).exec(text);
    if (m) return { path: m[1], kind: 'namespace' };
    return null;
  }

  // Walk backward from `fromIdx` to include any preceding documentation
  // comment (`/** ... */`, `///`, `# `, `--`). This matters a lot —
  // without it, hovering an import like `ArrowRight` from `lucide-react`
  // would slice only the export line, dropping the `@component @preview
  // @description …` block above it. With this, the AI sees the real docs.
  function expandLeadingDocComment(text, fromIdx) {
    if (fromIdx <= 0) return fromIdx;
    let i = fromIdx;
    // Skip a single blank line between comment and declaration
    while (i > 0 && text[i - 1] === '\n') i--;
    if (i <= 0) return fromIdx;
    // Look for end of `/* ... */` block
    const upto = text.slice(0, i);
    const blockEnd = upto.lastIndexOf('*/');
    if (blockEnd >= 0) {
      const blockStart = text.lastIndexOf('/*', blockEnd);
      if (blockStart >= 0) {
        // Only include if block is immediately above (no other code between)
        const between = text.slice(blockEnd + 2, i).trim();
        if (between === '') {
          // Find start-of-line for the comment opener
          let s = blockStart;
          while (s > 0 && text[s - 1] !== '\n') s--;
          return s;
        }
      }
    }
    // Line-comment styles (//, ///, #, --, #')
    const lines = upto.split('\n');
    let lineIdx = lines.length - 1;
    // skip the trailing blank
    if (lines[lineIdx] === '') lineIdx--;
    const COMMENT_RE = /^\s*(\/\/\/?|#'?|--|;;)/;
    if (lineIdx < 0 || !COMMENT_RE.test(lines[lineIdx])) return fromIdx;
    while (lineIdx >= 0 && COMMENT_RE.test(lines[lineIdx])) lineIdx--;
    // lineIdx is now BEFORE the first comment line
    const charsBefore = lines.slice(0, lineIdx + 1).reduce((sum, l) => sum + l.length + 1, 0);
    return charsBefore;
  }

  // Slice a declaration starting at byte offset `fromIdx`. Walks forward
  // tracking brace depth so we stop at the end of the block, capped at
  // `maxLines` so a giant class doesn't blow up the prompt.
  function extractDeclaration(text, fromIdx, maxLines = 80) {
    if (fromIdx < 0) return null;
    // Pull in preceding doc comment so JSDoc tags ride along.
    fromIdx = expandLeadingDocComment(text, fromIdx);
    while (fromIdx > 0 && text[fromIdx - 1] !== '\n') fromIdx--;
    let end = fromIdx;
    let braces = 0, parens = 0, brackets = 0;
    let started = false;
    let lineCount = 0;
    let inString = null;
    while (end < text.length && lineCount < maxLines) {
      const c = text[end];
      if (inString) {
        if (c === '\\') { end += 2; continue; }
        if (c === inString) inString = null;
      } else if (c === '"' || c === "'" || c === '`') inString = c;
      else if (c === '{') { braces++; started = true; }
      else if (c === '}') braces--;
      else if (c === '(') parens++;
      else if (c === ')') parens--;
      else if (c === '[') brackets++;
      else if (c === ']') brackets--;
      else if (c === '\n') {
        lineCount++;
        // For statement declarations (no braces yet), terminate at first ';' or end-of-line.
        if (!started && braces === 0 && parens === 0 && /;\s*$/.test(text.slice(fromIdx, end))) break;
      }
      end++;
      if (started && braces <= 0 && parens <= 0 && brackets <= 0) {
        while (end < text.length && text[end] !== '\n') end++;
        break;
      }
    }
    return text.slice(fromIdx, Math.min(end, fromIdx + 8000));
  }

  function lineNumberAt(text, idx) {
    return (text.slice(0, idx).match(/\n/g) || []).length + 1;
  }

  // ── tsconfig / jsconfig path alias resolution ────────────────────
  // Reads the nearest tsconfig.json (or jsconfig.json) walking up from
  // the current file's directory, follows `extends` up to 5 levels, and
  // applies `compilerOptions.paths` + `compilerOptions.baseUrl` for any
  // import string that's not relative and not a bare package.
  //
  // Examples handled:
  //   "@/*": ["./src/*"]            →  @/foo → <root>/src/foo
  //   "@app/*": ["./src/app/*"]     →  @app/x → <root>/src/app/x
  //   "components/*": ["./src/components/*"]  (with baseUrl: ".")
  //   "components": ["./src/components"]    (exact match, no star)
  //   baseUrl: "./src" + import "components/Foo" → <root>/src/components/Foo
  //
  // tsconfig is JSONC (allows comments and trailing commas), so we use a
  // tolerant strip-comments-then-JSON.parse rather than pulling in a JSONC
  // dependency.

  const TSCONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];
  const tsconfigCache = new Map();
  const TSCONFIG_TTL = 5 * 60 * 1000;

  function parseJsonc(text) {
    if (!text) return null;
    try {
      let s = String(text);
      // Strip block comments
      s = s.replace(/\/\*[\s\S]*?\*\//g, '');
      // Strip line comments (not URLs — preserve `:` prefix)
      s = s.replace(/(^|[^:"'])\/\/[^\n]*/g, '$1');
      // Strip trailing commas
      s = s.replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(s);
    } catch { return null; }
  }

  async function loadTsConfig(fromDir) {
    if (!fromDir) return null;
    let d = fromDir;
    for (let hop = 0; hop < 10 && d; hop++) {
      for (const name of TSCONFIG_NAMES) {
        const p = joinPath(d, name);
        const cached = tsconfigCache.get(p);
        if (cached && Date.now() - cached.ts < TSCONFIG_TTL) {
          if (cached.value) return cached.value;
          continue;
        }
        if (!(await fileExists(p))) {
          tsconfigCache.set(p, { value: null, ts: Date.now() });
          continue;
        }
        const text = await readFileSafe(p);
        const parsed = parseJsonc(text);
        if (!parsed) {
          tsconfigCache.set(p, { value: null, ts: Date.now() });
          continue;
        }
        // Follow extends chain (deep-merge compilerOptions, child wins).
        let merged = parsed;
        let extPath = parsed.extends;
        let depth = 0;
        while (extPath && depth < 5) {
          const epRaw = String(extPath);
          const epWithExt = epRaw.endsWith('.json') ? epRaw : epRaw + '.json';
          // Resolve extends path: relative to current config dir if it
          // starts with ./ or ../; otherwise try node_modules/<pkg>.
          let ep;
          if (epWithExt.startsWith('./') || epWithExt.startsWith('../') || epWithExt.startsWith('/')) {
            ep = joinPath(d, epWithExt);
          } else {
            const nm = await findUp('node_modules', d);
            ep = nm ? joinPath(nm, epWithExt) : null;
          }
          if (!ep || !(await fileExists(ep))) break;
          const extText = await readFileSafe(ep);
          const extParsed = parseJsonc(extText);
          if (!extParsed) break;
          merged = {
            ...extParsed,
            ...merged,
            compilerOptions: {
              ...(extParsed.compilerOptions || {}),
              ...(merged.compilerOptions || {}),
              paths: { ...(extParsed.compilerOptions?.paths || {}), ...(merged.compilerOptions?.paths || {}) },
            },
          };
          extPath = extParsed.extends;
          depth++;
        }
        const result = { configDir: d, configPath: p, compilerOptions: merged.compilerOptions || {} };
        tsconfigCache.set(p, { value: result, ts: Date.now() });
        return result;
      }
      const parent = dirname(d);
      if (!parent || parent === d) break;
      d = parent;
    }
    return null;
  }

  // Try to resolve `importStr` as a candidate path against `baseDir` using
  // the standard SOURCE_EXTS / index.<ext> fallbacks.
  async function tryResolveAt(baseDir, target) {
    const candidate = joinPath(baseDir, target);
    for (const ext of SOURCE_EXTS) {
      const c = candidate + ext;
      if (await fileExists(c)) return c;
    }
    if (await fileExists(candidate)) return candidate;
    for (const ext of SOURCE_EXTS) {
      const c = joinPath(candidate, 'index' + ext);
      if (await fileExists(c)) return c;
    }
    return null;
  }

  async function resolveAlias(importStr, fromDir) {
    const tsc = await loadTsConfig(fromDir);
    if (!tsc) return null;
    const { configDir, compilerOptions } = tsc;
    const baseUrl = compilerOptions.baseUrl
      ? joinPath(configDir, compilerOptions.baseUrl)
      : configDir;
    const pathsMap = compilerOptions.paths || {};

    // 1. Walk paths entries — most specific first (longest pattern wins).
    const patterns = Object.keys(pathsMap).sort((a, b) => b.length - a.length);
    for (const pattern of patterns) {
      const mappings = pathsMap[pattern] || [];
      // Star pattern: "alias/*" → take the suffix after the prefix
      if (pattern.endsWith('/*') || pattern.endsWith('*')) {
        const prefix = pattern.replace(/\*$/, '').replace(/\/$/, '');
        if (importStr === prefix || importStr.startsWith(prefix + '/') || (prefix === '' && pattern === '*')) {
          const tail = prefix === '' ? importStr : importStr.slice(prefix.length + (importStr === prefix ? 0 : 1));
          for (const m of mappings) {
            const target = String(m).replace(/\*$/, '').replace(/\/$/, '');
            const filled = tail ? joinPath(target, tail) : target;
            const resolved = await tryResolveAt(baseUrl, filled);
            if (resolved) return resolved;
          }
        }
      } else if (pattern === importStr) {
        // Exact match
        for (const m of mappings) {
          const resolved = await tryResolveAt(baseUrl, String(m));
          if (resolved) return resolved;
        }
      }
    }

    // 2. baseUrl-only resolution (TS allows non-relative imports to be
    // resolved against baseUrl when no `paths` entry matches).
    if (compilerOptions.baseUrl) {
      const resolved = await tryResolveAt(baseUrl, importStr);
      if (resolved) return resolved;
    }

    return null;
  }

  // ── Cache ─────────────────────────────────────────────────────────
  const cache = new Map();
  const TTL = 5 * 60 * 1000;
  function cacheGet(key) {
    const e = cache.get(key);
    if (!e || Date.now() - e.ts > TTL) return undefined;
    cache.delete(key); cache.set(key, e); // refresh recency
    return e.value;
  }
  function cacheSet(key, value) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, { value, ts: Date.now() });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }

  // ── Public API ────────────────────────────────────────────────────
  async function resolveSymbol({ symbol, filePath, sessionText }) {
    if (!symbol || !filePath) return null;
    const key = filePath + '|' + symbol;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    let result = null;
    const text = sessionText || '';

    // 1) Local declaration in the same file
    const localIdx = findLocalDeclaration(text, symbol);
    if (localIdx >= 0) {
      const decl = extractDeclaration(text, localIdx);
      if (decl) {
        result = {
          kind: 'local',
          sourceFile: filePath,
          sourceLine: lineNumberAt(text, localIdx),
          definitionText: decl,
        };
      }
    }

    // 2) Imported symbol — resolve and read the source file
    if (!result) {
      const imp = findImportPath(text, symbol);
      if (imp && imp.path) {
        const fromDir = dirname(filePath);
        let resolvedPath = null;
        if (imp.path.startsWith('./') || imp.path.startsWith('../') || imp.path.startsWith('/')) {
          resolvedPath = await resolveRelative(imp.path, fromDir);
        } else {
          // Try tsconfig/jsconfig path aliases first (handles @/foo,
          // @app/foo, baseUrl-relative imports). If no alias matches AND
          // it doesn't look like an alias (starts with @ + slash, or a
          // configured prefix), fall back to node_modules.
          resolvedPath = await resolveAlias(imp.path, fromDir);
          if (!resolvedPath) {
            resolvedPath = await resolvePackage(imp.path, fromDir);
          }
        }
        if (resolvedPath) {
          const content = await readFileSafe(resolvedPath);
          if (content) {
            let exportIdx = imp.kind === 'default'
              ? findDefaultExport(content)
              : findExportInFile(content, symbol);
            if (exportIdx < 0 && imp.kind === 'namespace') {
              // Namespace — show the first export or top of file
              exportIdx = 0;
            }
            if (exportIdx >= 0) {
              const decl = extractDeclaration(content, exportIdx, 80);
              if (decl) {
                result = {
                  kind: 'imported',
                  sourceFile: resolvedPath,
                  sourceLine: lineNumberAt(content, exportIdx),
                  definitionText: decl,
                  importKind: imp.kind,
                  importPath: imp.path,
                };
              }
            }
          }
        }
      }
    }

    cacheSet(key, result);
    return result;
  }

  function clearResolverCache() { cache.clear(); tsconfigCache.clear(); pkgJsonCache.clear(); }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.docs = window.PiPilot.docs || {};
  window.PiPilot.docs.resolver = { resolveSymbol, clearResolverCache };
})();
