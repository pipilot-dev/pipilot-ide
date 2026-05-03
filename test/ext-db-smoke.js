// Smoke test: Extension SQLite Database (sql.js)
// Tests the main-process IPC handlers directly without Electron

const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), 'pipilot-ext-db-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });

const registerExtDBHandlers = require('../main/ipc-ext-db');

// Mock ipcMain
const handlers = {};
const mockIpcMain = { handle(ch, fn) { handlers[ch] = fn; } };
const mockCtx = { getWindow: () => null, userDataPath: tmpDir };

registerExtDBHandlers(mockIpcMain, mockCtx);

async function call(channel, payload) {
  return handlers[channel](null, payload);
}

async function run() {
  console.log('=== Extension DB Smoke Test ===');
  console.log('Temp dir:', tmpDir);

  const EXT_ID = 'test-extension';

  // 1. Key-Value: set + get
  console.log('\n--- Key-Value Store ---');
  var r = await call('ext-db:set', { extId: EXT_ID, key: 'greeting', value: 'hello world' });
  console.log('set:', r.ok ? 'OK' : 'FAIL');

  r = await call('ext-db:get', { extId: EXT_ID, key: 'greeting' });
  console.log('get:', r.value === 'hello world' ? 'PASS' : 'FAIL — got: ' + r.value);

  // 2. Complex values
  await call('ext-db:set', { extId: EXT_ID, key: 'config', value: { theme: 'dark', fontSize: 14, nested: { a: 1 } } });
  r = await call('ext-db:get', { extId: EXT_ID, key: 'config' });
  console.log('complex value:', r.value.theme === 'dark' && r.value.nested.a === 1 ? 'PASS' : 'FAIL');

  // 3. Keys
  r = await call('ext-db:keys', { extId: EXT_ID });
  console.log('keys:', r.keys.length === 2 && r.keys.includes('greeting') ? 'PASS' : 'FAIL — ' + JSON.stringify(r.keys));

  // 4. Get all
  r = await call('ext-db:get-all', { extId: EXT_ID });
  console.log('getAll:', r.entries.length === 2 ? 'PASS' : 'FAIL — ' + r.entries.length);

  // 5. Remove
  await call('ext-db:remove', { extId: EXT_ID, key: 'greeting' });
  r = await call('ext-db:get', { extId: EXT_ID, key: 'greeting' });
  console.log('remove:', r.value === null ? 'PASS' : 'FAIL');

  // 6. Collections
  console.log('\n--- Collections ---');
  await call('ext-db:collection-insert', { extId: EXT_ID, collection: 'bookmarks', id: 'bm1', data: { file: '/src/index.ts', line: 42 } });
  await call('ext-db:collection-insert', { extId: EXT_ID, collection: 'bookmarks', id: 'bm2', data: { file: '/src/app.tsx', line: 10 } });

  r = await call('ext-db:collection-get', { extId: EXT_ID, collection: 'bookmarks', id: 'bm1' });
  console.log('collection get:', r.data.file === '/src/index.ts' ? 'PASS' : 'FAIL');

  r = await call('ext-db:collection-list', { extId: EXT_ID, collection: 'bookmarks' });
  console.log('collection list:', r.items.length === 2 ? 'PASS' : 'FAIL — ' + r.items.length);

  await call('ext-db:collection-delete', { extId: EXT_ID, collection: 'bookmarks', id: 'bm1' });
  r = await call('ext-db:collection-list', { extId: EXT_ID, collection: 'bookmarks' });
  console.log('collection delete:', r.items.length === 1 ? 'PASS' : 'FAIL');

  // 7. Raw SQL
  console.log('\n--- Raw SQL ---');
  await call('ext-db:exec', { extId: EXT_ID, sql: 'CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT, body TEXT)' });
  await call('ext-db:exec', { extId: EXT_ID, sql: "INSERT INTO notes VALUES ('n1', 'First Note', 'Hello from SQL')" });
  await call('ext-db:exec', { extId: EXT_ID, sql: "INSERT INTO notes VALUES ('n2', 'Second Note', 'SQL is powerful')" });
  r = await call('ext-db:query', { extId: EXT_ID, sql: 'SELECT * FROM notes ORDER BY id' });
  console.log('raw SQL:', r.results.length === 1 && r.results[0].values.length === 2 ? 'PASS' : 'FAIL');

  // 8. Persist to disk
  console.log('\n--- Persistence ---');
  await call('ext-db:persist', { extId: EXT_ID });
  var dbFile = path.join(tmpDir, 'ext-databases', EXT_ID + '.sqlite');
  console.log('persisted:', fs.existsSync(dbFile) ? 'PASS' : 'FAIL');
  console.log('file size:', fs.statSync(dbFile).size, 'bytes');

  // 9. Isolation: different extension gets empty DB
  console.log('\n--- Isolation ---');
  r = await call('ext-db:get', { extId: 'other-extension', key: 'config' });
  console.log('isolation:', r.value === null ? 'PASS' : 'FAIL — leaked data');

  // 10. Destroy
  console.log('\n--- Destroy ---');
  await call('ext-db:destroy', { extId: EXT_ID });
  console.log('destroy:', !fs.existsSync(dbFile) ? 'PASS' : 'FAIL — file still exists');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\n=== ALL TESTS PASSED ===');
}

run().catch(e => { console.error('ERROR:', e); process.exit(1); });
