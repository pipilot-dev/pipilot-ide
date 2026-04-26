// PiPilot IDE — Auto-update wiki docs after agent makes meaningful changes
//
// Listens on bus('wiki:auto-update') from chat.js, throttles, and spawns a
// silent background agent that updates .pipilot/wikis/*.md to reflect the
// changed files. Runs in the same process via the existing api.agent.send
// IPC, but with `silent: true` so history isn't polluted, the session is
// hidden from the chat list, and tools are restricted to FS only.

(function () {
  'use strict';
  if (window.__pipilotWikiAutoUpdateLoaded) return;
  window.__pipilotWikiAutoUpdateLoaded = true;

  const bus = window.PiPilot && window.PiPilot.bus;
  const api = (window.PiPilot && window.PiPilot.api) || window.electronAPI;
  if (!bus || !api?.agent?.send) {
    console.warn('[wiki-auto-update] bus or api missing — disabled');
    return;
  }

  let running = false;
  let lastRunAt = 0;
  let cooldownMs = 5 * 60 * 1000;
  let enabled = true;

  // Pull settings (best effort — defaults are safe).
  (async () => {
    try {
      const r = await api.settings?.get?.('autoUpdateWiki');
      if (r && r.value === false) enabled = false;
    } catch {}
    try {
      const r = await api.settings?.get?.('autoUpdateWikiCooldownMs');
      if (r && typeof r.value === 'number' && r.value > 0) cooldownMs = r.value;
    } catch {}
  })();

  try {
    api.settings?.onChanged?.(({ key, value }) => {
      if (key === 'autoUpdateWiki') enabled = value !== false;
      if (key === 'autoUpdateWikiCooldownMs' && typeof value === 'number' && value > 0) cooldownMs = value;
    });
  } catch {}

  const WIKI_SYSTEM_PROMPT = [
    'You are PiPilot Wiki Maintainer — a focused background agent.',
    '',
    'Your ONLY job is to keep the wiki at <projectPath>/.pipilot/wikis/ in sync with',
    'the codebase. You do NOT write, edit, or refactor source code. You ONLY edit',
    'markdown files inside .pipilot/wikis/.',
    '',
    'Workflow:',
    '1. Use the pipilot search/read tools to inspect the changed source files the',
    '   user lists below — understand what actually changed.',
    '2. List the existing wiki pages in .pipilot/wikis/. If none exist, do nothing',
    '   and reply with "No wiki to update".',
    '3. Identify which existing pages are affected. Update ONLY those pages, using',
    '   the Edit tool — never Write — to preserve existing prose, voice, and order.',
    '4. If the change introduces a brand-new module/feature with no existing page,',
    '   add a section to modules.md (or the closest existing index page) rather',
    '   than creating a new top-level page.',
    '5. Skip cosmetic-only diffs (formatting, comments, pure renames that don\'t',
    '   affect public API) — reply "No wiki update needed".',
    '',
    'Rules:',
    '- Never modify files outside .pipilot/wikis/.',
    '- Never run shell commands, package managers, or web requests.',
    '- Be concise. No <reasoning> blocks. No long preamble.',
    '- End your final reply with exactly one line:',
    '    Updated: page-a.md, page-b.md',
    '  or',
    '    No wiki update needed',
  ].join('\n');

  function buildWikiPrompt(changedFiles, summary, projectPath) {
    const files = (changedFiles || []).map(f => '- ' + f).join('\n');
    const head = summary ? `Summary of the change:\n${String(summary).slice(0, 1200)}\n\n` : '';
    return [
      `Project root: ${projectPath}`,
      `Wiki directory: ${projectPath}/.pipilot/wikis`,
      '',
      head + 'Files changed by the user\'s coding agent:',
      files || '(none)',
      '',
      'Update the wiki accordingly per the rules in your system prompt. Be terse.',
    ].join('\n');
  }

  bus.on('wiki:auto-update', async (payload) => {
    if (!enabled) return;
    if (running) return;
    if (Date.now() - lastRunAt < cooldownMs) return;
    const { projectPath, changedFiles, summary } = payload || {};
    if (!projectPath || !Array.isArray(changedFiles) || !changedFiles.length) return;

    running = true;
    console.log('[wiki-auto-update] starting agent', { changedFiles, projectPath });
    bus.emit('wiki:auto-status', { state: 'running' });

    const sessionId = '__wiki__' + Date.now();
    let stream = null;
    let finalText = '';
    let timedOut = false;
    const TIMEOUT_MS = 4 * 60 * 1000;

    const timer = setTimeout(() => {
      timedOut = true;
      try { stream && stream.stop && stream.stop(); } catch {}
    }, TIMEOUT_MS);

    try {
      await new Promise((resolve) => {
        stream = api.agent.send({
          sessionId,
          projectPath,
          message: buildWikiPrompt(changedFiles, summary, projectPath),
          mode: 'agent',
          effort: 'low',
          silent: true,
          systemPromptOverride: WIKI_SYSTEM_PROMPT,
          allowedToolsOverride: [
            'Read', 'Edit', 'Write', 'Glob', 'Grep', 'MultiEdit',
            'mcp__pipilot__*',
          ],
        }, (evt) => {
          if (!evt) return;
          // Verbose breadcrumbs so the lifecycle is visible in DevTools.
          if (evt.type === 'tool_call') {
            console.log('[wiki-auto-update] tool_call', evt.name, evt.input && Object.keys(evt.input));
          } else if (evt.type === 'tool_result') {
            console.log('[wiki-auto-update] tool_result', { isError: evt.isError, len: (evt.content || '').length });
          } else if (evt.type === 'error') {
            console.warn('[wiki-auto-update] agent error event', evt.message);
          } else if (evt.type === 'result') {
            console.log('[wiki-auto-update] agent result', { subtype: evt.subtype, durationMs: evt.durationMs, isError: evt.is_error });
          }
          if (evt.type === 'text' && typeof evt.text === 'string') {
            finalText += evt.text;
          } else if (evt.type === 'result' || evt.type === 'error') {
            resolve();
          }
        });
      });

      const cleanFinal = finalText.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim();
      const tail = cleanFinal.split('\n').slice(-5).join(' ').toLowerCase();
      const updated = /updated:\s*\S/.test(tail);
      const skipped = /no wiki (update needed|to update)/.test(tail);
      console.log('[wiki-auto-update] done', { timedOut, updated, skipped, finalChars: cleanFinal.length, tailPreview: tail.slice(0, 200) });

      if (timedOut) {
        bus.emit('toast:show', { type: 'warn', message: 'Wiki auto-update timed out' });
      } else if (updated) {
        bus.emit('toast:show', { type: 'ok', message: 'Wiki updated' });
        bus.emit('wiki:refresh');
      } else if (skipped) {
        bus.emit('toast:show', { type: 'info', message: 'Wiki: no update needed' });
      } else if (!cleanFinal) {
        bus.emit('toast:show', { type: 'warn', message: 'Wiki agent returned no output' });
      } else {
        bus.emit('toast:show', { type: 'info', message: 'Wiki agent finished' });
        bus.emit('wiki:refresh');
      }
    } catch (err) {
      console.warn('[wiki-auto-update] failed:', err);
      bus.emit('toast:show', { type: 'warn', message: 'Wiki auto-update failed' });
    } finally {
      try { clearTimeout(timer); } catch {}
      try { stream && stream.dispose && stream.dispose(); } catch {}
      lastRunAt = Date.now();
      running = false;
      bus.emit('wiki:auto-status', { state: 'idle' });
    }
  });

  window.PiPilot = window.PiPilot || {};
  window.PiPilot.wikiAutoUpdate = {
    isRunning: () => running,
    lastRunAt: () => lastRunAt,
  };
})();
