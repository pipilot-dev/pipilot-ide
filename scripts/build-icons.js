#!/usr/bin/env node
// PiPilot — build platform-specific icon files from public/icon.png.
//
// Squirrel installer wants .ico (multi-resolution Windows icon format).
// macOS packager wants .icns. We have one source PNG (512x512 RGBA) and
// generate the rest at install time so we don't have to commit binaries
// per platform.
//
// Generated files:
//   public/icon.ico  — Windows (this script)
//   public/icon.icns — macOS (TODO: add iconutil-based step or skip
//                       and accept the default Electron icon for v0.1)

const fs = require('node:fs');
const path = require('node:path');

const SRC_PNG = path.join(__dirname, '..', 'public', 'icon.png');
const OUT_ICO = path.join(__dirname, '..', 'public', 'icon.ico');

async function main() {
  if (!fs.existsSync(SRC_PNG)) {
    console.warn('[build-icons] no public/icon.png — skipping icon generation.');
    return;
  }

  // Skip if up-to-date (PNG mtime older than ICO mtime).
  if (fs.existsSync(OUT_ICO)) {
    const srcM = fs.statSync(SRC_PNG).mtimeMs;
    const dstM = fs.statSync(OUT_ICO).mtimeMs;
    if (dstM >= srcM) {
      console.log('[build-icons] icon.ico is up-to-date.');
      return;
    }
  }

  // png-to-ico is ESM-only; use dynamic import from this CommonJS script.
  // It auto-generates the standard Windows resolutions (16/32/48) from
  // our single 512x512 source.
  const { default: pngToIco } = await import('png-to-ico');
  const buf = await pngToIco(SRC_PNG);
  fs.writeFileSync(OUT_ICO, buf);
  console.log(`[build-icons] generated icon.ico (${(buf.length / 1024).toFixed(1)} KB) from icon.png`);
}

main().catch((err) => {
  console.warn('[build-icons] failed:', err.message);
  // Non-fatal — packager will fall back to Electron's default icon.
});
