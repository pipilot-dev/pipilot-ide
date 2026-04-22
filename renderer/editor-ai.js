// PiPilot IDE — Editor AI integrations (Codestral)
//   1. Ghost-text inline completions via FIM (like GitHub Copilot)
//   2. Right-click actions: Add to Chat, Inline Chat, Explain, Fix, Refactor
//   3. Inline Chat widget (Ctrl+Shift+I in editor): prompt over selection → diff → accept/reject
//
// Waits for Monaco to load (editor.js dispatches 'monaco:ready' on window.PiPilot.bus),
// then registers everything against the global `monaco`.

(function () {
  const bus = window.PiPilot.bus;
  const api = window.electronAPI;
  const state = window.PiPilot.state;

  let registered = false;
  let enabled = true;
  let lastRequestId = null;

  function injectStyles() {
    if (document.getElementById('editor-ai-styles')) return;
    const css = `
.inline-chat-widget {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-md); box-shadow: var(--shadow);
  padding: 8px; width: 520px; max-width: 90vw;
}
.inline-chat-widget .row { display: flex; gap: 6px; align-items: center; }
.inline-chat-widget textarea {
  flex: 1; background: var(--surface-alt); border: 1px solid var(--border);
  color: var(--text-strong); border-radius: var(--radius); padding: 6px 8px;
  font-family: var(--font-sans); font-size: var(--fs-sm); min-height: 32px;
  max-height: 140px; resize: none;
}
.inline-chat-widget textarea:focus { outline: none; border-color: var(--accent); }
.inline-chat-widget .hint {
  font-size: 10px; color: var(--text-dim); padding: 4px 2px 0;
}
.inline-chat-widget .actions {
  display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end;
}
.inline-chat-widget .preset-row {
  display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap;
}
.inline-chat-widget .preset-chip {
  font-size: 10px; padding: 2px 8px; background: var(--surface-alt);
  border: 1px solid var(--border); border-radius: 999px; cursor: pointer; color: var(--text-mid);
}
.inline-chat-widget .preset-chip:hover { color: var(--accent); border-color: var(--accent); }
.inline-chat-widget .preview {
  margin-top: 8px; max-height: 260px; overflow: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 6px 8px; font-family: var(--font-mono); font-size: 11px;
  white-space: pre-wrap;
}
.inline-chat-widget .preview .add { color: var(--ok); }
.inline-chat-widget .preview .del { color: var(--error); text-decoration: line-through; opacity: 0.7; }
.inline-chat-widget .spinner {
  display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid var(--accent); border-right-color: transparent;
  animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
`;
    const s = document.createElement('style');
    s.id = 'editor-ai-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------- FIM inline completions (ghost text) ----------
  function registerInlineCompletions() {
    // Vite parity: provider must be synchronous; background fetcher fills cache.
    const cache = []; // [{ uri, versionId, range, insertText, ts }]
    const inFlight = new Set();
    const recentlyFetched = new Map();
    const RECENT_TTL_MS = 25_000;

    let activeEditor = null;
    let debouncedFetchTimer = undefined;

    function stableHash(str) {
      // Fast-ish stable hash (FNV-1a 32-bit)
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      // force unsigned
      return (h >>> 0).toString(16);
    }

    function getFimContext(model, position) {
      const textUntil = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      });
      const last = model.getLineCount();
      const lastCol = model.getLineMaxColumn(last);
      const textAfter = model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: position.column,
        endLineNumber: last, endColumn: lastCol,
      });

      // Context window — enough for Codestral but cap to keep latency low
      const MAX = 8000;
      const prefix = textUntil.length > MAX ? textUntil.slice(-MAX) : textUntil;
      const suffix = textAfter.length > MAX ? textAfter.slice(0, MAX) : textAfter;
      return { prefix, suffix };
    }

    function scheduleFetch() {
      if (!enabled) return;
      if (debouncedFetchTimer !== undefined) clearTimeout(debouncedFetchTimer);
      debouncedFetchTimer = window.setTimeout(() => {
        debouncedFetchTimer = undefined;
        fetchSuggestion();
      }, 220);
    }

    async function fetchSuggestion() {
      if (!enabled) return;
      const editor = activeEditor || monaco?.editor?.getEditors?.()[0];
      if (!editor) return;
      const model = editor.getModel?.();
      const position = editor.getPosition?.();
      if (!model || !position) return;

      const language = model.getLanguageId?.() || 'plaintext';
      const { prefix, suffix } = getFimContext(model, position);
      const hash = stableHash([language, prefix, '<<<>>>', suffix].join('\n'));

      const recentTs = recentlyFetched.get(hash);
      if (recentTs && (Date.now() - recentTs) < RECENT_TTL_MS) return;
      if (inFlight.has(hash)) return;
      inFlight.add(hash);

      const requestId = 'fim-' + Date.now();
      lastRequestId = requestId;
      try {
        const res = await api.codestral.fim({
          prefix,
          suffix,
          language,
          maxTokens: 160,
          temperature: 0.15,
          stop: ['\n\n\n'],
          requestId,
        });
        if (!res?.ok || lastRequestId !== requestId) return;
        const text = (res.text || '').trimEnd();
        if (!text) return;

        cache.push({
          uri: model.uri?.toString?.() || '',
          versionId: model.getVersionId?.() ?? 0,
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          insertText: text,
          ts: Date.now(),
        });
        if (cache.length > 40) cache.splice(0, cache.length - 40);
      } finally {
        inFlight.delete(hash);
        recentlyFetched.set(hash, Date.now());
        if (recentlyFetched.size > 80) {
          const cutoff = Date.now() - RECENT_TTL_MS;
          for (const [k, t] of recentlyFetched.entries()) {
            if (t < cutoff) recentlyFetched.delete(k);
          }
        }
      }
    }

    monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
      groupId: 'pipilot.ai',
      displayName: 'PiPilot AI',
      provideInlineCompletions(model, position /*, context, token */) {
        if (!enabled) return { items: [] };

        // Char-before guard (matches Vite behavior)
        const charBeforeIdx = position.column - 2;
        if (charBeforeIdx >= 0) {
          const lineText = model.getLineContent(position.lineNumber);
          const charBefore = lineText[charBeforeIdx] ?? '';
          if (charBefore && !/[a-zA-Z0-9_\s.({[]/.test(charBefore)) {
            return { items: [] };
          }
        }

        const uri = model.uri?.toString?.() || '';
        const versionId = model.getVersionId?.() ?? 0;
        const relevant = [...cache]
          .reverse()
          .filter((s) => {
            if (s.uri !== uri) return false;
            // allow if model changed slightly (drift), but never across lines
            if (s.range.startLineNumber !== position.lineNumber) return false;
            const drift = position.column - s.range.startColumn;
            if (drift < 0 || drift > 12) return false;
            // If the model advanced a lot, likely stale; but don't be too strict.
            if (Math.abs(versionId - (s.versionId || 0)) > 50) return false;
            return true;
          })
          .slice(0, 2);

        const items = relevant.map((s) => ({
          insertText: s.insertText,
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          command: { id: 'pipilot.trackCompletionShown', title: 'tracked' },
        }));
        return { items };
      },
      freeInlineCompletions() {},
      disposeInlineCompletions() {},
      handleItemDidShow() {},
    });

    // Attach background fetcher to all editors
    const editors = new Set();
    const wireEditor = (ed) => {
      if (!ed || editors.has(ed)) return;
      editors.add(ed);
      activeEditor = ed;
      ed.onDidChangeModelContent((e) => {
        const hasNewline = e.changes?.some?.((c) => (c.text || '').includes('\n'));
        if (hasNewline) cache.length = 0;
        scheduleFetch();
      });
      ed.onDidChangeCursorPosition?.(() => scheduleFetch());
      ed.onDidFocusEditorWidget?.(() => { activeEditor = ed; });
      ed.onDidDispose?.(() => { if (activeEditor === ed) activeEditor = null; });
    };
    monaco.editor.getEditors?.().forEach(wireEditor);
    monaco.editor.onDidCreateEditor?.(wireEditor);
  }

  // ---------- Quick Fix (CodeActionProvider) ----------
  // Registers commands that the lightbulb triggers and a provider that
  // lists them whenever a marker intersects the current range.
  function registerQuickFix() {
    monaco.editor.registerCommand?.('pipilot.fixMarker', async (_accessor, payload) => {
      await runMarkerFix(payload);
    });
    monaco.editor.registerCommand?.('pipilot.explainMarker', (_accessor, payload) => {
      runMarkerExplain(payload);
    });

    monaco.languages.registerCodeActionProvider({ pattern: '**' }, {
      provideCodeActions(model, range, context /*, token */) {
        const markers = (context.markers || []).filter(m => m && m.message);
        if (!markers.length) return { actions: [], dispose() {} };

        const primary = markers[0];
        const payload = {
          uri: model.uri.toString(),
          markers: markers.map(m => ({
            message: m.message,
            severity: m.severity,
            code: typeof m.code === 'object' ? m.code?.value : m.code,
            source: m.source,
            startLineNumber: m.startLineNumber,
            startColumn: m.startColumn,
            endLineNumber: m.endLineNumber,
            endColumn: m.endColumn,
          })),
          language: model.getLanguageId(),
          // We capture a generous window around the marker so the fix has context,
          // but only the exact marker range is replaced when we apply the fix.
          contextBefore: model.getValueInRange({
            startLineNumber: Math.max(1, primary.startLineNumber - 8),
            startColumn: 1,
            endLineNumber: primary.startLineNumber,
            endColumn: 1,
          }),
          targetText: model.getValueInRange({
            startLineNumber: primary.startLineNumber,
            startColumn: 1,
            endLineNumber: primary.endLineNumber,
            endColumn: model.getLineMaxColumn(primary.endLineNumber),
          }),
          contextAfter: model.getValueInRange({
            startLineNumber: primary.endLineNumber,
            startColumn: model.getLineMaxColumn(primary.endLineNumber),
            endLineNumber: Math.min(model.getLineCount(), primary.endLineNumber + 8),
            endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), primary.endLineNumber + 8)),
          }),
          targetRange: {
            startLineNumber: primary.startLineNumber,
            startColumn: 1,
            endLineNumber: primary.endLineNumber,
            endColumn: model.getLineMaxColumn(primary.endLineNumber),
          },
        };

        const actions = [
          {
            title: '✦ Fix with PiPilot',
            kind: 'quickfix',
            isPreferred: true,
            diagnostics: markers,
            command: {
              id: 'pipilot.fixMarker',
              title: 'Fix with PiPilot',
              arguments: [payload],
            },
          },
          {
            title: '✦ Explain problem',
            kind: 'quickfix',
            diagnostics: markers,
            command: {
              id: 'pipilot.explainMarker',
              title: 'Explain problem',
              arguments: [payload],
            },
          },
        ];
        return { actions, dispose() {} };
      },
      providedCodeActionKinds: ['quickfix'],
    });
  }

  function formatMarkers(markers) {
    const sevMap = { 1: 'hint', 2: 'info', 4: 'warning', 8: 'error' };
    return markers.map(m => {
      const sev = sevMap[m.severity] || 'problem';
      const loc = `${m.startLineNumber}:${m.startColumn}`;
      const src = m.source ? `[${m.source}${m.code ? ' ' + m.code : ''}]` : (m.code ? `[${m.code}]` : '');
      return `- ${sev} ${loc} ${src}: ${m.message}`.trim();
    }).join('\n');
  }

  function runMarkerFix(payload) {
    // Build a structured prompt and hand it off to the main (Claude Agent) chat.
    // The agent can read the file via its tools, propose a fix, and apply it
    // with the user's confirmation — same flow as any other chat request.
    const fileRef = (() => {
      try {
        const uri = new URL(payload.uri);
        const p = decodeURIComponent(uri.pathname || '');
        if (state.projectPath && p.startsWith(state.projectPath + '/')) {
          return '@' + p.slice(state.projectPath.length + 1);
        }
        return '@' + p;
      } catch { return ''; }
    })();

    const primary = payload.markers[0];
    const loc = primary ? `line ${primary.startLineNumber}:${primary.startColumn}` : '';

    const prompt = [
      `Fix the following ${payload.language || 'code'} problem in ${fileRef} at ${loc}.`,
      '',
      'Problem(s):',
      formatMarkers(payload.markers),
      '',
      'Code with surrounding context (the target block to repair is between the markers):',
      '```' + (payload.language || ''),
      payload.contextBefore,
      '/* >>> target >>> */',
      payload.targetText,
      '/* <<< target <<< */',
      payload.contextAfter,
      '```',
      '',
      'Please propose and apply the fix.',
    ].join('\n');

    document.getElementById('chat-panel')?.classList.remove('hidden');
    bus.emit('chat:focus-with-prompt', prompt);
    window.PiPilot.chat?.sendMessage?.(prompt);
    bus.emit('toast:show', { message: 'Sent to chat for fix', type: 'info' });
  }

  function runMarkerExplain(payload) {
    const prompt = [
      `Explain this ${payload.language || 'code'} problem clearly:`,
      '',
      'Problem(s):',
      formatMarkers(payload.markers),
      '',
      'Target code:',
      '```' + (payload.language || '') + '\n' + payload.targetText + '\n```',
    ].join('\n');
    document.getElementById('chat-panel')?.classList.remove('hidden');
    bus.emit('chat:focus-with-prompt', prompt);
    window.PiPilot.chat?.sendMessage?.(prompt);
  }

  function findEditorForUri(uriStr) {
    if (!monaco?.editor?.getEditors) return null;
    for (const ed of monaco.editor.getEditors()) {
      const m = ed.getModel();
      if (m && m.uri?.toString() === uriStr) return ed;
    }
    return null;
  }

  function isPrimaryCodeEditor(ed) {
    try {
      const mainHost = document.getElementById('monaco-host');
      const container = ed?.getContainerDomNode?.();
      return !!(mainHost && container && mainHost.contains(container));
    } catch {
      return false;
    }
  }

  function addActionSafe(editor, descriptor) {
    if (!editor || !descriptor) return;
    try {
      return editor.addAction(descriptor);
    } catch (err) {
      // Silently retry without keybindings if the error is about KeybindingService
      const hasKeybindings = Array.isArray(descriptor.keybindings) && descriptor.keybindings.length > 0;
      if (hasKeybindings) {
        try {
          const fallback = { ...descriptor };
          delete fallback.keybindings;
          return editor.addAction(fallback);
        } catch { return; }
      }
    }
  }

  // ---------- Context menu actions (matches Vite EditorArea.tsx) ----------
  function registerEditorActions(editor) {
    function getFilePathFromModel(model) {
      try {
        const u = model?.uri?.toString?.();
        if (!u) return '';
        if (u.startsWith('file:///')) return decodeURIComponent(u.replace(/^file:\/\/\//, ''));
        const url = new URL(u);
        return decodeURIComponent(url.pathname || '').replace(/^\//, '');
      } catch {
        return '';
      }
    }

    function getEditorText(ed) {
      const model = ed.getModel?.();
      if (!model) return '';
      const sel = ed.getSelection?.();
      if (sel && !sel.isEmpty()) {
        const text = model.getValueInRange(sel);
        if (text.trim()) return text;
      }
      const pos = ed.getPosition?.();
      if (!pos) return '';
      const line = model.getLineContent(pos.lineNumber).trim();
      if (line) return line;
      const word = model.getWordAtPosition(pos);
      return word?.word ?? '';
    }

    // ── Context menu actions with keybindings (ESM CDN gives full KeybindingService) ──

    // Add File to Chat
    editor.addAction({
      id: 'pipilot.addFileToChat',
      label: 'Add File to Chat',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 1,
      run: (ed) => {
        const model = ed.getModel?.();
        if (!model) return;
        const filePath = getFilePathFromModel(model);
        if (!filePath) return;
        window.dispatchEvent(new CustomEvent('pipilot:attach-file', { detail: { filePath } }));
        window.dispatchEvent(new CustomEvent('pipilot:notify', {
          detail: { type: 'success', title: 'Added to chat', message: filePath.split(/[\\/]/).pop() || filePath },
        }));
        document.getElementById('chat-panel')?.classList.remove('hidden');
        bus.emit('chat:attach-file', { path: filePath, name: filePath.split(/[\\/]/).pop() });
      },
    });

    // Open Inline Chat
    editor.addAction({
      id: 'pipilot.openInlineChat',
      label: 'Open Inline Chat (Ctrl+I)',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 2,
      run: (ed) => {
        const pos = ed.getPosition?.();
        openInlineChat(ed, { line: pos?.lineNumber || 1, column: pos?.column || 1 });
      },
    });

    // Explain
    editor.addAction({
      id: 'pipilot.explain',
      label: 'Explain',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 3,
      run: (ed) => {
        const text = getEditorText(ed);
        if (!text) return;
        const prompt = `Explain this code:\n\`\`\`\n${text}\n\`\`\``;
        window.dispatchEvent(new CustomEvent('pipilot:open-chat'));
        window.dispatchEvent(new CustomEvent('pipilot:clear-attachments'));
        window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', { detail: { prefill: prompt, submit: true } }));
      },
    });

    // Review
    editor.addAction({
      id: 'pipilot.review',
      label: 'Review',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 4,
      run: (ed) => {
        const text = getEditorText(ed);
        if (!text) return;
        const prompt = `Review this code for bugs, performance issues, and best practices:\n\`\`\`\n${text}\n\`\`\``;
        window.dispatchEvent(new CustomEvent('pipilot:open-chat'));
        window.dispatchEvent(new CustomEvent('pipilot:clear-attachments'));
        window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', { detail: { prefill: prompt, submit: true } }));
      },
    });

    // Fix Selection
    editor.addAction({
      id: 'pipilot.fix',
      label: 'Fix Selection',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 5,
      run: (ed) => runQuickAction(ed, 'fix'),
    });

    // Refactor Selection
    editor.addAction({
      id: 'pipilot.refactor',
      label: 'Refactor Selection',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 6,
      run: (ed) => runQuickAction(ed, 'refactor'),
    });

    // Add Comments / Docs
    editor.addAction({
      id: 'pipilot.addDocs',
      label: 'Add Comments / Docs',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 7,
      run: (ed) => runQuickAction(ed, 'docs'),
    });

    // Toggle Inline Completions
    editor.addAction({
      id: 'pipilot.toggleGhost',
      label: 'Toggle Inline Completions',
      contextMenuGroupId: 'pipilot',
      contextMenuOrder: 10,
      run: () => {
        enabled = !enabled;
        bus.emit('toast:show', { message: `Inline completions ${enabled ? 'enabled' : 'disabled'}`, type: 'info' });
      },
    });

    // Hidden command for analytics
    try { monaco.editor.registerCommand?.('pipilot.trackCompletionShown', () => {}); } catch {}

    // ── Keyboard shortcuts via DOM (bypasses Monaco's KeybindingService entirely) ──
    editor.getDomNode()?.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        const pos = editor.getPosition?.();
        openInlineChat(editor, { line: pos?.lineNumber || 1, column: pos?.column || 1 });
      }
      if (mod && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
        e.preventDefault();
        e.stopPropagation();
        const pos = editor.getPosition?.();
        openInlineChat(editor, { line: pos?.lineNumber || 1, column: pos?.column || 1 });
      }
      if (mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        e.stopPropagation();
        addToChat(editor);
      }
      if (mod && !e.shiftKey && e.key === '.') {
        e.preventDefault();
        e.stopPropagation();
        editor.getAction('editor.action.quickFix')?.run();
      }
    });
  }

  // ---------- Actions ----------
  function getSelectionInfo(editor) {
    const model = editor.getModel();
    if (!model) return null;
    const sel = editor.getSelection();
    const hasSel = sel && !sel.isEmpty();
    const selText = hasSel ? model.getValueInRange(sel) : '';
    const filePath = model.uri?.path || '';
    const language = model.getLanguageId();
    return { model, sel, hasSel, selText, filePath, language };
  }

  function addToChat(editor) {
    const info = getSelectionInfo(editor);
    if (!info) return;
    const snippet = info.selText || info.model.getValue();
    const fileRef = info.filePath ? `@${info.filePath.replace(state.projectPath + '/', '')}` : '';
    const fence = '```' + (info.language || '') + '\n' + snippet + '\n```';
    const prompt = info.hasSel
      ? `From ${fileRef}\n\n${fence}\n\n`
      : `${fileRef}\n\n`;
    // Make sure the chat panel is visible
    document.getElementById('chat-panel')?.classList.remove('hidden');
    bus.emit('chat:focus-with-prompt', prompt);
    bus.emit('toast:show', { message: 'Added to chat', type: 'success' });
  }

  function promptFor(kind, selText, language) {
    const lang = language || 'code';
    switch (kind) {
      case 'explain':
        return `Explain what this ${lang} code does in plain language. Be concise:\n\n${selText}`;
      case 'fix':
        return `Fix bugs in this ${lang} code. Return ONLY the corrected code, no explanation, no markdown fences.\n\n${selText}`;
      case 'refactor':
        return `Refactor this ${lang} code for clarity and maintainability. Return ONLY the new code, no explanation, no markdown fences.\n\n${selText}`;
      case 'docs':
        return `Add helpful comments / doc-comments to this ${lang} code. Preserve behavior. Return ONLY the updated code, no explanation, no markdown fences.\n\n${selText}`;
      default:
        return selText;
    }
  }

  async function runQuickAction(editor, kind) {
    const info = getSelectionInfo(editor);
    if (!info) return;
    if (!info.hasSel) {
      bus.emit('toast:show', { message: 'Select some code first', type: 'warn' });
      return;
    }
    if (kind === 'explain') {
      // Send to main chat panel for longer conversation
      document.getElementById('chat-panel')?.classList.remove('hidden');
      bus.emit('chat:focus-with-prompt', promptFor('explain', info.selText, info.language));
      window.PiPilot.chat?.sendMessage?.(promptFor('explain', info.selText, info.language));
      return;
    }
    // fix/refactor/docs: apply as an in-place replacement
    await runInlinePrompt(editor, promptFor(kind, info.selText, info.language), { replaceSelection: true });
  }

  // ---------- Inline Chat widget ----------
  let currentWidget = null;

  function openInlineChat(editor, opts) {
    closeInlineChat();
    const info = getSelectionInfo(editor);
    if (!info) return;

    const pos = editor.getPosition?.();
    const line = opts?.line || info.sel?.startLineNumber || pos?.lineNumber || 1;
    const column = opts?.column || info.sel?.startColumn || pos?.column || 1;

    injectStyles();

    const widgetNode = document.createElement('div');
    widgetNode.className = 'inline-chat-widget';
    widgetNode.innerHTML = `
      <div class="row">
        <textarea placeholder="Ask for a change…" rows="1"></textarea>
      </div>
      <div class="preset-row">
        <span class="preset-chip" data-preset="fix">Fix bugs</span>
        <span class="preset-chip" data-preset="refactor">Refactor</span>
        <span class="preset-chip" data-preset="docs">Add docs</span>
        <span class="preset-chip" data-preset="tests">Write tests</span>
        <span class="preset-chip" data-preset="types">Add types</span>
      </div>
      <div class="hint">Enter to generate · Shift+Enter newline · Esc to close</div>
      <div class="preview" style="display:none;"></div>
      <div class="actions">
        <button class="btn btn-secondary btn-small" data-act="close">Close</button>
        <button class="btn btn-secondary btn-small" data-act="accept" style="display:none;">Accept</button>
        <button class="btn btn-primary btn-small" data-act="generate">Generate</button>
      </div>
    `;

    const widget = {
      domNode: widgetNode,
      suggestedText: '',
      range: info.hasSel ? info.sel : new monaco.Range(line, 1, line, 1),
      editor,
      info,
    };

    const contentWidget = {
      getId: () => 'pipilot.inlineChat',
      getDomNode: () => widgetNode,
      getPosition: () => ({
        position: { lineNumber: line, column },
        preference: [monaco.editor.ContentWidgetPositionPreference.BELOW, monaco.editor.ContentWidgetPositionPreference.ABOVE],
      }),
    };
    editor.addContentWidget(contentWidget);
    widget.contentWidget = contentWidget;
    currentWidget = widget;

    const textarea = widgetNode.querySelector('textarea');
    const previewEl = widgetNode.querySelector('.preview');
    const genBtn = widgetNode.querySelector('[data-act="generate"]');
    const acceptBtn = widgetNode.querySelector('[data-act="accept"]');
    const closeBtn = widgetNode.querySelector('[data-act="close"]');

    setTimeout(() => textarea.focus(), 30);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeInlineChat(); }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generate();
      }
    });
    closeBtn.addEventListener('click', closeInlineChat);
    genBtn.addEventListener('click', generate);
    acceptBtn.addEventListener('click', accept);

    widgetNode.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const preset = chip.dataset.preset;
        const map = {
          fix: 'Fix any bugs or issues in this code.',
          refactor: 'Refactor for clarity and maintainability without changing behavior.',
          docs: 'Add helpful inline comments and doc-comments.',
          tests: 'Write tests for this code.',
          types: 'Add type annotations.',
        };
        textarea.value = map[preset] || preset;
        textarea.focus();
      });
    });

    async function generate() {
      const userPrompt = textarea.value.trim();
      if (!userPrompt) return;
      genBtn.disabled = true;
      genBtn.innerHTML = '<span class="spinner"></span>Working…';
      previewEl.style.display = 'block';
      previewEl.textContent = '';
      acceptBtn.style.display = 'none';

      const selText = widget.info.selText || '';
      const sys = `You are a precise code editor. The user will request a change to a ${widget.info.language || 'code'} snippet. Return ONLY the rewritten code that replaces the selection — no explanations, no surrounding prose, no markdown fences.`;
      const userMsg = selText
        ? `Request: ${userPrompt}\n\nSelected code:\n${selText}`
        : `Request: ${userPrompt}\n\nContext file: ${widget.info.filePath}`;

      const handle = api.codestral.chatStream({
        messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }],
        temperature: 0.2,
        maxTokens: 2048,
      }, (evt) => {
        if (evt.type === 'text') {
          widget.suggestedText += evt.text;
          previewEl.textContent = widget.suggestedText;
          previewEl.scrollTop = previewEl.scrollHeight;
        } else if (evt.type === 'error') {
          previewEl.textContent = 'Error: ' + evt.message;
          genBtn.disabled = false;
          genBtn.textContent = 'Retry';
        } else if (evt.type === 'done') {
          genBtn.disabled = false;
          genBtn.textContent = 'Regenerate';
          if (widget.suggestedText) {
            acceptBtn.style.display = 'inline-flex';
            acceptBtn.focus();
          }
          handle.dispose();
        }
      });
      widget.suggestedText = '';
      widget.activeHandle = handle;
    }

    function accept() {
      if (!widget.suggestedText) return;
      applyReplacement(editor, widget.range, stripCodeFence(widget.suggestedText, widget.info.language));
      closeInlineChat();
    }
  }

  function closeInlineChat() {
    if (!currentWidget) return;
    try { currentWidget.editor.removeContentWidget(currentWidget.contentWidget); } catch {}
    try { currentWidget.activeHandle?.stop?.(); currentWidget.activeHandle?.dispose?.(); } catch {}
    currentWidget = null;
  }

  async function runInlinePrompt(editor, fullPrompt, { replaceSelection }) {
    const info = getSelectionInfo(editor);
    if (!info) return;
    bus.emit('toast:show', { message: 'Codestral is generating…', type: 'info' });
    const res = await api.codestral.chat({
      messages: [
        { role: 'system', content: 'You are a precise code editor. Return ONLY code, no prose, no markdown fences.' },
        { role: 'user', content: fullPrompt },
      ],
      temperature: 0.2,
      maxTokens: 2048,
    });
    if (!res?.ok) {
      bus.emit('toast:show', { message: 'Codestral: ' + (res?.error || 'unknown error'), type: 'error' });
      return;
    }
    const out = stripCodeFence(res.text, info.language);
    if (replaceSelection && info.hasSel) {
      applyReplacement(editor, info.sel, out);
    }
    bus.emit('toast:show', { message: 'Applied', type: 'success' });
  }

  function stripCodeFence(text, language) {
    if (!text) return '';
    const trimmed = text.trim();
    // Strip leading ```lang and trailing ```
    const fencePattern = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/;
    const m = trimmed.match(fencePattern);
    return m ? m[1] : trimmed;
  }

  function applyReplacement(editor, range, newText) {
    editor.executeEdits('pipilot', [{ range, text: newText, forceMoveMarkers: true }]);
  }

  // ---------- Boot: wait for monaco to be ready ----------
  function tryRegister() {
    if (registered) return;
    if (typeof monaco === 'undefined' || !monaco?.editor) return;
    registered = true;
    injectStyles();
    registerInlineCompletions();
    registerQuickFix();

    // Attach editor-level actions to every existing editor + future ones
    const editors = new Set();
    const wireEditor = (ed) => {
      if (!ed || editors.has(ed)) return;
      if (!isPrimaryCodeEditor(ed)) return;
      editors.add(ed);
      try { registerEditorActions(ed); } catch (e) { console.error('editor actions', e); }
    };
    monaco.editor.getEditors?.().forEach(wireEditor);
    monaco.editor.onDidCreateEditor?.(wireEditor);
  }

  bus.on('monaco:ready', tryRegister);
  // Poll as a fallback in case editor.js emits before we subscribed
  const iv = setInterval(() => {
    if (typeof monaco !== 'undefined' && monaco.editor) {
      tryRegister();
      clearInterval(iv);
    }
  }, 300);

  window.PiPilot.editorAi = {
    addToChat: () => {
      const ed = monaco?.editor?.getEditors?.()[0];
      if (ed) addToChat(ed);
    },
    openInlineChat: () => {
      const ed = monaco?.editor?.getEditors?.()[0];
      if (ed) openInlineChat(ed);
    },
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
  };

  // Vite parity: global event to open inline chat at a specific cursor position.
  // (e.detail = { line, column })
  window.addEventListener('pipilot:inline-chat', (e) => {
    const detail = (e && e.detail) || {};
    const ed = monaco?.editor?.getEditors?.()?.[0];
    if (!ed) return;
    openInlineChat(ed, { line: detail.line, column: detail.column });
  });
})();
