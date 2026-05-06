// PiPilot IDE — auth lifecycle.
//
// Talks to the pipilot-proxy Cloudflare Worker:
//   POST /auth/device/start   →  start GitHub Device Flow
//   POST /auth/device/poll    →  poll until user authorises
//   GET  /auth/me             →  current user profile
//
// The JWT we get back is the user's "API key" — every Anthropic SDK call
// sends it as `x-api-key`, the Worker validates it and forwards to the
// real upstream. The JWT itself is encrypted with Electron's safeStorage
// (OS keychain on Mac/Win/Linux when available) and persisted to
// <userData>/auth-token.bin so the user only logs in once.
//
// The renderer never sees the raw JWT — it just calls auth:get-status to
// know whether to show the login screen, and the JWT is injected into
// the agent SDK environment by ipc-agent.js.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

let safeStorage = null;
try { ({ safeStorage } = require('electron')); } catch {}

const DEFAULT_PROXY_URL = 'https://pipilot-proxy.hansade2005.workers.dev';

function getProxyUrl() {
  const envUrl = (process.env.PIPILOT_PROXY_URL || '').trim();
  return (envUrl || DEFAULT_PROXY_URL).replace(/\/+$/, '');
}

// In-process cache so we don't hit disk on every agent turn. Repopulated
// from disk on first read; cleared on sign-out.
let cachedJwt = null;
let cachedJwtLoaded = false;

function tokenFile(userDataPath) {
  return path.join(userDataPath, 'auth-token.bin');
}

function encryptForDisk(plain) {
  if (safeStorage?.isEncryptionAvailable?.()) {
    return { enc: 'safeStorage', value: safeStorage.encryptString(plain).toString('base64') };
  }
  // Fallback when keychain isn't available (rare on Linux without libsecret).
  // Better than plaintext, not as safe as a keychain — make it visible.
  return { enc: 'base64', value: Buffer.from(plain, 'utf8').toString('base64') };
}

function decryptFromDisk(rec) {
  if (!rec || !rec.value) return null;
  if (rec.enc === 'safeStorage' && safeStorage?.isEncryptionAvailable?.()) {
    try { return safeStorage.decryptString(Buffer.from(rec.value, 'base64')); }
    catch { return null; }
  }
  if (rec.enc === 'base64') {
    try { return Buffer.from(rec.value, 'base64').toString('utf8'); }
    catch { return null; }
  }
  return null;
}

async function loadJwtFromDisk(userDataPath) {
  try {
    const raw = await fsp.readFile(tokenFile(userDataPath), 'utf8');
    const rec = JSON.parse(raw);
    return decryptFromDisk(rec);
  } catch {
    return null;
  }
}

async function persistJwtToDisk(userDataPath, jwt) {
  const rec = encryptForDisk(jwt);
  await fsp.writeFile(tokenFile(userDataPath), JSON.stringify(rec), 'utf8');
}

async function clearJwtOnDisk(userDataPath) {
  try { await fsp.unlink(tokenFile(userDataPath)); } catch {}
}

// ── Public surface for ipc-agent.js ──────────────────────────────────
//
// ipc-agent calls getJWT() synchronously on every turn; we cache to keep
// it cheap. First call after process start does one disk read.
async function getJWT(userDataPath) {
  if (cachedJwtLoaded) return cachedJwt;
  cachedJwt = await loadJwtFromDisk(userDataPath);
  cachedJwtLoaded = true;
  return cachedJwt;
}

function getJwtSync() {
  return cachedJwtLoaded ? cachedJwt : null;
}

function setJwt(jwt) {
  cachedJwt = jwt || null;
  cachedJwtLoaded = true;
}

// ── IPC handlers ─────────────────────────────────────────────────────

module.exports = function register(ipcMain, ctx) {
  const userDataPath = ctx.userDataPath;

  // Eager load so getJwtSync() works before the renderer asks.
  loadJwtFromDisk(userDataPath).then(jwt => {
    cachedJwt = jwt;
    cachedJwtLoaded = true;
  });

  // Per-flow state lives in main; the renderer only sees the user-facing
  // pieces. We keep just enough to let poll() not require the renderer to
  // re-send the device_code on every tick.
  // referralCode is captured at start() and forwarded on every poll() so
  // the proxy can credit the inviter on the user's first sign-in.
  let activeFlow = null;   // { device_code, user_code, verification_uri, started_at, interval, expires_in, referralCode }

  ipcMain.handle('auth:proxy-url', async () => getProxyUrl());

  ipcMain.handle('auth:start', async (_e, opts = {}) => {
    try {
      const referralCode = String(opts?.referralCode || '').trim() || null;
      const startUrl = referralCode
        ? `${getProxyUrl()}/auth/device/start?r=${encodeURIComponent(referralCode)}`
        : `${getProxyUrl()}/auth/device/start`;
      const res = await fetch(startUrl, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data?.error || `start_failed_${res.status}` };
      }
      activeFlow = {
        device_code:               data.device_code,
        user_code:                 data.user_code,
        verification_uri:          data.verification_uri,
        verification_uri_complete: data.verification_uri_complete || data.verification_uri,
        started_at: Date.now(),
        interval:   data.interval   || 5,
        expires_in: data.expires_in || 900,
        referralCode,
      };
      return {
        ok: true,
        user_code:                 activeFlow.user_code,
        verification_uri:          activeFlow.verification_uri,
        verification_uri_complete: activeFlow.verification_uri_complete,
        interval:                  activeFlow.interval,
        expires_in:                activeFlow.expires_in,
      };
    } catch (err) {
      return { ok: false, error: err?.message || 'network_error' };
    }
  });

  ipcMain.handle('auth:poll', async () => {
    if (!activeFlow) return { ok: false, error: 'no_active_flow' };
    if (Date.now() - activeFlow.started_at > activeFlow.expires_in * 1000) {
      activeFlow = null;
      return { ok: true, status: 'expired' };
    }
    try {
      const res = await fetch(getProxyUrl() + '/auth/device/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          device_code: activeFlow.device_code,
          // Forward the referral code on every poll — the proxy reads it
          // on the qualifying call (the one where GitHub finally returns
          // an access token) and records the inviter on the new user row.
          ...(activeFlow.referralCode ? { r: activeFlow.referralCode } : {}),
        }),
      });
      const data = await res.json();
      // Worker returns { status: 'pending' | 'authorized' | 'expired' | 'denied' }
      if (data?.status === 'authorized' && data.jwt) {
        setJwt(data.jwt);
        await persistJwtToDisk(userDataPath, data.jwt);
        activeFlow = null;
        return { ok: true, status: 'authorized' };
      }
      if (data?.status === 'expired' || data?.status === 'denied') {
        activeFlow = null;
        return { ok: true, status: data.status };
      }
      return { ok: true, status: data?.status || 'pending', slow_down: !!data?.slow_down };
    } catch (err) {
      return { ok: false, error: err?.message || 'network_error' };
    }
  });

  ipcMain.handle('auth:cancel', async () => {
    activeFlow = null;
    return { ok: true };
  });

  // Lightweight check the renderer uses on boot to decide whether to
  // show the login screen. NEVER returns the JWT itself.
  ipcMain.handle('auth:get-status', async () => {
    const jwt = await getJWT(userDataPath);
    return { ok: true, authenticated: !!jwt };
  });

  ipcMain.handle('auth:me', async () => {
    const jwt = await getJWT(userDataPath);
    if (!jwt) return { ok: false, error: 'unauthenticated' };
    try {
      const res = await fetch(getProxyUrl() + '/auth/me', {
        headers: { Authorization: 'Bearer ' + jwt },
      });
      if (res.status === 401) {
        // Server rejected our JWT — drop it so the next agent turn re-auths.
        setJwt(null);
        await clearJwtOnDisk(userDataPath);
        return { ok: false, error: 'expired' };
      }
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data?.error || `me_failed_${res.status}` };
      return { ok: true, user: data };
    } catch (err) {
      return { ok: false, error: err?.message || 'network_error' };
    }
  });

  ipcMain.handle('auth:sign-out', async () => {
    setJwt(null);
    activeFlow = null;
    await clearJwtOnDisk(userDataPath);
    return { ok: true };
  });

  // Authenticated proxy fetch helper. Used by the desktop's admin panel
  // to call /admin/* endpoints without ever exposing the raw JWT to the
  // renderer. Returns { ok, status, data, error }.
  ipcMain.handle('auth:admin-fetch', async (_e, { path, method, body } = {}) => {
    const jwt = await getJWT(userDataPath);
    if (!jwt) return { ok: false, error: 'unauthenticated' };
    const safePath = String(path || '');
    if (!safePath.startsWith('/admin/')) {
      return { ok: false, error: 'admin_only_paths_allowed' };
    }
    try {
      const url = getProxyUrl() + safePath;
      const res = await fetch(url, {
        method: method || 'GET',
        headers: {
          Authorization: 'Bearer ' + jwt,
          'content-type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return { ok: false, status: res.status, error: data?.error || `http_${res.status}`, data };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, error: err?.message || 'network_error' };
    }
  });
};

// Surface for ipc-agent.js to read the JWT + proxy URL when wiring the
// SDK environment. Not exposed to the renderer.
module.exports.getJWT = getJWT;
module.exports.getJwtSync = getJwtSync;
module.exports.setJwt = setJwt;
module.exports.getProxyUrl = getProxyUrl;
module.exports.clearJwtOnDisk = clearJwtOnDisk;
