/**
 * Build IPC handlers from TypeScript to CJS using esbuild.
 * Output: dist-electron/ipc-handlers.cjs
 */

import { build } from 'esbuild';
import { builtinModules } from 'module';
import { mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'dist-electron');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('[build] Compiling IPC handlers...');
await build({
  entryPoints: [resolve(ROOT, 'electron/ipc-api.ts')],
  outfile: resolve(OUT, 'ipc-handlers.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external: [
    'electron',
    'node-pty',
    ...builtinModules,
    ...builtinModules.map(m => `node:${m}`),
  ],
});

console.log('[build] Done! dist-electron/ipc-handlers.cjs');
