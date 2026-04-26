// PiPilot IDE — Shared lazy loader for the Claude Agent SDK.
// Both ipc-agent (chat) and missions (background runs) need it; this
// keeps the dynamic-import dance and error-caching in one place.

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

module.exports = { loadSdk };
