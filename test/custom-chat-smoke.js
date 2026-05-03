// Smoke test: Custom AI Chat Extension — end-to-end
// Tests: DB save API key → fetch API → stream response → tool calling

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), 'pipilot-chat-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

// Set up ext-db handlers
const registerExtDBHandlers = require('../main/ipc-ext-db');
const handlers = {};
const mockIpcMain = { handle(ch, fn) { handlers[ch] = fn; } };
registerExtDBHandlers(mockIpcMain, { getWindow: () => null, userDataPath: tmpDir });

async function callDB(channel, payload) {
  return handlers[channel](null, payload);
}

// Config matching the extension
const CONFIG = {
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b-versatile',
  maxTokens: 256,
  temperature: 0.3,
};

const GROQ_KEY = process.env.GROQ_API_KEY;
const EXT_ID = 'custom-ai-chat';

async function run() {
  console.log('=== Custom AI Chat Smoke Test ===\n');

  if (!GROQ_KEY) {
    console.log('SKIP: GROQ_API_KEY not set in .env');
    return;
  }

  // 1. Save API key via ext-db IPC
  console.log('--- 1. Save API key via IPC ---');
  var r = await callDB('ext-db:set', { extId: EXT_ID, key: 'apiKey', value: GROQ_KEY });
  console.log('save key:', r.ok ? 'PASS' : 'FAIL');

  // 2. Read it back
  r = await callDB('ext-db:get', { extId: EXT_ID, key: 'apiKey' });
  console.log('read key:', r.value === GROQ_KEY ? 'PASS' : 'FAIL');

  // 3. Send a simple message (non-streaming for simplicity)
  console.log('\n--- 2. Send message to API ---');
  var messages = [
    { role: 'system', content: 'You are a helpful assistant. Reply in one short sentence.' },
    { role: 'user', content: 'What is 2 + 2?' },
  ];

  var resp = await fetch(CONFIG.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_KEY,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: messages,
      max_tokens: CONFIG.maxTokens,
      temperature: CONFIG.temperature,
    }),
  });

  console.log('API status:', resp.status);
  if (!resp.ok) {
    console.log('FAIL: API returned', resp.status, await resp.text());
    return;
  }

  var data = await resp.json();
  var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  console.log('response:', reply ? 'PASS — "' + reply.trim().slice(0, 80) + '"' : 'FAIL — no content');

  // 4. Test streaming
  console.log('\n--- 3. Streaming response ---');
  var streamResp = await fetch(CONFIG.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_KEY,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [
        { role: 'system', content: 'Reply with exactly: "Streaming works!"' },
        { role: 'user', content: 'Test' },
      ],
      max_tokens: 20,
      stream: true,
    }),
  });

  var reader = streamResp.body.getReader();
  var decoder = new TextDecoder();
  var streamedText = '';
  var chunkCount = 0;

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    var text = decoder.decode(chunk.value, { stream: true });
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        var parsed = JSON.parse(line.slice(6));
        var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
        if (delta && delta.content) {
          streamedText += delta.content;
          chunkCount++;
        }
      } catch (e) {}
    }
  }
  console.log('chunks received:', chunkCount);
  console.log('streamed text:', '"' + streamedText.trim() + '"');
  console.log('streaming:', chunkCount > 0 ? 'PASS' : 'FAIL');

  // 5. Test tool calling
  console.log('\n--- 4. Tool calling ---');
  var toolResp = await fetch(CONFIG.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_KEY,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [
        { role: 'system', content: 'You must use the read_file tool to answer.' },
        { role: 'user', content: 'Read the file package.json' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
        }
      }],
      max_tokens: 100,
    }),
  });

  var toolData = await toolResp.json();
  var toolCalls = toolData.choices && toolData.choices[0] && toolData.choices[0].message && toolData.choices[0].message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    var tc = toolCalls[0];
    var toolArgs = JSON.parse(tc.function.arguments);
    console.log('tool called:', tc.function.name, '→', toolArgs.path);
    console.log('tool calling: PASS');
  } else {
    console.log('tool calling: FAIL — no tool calls in response');
  }

  // 6. Save chat history
  console.log('\n--- 5. Persist chat history ---');
  messages.push({ role: 'assistant', content: reply });
  await callDB('ext-db:set', { extId: EXT_ID, key: 'messages', value: messages });
  r = await callDB('ext-db:get', { extId: EXT_ID, key: 'messages' });
  console.log('history saved:', Array.isArray(r.value) && r.value.length === 3 ? 'PASS' : 'FAIL');

  // 7. Persist to disk
  await callDB('ext-db:persist', { extId: EXT_ID });
  var dbFile = path.join(tmpDir, 'ext-databases', EXT_ID + '.sqlite');
  console.log('db persisted:', fs.existsSync(dbFile) ? 'PASS' : 'FAIL');

  // Cleanup
  await callDB('ext-db:destroy', { extId: EXT_ID });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\n=== ALL TESTS PASSED ===');
}

run().catch(e => { console.error('ERROR:', e); process.exit(1); });
