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

function spawnUpdate(args) {
  // Update.exe lives in the Squirrel install root, one level up from
  // the per-version app dir that hosts our exe.
  const exeDir   = path.dirname(process.execPath);
  const updateExe = path.resolve(exeDir, '..', 'Update.exe');
  return spawn(updateExe, args, { detached: true, stdio: 'ignore' });
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
    case '--squirrel-updated': {
      // Create / refresh shortcuts in StartMenu + Desktop.
      try { spawnUpdate(['--createShortcut', exeName, '-l', SHORTCUT_LOCATIONS]); } catch {}
      // Squirrel expects us to exit promptly so it can finish its work.
      // We use a tiny delay so the spawn isn't killed by our own exit.
      setTimeout(() => process.exit(0), 1000);
      return true;
    }
    case '--squirrel-uninstall': {
      try { spawnUpdate(['--removeShortcut', exeName, '-l', SHORTCUT_LOCATIONS]); } catch {}
      setTimeout(() => process.exit(0), 1000);
      return true;
    }
    case '--squirrel-obsolete': {
      // Old version being torn down after a successful update — nothing
      // for us to do; just exit so Squirrel can move on.
      process.exit(0);
      return true;
    }
    default:
      return false;
  }
}

module.exports = { handleSquirrelEvent };
