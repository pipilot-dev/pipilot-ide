// PiPilot IDE — Squirrel.Windows install-event handler.
//
// Replaces the `electron-squirrel-startup` package because that one
// only creates a Start Menu shortcut (Squirrel's default). We want a
// Desktop shortcut too, so the app behaves like every other installer
// users are used to.
//
// Squirrel relaunches our exe with these flags during the install
// lifecycle:
//   --squirrel-install    (first install — create shortcuts)
//   --squirrel-updated    (after update  — refresh shortcuts in case
//                          the exe location changed)
//   --squirrel-uninstall  (uninstall      — remove shortcuts)
//   --squirrel-obsolete   (after the new version is installed and old
//                          version is being cleaned up — no-op for us)
//
// On any of those flags we do the bookkeeping then exit. main.js calls
// this BEFORE building any window so we don't ever briefly flash a UI
// during install.

const path = require('node:path');
const { spawn } = require('node:child_process');

// Locations to create a shortcut in. StartMenu is conventional;
// Desktop is what users actually expect ("where's the icon?").
// Startup is OFF — auto-launch on boot annoys users; expose it via
// Settings → Features instead so it's opt-in.
const SHORTCUT_LOCATIONS = 'StartMenu,Desktop';

// Spawn Update.exe and wait for it to finish. The previous
// implementation used a fixed setTimeout(..., 1000) → process.exit(0)
// which sometimes killed Update.exe mid-flight on slower machines and
// no shortcuts were created. Listening for `close` is the canonical
// pattern (electron-squirrel-startup uses the same model).
function spawnUpdate(args, done) {
  // Update.exe lives in the Squirrel install root, one level up from
  // the per-version app dir that hosts our exe.
  const exeDir   = path.dirname(process.execPath);
  const updateExe = path.resolve(exeDir, '..', 'Update.exe');
  let child;
  try {
    child = spawn(updateExe, args, { detached: true });
  } catch (err) {
    console.error('[squirrel] Update.exe spawn failed:', err);
    done();
    return null;
  }
  child.on('close', (code) => {
    if (code !== 0) console.warn('[squirrel] Update.exe exited code', code, 'for args', args);
    done();
  });
  child.on('error', (err) => {
    console.error('[squirrel] Update.exe error:', err);
    done();
  });
  // Hard fallback in case Update.exe hangs — never block install/uninstall
  // forever. 30s is far longer than the operation actually takes.
  setTimeout(done, 30_000);
  return child;
}

// Quit using app.quit() when Electron is available (graceful), fall back
// to process.exit otherwise (the squirrel-event launches don't fully
// initialise the app module path on some versions).
function quit() {
  try {
    const { app } = require('electron');
    app.quit();
    // app.quit is async; if main.js hasn't run any other quit blockers,
    // process exits naturally. Hard exit after a beat if not.
    setTimeout(() => process.exit(0), 500);
  } catch {
    process.exit(0);
  }
}

// Returns true if the process should quit immediately (i.e. we were
// launched as part of the install/update lifecycle, not by the user).
function handleSquirrelEvent() {
  if (process.platform !== 'win32') return false;
  if (process.argv.length < 2) return false;

  const flag = process.argv[1];
  const exeName = path.basename(process.execPath);

  switch (flag) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Create / refresh shortcuts in StartMenu + Desktop, THEN quit.
      spawnUpdate(['--createShortcut', exeName, '-l', SHORTCUT_LOCATIONS], quit);
      return true;
    case '--squirrel-uninstall':
      spawnUpdate(['--removeShortcut', exeName, '-l', SHORTCUT_LOCATIONS], quit);
      return true;
    case '--squirrel-obsolete':
      // Old version being torn down after a successful update — nothing
      // for us to do; just exit so Squirrel can move on.
      quit();
      return true;
    default:
      return false;
  }
}

module.exports = { handleSquirrelEvent };
