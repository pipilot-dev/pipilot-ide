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

// Provider configs. Each describes how to invoke the CLI, where to
// inject the auth token, and how to extract the final URL from output.
const PROVIDERS = {
  vercel: {
    name: 'Vercel',
    // Use --yes to skip interactive prompts; --token for auth; --cwd
    // pins the run to the project. --prod opts into production target.
    cliArgs: ({ projectPath, token, target }) => [
      '-y', 'vercel@latest', 'deploy',
      '--token', token,
      '--yes',
      '--cwd', projectPath,
      ...(target === 'production' ? ['--prod'] : []),
    ],
    // Vercel prints the deployment URL on a line of its own — the last
    // https://...vercel.app match wins.
    parseUrl: (output) => {
      const matches = output.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi);
      return matches ? matches[matches.length - 1] : null;
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
      // Netlify output:
      //   Website URL: https://....netlify.app  (preview)
      //   Website URL: https://yoursite.netlify.app  (prod)
      const m = output.match(/https:\/\/[a-z0-9-]+(--[a-z0-9-]+)?\.netlify\.app/gi);
      return m ? m[m.length - 1] : null;
    },
    estimatedFirstRunSeconds: 45,
    // netlify-cli wants to know the base directory; we pass --dir '.'
    // and rely on the user having a netlify.toml or for CLI to detect
    // the framework.
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

  ipcMain.handle('deploy:list-providers', async () => {
    return ok({ providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name })) });
  });

  ipcMain.handle('deploy:history', async (_e, { provider } = {}) => {
    const all = await readJsonSafe(historyFile, {});
    if (provider) return ok({ history: all[provider] || [] });
    return ok({ history: all });
  });

  ipcMain.handle('deploy:run', async (_e, payload = {}) => {
    const runId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { provider, projectPath, target } = payload;
      const cfg = PROVIDERS[provider];
      if (!cfg) throw new Error(`unsupported provider: ${provider}`);
      if (!projectPath) throw new Error('projectPath required');

      const token = await tokenFor(provider);
      if (!token) throw new Error(`No token saved for ${cfg.name}. Connect it from the Deploy Hub or Extensions sidebar first.`);

      const args = cfg.cliArgs({ projectPath, token, target });
      // Mask the token in the rendered command for the log.
      const masked = args.map(a => a === token ? '***' : a);
      emit(ctx, runId, 'log', { line: `$ npx ${masked.join(' ')}` });
      emit(ctx, runId, 'log', { line: `[pipilot] First run downloads the ${cfg.name} CLI (~${cfg.estimatedFirstRunSeconds}s). Subsequent runs are instant.` });

      // npx is a CMD shim on Windows — must shell-out. On macOS/Linux
      // it's a real binary so spawn directly works.
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
          await appendHistory({
            id: runId, provider, projectPath, target: target || 'preview',
            status: 'error', startedAt, finishedAt: Date.now(),
            url: null, error: String(err?.message || err),
          });
          resolve(fail(err));
        });
        child.on('exit', async (code, signal) => {
          const finishedAt = Date.now();
          if (code === 0) {
            const url = cfg.parseUrl(outputBuf);
            emit(ctx, runId, 'done', { url, code });
            await appendHistory({
              id: runId, provider, projectPath, target: target || 'preview',
              status: 'success', startedAt, finishedAt, url,
            });
            resolve(ok({ runId, url }));
          } else {
            emit(ctx, runId, 'error', { message: `CLI exited with code ${code}${signal ? ' (signal ' + signal + ')' : ''}` });
            await appendHistory({
              id: runId, provider, projectPath, target: target || 'preview',
              status: 'error', startedAt, finishedAt,
              url: null, error: `exit ${code}`,
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
