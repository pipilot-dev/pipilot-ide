// PiPilot IDE — Background mode + power management + sleep resilience
//
// One module, three responsibilities:
//
// 1. TRAY-RESIDENT MODE
//    Intercepts the window's close event. If "run in background" is on,
//    the window is hidden instead of destroyed. A system-tray icon stays
//    visible with Show / Hide / Quit menu items, plus an agent-status
//    indicator that flips green when an agent run is active.
//
// 2. POWER-SAVE BLOCKER
//    Holds a `prevent-app-suspension` blocker for the duration of every
//    agent turn (between `agent:active` true → false bus events). The
//    machine sleeps normally when idle, stays awake exactly while the
//    agent is doing work.
//
// 3. SLEEP RESILIENCE
//    Hooks into Electron's powerMonitor `suspend` / `resume` events,
//    saves a small breadcrumb to disk on suspend, and broadcasts both
//    transitions to the renderer (so the chat can show "paused —
//    resuming…" UI and the mobile companion can reflect desktop state).

const { app, Tray, Menu, nativeImage, powerSaveBlocker, powerMonitor, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

let tray = null;
let blockerId = null;
// Refcount instead of a boolean — multiple concurrent agents are real:
// chat + a mission + the wiki auto-updater can all be in-flight at the
// same time. We hold the blocker while ANY agent is active and only
// release it when every caller has reported done. Keys are arbitrary
// caller tags ('chat', `mission:<id>`, 'wiki') so we can debug who's
// keeping the machine awake.
const activeAgents = new Set();
let backgroundMode = true;        // user-toggleable; defaults true
let keepAwakeWhileAgent = true;   // user-toggleable; defaults true
let isQuitting = false;

function isAgentActive() { return activeAgents.size > 0; }

function readSettings(userDataPath) {
  try {
    const raw = fs.readFileSync(path.join(userDataPath, 'settings.json'), 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
}

function loadInitialPrefs(userDataPath) {
  const s = readSettings(userDataPath);
  if (typeof s.backgroundMode === 'boolean') backgroundMode = s.backgroundMode;
  if (typeof s.keepAwakeWhileAgent === 'boolean') keepAwakeWhileAgent = s.keepAwakeWhileAgent;
}

function setTrayTooltip() {
  if (!tray) return;
  const n = activeAgents.size;
  tray.setToolTip(n > 0 ? `PiPilot — ${n} agent${n === 1 ? '' : 's'} running` : 'PiPilot');
}

function buildTrayMenu(getWindow) {
  const n = activeAgents.size;
  return Menu.buildFromTemplate([
    {
      label: n > 0 ? `● ${n} agent${n === 1 ? '' : 's'} active` : '○ Idle',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open PiPilot',
      click: () => {
        const w = getWindow();
        if (!w) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      },
    },
    {
      label: 'Hide window',
      click: () => { try { getWindow()?.hide(); } catch {} },
    },
    { type: 'separator' },
    {
      label: 'Quit PiPilot',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTrayMenu(getWindow) {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu(getWindow));
  setTrayTooltip();
}

function ensureTray(getWindow) {
  if (tray) return tray;
  // Tray icon — fall back to text-only if image missing.
  let img = null;
  try {
    img = nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'icon.png'));
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  } catch {}
  tray = new Tray(img && !img.isEmpty() ? img : nativeImage.createEmpty());
  tray.on('click', () => {
    const w = getWindow();
    if (!w) return;
    if (w.isVisible() && !w.isMinimized()) w.hide();
    else { w.show(); w.focus(); }
  });
  refreshTrayMenu(getWindow);
  return tray;
}

function destroyTray() {
  if (tray) { try { tray.destroy(); } catch {} tray = null; }
}

// ── Power-save blocker ─────────────────────────────────────────────
function startBlocker() {
  if (blockerId !== null) return;
  if (!keepAwakeWhileAgent) return;
  try { blockerId = powerSaveBlocker.start('prevent-app-suspension'); } catch {}
}
function stopBlocker() {
  if (blockerId === null) return;
  try { powerSaveBlocker.stop(blockerId); } catch {}
  blockerId = null;
}

function setAgentActive(active, getWindow, tag = 'default') {
  const wasActive = isAgentActive();
  if (active) activeAgents.add(tag);
  else activeAgents.delete(tag);
  const nowActive = isAgentActive();
  if (!wasActive && nowActive) startBlocker();
  else if (wasActive && !nowActive) stopBlocker();
  refreshTrayMenu(getWindow);
}

// ── Sleep / resume hooks ───────────────────────────────────────────
function writeSleepBreadcrumb(userDataPath, kind) {
  try {
    const dir = path.join(userDataPath);
    const file = path.join(dir, 'last-sleep.json');
    fsp.writeFile(file, JSON.stringify({
      kind,
      at: Date.now(),
      agentWasActive: isAgentActive(),
      activeAgents: Array.from(activeAgents),
    }, null, 2), 'utf8').catch(() => {});
  } catch {}
}

function broadcast(channel, payload, getWindow) {
  try {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  } catch {}
}

// ── Public init ────────────────────────────────────────────────────
function init({ ipcMain, getWindow, userDataPath }) {
  loadInitialPrefs(userDataPath);

  // Intercept window close — hide if background mode on, otherwise quit.
  app.on('before-quit', () => { isQuitting = true; });
  const win = getWindow();
  if (win) attachCloseInterceptor(win, getWindow);

  // For windows recreated later
  app.on('browser-window-created', (_e, w) => attachCloseInterceptor(w, getWindow));

  // Tray
  ensureTray(getWindow);

  // Power monitor
  try {
    powerMonitor.on('suspend', () => {
      writeSleepBreadcrumb(userDataPath, 'suspend');
      broadcast('power:suspend', { agentWasActive: isAgentActive(), activeAgents: Array.from(activeAgents) }, getWindow);
    });
    powerMonitor.on('resume', () => {
      writeSleepBreadcrumb(userDataPath, 'resume');
      broadcast('power:resume', { agentWasActive: isAgentActive(), activeAgents: Array.from(activeAgents) }, getWindow);
    });
    powerMonitor.on('lock-screen', () => broadcast('power:lock', null, getWindow));
    powerMonitor.on('unlock-screen', () => broadcast('power:unlock', null, getWindow));
  } catch {}

  // ── IPC: agent-active signaling from renderer ──
  // Accepts either (active) — backward compatible, tag defaults to
  // 'chat' — or ({ active, tag }) for the missions / wiki runners.
  ipcMain.handle('background:agent-active', (_e, payload) => {
    let active, tag;
    if (typeof payload === 'object' && payload !== null) {
      active = !!payload.active;
      tag = payload.tag || 'default';
    } else {
      active = !!payload;
      tag = 'chat';
    }
    setAgentActive(active, getWindow, tag);
    return { ok: true, active: isAgentActive(), tag, count: activeAgents.size };
  });
  ipcMain.handle('background:status', () => ({
    ok: true,
    agentActive: isAgentActive(),
    activeAgents: Array.from(activeAgents),
    backgroundMode,
    keepAwakeWhileAgent,
    blocker: blockerId !== null,
  }));
  ipcMain.handle('background:set-prefs', (_e, prefs) => {
    if (typeof prefs?.backgroundMode === 'boolean') backgroundMode = prefs.backgroundMode;
    if (typeof prefs?.keepAwakeWhileAgent === 'boolean') {
      keepAwakeWhileAgent = prefs.keepAwakeWhileAgent;
      if (isAgentActive() && keepAwakeWhileAgent) startBlocker();
      if (!keepAwakeWhileAgent) stopBlocker();
    }
    return { ok: true, backgroundMode, keepAwakeWhileAgent };
  });
}

function attachCloseInterceptor(window, getWindow) {
  if (!window || window.__pipilotCloseHooked) return;
  window.__pipilotCloseHooked = true;
  window.on('close', (e) => {
    if (isQuitting) return;
    if (!backgroundMode) return; // let it close normally
    e.preventDefault();
    try { window.hide(); } catch {}
    refreshTrayMenu(getWindow);
  });
}

module.exports = { init, setAgentActive };
