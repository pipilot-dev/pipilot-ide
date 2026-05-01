#!/usr/bin/env node
// PiPilot — copy @fontsource bundles into public/fonts/<id>/ at install time.
//
// Why this script: the renderer is plain HTML loaded directly by Electron —
// no bundler, no asset pipeline. The @fontsource packages live under
// node_modules/ which isn't web-accessible from the renderer. We pluck just
// the latin + latin-ext CSS files (covers ~99% of code) and the referenced
// woff2 files, then write them to public/fonts/<id>/ so the app can load
// them via a relative `public/fonts/<id>/index.css` URL — works offline,
// no CDN, no privacy leak.
//
// Skipped: per-script (cyrillic, greek, vietnamese, etc.) variants, italic,
// every weight outside 400/700, and the heavier .woff fallbacks (modern
// browsers all support woff2). Each font ends up ~25-60 KB.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PKG_DIR = path.join(ROOT, 'node_modules', '@fontsource');
const OUT_DIR = path.join(ROOT, 'public', 'fonts');

// id (matches fonts.js registry) → @fontsource package name
const FONTS = [
  { id: 'jetbrains-mono',  pkg: 'jetbrains-mono'  },
  { id: 'fira-code',       pkg: 'fira-code'       },
  { id: 'ibm-plex-mono',   pkg: 'ibm-plex-mono'   },
  { id: 'source-code-pro', pkg: 'source-code-pro' },
  { id: 'roboto-mono',     pkg: 'roboto-mono'     },
  { id: 'inconsolata',     pkg: 'inconsolata'     },
  { id: 'space-mono',      pkg: 'space-mono'      },
  { id: 'ubuntu-mono',     pkg: 'ubuntu-mono'     },
  { id: 'dm-mono',         pkg: 'dm-mono'         },
];

// CSS variants per font we care about. Order matters — wider unicode-range
// blocks first (latin-ext) then latin so smaller subsets win when both have
// the same weight.
const CSS_VARIANTS = [
  'latin-ext-400.css',
  'latin-400.css',
  'latin-ext-700.css',
  'latin-700.css',
];

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function processFont(font) {
  const srcDir = path.join(SOURCE_PKG_DIR, font.pkg);
  if (!fs.existsSync(srcDir)) {
    console.warn(`[copy-fonts] missing package: @fontsource/${font.pkg} — skipping`);
    return null;
  }
  const outDir = path.join(OUT_DIR, font.id);
  rmrf(outDir);
  ensureDir(path.join(outDir, 'files'));

  const cssChunks = [];
  const seenWoff2 = new Set();

  for (const variant of CSS_VARIANTS) {
    const cssPath = path.join(srcDir, variant);
    if (!fs.existsSync(cssPath)) continue;
    let css = fs.readFileSync(cssPath, 'utf8');

    // Drop the .woff fallback src — keep only woff2 to halve disk footprint.
    css = css.replace(
      /src:\s*url\(([^)]+\.woff2)\)\s*format\('woff2'\)\s*,\s*url\([^)]+\.woff\)\s*format\('woff'\)\s*;/g,
      "src: url($1) format('woff2');"
    );

    // Collect referenced woff2 files for copy.
    const re = /url\(\.\/files\/([^)]+\.woff2)\)/g;
    let m;
    while ((m = re.exec(css)) !== null) seenWoff2.add(m[1]);

    cssChunks.push(`/* @fontsource/${font.pkg} — ${variant} */\n${css.trim()}\n`);
  }

  if (!cssChunks.length) {
    console.warn(`[copy-fonts] no usable CSS in @fontsource/${font.pkg}`);
    return null;
  }

  // Copy each referenced woff2 file
  let bytes = 0;
  for (const name of seenWoff2) {
    const src = path.join(srcDir, 'files', name);
    const dst = path.join(outDir, 'files', name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      bytes += fs.statSync(dst).size;
    }
  }

  fs.writeFileSync(path.join(outDir, 'index.css'), cssChunks.join('\n'));
  return { id: font.id, files: seenWoff2.size, bytes };
}

function main() {
  if (!fs.existsSync(SOURCE_PKG_DIR)) {
    console.warn('[copy-fonts] node_modules/@fontsource not found — run `npm install` first.');
    return;
  }
  ensureDir(OUT_DIR);
  let total = 0;
  for (const font of FONTS) {
    const r = processFont(font);
    if (r) {
      console.log(`[copy-fonts] ${r.id.padEnd(18)} ${r.files} files  ${(r.bytes / 1024).toFixed(1).padStart(6)} KB`);
      total += r.bytes;
    }
  }
  console.log(`[copy-fonts] total: ${(total / 1024).toFixed(1)} KB across ${FONTS.length} fonts`);
}

main();
