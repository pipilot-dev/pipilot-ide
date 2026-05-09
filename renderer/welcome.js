(() => {
  const { bus, api, state } = window.PiPilot;

  const welcomeScreenEl = document.getElementById('welcome-screen');
  const wsContentEl = welcomeScreenEl?.querySelector('.ws-content');
  const wsWalkthroughHostEl = document.getElementById('ws-walkthrough-host');

  function showWelcomeHome() {
    if (wsWalkthroughHostEl) {
      wsWalkthroughHostEl.classList.add('hidden');
      wsWalkthroughHostEl.innerHTML = '';
    }
    if (wsContentEl) wsContentEl.classList.remove('hidden');
  }

  function showWelcomeWalkthrough(kind) {
    if (!wsWalkthroughHostEl) return;
    if (wsContentEl) wsContentEl.classList.add('hidden');
    wsWalkthroughHostEl.classList.remove('hidden');

    if (kind === 'get-started') {
      wsWalkthroughHostEl.innerHTML = buildGettingStartedHTML();
    } else if (kind === 'ai-power') {
      wsWalkthroughHostEl.innerHTML = buildAIPowerHTML();
    } else if (kind === 'docs') {
      wsWalkthroughHostEl.innerHTML = buildDocsHTML();
    } else if (kind === 'shortcuts') {
      wsWalkthroughHostEl.innerHTML = buildShortcutsHTML();
    } else if (kind === 'about') {
      wsWalkthroughHostEl.innerHTML = buildAboutHTML();
    } else {
      wsWalkthroughHostEl.innerHTML = buildUnknownWalkthroughHTML(kind);
    }

    wireWalkthroughEvents(wsWalkthroughHostEl);
    wsWalkthroughHostEl.scrollTop = 0;
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

    return `<div class="wt-walkthrough" data-ws-walkthrough>
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

  function buildAIPowerHTML() {
    const steps = [
      { id: 'chat', title: 'Chat about your code', desc: 'Ask the AI agent to explain code, find bugs, or answer questions about your project.', done: true },
      { id: 'build', title: 'Build features with natural language', desc: 'Describe what you want and the agent will read, write, and run code for you.', done: true },
      { id: 'inline', title: 'AI-suggested inline completions', desc: 'As you type, PiPilot suggests code to help you complete what you started. Press Tab to accept, Esc to dismiss.', action: 'Try It', event: 'focus-editor' },
      { id: 'inline-chat', title: 'Use inline chat in the editor', desc: 'Select code and press Ctrl+I to open inline chat. Ask the AI to refactor, explain, or enhance your selection.', action: 'Try Ctrl+I', event: 'focus-editor' },
      { id: 'diagnostics', title: 'AI-powered diagnostics', desc: 'The agent can run diagnostics, find type errors, and fix them automatically. Click "AI Fix" on any problem.', action: 'Open Problems', event: 'open-problems' },
      { id: 'search', title: 'Smart codebase search', desc: 'Ask "how does X work?" and PiPilot will search your codebase for relevant context.' },
      { id: 'wiki', title: 'Generate project documentation', desc: 'The wiki-generator agent scans your code and creates comprehensive documentation with architecture diagrams.', action: 'Generate Wiki', event: 'generate-wiki' },
      { id: 'screenshot', title: 'Visual UI verification', desc: 'The agent can take screenshots of your running app and analyze layout to verify UI changes.' },
    ];

    return `<div class="wt-walkthrough" data-ws-walkthrough>
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

  function buildDocsHTML() {
    const sharedBuilder = window.PiPilot?.welcomeTab?.buildDocumentationHTML;
    if (typeof sharedBuilder === 'function') {
      return sharedBuilder({ withBack: true });
    }
    return `<div class="wt-walkthrough" data-ws-walkthrough>
      <button class="wt-back" data-action="back">← Back</button>
      <h1 class="wt-wk-h1">PiPilot IDE Documentation</h1>
      <p class="wt-wk-subtitle">Documentation view is currently unavailable.</p>
    </div>`;
  }

  function buildUnknownWalkthroughHTML(kind) {
    const safe = String(kind || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="wt-walkthrough" data-ws-walkthrough>
      <button class="wt-back" data-action="back">← Back</button>
      <h1 class="wt-wk-h1">Walkthrough</h1>
      <p class="wt-wk-subtitle">No walkthrough found for: ${safe}</p>
    </div>`;
  }

  function buildShortcutsHTML() {
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

    return `<div class="wt-walkthrough wt-shortcuts-page" style="max-width:980px;" data-ws-walkthrough>
      <button class="wt-back" data-action="back">← Back</button>

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
  }

  function buildAboutHTML() {
    return `<div class="wt-walkthrough wt-about-page" style="max-width:980px;" data-ws-walkthrough>
      <button class="wt-back" data-action="back">← Back</button>

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
            <div class="wt-about-metric-label">Build</div>
            <div class="wt-about-metric-value">Production</div>
          </div>
          <div class="wt-about-metric">
            <div class="wt-about-metric-label">Stack</div>
            <div class="wt-about-metric-value">Native Desktop</div>
          </div>
        </div>

        <div class="wt-about-note">&copy; ${new Date().getFullYear()} PiPilot. All rights reserved.</div>
      </section>
    </div>`;
  }

  function wireWalkthroughEvents(container) {
    container.querySelector('[data-action="back"]')?.addEventListener('click', showWelcomeHome);
    container.querySelectorAll('.wt-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const event = btn.dataset.event;
        if (event === 'open-folder') bus.emit('menu:file:open-folder');
        else if (event === 'toggle-terminal') bus.emit('menu:view:toggle-terminal');
        else if (event === 'open-git') bus.emit('panel:switch', 'git');
        else if (event === 'open-preview') bus.emit('devserver:start');
        else if (event === 'open-settings') bus.emit('modal:settings');
        else if (event === 'open-problems') bus.emit('bottom:show', 'problems');
        else if (event === 'focus-editor') {
          // Nothing to focus when no project is open.
        }
        else if (event === 'generate-wiki') {
          bus.emit('menu:view:toggle-chat');
          setTimeout(() => window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
            detail: { prefill: 'Use the wiki-generator sub-agent to generate project documentation.', submit: true },
          })), 200);
        }

        // Mark step as done
        const step = btn.closest('.wt-step');
        if (step) {
          step.classList.add('done');
          const check = step.querySelector('.wt-step-check');
          if (check) check.textContent = '✓';
        }
      });
    });
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const n = Date.now() - Number(ts);
    if (n < 0) return 'just now';
    const s = Math.floor(n / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  function basename(p) {
    if (!p) return '';
    const norm = String(p).replace(/[\\/]+$/, '');
    const parts = norm.split(/[\\/]/);
    return parts[parts.length - 1] || norm;
  }

  async function refreshRecent() {
    const list = $('#recent-projects-list');
    if (!list) return;
    let items = [];
    try { items = (await api.recentProjects.get()) || []; } catch { items = []; }

    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<div class="ws-recent-empty">No recent projects</div>';
      return;
    }

    items.forEach(item => {
      const name = item.name || basename(item.path);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:0;';

      const btn = document.createElement('button');
      btn.className = 'ws-recent-item';
      btn.style.flex = '1';
      btn.innerHTML = `<span class="ws-recent-name">${name}</span><span class="ws-recent-path">${item.path || ''}</span>`;
      btn.addEventListener('click', () => window.PiPilot.openProject(item.path));

      const removeBtn = document.createElement('button');
      removeBtn.style.cssText = 'background:none;border:none;color:#3d3d4a;cursor:pointer;padding:4px 8px;font-size:14px;opacity:1;';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove from list';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await api.recentProjects.remove(item.path); } catch {}
        refreshRecent();
      });

      row.appendChild(btn);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }

  function wireActions() {
    $('#welcome-open-folder')?.addEventListener('click', async () => {
      try {
        const p = await api.pickFolder();
        if (p) window.PiPilot.openProject(p);
      } catch {}
    });

    $('#welcome-clone-repo')?.addEventListener('click', () => {
      bus.emit('modal:clone-repo');
    });

    $('#welcome-ai-generate')?.addEventListener('click', () => showGenerateDialog());
    window.addEventListener('pipilot:show-generate-modal', () => showGenerateDialog());

    async function showGenerateDialog() {
      const overlay = document.createElement('div');
      overlay.className = 'gen-overlay';
      const dialog = document.createElement('div');
      dialog.className = 'gen-dialog';
      dialog.innerHTML = `
        <div class="gen-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
          <span class="gen-label">Generate with AI</span>
          <button class="gen-close" id="gen-close-x">&times;</button>
        </div>
        <div class="gen-body">
          <div class="gen-title">What do you want to build?</div>
          <div class="gen-desc">Describe your project and AI will create it for you. Be specific — mention the tech stack, features, and design style you want.</div>
          <textarea id="gen-prompt" class="gen-textarea" rows="4" placeholder="e.g. A modern dashboard app with React, Tailwind CSS, dark theme, sidebar navigation, charts, and a user settings page..."></textarea>
          <div class="gen-chips">
            <button class="gen-chip" data-prompt="A React portfolio website with dark theme, project showcase, and contact form">Portfolio</button>
            <button class="gen-chip" data-prompt="A full-stack Todo app with React frontend, Express API, and SQLite database">Todo App</button>
            <button class="gen-chip" data-prompt="A landing page for a SaaS product with hero section, features grid, pricing table, and FAQ">Landing Page</button>
            <button class="gen-chip" data-prompt="A real-time chat application with React, WebSocket server, message history, and user presence">Chat App</button>
            <button class="gen-chip" data-prompt="A REST API with Express, JWT authentication, user management, and Swagger documentation">REST API</button>
            <button class="gen-chip" data-prompt="A blog platform with Next.js, markdown support, syntax highlighting, and dark mode">Blog</button>
          </div>
          <div class="gen-attach-area">
            <button class="gen-attach-btn" id="gen-attach">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              Attach reference files (screenshots, designs, code)
            </button>
            <input type="file" id="gen-file-input" multiple hidden />
            <div class="gen-files" id="gen-files-list"></div>
          </div>
          <div class="gen-error" id="gen-error" style="display:none;"></div>
        </div>
        <div class="gen-footer">
          <button class="gen-cancel" id="gen-cancel">Cancel</button>
          <button class="gen-submit" id="gen-go">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21"/></svg>
            Generate Project
          </button>
        </div>
      `;
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const promptInput = dialog.querySelector('#gen-prompt');
      const errorEl = dialog.querySelector('#gen-error');
      const fileInput = dialog.querySelector('#gen-file-input');
      const filesList = dialog.querySelector('#gen-files-list');
      const attachedFiles = [];
      promptInput.focus();

      // Suggestion chips
      dialog.querySelectorAll('.gen-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          promptInput.value = chip.dataset.prompt;
          promptInput.focus();
        });
      });

      // File attach
      dialog.querySelector('#gen-attach').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        for (const f of fileInput.files) {
          attachedFiles.push(f);
          const tag = document.createElement('span');
          tag.className = 'gen-file-tag';
          tag.innerHTML = `${f.name} <button class="gen-file-remove">&times;</button>`;
          tag.querySelector('.gen-file-remove').addEventListener('click', () => {
            const idx = attachedFiles.indexOf(f);
            if (idx >= 0) attachedFiles.splice(idx, 1);
            tag.remove();
          });
          filesList.appendChild(tag);
        }
        fileInput.value = '';
      });

      const close = () => overlay.remove();
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      dialog.querySelector('#gen-cancel').addEventListener('click', close);
      dialog.querySelector('#gen-close-x').addEventListener('click', close);
      dialog.querySelector('#gen-go').addEventListener('click', () => {
        const prompt = promptInput.value.trim();
        if (!prompt) { errorEl.textContent = 'Please describe what you want to build'; errorEl.style.display = 'block'; return; }
        doGenerate(prompt, close, attachedFiles);
      });
      promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const prompt = promptInput.value.trim();
          if (prompt) doGenerate(prompt, close, attachedFiles);
        }
        if (e.key === 'Escape') close();
      });
    }

    async function doGenerate(prompt, closeFn, attachedFiles) {
      if (!prompt) return;
      const goBtn = document.querySelector('#gen-go');
      if (goBtn) { goBtn.innerHTML = '<span class="gen-spinner"></span> Creating…'; goBtn.disabled = true; goBtn.style.opacity = '0.7'; }

      try {
        const home = await api.getHome();
        const sep = home.includes('\\') ? '\\' : '/';
        const workspacesBase = `${home}${sep}PiPilot${sep}workspaces`;
        try { await api.files.mkdir(workspacesBase); } catch {}

        // Generate folder name via a0 LLM
        const folderName = await generateProjectFolder(prompt);
        const projectPath = `${workspacesBase}${sep}${folderName}`;

        try { await api.files.mkdir(projectPath); } catch {}

        // Copy any attached files into <project>/_attached/ so the
        // agent can Read them via absolute path. Previously we listed
        // the file names + sizes in the prompt but never put the bytes
        // anywhere on disk — the agent had no way to look at them.
        const importedPaths = [];
        if (attachedFiles && attachedFiles.length > 0) {
          const attachedDir = `${projectPath}${sep}_attached`;
          try { await api.files.mkdir(attachedDir); } catch {}
          const sources = [];
          for (const f of attachedFiles) {
            try {
              const p = api.files.pathForFile?.(f);
              if (p) sources.push(p);
            } catch {}
          }
          if (sources.length) {
            try {
              const r = await api.files.importExternal(sources, attachedDir);
              if (Array.isArray(r?.imported)) importedPaths.push(...r.imported);
            } catch (err) {
              console.warn('[generate] attach copy failed:', err.message);
            }
          }
        }

        // Build the full prompt — the agent's task description plus
        // workspace rules that match the chat agent's system prompt
        // (manual scaffolding, pnpm preference, no interactive CLIs)
        // and explicit Read-tool guidance for any attached files.
        let fullPrompt = prompt;
        fullPrompt += `\n\n--- Workspace rules ---`;
        fullPrompt += `\nWorking directory: ${projectPath}`;
        fullPrompt += `\n\n**Scaffolding rule** — Do NOT run interactive scaffolders (\`create-next-app\`, \`create-vite\`, \`npm init\`, \`yo\`, etc.). They block waiting for keyboard input that we can't provide. Instead:`;
        fullPrompt += `\n  1. Write every template file directly with the Write tool — package.json, tsconfig.json, vite.config.* / next.config.*, src/ entrypoints, public/index.html or index.html, .gitignore, README.md.`;
        fullPrompt += `\n  2. Then run \`pnpm install\` once to fetch deps.`;
        fullPrompt += `\n  3. Start the dev server in the background with \`pnpm <script>\` (see Bash run_in_background).`;
        fullPrompt += `\n\n**Package manager rule** — pnpm ONLY for this project. Never npm/npx/yarn (the chat agent's system prompt also enforces this). Translate any \`npm install foo\` → \`pnpm add foo\`, \`npm run dev\` → \`pnpm dev\`, \`npx tsc\` → \`pnpm dlx tsc\`. The single exception is \`npm i -g pnpm\` if pnpm itself isn't on PATH.`;
        fullPrompt += `\n\n**Project-root rule** — All source lives directly in ${projectPath}. Do NOT create a wrapper subfolder like \`my-app/\`.`;
        if (importedPaths.length) {
          fullPrompt += `\n\n--- Attached reference files ---`;
          fullPrompt += `\nThe user attached ${importedPaths.length} reference file${importedPaths.length === 1 ? '' : 's'} that have been copied into the project under \`_attached/\`. Read each one before designing — the user wants the build to take them into account.`;
          for (const p of importedPaths) fullPrompt += `\n  - ${p}`;
          fullPrompt += `\n\nWhen using an attached file in the actual build (logo image, config, sample data, etc.) MOVE it from \`_attached/\` into its final home (e.g. \`public/\`, \`src/assets/\`) with Bash mv — don't leave duplicates.`;
        }

        closeFn();
        window.PiPilot.openProject(projectPath);

        // Wait for project to fully load, then send the prompt
        await new Promise(resolve => {
          const onReady = () => { bus.off('project:opened', onReady); resolve(); };
          bus.on('project:opened', onReady);
          setTimeout(resolve, 3000); // fallback
        });

        // Open chat and send the prompt
        await new Promise(r => setTimeout(r, 500));
        const ideRoot = document.getElementById('ide-root');
        if (ideRoot?.classList.contains('chat-collapsed')) bus.emit('menu:view:toggle-chat');
        window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', { detail: { prefill: fullPrompt, submit: true } }));

      } catch (e) {
        console.error('ai-generate failed', e);
        if (goBtn) { goBtn.innerHTML = 'Generate Project'; goBtn.disabled = false; goBtn.style.opacity = ''; }
        const errorEl = document.querySelector('#gen-error');
        if (errorEl) { errorEl.textContent = 'Failed: ' + e.message; errorEl.style.display = 'block'; }
        bus.emit('toast:show', { message: 'Failed: ' + e.message, type: 'error' });
      }
    }

    const A0_URL = 'https://api.a0.dev/ai/llm';
    async function generateProjectFolder(prompt) {
      const trimmed = prompt.slice(0, 800);
      const ts = Date.now().toString(36).slice(-4); // short timestamp for uniqueness
      try {
        const res = await fetch(A0_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [
            { role: 'system', content: 'You generate short, descriptive project folder names from user prompts.\nRules:\n- Return ONLY the folder name. No quotes, no markdown, no explanation.\n- 2 to 4 lowercase words, joined by hyphens.\n- Filesystem safe — only [a-z0-9-]. No spaces, no slashes.\n- Max 30 characters.\n- Be specific and memorable. Avoid generic names like "my-app" or "project".\nExamples:\n  Prompt: "A landing page for a synthwave music label" → synthwave-label-site\n  Prompt: "Todo app with offline sync" → offline-todo\n  Prompt: "Personal portfolio with case studies" → portfolio-cases' },
            { role: 'user', content: trimmed },
          ] }),
        });
        if (!res.ok) throw new Error('a0 ' + res.status);
        const data = await res.json();
        let name = (data?.completion || '').trim().toLowerCase()
          .replace(/^["'`]+|["'`]+$/g, '')
          .replace(/[^a-z0-9\s-]+/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 30);
        if (name) return `${name}-${ts}`;
      } catch {}
      // Fallback: slug from first 4 words + timestamp
      const slug = trimmed.replace(/[^a-zA-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ').toLowerCase().replace(/\s+/g, '-').slice(0, 30) || 'ai-project';
      return `${slug}-${ts}`;
    }

    // Hydrate progress + "Updated" badge from localStorage so the
    // standalone-welcome cards mirror the welcome-tab cards exactly.
    const WK_VERSIONS = { 'getting-started': '1', 'ai-power': '2', 'docs': '1' };
    const clampPct = (n) => {
      const v = parseInt(n, 10);
      if (!Number.isFinite(v)) return 0;
      return Math.max(0, Math.min(100, v));
    };
    $$('.ws-card[data-wk-id]').forEach(card => {
      const id = card.dataset.wkId;
      const pct = clampPct(localStorage.getItem('pipilot.walkthrough.progress.' + id) || '0');
      card.dataset.progress = pct;
      const fill = card.querySelector('.ws-card-progress-fill');
      if (fill) fill.style.width = pct + '%';
      const badge = card.querySelector('.ws-card-badge[data-show="updated"]');
      if (badge) {
        const lastSeen = localStorage.getItem('pipilot.walkthrough.seen.' + id) || '';
        const current = WK_VERSIONS[id] || '1';
        badge.dataset.visible = lastSeen === current ? '0' : '1';
      }
    });

    $$('.ws-card[data-tutorial]').forEach(card => {
      card.addEventListener('click', () => {
        // Mark the walkthrough as seen so the "Updated" pill clears next render
        const wkId = card.dataset.wkId;
        if (wkId) {
          try { localStorage.setItem('pipilot.walkthrough.seen.' + wkId, WK_VERSIONS[wkId] || '1'); } catch {}
          const badge = card.querySelector('.ws-card-badge[data-show="updated"]');
          if (badge) badge.dataset.visible = '0';
        }
        const t = card.dataset.tutorial;
        // Walkthroughs should work even when no project is open.
        // If a project is open, use the richer editor-tab experience.
        if (t === 'get-started') {
          if (state.projectPath && window.PiPilot?.welcomeTab?.openGettingStarted) {
            window.PiPilot.welcomeTab.openGettingStarted();
          } else {
            showWelcomeWalkthrough('get-started');
          }
          return;
        }

        if (t === 'ai-power') {
          if (state.projectPath && window.PiPilot?.welcomeTab?.openAIPower) {
            window.PiPilot.welcomeTab.openAIPower();
          } else {
            showWelcomeWalkthrough('ai-power');
          }
          return;
        }

        if (t === 'docs') {
          // Docs view is project-oriented (welcome tab). On welcome screen, fall back to the docs walkthrough if present.
          if (state.projectPath && window.PiPilot?.welcomeTab?.openDocs) {
            window.PiPilot.welcomeTab.openDocs();
          } else {
            showWelcomeWalkthrough('docs');
          }
          return;
        }

        bus.emit('tutorial:show', t);
      });
    });
  }

  function init() {
    wireActions();
    refreshRecent();

    // Standalone welcome screen: route Help menu items to integrated welcome views
    bus.on('menu:help:welcome', () => {
      if (!state.projectPath) showWelcomeHome();
    });
    bus.on('menu:help:getting-started', () => {
      if (!state.projectPath) showWelcomeWalkthrough('get-started');
    });
    bus.on('menu:help:docs', () => {
      if (!state.projectPath) showWelcomeWalkthrough('docs');
    });
    bus.on('menu:help:shortcuts', () => {
      if (!state.projectPath) showWelcomeWalkthrough('shortcuts');
    });
    bus.on('menu:help:about', () => {
      if (!state.projectPath) showWelcomeWalkthrough('about');
    });

    bus.on('project:opened', refreshRecent);
    bus.on('project:closed', refreshRecent);
    bus.on('recent:refresh', refreshRecent);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
