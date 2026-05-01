// PiPilot IDE — Sidebar panel renderers (Phase 5)
// Registered on window.PiPilot.panels — sidebar.js calls these for git/extensions/checkpoints/deploy.

(function () {
  const api = window.electronAPI;
  const bus = window.PiPilot.bus;
  const state = window.PiPilot.state;

  // Sensible default .gitignore — keeps secrets, build outputs, OS junk, and
  // PiPilot internal scratch out of source control. Written verbatim when a
  // project is initialized through the Source Control panel and no
  // .gitignore already exists.
  const DEFAULT_GITIGNORE = `# Dependencies
node_modules/
bower_components/
jspm_packages/
.pnp/
.pnp.js
.yarn/cache
.yarn/unplugged
.yarn/build-state.yml
.yarn/install-state.gz
vendor/

# Build output
dist/
build/
out/
.next/
.nuxt/
.svelte-kit/
.turbo/
.parcel-cache/
target/
*.tsbuildinfo

# Environment / secrets
.env
.env.local
.env.*.local
*.pem
*.key
*.crt
secrets.json
credentials.json

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*
logs/

# Test / coverage
coverage/
.nyc_output/
*.lcov

# Caches
.cache/
.eslintcache
.stylelintcache
.npm/

# Editor / IDE
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db
Desktop.ini
$RECYCLE.BIN/

# PiPilot internals
.pipilot/checkpoints/
.pipilot/search-index.json
.pipilot/bug-findings.jsonl
`;

  async function ensureDefaultGitignore(projectPath) {
    if (!projectPath) return false;
    try {
      const ignorePath = projectPath + '/.gitignore';
      const s = await api.files.stat(ignorePath);
      let existing = '';
      if (s && s.exists) {
        try {
          const r = await api.files.read(ignorePath);
          existing = (r && (r.content ?? r.data ?? r)) || '';
          if (typeof existing !== 'string') existing = String(existing || '');
        } catch { existing = ''; }
        // main/ipc-git.js auto-writes a 2-line stub (.pipilot/checkpoints/
        // + .pipilot/search-index.json) on every git:status call. If that
        // stub is all that's there, treat as "no real .gitignore" and
        // replace with our comprehensive default. Real user-authored
        // gitignores will contain node_modules or similar — those we leave
        // strictly alone.
        const looksLikeAutoStub =
          !/node_modules|\.env|dist\/|build\//i.test(existing) &&
          existing.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length <= 4;
        if (!looksLikeAutoStub) return false;
      }
      const r = await api.files.write(ignorePath, DEFAULT_GITIGNORE);
      if (r && r.ok === false) return false;
      // Notify with an Open action so the user can review and tune it
      const notif = window.PiPilot.notifications;
      if (notif) {
        notif.show({
          severity: 'info',
          message: 'Created default .gitignore',
          detail: 'Excludes node_modules, .env, build output, OS junk, and PiPilot internals.',
          source: 'Git',
          sticky: true,
          actions: [{
            label: 'Open',
            primary: true,
            onClick: () => bus.emit('file:open', { path: ignorePath }),
          }, {
            label: 'Dismiss',
            onClick: () => {},
          }],
        });
      }
      bus.emit('files:refresh');
      return true;
    } catch (err) {
      console.warn('[git] ensureDefaultGitignore failed:', err);
      return false;
    }
  }

  // ── Media-aware diff for binary files in the SC panel ──────
  const SC_MEDIA_EXTS = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp',
    avif:'image/avif', bmp:'image/bmp', ico:'image/x-icon', svg:'image/svg+xml',
    mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', mkv:'video/x-matroska', m4v:'video/mp4', ogv:'video/ogg',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', m4a:'audio/mp4', aac:'audio/aac', opus:'audio/opus',
    pdf:'application/pdf',
  };
  function isMediaPath(p) {
    const name = (p || '').split(/[\\/]/).pop().toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return !!SC_MEDIA_EXTS[ext];
  }
  function hasNul(s) {
    if (!s) return false;
    const head = s.length > 8192 ? s.slice(0, 8192) : s;
    return head.indexOf(String.fromCharCode(0)) !== -1;
  }
  function fmtBytesSC(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // Open a side-by-side preview of a binary file's HEAD version vs the
  // working-tree (or staged) version. For images this lets you see the
  // before/after at a glance — same as GitHub's binary diff view.
  async function openWorkingTreeMediaTab(projectPath, filePath, staged) {
    const editor = window.PiPilot?.editor;
    if (!editor?.openVirtualTab) return;
    const fileName = filePath.split(/[\\/]/).pop();
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const mime = SC_MEDIA_EXTS[ext] || 'application/octet-stream';
    const kind = mime.startsWith('image/') ? 'image'
              : mime.startsWith('video/') ? 'video'
              : mime.startsWith('audio/') ? 'audio'
              : mime === 'application/pdf' ? 'pdf'
              : 'binary';
    const id = `git-diff-bin://${projectPath}/${filePath}/${staged ? 'staged' : 'wt'}`;
    editor.openVirtualTab({
      id,
      name: 'Diff: ' + fileName,
      mount: async (container) => {
        container.style.cssText = 'display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text);';
        container.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--surface);border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:11px;color:var(--text-dim);flex-shrink:0;">
            <span style="color:var(--text-strong);font-weight:600;">${escapeHtml(filePath)}</span>
            <span style="margin-left:auto;color:var(--text-dim);">${kind === 'binary' ? 'Binary file' : kind} · HEAD vs ${staged ? 'Staged' : 'Working Tree'}</span>
          </div>
          <div id="bin-grid" style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);overflow:hidden;">
            <div id="pane-old" style="background:var(--bg);display:flex;flex-direction:column;min-width:0;"></div>
            <div id="pane-new" style="background:var(--bg);display:flex;flex-direction:column;min-width:0;"></div>
          </div>
        `;
        const oldPane = container.querySelector('#pane-old');
        const newPane = container.querySelector('#pane-new');

        function paneHeader(title, color) {
          const h = document.createElement('div');
          h.style.cssText = `padding:5px 10px;font-family:var(--font-mono);font-size:11px;color:${color};border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;`;
          h.textContent = title;
          return h;
        }
        function paneBody() {
          const b = document.createElement('div');
          b.style.cssText = 'flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:repeating-conic-gradient(#1a1a1f 0% 25%, #232329 0% 50%) 50% / 16px 16px;';
          return b;
        }
        function showLoading(body) { body.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">Loading…</div>'; }
        function showMissing(body, label) { body.style.background = 'var(--bg)'; body.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:24px;">${escapeHtml(label)}</div>`; }
        function showMedia(body, base64, sz) {
          body.innerHTML = '';
          const dataUrl = `data:${mime};base64,${base64}`;
          let mediaEl;
          if (kind === 'image') {
            mediaEl = document.createElement('img');
            mediaEl.src = dataUrl;
            mediaEl.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
          } else if (kind === 'video') {
            mediaEl = document.createElement('video');
            mediaEl.src = dataUrl; mediaEl.controls = true;
            mediaEl.style.cssText = 'max-width:100%;max-height:100%;margin:auto;display:block;';
          } else if (kind === 'audio') {
            mediaEl = document.createElement('audio');
            mediaEl.src = dataUrl; mediaEl.controls = true;
            mediaEl.style.cssText = 'min-width:280px;margin:auto;';
            body.style.background = 'var(--bg)';
          } else if (kind === 'pdf') {
            mediaEl = document.createElement('iframe');
            mediaEl.src = dataUrl;
            mediaEl.style.cssText = 'width:100%;height:100%;border:none;';
            body.style.background = 'var(--bg)';
          } else {
            body.style.background = 'var(--bg)';
            body.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:24px;">Binary file (${escapeHtml(fmtBytesSC(sz))}) — preview not supported.</div>`;
            return;
          }
          body.appendChild(mediaEl);
          const meta = document.createElement('div');
          meta.style.cssText = 'position:absolute;bottom:6px;right:8px;font-family:var(--font-mono);font-size:10px;color:var(--text-dim);background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:3px;';
          meta.textContent = fmtBytesSC(sz);
          body.style.position = 'relative';
          body.appendChild(meta);
        }
        function showTooLarge(body, sz, max) {
          body.style.background = 'var(--bg)';
          body.innerHTML = `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:24px;line-height:1.5;">${escapeHtml(fmtBytesSC(sz))} exceeds the ${escapeHtml(fmtBytesSC(max))} preview cap.</div>`;
        }

        // Build panes
        oldPane.appendChild(paneHeader('HEAD', 'var(--text-dim)'));
        const oldBody = paneBody(); oldPane.appendChild(oldBody);
        newPane.appendChild(paneHeader(staged ? 'Staged' : 'Working Tree', 'var(--accent)'));
        const newBody = paneBody(); newPane.appendChild(newBody);
        showLoading(oldBody); showLoading(newBody);

        // ── Load HEAD version (binary) ──
        try {
          const r = await api.git.showFileBinary(projectPath, 'HEAD', filePath);
          if (!r || r.ok === false) showMissing(oldBody, 'Not in HEAD (new file)');
          else if (r.tooLarge) showTooLarge(oldBody, r.size, r.maxBytes);
          else showMedia(oldBody, r.base64, r.size);
        } catch { showMissing(oldBody, 'Not in HEAD'); }

        // ── Load working tree (or staged) version ──
        if (staged) {
          // Staged binary read isn't supported by our IPC layer — point user to disk.
          showMissing(newBody, 'Staged binary preview not supported. Use the working tree.');
        } else {
          try {
            const r = await api.files.read(projectPath + '/' + filePath);
            if (!r || (r.binary === false && typeof r.content === 'string' && !r.dataUrl)) {
              showMissing(newBody, 'No preview available');
            } else if (r.binary && r.dataUrl) {
              // Reuse the showMedia path by extracting base64 + size from the data URL
              const m = /^data:[^;]+;base64,(.*)$/.exec(r.dataUrl);
              const base64 = m ? m[1] : '';
              showMedia(newBody, base64, r.size || 0);
            } else if (r.binary && !r.dataUrl) {
              showTooLarge(newBody, r.size || 0, 25 * 1024 * 1024);
            } else {
              // Text file but extension said media — unusual; just show the editor link
              showMissing(newBody, 'Not previewable as media');
            }
          } catch {
            const exists = await api.files.stat(projectPath + '/' + filePath).then(s => !!(s && s.exists)).catch(() => false);
            showMissing(newBody, exists ? 'Could not read working tree' : 'File not found on disk (deleted)');
          }
        }
      },
    });
  }

  // ── Remote helpers ─────────────────────────────────────────
  function deriveRemoteName(url, takenSet) {
    // Pull a sensible name from the URL (e.g. https://github.com/USER/REPO.git → USER)
    const m = (url || '').match(/[:/]([^/]+)\/[^/]+?(?:\.git)?\/?$/);
    let base = m ? m[1].toLowerCase().replace(/[^a-z0-9_-]/g, '') : 'remote';
    if (!takenSet || !takenSet.has(base)) return base;
    let i = 2;
    while (takenSet.has(base + i)) i++;
    return base + i;
  }

  async function openManageRemotesModal(projectPath) {
    if (!projectPath) return;

    function load() {
      return api.git.listRemotes(projectPath).then(r => (r?.ok && Array.isArray(r.remotes)) ? r.remotes : []).catch(() => []);
    }

    let remotes = await load();

    // Render rows into a container element; re-call to refresh after add/remove.
    function renderRows(listEl) {
      listEl.innerHTML = '';
      if (!remotes.length) {
        const empty = el('div', { style: 'padding:18px 12px;text-align:center;color:var(--text-dim);font-size:12px;' });
        empty.textContent = 'No remotes configured.';
        listEl.appendChild(empty);
        return;
      }
      remotes.forEach((r) => {
        const row = el('div', { style: 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);' });
        const meta = el('div', { style: 'flex:1;min-width:0;' });
        const name = el('div', { style: 'font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text-strong);' });
        name.textContent = r.name;
        const url = el('div', { style: 'font-family:var(--font-mono);font-size:11px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;' });
        url.textContent = r.fetch || r.push || '';
        url.title = url.textContent;
        meta.appendChild(name); meta.appendChild(url);
        row.appendChild(meta);

        const removeBtn = el('button', {
          style: 'background:transparent;border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text-dim);cursor:pointer;font-size:13px;line-height:1;',
          title: `Remove "${r.name}"`,
        });
        removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>';
        removeBtn.addEventListener('mouseenter', () => { removeBtn.style.color = 'var(--error)'; removeBtn.style.borderColor = 'var(--error)'; });
        removeBtn.addEventListener('mouseleave', () => { removeBtn.style.color = 'var(--text-dim)'; removeBtn.style.borderColor = 'var(--border)'; });
        removeBtn.addEventListener('click', async () => {
          const ok = await (window.PiPilot?.modal?.confirm?.({ title: 'Remove remote?', message: `Remove "${r.name}" (${url.textContent})?`, danger: true, confirmText: 'Remove' }) || Promise.resolve(confirm(`Remove remote "${r.name}"?`)));
          if (!ok) return;
          if (typeof api.git.removeRemote !== 'function') {
            bus.emit('toast:show', { type: 'error', message: 'Remove remote API missing — fully quit and relaunch the app.', source: 'Git' });
            return;
          }
          let res;
          try {
            res = await api.git.removeRemote(projectPath, r.name);
          } catch (err) {
            console.error('[git] removeRemote IPC rejected:', err);
            bus.emit('toast:show', { type: 'error', message: 'Remove failed (IPC): ' + (err?.message || err) + '. Try fully restarting the app.', source: 'Git' });
            return;
          }
          if (!res || res.ok === false) {
            bus.emit('toast:show', { type: 'error', message: 'Remove failed: ' + (res?.error || 'unknown'), source: 'Git' });
            return;
          }
          bus.emit('toast:show', { type: 'ok', message: `Removed "${r.name}"`, source: 'Git' });
          remotes = await load();
          renderRows(listEl);
        });
        row.appendChild(removeBtn);
        listEl.appendChild(row);
      });
    }

    return new Promise((resolve) => {
      const body = el('div', { style: 'min-width:420px;max-width:560px;' });

      // Add-remote row
      const addRow = el('div', { style: 'display:flex;gap:6px;padding:10px;border-bottom:1px solid var(--border);background:var(--surface-alt);' });
      const urlInput = el('input', {
        type: 'text',
        placeholder: 'Paste a remote URL — https://github.com/user/repo.git',
        style: 'flex:1;height:30px;padding:0 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:var(--font-mono);outline:none;',
      });
      urlInput.addEventListener('focus', () => urlInput.style.borderColor = 'var(--accent)');
      urlInput.addEventListener('blur', () => urlInput.style.borderColor = 'var(--border)');
      const addBtn = el('button', {
        style: 'background:var(--accent);color:#fff;border:none;border-radius:4px;padding:0 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;',
      });
      addBtn.textContent = 'Add';
      const listEl = el('div', { style: 'max-height:320px;overflow-y:auto;' });
      async function doAdd() {
        const url = urlInput.value.trim();
        if (!url) return;
        const taken = new Set(remotes.map(r => r.name));
        const name = taken.has('origin') ? deriveRemoteName(url, taken) : 'origin';
        addBtn.disabled = true; addBtn.textContent = 'Adding…';
        let res;
        try { res = await api.git.addRemote(projectPath, name, url); }
        catch (err) {
          addBtn.disabled = false; addBtn.textContent = 'Add';
          bus.emit('toast:show', { type: 'error', message: 'Add failed (IPC): ' + (err?.message || err), source: 'Git' });
          return;
        }
        addBtn.disabled = false; addBtn.textContent = 'Add';
        if (!res || res.ok === false) {
          bus.emit('toast:show', { type: 'error', message: 'Add failed: ' + (res?.error || 'unknown'), source: 'Git' });
          return;
        }
        urlInput.value = '';
        bus.emit('toast:show', { type: 'ok', message: `Added "${name}"`, source: 'Git' });
        remotes = await load();
        renderRows(listEl);
      }
      addBtn.addEventListener('click', doAdd);
      urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
      addRow.appendChild(urlInput);
      addRow.appendChild(addBtn);
      body.appendChild(addRow);
      body.appendChild(listEl);
      renderRows(listEl);

      // Footer with a Done button (uses the existing modal footer slot)
      const footer = el('div', { style: 'display:flex;justify-content:flex-end;gap:8px;' });
      const doneBtn = el('button', { style: 'background:var(--surface-alt);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 14px;font-size:12px;cursor:pointer;font-family:inherit;' });
      doneBtn.textContent = 'Done';
      footer.appendChild(doneBtn);

      const handle = window.PiPilot.modal.show(body, {
        title: 'Manage Remotes',
        width: 580,
        footer,
        onClose: () => resolve(),
      });
      doneBtn.addEventListener('click', () => handle.close());
      setTimeout(() => urlInput.focus(), 30);
    });
  }

  function injectStyles() {
    if (document.getElementById('panels-inline-styles')) return;
    const css = `
.p-section { padding: 8px 12px; border-bottom: 1px solid var(--border); }
.p-section h4 { color: var(--text-mid); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; font-weight: 600; }
.p-row {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; font-size: var(--fs-sm);
  border-radius: 3px; cursor: pointer;
}
.p-row:hover { background: var(--surface-alt); }
.p-row .name { flex: 1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-row .badge-mini { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); }
.p-row .badge-M { background: rgba(108,182,255,0.15); color: var(--info); }
.p-row .badge-A { background: rgba(86,211,100,0.15); color: var(--ok); }
.p-row .badge-D { background: rgba(229,83,75,0.15); color: var(--error); }
.p-row .badge-U, .p-row .badge-\\? { background: rgba(229,166,57,0.15); color: var(--warn); }
.p-row .row-actions { display: none; gap: 2px; }
.p-row:hover .row-actions { display: inline-flex; }
.p-row .row-actions button { padding: 1px 4px; font-size: 10px; color: var(--text-dim); background: transparent; border: 1px solid var(--border); border-radius: 3px; }
.p-row .row-actions button:hover { color: var(--accent); border-color: var(--accent); }

.p-commit {
  padding: 8px 12px; border-bottom: 1px solid var(--border);
}
.p-commit textarea {
  width: 100%; min-height: 50px; max-height: 140px; padding: 6px 8px;
  background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-strong); font-family: var(--font-sans); font-size: var(--fs-sm); resize: vertical;
}
.p-commit-actions { display: flex; gap: 6px; margin-top: 6px; }

.p-tabs { display: flex; border-bottom: 1px solid var(--border); overflow-x: auto; }
.p-tabs::-webkit-scrollbar { height: 3px; }
.p-tabs::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.p-tabs::-webkit-scrollbar-track { background: transparent; }
.p-tab {
  flex-shrink: 0; padding: 8px 10px; font-size: var(--fs-sm); color: var(--text-mid);
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap;
}
.p-tab.active { color: var(--text-strong); border-bottom-color: var(--accent); }

.connector-card {
  display: flex; gap: 10px; padding: 10px; border: 1px solid var(--border);
  border-radius: var(--radius); margin: 6px 0; align-items: center;
}
.connector-card .icon { font-size: 22px; }
.connector-card .info { flex: 1; }
.connector-card .info .name { color: var(--text-strong); font-weight: 500; font-size: var(--fs-sm); }
.connector-card .info .desc { color: var(--text-dim); font-size: 11px; }
.connector-card .info .conn { color: var(--ok); font-size: 11px; margin-top: 2px; }

.toggle {
  position: relative; width: 28px; height: 16px; background: var(--border);
  border-radius: 8px; cursor: pointer; transition: background var(--t);
}
.toggle.on { background: var(--accent); }
.toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  background: white; border-radius: 50%; transition: transform var(--t);
}
.toggle.on::after { transform: translateX(12px); }

.cp-item {
  padding: 10px; border-bottom: 1px solid var(--border);
}
.cp-item .label { color: var(--text-strong); font-weight: 500; font-size: var(--fs-sm); }
.cp-item .meta { color: var(--text-dim); font-size: 11px; margin: 2px 0 6px; }
.cp-item .actions { display: flex; gap: 6px; }

.dev-item {
  padding: 10px; border-bottom: 1px solid var(--border);
}
.dev-item .cmd { font-family: var(--font-mono); font-size: 11px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-item .url { color: var(--info); font-size: 11px; margin-top: 2px; }
.dev-item .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; }
.dev-item .status-dot.running { background: var(--ok); }
.dev-item .status-dot.stopped { background: var(--text-faint); }
.dev-item .status-dot.error { background: var(--error); }

.commits-list { max-height: 240px; overflow-y: auto; }
.commit-row { padding: 6px 12px; font-size: 11px; border-bottom: 1px solid var(--border); }
.commit-row .hash { color: var(--accent); font-family: var(--font-mono); }
.commit-row .msg { color: var(--text); }
.commit-row .meta { color: var(--text-dim); font-size: 10px; }

/* ── Git Panel Redesign ──────────────────────────────────────────────── */
.git-panel-root { position: relative; }
.git-loading {
  display: flex; align-items: center; gap: 8px; padding: 16px;
  color: var(--text-dim); font-size: 11px;
}
.git-loading-spinner {
  width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%;
  animation: tool-spin 0.8s linear infinite;
}
.git-empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 32px 16px; gap: 12px; text-align: center;
}
.git-empty-icon { color: var(--text-dim); }
.git-empty-title { font-size: 14px; font-weight: 600; color: var(--text-strong); }
.git-empty-desc { font-size: 11px; color: var(--text-dim); max-width: 260px; }

.git-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-bottom: 1px solid var(--border);
}
.git-branch-btn {
  display: flex; align-items: center; gap: 4px;
  background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 8px; color: var(--text);
  font-family: var(--font-mono); font-size: 11px; cursor: pointer;
  transition: border-color 0.15s;
}
.git-branch-btn:hover { border-color: var(--accent); }
.git-branch-btn svg { color: var(--accent); flex-shrink: 0; }
.git-branch-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-branch-chevron { font-size: 8px; color: var(--text-dim); }
.git-sync {
  font-family: var(--font-mono); font-size: 10px; color: var(--info);
  padding: 2px 6px; border-radius: 3px; background: rgba(108,182,255,0.1);
}
.git-action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; background: transparent; border: 1px solid transparent;
  border-radius: 4px; color: var(--text-dim); cursor: pointer; transition: all 0.15s;
}
.git-action-btn:hover { color: var(--text); background: var(--surface-alt); border-color: var(--border); }
.git-action-btn svg { width: 14px; height: 14px; }

.git-branch-dropdown, .git-actions-menu {
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--surface-raised, var(--surface)); box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  margin: 0 8px; max-height: 240px; overflow-y: auto;
}
.git-branch-dropdown.hidden, .git-actions-menu.hidden { display: none; }
.git-popover-backdrop { position: fixed; inset: 0; z-index: 1000; }
.git-actions-menu.popover, .git-branch-dropdown.popover {
  position: fixed; z-index: 1001;
  margin: 0; max-height: 360px;
}
.git-branch-item {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 12px;
  background: transparent; border: none; color: var(--text-mid);
  font-size: 11px; font-family: var(--font-mono); cursor: pointer; text-align: left;
  transition: background 0.1s;
}
.git-branch-item:hover { background: var(--surface-alt); }
.git-branch-item.active { color: var(--accent); }
.git-branch-item.create { color: var(--ok); border-bottom: 1px solid var(--border); }
.git-current-badge {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em;
  padding: 1px 5px; border-radius: 2px; background: rgba(255,107,53,0.12);
  color: var(--accent); margin-left: 4px;
}
.git-menu-item {
  display: block; width: 100%; padding: 8px 14px; background: transparent;
  border: none; color: var(--text); font-size: 12px; cursor: pointer;
  text-align: left; transition: background 0.1s;
}
.git-menu-item:hover { background: var(--surface-alt); }
.git-menu-item.danger { color: var(--error); }
.git-menu-item.danger:hover { background: rgba(229,83,75,0.08); }
.git-menu-sep { height: 1px; background: var(--border); margin: 4px 0; }

.git-commit-box {
  padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.git-commit-box textarea {
  width: 100%; min-height: 48px; max-height: 120px; padding: 8px 10px;
  background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text); font-family: var(--font-sans);
  font-size: 12px; resize: vertical; outline: none; box-sizing: border-box;
}
.git-commit-box textarea:focus { border-color: var(--accent); }
.git-commit-actions {
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
}
.git-ai-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; background: rgba(255,107,53,0.08);
  border: 1px solid rgba(255,107,53,0.2); border-radius: 4px;
  color: var(--accent); cursor: pointer; transition: all 0.15s;
}
.git-ai-btn:hover { background: rgba(255,107,53,0.15); border-color: var(--accent); }
.git-amend-label {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-dim); cursor: pointer;
}
.git-amend-label input { accent-color: var(--accent); }

.git-file-section { border-bottom: 1px solid var(--border); }
.git-section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px;
}
.git-section-title {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--text-mid); font-weight: 600;
}
.git-section-actions { display: flex; gap: 2px; }
.git-section-action {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border); border-radius: 3px;
  color: var(--text-dim); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.git-section-action:hover { color: var(--text); background: var(--surface-alt); }
.git-section-action.danger:hover { color: var(--error); background: rgba(229,83,75,0.08); }

.git-file-row {
  display: flex; align-items: center; gap: 6px; padding: 4px 12px;
  cursor: pointer; transition: background 0.1s;
}
.git-file-row:hover { background: var(--surface-alt); }
.git-file-badge {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  font-family: var(--font-mono); font-weight: 600; flex-shrink: 0;
}
.git-file-badge.badge-M { background: rgba(108,182,255,0.15); color: var(--info); }
.git-file-badge.badge-A { background: rgba(86,211,100,0.15); color: var(--ok); }
.git-file-badge.badge-D { background: rgba(229,83,75,0.15); color: var(--error); }
.git-file-badge.badge-R { background: rgba(229,166,57,0.15); color: var(--warn); }
.git-file-badge.badge-U, .git-file-badge.badge-\? { background: rgba(229,166,57,0.15); color: var(--warn); }
.git-file-name {
  flex: 1; font-size: 11px; color: var(--text); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.git-file-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.git-file-row:hover .git-file-actions { opacity: 1; }
.git-file-action {
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
  background: var(--surface-alt); border: 1px solid var(--border); border-radius: 3px;
  color: var(--text-dim); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.git-file-action:hover { color: var(--text); border-color: var(--accent); }
.git-file-action.danger:hover { color: var(--error); border-color: var(--error); }

.git-commits-list { max-height: 280px; overflow-y: auto; }
.git-commit-row {
  padding: 8px 12px; cursor: pointer; transition: background 0.1s;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.git-commit-row:hover { background: var(--surface-alt); }
.git-commit-main { display: flex; align-items: baseline; gap: 6px; }
.git-commit-hash {
  font-family: var(--font-mono); font-size: 10px; color: var(--accent);
  flex-shrink: 0;
}
.git-commit-msg { font-size: 11px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-commit-meta { font-size: 10px; color: var(--text-dim); margin-top: 2px; }

/* ── Git Panel v2 additions ───────────────────────────────────────────── */
.git-top-header {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px 5px 12px; border-bottom: 1px solid var(--border);
}
.git-top-title {
  flex: 1; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--text-mid); font-weight: 700;
}
.git-refresh-btn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; background: transparent; border: none;
  color: var(--text-dim); cursor: pointer; border-radius: 3px; transition: all 0.15s;
}
.git-refresh-btn:hover { color: var(--text); background: var(--surface-alt); }
.git-refresh-btn.spinning svg { animation: tool-spin 0.7s linear infinite; }

.git-branch-bar {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px; background: rgba(0,0,0,0.15); border-bottom: 1px solid var(--border);
}
.git-branch-bar .git-branch-btn { flex: 1; min-width: 0; }
.git-bar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; background: transparent; border: 1px solid transparent;
  border-radius: 4px; color: var(--text-dim); cursor: pointer; transition: all 0.15s;
  flex-shrink: 0;
}
.git-bar-btn:hover:not(:disabled) { color: var(--text); background: var(--surface-alt); border-color: var(--border); }
.git-bar-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.git-bar-btn svg { width: 13px; height: 13px; }
.git-bar-btn.spinning svg { animation: tool-spin 0.7s linear infinite; }

.git-status-bar {
  padding: 5px 12px; font-size: 11px; background: rgba(86,211,100,0.08);
  border-bottom: 1px solid rgba(86,211,100,0.2); color: var(--ok);
  animation: git-bar-in 0.15s ease;
}
.git-status-bar.error { background: rgba(229,83,75,0.08); border-color: rgba(229,83,75,0.2); color: var(--error); }
.git-status-bar.info { background: rgba(108,182,255,0.08); border-color: rgba(108,182,255,0.2); color: var(--info); }
@keyframes git-bar-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

.git-new-branch-input {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  border-bottom: 1px solid var(--border); background: var(--surface);
}
.git-new-branch-input input {
  flex: 1; background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 8px; color: var(--text); font-family: var(--font-mono);
  font-size: 11px; outline: none;
}
.git-new-branch-input input:focus { border-color: var(--accent); }
.git-new-branch-input button {
  padding: 4px 10px; font-size: 11px; border-radius: 4px; cursor: pointer;
  background: var(--accent); border: none; color: white; font-weight: 600; transition: opacity 0.15s;
}
.git-new-branch-input button:hover { opacity: 0.85; }

.git-section-chevron {
  font-size: 9px; color: var(--text-dim); margin-right: 4px;
  transition: transform 0.15s; display: inline-block;
}
.git-section-chevron.open { transform: rotate(90deg); }
.git-section-left { display: flex; align-items: center; cursor: pointer; flex: 1; gap: 4px; padding: 6px 0; }

.git-file-dir { font-size: 10px; color: var(--text-dim); flex-shrink: 0; margin-left: 2px; }

.git-commit-btn {
  padding: 3px 10px; font-size: 10px; font-weight: 600; border-radius: 3px;
  border: none; cursor: pointer; transition: all 0.15s; color: white; white-space: nowrap;
}
.git-commit-btn:not(:disabled) { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }
.git-commit-btn:not(:disabled):hover { opacity: 0.9; }
.git-commit-btn:disabled { background: var(--surface-alt); color: var(--text-dim); cursor: not-allowed; }

.git-textarea-wrap { position: relative; }
.git-textarea-wrap .git-ai-btn {
  position: absolute; top: 6px; right: 6px;
}
.git-textarea-wrap textarea { padding-right: 36px !important; }

.git-ai-btn.spinning svg { animation: tool-spin 0.7s linear infinite; }

.git-working-clean {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 28px 16px; gap: 8px; color: var(--text-dim);
}
.git-working-clean svg { opacity: 0.5; }
.git-working-clean span { font-size: 12px; }
`;
    const s = document.createElement('style');
    s.id = 'panels-inline-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }
  injectStyles();

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }

  function fmtSize(n) {
    if (!n) return '0B';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'onClick') e.addEventListener('click', v);
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else e.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  // ---------------- GIT PANEL ----------------
  async function renderGitPanel(container, projectPath) {
    // ── local helpers ──────────────────────────────────────────────────────
    function escapeHtml(s) {
      return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function splitPath(p) {
      const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (i < 0) return { name: p, dir: '' };
      return { name: p.slice(i + 1), dir: p.slice(0, i + 1) };
    }
    function svgIcon(d, size = 14, extra = '') {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
    }
    const ICONS = {
      branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
      refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
      pull: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
      push: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
      more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
      sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
      file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
      check: '<polyline points="20 6 9 17 4 12"/>',
      chevron: '<polyline points="9 18 15 12 9 6"/>',
      plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
      fetch: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      stash: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8l-2 4h12z"/>',
      merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
      cherry: '<circle cx="12" cy="15" r="5"/><path d="M12 10V5"/><path d="M8 5c0-1.7 1.3-3 3-3s3 1.3 3 3"/>',
      trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
      reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
      remote: '<circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>',
    };

    // ── panel state ────────────────────────────────────────────────────────
    let busy = false;
    let showBranchDropdown = false;
    let showActionsMenu = false;
    let branchMenuPos = null; // { top, left, width }
    let actionsMenuPos = null; // { top, left, width }
    let showNewBranch = false;
    let expandStaged = true;
    let expandChanges = true;
    let expandHistory = true;
    let statusMsg = null; // { text, type } — auto-clears
    let statusMsgTimer = null;
    let gitStatus = null;
    let hasRemote = false;
    let refreshTimer = null;

    function showStatusMsg(text, type = 'success') {
      statusMsg = { text, type };
      clearTimeout(statusMsgTimer);
      statusMsgTimer = setTimeout(() => { statusMsg = null; renderAll(); }, type === 'error' ? 5000 : 3000);
      // Bridge to the notification system. The toast→notification policy in
      // toast.js handles the rest (errors escalate to persistent cards,
      // infos land in the bell's history).
      const tt = type === 'success' ? 'ok' : type;
      bus.emit('toast:show', { type: tt, message: text, source: 'Git' });
    }

    // ── initial load ───────────────────────────────────────────────────────
    container.classList.add('git-panel-root');
    container.innerHTML = '<div class="git-loading"><div class="git-loading-spinner"></div><span>Loading…</span></div>';

    async function loadStatus() {
      try {
        const r = await api.git.status(projectPath);
        if (!r || r.ok === false) return null;
        return r.status || r;
      } catch { return null; }
    }

    gitStatus = await loadStatus();

    if (!gitStatus) {
      container.innerHTML = '';
      const empty = el('div', { class: 'git-empty-state' });
      empty.innerHTML = `
        <div class="git-empty-icon">${svgIcon(ICONS.branch, 32)}</div>
        <div class="git-empty-title">No Repository</div>
        <div class="git-empty-desc">Initialize a git repository to track changes.</div>
        <button class="btn btn-primary btn-small" id="git-init-btn">Initialize Repository</button>
      `;
      container.appendChild(empty);
      container.querySelector('#git-init-btn')?.addEventListener('click', async () => {
        const r = await api.git.init(projectPath);
        if (r && r.ok === false) {
          showStatusMsg('Init failed: ' + r.error, 'error');
          return;
        }
        await ensureDefaultGitignore(projectPath);
        showStatusMsg('Repository initialized', 'success');
        renderGitPanel(container, projectPath);
      });
      return;
    }

    // Try to detect remote
    try {
      const lo = await api.git.log(projectPath, { limit: 1 });
      hasRemote = !!(lo?.remote || lo?.remotes?.length || gitStatus.ahead !== undefined || gitStatus.behind !== undefined);
    } catch {}

    bus.emit('git:branch-changed', gitStatus.branch);

    // ── build + mount ──────────────────────────────────────────────────────
    function renderAll() {
      // preserve scroll
      const scrollTop = container.scrollTop;

      // cleanup any previous popovers/backdrops when re-rendering
      document.querySelectorAll('.git-actions-menu.popover, .git-branch-dropdown.popover, .git-popover-backdrop')
        .forEach(n => { try { n.remove(); } catch {} });

      container.innerHTML = '';

      const s = gitStatus || {};
      const allFiles = s.files || [];
      const stagedFiles  = allFiles.filter(f => f.index && f.index !== ' ' && f.index !== '?');
      const changedFiles = allFiles.filter(f => (f.working_dir && f.working_dir !== ' ') || (!f.index || f.index === '?'));
      // dedupe: remove pure-staged from changedFiles
      const unstagedFiles = allFiles.filter(f => f.working_dir && f.working_dir !== ' ' && f.working_dir !== '?');
      const untrackedFiles = allFiles.filter(f => f.index === '?' || f.working_dir === '?');
      const changedAll = [...unstagedFiles, ...untrackedFiles];

      // ── 1. Top header ──────────────────────────────────────────────────
      const topHeader = el('div', { class: 'git-top-header' });
      topHeader.appendChild(el('span', { class: 'git-top-title' }, 'Source Control'));
      const refreshBtn = el('button', { class: 'git-refresh-btn' + (busy ? ' spinning' : ''), title: 'Refresh' });
      refreshBtn.innerHTML = svgIcon(ICONS.refresh, 13);
      refreshBtn.addEventListener('click', async () => {
        if (busy) return;
        refreshBtn.classList.add('spinning');
        gitStatus = await loadStatus();
        refreshBtn.classList.remove('spinning');
        renderAll();
      });
      topHeader.appendChild(refreshBtn);
      container.appendChild(topHeader);

      // ── 2. Branch + actions bar ────────────────────────────────────────
      const branchBar = el('div', { class: 'git-branch-bar' });

      const branchBtn = el('button', { class: 'git-branch-btn', title: 'Switch Branch' });
      branchBtn.innerHTML = svgIcon(ICONS.branch, 11) +
        `<span class="git-branch-name">${escapeHtml(s.branch || 'HEAD')}</span>` +
        `<span class="git-branch-chevron">▾</span>`;
      branchBar.appendChild(branchBtn);

      // ahead/behind sync badge
      const ahead = s.ahead || 0;
      const behind = s.behind || 0;
      if (ahead || behind) {
        const sync = el('span', { class: 'git-sync' });
        sync.textContent = `${behind ? '↓' + behind : ''}${behind && ahead ? ' ' : ''}${ahead ? '↑' + ahead : ''}`;
        branchBar.appendChild(sync);
      }

      const pullBarBtn = el('button', { class: 'git-bar-btn', title: 'Pull' });
      pullBarBtn.innerHTML = svgIcon(ICONS.pull, 13);
      if (!hasRemote) pullBarBtn.disabled = true;
      pullBarBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        pullBarBtn.classList.add('spinning');
        showStatusMsg('Pulling…', 'info');
        renderAll();
        try {
          const r = await api.git.pull(projectPath);
          if (r?.ok === false) showStatusMsg('Pull failed: ' + r.error, 'error');
          else showStatusMsg('Pulled successfully');
          gitStatus = await loadStatus();
        } catch (e) { showStatusMsg('Pull failed: ' + e.message, 'error'); }
        busy = false;
        renderAll();
      });
      branchBar.appendChild(pullBarBtn);

      const pushBarBtn = el('button', { class: 'git-bar-btn', title: 'Push' });
      pushBarBtn.innerHTML = svgIcon(ICONS.push, 13);
      if (!hasRemote) pushBarBtn.disabled = true;
      pushBarBtn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        pushBarBtn.classList.add('spinning');
        showStatusMsg('Pushing…', 'info');
        renderAll();
        try {
          const r = await api.git.push(projectPath);
          if (r?.ok === false) showStatusMsg('Push failed: ' + r.error, 'error');
          else { showStatusMsg('Pushed successfully'); gitStatus = await loadStatus(); }
        } catch (e) { showStatusMsg('Push failed: ' + e.message, 'error'); }
        busy = false;
        renderAll();
      });
      branchBar.appendChild(pushBarBtn);

      const moreBtn = el('button', { class: 'git-bar-btn', title: 'More Actions (…)' });
      moreBtn.innerHTML = svgIcon(ICONS.more, 13);
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        actionsMenuPos = { top: r.bottom + 6, left: Math.max(8, r.right - 220), width: 220 };
        showActionsMenu = !showActionsMenu;
        showBranchDropdown = false;
        renderAll();
      });
      branchBar.appendChild(moreBtn);
      container.appendChild(branchBar);

      // ── 3. Branch dropdown ─────────────────────────────────────────────
      if (showBranchDropdown) {
        const dropdown = el('div', {
          class: 'git-branch-dropdown popover',
          style: branchMenuPos ? { top: branchMenuPos.top + 'px', left: branchMenuPos.left + 'px', width: branchMenuPos.width + 'px' } : { top: '64px', left: '60px', width: '240px' },
        });

        // "New branch…" option
        const createItem = el('button', { class: 'git-branch-item create' });
        createItem.innerHTML = svgIcon(ICONS.plus, 11) + ' New branch…';
        createItem.addEventListener('click', (e) => {
          e.stopPropagation();
          showBranchDropdown = false;
          showNewBranch = true;
          renderAll();
        });
        dropdown.appendChild(createItem);

        dropdown.innerHTML += '<div style="padding:6px 12px;color:var(--text-dim);font-size:10px;">Loading…</div>';
        container.appendChild(dropdown);

        // async populate
        api.git.branches(projectPath).then(resp => {
          if (!resp || resp.ok === false) throw new Error(resp?.error || 'branches failed');
          const branches = Array.isArray(resp.local) ? resp.local : (Array.isArray(resp.all) ? resp.all : []);
          const current = resp.current || s.branch;
          dropdown.innerHTML = '';
          dropdown.appendChild(createItem);

          branches.forEach(b => {
            const bname = typeof b === 'string' ? b : (b.name || b.label || '');
            if (!bname || bname.startsWith('remotes/')) return;
            const isCurrent = bname === current;
            const item = el('button', { class: 'git-branch-item' + (isCurrent ? ' active' : '') });
            item.innerHTML = svgIcon(ICONS.branch, 11) + ' ' + escapeHtml(bname) +
              (isCurrent ? ' <span class="git-current-badge">current</span>' : '');
            item.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (isCurrent) return;
              showStatusMsg('Switching to ' + bname + '…', 'info');
              showBranchDropdown = false;
              renderAll();
              try {
                await api.git.checkout(projectPath, bname);
                gitStatus = await loadStatus();
                bus.emit('git:branch-changed', gitStatus?.branch);
              } catch (err) { showStatusMsg('Checkout failed: ' + err.message, 'error'); }
              renderAll();
            });
            dropdown.appendChild(item);
          });
        }).catch(() => {
          dropdown.innerHTML = '<div style="padding:8px 12px;color:var(--error);font-size:11px;">Failed to load branches</div>';
          dropdown.prepend(createItem);
        });

        container.appendChild(dropdown);
      }

      // ── 4. New-branch inline input ─────────────────────────────────────
      if (showNewBranch) {
        const nbWrap = el('div', { class: 'git-new-branch-input' });
        const nbInput = el('input', { type: 'text', placeholder: 'New branch name…' });
        nbInput.setAttribute('autofocus', '');
        const nbBtn = el('button', null, 'Create');
        const doCreate = async () => {
          const name = nbInput.value.trim();
          if (!name) return;
          showNewBranch = false;
          showStatusMsg('Creating branch ' + name + '…', 'info');
          renderAll();
          try {
            await api.git.createBranch(projectPath, name);
            gitStatus = await loadStatus();
            bus.emit('git:branch-changed', gitStatus?.branch);
          } catch (err) { showStatusMsg('Create branch failed: ' + err.message, 'error'); }
          renderAll();
        };
        nbInput.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') { showNewBranch = false; renderAll(); } });
        nbBtn.addEventListener('click', doCreate);
        nbWrap.appendChild(nbInput);
        nbWrap.appendChild(nbBtn);
        container.appendChild(nbWrap);
        setTimeout(() => nbInput.focus(), 0);
      }

      // ── 5. Status message bar ──────────────────────────────────────────
      if (statusMsg) {
        const bar = el('div', { class: 'git-status-bar ' + (statusMsg.type === 'error' ? 'error' : statusMsg.type === 'info' ? 'info' : '') });
        bar.textContent = statusMsg.text;
        container.appendChild(bar);
      }

      // ── 6. Commit box ──────────────────────────────────────────────────
      const commitBox = el('div', { class: 'git-commit-box' });

      const txWrap = el('div', { class: 'git-textarea-wrap' });
      const commitTextarea = el('textarea', {
        placeholder: 'Message (Ctrl+Enter to commit)',
        rows: '3',
        style: { width: '100%', boxSizing: 'border-box' },
      });
      commitTextarea.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); doCommit(); }
      });

      const aiBtn = el('button', { class: 'git-ai-btn', title: 'Generate commit message with AI' });
      aiBtn.innerHTML = svgIcon(ICONS.sparkle, 12);
      aiBtn.addEventListener('click', async () => {
        aiBtn.disabled = true;
        aiBtn.style.opacity = '0.5';
        aiBtn.classList.add('spinning');
        try {
          const diffResp = await api.git.diff(projectPath, null, true);
          const rawDiff = (diffResp?.diff || '');
          const lines = rawDiff.split(/\r?\n/);
          const diffText = lines.slice(0, 150).join('\n');
          if (!diffText.trim()) { showStatusMsg('No staged changes to summarize', 'info'); renderAll(); return; }
          const r = await api.codestral.commitMessage({ diff: diffText });
          if (r?.ok === false) throw new Error(r.error || 'Commit generator failed');
          const msg = String(r?.text || '').trim().replace(/^["'`]+|["'`]+$/g, '');
          if (msg) commitTextarea.value = msg;
        } catch (e) {
          showStatusMsg('AI failed: ' + e.message, 'error');
          renderAll();
        } finally {
          aiBtn.disabled = false;
          aiBtn.style.opacity = '1';
          aiBtn.classList.remove('spinning');
        }
      });

      txWrap.appendChild(commitTextarea);
      txWrap.appendChild(aiBtn);
      commitBox.appendChild(txWrap);

      const commitActions = el('div', { class: 'git-commit-actions' });

      const amendLabel = el('label', { class: 'git-amend-label' });
      const amendCheck = el('input', { type: 'checkbox' });
      amendLabel.appendChild(amendCheck);
      amendLabel.appendChild(document.createTextNode(' Amend'));
      commitActions.appendChild(amendLabel);

      commitActions.appendChild(el('div', { style: { flex: '1' } }));

      const stagedCount = stagedFiles.length;
      const commitBtn = el('button', { class: 'git-commit-btn' });
      commitBtn.textContent = stagedCount > 0 ? `Commit (${stagedCount})` : 'Commit';
      if (stagedCount === 0) commitBtn.disabled = true;

      async function doCommit() {
        const msg = commitTextarea.value.trim();
        if (!msg) { showStatusMsg('Enter a commit message first', 'info'); renderAll(); return; }
        if (stagedCount === 0) { showStatusMsg('No staged changes to commit', 'info'); renderAll(); return; }
        busy = true;
        commitBtn.disabled = true;
        commitBtn.textContent = 'Committing…';
        try {
          const r = await api.git.commit(projectPath, msg);
          if (r?.ok === false) { showStatusMsg('Commit failed: ' + r.error, 'error'); }
          else {
            const shortHash = (r?.hash || '').slice(0, 7);
            showStatusMsg('Committed' + (shortHash ? ' ' + shortHash : ''));
            commitTextarea.value = '';
            gitStatus = await loadStatus();
          }
        } catch (e) { showStatusMsg('Commit failed: ' + e.message, 'error'); }
        busy = false;
        renderAll();
      }

      commitBtn.addEventListener('click', doCommit);
      commitActions.appendChild(commitBtn);
      commitBox.appendChild(commitActions);
      container.appendChild(commitBox);

      // ── 7. Working tree clean ──────────────────────────────────────────
      if (stagedFiles.length === 0 && changedAll.length === 0) {
        const clean = el('div', { class: 'git-working-clean' });
        clean.innerHTML = svgIcon(ICONS.check, 22) + '<span>Working tree clean</span>';
        container.appendChild(clean);
      }

      // ── 8. File section builder ────────────────────────────────────────
      function buildFileSection(title, files, opts = {}) {
        if (!files.length) return;
        const expanded = opts.expanded !== undefined ? opts.expanded : true;
        const sec = el('div', { class: 'git-file-section' });
        const hdr = el('div', { class: 'git-section-header' });

        const leftSide = el('div', { class: 'git-section-left' });
        const chev = el('span', { class: 'git-section-chevron' + (expanded ? ' open' : '') });
        chev.innerHTML = svgIcon(ICONS.chevron, 9);
        leftSide.appendChild(chev);
        leftSide.appendChild(el('span', { class: 'git-section-title' }, `${title} (${files.length})`));
        leftSide.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onToggle && opts.onToggle();
        });
        hdr.appendChild(leftSide);

        const hdrActions = el('div', { class: 'git-section-actions' });

        if (opts.canStageAll) {
          const stageAllBtn = el('button', { class: 'git-section-action', title: 'Stage All (+)' });
          stageAllBtn.textContent = '+';
          stageAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try { await api.git.add(projectPath, files.map(f => typeof f === 'string' ? f : f.path)); } catch {}
            gitStatus = await loadStatus();
            renderAll();
          });
          hdrActions.appendChild(stageAllBtn);
        }
        if (opts.canUnstageAll) {
          const unstageAllBtn = el('button', { class: 'git-section-action', title: 'Unstage All (−)' });
          unstageAllBtn.textContent = '−';
          unstageAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            for (const f of files) { try { await api.git.unstage(projectPath, typeof f === 'string' ? f : f.path); } catch {} }
            gitStatus = await loadStatus();
            renderAll();
          });
          hdrActions.appendChild(unstageAllBtn);
        }
        if (opts.canDiscardAll) {
          const discardAllBtn = el('button', { class: 'git-section-action danger', title: 'Discard All (↺)' });
          discardAllBtn.textContent = '↺';
          discardAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await (window.PiPilot?.modal?.confirm?.({ title: 'Discard all?', message: 'Discard all changes in this section? This cannot be undone.', danger: true }) || Promise.resolve(confirm('Discard all?')));
            if (!ok) return;
            for (const f of files) { try { await api.git.discard(projectPath, typeof f === 'string' ? f : f.path); } catch {} }
            gitStatus = await loadStatus();
            renderAll();
          });
          hdrActions.appendChild(discardAllBtn);
        }
        hdr.appendChild(hdrActions);
        sec.appendChild(hdr);

        if (expanded) {
          files.forEach(f => {
            const filePath = typeof f === 'string' ? f : (f.path || f);
            const rawStatus = opts.isStaged
              ? (f.index || '?')
              : (f.working_dir || f.index || opts.defaultStatus || '?');
            const statusLetter = rawStatus.trim() || '?';
            const safeClass = statusLetter.replace(/[^a-zA-Z?]/g, '') || '?';
            const { name: fname, dir: fdir } = splitPath(filePath);

            const row = el('div', { class: 'git-file-row' });
            row.addEventListener('click', async (e) => {
              if (e.target.closest('.git-file-actions')) return;
              const staged = opts.isStaged || false;
              // Route media (image / video / audio / pdf) to the binary diff
              // viewer — the text-based openDiffTab would render these as
              // garbled bytes.
              if (isMediaPath(filePath)) {
                openWorkingTreeMediaTab(projectPath, filePath, staged);
                return;
              }
              try {
                const resp = await api.git.fileVersions(projectPath, filePath, staged);
                if (resp && window.PiPilot?.editor?.openDiffTab) {
                  // Detect binary content even without media extension (NUL byte heuristic)
                  const looksBinary = (resp.original && hasNul(resp.original)) || (resp.modified && hasNul(resp.modified));
                  if (looksBinary) {
                    openWorkingTreeMediaTab(projectPath, filePath, staged);
                    return;
                  }
                  window.PiPilot.editor.openDiffTab({
                    name: 'Diff: ' + fname,
                    original: resp.original || '',
                    modified: resp.modified || '',
                    originalTitle: 'HEAD',
                    modifiedTitle: staged ? 'Staged' : 'Working Tree',
                  });
                } else {
                  bus.emit('file:open', { path: filePath });
                }
              } catch { bus.emit('file:open', { path: filePath }); }
            });

            row.innerHTML = svgIcon(ICONS.file, 12, 'style="flex-shrink:0;color:var(--text-dim)"');
            row.appendChild(el('span', { class: 'git-file-name' }, fname));
            if (fdir) row.appendChild(el('span', { class: 'git-file-dir' }, fdir));
            row.appendChild(el('div', { style: { flex: '1' } }));

            const rowActions = el('div', { class: 'git-file-actions' });

            if (opts.canDiscard) {
              const discardBtn = el('button', { class: 'git-file-action danger', title: 'Discard changes (↺)' });
              discardBtn.textContent = '↺';
              discardBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ok = await (window.PiPilot?.modal?.confirm?.({ title: 'Discard?', message: filePath, danger: true }) || Promise.resolve(confirm('Discard ' + filePath + '?')));
                if (!ok) return;
                try { await api.git.discard(projectPath, filePath); } catch {}
                gitStatus = await loadStatus();
                renderAll();
              });
              rowActions.appendChild(discardBtn);
            }
            if (opts.canStage) {
              const stageBtn = el('button', { class: 'git-file-action', title: 'Stage (+)' });
              stageBtn.textContent = '+';
              stageBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await api.git.add(projectPath, [filePath]); } catch {}
                gitStatus = await loadStatus();
                renderAll();
              });
              rowActions.appendChild(stageBtn);
            }
            if (opts.canUnstage) {
              const unstageBtn = el('button', { class: 'git-file-action', title: 'Unstage (−)' });
              unstageBtn.textContent = '−';
              unstageBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await api.git.unstage(projectPath, filePath); } catch {}
                gitStatus = await loadStatus();
                renderAll();
              });
              rowActions.appendChild(unstageBtn);
            }
            row.appendChild(rowActions);

            const badge = el('span', { class: `git-file-badge badge-${safeClass}` }, statusLetter);
            row.appendChild(badge);

            sec.appendChild(row);
          });
        }
        container.appendChild(sec);
      }

      // ── 9. Staged Changes section ──────────────────────────────────────
      if (stagedFiles.length > 0) {
        buildFileSection('Staged Changes', stagedFiles, {
          isStaged: true,
          expanded: expandStaged,
          canUnstage: true,
          canUnstageAll: true,
          onToggle: () => { expandStaged = !expandStaged; renderAll(); },
        });
      }

      // ── 10. Changes section ────────────────────────────────────────────
      if (changedAll.length > 0) {
        buildFileSection('Changes', changedAll, {
          isStaged: false,
          expanded: expandChanges,
          canStage: true,
          canStageAll: true,
          canDiscard: true,
          canDiscardAll: true,
          defaultStatus: '?',
          onToggle: () => { expandChanges = !expandChanges; renderAll(); },
        });
      }

      // ── 11. History section ────────────────────────────────────────────
      const historySec = el('div', { class: 'git-file-section' });
      const historyHdr = el('div', { class: 'git-section-header' });
      const historyLeft = el('div', { class: 'git-section-left' });
      const historyChev = el('span', { class: 'git-section-chevron' + (expandHistory ? ' open' : '') });
      historyChev.innerHTML = svgIcon(ICONS.chevron, 9);
      historyLeft.appendChild(historyChev);
      historyLeft.appendChild(el('span', { class: 'git-section-title' }, 'History'));
      historyLeft.addEventListener('click', () => { expandHistory = !expandHistory; renderAll(); });
      historyHdr.appendChild(historyLeft);
      historySec.appendChild(historyHdr);

      if (expandHistory) {
        const list = el('div', { class: 'git-commits-list' });
        list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim)">Loading…</div>';
        historySec.appendChild(list);

        api.git.log(projectPath, { limit: 20 }).then(logResp => {
          const commits = logResp?.commits || [];
          list.innerHTML = '';
          if (!commits.length) {
            list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim)">No commits yet</div>';
            return;
          }
          commits.forEach(c => {
            const hash = (c.abbreviatedHash || c.hash || '').slice(0, 7);
            const row = el('div', { class: 'git-commit-row' });
            row.innerHTML = `
              <div class="git-commit-main">
                <span class="git-commit-hash">${escapeHtml(hash)}</span>
                <span class="git-commit-msg">${escapeHtml(c.message || c.subject || '')}</span>
              </div>
              <div class="git-commit-meta">${escapeHtml(c.author || '')} · ${escapeHtml(timeAgo(c.timestamp || (c.date ? new Date(c.date).getTime() : 0)))}</div>
            `;
            row.addEventListener('click', () => {
              bus.emit('git:show-commit', { hash: c.hash });
            });
            list.appendChild(row);
          });
        }).catch(() => {
          list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-dim)">Could not load history</div>';
        });
      }
      container.appendChild(historySec);

      // ── 12. More actions menu ──────────────────────────────────────────
      if (showActionsMenu) {
        const backdrop = el('div', { class: 'git-popover-backdrop' });
        backdrop.addEventListener('click', () => {
          showActionsMenu = false;
          renderAll();
        });
        document.body.appendChild(backdrop);

        const pos = actionsMenuPos || { top: 96, left: 80, width: 220 };
        const menu = el('div', {
          class: 'git-actions-menu popover',
          style: { top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' },
        });
        const menuActions = [
          { icon: ICONS.fetch,  label: 'Fetch', action: async () => { showStatusMsg('Fetching…','info'); try { const r = await api.git.fetch(projectPath); if (r?.ok === false) throw new Error(r.error); gitStatus = await loadStatus(); showStatusMsg('Fetched'); } catch (e) { showStatusMsg('Fetch failed: '+e.message,'error'); } } },
          { icon: ICONS.pull,   label: 'Pull', action: async () => { showStatusMsg('Pulling…','info'); try { const r = await api.git.pull(projectPath); if(r?.ok===false) showStatusMsg('Pull failed: '+r.error,'error'); else { showStatusMsg('Pulled successfully'); gitStatus=await loadStatus(); } } catch(e){showStatusMsg('Pull failed: '+e.message,'error');} } },
          { icon: ICONS.pull,   label: 'Pull (Rebase)', action: async () => { showStatusMsg('Pulling (rebase)…','info'); try { const r = await api.git.pull(projectPath,{rebase:true}); if(r?.ok===false) showStatusMsg('Pull failed: '+r.error,'error'); else { showStatusMsg('Pulled (rebased)'); gitStatus=await loadStatus(); } } catch(e){showStatusMsg('Pull failed: '+e.message,'error');} } },
          { icon: ICONS.push,   label: 'Push', action: async () => { showStatusMsg('Pushing…','info'); try { const r = await api.git.push(projectPath); if(r?.ok===false) showStatusMsg('Push failed: '+r.error,'error'); else { showStatusMsg('Pushed successfully'); gitStatus=await loadStatus(); } } catch(e){showStatusMsg('Push failed: '+e.message,'error');} } },
          { type: 'sep' },
          { icon: ICONS.plus,   label: 'Stage All Changes', action: async () => {
            try { const r = await api.git.add(projectPath, '.'); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Staged all changes'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Stage all failed: ' + e.message, 'error'); }
          } },
          { icon: '', label: 'Unstage All', action: async () => {
            try {
              for (const f of stagedFiles) {
                const r = await api.git.unstage(projectPath, typeof f === 'string' ? f : f.path);
                if (r?.ok === false) throw new Error(r.error);
              }
              showStatusMsg('Unstaged all changes');
              gitStatus = await loadStatus();
            } catch (e) { showStatusMsg('Unstage all failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.reset,  label: 'Discard All Changes', danger: true, action: async () => {
            const ok = await (window.PiPilot?.modal?.confirm?.({ title:'Discard ALL changes?', message:'This will discard every uncommitted change. Cannot be undone.', danger:true, confirmText:'Discard All' }) || Promise.resolve(confirm('Discard ALL changes?')));
            if (!ok) return;
            try { await api.git.discard(projectPath, '.'); gitStatus=await loadStatus(); } catch (e) { showStatusMsg('Discard failed: '+e.message,'error'); }
          }},
          { type: 'sep' },
          { icon: ICONS.stash,  label: 'Stash', action: async () => { try { const r = await api.git.stash(projectPath,{action:'push'}); if(r?.ok===false) throw new Error(r.error); showStatusMsg('Stashed'); gitStatus=await loadStatus(); } catch(e){showStatusMsg('Stash failed: '+e.message,'error');} } },
          { icon: ICONS.stash,  label: 'Pop Stash', action: async () => { try { const r = await api.git.stash(projectPath,{action:'pop'}); if(r?.ok===false) throw new Error(r.error); showStatusMsg('Stash popped'); gitStatus=await loadStatus(); } catch(e){showStatusMsg('Pop failed: '+e.message,'error');} } },
          { icon: ICONS.stash,  label: 'Apply Stash', action: async () => { try { const r = await api.git.stash(projectPath,{action:'apply'}); if(r?.ok===false) throw new Error(r.error); showStatusMsg('Stash applied'); gitStatus=await loadStatus(); } catch(e){showStatusMsg('Apply failed: '+e.message,'error');} } },
          { icon: ICONS.trash,  label: 'Drop Stash', danger: true, action: async () => {
            const ok = await (window.PiPilot?.modal?.confirm?.({ title:'Drop latest stash?', message:'This permanently removes the most recent stash entry.', danger:true, confirmText:'Drop' }) || Promise.resolve(confirm('Drop the latest stash?')));
            if (!ok) return;
            try { const r = await api.git.stash(projectPath,{action:'drop'}); if(r?.ok===false) throw new Error(r.error); showStatusMsg('Stash dropped'); gitStatus=await loadStatus(); } catch(e){showStatusMsg('Drop failed: '+e.message,'error');}
          } },
          { type: 'sep' },
          { icon: ICONS.merge,  label: 'Merge Branch…', action: async () => {
            const b = await window.PiPilot.modal.prompt({ title: 'Merge Branch', label: 'Branch name to merge into current:', placeholder: 'feature/foo', confirmText: 'Merge' });
            if (!b) return;
            showStatusMsg('Merging…','info');
            try { const r = await api.git.merge(projectPath, b); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Merged ' + b); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Merge failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.cherry, label: 'Cherry-pick Commit…', action: async () => {
            const h = await window.PiPilot.modal.prompt({ title: 'Cherry-pick Commit', label: 'Commit hash:', placeholder: 'a1b2c3d', confirmText: 'Cherry-pick' });
            if (!h) return;
            showStatusMsg('Cherry-picking…','info');
            try { const r = await api.git.cherryPick(projectPath, h); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Cherry-picked'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Cherry-pick failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.trash,  label: 'Delete Branch…', danger: true, action: async () => {
            const b = await window.PiPilot.modal.prompt({ title: 'Delete Branch', label: 'Branch name to delete:', placeholder: 'feature/old', confirmText: 'Continue' });
            if (!b) return;
            const ok = await (window.PiPilot?.modal?.confirm?.({ title:'Delete branch?', message:`Delete ${b}?`, danger:true, confirmText:'Delete' }) || Promise.resolve(confirm(`Delete branch ${b}?`)));
            if (!ok) return;
            try { const r = await api.git.deleteBranch(projectPath, b, false); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Deleted ' + b); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Delete failed: ' + e.message, 'error'); }
          } },
          { type: 'sep' },
          { icon: ICONS.reset,  label: 'Reset (soft)', action: async () => {
            const ref = await window.PiPilot.modal.prompt({ title: 'Reset (soft)', label: 'Reset to:', defaultValue: 'HEAD~1', placeholder: 'HEAD~1', confirmText: 'Reset' });
            if (!ref) return;
            try { const r = await api.git.reset(projectPath, 'soft', ref); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Reset soft'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Reset failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.reset,  label: 'Reset (mixed)', action: async () => {
            const ref = await window.PiPilot.modal.prompt({ title: 'Reset (mixed)', label: 'Reset to:', defaultValue: 'HEAD~1', placeholder: 'HEAD~1', confirmText: 'Reset' });
            if (!ref) return;
            try { const r = await api.git.reset(projectPath, 'mixed', ref); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Reset mixed'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Reset failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.reset,  label: 'Reset (hard) HEAD', danger: true, action: async () => {
            const ok = await (window.PiPilot?.modal?.confirm?.({ title:'Hard reset to HEAD?', message:'This will discard ALL changes. Continue?', danger:true, confirmText:'Reset' }) || Promise.resolve(confirm('Hard reset to HEAD will discard ALL changes. Continue?')));
            if (!ok) return;
            try { const r = await api.git.reset(projectPath, 'hard', 'HEAD'); if (r?.ok === false) throw new Error(r.error); showStatusMsg('Reset hard'); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Reset failed: ' + e.message, 'error'); }
          } },
          { type: 'sep' },
          { icon: ICONS.remote, label: 'Add Remote…', action: async () => {
            const url = await window.PiPilot.modal.prompt({
              title: 'Add Remote',
              label: 'Paste the remote URL:',
              placeholder: 'https://github.com/user/repo.git',
              confirmText: 'Add',
            });
            if (!url || !url.trim()) return;
            // Auto-pick a name: 'origin' if free, else 'upstream', else extract from URL
            let name = 'origin';
            try {
              const r = await api.git.listRemotes(projectPath);
              const existing = new Set((r?.remotes || []).map(x => x.name));
              if (existing.has('origin')) name = existing.has('upstream') ? deriveRemoteName(url, existing) : 'upstream';
            } catch {}
            try { const r = await api.git.addRemote(projectPath, name, url.trim()); if (r?.ok === false) throw new Error(r.error); showStatusMsg(`Added "${name}"`); gitStatus = await loadStatus(); }
            catch (e) { showStatusMsg('Add remote failed: ' + e.message, 'error'); }
          } },
          { icon: ICONS.remote, label: 'Manage Remotes…', action: async () => { await openManageRemotesModal(projectPath); gitStatus = await loadStatus(); } },
          { icon: ICONS.refresh,label: 'Refresh', action: async () => { gitStatus=await loadStatus(); showStatusMsg('Refreshed','info'); } },
        ];

        menuActions.forEach(a => {
          if (a.type === 'sep') { menu.appendChild(el('div', { class: 'git-menu-sep' })); return; }
          const item = el('button', { class: 'git-menu-item' + (a.danger ? ' danger' : '') });
          item.innerHTML = (a.icon ? svgIcon(a.icon, 12, 'style="margin-right:8px;vertical-align:middle;flex-shrink:0"') : '<span style="display:inline-block;width:20px"></span>') + escapeHtml(a.label);
          item.addEventListener('click', async () => {
            showActionsMenu = false;
            renderAll(); // close menu immediately
            try { await a.action(); } catch (err) { showStatusMsg(a.label + ' failed: ' + (err?.message || err), 'error'); }
            renderAll();
          });
          menu.appendChild(item);
        });
        document.body.appendChild(menu);
      }

      // wire branch-btn to toggle dropdown
      const renderedBranchBtn = container.querySelector('.git-branch-btn');
      if (renderedBranchBtn) {
        renderedBranchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const width = 260;
          branchMenuPos = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width };
          showBranchDropdown = !showBranchDropdown;
          showActionsMenu = false;
          renderAll();
        });
      }

      container.scrollTop = scrollTop;
    } // end renderAll()

    renderAll();

    // ── auto-refresh every 5s ──────────────────────────────────────────────
    refreshTimer = setInterval(async () => {
      if (!container.isConnected) { clearInterval(refreshTimer); return; }
      const ns = await loadStatus();
      if (!ns) return;
      // Only re-render if files changed
      const prev = JSON.stringify((gitStatus?.files || []).map(f => f.path + f.index + f.working_dir));
      const next = JSON.stringify((ns.files || []).map(f => f.path + f.index + f.working_dir));
      if (prev !== next || ns.branch !== gitStatus?.branch) {
        gitStatus = ns;
        bus.emit('git:branch-changed', gitStatus.branch);
        renderAll();
      } else {
        gitStatus = ns;
      }
    }, 5000);

    // Stop polling when container leaves DOM
    new MutationObserver(() => {
      if (!container.isConnected) { clearInterval(refreshTimer); }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---------------- EXTENSIONS PANEL ----------------
  async function renderExtensionsPanel(container, projectPath) {
    container.innerHTML = '';
    let activeTab = 'extensions';
    let extQuery = '';
    let extCategory = 'all'; // 'all' | 'themes' | 'editor' | …

    async function render() {
      container.innerHTML = '';
      const header = el('div', { class: 'panel-header' }, el('span', { class: 'panel-title' }, 'Extensions'));
      container.appendChild(header);

      const tabs = el('div', { class: 'p-tabs' });
      ['extensions', 'agents', 'mcp', 'cloud'].forEach(t => {
        const label = t === 'extensions' ? 'Extensions' : t === 'agents' ? 'Agents' : t === 'mcp' ? 'MCP Servers' : 'Connectors';
        const b = el('button', { class: 'p-tab' + (activeTab === t ? ' active' : ''), onClick: () => { activeTab = t; render(); } }, label);
        tabs.appendChild(b);
      });
      container.appendChild(tabs);

      if (activeTab === 'extensions') {
        await renderExtensionsTab(container);
      } else if (activeTab === 'agents') {
        const AGENTS = [
          { id: 'fullstack-developer', name: 'Fullstack Developer', desc: 'End-to-end feature development — DB, API, frontend', icon: '🏗️', builtin: true },
          { id: 'ai-engineer', name: 'AI Engineer', desc: 'AI/ML integration — LLM apps, RAG, prompt engineering', icon: '🤖', builtin: true },
          { id: 'api-designer', name: 'API Designer', desc: 'REST/GraphQL API design, OpenAPI specs, auth patterns', icon: '🔌', builtin: true },
          { id: 'security-engineer', name: 'Security Engineer', desc: 'Vulnerability assessment, OWASP, DevSecOps', icon: '🛡️', builtin: true },
          { id: 'frontend-designer', name: 'Frontend Designer', desc: 'Distinctive UI design with design system persistence', icon: '🎨', builtin: true },
          { id: 'wiki-generator', name: 'Wiki Generator', desc: 'Scan codebase and generate documentation', icon: '📖', builtin: true },
          { id: 'agent-installer', name: 'Agent Installer', desc: 'Browse and install agents from VoltAgent repository', icon: '📥', builtin: true },
          { id: 'mcp-installer', name: 'MCP Installer', desc: 'Search and install MCP servers from official registry', icon: '🧩', builtin: true },
        ];
        const sec = el('div', { class: 'p-section' });
        sec.appendChild(el('h4', null, 'Sub-Agents'));
        sec.appendChild(el('div', { style: { color: 'var(--text-dim)', fontSize: '10px', marginBottom: '8px' } }, 'The AI can delegate tasks to these specialized agents'));
        AGENTS.forEach(a => {
          var card = el('div', { class: 'connector-card' },
            el('div', { class: 'icon', style: { fontSize: '18px' } }, a.icon),
            el('div', { class: 'info' },
              el('div', { class: 'name', style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                a.name,
                a.builtin ? el('span', { style: { fontSize: '8px', padding: '1px 4px', borderRadius: '2px', background: 'rgba(86,211,100,0.1)', color: 'var(--ok)', fontFamily: 'var(--font-mono)', fontWeight: '600' } }, 'BUILT-IN') : null
              ),
              el('div', { class: 'desc' }, a.desc)
            )
          );
          // Add "Use" button that sends the agent name to chat
          card.appendChild(el('button', { class: 'btn btn-secondary btn-small', style: { fontSize: '9px', flexShrink: '0' }, onClick: () => {
            bus.emit('chat:focus-with-prompt', 'Use the ' + a.id + ' sub-agent to ');
          } }, 'Use'));
          sec.appendChild(card);
        });
        container.appendChild(sec);
      } else if (activeTab === 'mcp') {
        // Built-in MCP servers
        const builtinSec = el('div', { class: 'p-section' });
        builtinSec.appendChild(el('h4', null, 'Built-in'));
        const BUILTIN_MCPS = [
          { name: 'PiPilot', desc: 'IDE tools, search, diagnostics, run code', icon: '⚡' },
          { name: 'Context7', desc: 'Documentation search', icon: '📚' },
          { name: 'AppDeploy', desc: 'Deploy full-stack apps', icon: '🚀' },
          { name: 'DeepWiki', desc: 'GitHub repo documentation', icon: '📖' },
          { name: 'Sequential Thinking', desc: 'Structured reasoning', icon: '🧠' },
          { name: 'Chrome DevTools', desc: 'Inspect & debug pages', icon: '🔧' },
          { name: 'Playwright', desc: 'Browser automation', icon: '🎭' },
        ];
        BUILTIN_MCPS.forEach(m => {
          builtinSec.appendChild(el('div', { class: 'connector-card', style: { opacity: '0.7' } },
            el('div', { class: 'icon', style: { fontSize: '16px' } }, m.icon),
            el('div', { class: 'info' },
              el('div', { class: 'name' }, m.name),
              el('div', { class: 'desc' }, m.desc)
            )
          ));
        });
        container.appendChild(builtinSec);

        // User-configured MCP servers
        const userSec = el('div', { class: 'p-section' });
        userSec.appendChild(el('h4', null, 'Custom'));
        userSec.appendChild(el('button', { class: 'btn btn-secondary btn-small', style: { width: '100%', marginBottom: '8px' }, onClick: () => bus.emit('modal:add-mcp') }, '+ Add MCP Server'));
        let resp;
        try { resp = await api.mcp.listServers(); } catch { resp = { servers: [] }; }
        const servers = (resp && resp.servers) || [];
        if (!servers.length) {
          userSec.appendChild(el('div', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, 'No custom MCP servers added'));
        }
        servers.forEach(s => {
          const isHttp = s.type === 'http';
          const desc = isHttp ? (s.url || '') : `${s.command || ''} ${(s.args || []).join(' ')}`;
          const badge = isHttp ? 'HTTP' : 'STDIO';
          const hasAuth = isHttp && s.headers && Object.keys(s.headers).length > 0;
          const card = el('div', { class: 'connector-card' },
            el('div', { class: 'icon' }, '🧩'),
            el('div', { class: 'info' },
              el('div', { class: 'name', style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                s.name,
                el('span', { style: { fontSize: '8px', padding: '1px 4px', borderRadius: '2px', background: isHttp ? 'rgba(108,182,255,0.15)' : 'rgba(86,211,100,0.15)', color: isHttp ? 'var(--info)' : 'var(--ok)', fontFamily: 'var(--font-mono)', fontWeight: '600' } }, badge),
                hasAuth ? el('span', { style: { fontSize: '8px', padding: '1px 4px', borderRadius: '2px', background: 'rgba(86,211,100,0.1)', color: 'var(--ok)', fontFamily: 'var(--font-mono)' } }, '🔑') : null
              ),
              el('div', { class: 'desc', style: { fontFamily: 'var(--font-mono)', fontSize: '10px' } }, desc)
            ),
            el('div', { class: 'toggle' + (s.enabled ? ' on' : ''), onClick: async () => { await api.mcp.toggleServer(s.id, !s.enabled); render(); } })
          );
          card.appendChild(el('button', { class: 'icon-btn', onClick: async () => { await api.mcp.removeServer(s.id); render(); } }, '×'));
          userSec.appendChild(card);
        });
        container.appendChild(userSec);
      } else {
        const sec = el('div', { class: 'p-section' });
        let resp;
        try { resp = await api.cloud.listConnectors(); } catch { resp = { connectors: [] }; }
        const list = (resp && resp.connectors) || resp || [];
        list.forEach(c => {
          const card = el('div', { class: 'connector-card' },
            el('div', { class: 'icon' }, c.icon || '☁'),
            el('div', { class: 'info' },
              el('div', { class: 'name' }, c.name),
              el('div', { class: 'desc' }, c.desc || ''),
              c.connected ? el('div', { class: 'conn' }, c.username ? `Connected as @${c.username}` : 'Connected') : null
            )
          );
          if (c.connected) {
            card.appendChild(el('button', { class: 'btn btn-secondary btn-small', onClick: async () => {
              if (await window.PiPilot.modal.confirm({ title: 'Disconnect?', message: `Disconnect ${c.name}?` })) {
                await api.cloud.deleteToken(c.id);
                render();
              }
            } }, 'Disconnect'));
          } else {
            card.appendChild(el('button', { class: 'btn btn-primary btn-small', onClick: () => bus.emit('modal:connect-cloud', c.id) }, 'Connect'));
          }
          sec.appendChild(card);
        });
        container.appendChild(sec);
      }
    }

    // ── Extensions tab: browse registry + manage installed ──
    async function renderExtensionsTab(container) {
      // Remove previous extensions section if re-rendering
      const oldSec = container.querySelector('.ext-section');
      if (oldSec) oldSec.remove();

      const sec = el('div', { class: 'p-section ext-section' });

      // Fetch registry, installed, and built-ins in parallel
      const [registryResp, installedResp, builtinsResp, settingsResp] = await Promise.all([
        api.extensions?.registry?.().catch(() => ({ extensions: [] })) || { extensions: [] },
        api.extensions?.installed?.().catch(() => ({ installed: {} })) || { installed: {} },
        api.extensions?.listBuiltins?.().catch(() => ({ builtins: [] })) || { builtins: [] },
        api.settings?.all?.().catch(() => ({ settings: {} })) || { settings: {} },
      ]);
      const registry = registryResp?.extensions || [];
      const installed = installedResp?.installed || {};
      const builtins = builtinsResp?.builtins || [];
      const settings = settingsResp?.settings || {};

      // ── Search box + category chips ───────────────────────────────
      const searchRow = el('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0 10px', position: 'sticky', top: '0', background: 'var(--surface)', zIndex: '2' }
      });
      const searchInput = el('input', {
        type: 'text',
        placeholder: 'Search extensions, themes, authors…',
        value: extQuery,
        style: {
          background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)',
          padding: '6px 10px', borderRadius: '4px', fontSize: '12px', width: '100%',
          fontFamily: 'inherit', outline: 'none',
        },
      });
      searchInput.addEventListener('input', () => {
        extQuery = searchInput.value.trim().toLowerCase();
        applyFilter();
      });

      // Pull all category names dynamically from registry + installed.
      const allCats = new Set();
      for (const r of registry) (r.categories || []).forEach(c => allCats.add(c));
      for (const i of Object.values(installed)) (i.categories || []).forEach(c => allCats.add(c));
      const pinned = ['themes', 'fonts'];
      const categoryOrder = ['all', ...pinned.filter(p => allCats.has(p)),
        ...[...allCats].filter(c => !pinned.includes(c)).sort()];

      const chipsRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
      for (const cat of categoryOrder) {
        const chip = el('button', {
          dataset: { cat },
          style: {
            background: cat === extCategory ? 'var(--accent)' : 'var(--surface-alt)',
            color: cat === extCategory ? '#fff' : 'var(--text-mid)',
            border: '1px solid ' + (cat === extCategory ? 'var(--accent)' : 'var(--border)'),
            borderRadius: '999px', padding: '2px 9px', fontSize: '10.5px',
            fontFamily: 'inherit', cursor: 'pointer', textTransform: 'capitalize',
            transition: 'background 120ms, color 120ms',
          },
          onClick: () => { extCategory = cat; render(); },
        }, cat === 'all' ? 'All' : cat);
        chipsRow.appendChild(chip);
      }

      searchRow.appendChild(searchInput);
      searchRow.appendChild(chipsRow);
      sec.appendChild(searchRow);

      function matchesFilter(meta) {
        const cats = meta.categories || [];
        if (extCategory !== 'all' && !cats.includes(extCategory)) return false;
        if (!extQuery) return true;
        const haystack = [meta.name, meta.id, meta.description, meta.author, ...(cats || [])]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(extQuery);
      }
      function applyFilter() {
        sec.querySelectorAll('[data-ext-card]').forEach(card => {
          const id = card.dataset.extId;
          // Built-ins don't filter — they always show; otherwise read meta from data attrs.
          if (card.dataset.builtin === '1') {
            card.style.display = extQuery || extCategory !== 'all' ? 'none' : '';
            return;
          }
          const cats = (card.dataset.cats || '').split(',').filter(Boolean);
          const ok = matchesFilter({
            id,
            name: card.dataset.name || '',
            description: card.dataset.desc || '',
            author: card.dataset.author || '',
            categories: cats,
          });
          card.style.display = ok ? '' : 'none';
        });
      }

      // ── Built-in extensions (always present, can't be uninstalled) ──
      // These render BEFORE marketplace extensions with a "Built-in" badge
      // and a settings-gear button instead of a toggle. The gear opens
      // Settings → Features where the user can enable/disable them.
      const GEAR_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
      for (const b of builtins) {
        const enabled = settings[b.settingsKey] !== false;
        const card = el('div', { class: 'connector-card builtin-ext' });
        card.style.flexWrap = 'wrap';
        card.dataset.extCard = '1';
        card.dataset.builtin = '1';
        card.dataset.extId = b.id;

        const icon = el('div', { class: 'icon', style: { fontSize: '18px' } }, '⚡');

        const builtinBadge = el('span', {
          style: {
            display: 'inline-flex', alignItems: 'center',
            padding: '1px 6px',
            fontSize: '9px', fontWeight: '600',
            color: 'var(--accent-light)',
            background: 'rgba(255,107,53,0.10)',
            border: '1px solid rgba(255,107,53,0.28)',
            borderRadius: '3px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          },
        }, 'Built-in');

        const stateBadge = el('span', {
          style: {
            display: 'inline-flex', alignItems: 'center',
            padding: '1px 6px',
            fontSize: '9px', fontWeight: '500',
            color: enabled ? 'var(--ok)' : 'var(--text-faint)',
            background: enabled ? 'rgba(86,211,100,0.10)' : 'rgba(255,255,255,0.04)',
            border: enabled ? '1px solid rgba(86,211,100,0.28)' : '1px solid var(--border)',
            borderRadius: '3px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
          },
        }, enabled ? 'On' : 'Off');

        const info = el('div', { class: 'info' },
          el('div', { class: 'name', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
            b.name,
            builtinBadge,
            stateBadge,
          ),
          el('div', { class: 'desc' }, b.desc || ''),
          el('div', { style: { fontSize: '9px', color: 'var(--text-dim)', marginTop: '2px' } }, 'Ships with PiPilot · cannot be uninstalled')
        );

        card.appendChild(icon);
        card.appendChild(info);

        const actions = el('div', { style: { display: 'flex', gap: '4px', marginLeft: 'auto' } });
        // Settings gear → opens Settings modal at the Features tab.
        const gearBtn = el('button', {
          class: 'btn btn-secondary btn-small',
          title: 'Configure in Settings → Features',
          style: { padding: '4px 7px', display: 'inline-flex', alignItems: 'center', gap: '4px' },
          onClick: () => bus.emit('modal:settings', { tab: 'Features' }),
        });
        gearBtn.innerHTML = GEAR_SVG + '<span style="font-size:10px;">Settings</span>';
        actions.appendChild(gearBtn);

        card.appendChild(actions);
        sec.appendChild(card);
      }

      if (!registry.length && !Object.keys(installed).length && !builtins.length) {
        sec.appendChild(el('div', { style: { color: 'var(--text-dim)', fontSize: '11px', padding: '12px 0' } }, 'No extensions available yet. Check back soon!'));
        container.appendChild(sec);
        return;
      }
      if (!registry.length && !Object.keys(installed).length) {
        // Built-ins rendered above; no marketplace yet.
        container.appendChild(sec);
        return;
      }

      // Merge: show installed first, then registry (skip already installed).
      // ALSO skip anything whose id is a built-in — those are already
      // rendered above as built-in cards and re-listing them in the
      // marketplace would let users "install" duplicates.
      const builtinIds = new Set(builtins.map(b => b.id));
      const installedIds = new Set(Object.keys(installed));
      const allExtensions = [];

      // Installed extensions
      for (const [id, ext] of Object.entries(installed)) {
        if (builtinIds.has(id)) continue; // hidden — built-in supersedes
        const regEntry = registry.find(r => r.id === id);
        allExtensions.push({ ...ext, ...(regEntry || {}), id, _installed: true, _enabled: ext.enabled !== false });
      }

      // Registry extensions not yet installed
      for (const ext of registry) {
        if (builtinIds.has(ext.id)) continue; // hidden — built-in supersedes
        if (!installedIds.has(ext.id)) {
          allExtensions.push({ ...ext, _installed: false, _enabled: false });
        }
      }

      for (const ext of allExtensions) {
        const card = el('div', { class: 'connector-card' });
        card.style.flexWrap = 'wrap';
        card.dataset.extCard = '1';
        card.dataset.extId = ext.id;
        card.dataset.name = ext.name || ext.id;
        card.dataset.desc = ext.description || '';
        card.dataset.author = ext.author || '';
        card.dataset.cats = (ext.categories || []).join(',');

        // Apply current filter immediately (so newly rendered cards respect search/category).
        if (!matchesFilter(ext)) card.style.display = 'none';

        const isThemeExt = (ext.categories || []).includes('themes');
        const isFontExt  = (ext.categories || []).includes('fonts');
        const icon = el('div', { class: 'icon', style: { fontSize: '18px' } }, ext.icon || (isThemeExt ? '🎨' : isFontExt ? 'Aa' : '⚡'));
        const info = el('div', { class: 'info' },
          el('div', { class: 'name', style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            ext.name || ext.id,
            ext.version ? el('span', { style: { fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' } }, `v${ext.version}`) : null
          ),
          el('div', { class: 'desc' }, ext.description || ''),
          ext.author ? el('div', { style: { fontSize: '9px', color: 'var(--text-dim)', marginTop: '2px' } }, `by ${ext.author}`) : null
        );

        card.appendChild(icon);
        card.appendChild(info);

        const actions = el('div', { style: { display: 'flex', gap: '4px', marginLeft: 'auto' } });

        if (ext._installed) {
          // Toggle enable/disable
          const toggleBtn = el('div', {
            class: 'toggle' + (ext._enabled ? ' on' : ''),
            title: ext._enabled ? 'Disable' : 'Enable',
            onClick: async () => {
              await api.extensions.toggle(ext.id, !ext._enabled);
              bus.emit('toast:show', { type: 'ok', message: `${ext.name} ${ext._enabled ? 'disabled' : 'enabled'} — restart to apply` });
              render();
            },
          });
          actions.appendChild(toggleBtn);

          // Uninstall
          actions.appendChild(el('button', { class: 'btn btn-secondary btn-small', style: { color: 'var(--error)', fontSize: '9px' }, title: 'Uninstall', onClick: async () => {
            await api.extensions.uninstall(ext.id);
            // Clean up extension's IndexedDB database
            if (window.PiPilot.extDB?.destroy) {
              try { await window.PiPilot.extDB.destroy(ext.id); } catch (e) {}
            }
            bus.emit('toast:show', { type: 'ok', message: `${ext.name} uninstalled` });
            render();
          } }, 'Uninstall'));
        } else {
          // Install
          actions.appendChild(el('button', { class: 'btn btn-primary btn-small', onClick: async () => {
            bus.emit('toast:show', { type: 'info', message: `Installing ${ext.name}...` });
            const result = await api.extensions.install(ext.id, ext.url, {
              name: ext.name, description: ext.description, version: ext.version,
              author: ext.author, icon: ext.icon,
            });
            if (result?.ok) {
              // Load the extension immediately (no restart needed)
              try {
                const loaded = await api.extensions.load(ext.id);
                if (loaded?.ok && loaded.code) {
                  const db = window.PiPilot.extDB?.forExtension(ext.id) || null;
                  const fn = new Function('PiPilot', 'bus', 'api', 'state', 'db', loaded.code);
                  fn(window.PiPilot, window.PiPilot.bus, window.electronAPI, window.PiPilot.state, db);
                }
              } catch (e) { console.warn('[extensions] live-load failed:', e); }
              bus.emit('toast:show', { type: 'ok', message: `${ext.name} installed and activated` });
              render();
            } else {
              bus.emit('toast:show', { type: 'error', message: 'Install failed: ' + (result?.error || 'unknown') });
            }
          } }, 'Install'));
        }

        card.appendChild(actions);
        sec.appendChild(card);
      }

      container.appendChild(sec);
    }

    render();
  }

  // ---------------- DEPLOY PANEL ----------------
  async function renderDeployPanel(container, projectPath) {
    async function render() {
      container.innerHTML = '';
      const header = el('div', { class: 'panel-header' },
        el('span', { class: 'panel-title' }, 'Deploy'),
        el('div', { class: 'panel-actions' },
          el('button', { class: 'icon-btn', title: 'Refresh', onClick: render }, '↻')
        )
      );
      container.appendChild(header);

      const sec1 = el('div', { class: 'p-section' });
      sec1.appendChild(el('h4', null, 'Dev Servers'));
      sec1.appendChild(el('button', { class: 'btn btn-primary btn-small', style: { width: '100%', marginBottom: '8px' }, onClick: async () => {
        bus.emit('toast:show', { message: 'Starting dev server…', type: 'info' });
        const r = await api.devServer.start(projectPath);
        if (r && r.ok === false) bus.emit('toast:show', { message: 'Start failed: ' + r.error, type: 'error' });
        else bus.emit('toast:show', { message: 'Dev server started', type: 'success' });
        render();
      } }, '▶ Start Dev Server'));

      let resp;
      try { resp = await api.devServer.list(); } catch { resp = { servers: [] }; }
      const servers = ((resp && resp.servers) || []).filter(s => s.projectPath === projectPath);
      if (!servers.length) {
        sec1.appendChild(el('div', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, 'No dev servers running'));
      }
      servers.forEach(s => {
        const item = el('div', { class: 'dev-item' });
        item.appendChild(el('div', null,
          el('span', { class: 'status-dot ' + s.status }),
          el('span', { class: 'cmd' }, s.cmd)
        ));
        if (s.url) item.appendChild(el('div', { class: 'url', onClick: () => api.shell.openExternal(s.url), style: { cursor: 'pointer' } }, s.url));
        const actions = el('div', { class: 'actions', style: { display: 'flex', gap: '6px', marginTop: '6px' } });
        if (s.status === 'running') {
          actions.appendChild(el('button', { class: 'btn btn-secondary btn-small', onClick: async () => { await api.devServer.stop(s.id); render(); } }, 'Stop'));
        }
        item.appendChild(actions);
        sec1.appendChild(item);
      });
      container.appendChild(sec1);

      const sec2 = el('div', { class: 'p-section' });
      sec2.appendChild(el('h4', null, 'Cloud Deploy'));
      let connResp;
      try { connResp = await api.cloud.listConnectors(); } catch { connResp = { connectors: [] }; }
      const connectors = ((connResp && connResp.connectors) || connResp || []).filter(c => ['vercel', 'netlify', 'cloudflare'].includes(c.id));
      connectors.forEach(c => {
        const card = el('div', { class: 'connector-card' },
          el('div', { class: 'icon' }, c.icon),
          el('div', { class: 'info' },
            el('div', { class: 'name' }, c.name),
            el('div', { class: 'desc' }, c.connected ? 'Connected' : 'Not connected')
          ),
          el('button', { class: 'btn btn-primary btn-small', disabled: !c.connected ? '' : null, onClick: () => {
            if (!c.connected) bus.emit('modal:connect-cloud', c.id);
            else bus.emit('toast:show', { message: `${c.name} deploy: coming soon`, type: 'info' });
          } }, c.connected ? 'Deploy' : 'Connect')
        );
        sec2.appendChild(card);
      });
      container.appendChild(sec2);
    }
    render();
  }

  // ---------------- OUTLINE PANEL ----------------
  function renderOutlinePanel(container) {
    container.innerHTML = '';
    const header = el('div', { class: 'panel-header' },
      el('span', { class: 'panel-title' }, 'Outline'),
      el('div', { class: 'panel-actions' },
        el('button', { class: 'icon-btn', title: 'Refresh', onClick: () => renderOutlinePanel(container) }, '↻')
      )
    );
    container.appendChild(header);
    const content = el('div', { id: 'outline-panel-content' });
    container.appendChild(content);
    // Delegate to ace-ai.js outline renderer
    if (window.PiPilot?.editorAi?.renderOutline) {
      window.PiPilot.editorAi.renderOutline(content);
    } else {
      content.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:11px;">Open a file to see symbols</div>';
    }
  }

  // ── WIKI PANEL ──
  // Lucide-style SVG icons for wiki pages
  const WIKI_ICONS = {
    home: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    layers: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    package: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    zap: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    terminal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    cloud: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    help: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    database: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    grid: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    palette: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2"/><circle cx="17.5" cy="10.5" r="2"/><circle cx="8.5" cy="7.5" r="2"/><circle cx="6.5" cy="12.5" r="2"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9.8-10-9.8z"/></svg>',
    settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
    'file-text': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  };

  let _wikiGenerating = false;
  let _wikiContainer = null;
  let _wikiProjectPath = null;

  // Listen for wiki generation signal from agent hooks
  bus.on('wiki:generating', (generating) => {
    _wikiGenerating = !!generating;
    if (_wikiContainer) updateWikiGeneratingBanner(_wikiContainer);
    // Auto-switch to wiki panel when generation starts
    if (generating) bus.emit('panel:switch', 'wiki');
  });

  // Listen for file changes in .pipilot/wikis/ and auto-refresh
  bus.on('file:external-change', (evt) => {
    if (!evt?.path || !_wikiContainer || !_wikiProjectPath) return;
    const p = String(evt.path).replace(/\\/g, '/');
    if (p.includes('.pipilot/wikis/') && p.endsWith('.md')) {
      if (_wikiContainer._refreshTimer) clearTimeout(_wikiContainer._refreshTimer);
      _wikiContainer._refreshTimer = setTimeout(() => {
        renderWikiPanel(_wikiContainer, _wikiProjectPath);
      }, 800);
    }
  });

  // Also listen for chokidar watcher events (covers add/change/unlink)
  bus.on('file:changed', (evt) => {
    if (!evt?.path || !_wikiContainer || !_wikiProjectPath) return;
    const p = String(evt.path).replace(/\\/g, '/');
    if (p.includes('.pipilot/wikis/') && p.endsWith('.md')) {
      if (_wikiContainer._refreshTimer) clearTimeout(_wikiContainer._refreshTimer);
      _wikiContainer._refreshTimer = setTimeout(() => {
        renderWikiPanel(_wikiContainer, _wikiProjectPath);
      }, 800);
    }
  });

  function updateWikiGeneratingBanner(container) {
    let banner = container.querySelector('.wiki-gen-banner');
    if (_wikiGenerating) {
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'wiki-gen-banner';
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,107,53,0.08);border:1px solid rgba(255,107,53,0.2);border-radius:6px;margin:8px 10px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="animation:tool-spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>
            <span style="font-size:11px;color:var(--accent);">Generating wiki...</span>
          </div>
        `;
        const header = container.querySelector('.panel-header');
        if (header) header.after(banner);
        else container.prepend(banner);
      }
    } else {
      if (banner) banner.remove();
    }
  }

  async function renderWikiPanel(container, projectPath) {
    container.innerHTML = '';
    _wikiContainer = container;
    const pp = projectPath || state.projectPath;
    _wikiProjectPath = pp;
    if (!pp) { container.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:11px;">Open a project first</div>'; return; }

    const header = el('div', { class: 'panel-header' },
      el('span', { class: 'panel-title' }, 'Wiki'),
      el('div', { class: 'panel-actions' },
        el('button', { class: 'icon-btn', title: 'Generate Wiki', onClick: () => generateWiki(container, pp) }, '✨'),
        el('button', { class: 'icon-btn', title: 'Refresh', onClick: () => renderWikiPanel(container, pp) }, '↻')
      )
    );
    container.appendChild(header);
    updateWikiGeneratingBanner(container);

    let result;
    try {
      result = await api.wiki.tree(pp);
    } catch (err) {
      result = { ok: false, sections: [] };
    }
    const sections = result?.sections || [];

    if (!sections.length) {
      const empty = el('div', { style: 'padding:24px 16px;text-align:center;' });
      empty.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1" style="margin-bottom:8px;opacity:0.5;"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
        <div style="color:var(--text-dim);font-size:12px;margin-bottom:12px;">No wiki pages yet</div>
        <button class="btn btn-primary btn-small" id="wiki-generate-btn" style="font-size:11px;padding:6px 14px;">
          Generate Wiki
        </button>
        <div style="color:var(--text-faint);font-size:10px;margin-top:8px;">AI will scan your project and create docs</div>
      `;
      container.appendChild(empty);
      container.querySelector('#wiki-generate-btn')?.addEventListener('click', () => generateWiki(container, pp));
      return;
    }

    // Group sections by category
    const grouped = {};
    for (const s of sections) {
      const cat = s.category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(s);
    }

    const list = el('div', { style: 'padding:4px 0;' });

    for (const [category, pages] of Object.entries(grouped)) {
      // Category header (skip if only one category)
      if (Object.keys(grouped).length > 1) {
        const catHeader = el('div', { style: 'padding:6px 14px 2px;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;' }, category);
        list.appendChild(catHeader);
      }

      for (const s of pages) {
        const row = el('button', { style: 'display:flex;align-items:center;gap:8px;width:100%;padding:7px 14px;background:transparent;border:none;text-align:left;font-family:inherit;cursor:pointer;border-radius:0;transition:background 0.1s;' });

        const iconSvg = WIKI_ICONS[s.icon] || WIKI_ICONS['file-text'];
        row.innerHTML = `
          <span style="color:${s.color || 'var(--text-dim)'};display:inline-flex;flex-shrink:0;">${iconSvg}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text);">${escapeHtml(s.title)}</span>
          <span style="font-size:9px;color:var(--text-dim);flex-shrink:0;">${s.size > 1024 ? Math.round(s.size / 1024) + 'KB' : s.size + 'B'}</span>
        `;
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--surface-alt)'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
        row.addEventListener('click', () => openWikiPage(pp, s.id, s.title));
        list.appendChild(row);
      }
    }
    container.appendChild(list);
  }

  async function openWikiPage(projectPath, pageId, title, scrollToAnchor) {
    try {
      const result = await api.wiki.page(projectPath, pageId);
      if (!result?.ok || !result.content) { bus.emit('toast:show', { type: 'error', message: 'Page not found' }); return; }
      const editor = window.PiPilot?.editor;
      if (!editor) return;
      editor.openVirtualTab({
        id: `wiki:${pageId}`,
        name: `${title}`,
        mount: (container) => {
          container.style.cssText = 'width:100%;height:100%;overflow:auto;background:var(--bg);';

          // Parse markdown — add heading IDs for anchor navigation
          let html;
          if (window.marked?.parse) {
            // Configure marked to add IDs to headings
            const renderer = new window.marked.Renderer();
            renderer.heading = function(text, level) {
              // Handle marked v5+ object format
              const headingText = typeof text === 'object' ? text.text : text;
              const headingLevel = typeof text === 'object' ? text.depth : level;
              const slug = String(headingText).toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
              return `<h${headingLevel} id="${slug}">${headingText}</h${headingLevel}>`;
            };
            try { html = window.marked.parse(result.content, { renderer }); } catch { html = escapeHtml(result.content).replace(/\n/g, '<br>'); }
          } else {
            html = escapeHtml(result.content).replace(/\n/g, '<br>');
          }

          container.innerHTML = `<div class="md-body wiki-body" style="max-width:760px;margin:0 auto;padding:32px 40px;font-family:var(--font-sans);font-size:14px;line-height:1.7;color:var(--text);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:8px;flex-wrap:wrap;">
              <h1 id="top" style="font-size:24px;margin:0;color:var(--text-strong);flex:1 1 auto;min-width:0;">${escapeHtml(title)}</h1>
              <div style="display:flex;gap:6px;flex:0 0 auto;">
                <button class="wiki-pdf-btn" title="Download this page as PDF" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:11px;background:rgba(255,107,53,0.12);border:1px solid rgba(255,107,53,0.28);border-radius:4px;color:var(--accent-light);cursor:pointer;font-weight:500;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Download PDF</span>
                </button>
                <button class="wiki-edit-btn" style="padding:4px 10px;font-size:11px;background:var(--surface-alt);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;">Edit</button>
              </div>
            </div>
            ${html}
          </div>`;

          // ── Handle all link clicks inside the wiki body ──
          container.querySelector('.wiki-body')?.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (!link) return;
            e.preventDefault();
            const href = link.getAttribute('href') || '';

            // 1. Anchor links (#section) — scroll within this page
            if (href.startsWith('#')) {
              const targetId = href.slice(1);
              const target = container.querySelector(`#${CSS.escape(targetId)}`);
              if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              return;
            }

            // 2. Cross-page wiki links (architecture.md, setup.md, etc.)
            if (href.endsWith('.md') && !href.includes('://')) {
              const linkedPageId = href.replace(/\.md$/, '').replace(/^\.?\/?/, '');
              const linkedTitle = linkedPageId.charAt(0).toUpperCase() + linkedPageId.slice(1).replace(/[-_]/g, ' ');
              // Check for anchor in cross-page link (e.g. setup.md#installation)
              const [pagePart, anchorPart] = linkedPageId.split('#');
              openWikiPage(projectPath, pagePart, linkedTitle, anchorPart || null);
              return;
            }

            // 3. File deep links (src/app.js, bin/codepilot.js, etc.) — open in editor
            if (!href.includes('://') && /\.\w{1,8}$/.test(href) && !href.endsWith('.md')) {
              const filePath = projectPath + '/' + href.replace(/^\.?\/?/, '');
              bus.emit('file:open', { path: filePath });
              return;
            }

            // 4. External URLs — open in system browser
            if (href.startsWith('http://') || href.startsWith('https://')) {
              try { require('electron').shell.openExternal(href); } catch {
                window.open(href, '_blank');
              }
              return;
            }
          });

          // ── Copy-to-clipboard buttons on every fenced code block ──
          // Hover-reveal button in the top-right of each <pre>; click
          // copies the inner code text. Mirrors the mission stream tab
          // and chat panel UX so the wiki feels equally responsive.
          container.querySelectorAll('.wiki-body pre').forEach((pre) => {
            // Don't double-decorate; mermaid blocks get replaced below
            // so they end up not being <pre> any more — safe.
            if (pre.querySelector('.pp-copy-btn')) return;
            // Skip mermaid pre — they get replaced by the mermaid pass
            // below into a div that's no longer a <pre>.
            if (pre.querySelector('code.language-mermaid')) return;
            pre.style.position = pre.style.position || 'relative';
            const btn = document.createElement('button');
            btn.className = 'pp-copy-btn';
            btn.type = 'button';
            btn.textContent = 'Copy';
            btn.style.cssText = 'position:absolute;top:6px;right:6px;background:rgba(20,20,26,0.92);border:1px solid rgba(255,255,255,0.1);color:var(--text-dim);cursor:pointer;padding:3px 9px;border-radius:4px;font-size:10.5px;font-family:var(--font-sans);transition:all 0.15s;opacity:0;';
            pre.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
            pre.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const text = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
              try {
                await navigator.clipboard.writeText(text);
                btn.textContent = 'Copied'; btn.style.color = 'var(--ok,#62c167)'; btn.style.borderColor = 'rgba(98,193,103,0.3)';
                setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = 'var(--text-dim)'; btn.style.borderColor = 'rgba(255,255,255,0.1)'; }, 1200);
              } catch {
                btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
              }
            });
            pre.appendChild(btn);
          });

          // Make sure the wiki body permits text selection — some
          // earlier styles may have inherited user-select:none.
          const wb = container.querySelector('.wiki-body');
          if (wb) wb.style.userSelect = 'text';

          // ── Mermaid diagrams (defensive — bad syntax shows a note, not a bomb)
          if (window.mermaid && window.PiPilot?.mermaidSafe) {
            container.querySelectorAll('pre code.language-mermaid').forEach((code, idx) => {
              const pre = code.closest('pre');
              if (!pre) return;
              const src = code.textContent || '';
              const div = document.createElement('div');
              div.style.cssText = 'margin:12px 0;text-align:center;overflow-x:auto;';
              pre.replaceWith(div);
              const wikiPagePath = projectPath + '/.pipilot/wikis/' + pageId + '.md';
              window.PiPilot.mermaidSafe.renderInto(div, src, 'wiki-mmd', {
                filePath: wikiPagePath,
                label: `Wiki page "${title}", diagram #${idx + 1}`,
              }).then(node => {
                if (node && node.tagName === 'svg' && window.PiPilot?.diagramExport?.attachExportMenu) {
                  window.PiPilot.diagramExport.attachExportMenu(node, `${pageId}-diagram-${idx + 1}`);
                }
              });
            });
          }

          // ── PDF download (uses shared pdf-export utility) ──
          container.querySelector('.wiki-pdf-btn')?.addEventListener('click', async () => {
            const btn = container.querySelector('.wiki-pdf-btn');
            const label = btn?.querySelector('span');
            const orig = label?.textContent || '';
            if (label) label.textContent = 'Generating…';
            if (btn) btn.disabled = true;
            try {
              const node = container.querySelector('.wiki-body');
              if (window.PiPilot?.pdfExport?.exportNode) {
                await window.PiPilot.pdfExport.exportNode(node, pageId || title || 'wiki');
              }
            } finally {
              if (label) label.textContent = orig || 'Download PDF';
              if (btn) btn.disabled = false;
            }
          });

          // ── Edit button ──
          container.querySelector('.wiki-edit-btn')?.addEventListener('click', () => {
            const fp = projectPath + '/.pipilot/wikis/' + pageId + '.md';
            bus.emit('file:open', { path: fp });
          });

          // ── Scroll to anchor if requested ──
          if (scrollToAnchor) {
            setTimeout(() => {
              const target = container.querySelector(`#${CSS.escape(scrollToAnchor)}`);
              if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
          }
        },
      });
    } catch (err) { bus.emit('toast:show', { type: 'error', message: err.message }); }
  }

  function generateWiki(container, projectPath) {
    // Show generating banner immediately
    _wikiGenerating = true;
    if (container) updateWikiGeneratingBanner(container);

    const root = document.getElementById('ide-root');
    if (root) root.classList.remove('chat-collapsed');
    bus.emit('menu:view:toggle-chat');
    setTimeout(() => {
      const root2 = document.getElementById('ide-root');
      if (root2?.classList.contains('chat-collapsed')) bus.emit('menu:view:toggle-chat');
      window.dispatchEvent(new CustomEvent('pipilot:focus-chat-input', {
        detail: {
          prefill: 'Use the wiki-generator sub-agent to scan this project and generate comprehensive wiki documentation in .pipilot/wikis/. It should create: index.md, architecture.md, modules.md, api.md, and setup.md.',
          submit: true,
        },
      }));
    }, 300);
  }

  window.PiPilot.panels = {
    git: renderGitPanel,
    outline: renderOutlinePanel,
    wiki: renderWikiPanel,
    extensions: renderExtensionsPanel,
    deploy: renderDeployPanel,
  };

  bus.on('panels:refresh', (panel) => {
    bus.emit('panel:switch', panel);
  });

  bus.on('git:changed', () => {
    const sidePanel = document.getElementById('side-panel-inner');
    if (sidePanel && sidePanel.dataset.panel === 'git' && state.projectPath) {
      renderGitPanel(sidePanel, state.projectPath);
    }
  });
})();
