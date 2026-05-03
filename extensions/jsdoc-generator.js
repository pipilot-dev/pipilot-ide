// PiPilot IDE — JSDoc Generator (built-in)
//
// A multi-functional JSDoc tool inspired by IDE LSP servers. Modes:
//   • Smart Generate (Mod+Shift+D)         — JSDoc for the function/class
//                                             at the cursor or selection.
//   • Document All Undocumented (Mod+Shift+Alt+D)
//                                            — scan the file, add JSDoc to
//                                              every undocumented top-level
//                                              function / class / method.
//   • Update Existing                      — re-sync an existing JSDoc
//                                              block above the cursor with
//                                              the current signature.
//   • Generate with AI                     — open the chat with the
//                                              selected function and a
//                                              prompt asking for a real
//                                              description.
//
// Plus:
//   • Tag autocomplete inside  /** */  blocks (@param, @returns, @example,
//     @throws, @deprecated, @template, @see, @since, @typedef, …).
//   • Context-menu integration on JS/TS/JSX/TSX files.
//
// Loaded as a built-in via the renderer/builtins loader; the legacy
// extension flag below short-circuits a duplicate user-installed copy.

(function (PiPilot, bus, api, state, db) {
  if (window.__pipilotBuiltinJsdoc) return;
  window.__pipilotBuiltinJsdoc = true;

  const SUPPORTED_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts']);

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  }
  function getActivePath() {
    return (PiPilot.editor && PiPilot.editor.getActiveFile && PiPilot.editor.getActiveFile()) || state?.activeFile || '';
  }
  function isSupported(filePath) {
    const fp = filePath || getActivePath();
    if (!fp) return false;
    const ext = (fp.split('.').pop() || '').toLowerCase();
    return SUPPORTED_EXTS.has(ext);
  }
  function toast(message, type) {
    bus.emit('toast:show', { message: message, type: type || 'info' });
  }

  // ─────────────────────────────────────────────────────────────────
  //  PARAMETER PARSING — handles defaults, optionals, rest, destructured,
  //  generics-in-types, and complex TS types like Foo<Bar, Baz>.
  // ─────────────────────────────────────────────────────────────────
  function splitTopLevelCommas(str) {
    const parts = [];
    let depth = 0;
    let cur = '';
    let inString = null;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (inString) {
        cur += c;
        if (c === inString && str[i - 1] !== '\\') inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inString = c; cur += c; continue; }
      if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === '>' || c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  function parseParams(paramStr) {
    if (!paramStr || !paramStr.trim()) return [];
    return splitTopLevelCommas(paramStr).map(raw => {
      // Strip default value (anything after a top-level `=`)
      const eqIdx = (function () {
        let depth = 0;
        let inString = null;
        for (let i = 0; i < raw.length; i++) {
          const c = raw[i];
          if (inString) { if (c === inString && raw[i - 1] !== '\\') inString = null; continue; }
          if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
          if ('([{<'.includes(c)) depth++;
          else if (')]}>'.includes(c)) depth--;
          if (c === '=' && depth === 0 && raw[i + 1] !== '>' && raw[i - 1] !== '=' && raw[i - 1] !== '<' && raw[i - 1] !== '>' && raw[i - 1] !== '!') return i;
        }
        return -1;
      })();
      const hasDefault = eqIdx !== -1;
      let core = (hasDefault ? raw.slice(0, eqIdx) : raw).trim();

      // Decorators (TS): @decorator x: T  →  strip
      core = core.replace(/^@[\w.]+\s+/, '');
      // Modifiers (TS): public/private/protected/readonly
      core = core.replace(/^(public|private|protected|readonly|override|abstract)\s+/, '');

      // Rest params
      let isRest = false;
      if (core.startsWith('...')) { isRest = true; core = core.slice(3).trim(); }

      // Split name : type
      let name = '';
      let type = '*';
      const colonIdx = (function () {
        let depth = 0;
        for (let i = 0; i < core.length; i++) {
          const c = core[i];
          if ('([{<'.includes(c)) depth++;
          else if (')]}>'.includes(c)) depth--;
          if (c === ':' && depth === 0) return i;
        }
        return -1;
      })();
      if (colonIdx >= 0) {
        name = core.slice(0, colonIdx).trim();
        type = core.slice(colonIdx + 1).trim() || '*';
      } else {
        name = core;
      }

      // Optional `?`
      let isOptional = false;
      if (name.endsWith('?')) { isOptional = true; name = name.slice(0, -1).trim(); }

      // Destructured — give a generic name + Object/Array type
      if (name.startsWith('{')) {
        type = type === '*' ? 'Object' : type;
        name = 'options';
      } else if (name.startsWith('[')) {
        type = type === '*' ? 'Array' : type;
        name = 'tuple';
      }

      if (isRest) {
        // Rest type is the array type (or wrap if not yet)
        if (type === '*') type = 'any[]';
      }

      return { name, type, optional: isOptional, hasDefault, isRest };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  //  SIGNATURE PARSER — returns { kind, name, params, returnType, … }
  //  kind ∈ 'function' | 'arrow' | 'method' | 'class' | 'interface'
  //         | 'type' | 'getter' | 'setter' | 'constructor'
  // ─────────────────────────────────────────────────────────────────
  function parseSignature(line) {
    const flags = {
      isAsync: /\basync\b/.test(line),
      isGenerator: /function\s*\*/.test(line) || /\*\s*\w+\s*\(/.test(line),
      isExport: /^\s*export\b/.test(line),
      isDefault: /\bexport\s+default\b/.test(line),
      isStatic: /\bstatic\b/.test(line),
      isPrivate: /\bprivate\b/.test(line) || /\b#\w+/.test(line),
    };

    // 1. Class declaration
    let m = line.match(/(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Z]\w*)\s*(?:<[^>]*>)?\s*(?:extends\s+([\w.]+(?:<[^>]*>)?))?(?:\s+implements\s+([^\{]+))?/);
    if (m) return { kind: 'class', name: m[1], extendsName: m[2] || null, implementsList: m[3] ? m[3].trim() : null, ...flags };

    // 2. Interface declaration
    m = line.match(/(?:export\s+)?interface\s+(\w+)\s*(?:<[^>]*>)?\s*(?:extends\s+([^\{]+))?/);
    if (m) return { kind: 'interface', name: m[1], extendsName: m[2] ? m[2].trim() : null, ...flags };

    // 3. Type alias
    m = line.match(/(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/);
    if (m) return { kind: 'type', name: m[1], ...flags };

    // 4. Function declaration: function foo(...): T {
    m = line.match(/(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*(\*?)\s*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\{=]+))?/);
    if (m) return { kind: 'function', name: m[2], params: m[3] || '', returnType: (m[4] || '').trim() || null, isGenerator: !!m[1] || flags.isGenerator, ...flags };

    // 5. Const/let/var = (params): T => or = function(...)
    m = line.match(/(?:export\s+(?:default\s+)?)?(?:var|let|const)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:function\s*(\*?)\s*(?:<[^>]*>)?)?\s*\(([^)]*)\)\s*(?::\s*([^=\{]+))?\s*(=>)?/);
    if (m && (m[5] || /=\s*function/.test(line))) {
      return { kind: m[5] ? 'arrow' : 'function', name: m[1], params: m[3] || '', returnType: (m[4] || '').trim() || null, isGenerator: !!m[2] || flags.isGenerator, ...flags };
    }

    // 6. Class member: getter / setter
    m = line.match(/^\s*(?:(?:public|private|protected|static|readonly|override|abstract|async)\s+)*(get|set)\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?/);
    if (m) return { kind: m[1] === 'get' ? 'getter' : 'setter', name: m[2], params: m[3] || '', returnType: (m[4] || '').trim() || null, ...flags };

    // 7. Class method (including constructor and private #methods)
    m = line.match(/^\s*(?:(?:public|private|protected|static|readonly|override|abstract|async)\s+)*(\*\s*)?(#?\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^\{]+))?/);
    if (m && m[2] !== 'if' && m[2] !== 'while' && m[2] !== 'for' && m[2] !== 'switch' && m[2] !== 'return') {
      const name = m[2];
      const kind = name === 'constructor' ? 'constructor' : 'method';
      return { kind, name, params: m[3] || '', returnType: (m[4] || '').trim() || null, isGenerator: !!m[1] || flags.isGenerator, ...flags };
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────
  //  JSDoc BUILDER
  // ─────────────────────────────────────────────────────────────────
  function buildJsDocLines(info, indent) {
    const lines = [];
    lines.push(indent + '/**');

    // Headline depending on kind
    const headline = (() => {
      switch (info.kind) {
        case 'class':       return `${info.name} class — description`;
        case 'interface':   return `${info.name} interface — description`;
        case 'type':        return `${info.name} type alias — description`;
        case 'getter':      return `${info.name} getter — description`;
        case 'setter':      return `${info.name} setter — description`;
        case 'constructor': return `Create a new ${info.name === 'constructor' ? 'instance' : info.name}.`;
        case 'method':      return `${info.name} — description`;
        default:            return `${info.name || 'function'} — description`;
      }
    })();
    lines.push(indent + ' * ' + headline);

    // Class extends/implements
    if (info.kind === 'class' && info.extendsName) {
      lines.push(indent + ' *');
      lines.push(indent + ` * @extends {${info.extendsName}}`);
      if (info.implementsList) lines.push(indent + ` * @implements {${info.implementsList}}`);
    }
    if (info.kind === 'interface' && info.extendsName) {
      lines.push(indent + ' *');
      lines.push(indent + ` * @extends {${info.extendsName}}`);
    }

    const params = info.kind === 'class' || info.kind === 'interface' || info.kind === 'type' || info.kind === 'getter'
      ? []
      : parseParams(info.params || '');

    if (params.length || info.returnType || info.isAsync) {
      lines.push(indent + ' *');
    }

    if (info.isStatic) lines.push(indent + ' * @static');
    if (info.isPrivate) lines.push(indent + ' * @private');
    if (info.isAsync && info.kind !== 'class' && info.kind !== 'interface') lines.push(indent + ' * @async');
    if (info.isGenerator) lines.push(indent + ' * @generator');

    for (const p of params) {
      const typeStr = '{' + p.type + '}';
      const nameStr = (p.optional || p.hasDefault) ? `[${p.name}]` : p.name;
      lines.push(indent + ` * @param ${typeStr} ${nameStr} — description`);
    }

    if (info.kind === 'getter') {
      const t = info.returnType || '*';
      lines.push(indent + ` * @returns {${t}} description`);
    } else if (info.kind === 'setter') {
      // setters don't return
    } else if (info.kind === 'constructor') {
      // no @returns for constructor
    } else if (info.kind === 'method' || info.kind === 'function' || info.kind === 'arrow') {
      let ret = info.returnType ? info.returnType.replace(/[\{\}]/g, '').trim() : null;
      if (info.isAsync && ret && !/^Promise[\s<]/i.test(ret)) ret = `Promise<${ret}>`;
      else if (info.isAsync && !ret) ret = 'Promise<*>';
      if (info.isGenerator) ret = ret ? `Generator<${ret}>` : 'Generator';
      if (ret) lines.push(indent + ` * @returns {${ret}} description`);
    }

    lines.push(indent + ' */');
    return lines;
  }

  function buildJsDoc(info, indent) {
    return buildJsDocLines(info, indent).join('\n') + '\n';
  }

  // Collapse a multi-line signature starting at row into a single string.
  function collapseSignature(session, startRow, lookahead) {
    let text = '';
    const max = Math.min(session.getLength(), startRow + (lookahead || 6));
    let parenDepth = 0;
    let started = false;
    for (let r = startRow; r < max; r++) {
      const lineText = session.getLine(r);
      text += (text ? ' ' : '') + lineText;
      for (let i = 0; i < lineText.length; i++) {
        const c = lineText[i];
        if (c === '(') { parenDepth++; started = true; }
        else if (c === ')') parenDepth--;
        if (c === '{' && parenDepth === 0 && started) return text;
      }
      if (started && parenDepth <= 0 && /[){]/.test(lineText)) return text;
    }
    return text;
  }

  function hasJsDocAbove(session, row) {
    let r = row - 1;
    while (r >= 0) {
      const l = session.getLine(r).trim();
      if (l === '') { r--; continue; }
      return l.endsWith('*/');
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────
  //  MODES
  // ─────────────────────────────────────────────────────────────────

  // Smart: docs the thing at/near the cursor, or selection's first line.
  function generateForCurrent() {
    const editor = getEditor();
    if (!editor) return toast('No active editor', 'error');
    if (!isSupported()) return toast('JSDoc only works on JS/TS files', 'warn');
    const session = editor.getSession();
    const sel = editor.getSelectionRange();
    let row = sel.start.row;
    // Skip blank lines forward up to 3
    for (let i = 0; i < 3 && row < session.getLength(); i++) {
      if (session.getLine(row).trim()) break;
      row++;
    }
    const collapsed = collapseSignature(session, row, 6).replace(/\s+/g, ' ').trim();
    const info = parseSignature(collapsed);
    if (!info) {
      toast('No function, class, or interface found here', 'warn');
      return;
    }
    if (hasJsDocAbove(session, row)) {
      // Re-route to update mode
      return updateExistingForRow(row, info);
    }
    insertJsDocAtRow(session, row, info);
    toast(`JSDoc added for ${info.kind} "${info.name || ''}"`, 'success');
  }

  function insertJsDocAtRow(session, row, info) {
    const editor = getEditor();
    const indent = (session.getLine(row).match(/^(\s*)/) || ['', ''])[1];
    const block = buildJsDoc(info, indent);
    session.insert({ row, column: 0 }, block);
    editor.moveCursorToPosition({ row, column: indent.length + 3 });
    editor.clearSelection();
  }

  // Update: rebuild the JSDoc immediately above `row` to match the current
  // signature. Preserves existing description and any custom tags the user
  // has added (anything that's not @param/@returns/@async/@generator).
  function updateExistingForRow(row, info) {
    const editor = getEditor();
    const session = editor.getSession();
    // Find the JSDoc block boundaries
    let endRow = row - 1;
    while (endRow >= 0 && !session.getLine(endRow).trim()) endRow--;
    if (endRow < 0 || !session.getLine(endRow).trim().endsWith('*/')) return toast('No existing JSDoc above', 'warn');
    let startRow = endRow;
    while (startRow >= 0 && !session.getLine(startRow).trim().startsWith('/**')) startRow--;
    if (startRow < 0) return toast('Malformed JSDoc — missing /** opener', 'error');

    // Collect existing custom tags (not auto-managed)
    const AUTO_TAGS = new Set(['@param', '@returns', '@return', '@async', '@generator', '@static', '@private', '@extends', '@implements']);
    const customLines = [];
    let descriptionLines = [];
    let inDescription = true;
    for (let r = startRow + 1; r < endRow; r++) {
      const raw = session.getLine(r);
      const stripped = raw.replace(/^\s*\*\s?/, '').trimEnd();
      if (!stripped) { inDescription = false; continue; }
      const tagMatch = stripped.match(/^(@\w+)/);
      if (tagMatch) {
        inDescription = false;
        if (!AUTO_TAGS.has(tagMatch[1])) customLines.push(stripped);
      } else if (inDescription) {
        descriptionLines.push(stripped);
      }
    }

    // Build the new block, preserving description + custom tags
    const indent = (session.getLine(row).match(/^(\s*)/) || ['', ''])[1];
    const fresh = buildJsDocLines(info, indent);
    // Replace the headline (line index 1) with preserved description if any
    if (descriptionLines.length) {
      fresh.splice(1, 1, ...descriptionLines.map(d => indent + ' * ' + d));
    }
    // Insert custom lines just before the closing */
    if (customLines.length) {
      fresh.splice(fresh.length - 1, 0, indent + ' *');
      for (const l of customLines) fresh.splice(fresh.length - 1, 0, indent + ' * ' + l);
    }

    const Range = window.ace?.require?.('ace/range')?.Range;
    if (Range) {
      session.replace(new Range(startRow, 0, endRow + 1, 0), fresh.join('\n') + '\n');
    } else {
      // Fallback — delete then insert
      const linesToRemove = endRow - startRow + 1;
      for (let i = 0; i < linesToRemove; i++) session.removeFullLines(startRow, startRow);
      session.insert({ row: startRow, column: 0 }, fresh.join('\n') + '\n');
    }
    toast(`JSDoc updated for "${info.name || info.kind}"`, 'success');
  }

  // Bulk: scan top-level and class members, document undocumented ones.
  function generateForAllUndocumented() {
    const editor = getEditor();
    if (!editor) return toast('No active editor', 'error');
    if (!isSupported()) return toast('JSDoc only works on JS/TS files', 'warn');
    const session = editor.getSession();
    const total = session.getLength();
    const targets = []; // { row, info }

    for (let r = 0; r < total; r++) {
      const line = session.getLine(r);
      if (!line.trim()) continue;
      // Cheap pre-filter to avoid expensive parsing on every line
      if (!/(function|=>|class\s|interface\s|^\s*type\s+\w+\s*=|constructor\s*\(|^\s*(public|private|protected|static|async|get|set|#)?\s*\w+\s*\([^)]*\)\s*[:{])/.test(line)) {
        continue;
      }
      const collapsed = collapseSignature(session, r, 6).replace(/\s+/g, ' ').trim();
      const info = parseSignature(collapsed);
      if (!info) continue;
      if (hasJsDocAbove(session, r)) continue;
      // Skip arrow vars that aren't exported / top-level functions to reduce noise
      if (info.kind === 'method' && !info.name) continue;
      targets.push({ row: r, info });
    }

    if (!targets.length) return toast('No undocumented declarations found', 'info');

    // Insert from bottom to top so row indexes stay valid
    targets.sort((a, b) => b.row - a.row);
    for (const t of targets) {
      const indent = (session.getLine(t.row).match(/^(\s*)/) || ['', ''])[1];
      const block = buildJsDoc(t.info, indent);
      session.insert({ row: t.row, column: 0 }, block);
    }
    toast(`Documented ${targets.length} declaration${targets.length === 1 ? '' : 's'}`, 'success');
  }

  // AI: ask the chat agent to generate a real description, sending the
  // current function body in the prompt.
  function generateWithAI() {
    const editor = getEditor();
    if (!editor) return toast('No active editor', 'error');
    if (!isSupported()) return toast('JSDoc only works on JS/TS files', 'warn');
    const session = editor.getSession();
    const sel = editor.getSelectionRange();
    let row = sel.start.row;
    while (row < session.getLength() && !session.getLine(row).trim()) row++;
    const collapsed = collapseSignature(session, row, 6).replace(/\s+/g, ' ').trim();
    const info = parseSignature(collapsed);
    if (!info) return toast('No function found at cursor', 'warn');

    // Grab the function body (or the next ~30 lines as best-effort context)
    const bodyEnd = Math.min(session.getLength(), row + 35);
    let body = '';
    for (let r = row; r < bodyEnd; r++) body += session.getLine(r) + '\n';

    const filePath = getActivePath();
    const fileName = (filePath.split(/[\\/]/).pop()) || filePath;
    const prompt = `Generate a complete JSDoc block (with @param, @returns, and a precise one-sentence description) for this ${info.kind} in \`${fileName}\`. Return ONLY the JSDoc block — no surrounding commentary, no markdown fences. Use accurate TypeScript types.\n\n\`\`\`${(filePath.split('.').pop() || '').toLowerCase()}\n${body}\n\`\`\``;

    document.getElementById('chat-panel')?.classList.remove('hidden');
    bus.emit('chat:focus-with-prompt', prompt);
    toast('Sent to chat — paste the response above the function', 'info');
  }

  // ─────────────────────────────────────────────────────────────────
  //  TAG AUTOCOMPLETE inside /** … */
  // ─────────────────────────────────────────────────────────────────
  const JSDOC_TAGS = [
    { tag: '@param',       snippet: '@param {${1:type}} ${2:name} - ${3:description}', desc: 'Document a parameter' },
    { tag: '@returns',     snippet: '@returns {${1:type}} ${2:description}',           desc: 'Document return value' },
    { tag: '@return',      snippet: '@return {${1:type}} ${2:description}',            desc: 'Alias for @returns' },
    { tag: '@throws',      snippet: '@throws {${1:Error}} ${2:description}',           desc: 'Document an exception' },
    { tag: '@example',     snippet: '@example\n${1:// example code}',                  desc: 'Code example' },
    { tag: '@deprecated',  snippet: '@deprecated ${1:since version, use X instead}',   desc: 'Mark as deprecated' },
    { tag: '@since',       snippet: '@since ${1:version}',                             desc: 'Version added' },
    { tag: '@version',     snippet: '@version ${1:1.0.0}',                             desc: 'Version of this item' },
    { tag: '@author',      snippet: '@author ${1:name}',                               desc: 'Author' },
    { tag: '@see',         snippet: '@see {@link ${1:target}}',                        desc: 'Cross-reference' },
    { tag: '@link',        snippet: '{@link ${1:target}}',                             desc: 'Inline link' },
    { tag: '@template',    snippet: '@template ${1:T}',                                desc: 'Generic type parameter' },
    { tag: '@typedef',     snippet: '@typedef {${1:Object}} ${2:Name}',                desc: 'Define a type' },
    { tag: '@property',    snippet: '@property {${1:type}} ${2:name} - ${3:description}', desc: 'Property of a typedef' },
    { tag: '@type',        snippet: '@type {${1:type}}',                               desc: 'Type of a variable' },
    { tag: '@callback',    snippet: '@callback ${1:Name}',                             desc: 'Define a callback type' },
    { tag: '@async',       snippet: '@async',                                          desc: 'Async function' },
    { tag: '@generator',   snippet: '@generator',                                      desc: 'Generator function' },
    { tag: '@yields',      snippet: '@yields {${1:type}} ${2:description}',            desc: 'Generator yield' },
    { tag: '@private',     snippet: '@private',                                        desc: 'Private member' },
    { tag: '@public',      snippet: '@public',                                         desc: 'Public member' },
    { tag: '@protected',   snippet: '@protected',                                      desc: 'Protected member' },
    { tag: '@readonly',    snippet: '@readonly',                                       desc: 'Read-only member' },
    { tag: '@static',      snippet: '@static',                                         desc: 'Static member' },
    { tag: '@override',    snippet: '@override',                                       desc: 'Overrides parent' },
    { tag: '@extends',     snippet: '@extends {${1:Parent}}',                          desc: 'Class extends' },
    { tag: '@implements',  snippet: '@implements {${1:Interface}}',                    desc: 'Class implements' },
    { tag: '@todo',        snippet: '@todo ${1:description}',                          desc: 'Pending work' },
    { tag: '@ignore',      snippet: '@ignore',                                         desc: 'Hide from docs' },
    { tag: '@inheritdoc',  snippet: '@inheritdoc',                                     desc: 'Inherit from parent' },
  ];

  function isInsideJsDoc(session, pos) {
    // Walk backwards from cursor; if we hit /** before */, we're inside.
    for (let r = pos.row; r >= Math.max(0, pos.row - 200); r--) {
      const line = session.getLine(r);
      const upTo = r === pos.row ? line.slice(0, pos.column) : line;
      const closeIdx = upTo.lastIndexOf('*/');
      const openIdx = upTo.lastIndexOf('/**');
      if (openIdx > closeIdx) return true;
      if (closeIdx > openIdx && closeIdx >= 0) return false;
    }
    return false;
  }

  function setupTagCompleter() {
    const editor = getEditor();
    if (!editor || !window.ace?.require) return;
    const langTools = window.ace.require('ace/ext/language_tools');
    if (!langTools) return;

    const completer = {
      getCompletions(editor, session, pos, prefix, cb) {
        if (!isSupported()) return cb(null, []);
        if (!prefix.startsWith('@')) {
          // Also offer when the user just typed a @ at the start of a line
          const lineUpTo = session.getLine(pos.row).slice(0, pos.column);
          if (!/[@]\w*$/.test(lineUpTo)) return cb(null, []);
        }
        if (!isInsideJsDoc(session, pos)) return cb(null, []);
        const items = JSDOC_TAGS.map(t => ({
          caption: t.tag,
          snippet: t.snippet,
          meta: 'jsdoc',
          docHTML: '<b>' + t.tag + '</b><br/><i style="opacity:0.7">' + t.desc + '</i>',
          score: 1000,
        }));
        cb(null, items);
      },
      // Trigger on `@`
      identifierRegexps: [/[@]?\w*/],
    };
    langTools.addCompleter(completer);
  }

  // ─────────────────────────────────────────────────────────────────
  //  WIRING
  // ─────────────────────────────────────────────────────────────────
  if (PiPilot && PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+d', generateForCurrent);
    PiPilot.shortcuts.register('mod+shift+alt+d', generateForAllUndocumented);
  }

  bus.on('editor:context-menu', (payload) => {
    if (!payload || !Array.isArray(payload.items)) return;
    if (!isSupported(payload.filePath)) return;
    payload.items.push({ label: 'Generate JSDoc',         hint: 'Mod+Shift+D',     run: generateForCurrent });
    payload.items.push({ label: 'Document All in File',   hint: 'Mod+Shift+Alt+D', run: generateForAllUndocumented });
    payload.items.push({ label: 'Generate JSDoc with AI', hint: 'chat',            run: generateWithAI });
  });

  // Defer completer setup until Ace is ready (file might not be open yet).
  function trySetup() {
    if (getEditor()) setupTagCompleter();
    else setTimeout(trySetup, 250);
  }
  trySetup();

  console.log('[builtin:jsdoc] JSDoc Generator loaded — Mod+Shift+D / Mod+Shift+Alt+D / context menu');
})(PiPilot, bus, api, state, typeof db !== 'undefined' ? db : null);
