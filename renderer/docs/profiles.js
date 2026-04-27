// PiPilot IDE — Documentation language profiles
//
// Maps a file extension to the metadata the doc service needs:
//   • language     — human-readable name passed to the AI prompt
//   • aceMode      — Ace mode for syntax highlighting in the hover code block
//   • convention   — comment style name (jsdoc, pydoc, rustdoc, …)
//   • commentStyle — { open, line, close } strings for inserting a doc block
//   • paramTag     — function(name, type, desc) → string for one @param line
//   • returnTag    — function(type, desc) → string for the @returns line
//
// The AI service does language-agnostic understanding and produces a uniform
// JSON describe-result. The profile decides how to render that result back
// into the source language's idiomatic comment format.

(function () {
  'use strict';

  // Generic helpers for building lines in different conventions ────────
  const jsdocParam   = (name, type, desc) => `@param {${type || '*'}} ${name} ${desc || ''}`.trim();
  const jsdocReturns = (type, desc) => `@returns {${type || '*'}} ${desc || ''}`.trim();

  const pyGoogleParam = (name, type, desc) => `    ${name} (${type || 'Any'}): ${desc || ''}`.trim();
  const pyGoogleReturn = (type, desc) => `    ${type || 'Any'}: ${desc || ''}`.trim();

  const rustParam   = (name, type, desc) => `* \`${name}\` - ${desc || ''}`.trim();
  const rustReturns = (type, desc) => `# Returns\n\n${desc || ''}`.trim();

  const goParam = (name, type, desc) => `// ${name}: ${desc || ''}`.trim();
  const goReturns = (type, desc) => `// Returns: ${desc || ''}`.trim();

  const javadocParam   = (name, type, desc) => `@param ${name} ${desc || ''}`.trim();
  const javadocReturns = (type, desc) => `@return ${desc || ''}`.trim();

  const xmlDocParam   = (name, type, desc) => `<param name="${name}">${desc || ''}</param>`;
  const xmlDocReturns = (type, desc) => `<returns>${desc || ''}</returns>`;

  const phpParam   = (name, type, desc) => `@param ${type || 'mixed'} $${name.replace(/^\$/, '')} ${desc || ''}`.trim();
  const phpReturns = (type, desc) => `@return ${type || 'mixed'} ${desc || ''}`.trim();

  const yardParam   = (name, type, desc) => `@param [${type || 'Object'}] ${name} ${desc || ''}`.trim();
  const yardReturns = (type, desc) => `@return [${type || 'Object'}] ${desc || ''}`.trim();

  const swiftParam   = (name, type, desc) => `- Parameter ${name}: ${desc || ''}`.trim();
  const swiftReturns = (type, desc) => `- Returns: ${desc || ''}`.trim();

  // Profile entries ────────────────────────────────────────────────────
  const PROFILES = {
    // ── JavaScript / TypeScript family ──
    js:   { language: 'JavaScript',          aceMode: 'javascript', convention: 'jsdoc',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: jsdocParam, returnTag: jsdocReturns },
    mjs:  null, cjs: null, jsx: null, // fall through to js
    ts:   { language: 'TypeScript',          aceMode: 'typescript', convention: 'jsdoc',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: jsdocParam, returnTag: jsdocReturns },
    tsx:  null, mts: null, cts: null,

    // ── Python ──
    py:   { language: 'Python',              aceMode: 'python',     convention: 'google-pydoc',
            commentStyle: { open: '"""', line: '', close: '"""' },
            paramTag: pyGoogleParam, returnTag: pyGoogleReturn,
            // Python uses sections, not tags — handled specially in formatter.
            sections: true },

    // ── Rust ──
    rs:   { language: 'Rust',                aceMode: 'rust',       convention: 'rustdoc',
            commentStyle: { open: '', line: '/// ', close: '' },
            paramTag: rustParam, returnTag: rustReturns,
            sections: true },

    // ── Go ──
    go:   { language: 'Go',                  aceMode: 'golang',     convention: 'godoc',
            commentStyle: { open: '', line: '// ', close: '' },
            paramTag: goParam, returnTag: goReturns,
            sections: true },

    // ── Java / Kotlin / Scala ──
    java: { language: 'Java',                aceMode: 'java',       convention: 'javadoc',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: javadocParam, returnTag: javadocReturns },
    kt:   { language: 'Kotlin',              aceMode: 'kotlin',     convention: 'kdoc',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: javadocParam, returnTag: javadocReturns },
    scala:{ language: 'Scala',               aceMode: 'scala',      convention: 'scaladoc',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: javadocParam, returnTag: javadocReturns },

    // ── C / C++ / Objective-C ──
    c:    { language: 'C',                   aceMode: 'c_cpp',      convention: 'doxygen',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: javadocParam, returnTag: javadocReturns },
    cpp:  { language: 'C++',                 aceMode: 'c_cpp',      convention: 'doxygen',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: javadocParam, returnTag: javadocReturns },
    h:    null, hpp: null, cc: null, m: null, mm: null,

    // ── C# ──
    cs:   { language: 'C#',                  aceMode: 'csharp',     convention: 'xmldoc',
            commentStyle: { open: '', line: '/// ', close: '' },
            paramTag: xmlDocParam, returnTag: xmlDocReturns,
            sections: true },

    // ── PHP ──
    php:  { language: 'PHP',                 aceMode: 'php',        convention: 'phpdoc',
            commentStyle: { open: '/**', line: ' * ', close: ' */' },
            paramTag: phpParam, returnTag: phpReturns },

    // ── Ruby ──
    rb:   { language: 'Ruby',                aceMode: 'ruby',       convention: 'yard',
            commentStyle: { open: '', line: '# ', close: '' },
            paramTag: yardParam, returnTag: yardReturns },

    // ── Swift ──
    swift:{ language: 'Swift',               aceMode: 'swift',      convention: 'swift-markup',
            commentStyle: { open: '/**', line: ' ', close: ' */' },
            paramTag: swiftParam, returnTag: swiftReturns,
            sections: true },

    // ── Shell / Bash ──
    sh:   { language: 'Bash',                aceMode: 'sh',         convention: 'shdoc',
            commentStyle: { open: '', line: '# ', close: '' },
            paramTag: (n, t, d) => `# $${n}: ${d || ''}`.trim(),
            returnTag: (t, d) => `# Returns: ${d || ''}`.trim(),
            sections: true },
    bash: null, zsh: null,

    // ── Markdown / HTML / CSS — describe-only (no doc-block insertion) ──
    md:   { language: 'Markdown',            aceMode: 'markdown',   convention: 'none',  describeOnly: true },
    html: { language: 'HTML',                aceMode: 'html',       convention: 'html-comment',
            commentStyle: { open: '<!--', line: ' ', close: ' -->' },
            paramTag: (n, t, d) => `${n}: ${d || ''}`,
            returnTag: () => '' },
    css:  { language: 'CSS',                 aceMode: 'css',        convention: 'css-comment',
            commentStyle: { open: '/*', line: ' * ', close: ' */' },
            paramTag: jsdocParam, returnTag: jsdocReturns },
    scss: null, less: null, sass: null,

    // ── Lua / Dart / Elixir / Haskell / Zig / Nim / R ──
    lua:  { language: 'Lua',                 aceMode: 'lua',        convention: 'ldoc',
            commentStyle: { open: '---', line: '-- ', close: '' },
            paramTag: (n, t, d) => `-- @param ${n} ${d || ''}`.trim(),
            returnTag: (t, d) => `-- @return ${d || ''}`.trim() },
    dart: { language: 'Dart',                aceMode: 'dart',       convention: 'dartdoc',
            commentStyle: { open: '', line: '/// ', close: '' },
            paramTag: javadocParam, returnTag: javadocReturns,
            sections: true },
    ex:   { language: 'Elixir',              aceMode: 'elixir',     convention: 'exdoc',
            commentStyle: { open: '@doc """', line: '', close: '"""' },
            paramTag: pyGoogleParam, returnTag: pyGoogleReturn, sections: true },
    exs:  null,
    hs:   { language: 'Haskell',             aceMode: 'haskell',    convention: 'haddock',
            commentStyle: { open: '', line: '-- | ', close: '' },
            paramTag: (n, t, d) => `-- ${n}: ${d || ''}`.trim(),
            returnTag: (t, d) => `-- Returns: ${d || ''}`.trim(), sections: true },
    zig:  { language: 'Zig',                 aceMode: 'zig',        convention: 'zigdoc',
            commentStyle: { open: '', line: '/// ', close: '' },
            paramTag: javadocParam, returnTag: javadocReturns, sections: true },
    r:    { language: 'R',                   aceMode: 'r',          convention: 'roxygen',
            commentStyle: { open: '', line: "#' ", close: '' },
            paramTag: (n, t, d) => `#' @param ${n} ${d || ''}`.trim(),
            returnTag: (t, d) => `#' @return ${d || ''}`.trim() },
    pl:   { language: 'Perl',                aceMode: 'perl',       convention: 'pod', describeOnly: true },

    // ── SQL / YAML / TOML / JSON / XML ──
    sql:  { language: 'SQL',                 aceMode: 'sql',        convention: 'sql-comment',
            commentStyle: { open: '', line: '-- ', close: '' },
            paramTag: () => '', returnTag: () => '' },
    yaml: { language: 'YAML',                aceMode: 'yaml',       convention: 'yaml-comment', describeOnly: true },
    yml:  null,
    toml: { language: 'TOML',                aceMode: 'toml',       convention: 'toml-comment', describeOnly: true },
    json: { language: 'JSON',                aceMode: 'json',       convention: 'none', describeOnly: true },
    xml:  { language: 'XML',                 aceMode: 'xml',        convention: 'xml-comment', describeOnly: true },
  };

  // Resolve aliases (entries set to null)
  const ALIASES = {
    mjs: 'js', cjs: 'js', jsx: 'js', tsx: 'ts', mts: 'ts', cts: 'ts',
    h: 'c', hpp: 'cpp', cc: 'cpp', m: 'c', mm: 'cpp',
    bash: 'sh', zsh: 'sh',
    scss: 'css', less: 'css', sass: 'css',
    yml: 'yaml', exs: 'ex',
  };

  // Files we never want hover docs on — markdown, lockfiles, plain
  // text, configs that are just data, binaries. Returning null here
  // makes the hover module exit early with no popup, no AI call.
  const EXCLUDED_BASENAMES = new Set([
    // Lockfiles — large, never useful to describe lines of.
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'cargo.lock', 'gemfile.lock', 'composer.lock', 'poetry.lock',
    'go.sum', 'pipfile.lock', 'flake.lock', 'bun.lockb', 'bun.lock',
    // Common config files (better as plain editing, not hover).
    '.gitignore', '.gitattributes', '.npmignore', '.dockerignore',
    '.editorconfig', '.prettierrc', '.eslintignore', '.gitkeep',
    'license', 'license.md', 'license.txt',
  ]);
  const EXCLUDED_EXTENSIONS = new Set([
    // Prose / docs.
    'md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc',
    // Plain / log / data.
    'txt', 'log', 'out', 'err', 'csv', 'tsv', 'ndjson',
    // Configuration formats — pure data, hover is noise.
    'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'ini',
    'conf', 'cfg', 'env', 'properties',
    // Images.
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg',
    'avif', 'tiff', 'tif',
    // Fonts.
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    // Audio / video.
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
    'mp4', 'mov', 'avi', 'webm', 'mkv', 'wmv',
    // Archives.
    'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz', 'tbz',
    // Binaries.
    'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'app', 'apk', 'ipa',
    'pdb', 'class', 'jar', 'war',
    // Documents.
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt',
    // Misc artifacts.
    'lock', 'tsbuildinfo', 'map',
  ]);

  function getProfile(filePathOrExt) {
    if (!filePathOrExt) return null;
    const raw = String(filePathOrExt).toLowerCase();
    // Pull basename (last path segment).
    const baseName = raw.split(/[\\/]/).pop();
    if (EXCLUDED_BASENAMES.has(baseName)) return null;
    // Pull extension. If the input was just a bare extension (no dot
    // and no path), treat it as the extension itself.
    let ext = baseName;
    if (ext.includes('.')) ext = ext.split('.').pop();
    if (EXCLUDED_EXTENSIONS.has(ext)) return null;
    const aliased = ALIASES[ext] || ext;
    return PROFILES[aliased] || PROFILES[ext] || null;
  }

  // Format a structured doc result into the source-language convention.
  // Returns a string ready to insert above a declaration (no leading
  // newline; caller decides indentation).
  function formatDocBlock(profile, result, indent = '') {
    if (!profile || profile.describeOnly) return null;
    const cs = profile.commentStyle;
    if (!cs) return null;
    const lines = [];
    const pushLine = (text) => {
      if (cs.line === '') lines.push(indent + (text || ''));
      else lines.push(indent + cs.line + (text || '').replace(/\n/g, '\n' + indent + cs.line));
    };

    if (cs.open) lines.push(indent + cs.open);
    if (result.summary) {
      const summaryLines = String(result.summary).trim().split(/\n+/);
      for (const l of summaryLines) pushLine(l);
    }
    if (profile.sections) {
      // Section-style output (Python google, Rust, Swift, etc.).
      if (Array.isArray(result.params) && result.params.length) {
        pushLine('');
        // Python-style "Args:" section, others just enumerate.
        if (profile.convention === 'google-pydoc') pushLine('Args:');
        else if (profile.convention === 'rustdoc') pushLine('# Arguments');
        else if (profile.convention === 'swift-markup') pushLine('- Parameters:');
        for (const p of result.params) pushLine(profile.paramTag(p.name, p.type || '', p.desc || ''));
      }
      if (result.returns && (result.returns.type || result.returns.desc)) {
        pushLine('');
        if (profile.convention === 'google-pydoc') pushLine('Returns:');
        else if (profile.convention === 'rustdoc') pushLine('# Returns');
        pushLine(profile.returnTag(result.returns.type || '', result.returns.desc || ''));
      }
    } else {
      // Tag-style output (jsdoc, javadoc, doxygen, phpdoc, …).
      if ((Array.isArray(result.params) && result.params.length) || result.returns) pushLine('');
      if (Array.isArray(result.params)) {
        for (const p of result.params) pushLine(profile.paramTag(p.name, p.type || '', p.desc || ''));
      }
      if (result.returns && (result.returns.type || result.returns.desc)) {
        pushLine(profile.returnTag(result.returns.type || '', result.returns.desc || ''));
      }
    }
    if (cs.close) lines.push(indent + cs.close);
    return lines.join('\n');
  }

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.docs = window.PiPilot.docs || {};
  window.PiPilot.docs.profiles = { getProfile, formatDocBlock };
})();
