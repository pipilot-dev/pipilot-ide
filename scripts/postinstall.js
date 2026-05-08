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

// 1a. Copy CDN-served libs (ace, xterm, marked, mermaid, html2pdf) into
//     public/vendor/ so the IDE works fully offline.
const vendorOk = runNode('copy-vendor', path.join(__dirname, 'copy-vendor.js'));
if (!vendorOk) {
  console.error('[postinstall] copy-vendor is required — failing.');
  process.exit(1);
}

// 1b. Generate public/icon.ico from public/icon.png so the Windows
//     installer + Add/Remove Programs entry get a proper branded icon.
//     Best-effort — falls back to Electron's default if the conversion
//     library isn't installed (e.g. minimal CI runs).
runNode('build-icons', path.join(__dirname, 'build-icons.js'));

// 2. Rebuild node-pty against Electron's ABI — but only when needed.
//
//    node-pty 1.1.0 ships N-API prebuilds for darwin-{arm64,x64} and
//    win32-{arm64,x64}. N-API binaries are ABI-stable across Node and
//    Electron versions, so the prebuild loads fine in Electron with no
//    rebuild. lib/utils.js prefers `build/Release` if it exists, else
//    falls back to `prebuilds/<platform>-<arch>` — leaving build/Release
//    empty is exactly what we want.
//
//    Linux ships NO prebuild, so we still need node-gyp to compile from
//    source there.
const fs = require('node:fs');
const platform = process.platform;
const arch = process.arch;
const prebuildPath = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', `${platform}-${arch}`);
const hasPrebuild = fs.existsSync(prebuildPath);

if (hasPrebuild) {
  console.log(`[postinstall] node-pty has an N-API prebuild for ${platform}-${arch} — skipping electron-rebuild.`);
} else {
  console.log(`[postinstall] no node-pty prebuild for ${platform}-${arch} — running electron-rebuild.`);
  const rebuildCli = path.join(__dirname, '..', 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
  const rebuildOk = runNode('electron-rebuild', rebuildCli, ['-w', 'node-pty']);
  if (!rebuildOk) {
    console.warn('[postinstall] electron-rebuild failed — fine in dev, `electron-forge make` will retry during packaging.');
  }
}
