/**
 * Bundle the Express agent server into a single JS file for Tauri sidecar.
 * Uses esbuild to compile TypeScript + bundle all dependencies into one file.
 * Output: src-tauri/server-bundle/agent-server.mjs
 *
 * This is run as part of the Tauri build process (beforeBuildCommand).
 */

import { build } from "esbuild";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "src-tauri", "server-bundle");

mkdirSync(outDir, { recursive: true });

console.log("[bundle-server] Bundling agent server...");

await build({
  entryPoints: [resolve(root, "server", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: resolve(outDir, "agent-server.mjs"),
  // Mark native modules as external — they need to be installed on the user's system
  external: [
    "node-pty",      // native PTY module (Tauri handles this via Rust)
    "fsevents",      // macOS-only native module
    "cpu-features",  // optional native
    "ssh2",          // optional
  ],
  // Replace dotenv config (env vars come from Tauri in production)
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  banner: {
    js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`,
  },
  sourcemap: false,
  minify: true,
  treeShaking: true,
});

console.log("[bundle-server] Done → src-tauri/server-bundle/agent-server.mjs");
