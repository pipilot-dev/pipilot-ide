// PiPilot IDE — Shared lazy loader for the Claude Agent SDK.
// Both ipc-agent (chat) and missions (background runs) need it; this
// keeps the dynamic-import dance and error-caching in one place.

const path = require('path');
const fs = require('fs');

let sdkModule = null;
let sdkLoadError = null;

async function loadSdk() {
  if (sdkModule) return sdkModule;
  if (sdkLoadError) throw sdkLoadError;
  try {
    sdkModule = await import('@anthropic-ai/claude-agent-sdk');
    return sdkModule;
  } catch (err) {
    sdkLoadError = err;
    throw err;
  }
}

// Resolve runtime hints for `sdk.query({ options })` so the agent works
// in a packaged Electron app the same way it works in dev.
//
// PROBLEM in production:
//   The SDK does `spawn('node', [<sdk>/cli.js, ...])`.
//   1) Most users don't have `node` on PATH.
//   2) cli.js lives inside app.asar — which spawn() can't read because
//      asar files aren't real on-disk paths to the OS.
//
// FIX:
//   1) Use Electron's own binary as Node by setting executable to
//      process.execPath and ELECTRON_RUN_AS_NODE=1 in the env. Electron
//      then runs as a pure Node process — no Chromium, just the V8 +
//      Node bindings that ship with the app.
//   2) Add asarUnpack for the SDK in forge.config.js (already done).
//      That puts cli.js at <install>/resources/app.asar.unpacked/...
//      which IS a real on-disk path. Resolve it explicitly so we don't
//      depend on Electron's transparent asar→asar.unpacked path
//      rewriting being available to a spawned subprocess.
function resolveAgentRuntime() {
  // Resolve cli.js's directory via require.resolve — works in dev (real
  // node_modules path) and in prod (resolves into app.asar). For prod,
  // swap the .asar segment for .asar.unpacked so spawn() gets a path it
  // can actually exec.
  let cliPath = null;
  try {
    const sdkPkg = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    const sdkDir = path.dirname(sdkPkg);
    let candidate = path.join(sdkDir, 'cli.js');
    if (candidate.includes(`${path.sep}app.asar${path.sep}`)) {
      candidate = candidate.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
      );
    }
    if (fs.existsSync(candidate)) cliPath = candidate;
  } catch {}

  return {
    // Electron's binary doubles as a Node runtime when ELECTRON_RUN_AS_NODE
    // is set. process.execPath is always the path to the running binary —
    // works in dev (your local Node + Electron build) and in prod (the
    // packaged pipilot-ide.exe).
    executable: process.execPath,
    executableArgs: [],
    pathToClaudeCodeExecutable: cliPath || undefined,
    extraEnv: {
      // Tell the spawned Electron child process to behave as Node.
      ELECTRON_RUN_AS_NODE: '1',
    },
  };
}

module.exports = { loadSdk, resolveAgentRuntime };
