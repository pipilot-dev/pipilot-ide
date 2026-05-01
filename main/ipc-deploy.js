// PiPilot IDE — Cloud deploy executor.
//
// Spawn-based on purpose: we drive the official provider CLIs (vercel,
// netlify) via `npx -y` so we get framework auto-detection, env-var
// handling, and build pipelines for free across React / Next / Vue /
// Astro / SvelteKit / vanilla / etc. The trade-off is a one-time
// ~20-30s npm download per CLI on the user's first deploy — we surface
// that explicitly in the streamed log so it doesn't feel hung.
//
// Tokens come from the existing cloud-tokens.json store (cloud:save-token)
// so the existing connector UI doubles as the credential entry point.
//
// Per-provider history (deploy events) lives in <userData>/deploy-history.json
// keyed by provider id.

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

let safeStorage = null;
try { ({ safeStorage } = require('electron')); } catch {}

const HISTORY_LIMIT = 30;

// Common build-output directories for static-site providers
// (Cloudflare Pages). Auto-detect in order; first one that exists wins.
const COMMON_DIST_DIRS = ['dist', 'build', 'out', '_site', '.output/public', 'public'];

async function detectDistDir(projectPath) {
  for (const d of COMMON_DIST_DIRS) {
    try {
      const stat = await fsp.stat(path.join(projectPath, d));
      if (stat.isDirectory()) return d;
    } catch {}
  }
  return 'dist';
}

// Provider configs. Each describes how to invoke the CLI, where to
// inject the auth token, and how to extract the final URL from output.
// `extraConfig` lists per-project options the deploy dialog should
// collect (e.g. Cloudflare Pages needs a project name + dist dir).
const PROVIDERS = {
  vercel: {
    name: 'Vercel',
    cliArgs: ({ projectPath, token, target }) => [
      '-y', 'vercel@latest', 'deploy',
      '--token', token,
      '--yes',
      '--cwd', projectPath,
      ...(target === 'production' ? ['--prod'] : []),
    ],
    parseUrl: (output) => {
      const matches = output.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi);
      return matches ? matches[matches.length - 1] : null;
    },
    parseMetadata: (output) => {
      // The deployment URL's leftmost subdomain is a hash that uniquely
      // identifies the deployment — same id Vercel's promote API accepts.
      const url = (output.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi) || []).pop();
      const deploymentId = url ? url.match(/^https:\/\/([a-z0-9-]+)\./)?.[1] : null;
      return { deploymentId };
    },
    estimatedFirstRunSeconds: 30,
  },
  netlify: {
    name: 'Netlify',
    cliArgs: ({ projectPath, token, target }) => [
      '-y', 'netlify-cli@latest', 'deploy',
      '--auth', token,
      '--dir', '.',
      ...(target === 'production' ? ['--prod'] : []),
      '--message', 'Deployed from PiPilot',
    ],
    parseUrl: (output) => {
      const m = output.match(/https:\/\/[a-z0-9-]+(--[a-z0-9-]+)?\.netlify\.app/gi);
      return m ? m[m.length - 1] : null;
    },
    parseMetadata: (output) => {
      // Netlify CLI output:
      //   Logs:              https://app.netlify.com/sites/<site>/deploys/<deploy_id>
      //   Unique Deploy URL: https://<deploy_id>--<site>.netlify.app
      //   Website URL:       https://<site>.netlify.app
      // We pull both the site slug and the deploy id from the logs URL,
      // which is the most reliable source.
      const logsMatch = output.match(/https:\/\/app\.netlify\.com\/sites\/([a-z0-9-]+)\/deploys\/([a-f0-9]+)/i);
      if (logsMatch) return { siteSlug: logsMatch[1], deployId: logsMatch[2] };
      // Fallback: derive from the unique deploy URL.
      const uniq = output.match(/https:\/\/([a-f0-9]+)--([a-z0-9-]+)\.netlify\.app/i);
      if (uniq) return { siteSlug: uniq[2], deployId: uniq[1] };
      return {};
    },
    estimatedFirstRunSeconds: 45,
  },
  cloudflare: {
    name: 'Cloudflare Pages',
    // wrangler reads the API token from the env, not a CLI flag.
    // --project-name auto-creates the project on first deploy if it
    // doesn't exist yet. The positional arg is the build-output dir.
    cliArgs: ({ token, target, config }) => [
      '-y', 'wrangler@latest', 'pages', 'deploy',
      config.distDir || 'dist',
      '--project-name', config.projectName,
      ...(target === 'production' ? ['--branch', 'main'] : []),
    ],
    env: ({ token, config }) => ({
      CLOUDFLARE_API_TOKEN: token,
      ...(config.accountId ? { CLOUDFLARE_ACCOUNT_ID: config.accountId } : {}),
    }),
    parseUrl: (output) => {
      const m = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/gi);
      return m ? m[m.length - 1] : null;
    },
    parseMetadata: (output, { config } = {}) => {
      // Wrangler prints either a numeric/alpha deployment id or just
      // "Deployment ID: <uuid>". The deploy URL's subdomain hash also
      // uniquely identifies it for the rollback API call.
      const url = (output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/gi) || []).pop();
      const subdomain = url ? url.match(/^https:\/\/([a-z0-9-]+)\./)?.[1] : null;
      const explicit = output.match(/Deployment\s+(?:ID|UUID):\s*([a-f0-9-]{8,})/i)?.[1];
      return {
        deploymentId: explicit || subdomain || null,
        projectName: config?.projectName || null,
      };
    },
    estimatedFirstRunSeconds: 40,
    extraConfig: [
      { key: 'projectName', label: 'Project name', placeholder: 'my-site (lowercase, dashes)', required: true },
      { key: 'distDir',     label: 'Build output dir', placeholder: 'auto-detected', autoDetect: detectDistDir },
      { key: 'accountId',   label: 'Account ID (optional)', placeholder: 'leave blank if you have only one account' },
    ],
  },
  railway: {
    name: 'Railway',
    // railway up reads the project link from .railway/config.json in
    // the project directory. RAILWAY_TOKEN env auths the request.
    // --detach exits as soon as the upload completes (we don't need
    // to follow build logs in this terminal).
    cliArgs: ({ projectPath, target }) => [
      '-y', '@railway/cli@latest', 'up',
      '--detach',
      ...(target === 'production' ? ['--environment', 'production'] : []),
    ],
    env: ({ token }) => ({ RAILWAY_TOKEN: token }),
    parseUrl: (output) => {
      // Railway prints "Build Logs: https://railway.app/project/<id>/service/<id>"
      // and sometimes a deployment URL. Pull the deployment URL if
      // present, otherwise the build-logs URL.
      const deploy = output.match(/https:\/\/[a-z0-9-]+\.up\.railway\.app/gi);
      if (deploy) return deploy[deploy.length - 1];
      const build = output.match(/https:\/\/railway\.app\/project\/[a-z0-9-]+/gi);
      return build ? build[build.length - 1] : null;
    },
    estimatedFirstRunSeconds: 60,
    preflight: async ({ projectPath }) => {
      try {
        await fsp.access(path.join(projectPath, '.railway', 'config.json'));
      } catch {
        return 'Railway needs `railway link` to be run in this project first. Open a terminal in the project root and run: npx @railway/cli@latest link';
      }
      return null;
    },
  },
};

function decryptToken(rec) {
  if (!rec || !rec.token) return null;
  if (rec.token.enc === 'safeStorage' && safeStorage?.isEncryptionAvailable?.()) {
    try { return safeStorage.decryptString(Buffer.from(rec.token.value, 'base64')); } catch { return null; }
  }
  if (rec.token.enc === 'base64') {
    try { return Buffer.from(rec.token.value, 'base64').toString('utf8'); } catch { return null; }
  }
  return null;
}

function emit(ctx, runId, type, payload) {
  try {
    const win = ctx.getWindow?.();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('deploy:event', { runId, type, ...(payload || {}) });
  } catch {}
}

module.exports = function register(ipcMain, ctx) {
  const tokensFile = path.join(ctx.userDataPath, 'cloud-tokens.json');
  const historyFile = path.join(ctx.userDataPath, 'deploy-history.json');

  function ok(d) { return { ok: true, ...(d || {}) }; }
  function fail(e) { return { ok: false, error: e?.message || String(e) }; }

  async function readJsonSafe(file, fallback) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
  }
  async function writeJson(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }

  async function tokenFor(provider) {
    const all = await readJsonSafe(tokensFile, {});
    return decryptToken(all[provider]);
  }

  async function appendHistory(entry) {
    const all = await readJsonSafe(historyFile, {});
    const list = all[entry.provider] || [];
    list.unshift(entry);
    all[entry.provider] = list.slice(0, HISTORY_LIMIT);
    await writeJson(historyFile, all);
  }

  // Per-provider, per-project config (Cloudflare's project-name etc).
  // Stored in <userData>/deploy-config.json keyed by `<provider>:<projectPath>`.
  const configFile = path.join(ctx.userDataPath, 'deploy-config.json');

  async function readConfig(provider, projectPath) {
    const all = await readJsonSafe(configFile, {});
    return all[`${provider}:${projectPath}`] || {};
  }
  async function writeConfig(provider, projectPath, value) {
    const all = await readJsonSafe(configFile, {});
    all[`${provider}:${projectPath}`] = value;
    await writeJson(configFile, all);
  }

  // Auto-detect which cloud provider this project is configured for by
  // scanning for marker files. Returns provider IDs ranked by confidence
  // (clearest signal first). The deploy tab shows a "Detected: X" banner
  // and recommends the matching card.
  const DETECTORS = [
    { provider: 'vercel',     files: ['vercel.json'],                                       confidence: 0.95 },
    { provider: 'netlify',    files: ['netlify.toml', 'netlify.json'],                      confidence: 0.95 },
    { provider: 'render',     files: ['render.yaml'],                                       confidence: 0.95 },
    { provider: 'railway',    files: ['railway.json', 'railway.toml', '.railway/config.json'], confidence: 0.95 },
    { provider: 'cloudflare', files: ['wrangler.toml', 'wrangler.jsonc'],                   confidence: 0.85, note: 'wrangler — Pages or Workers depending on config' },
    // Heuristic fallbacks (lower confidence — provider isn't pinned by
    // a config file but the framework strongly suggests one).
    { provider: 'vercel',     files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], confidence: 0.55, note: 'Next.js — Vercel is the natural home' },
    { provider: 'netlify',    files: ['_redirects', '_headers'],                            confidence: 0.5  },
  ];

  ipcMain.handle('deploy:detect-provider', async (_e, { projectPath } = {}) => {
    try {
      if (!projectPath) return ok({ detected: [] });
      const detected = [];
      const seen = new Map();          // provider → highest confidence seen
      for (const d of DETECTORS) {
        for (const f of d.files) {
          try {
            await fsp.access(path.join(projectPath, f));
            const prev = seen.get(d.provider) || 0;
            if (d.confidence > prev) {
              seen.set(d.provider, d.confidence);
              const idx = detected.findIndex(x => x.provider === d.provider);
              if (idx >= 0) detected[idx] = { provider: d.provider, marker: f, confidence: d.confidence, note: d.note };
              else detected.push({ provider: d.provider, marker: f, confidence: d.confidence, note: d.note });
            }
            break;       // one marker per detector entry is enough
          } catch {}
        }
      }
      detected.sort((a, b) => b.confidence - a.confidence);
      return ok({ detected });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('deploy:list-providers', async () => {
    return ok({
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({
        id, name: p.name,
        extraConfig: (p.extraConfig || []).map(c => ({ key: c.key, label: c.label, placeholder: c.placeholder, required: !!c.required })),
      })),
    });
  });

  ipcMain.handle('deploy:get-config', async (_e, { provider, projectPath } = {}) => {
    try {
      if (!provider || !projectPath) throw new Error('provider + projectPath required');
      const cfg = PROVIDERS[provider];
      if (!cfg) throw new Error(`unsupported provider: ${provider}`);
      const saved = await readConfig(provider, projectPath);
      // Run any auto-detect hooks (e.g. dist dir scan) for missing keys.
      const merged = { ...saved };
      for (const c of cfg.extraConfig || []) {
        if (!merged[c.key] && typeof c.autoDetect === 'function') {
          try { merged[c.key] = await c.autoDetect(projectPath); } catch {}
        }
      }
      return ok({ config: merged });
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('deploy:save-config', async (_e, { provider, projectPath, config } = {}) => {
    try {
      if (!provider || !projectPath) throw new Error('provider + projectPath required');
      await writeConfig(provider, projectPath, config || {});
      return ok({});
    } catch (err) { return fail(err); }
  });

  ipcMain.handle('deploy:history', async (_e, { provider } = {}) => {
    const all = await readJsonSafe(historyFile, {});
    if (provider) return ok({ history: all[provider] || [] });
    return ok({ history: all });
  });

  // Promote a previous Vercel preview deployment to production.
  // Vercel's CLI exposes this as `vercel promote <url>` — no equivalent
  // for Netlify (needs site_id + deploy_id, captured from API not CLI),
  // Cloudflare Pages (needs account_id + project_name + deployment_id),
  // or Railway (different model: redeploy from snapshot). Those land in
  // a follow-up once we capture the necessary IDs at deploy time.
  ipcMain.handle('deploy:promote', async (_e, payload = {}) => {
    const runId = `promote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { provider, projectPath, url } = payload;
      if (provider !== 'vercel') {
        throw new Error(`Promote is only supported for Vercel today. Netlify, Cloudflare Pages, and Railway promotion is on the roadmap (each needs deployment-id capture at deploy time).`);
      }
      if (!url) throw new Error('deployment url required');
      if (!projectPath) throw new Error('projectPath required');
      const token = await tokenFor(provider);
      if (!token) throw new Error(`No token saved for Vercel.`);

      const args = ['-y', 'vercel@latest', 'promote', url, '--token', token, '--yes'];
      emit(ctx, runId, 'log', { line: `$ npx ${args.map(a => a === token ? '***' : a).join(' ')}` });

      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const child = spawn(npxBin, args, {
        cwd: projectPath,
        env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
        windowsHide: true,
        shell: process.platform === 'win32',
      });

      let outputBuf = '';
      const onChunk = (chunk, stream) => {
        const text = chunk.toString();
        outputBuf += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim().length) emit(ctx, runId, 'log', { line, stream });
        }
      };
      child.stdout.on('data', (c) => onChunk(c, 'stdout'));
      child.stderr.on('data', (c) => onChunk(c, 'stderr'));

      const startedAt = Date.now();

      return await new Promise((resolve) => {
        child.on('error', async (err) => {
          emit(ctx, runId, 'error', { message: String(err?.message || err) });
          resolve(fail(err));
        });
        child.on('exit', async (code) => {
          if (code === 0) {
            emit(ctx, runId, 'done', { url, code });
            await appendHistory({
              id: runId, provider, projectPath, target: 'production',
              status: 'success', startedAt, finishedAt: Date.now(),
              url, promotedFrom: url,
            });
            resolve(ok({ runId, url }));
          } else {
            emit(ctx, runId, 'error', { message: `vercel promote exited with code ${code}` });
            resolve(fail(new Error(`exit ${code}`)));
          }
        });
      });
    } catch (err) {
      emit(ctx, runId, 'error', { message: err?.message || String(err) });
      return fail(err);
    }
  });

  ipcMain.handle('deploy:run', async (_e, payload = {}) => {
    const runId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { provider, projectPath, target, config: rawConfig } = payload;
      const cfg = PROVIDERS[provider];
      if (!cfg) throw new Error(`unsupported provider: ${provider}`);
      if (!projectPath) throw new Error('projectPath required');

      const token = await tokenFor(provider);
      if (!token) throw new Error(`No token saved for ${cfg.name}. Connect it from the Deploy Hub or Extensions sidebar first.`);

      // Merge per-project saved config with whatever the dialog passed,
      // then validate any required extraConfig fields.
      const savedConfig = await readConfig(provider, projectPath);
      const config = { ...savedConfig, ...(rawConfig || {}) };
      for (const c of cfg.extraConfig || []) {
        if (c.required && !config[c.key]) {
          throw new Error(`${cfg.name} requires "${c.label}" — add it in the deploy dialog.`);
        }
      }
      // Persist whatever the user passed so next deploy doesn't ask again.
      if (rawConfig && Object.keys(rawConfig).length) {
        await writeConfig(provider, projectPath, config);
      }

      // Provider-specific preflight (e.g. Railway needs `railway link`).
      if (typeof cfg.preflight === 'function') {
        const err = await cfg.preflight({ projectPath, config });
        if (err) throw new Error(err);
      }

      const args = cfg.cliArgs({ projectPath, token, target, config });
      const masked = args.map(a => a === token ? '***' : a);
      emit(ctx, runId, 'log', { line: `$ npx ${masked.join(' ')}` });
      emit(ctx, runId, 'log', { line: `[pipilot] First run downloads the ${cfg.name} CLI (~${cfg.estimatedFirstRunSeconds}s). Subsequent runs are instant.` });

      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const extraEnv = typeof cfg.env === 'function' ? cfg.env({ token, config }) : {};
      const child = spawn(npxBin, args, {
        cwd: projectPath,
        env: { ...process.env, ...extraEnv, FORCE_COLOR: '0', CI: '1' },
        windowsHide: true,
        shell: process.platform === 'win32',
      });

      let outputBuf = '';
      const onChunk = (chunk, stream) => {
        const text = chunk.toString();
        outputBuf += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim().length) emit(ctx, runId, 'log', { line, stream });
        }
      };
      child.stdout.on('data', (c) => onChunk(c, 'stdout'));
      child.stderr.on('data', (c) => onChunk(c, 'stderr'));

      const startedAt = Date.now();

      return await new Promise((resolve) => {
        child.on('error', async (err) => {
          emit(ctx, runId, 'error', { message: String(err?.message || err) });
          await appendHistory({
            id: runId, provider, projectPath, target: target || 'preview',
            status: 'error', startedAt, finishedAt: Date.now(),
            url: null, error: String(err?.message || err),
            config,  // remember config so "Re-run" works without re-prompting
          });
          resolve(fail(err));
        });
        child.on('exit', async (code, signal) => {
          const finishedAt = Date.now();
          if (code === 0) {
            const url = cfg.parseUrl(outputBuf);
            const metadata = typeof cfg.parseMetadata === 'function'
              ? cfg.parseMetadata(outputBuf, { config }) : {};
            emit(ctx, runId, 'done', { url, code, metadata });
            await appendHistory({
              id: runId, provider, projectPath, target: target || 'preview',
              status: 'success', startedAt, finishedAt, url,
              metadata, config,
            });
            resolve(ok({ runId, url, metadata }));
          } else {
            emit(ctx, runId, 'error', { message: `CLI exited with code ${code}${signal ? ' (signal ' + signal + ')' : ''}` });
            await appendHistory({
              id: runId, provider, projectPath, target: target || 'preview',
              status: 'error', startedAt, finishedAt,
              url: null, error: `exit ${code}`, config,
            });
            resolve(fail(new Error(`exit ${code}`)));
          }
        });
      });
    } catch (err) {
      emit(ctx, runId, 'error', { message: err?.message || String(err) });
      return fail(err);
    }
  });
};
