/**
 * Build Electron main process + preload with esbuild.
 *
 * Outputs CJS format — no ESM/CJS conflicts, require() just works.
 * Node.js builtins and native modules are externalized.
 */

import { build } from "esbuild";
import { builtinModules } from "module";
import { rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "dist-electron");

// Clean output
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const external = [
  "electron",
  "node-pty",
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

// Build main process
console.log("[electron] Building main process...");
await build({
  entryPoints: [resolve(ROOT, "electron/main.ts")],
  outfile: resolve(OUT, "main.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  minify: false,
  external,
  define: {
    "import.meta.url": "__filename",
  },
});

// Build preload
console.log("[electron] Building preload...");
await build({
  entryPoints: [resolve(ROOT, "electron/preload.ts")],
  outfile: resolve(OUT, "preload.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  minify: false,
  external: ["electron"],
});

console.log("[electron] Done! Output in dist-electron/");
