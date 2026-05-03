#!/usr/bin/env node
// PiPilot postinstall — runs after `npm install`.
//
// Why a Node script instead of inline shell: the previous `node ... && (cmd
// || echo skipped)` form blew up in Windows cmd.exe (CI runner) because
// cmd.exe doesn't honour single quotes and treats `(` `)` as grouping
// metacharacters. cmd.exe error: `') was unexpected at this time.`
// Doing the work in Node gives us cross-shell behaviour for free.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Always call Node directly with a .js entrypoint, never through a shell.
// `shell: true` mangles paths with spaces on Windows AND triggers
// deprecation warnings under Node 22.
function runNode(label, scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    windowsHide: true,
  });
  if (result.error) {
    console.warn(`[postinstall] ${label} failed to launch:`, result.error.message);
    return false;
  }
  return result.status === 0;
}

// 1. Copy bundled fonts into public/fonts/. Required for the IDE to find
//    them without a network round-trip.
const fontsOk = runNode('copy-fonts', path.join(__dirname, 'copy-fonts.js'));
if (!fontsOk) {
  console.error('[postinstall] copy-fonts is required — failing.');
  process.exit(1);
}

// 2. Rebuild node-pty against Electron's ABI. Best-effort: a pure dev
//    shell may not have Electron headers cached, or the user might just
//    be running tests against vanilla Node. CI builds for distribution
//    *do* need it, but `electron-forge make` will retry during packaging
//    so a failure here isn't fatal — we just log and continue.
//
//    Calling the package's lib/cli.js directly bypasses the .cmd / .sh
//    shim entirely, which would otherwise need a shell wrap.
const rebuildCli = path.join(__dirname, '..', 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const rebuildOk = runNode('electron-rebuild', rebuildCli, ['-w', 'node-pty']);
if (!rebuildOk) {
  console.warn('[postinstall] electron-rebuild skipped or failed — fine in dev, will retry during `make`.');
}
