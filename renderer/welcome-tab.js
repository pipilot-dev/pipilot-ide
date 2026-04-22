// PiPilot IDE — Welcome Tab + Walkthroughs (opens as editor tabs like VSCode)

(() => {
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;
  const api = window.electronAPI;

  const WELCOME_ID = '__welcome__';
  const GETTING_STARTED_ID = '__walkthrough_getting_started__';
  const AI_POWER_ID = '__walkthrough_ai_power__';
  const RECENT_FILES_PREFIX = 'pipilot:recent-files:';

  function normalizeProjectKey(projectPath) {
    return String(projectPath || '').replace(/\\/g, '/').toLowerCase();
  }

  function recentFilesStorageKey(projectPath) {
    return RECENT_FILES_PREFIX + normalizeProjectKey(projectPath);
  }

  function relToProject(filePath, projectPath) {
    const fp = String(filePath || '').replace(/\\/g, '/');
    const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!root) return fp;
    if (fp.toLowerCase().startsWith((root + '/').toLowerCase())) return fp.slice(root.length + 1);
    return fp;
  }

  function toAbsoluteFromProject(relPath, projectPath) {
    const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root || !rel) return '';
    return `${root}/${rel}`;
  }

  // ── Welcome Tab ──
  function openWelcomeTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: WELCOME_ID,
      name: 'Welcome',
      icon: '🏠',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildWelcomeHTML();
        wireWelcomeEvents(container);
      },
    });
  }

  function buildWelcomeHTML() {
    return `<div class="wt-welcome">
      <div class="wt-welcome-inner">
        <div class="wt-welcome-left">
          <div class="wt-logo">
            <img src="public/icon.png" width="36" height="36" style="border-radius:8px;" />
            <span class="wt-logo-text">PiPilot IDE</span>
          </div>

          <h2 class="wt-section-title">Start</h2>
          <div class="wt-start-links">
            <button class="wt-link" data-action="new-file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6M9 15h6"/></svg>
              New File
            </button>
            <button class="wt-link" data-action="open-folder">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Open Folder...
            </button>
            <button class="wt-link" data-action="clone-repo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
              Clone Git Repository...
            </button>
            <button class="wt-link" data-action="new-project">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
              Generate New Project with AI...
            </button>
          </div>

          <h2 class="wt-section-title">Recent</h2>
          <div class="wt-recent" id="wt-recent-list">Loading...</div>
        </div>

        <div class="wt-welcome-right">
          <h2 class="wt-section-title">Walkthroughs</h2>
          <div class="wt-walkthroughs">
            <button class="wt-walkthrough-card" data-walkthrough="getting-started">
              <div class="wt-wk-icon" style="background:linear-gradient(135deg,#0078d4,#00b4d8);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
              </div>
              <div class="wt-wk-info">
                <div class="wt-wk-title">Get Started with PiPilot</div>
                <div class="wt-wk-desc">Customize your editor, learn the basics, and start coding</div>
              </div>
            </button>
            <button class="wt-walkthrough-card" data-walkthrough="ai-power">
              <div class="wt-wk-icon" style="background:linear-gradient(135deg,#FF6B35,#ff9a5c);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <div class="wt-wk-info">
                <div class="wt-wk-title">AI Power User</div>
                <div class="wt-wk-desc">Your AI pair programmer to write code faster and smarter</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div class="wt-footer">
        <label class="wt-checkbox"><input type="checkbox" id="wt-show-on-startup" checked /> Show welcome page on startup</label>
      </div>
    </div>`;
  }

  async function wireWelcomeEvents(container) {
    // Start actions
    container.querySelector('[data-action="new-file"]')?.addEventListener('click', () => bus.emit('menu:file:new-file'));
    container.querySelector('[data-action="open-folder"]')?.addEventListener('click', async () => {
      const p = await api.pickFolder(); if (p) bus.emit('project:open', p);
    });
    container.querySelector('[data-action="clone-repo"]')?.addEventListener('click', () => bus.emit('modal:clone-repo'));
    container.querySelector('[data-action="new-project"]')?.addEventListener('click', () => {
      // Use the same generate dialog from welcome.js
      window.dispatchEvent(new CustomEvent('pipilot:show-generate-modal'));
    });

    // Walkthroughs
    container.querySelector('[data-walkthrough="getting-started"]')?.addEventListener('click', openGettingStartedTab);
    container.querySelector('[data-walkthrough="ai-power"]')?.addEventListener('click', openAIPowerTab);

    // Show on startup checkbox
    const cb = container.querySelector('#wt-show-on-startup');
    const saved = localStorage.getItem('pipilot-show-welcome');
    if (saved === 'false') cb.checked = false;
    cb?.addEventListener('change', () => localStorage.setItem('pipilot-show-welcome', cb.checked));

    // Recent files in current project
    const list = container.querySelector('#wt-recent-list');
    try {
      const projectPath = state.projectPath;
      const raw = projectPath ? localStorage.getItem(recentFilesStorageKey(projectPath)) : null;
      const parsed = Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [];
      const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
      const rootPrefix = (root + '/').toLowerCase();

      // Keep only paths that belong to this project, and store as relative paths.
      const recents = parsed
        .map((entry) => {
          const s = String(entry || '').replace(/\\/g, '/');
          if (!s) return null;
          if (s.toLowerCase().startsWith(rootPrefix)) return s.slice(root.length + 1);
          if (!s.includes(':') && !s.startsWith('/')) return s.replace(/^\/+/, '');
          return null;
        })
        .filter(Boolean)
        .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i)
        .slice(0, 20);

      try { if (projectPath) localStorage.setItem(recentFilesStorageKey(projectPath), JSON.stringify(recents)); } catch {}

      if (!projectPath || !recents.length) {
        list.innerHTML = '<div class="wt-no-recent">No recently opened files</div>';
      } else {
        list.innerHTML = '';
        recents.slice(0, 10).forEach(relPath => {
          const rel = String(relPath || '').replace(/\\/g, '/');
          const fullPath = toAbsoluteFromProject(rel, projectPath);
          const name = rel.split(/[\\/]/).pop();

          const row = document.createElement('div');
          row.className = 'wt-recent-row';

          const btn = document.createElement('button');
          btn.className = 'wt-recent-item';
          btn.dataset.path = fullPath;
          btn.innerHTML = `<span class="wt-recent-name">${name}</span><span class="wt-recent-path">${rel}</span>`;
          btn.addEventListener('click', () => bus.emit('file:open', { path: btn.dataset.path }));

          const removeBtn = document.createElement('button');
          removeBtn.className = 'wt-recent-remove';
          removeBtn.title = 'Remove from list';
          removeBtn.textContent = '×';
          removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const next = recents.filter(p => String(p).replace(/\\/g, '/') !== rel);
              localStorage.setItem(recentFilesStorageKey(projectPath), JSON.stringify(next));
            } catch {}
            row.remove();
            if (!list.children.length) {
              list.innerHTML = '<div class="wt-no-recent">No recently opened files</div>';
            }
          });

          row.appendChild(btn);
          row.appendChild(removeBtn);
          list.appendChild(row);
        });
      }
    } catch { list.innerHTML = '<div class="wt-no-recent">No recently opened files</div>'; }
  }

  // ── Getting Started Walkthrough ──
  function openGettingStartedTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: GETTING_STARTED_ID,
      name: 'Getting Started',
      icon: '🚀',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildGettingStartedHTML();
        wireWalkthroughEvents(container);
      },
    });
  }

  function buildGettingStartedHTML() {
    const steps = [
      { id: 'open-project', title: 'Open a project folder', desc: 'Open an existing folder or clone a repository to get started.', action: 'Open Folder', event: 'open-folder' },
      { id: 'explore-editor', title: 'Explore the editor', desc: 'Open files from the explorer, use tabs, breadcrumbs, and keyboard shortcuts to navigate.', done: true },
      { id: 'use-terminal', title: 'Use the integrated terminal', desc: 'Run commands, start dev servers, and manage your project from the built-in terminal.', action: 'Open Terminal', event: 'toggle-terminal' },
      { id: 'source-control', title: 'Track changes with Git', desc: 'Stage, commit, push, and manage branches from the Source Control panel.', action: 'Open Source Control', event: 'open-git' },
      { id: 'preview', title: 'Preview your project', desc: 'Start a dev server and see live changes in the built-in preview panel.', action: 'Open Preview', event: 'open-preview' },
      { id: 'customize', title: 'Customize your settings', desc: 'Adjust font size, themes, auto-save, and editor behavior from Settings.', action: 'Open Settings', event: 'open-settings' },
    ];

    return `<div class="wt-walkthrough">
      <button class="wt-back" data-action="back">← Back</button>
      <div class="wt-wk-header">
        <h1 class="wt-wk-h1">Get Started with PiPilot</h1>
        <p class="wt-wk-subtitle">Customize your editor, learn the basics, and start coding</p>
      </div>
      <div class="wt-steps">
        ${steps.map(s => `
          <div class="wt-step ${s.done ? 'done' : ''}" data-step="${s.id}">
            <div class="wt-step-check">${s.done ? '✓' : '○'}</div>
            <div class="wt-step-content">
              <div class="wt-step-title">${s.title}</div>
              <div class="wt-step-desc">${s.desc}</div>
              ${s.action ? `<button class="wt-step-btn" data-event="${s.event}">${s.action}</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  // ── AI Power User Walkthrough ──
  function openAIPowerTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: AI_POWER_ID,
      name: 'AI Power User',
      icon: '🤖',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildAIPowerHTML();
        wireWalkthroughEvents(container);
      },
    });
  }

  function buildAIPowerHTML() {
    const steps = [
      { id: 'chat', title: 'Chat about your code', desc: 'Ask the AI agent to explain code, find bugs, or answer questions about your project.', done: true },
      { id: 'build', title: 'Build features with natural language', desc: 'Describe what you want and the agent will read, write, and run code for you.', done: true },
      { id: 'inline', title: 'AI-suggested inline completions', desc: 'As you type, PiPilot suggests code to help you complete what you started. Press Tab to accept, Esc to dismiss.', action: 'Try It', event: 'focus-editor' },
      { id: 'inline-chat', title: 'Use inline chat in the editor', desc: 'Select code and press Ctrl+I to open inline chat. Ask the AI to refactor, explain, or enhance your selection.', action: 'Try Ctrl+I', event: 'focus-editor' },
      { id: 'diagnostics', title: 'AI-powered diagnostics', desc: 'The agent can run diagnostics, find type errors, and fix them automatically. Click "AI Fix" on any problem.', action: 'Open Problems', event: 'open-problems' },
      { id: 'search', title: 'Smart codebase search', desc: 'The agent uses BM25 semantic search to understand your codebase. Ask "how does X work?" and get relevant results.', },
      { id: 'wiki', title: 'Generate project documentation', desc: 'The wiki-generator agent scans your code and creates comprehensive documentation with architecture diagrams.', action: 'Generate Wiki', event: 'generate-wiki' },
      { id: 'screenshot', title: 'Visual UI verification', desc: 'The agent can take screenshots of your running app and analyze the DOM layout to verify UI changes.', },
    ];

    return `<div class="wt-walkthrough">
      <button class="wt-back" data-action="back">← Back</button>
      <div class="wt-wk-header">
        <h1 class="wt-wk-h1">AI Power User</h1>
        <p class="wt-wk-subtitle">Your AI pair programmer to write code faster and smarter</p>
      </div>
      <div class="wt-steps">
        ${steps.map(s => `
          <div class="wt-step ${s.done ? 'done' : ''}" data-step="${s.id}">
            <div class="wt-step-check">${s.done ? '✓' : '○'}</div>
            <div class="wt-step-content">
              <div class="wt-step-title">${s.title}</div>
              <div class="wt-step-desc">${s.desc}</div>
              ${s.action ? `<button class="wt-step-btn" data-event="${s.event}">${s.action}</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  function wireWalkthroughEvents(container) {
    container.querySelector('[data-action="back"]')?.addEventListener('click', openWelcomeTab);
    container.querySelectorAll('.wt-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const event = btn.dataset.event;
        if (event === 'open-folder') bus.emit('menu:file:open-folder');
        else if (event === 'toggle-terminal') bus.emit('menu:view:toggle-terminal');
        else if (event === 'open-git') bus.emit('panel:switch', 'git');
        else if (event === 'open-preview') bus.emit('devserver:start');
        else if (event === 'open-settings') bus.emit('modal:settings');
        else if (event === 'open-problems') bus.emit('bottom:show', 'problems');
        else if (event === 'focus-editor') { /* just close the tab */ }
        else if (event === 'generate-wiki') {
          bus.emit('menu:view:toggle-chat');
          setTimeout(() => window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
            detail: { prefill: 'Use the wiki-generator sub-agent to generate project documentation.', submit: true },
          })), 200);
        }
        // Mark step as done
        const step = btn.closest('.wt-step');
        if (step) { step.classList.add('done'); step.querySelector('.wt-step-check').textContent = '✓'; }
      });
    });
  }

  // ── CSS ──
  function injectStyles() {
    if (document.getElementById('welcome-tab-css')) return;
    const s = document.createElement('style');
    s.id = 'welcome-tab-css';
    s.textContent = `
.wt-welcome { padding: 40px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
.wt-welcome-inner { display: flex; gap: 60px; flex: 1; max-width: 960px; margin: 0 auto; width: 100%; }
.wt-welcome-left { flex: 1; min-width: 0; }
.wt-welcome-right { flex: 1; min-width: 0; }
.wt-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
.wt-logo-text { font-size: 20px; font-weight: 600; color: var(--text-strong); }
.wt-section-title { font-size: 14px; font-weight: 600; color: var(--text-mid); text-transform: uppercase; letter-spacing: 0.06em; margin: 24px 0 12px; }
.wt-start-links { display: flex; flex-direction: column; gap: 4px; }
.wt-link {
  display: flex; align-items: center; gap: 10px; padding: 6px 8px;
  background: transparent; border: none; color: var(--info); font-size: 13px;
  cursor: pointer; border-radius: 4px; text-align: left; font-family: inherit;
}
.wt-link:hover { background: var(--surface-alt); }
.wt-link svg { color: var(--text-dim); flex-shrink: 0; }
.wt-recent { display: flex; flex-direction: column; gap: 2px; }
.wt-recent-row { display: flex; align-items: center; gap: 6px; }
.wt-recent-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;
  padding: 6px 8px; background: transparent; border: none;
  cursor: pointer; border-radius: 4px; text-align: left; font-family: inherit;
  min-width: 0;
}
.wt-recent-item:hover { background: var(--surface-alt); }
.wt-recent-name { color: var(--info); font-size: 13px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-recent-path { color: var(--text-dim); font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-recent-remove {
  background: transparent;
  border: none;
  color: var(--text-dim);
  opacity: 1;
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  flex: 0 0 auto;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.wt-recent-remove:hover { background: var(--surface-alt); color: var(--text-strong); }
.wt-no-recent { color: var(--text-dim); font-size: 12px; padding: 8px; }
.wt-walkthrough-card {
  display: flex; align-items: center; gap: 14px; width: 100%;
  padding: 14px 16px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; cursor: pointer; text-align: left; font-family: inherit;
  margin-bottom: 8px; transition: border-color 0.15s, background 0.15s;
}
.wt-walkthrough-card:hover { border-color: var(--accent); background: var(--surface-alt); }
.wt-wk-icon {
  width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.wt-wk-info { flex: 1; min-width: 0; }
.wt-wk-title { font-size: 13px; font-weight: 600; color: var(--text-strong); }
.wt-wk-desc { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
.wt-footer { text-align: center; padding: 16px; }
.wt-checkbox { font-size: 12px; color: var(--text-dim); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.wt-checkbox input { accent-color: var(--accent); }

/* Walkthrough pages */
.wt-walkthrough { padding: 40px; max-width: 700px; margin: 0 auto; }
.wt-back {
  background: transparent; border: none; color: var(--text-dim); font-size: 12px;
  cursor: pointer; padding: 4px 0; margin-bottom: 16px; font-family: inherit;
}
.wt-back:hover { color: var(--text); }
.wt-wk-header { margin-bottom: 32px; }
.wt-wk-h1 { font-size: 28px; font-weight: 300; color: var(--text-strong); margin: 0 0 8px; }
.wt-wk-subtitle { font-size: 15px; color: var(--text-dim); margin: 0; line-height: 1.5; }
.wt-steps { display: flex; flex-direction: column; gap: 4px; }
.wt-step {
  display: flex; gap: 12px; padding: 12px 16px;
  border-radius: 6px; transition: background 0.1s;
  border: 1px solid transparent;
}
.wt-step:hover { background: var(--surface-alt); border-color: var(--border); }
.wt-step-check {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; border: 1.5px solid var(--text-dim); color: var(--text-dim);
  margin-top: 2px;
}
.wt-step.done .wt-step-check {
  background: var(--accent); border-color: var(--accent); color: white;
  font-size: 11px; font-weight: 700;
}
.wt-step-content { flex: 1; min-width: 0; }
.wt-step-title { font-size: 13px; font-weight: 500; color: var(--text-strong); margin-bottom: 4px; }
.wt-step-desc { font-size: 12px; color: var(--text-dim); line-height: 1.5; margin-bottom: 8px; }
.wt-step-btn {
  padding: 5px 14px; font-size: 11px; font-weight: 500;
  background: var(--accent); color: white; border: none;
  border-radius: 4px; cursor: pointer;
}
.wt-step-btn:hover { filter: brightness(1.1); }
/* Docs */
.wt-docs-page {
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.wt-docs-hero {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: radial-gradient(circle at top right, rgba(255,107,53,0.16), transparent 48%),
              radial-gradient(circle at 18% 120%, rgba(74,144,229,0.16), transparent 42%),
              linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0));
  padding: 24px;
}
.wt-docs-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.18);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-light);
}
.wt-docs-lead {
  margin: 12px 0 0;
  color: var(--text-mid);
  font-size: 14px;
  line-height: 1.65;
  max-width: 720px;
}
.wt-docs-stats {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 10px;
}
.wt-docs-stat {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: rgba(0,0,0,0.14);
}
.wt-docs-stat-value { font-size: 18px; color: var(--text-strong); font-weight: 700; letter-spacing: -0.02em; }
.wt-docs-stat-label { font-size: 11px; color: var(--text-dim); margin-top: 2px; }

.wt-docs-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wt-docs-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-mid);
  font-size: 11px;
  font-family: var(--font-mono);
}

.wt-docs-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 860px) {
  .wt-docs-grid { grid-template-columns: 1fr; }
  .wt-docs-stats { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
}

.wt-docs-section {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.015), transparent 30%), var(--surface);
  padding: 14px;
}
.wt-docs-section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.wt-docs-icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-light);
  background: rgba(255,107,53,0.15);
  border: 1px solid rgba(255,107,53,0.2);
  font-size: 13px;
}
.wt-docs-title {
  font-size: 15px;
  color: var(--text-strong);
  margin: 0;
  letter-spacing: -0.01em;
}
.wt-docs-list { list-style: none; padding: 0; margin: 0; }
.wt-docs-list li {
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-mid);
  line-height: 1.6;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.wt-docs-list li:last-child { border-bottom: none; }
.wt-docs-list li strong { color: var(--text-strong); font-weight: 600; }
.wt-docs-list li kbd {
  background: var(--surface-alt);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--accent-light);
}

/* Shortcuts + About (premium pages) */
.wt-shortcuts-page,
.wt-about-page {
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.wt-panel-hero {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: radial-gradient(circle at top right, rgba(255,107,53,0.14), transparent 45%),
              radial-gradient(circle at 0% 100%, rgba(74,144,229,0.14), transparent 40%),
              linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0));
  padding: 22px;
}
.wt-panel-kicker {
  display: inline-flex;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-light);
}
.wt-panel-lead { margin-top: 10px; color: var(--text-mid); font-size: 14px; line-height: 1.6; max-width: 760px; }

.wt-shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 860px) { .wt-shortcuts-grid { grid-template-columns: 1fr; } }
.wt-shortcuts-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255,255,255,0.015), transparent 30%), var(--surface);
  padding: 12px;
}
.wt-shortcuts-card h2 {
  margin: 0 0 10px;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-mid);
}
.wt-shortcuts-table { display: flex; flex-direction: column; gap: 2px; }
.wt-shortcut-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.wt-shortcut-row:last-child { border-bottom: none; }
.wt-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 122px;
  padding: 4px 8px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-strong);
  flex-shrink: 0;
}
.wt-shortcut-desc { font-size: 12px; color: var(--text-mid); line-height: 1.45; }

.wt-about-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  background: linear-gradient(180deg, rgba(255,255,255,0.015), transparent 30%), var(--surface);
}
.wt-about-top {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.wt-about-logo {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  box-shadow: 0 10px 26px rgba(255,107,53,0.22);
}
.wt-about-title { margin: 0; font-size: 22px; font-weight: 650; color: var(--text-strong); letter-spacing: -0.01em; }
.wt-about-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--text-dim); }
.wt-about-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 860px) { .wt-about-grid { grid-template-columns: 1fr; } }
.wt-about-metric {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  background: rgba(0,0,0,0.14);
}
.wt-about-metric-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
.wt-about-metric-value { margin-top: 4px; font-size: 13px; color: var(--text-strong); }
.wt-about-note {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.06);
  font-size: 11px;
  color: var(--text-dim);
}
    `;
    document.head.appendChild(s);
  }

  function buildDocumentationViewHTML(opts = {}) {
    const showBack = !!opts.withBack;
    return `<div class="wt-walkthrough wt-docs-page" style="max-width:1040px;">
      ${showBack ? '<button class="wt-back" data-action="back">← Back</button>' : ''}

      <section class="wt-docs-hero">
        <div class="wt-docs-kicker">Reference · Documentation</div>
        <h1 class="wt-wk-h1" style="margin-top:12px;">PiPilot IDE Documentation</h1>
        <p class="wt-docs-lead">A complete guide to the editor, AI tooling, terminals, source control, and preview workflow. Built for fast onboarding and daily expert usage.</p>
        <div class="wt-docs-stats">
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">6</div><div class="wt-docs-stat-label">Core Surfaces</div></div>
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">20+</div><div class="wt-docs-stat-label">Power Features</div></div>
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">10+</div><div class="wt-docs-stat-label">Shortcuts</div></div>
          <div class="wt-docs-stat"><div class="wt-docs-stat-value">1</div><div class="wt-docs-stat-label">Unified Workflow</div></div>
        </div>
      </section>

      <div class="wt-docs-quick">
        <span class="wt-docs-chip">⌨ Ctrl+P Quick Open</span>
        <span class="wt-docs-chip">🤖 Ctrl+I AI Chat</span>
        <span class="wt-docs-chip">🧪 Problems + AI Fix</span>
        <span class="wt-docs-chip">🌐 Built-in Preview</span>
        <span class="wt-docs-chip">🧭 Source Control</span>
      </div>

      <div class="wt-docs-grid">
        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">📝</span><h2 class="wt-docs-title">Editor</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Tabs</strong> — Open multiple files, drag to reorder, middle-click to close, right-click for context actions.</li>
            <li><strong>Breadcrumbs</strong> — Navigate parent folders and symbols with fewer clicks.</li>
            <li><strong>Split Preview</strong> — For HTML/MD/SVG, open code and rendered output side by side.</li>
            <li><strong>Word Wrap + Minimap</strong> — Comfortable long-file reading with structure awareness.</li>
            <li><strong>Auto Save</strong> — Save after edits with minimal friction from File settings.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">✨</span><h2 class="wt-docs-title">AI Features</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Chat Panel</strong> — Open from titlebar and drive code changes end to end.</li>
            <li><strong>Inline Completions</strong> — Accept ghost text with <kbd>Tab</kbd>, dismiss with <kbd>Esc</kbd>.</li>
            <li><strong>Inline Chat</strong> — Select code + <kbd>Ctrl+I</kbd> for local refactors and explanations.</li>
            <li><strong>Selection Actions</strong> — Add to chat, inline transform, or enhance selected code instantly.</li>
            <li><strong>Diagnostics Hover</strong> — Use quick fix and AI fix directly on squiggles.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">🛠</span><h2 class="wt-docs-title">Agent Tools</h2></div>
          <ul class="wt-docs-list">
            <li><strong>get_diagnostics</strong> — TypeScript and JSON problem detection for fast remediation.</li>
            <li><strong>project_context</strong> — Framework, dependency, and structure awareness before edits.</li>
            <li><strong>search_codebase</strong> — Grep, files, symbols, and semantic BM25 search.</li>
            <li><strong>screenshot_preview</strong> — Visual verification with screenshot capture and DOM context.</li>
            <li><strong>frontend_design_guide</strong> — Design-token aware UI planning and improvements.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">📦</span><h2 class="wt-docs-title">Panels</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Explorer</strong> — Lazy-loaded tree with batch actions and context operations.</li>
            <li><strong>Search</strong> — Project-wide search with regex and replace support.</li>
            <li><strong>Source Control</strong> — Stage, commit, pull, push, branch, stash, merge, reset.</li>
            <li><strong>Outline</strong> — Symbol-level navigation for active file structure.</li>
            <li><strong>Wiki + Extensions + Checkpoints</strong> — Docs generation, MCP, and safe snapshots.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">🌐</span><h2 class="wt-docs-title">Preview</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Dev Server Detection</strong> — Auto-detects npm scripts and opens preview fast.</li>
            <li><strong>Static Preview</strong> — Works for plain HTML projects with zero config.</li>
            <li><strong>Responsive Modes</strong> — Desktop, tablet, and mobile viewpoints.</li>
            <li><strong>Runtime Console</strong> — Consolidated browser and server console signals.</li>
            <li><strong>URL Bar</strong> — Inspect local or external endpoints from the same pane.</li>
          </ul>
        </section>

        <section class="wt-docs-section">
          <div class="wt-docs-section-head"><span class="wt-docs-icon">▸</span><h2 class="wt-docs-title">Terminal</h2></div>
          <ul class="wt-docs-list">
            <li><strong>Multiple Sessions</strong> — Run parallel tasks and separate logs by terminal.</li>
            <li><strong>Shell Profiles</strong> — PowerShell, cmd, Git Bash, and custom shells.</li>
            <li><strong>Localhost Detection</strong> — Instant Open in Preview when servers boot.</li>
            <li><strong>Clipboard Flow</strong> — Full copy/paste command workflow support.</li>
            <li><strong>IDE Integration</strong> — Terminal, problems, and preview aligned in one loop.</li>
          </ul>
        </section>
      </div>
    </div>`;
  }

  // ── Documentation Tab ──
  function openDocsTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: '__docs__',
      name: 'Documentation',
      icon: '📖',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = buildDocumentationViewHTML({ withBack: false });
      },
    });
  }

  // ── Keyboard Shortcuts Tab ──
  function openShortcutsTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    const shortcuts = [
      ['General', [
        ['Ctrl+S', 'Save file'], ['Ctrl+Shift+S', 'Save all files'], ['Ctrl+W', 'Close tab'],
        ['Ctrl+P', 'Quick open file'], ['Ctrl+Shift+P', 'Command palette'],
        ['Ctrl+B', 'Toggle sidebar'], ['Ctrl+`', 'Toggle terminal'], ['Ctrl+I', 'Toggle chat / Inline chat'],
      ]],
      ['Editor', [
        ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'], ['Ctrl+D', 'Select word'],
        ['Ctrl+/', 'Toggle line comment'], ['Ctrl+Shift+V', 'Toggle dual preview'],
        ['Tab', 'Accept inline completion'], ['Esc', 'Dismiss completion / Close inline chat'],
        ['Ctrl+.', 'Quick Fix'], ['Alt+F8', 'Next problem'],
      ]],
      ['Navigation', [
        ['Ctrl+G', 'Go to line'], ['Ctrl+Shift+O', 'Go to symbol'],
        ['Ctrl+Click', 'Go to definition'], ['Alt+Left', 'Navigate back'], ['Alt+Right', 'Navigate forward'],
      ]],
      ['File Explorer', [
        ['Ctrl+A', 'Select all files (when explorer focused)'], ['Delete', 'Delete selected files'],
        ['Escape', 'Clear selection'],
      ]],
    ];
    editor.openVirtualTab({
      id: '__shortcuts__',
      name: 'Keyboard Shortcuts',
      icon: '⌨',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = `<div class="wt-walkthrough wt-shortcuts-page" style="max-width:980px;">
          <section class="wt-panel-hero">
            <div class="wt-panel-kicker">Reference · Shortcuts</div>
            <h1 class="wt-wk-h1" style="margin-top:10px;">Keyboard Shortcuts</h1>
            <p class="wt-panel-lead">Speed up your workflow with key combinations for navigation, editing, terminal control, and AI actions.</p>
          </section>

          <div class="wt-shortcuts-grid">
            ${shortcuts.map(([group, keys]) => `
              <section class="wt-shortcuts-card">
                <h2>${group}</h2>
                <div class="wt-shortcuts-table">
                  ${keys.map(([key, desc]) => `
                    <div class="wt-shortcut-row">
                      <kbd class="wt-kbd">${key}</kbd>
                      <span class="wt-shortcut-desc">${desc}</span>
                    </div>
                  `).join('')}
                </div>
              </section>
            `).join('')}
          </div>
        </div>`;
      },
    });
  }

  // ── About Tab ──
  function openAboutTab() {
    const editor = window.PiPilot?.editor;
    if (!editor) return;
    editor.openVirtualTab({
      id: '__about__',
      name: 'About',
      icon: 'ℹ',
      mount: (container) => {
        container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';
        container.innerHTML = `<div class="wt-walkthrough wt-about-page" style="max-width:980px;">
          <section class="wt-panel-hero">
            <div class="wt-panel-kicker">Product · About</div>
            <h1 class="wt-wk-h1" style="margin-top:10px;">About PiPilot IDE</h1>
            <p class="wt-panel-lead">PiPilot is an AI-native coding environment designed to keep editing, execution, diagnostics, and AI-assisted iteration in one continuous flow.</p>
          </section>

          <section class="wt-about-card">
            <div class="wt-about-top">
              <img src="public/icon.png" width="52" height="52" class="wt-about-logo" />
              <div>
                <h2 class="wt-about-title">PiPilot IDE</h2>
                <p class="wt-about-subtitle">AI-native development environment</p>
              </div>
            </div>

            <div class="wt-about-grid">
              <div class="wt-about-metric">
                <div class="wt-about-metric-label">Version</div>
                <div class="wt-about-metric-value">1.0.0</div>
              </div>
              <div class="wt-about-metric">
                <div class="wt-about-metric-label">Runtime</div>
                <div class="wt-about-metric-value">Node.js ${typeof process !== 'undefined' ? process.version : ''}</div>
              </div>
              <div class="wt-about-metric">
                <div class="wt-about-metric-label">Stack</div>
                <div class="wt-about-metric-value">Electron + Ace + Agent SDK</div>
              </div>
            </div>

            <div class="wt-about-note">&copy; ${new Date().getFullYear()} PiPilot. All rights reserved.</div>
          </section>
        </div>`;
      },
    });
  }
  function handleCloseProject() {
    // Close all editor tabs
    const editor = window.PiPilot?.editor;
    if (editor) {
      try { editor.closeAllFiles?.(); } catch {}
    }
    // Open the Welcome tab as the landing state
    setTimeout(openWelcomeTab, 100);
  }

  // ── Init ──
  function init() {
    injectStyles();

    // Open welcome tab on startup if setting is enabled
    const showWelcome = localStorage.getItem('pipilot-show-welcome');
    if (showWelcome !== 'false') {
      bus.on('project:opened', () => {
        setTimeout(openWelcomeTab, 300);
      });
    }

    // Handle Help menu items
    bus.on('menu:help:welcome', openWelcomeTab);
    bus.on('menu:help:getting-started', openGettingStartedTab);
    bus.on('menu:help:docs', openDocsTab);
    bus.on('menu:help:shortcuts', openShortcutsTab);
    bus.on('menu:help:about', openAboutTab);

    // Handle close project — show welcome tab instead of going to welcome screen
    bus.on('menu:file:close-folder', handleCloseProject);

    // Expose for other modules
    window.PiPilot.welcomeTab = {
      open: openWelcomeTab,
      openGettingStarted: openGettingStartedTab,
      openAIPower: openAIPowerTab,
      openDocs: openDocsTab,
      buildDocumentationHTML: buildDocumentationViewHTML,
      openShortcuts: openShortcutsTab,
      openAbout: openAboutTab,
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
