// renderer/chatdb.js — IndexedDB persistence for chat sessions & messages
(function () {
  const DB_NAME = 'pipilot-chat';
  const DB_VERSION = 1;
  let db = null;

  function openDB() {
    if (db) return Promise.resolve(db);
    const _t0 = performance.now();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('sessions')) {
          const ss = d.createObjectStore('sessions', { keyPath: 'id' });
          ss.createIndex('projectPath', 'projectPath', { unique: false });
          ss.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!d.objectStoreNames.contains('messages')) {
          const ms = d.createObjectStore('messages', { keyPath: 'id' });
          ms.createIndex('sessionId', 'sessionId', { unique: false });
          ms.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        console.log(`[startup] chatDB.openDB took ${(performance.now() - _t0).toFixed(0)}ms`);
        resolve(db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ── Sessions ──

  async function createSession({ id, title, projectPath }) {
    const d = await openDB();
    const now = Date.now();
    const session = { id, title: title || 'New Chat', projectPath: projectPath || null, createdAt: now, updatedAt: now };
    return new Promise((resolve, reject) => {
      const tx = d.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(session);
      tx.oncomplete = () => resolve(session);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getSession(id) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const req = d.transaction('sessions', 'readonly').objectStore('sessions').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function listSessions(projectPath) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const store = d.transaction('sessions', 'readonly').objectStore('sessions');
      const req = store.index('projectPath').getAll(projectPath || undefined);
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function updateSession(id, updates) {
    const d = await openDB();
    const existing = await getSession(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    return new Promise((resolve, reject) => {
      const tx = d.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(updated);
      tx.oncomplete = () => resolve(updated);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteSession(id) {
    const d = await openDB();
    // Delete session
    await new Promise((resolve, reject) => {
      const tx = d.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
    // Delete all messages for this session
    const msgs = await getMessages(id);
    if (msgs.length) {
      const tx2 = d.transaction('messages', 'readwrite');
      const store = tx2.objectStore('messages');
      for (const m of msgs) store.delete(m.id);
      await new Promise((resolve) => { tx2.oncomplete = resolve; });
    }
  }

  // ── Messages ──
  // Each message is stored as:
  // { id, sessionId, role: 'user'|'assistant', timestamp, content (text),
  //   blocks: [...], toolCalls: [...], toolResults: [...], metadata: {...} }
  // This stores EVERYTHING — tool call inputs/outputs, thinking, etc.

  async function addMessage(msg) {
    const d = await openDB();
    const entry = {
      id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      sessionId: msg.sessionId,
      role: msg.role || 'user',
      timestamp: msg.timestamp || Date.now(),
      content: msg.content || '',
      blocks: msg.blocks || [],         // [{ type: 'text'|'thinking'|'tool_call'|'tool_result', ... }]
      toolCalls: msg.toolCalls || [],   // [{ id, name, input, result, isError, status }]
      metadata: msg.metadata || {},      // { attachments, mode, cost, duration, usage, etc }
    };
    return new Promise((resolve, reject) => {
      const tx = d.transaction('messages', 'readwrite');
      tx.objectStore('messages').put(entry);
      tx.oncomplete = () => resolve(entry);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function updateMessage(id, updates) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const store = d.transaction('messages', 'readwrite').objectStore('messages');
      const req = store.get(id);
      req.onsuccess = () => {
        if (!req.result) { resolve(null); return; }
        const updated = { ...req.result, ...updates };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = (e) => reject(e.target.error);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getMessages(sessionId) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const req = d.transaction('messages', 'readonly').objectStore('messages').index('sessionId').getAll(sessionId);
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => a.timestamp - b.timestamp);
        resolve(list);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteMessage(id) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('messages', 'readwrite');
      tx.objectStore('messages').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function clearMessages(sessionId) {
    const msgs = await getMessages(sessionId);
    if (!msgs.length) return;
    const d = await openDB();
    const tx = d.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const m of msgs) store.delete(m.id);
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  }

  // Delete all messages in a session whose timestamp is > the given cutoff
  async function deleteMessagesAfter(sessionId, afterTimestamp) {
    const msgs = await getMessages(sessionId);
    const toDelete = msgs.filter(m => m.timestamp > afterTimestamp);
    if (!toDelete.length) return 0;
    const d = await openDB();
    const tx = d.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const m of toDelete) store.delete(m.id);
    return new Promise((resolve) => { tx.oncomplete = () => resolve(toDelete.length); });
  }

  // ── History for AI context injection ──
  // Returns last N user+assistant message pairs as a prompt context string
  async function getHistoryContext(sessionId, maxPairs = 3, maxMsgLen = 400) {
    const msgs = await getMessages(sessionId);
    const pairs = msgs.filter(m => m.role === 'user' || m.role === 'assistant').slice(-(maxPairs * 2));
    if (!pairs.length) return '';
    return pairs.map(m => {
      const text = (m.content || '').slice(0, maxMsgLen) + ((m.content || '').length > maxMsgLen ? '...[truncated]' : '');
      return `${m.role === 'user' ? 'Human' : 'Assistant'}: ${text}`;
    }).join('\n\n');
  }

  // Expose
  window.PiPilot = window.PiPilot || {};
  window.PiPilot.chatDB = {
    openDB,
    createSession, getSession, listSessions, updateSession, deleteSession,
    addMessage, updateMessage, getMessages, deleteMessage, clearMessages, deleteMessagesAfter,
    getHistoryContext,
  };
})();
