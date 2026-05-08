#!/usr/bin/env node
// PiPilot — copy CDN-served libraries into public/vendor/ for offline use.
//
// Why: the renderer is plain HTML loaded directly by Electron (no bundler).
// We previously pulled ace, xterm, marked, mermaid, html2pdf from public
// CDNs at runtime, which silently broke the editor + terminal + chat
// rendering whenever the user was offline. VS Code-style offline parity
// requires every runtime asset to live on disk inside the install bundle.
//
// Each lib is npm-installed (see package.json) and this script plucks the
// minimum runtime files into public/vendor/<lib>/ so the renderer can
// reach them via a relative URL like `./public/vendor/ace/ace.js`.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'public', 'vendor');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return fs.statSync(dst).size;
}

function copyDir(src, dst, filter) {
  ensureDir(dst);
  let bytes = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      bytes += copyDir(s, d, filter);
    } else if (entry.isFile()) {
      if (filter && !filter(entry.name)) continue;
      fs.copyFileSync(s, d);
      bytes += fs.statSync(d).size;
    }
  }
  return bytes;
}

function need(rel) {
  const p = path.join(NM, rel);
  if (!fs.existsSync(p)) {
    console.error(`[copy-vendor] missing: node_modules/${rel} — run \`npm install\`.`);
    process.exit(1);
  }
  return p;
}

function fmt(bytes) { return `${(bytes / 1024).toFixed(1).padStart(7)} KB`; }

function main() {
  ensureDir(OUT);

  // ---- Ace editor (full src-min-noconflict so dynamic mode/theme/worker
  //      loads find their files at the basePath we configure) -----------
  {
    const dst = path.join(OUT, 'ace');
    rmrf(dst);
    // Drop .map files — they're huge and never needed at runtime.
    const bytes = copyDir(need('ace-builds/src-min-noconflict'), dst, (n) => !n.endsWith('.map'));
    console.log(`[copy-vendor] ace             ${fmt(bytes)}`);
  }

  // ---- xterm + addons --------------------------------------------------
  {
    const dst = path.join(OUT, 'xterm');
    rmrf(dst);
    let bytes = 0;
    bytes += copyFile(need('xterm/lib/xterm.js'), path.join(dst, 'xterm.js'));
    bytes += copyFile(need('xterm/css/xterm.css'), path.join(dst, 'xterm.css'));
    bytes += copyFile(need('xterm-addon-fit/lib/xterm-addon-fit.js'), path.join(dst, 'xterm-addon-fit.js'));
    bytes += copyFile(need('xterm-addon-web-links/lib/xterm-addon-web-links.js'), path.join(dst, 'xterm-addon-web-links.js'));
    console.log(`[copy-vendor] xterm           ${fmt(bytes)}`);
  }

  // ---- marked ----------------------------------------------------------
  {
    const dst = path.join(OUT, 'marked');
    rmrf(dst);
    const bytes = copyFile(need('marked/marked.min.js'), path.join(dst, 'marked.min.js'));
    console.log(`[copy-vendor] marked          ${fmt(bytes)}`);
  }

  // ---- mermaid (UMD min build) -----------------------------------------
  {
    const dst = path.join(OUT, 'mermaid');
    rmrf(dst);
    const bytes = copyFile(need('mermaid/dist/mermaid.min.js'), path.join(dst, 'mermaid.min.js'));
    console.log(`[copy-vendor] mermaid         ${fmt(bytes)}`);
  }

  // ---- html2pdf --------------------------------------------------------
  {
    const dst = path.join(OUT, 'html2pdf');
    rmrf(dst);
    const bytes = copyFile(need('html2pdf.js/dist/html2pdf.bundle.min.js'), path.join(dst, 'html2pdf.bundle.min.js'));
    console.log(`[copy-vendor] html2pdf        ${fmt(bytes)}`);
  }
}

main();
