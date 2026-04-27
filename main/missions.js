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
const { runMissionAgent } = require('./mission-agent');

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
  const runsDir = path.join(ctx.userDataPath, 'missions-runs');
  try { fs.mkdirSync(runsDir, { recursive: true }); } catch {}

  // Per-mission run state. Now driven from main, so this map outlives
  // any renderer reload — a new renderer can call missions:get-state
  // and replay the full buffer of events.
  // id -> { mission, startedAt, agent, events, status, finalText, toolCallCount, _persistQueue, _persistTimer, _persistFile }
  const inFlight = new Map();

  // ── Disk persistence ──────────────────────────────────────────
  // Each run gets one JSONL file at:
  //   <userData>/missions-runs/<missionId>/<startedAt>.jsonl
  // First line is a meta record with the mission snapshot; every
  // event from the agent stream is appended as one record; a final
  // "end" record is written when the run finalizes. Reopening any
  // mission tab — minutes, hours, or weeks later — reads the most
  // recent file and replays the full transcript. Survives renderer
  // reloads, app restarts, even crashes (because we flush every
  // 250ms during the run).
  function runFilePath(missionId, startedAt) {
    const safe = String(missionId).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(runsDir, safe, String(startedAt) + '.jsonl');
  }

  function persistInit(runState) {
    const dir = path.join(runsDir, String(runState.mission.id).replace(/[^a-zA-Z0-9._-]/g, '_'));
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const file = path.join(dir, String(runState.startedAt) + '.jsonl');
    runState._persistFile = file;
    runState._persistQueue = [];
    runState._persistTimer = null;
    // Header line — mission snapshot. Captures the prompt + target so
    // reading the file alone is enough to reconstruct what ran.
    runState._persistQueue.push(JSON.stringify({
      kind: 'meta',
      mission: runState.mission,
      startedAt: runState.startedAt,
      schema: 1,
    }));
    persistFlushSoon(runState);
  }

  function persistAppend(runState, evt) {
    if (!runState._persistFile) return;
    runState._persistQueue.push(JSON.stringify({ kind: 'event', ts: evt.ts || Date.now(), evt }));
    persistFlushSoon(runState);
  }

  function persistFinalize(runState, finalRecord) {
    if (!runState._persistFile) return;
    runState._persistQueue.push(JSON.stringify({ kind: 'end', ...finalRecord, endedAt: Date.now() }));
    persistFlushNow(runState);
  }

  function persistFlushSoon(runState) {
    if (runState._persistTimer) return;
    runState._persistTimer = setTimeout(() => {
      runState._persistTimer = null;
      persistFlushNow(runState);
    }, 250);
  }

  function persistFlushNow(runState) {
    if (!runState._persistFile) return;
    const lines = runState._persistQueue;
    if (!lines || !lines.length) return;
    runState._persistQueue = [];
    const blob = lines.join('\n') + '\n';
    fs.appendFile(runState._persistFile, blob, 'utf8', (err) => {
      if (err) console.warn('[missions] persist append failed:', err.message);
    });
  }

  // List runs for a mission, newest-first. Returns metadata only.
  async function listRunsOnDisk(missionId) {
    const dir = path.join(runsDir, String(missionId).replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
      const files = await fsp.readdir(dir);
      const runs = files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          file: path.join(dir, f),
          startedAt: parseInt(f.replace('.jsonl', ''), 10) || 0,
        }))
        .filter(r => r.startedAt)
        .sort((a, b) => b.startedAt - a.startedAt);
      return runs;
    } catch {
      return [];
    }
  }

  // Load a single run file from disk. Returns events array + meta + end.
  async function loadRunFromDisk(file) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const events = [];
      let meta = null;
      let end = null;
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj.kind === 'meta') meta = obj;
          else if (obj.kind === 'event') events.push(obj.evt);
          else if (obj.kind === 'end') end = obj;
        } catch {}
      }
      return { ok: true, file, meta, events, end };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

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
      `- **Branding rule for git commits and PR bodies**: NEVER include "🤖 Generated with [Claude Code]", "Co-Authored-By: Claude", or any other "Generated with X" / "Co-Authored-By: X" trailer line you may have learned from external CLI tools. The ONLY co-author trailer you may add — and you MUST add it on every commit you create — is exactly:`,
      ``,
      `    Co-Authored-By: PiPilot Mission <mission@pipilot.local>`,
      ``,
      `  Format: blank line before the trailer, then the trailer alone on its own line, no leading spaces, exact spelling and casing as above. Do not add any other "Generated by", emoji, signature, or attribution line. The user owns the commit; the trailer is just a transparency marker that this mission agent did the work.`,
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
          // Pull the LAST non-empty line from stderr — git's last
          // output line is usually the actual error (e.g. "fatal:
          // Remote branch X not found"), while earlier lines are
          // progress noise like "Cloning into '...'".
          const sanitised = (cloneRes.stderr || cloneRes.error || 'unknown')
            .replace(/x-access-token:[^@]+@/g, 'x-access-token:***@')
            .replace(/https:\/\/[^@]+@/g, 'https://***@');
          const lines = sanitised.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const lastError = lines.reverse().find(l => /^(fatal|error|remote):/i.test(l)) || lines[0] || sanitised;
          const summary = 'Clone failed: ' + lastError.slice(0, 800);
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

    const startedAt = Date.now();
    const workDir = mission.target?.kind === 'local'
      ? mission.target.projectPath
      : (ghInfo.scratchDir || null);
    const allowedTools = buildAllowedTools(mission);
    const systemPrompt = buildSystemPrompt(mission, ghInfo);

    // Build per-call MCP servers — github HTTP MCP for cloud missions.
    let extraMcpServers = null;
    if (mission.target?.kind === 'cloud' && pat) {
      extraMcpServers = {
        github: {
          type: 'http',
          url: 'https://api.githubcopilot.com/mcp',
          headers: { Authorization: 'Bearer ' + pat },
        },
      };
    }

    // Per-run state — owned by main, survives renderer reloads.
    // Each "turn" is one user message + one agent run. The mission
    // tab can queue messages while a turn is in flight; they drain
    // sequentially when the current turn ends. Conversation history
    // is injected into each follow-up turn's prompt so the agent
    // maintains context across the whole mission lifetime.
    const runState = {
      mission,
      startedAt,
      workDir,
      events: [],
      status: 'running',
      finalText: '',
      toolCallCount: 0,
      agent: null,
      stopRequested: false,
      // Multi-turn extensions:
      conversation: [],        // [{ role: 'user'|'assistant', content, ts, turnIndex }]
      currentTurnIndex: 0,
      currentTurnFinalText: '',
      currentTurnToolCount: 0,
      currentTurnEventStart: 0,
      pendingMessages: [],     // user messages typed while a turn is running
      systemPrompt: null,      // remembered for follow-up turns
      allowedTools: null,
      extraMcpServers: null,
      cloudPr: false,
      githubPat: null,         // remembered (for re-clone on cloud follow-ups)
    };
    inFlight.set(mission.id, runState);
    persistInit(runState);

    // Remember everything a follow-up turn will need.
    runState.systemPrompt = systemPrompt;
    runState.allowedTools = allowedTools;
    runState.extraMcpServers = extraMcpServers;
    runState.cloudPr = mission.cloudPr !== false;
    runState.githubPat = pat;

    broadcast('missions:status', { id: mission.id, state: 'running', startedAt });
    broadcast('missions:start', { mission, startedAt });
    try {
      const win = ctx.getWindow?.();
      if (win && !win.isDestroyed()) win.webContents.send('missions:bg-active', { id: mission.id, active: true });
    } catch {}

    // Drive the first turn. If the caller supplied initialUserMessage
    // (i.e. user typed in the mission tab on a never-run mission), use
    // that as the turn-0 user message so it shows up in conversation
    // history instead of the canned "run the mission now" prompt.
    const initialUserMsg = (opts.initialUserMessage && String(opts.initialUserMessage).trim())
      ? String(opts.initialUserMessage).trim()
      : `Run the mission described in your system prompt now. Today's date: ${new Date().toISOString().slice(0,10)}.`;
    return startTurn(runState, initialUserMsg);
  }

  // Run a single conversational turn for an existing runState. Used
  // both for the initial mission run AND for follow-up messages a
  // user sends after the first turn finishes (or queues while it's
  // running). Each turn has its own SDK call but inherits the
  // workspace + conversation context.
  function startTurn(runState, userMessage) {
    const turnIndex = runState.currentTurnIndex;
    runState.status = 'running';
    runState.currentTurnFinalText = '';
    runState.currentTurnToolCount = 0;
    runState.currentTurnEventStart = runState.events.length;
    // Record user message in conversation + persist as a turn-start record.
    const userEntry = { role: 'user', content: userMessage, ts: Date.now(), turnIndex };
    runState.conversation.push(userEntry);
    runState._persistQueue?.push(JSON.stringify({ kind: 'turn-start', turnIndex, userMessage, startedAt: Date.now() }));
    persistFlushSoon(runState);

    // Build the prompt — first turn uses the original mission prompt,
    // follow-ups inject the prior turns as context above the new ask.
    const promptText = turnIndex === 0
      ? userMessage
      : buildFollowUpPrompt(runState, userMessage);

    const mission = runState.mission;
    const onEvent = (evt) => {
      if (!evt) return;
      const stamped = { ts: Date.now(), turnIndex, ...evt };
      runState.events.push(stamped);
      if (evt.type === 'tool_call') {
        runState.toolCallCount++;
        runState.currentTurnToolCount++;
      }
      if (evt.type === 'text' && typeof evt.text === 'string') {
        runState.finalText += evt.text;
        runState.currentTurnFinalText += evt.text;
      }
      persistAppend(runState, stamped);
      try {
        const win = ctx.getWindow?.();
        if (win && !win.isDestroyed()) {
          win.webContents.send('missions:event', { missionId: mission.id, evt: stamped });
        }
      } catch {}
    };

    const agentRun = runMissionAgent({
      missionName: mission.name,
      missionId: mission.id,
      prompt: promptText,
      systemPrompt: runState.systemPrompt,
      allowedTools: runState.allowedTools,
      effort: mission.effort || 'medium',
      workDir: runState.workDir,
      extraMcpServers: runState.extraMcpServers,
    }, onEvent);
    runState.agent = agentRun;

    agentRun.promise.then(async (outcome) => {
      try { await finalizeTurn(runState, outcome); }
      catch (err) { console.warn('[missions] finalize-turn failed:', err.message); }
    });

    return { ok: true, turnIndex };
  }

  // Compose the prompt for a follow-up turn: include the conversation
  // so far so the agent has full context, then the latest user ask.
  function buildFollowUpPrompt(runState, userMessage) {
    const lines = ['## Conversation so far'];
    for (const msg of runState.conversation.slice(0, -1)) {
      const head = msg.role === 'user' ? '### User' : '### You (assistant)';
      lines.push(head);
      lines.push((msg.content || '').slice(0, 6000));
      lines.push('');
    }
    lines.push('## New user message');
    lines.push(userMessage);
    lines.push('');
    lines.push('Continue the mission. Use the conversation above as context — same workspace, same constraints.');
    return lines.join('\n');
  }

  // Finalize a single TURN — record assistant reply in the
  // conversation, write a turn-end record, and either drain the
  // queued message (start the next turn) or transition the mission
  // to idle/ready.
  async function finalizeTurn(runState, outcome) {
    const mission = runState.mission;
    const turnIndex = runState.currentTurnIndex;
    const finalEvent = runState.events.slice(runState.currentTurnEventStart).find(e => e.type === 'result') || (outcome && outcome.result) || null;
    const cleanFinal = (runState.currentTurnFinalText || '').replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim();
    const tail = cleanFinal.split('\n').slice(-5).join(' ');
    let status = 'success';
    let summary = tail.slice(0, 280);
    if (runState.stopRequested || finalEvent?.subtype === 'aborted') { status = 'stopped'; summary = 'Stopped by user'; }
    else if (finalEvent?.subtype === 'error' || finalEvent?.is_error) { status = 'error'; summary = summary || 'agent reported failure'; }
    else if (/^skipped:/i.test(tail)) { status = 'skipped'; }
    else if (/^failed:/i.test(tail)) { status = 'error'; }

    // Push assistant turn to the conversation history.
    runState.conversation.push({
      role: 'assistant',
      content: cleanFinal,
      ts: Date.now(),
      turnIndex,
      status,
    });
    // Persist turn-end marker.
    runState._persistQueue?.push(JSON.stringify({
      kind: 'turn-end',
      turnIndex,
      status,
      summary,
      finalText: cleanFinal,
      toolCallCount: runState.currentTurnToolCount,
      endedAt: Date.now(),
    }));
    persistFlushNow(runState);

    runState.stopRequested = false;
    runState.agent = null;

    // If the user typed a message during this turn, drain it as the
    // next turn immediately. Otherwise transition to idle/ready.
    if (runState.pendingMessages.length > 0) {
      const next = runState.pendingMessages.shift();
      runState.currentTurnIndex = turnIndex + 1;
      // Tell open tabs the previous turn closed cleanly so the UI
      // can reset its in-flight indicators between turns.
      broadcast('missions:turn-end', { missionId: mission.id, turnIndex, status, summary });
      startTurn(runState, next);
      return;
    }

    // No queued follow-up — finalize the mission run for stats / UI.
    await finalizeMissionRun(runState, { status, summary, finalEvent, cleanFinal });
  }

  // Mission has gone fully idle (no in-flight turn, no queued
  // messages). Update stats, append log, broadcast end. The runState
  // sticks around in inFlight for a while so follow-up messages can
  // resume the same conversation without a fresh fireMission.
  async function finalizeMissionRun(runState, outcomeShape) {
    const mission = runState.mission;
    // Use the per-turn outcome that finalizeTurn passed in.
    const status = outcomeShape?.status || 'success';
    const summary = outcomeShape?.summary || '';
    const cleanFinal = outcomeShape?.cleanFinal || '';

    const durationMs = Date.now() - runState.startedAt;
    runState.status = status;

    await patchStats(mission, {
      lastRunAt: Date.now(),
      lastRunStatus: status,
      lastRunMessage: (summary || '').slice(0, 800),
      runCount: (mission.runCount || 0) + 1,
    });
    await appendLog(mission, status, [
      `tool calls: ${runState.toolCallCount}`,
      `duration: ${(durationMs / 1000).toFixed(1)}s`,
      '',
      cleanFinal || '(no output)',
    ].join('\n'));

    // BugBot post-process: read the findings JSONL from wherever the
    // agent wrote it (local project root for local missions, scratch
    // clone for cloud missions). Findings live in the buffer here in
    // main, then ride over the broadcast to the renderer's Problems
    // panel — works regardless of target kind.
    let bugbotFindings = null;
    if (Array.isArray(mission.tags) && mission.tags.includes('bugbot') && status !== 'error') {
      const findingsRoot = mission.target?.kind === 'local'
        ? mission.target.projectPath
        : runState.workDir || (mission.target?.kind === 'cloud' && mission.target.scratchDir);
      if (findingsRoot) {
        const findingsPath = path.join(findingsRoot, '.pipilot', 'bug-findings.jsonl');
        try {
          const raw = await fsp.readFile(findingsPath, 'utf8');
          if (raw.trim()) {
            const items = [];
            for (const line of raw.split(/\r?\n/)) {
              const t = line.trim(); if (!t) continue;
              try {
                const obj = JSON.parse(t);
                if (obj && obj.path && obj.message) items.push(obj);
              } catch {}
            }
            if (items.length) bugbotFindings = { items, rootPath: findingsRoot, sourceFile: findingsPath };
          }
        } catch {}
      }
    }

    // Final disk record so a future "open this mission" reads
    // status/duration/etc. even though the in-memory run state is GC'd.
    persistFinalize(runState, { status, summary, durationMs, toolCallCount: runState.toolCallCount, finalText: cleanFinal });

    broadcast('missions:status', { id: mission.id, state: 'idle', status, summary, durationMs });
    broadcast('missions:end', { missionId: mission.id, status, summary, durationMs, finalText: cleanFinal, bugbotFindings });
    try {
      const win = ctx.getWindow?.();
      if (win && !win.isDestroyed()) win.webContents.send('missions:bg-active', { id: mission.id, active: false });
    } catch {}

    // Keep the run state for a while so a tab opened just after
    // completion can still replay events. GC after 10 min.
    setTimeout(() => { inFlight.delete(mission.id); }, 10 * 60_000);
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

  // Renderer → main: stop a running mission. Aborts the SDK iteration
  // in main; the post-run finalize will mark status as "stopped".
  ipcMain.handle('missions:stop', async (_e, { id } = {}) => {
    const rs = inFlight.get(id);
    if (!rs) return { ok: false, error: 'mission not running' };
    rs.stopRequested = true;
    try { rs.agent?.abort?.(); } catch {}
    return { ok: true };
  });

  // Renderer → main: send a follow-up user message to a mission.
  // Three states the mission can be in:
  //   - in-flight running:   queue the message, drains after current turn
  //   - in-flight idle:      kick off a new turn immediately
  //   - GC'd from memory:    reconstruct runState from disk and resume
  ipcMain.handle('missions:send-message', async (_e, { id, message, projectPath } = {}) => {
    if (!id || !message || !String(message).trim()) {
      return { ok: false, error: 'id and non-empty message required' };
    }
    let rs = inFlight.get(id);
    if (!rs) {
      // Try to reconstruct from disk if the runState was GC'd or the
      // app restarted but a prior persisted run exists.
      try { rs = await reconstructRunStateFromDisk(id); } catch {}
      if (rs) {
        inFlight.set(id, rs);
      } else {
        // No prior run on disk (mission was created before persistence
        // shipped, or has genuinely never run). Fall through to a fresh
        // fireMission with the user's message as the initial prompt.
        try {
          const list = await readAll(projectPath || null);
          const m = list.find((x) => x.id === id);
          if (!m) return { ok: false, error: 'mission not found' };
          const r = await fireMission(m, { force: true, initialUserMessage: String(message) });
          if (!r?.ok) return { ok: false, error: r?.reason || r?.error || 'could not start mission' };
          return { ok: true, queued: false, started: true };
        } catch (err) {
          return { ok: false, error: 'could not start: ' + (err?.message || err) };
        }
      }
    }
    // Running → queue. Idle → start a follow-up turn now.
    if (rs.status === 'running') {
      rs.pendingMessages.push(String(message));
      broadcast('missions:queued', { missionId: id, queueLength: rs.pendingMessages.length });
      return { ok: true, queued: true, queueLength: rs.pendingMessages.length };
    }
    rs.currentTurnIndex = (rs.currentTurnIndex || 0) + 1;
    broadcast('missions:status', { id, state: 'running', startedAt: Date.now() });
    broadcast('missions:start', { mission: rs.mission, startedAt: Date.now() });
    try {
      const win = ctx.getWindow?.();
      if (win && !win.isDestroyed()) win.webContents.send('missions:bg-active', { id, active: true });
    } catch {}
    startTurn(rs, String(message));
    return { ok: true, queued: false };
  });

  // Reconstruct a usable runState from the latest .jsonl on disk so a
  // mission whose runState was GC'd can still receive follow-ups
  // without re-running everything from scratch.
  async function reconstructRunStateFromDisk(missionId) {
    const runs = await listRunsOnDisk(missionId);
    if (!runs.length) return null;
    const latest = await loadRunFromDisk(runs[0].file);
    if (!latest?.ok || !latest.meta) return null;
    const mission = latest.meta.mission;
    if (!mission) return null;
    // Rebuild conversation from turn-start/turn-end records by
    // walking the events in disk-order.
    const conversation = [];
    let lastTurnIndex = -1;
    let inTurn = -1;
    let assistantText = '';
    // Re-read raw to access kind discriminator in order.
    const raw = await fsp.readFile(runs[0].file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim(); if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (obj.kind === 'turn-start') {
          conversation.push({ role: 'user', content: obj.userMessage || '', ts: obj.startedAt || Date.now(), turnIndex: obj.turnIndex });
          inTurn = obj.turnIndex;
          assistantText = '';
          lastTurnIndex = Math.max(lastTurnIndex, obj.turnIndex);
        } else if (obj.kind === 'event' && obj.evt?.type === 'text' && typeof obj.evt.text === 'string') {
          assistantText += obj.evt.text;
        } else if (obj.kind === 'turn-end') {
          conversation.push({
            role: 'assistant',
            content: (obj.finalText || assistantText || '').replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim(),
            ts: obj.endedAt || Date.now(),
            turnIndex: obj.turnIndex,
            status: obj.status,
          });
          inTurn = -1;
        }
      } catch {}
    }

    // Make sure the workspace still exists for resumption. For local
    // missions, projectPath is permanent. For cloud missions the
    // scratch clone may have been swept by the OS — re-clone.
    let workDir = null;
    if (mission.target?.kind === 'local') {
      workDir = mission.target.projectPath;
    } else if (mission.target?.kind === 'cloud') {
      // Try the historical scratch dir first.
      const histDir = path.join(os.tmpdir(), 'pipilot-missions', mission.id, String(latest.meta.startedAt));
      try {
        await fsp.access(histDir);
        workDir = histDir;
      } catch {
        // Re-clone fresh.
        let pat = null;
        try { pat = typeof getSecret === 'function' ? await getSecret('githubPat') : null; } catch {}
        if (!pat) throw new Error('GitHub PAT no longer configured — connect in Settings to resume cloud missions');
        const fresh = path.join(os.tmpdir(), 'pipilot-missions', mission.id, String(Date.now()));
        await fsp.mkdir(fresh, { recursive: true });
        const repo = mission.target.repo;
        const branch = mission.target.branch || 'main';
        const url = `https://x-access-token:${encodeURIComponent(pat)}@github.com/${repo}.git`;
        const cloneRes = await execAsync('git', ['clone', '--branch', branch, '--depth', '50', url, fresh]);
        if (!cloneRes.ok) throw new Error('Re-clone failed for resume');
        await execAsync('git', ['-C', fresh, 'config', '--local', 'user.name', 'PiPilot Mission']);
        await execAsync('git', ['-C', fresh, 'config', '--local', 'user.email', 'mission@pipilot.local']);
        workDir = fresh;
      }
    }

    // Build a partial runState that startTurn can drive.
    const rebuilt = {
      mission,
      startedAt: Date.now(),     // a NEW start for the resumed turn
      workDir,
      events: [],                // fresh events for the new turn (history persists on disk anyway)
      status: 'idle',
      finalText: '',
      toolCallCount: 0,
      agent: null,
      stopRequested: false,
      conversation,
      currentTurnIndex: lastTurnIndex,   // next turn = +1
      currentTurnFinalText: '',
      currentTurnToolCount: 0,
      currentTurnEventStart: 0,
      pendingMessages: [],
      // System prompt + permissions — recompute since they depend on
      // current ghInfo state (gh installed? scratch dir present?).
      systemPrompt: buildSystemPrompt(mission, { gitInstalled: true, gitVersion: 'resumed', scratchDir: workDir }),
      allowedTools: buildAllowedTools(mission),
      extraMcpServers: null,
      cloudPr: mission.cloudPr !== false,
      githubPat: null,
      _persistFile: null, _persistQueue: [], _persistTimer: null,
    };
    if (mission.target?.kind === 'cloud') {
      let pat = null;
      try { pat = typeof getSecret === 'function' ? await getSecret('githubPat') : null; } catch {}
      if (pat) {
        rebuilt.githubPat = pat;
        rebuilt.extraMcpServers = {
          github: { type: 'http', url: 'https://api.githubcopilot.com/mcp', headers: { Authorization: 'Bearer ' + pat } },
        };
      }
    }
    // Append to the existing run file rather than starting a new one
    // — keeps the conversation history in one place.
    rebuilt._persistFile = runs[0].file;
    rebuilt._persistQueue = [];
    rebuilt._persistTimer = null;
    return rebuilt;
  }

  // Renderer → main: replay current state for an open tab. Returns
  // the run buffer + status so a tab opened mid-run (or after a
  // renderer reload) can render the full transcript.
  ipcMain.handle('missions:get-state', async (_e, { id } = {}) => {
    const rs = inFlight.get(id);
    if (!rs) return { ok: true, running: false, events: [], status: null, conversation: [], queueLength: 0 };
    return {
      ok: true,
      running: rs.status === 'running',
      status: rs.status,
      startedAt: rs.startedAt,
      events: rs.events.slice(),
      toolCallCount: rs.toolCallCount,
      conversation: rs.conversation || [],
      queueLength: rs.pendingMessages?.length || 0,
      currentTurnIndex: rs.currentTurnIndex || 0,
      workDir: rs.workDir || null,
    };
  });

  // List historic runs for a mission (newest first). Returns
  // [{ file, startedAt }] — caller picks one to load.
  ipcMain.handle('missions:list-runs', async (_e, { id } = {}) => {
    if (!id) return { ok: false, error: 'id required' };
    try {
      const runs = await listRunsOnDisk(id);
      return { ok: true, runs };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Load a specific run file (or the latest if no file specified).
  // Returns { meta, events, end } — full transcript ready for replay.
  ipcMain.handle('missions:load-run', async (_e, { id, file } = {}) => {
    if (!id && !file) return { ok: false, error: 'id or file required' };
    try {
      let target = file;
      if (!target) {
        const runs = await listRunsOnDisk(id);
        target = runs[0]?.file;
        if (!target) return { ok: true, meta: null, events: [], end: null };
      }
      const r = await loadRunFromDisk(target);
      return r;
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // List currently-running missions across the whole app — used by the
  // renderer on cold start / reload to discover anything still in
  // flight that needs UI for.
  ipcMain.handle('missions:in-flight-state', async () => {
    const out = [];
    for (const [id, rs] of inFlight.entries()) {
      out.push({
        id,
        running: rs.status === 'running',
        status: rs.status,
        startedAt: rs.startedAt,
        toolCallCount: rs.toolCallCount,
        eventCount: rs.events.length,
        mission: rs.mission,
      });
    }
    return { ok: true, missions: out };
  });

  // Legacy: kept so an older renderer build doesn't throw if it still
  // calls report-run. Main now owns finalization, so this is a no-op.
  ipcMain.handle('missions:report-run', async () => ({ ok: true, ignored: true }));

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
