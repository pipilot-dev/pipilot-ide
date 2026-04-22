// Verify Codestral IPC — both FIM completions and chat.
// Skipped gracefully if no network / API key missing.

require('dotenv').config();

function makeMockIpc() {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const invoke = async (ch, payload) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error('no handler: ' + ch);
    return await fn({ sender: { send: () => {}, isDestroyed: () => false } }, payload);
  };
  return { ipcMain, invoke };
}

(async () => {
  const { ipcMain, invoke } = makeMockIpc();
  require('../main/ipc-codestral')(ipcMain, { userDataPath: '/tmp', getWindow: () => null });

  const status = await invoke('codestral:status');
  console.log('status:', status);
  if (!status.configured) {
    console.log('→ No API key configured, skipping live tests');
    process.exit(0);
  }

  console.log('\n=== FIM completion ===');
  const fim = await invoke('codestral:fim', {
    prefix: 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return ',
    suffix: '\n}',
    language: 'javascript',
    maxTokens: 80,
    temperature: 0,
  });
  console.log('ok:', fim.ok);
  if (fim.ok) {
    console.log('completion:', JSON.stringify(fim.text));
    console.log('usage:', fim.usage);
  } else {
    console.log('error:', fim.error);
  }

  console.log('\n=== Chat (non-stream) ===');
  const chat = await invoke('codestral:chat', {
    messages: [
      { role: 'system', content: 'You reply with exactly one word.' },
      { role: 'user', content: 'Say PING.' },
    ],
    maxTokens: 10,
    temperature: 0,
  });
  console.log('ok:', chat.ok);
  if (chat.ok) {
    console.log('reply:', JSON.stringify(chat.text));
  } else {
    console.log('error:', chat.error);
  }

  const pass = fim.ok && chat.ok;
  console.log('\n' + (pass ? '✓ Codestral integration working' : '✗ Codestral integration failed'));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
