// PiPilot IDE — Missions
//
// A Mission is a saved unit of background agent work: a prompt + target
// (local path OR cloud github repo) + trigger (manual, cron-ish, on-idle,
// on-commit, on-push) + permission preset. They run silently through the
// existing agent SDK plumbing.
//
// Architecture: this module owns STORAGE + the TRIGGER ENGINE. The
// actual agent run happens in the renderer (renderer/missions-runner.js)
// using the same `api.agent.send` path the wiki-auto-update agent uses
// — that way we avoid refactoring ipc-agent.js, and missions get the
// same proven silent-stream plumbing for free. When a trigger fires we
// broadcast `missions:run-now` to the renderer; the renderer reports
// back via `missions:report-run` so we can update stats and append the
// log file in one place.
//
// Storage:
//   <userData>/missions.json              — global, follows the user
//   <projectPath>/.pipilot/missions.json  — per-project, version-controllable
// Per-project missions override global on id collision.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// Minimal exec helper for the clone setup. Inherits a copy of
// process.env merged with extra vars (GH_TOKEN/GITHUB_TOKEN) so the
// child process is authenticated.
function execAsync(cmd, args, extraEnv = {}, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const env = { ...process.env, ...extraEnv };
    const child = execFile(cmd, args, { env, windowsHide: true, ...opts }, (err, so, se) => {
      stdout = so || ''; stderr = se || '';
      resolve({ ok: !err, code: err?.code ?? 0, stdout, stderr, error: err?.message });
    });
    setTimeout(() => { try { child.kill(); } catch {} }, opts.timeoutMs || 5 * 60_000);
  });
}

const TICK_INTERVAL_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const LOG_FILE = 'missions.log.md';

const PERMISSION_PRESETS = {
  'fs-only':       ['Read','Edit','Write','MultiEdit','Glob','Grep','mcp__pipilot__*'],
  'fs-plus-bash':  ['Read','Edit','Write','MultiEdit','Glob','Grep','Bash','BashOutput','KillShell','mcp__pipilot__*'],
  'fs-plus-web':   ['Read','Edit','Write','MultiEdit','Glob','Grep','WebFetch','WebSearch','mcp__pipilot__*','mcp__context7__*'],
  'full':          ['Read','Edit','Write','MultiEdit','Glob','Grep','Bash','BashOutput','KillShell','WebFetch','WebSearch','Agent','mcp__pipilot__*','mcp__context7__*','mcp__playwright__*'],
  // Cloud preset: full local toolkit (the agent works on a throwaway
  // scratch clone) + GitHub MCP for all GitHub-API ops (PRs, issues,
  // search, comments). No `gh` CLI — MCP covers the same surface area.
  // git is the only external binary needed, used via Bash for clone
  // setup (already done by main) and the final commit + push.
  'cloud':         ['Read','Edit','Write','MultiEdit','Glob','Grep','Bash','BashOutput','KillShell','WebFetch','WebSearch','mcp__github__*','mcp__pipilot__*','mcp__context7__*'],
};

module.exports = function register(ipcMain, ctx, deps = {}) {
  const { getSecret, ghEnsure } = deps;

  const globalFile = path.join(ctx.userDataPath, 'missions.json');
  const inFlight = new Map();   // id -> { startedAt }

  // ── Storage ───────────────────────────────────────────────────────

  function projectFile(projectPath) {
    if (!projectPath) return null;
    return path.join(projectPath, '.pipilot', 'missions.json');
  }

  async function readJson(file) {
    if (!file) return [];
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeJson(file, list) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(list, null, 2), 'utf8');
  }

  async function readAll(projectPath) {
    const [global, local] = await Promise.all([
      readJson(globalFile),
      readJson(projectFile(projectPath)),
    ]);
    const seen = new Map();
    for (const m of global) seen.set(m.id, { ...m, scope: 'global' });
    for (const m of local) seen.set(m.id, { ...m, scope: 'project', projectPathScope: projectPath });
    return Array.from(seen.values());
  }

  function newId() {
    return 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function defaults(partial) {
    const now = Date.now();
    const m = {
      id: partial.id || newId(),
      name: partial.name || 'Untitled Mission',
      prompt: partial.prompt || '',
      target: partial.target || { kind: 'local', projectPath: null },
      trigger: partial.trigger || { kind: 'manual' },
      permissions: partial.permissions || { preset: 'fs-only' },
      effort: partial.effort || 'medium',
      cooldownMs: partial.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      enabled: partial.enabled !== false,
      notify: partial.notify || { onSuccess: true, onError: true, onSkip: false },
      cloudPr: partial.cloudPr !== false,
      maxTokensPerRun: partial.maxTokensPerRun || 50_000,
      createdAt: partial.createdAt || now,
      lastRunAt: partial.lastRunAt || 0,
      lastRunStatus: partial.lastRunStatus || null,
      lastRunMessage: partial.lastRunMessage || '',
      runCount: partial.runCount || 0,
      ...partial,
      updatedAt: now,
    };
    return m;
  }

  function validate(mission) {
    const errs = [];
    if (!mission.name || !mission.name.trim()) errs.push('name required');
    if (!mission.prompt || mission.prompt.trim().length < 4) errs.push('prompt required');
    const t = mission.target || {};
    if (!t.kind) errs.push('target.kind required');
    if (t.kind === 'local' && !t.projectPath) errs.push('target.projectPath required for local missions');
    if (t.kind === 'cloud' && !t.repo) errs.push('target.repo required for cloud missions');
    return errs;
  }

  async function upsert(scope, projectPath, mission) {
    const m = defaults(mission);
    const errs = validate(m);
    if (errs.length) throw new Error('Invalid mission: ' + errs.join('; '));
    const file = scope === 'project' ? projectFile(projectPath) : globalFile;
    if (!file) throw new Error('project scope requires projectPath');
    const list = await readJson(file);
    const idx = list.findIndex((x) => x.id === m.id);
    if (idx >= 0) list[idx] = m;
    else list.push(m);
    await writeJson(file, list);
    return m;
  }

  async function remove(scope, projectPath, id) {
    const file = scope === 'project' ? projectFile(projectPath) : globalFile;
    if (!file) throw new Error('project scope requires projectPath');
    const list = await readJson(file);
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return { ok: true, removed: false };
    await writeJson(file, next);
    return { ok: true, removed: true };
  }

  async function patchStats(mission, patch) {
    const scope = mission.scope || 'global';
    const file = scope === 'project' ? projectFile(mission.projectPathScope || mission.target?.projectPath) : globalFile;
    if (!file) return;
    const list = await readJson(file);
    const idx = list.findIndex((x) => x.id === mission.id);
    if (idx < 0) return;
    list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
    await writeJson(file, list);
  }

  // ── Log ───────────────────────────────────────────────────────────

  function logFileFor(mission) {
    const root =
      mission.target?.kind === 'local' && mission.target.projectPath
        ? path.join(mission.target.projectPath, '.pipilot')
        : ctx.userDataPath;
    return path.join(root, LOG_FILE);
  }

  async function appendLog(mission, status, message) {
    try {
      const file = logFileFor(mission);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const stamp = new Date().toISOString();
      const block = [
        `\n## ${stamp} — ${mission.name} [${status}]`,
        `target: ${mission.target?.kind === 'cloud' ? 'cloud:' + mission.target.repo : 'local:' + (mission.target?.projectPath || '?')}`,
        `trigger: ${mission.trigger?.kind || '?'}`,
        '',
        (message || '').slice(0, 4000),
        '',
      ].join('\n');
      await fsp.appendFile(file, block, 'utf8');
    } catch (err) {
      console.warn('[missions] log append failed:', err.message);
    }
  }

  // ── Permissions → tools ───────────────────────────────────────────

  function buildAllowedTools(mission) {
    const preset = mission.permissions?.preset || 'fs-only';
    const base = PERMISSION_PRESETS[preset] || PERMISSION_PRESETS['fs-only'];
    const allow = new Set(base);
    for (const t of (mission.permissions?.extraAllow || [])) allow.add(t);
    for (const t of (mission.permissions?.extraDeny || [])) allow.delete(t);
    return Array.from(allow);
  }

  function buildSystemPrompt(mission, ghInfo = {}) {
    const isCloud = mission.target?.kind === 'cloud';
    const targetDesc = isCloud
      ? `the GitHub repository ${mission.target.repo} on branch ${mission.target.branch || 'main'}`
      : `the local project at ${mission.target.projectPath}`;

    // Tooling block — different per target. Cloud missions get TWO
    // ways to talk to GitHub: the official Copilot HTTP MCP at
    // https://api.githubcopilot.com/mcp (preferred for structured ops:
    // create_pull_request, search, etc.) AND the gh CLI in Bash (great
    // for ad-hoc shell ops, gh issue list, gh repo clone, etc.). The
    // CLI inherits GH_TOKEN from the agent process env so no auth flow
    // is needed; we never run `gh auth login`.
    let toolGuide;
    if (isCloud) {
      const baseBranch = mission.target.branch || 'main';
      const repo = mission.target.repo;
      const workBranch = `pipilot-mission-${mission.id}`;
      const scratchDir = ghInfo.scratchDir || `<scratch>`;
      const branchSetup = mission.cloudPr
        ? `git checkout -b ${workBranch}    # new branch off ${baseBranch}`
        : `git checkout ${baseBranch}       # direct-commit mode`;
      const pushCmd = mission.cloudPr
        ? `git push -u origin ${workBranch}`
        : `git push origin ${baseBranch}`;
      const prGuidance = mission.cloudPr
        ? [
            `6. **Open the Pull Request via the GitHub MCP** (NOT a shell command):`,
            `   \`\`\``,
            `   mcp__github__create_pull_request {`,
            `     owner: "${repo.split('/')[0]}",`,
            `     repo:  "${repo.split('/')[1]}",`,
            `     base:  "${baseBranch}",`,
            `     head:  "${workBranch}",`,
            `     title: "[PiPilot Mission] ${mission.name.replace(/"/g, '\\"')}",`,
            `     body:  "<3-8 sentence markdown summary: what changed and why>"`,
            `   }`,
            `   \`\`\``,
          ].join('\n')
        : `(No PR step — direct-commit mode. The push above already updated ${baseBranch}.)`;
      toolGuide = [
        `**Cloud mission workflow — clone, edit locally, push, then PR via MCP.**`,
        ``,
        `You have a clean, isolated git working tree pre-cloned at:`,
        `  ${scratchDir}`,
        `which is the cwd you were started in. \`git\` (${ghInfo.gitVersion || 'installed'}) is on PATH. The clone's \`origin\` remote URL has the PAT inlined for HTTPS push, so \`git push\` works with no auth prompt and no global config — that auth is scoped strictly to this scratch clone.`,
        ``,
        `For ALL GitHub API operations (PRs, issues, comments, search, repo metadata) use the **github MCP tools** (\`mcp__github__*\`). They're typed wrappers over the GitHub REST API, faster and more reliable than shelling out. The \`gh\` CLI is NOT installed and you don't need it.`,
        ``,
        `Standard flow — every cloud mission MUST follow this exact shape:`,
        ``,
        `1. **Orient.** \`git status\` and \`git log --oneline -5\` to confirm the clone state. The working tree is already on ${baseBranch} at HEAD.`,
        ``,
        `2. **Branch.** Create the working branch:`,
        `   \`\`\`bash`,
        `   ${branchSetup}`,
        `   \`\`\``,
        ``,
        `3. **Edit.** Use Read/Edit/Write/MultiEdit/Glob/Grep — these operate on the local clone exactly like a normal local mission. Make ALL the file changes the mission requires before committing. Run tests/builds if relevant: \`pnpm install && pnpm test\` (the cloned repo is a real working tree — pnpm/npm/yarn/cargo all work).`,
        ``,
        `4. **Commit ONCE.** Stage everything, commit with a single descriptive message:`,
        `   \`\`\`bash`,
        `   git add -A`,
        `   git commit -m "<imperative present-tense subject ≤72 chars>" -m "<blank line then markdown body explaining WHY>"`,
        `   \`\`\``,
        `   ONE commit covers the whole mission, no matter how many files changed. Maintainers reviewing PiPilot Mission PRs see a single atomic change.`,
        ``,
        `5. **Push.**`,
        `   \`\`\`bash`,
        `   ${pushCmd}`,
        `   \`\`\``,
        ``,
        prGuidance,
        ``,
        `Useful read-only MCP tools while planning: mcp__github__list_pull_requests, mcp__github__search_code, mcp__github__list_issues, mcp__github__get_issue, mcp__github__get_file_contents.`,
        ``,
        `Do NOT use mcp__github__create_or_update_file — that creates one commit per file and pollutes the PR history. The local-clone-and-push flow above gives you one atomic commit per mission, which is the whole point.`,
        ``,
        `If the mission turns out to be unnecessary, end with \`Skipped: <reason>\` and DO NOT push or open a PR. The scratch clone is left in place for inspection and cleaned up later.`,
      ].join('\n');
    } else {
      toolGuide = `Use Read/Edit/Write/Glob/Grep and the pipilot MCP tools to inspect and edit local files.`;
    }

    return [
      `You are PiPilot Mission Agent — a focused background agent.`,
      ``,
      `Mission: "${mission.name}"`,
      `Target: ${targetDesc}`,
      ``,
      `Instructions from the user:`,
      String(mission.prompt || '').trim(),
      ``,
      `Tooling guidance:`,
      toolGuide,
      ``,
      `Rules:`,
      `- You are running silently in the background. The user is not watching you stream.`,
      `- No <reasoning> blocks. No long preamble. Be terse.`,
      `- Stay strictly within the mission's instructions. Don't refactor unrelated code.`,
      `- End your final reply with one line summarising the outcome:`,
      `    Done: <one-sentence summary>`,
      `  or`,
      `    Skipped: <reason>`,
      `  or`,
      `    Failed: <reason>`,
    ].join('\n');
  }

  // ── Trigger fire (broadcasts to renderer to actually run) ─────────

  function broadcast(channel, payload) {
    try {
      const win = ctx.getWindow?.();
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    } catch {}
  }

  async function fireMission(mission, opts = {}) {
    if (!mission.enabled && !opts.force) return { ok: false, reason: 'disabled' };
    if (inFlight.has(mission.id)) return { ok: false, reason: 'already-running' };
    if (!opts.force && mission.cooldownMs && Date.now() - (mission.lastRunAt || 0) < mission.cooldownMs) {
      return { ok: false, reason: 'cooldown' };
    }

    let pat = null;
    if (mission.target?.kind === 'cloud') {
      try { pat = typeof getSecret === 'function' ? await getSecret('githubPat') : null; } catch {}
      if (!pat) {
        const summary = 'GitHub PAT not configured. Set it in Settings → Connections.';
        await patchStats(mission, { lastRunAt: Date.now(), lastRunStatus: 'error', lastRunMessage: summary, runCount: (mission.runCount || 0) + 1 });
        await appendLog(mission, 'error', summary);
        broadcast('missions:status', { id: mission.id, state: 'idle', status: 'error', summary });
        return { ok: false, reason: 'no-pat' };
      }
    }

    // Cloud missions only need `git` on the machine. The Copilot HTTP
    // MCP covers everything `gh` would be used for (PRs, issues,
    // search, comments) as typed tools the agent can call directly.
    let ghInfo = { git: { installed: false }, gitInstalled: false, hasToken: !!pat };
    if (typeof ghEnsure === 'function' && mission.target?.kind === 'cloud') {
      try { ghInfo = { ...ghInfo, ...(await ghEnsure(mission)) }; } catch (err) { console.warn('[missions] ghEnsure failed:', err.message); }
    }

    if (mission.target?.kind === 'cloud') {
      if (!ghInfo.gitInstalled) {
        const summary = 'Cloud missions require git on this machine. Install from https://git-scm.com/downloads and restart PiPilot.';
        await patchStats(mission, { lastRunAt: Date.now(), lastRunStatus: 'error', lastRunMessage: summary, runCount: (mission.runCount || 0) + 1 });
        await appendLog(mission, 'error', summary);
        broadcast('missions:status', { id: mission.id, state: 'idle', status: 'error', summary });
        broadcast('missions:install-required', {
          missionId: mission.id,
          missing: ['git'],
          links: { git: 'https://git-scm.com/downloads' },
        });
        return { ok: false, reason: 'missing-git' };
      }

      // Clone the repo into a fresh OS-temp scratch dir so the agent
      // has a real working tree to edit. Each run gets its own dir so
      // a crashed/abandoned previous attempt can't contaminate the new
      // one. Auth: PAT is inlined into the HTTPS clone URL — scoped
      // strictly to this clone's `origin` remote, never the user's
      // global config. `git push` later reuses the same remote URL.
      const scratchDir = path.join(os.tmpdir(), 'pipilot-missions', mission.id, String(Date.now()));
      try {
        await fsp.mkdir(scratchDir, { recursive: true });
        const repo = mission.target.repo;
        const branch = mission.target.branch || 'main';
        const url = ghInfo.cloneUrl || `https://github.com/${repo}.git`;
        const cloneRes = await execAsync('git', ['clone', '--branch', branch, '--depth', '50', url, scratchDir]);
        if (!cloneRes.ok) {
          // Sanitise the error so we never leak the PAT in the log.
          const safeStderr = (cloneRes.stderr || cloneRes.error || 'unknown').replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
          const summary = 'Clone failed: ' + safeStderr.slice(0, 400);
          await patchStats(mission, { lastRunAt: Date.now(), lastRunStatus: 'error', lastRunMessage: summary, runCount: (mission.runCount || 0) + 1 });
          await appendLog(mission, 'error', summary);
          broadcast('missions:status', { id: mission.id, state: 'idle', status: 'error', summary });
          return { ok: false, reason: 'clone-failed', error: summary };
        }
        // Committer identity for this clone only — `--local` writes to
        // <scratch>/.git/config, never touches the user's ~/.gitconfig.
        await execAsync('git', ['-C', scratchDir, 'config', '--local', 'user.name', 'PiPilot Mission']);
        await execAsync('git', ['-C', scratchDir, 'config', '--local', 'user.email', 'mission@pipilot.local']);
        ghInfo.scratchDir = scratchDir;
      } catch (err) {
        const summary = 'Failed to prepare scratch clone: ' + (err?.message || err);
        await patchStats(mission, { lastRunAt: Date.now(), lastRunStatus: 'error', lastRunMessage: summary, runCount: (mission.runCount || 0) + 1 });
        await appendLog(mission, 'error', summary);
        broadcast('missions:status', { id: mission.id, state: 'idle', status: 'error', summary });
        return { ok: false, reason: 'clone-prep-failed', error: summary };
      }
    }

    inFlight.set(mission.id, { startedAt: Date.now(), scratchDir: ghInfo.scratchDir || null });
    broadcast('missions:status', { id: mission.id, state: 'running', startedAt: Date.now() });
    broadcast('missions:run-now', {
      mission,
      systemPrompt: buildSystemPrompt(mission, ghInfo),
      allowedTools: buildAllowedTools(mission),
      githubPat: pat,                 // for the HTTP MCP Bearer header
      effort: mission.effort || 'medium',
      cloudPr: mission.cloudPr !== false,
      // Cloud missions: cwd of the spawned agent is the cloned scratch
      // dir; the clone's `origin` remote already has the PAT inlined,
      // so `git push` works without env-var injection.
      cwdOverride: ghInfo.scratchDir || null,
      ghInfo: { gitInstalled: ghInfo.gitInstalled, scratchDir: ghInfo.scratchDir || null },
    });
    return { ok: true };
  }

  // ── Trigger engine ────────────────────────────────────────────────

  function shouldRunOnTick(mission, now) {
    if (!mission.enabled) return false;
    if (inFlight.has(mission.id)) return false;
    const t = mission.trigger || {};
    const last = mission.lastRunAt || 0;
    switch (t.kind) {
      case 'once': {
        if (last) return false;
        return typeof t.at === 'number' && now >= t.at;
      }
      case 'interval': {
        if (!t.everyMs || t.everyMs < 60_000) return false;
        return now - last >= t.everyMs;
      }
      case 'cron': {
        // Minimal cron-ish: time-of-day on selected weekdays.
        // spec: { hour, minute, weekdays: [0..6] | null }
        const c = t.spec || {};
        const d = new Date(now);
        const wdOk = !Array.isArray(c.weekdays) || c.weekdays.includes(d.getDay());
        if (!wdOk) return false;
        if (typeof c.hour !== 'number' || typeof c.minute !== 'number') return false;
        if (d.getHours() !== c.hour || d.getMinutes() !== c.minute) return false;
        if (last && now - last < 60_000) return false;
        return true;
      }
      default:
        return false;
    }
  }

  let tickHandle = null;
  async function tickAll() {
    const now = Date.now();
    let candidates = [];
    try {
      candidates = await readAll(null);
      const win = ctx.getWindow?.();
      const renderProjectPath = win && !win.isDestroyed() ? win.__lastProjectPath : null;
      if (renderProjectPath) {
        const proj = await readAll(renderProjectPath);
        const ids = new Set(candidates.map(m => m.id));
        for (const m of proj) if (!ids.has(m.id)) candidates.push(m);
      }
    } catch {}
    for (const m of candidates) {
      if (shouldRunOnTick(m, now)) {
        try { await fireMission(m); } catch (err) { console.warn('[missions] tick run failed', m.id, err.message); }
      }
    }
  }

  function startTicker() {
    if (tickHandle) return;
    tickHandle = setInterval(tickAll, TICK_INTERVAL_MS);
    setTimeout(tickAll, 5_000);
  }

  // ── IPC ───────────────────────────────────────────────────────────

  ipcMain.handle('missions:list', async (_e, { projectPath } = {}) => {
    try {
      const win = ctx.getWindow?.();
      if (win) win.__lastProjectPath = projectPath || win.__lastProjectPath || null;
      const list = await readAll(projectPath);
      const enriched = list.map(m => ({ ...m, isRunning: inFlight.has(m.id) }));
      return { ok: true, missions: enriched };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('missions:save', async (_e, { scope, projectPath, mission } = {}) => {
    try {
      const m = await upsert(scope || 'global', projectPath, mission);
      broadcast('missions:changed', { id: m.id });
      return { ok: true, mission: m };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('missions:delete', async (_e, { scope, projectPath, id } = {}) => {
    try {
      const r = await remove(scope || 'global', projectPath, id);
      broadcast('missions:changed', { id, removed: true });
      return r;
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Renderer → main: "please run this mission". Used by manual "Run now"
  // and on-idle / on-commit triggers fired from the renderer side.
  ipcMain.handle('missions:run', async (_e, { id, projectPath, force } = {}) => {
    try {
      const list = await readAll(projectPath);
      const m = list.find((x) => x.id === id);
      if (!m) return { ok: false, error: 'mission not found' };
      const r = await fireMission(m, { force: !!force });
      return r.ok ? { ok: true } : { ok: false, error: r.reason };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Renderer → main: agent finished. Persist stats + append log.
  ipcMain.handle('missions:report-run', async (_e, { id, projectPath, status, summary, durationMs, toolCallCount, finalText } = {}) => {
    try {
      const list = await readAll(projectPath);
      const m = list.find((x) => x.id === id);
      if (!m) return { ok: false, error: 'mission not found' };
      inFlight.delete(id);
      await patchStats(m, {
        lastRunAt: Date.now(),
        lastRunStatus: status || 'success',
        lastRunMessage: (summary || '').slice(0, 280),
        runCount: (m.runCount || 0) + 1,
      });
      await appendLog(m, status || 'success', [
        `tool calls: ${toolCallCount ?? '?'}`,
        `duration: ${typeof durationMs === 'number' ? (durationMs / 1000).toFixed(1) + 's' : '?'}`,
        '',
        finalText || summary || '(no output)',
      ].join('\n'));
      broadcast('missions:status', { id, state: 'idle', status: status || 'success', summary, durationMs });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('missions:read-log', async (_e, { projectPath } = {}) => {
    try {
      const out = [];
      const candidates = [
        path.join(ctx.userDataPath, LOG_FILE),
        projectPath ? path.join(projectPath, '.pipilot', LOG_FILE) : null,
      ].filter(Boolean);
      for (const f of candidates) {
        try {
          const raw = await fsp.readFile(f, 'utf8');
          out.push({ file: f, content: raw });
        } catch {}
      }
      return { ok: true, files: out };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  startTicker();

  return {};
};
