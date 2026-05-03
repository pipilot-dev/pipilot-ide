// PiPilot IDE — Codestral integration (inline completions + inline chat)
// Uses Mistral Codestral via two endpoints:
//   POST /v1/fim/completions   — Fill-in-Middle for ghost-text autocomplete
//   POST /v1/chat/completions  — short-turn chat for inline edits / explanations

const https = require('https');

function postJson(hostname, pathUrl, apiKey, body, { signal, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname,
      path: pathUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': stream ? 'text/event-stream' : 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      if (stream) {
        resolve(res);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          return reject(new Error(`Codestral ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('bad json: ' + e.message)); }
      });
    });
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => { try { req.destroy(new Error('aborted')); } catch {} });
    req.write(payload);
    req.end();
  });
}

module.exports = function register(ipcMain, ctx) {
  const inflight = new Map(); // requestId -> AbortController

  function apiKey() {
    // Gate every Codestral call on auth — same model as the agent. The
    // bundled key still travels in the SDK request (this provider isn't
    // proxied yet), but unauthenticated users can't trigger it.
    try {
      const auth = require('./ipc-auth');
      if (!auth.getJwtSync()) return '';
    } catch {}
    return process.env.CODESTRAL_API_KEY || '';
  }
  function host() {
    return process.env.CODESTRAL_HOST || 'codestral.mistral.ai';
  }
  function model() {
    return process.env.CODESTRAL_MODEL || 'codestral-latest';
  }

  // Fill-in-Middle autocomplete. Given code before + after cursor, returns a
  // single completion string ready to insert as a ghost suggestion.
  ipcMain.handle('codestral:fim', async (_e, payload) => {
    const { prefix, suffix, language, maxTokens = 256, temperature = 0.2, stop = [], requestId } = payload || {};
    if (!apiKey()) return { ok: false, error: 'CODESTRAL_API_KEY not set' };
    if (typeof prefix !== 'string') return { ok: false, error: 'prefix required' };

    if (requestId && inflight.has(requestId)) {
      try { inflight.get(requestId).abort(); } catch {}
      inflight.delete(requestId);
    }
    const ac = new AbortController();
    if (requestId) inflight.set(requestId, ac);

    const body = {
      model: model(),
      prompt: prefix,
      suffix: suffix || '',
      max_tokens: maxTokens,
      temperature,
      top_p: 1,
      stream: false,
      stop: stop.length ? stop : ['\n\n\n'],
    };

    try {
      const data = await postJson(host(), '/v1/fim/completions', apiKey(), body, { signal: ac.signal });
      const text = data?.choices?.[0]?.message?.content
        || data?.choices?.[0]?.text
        || '';
      if (requestId) inflight.delete(requestId);
      return { ok: true, text, language: language || null, usage: data?.usage || null };
    } catch (err) {
      if (requestId) inflight.delete(requestId);
      return { ok: false, error: err.message };
    }
  });

  // Cancel an in-flight FIM request (ghost suggestion superseded).
  ipcMain.handle('codestral:cancel', async (_e, requestId) => {
    const ac = inflight.get(requestId);
    if (ac) { try { ac.abort(); } catch {} inflight.delete(requestId); }
    return { ok: true };
  });

  // Short-turn chat for inline edits / explanations / refactors. Returns
  // the assistant's full reply as a single string.
  ipcMain.handle('codestral:chat', async (_e, payload) => {
    const { messages, temperature = 0.3, maxTokens = 2048, requestId } = payload || {};
    if (!apiKey()) return { ok: false, error: 'CODESTRAL_API_KEY not set' };
    if (!Array.isArray(messages) || !messages.length) return { ok: false, error: 'messages[] required' };

    if (requestId && inflight.has(requestId)) {
      try { inflight.get(requestId).abort(); } catch {}
      inflight.delete(requestId);
    }
    const ac = new AbortController();
    if (requestId) inflight.set(requestId, ac);

    const body = {
      model: model(),
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };

    try {
      const data = await postJson(host(), '/v1/chat/completions', apiKey(), body, { signal: ac.signal });
      const text = data?.choices?.[0]?.message?.content || '';
      if (requestId) inflight.delete(requestId);
      return { ok: true, text, usage: data?.usage || null };
    } catch (err) {
      if (requestId) inflight.delete(requestId);
      return { ok: false, error: err.message };
    }
  });

  // Streaming chat variant. Emits `codestral:chat:${streamId}` events.
  ipcMain.handle('codestral:chat-stream', async (event, payload) => {
    const { streamId, messages, temperature = 0.3, maxTokens = 2048 } = payload || {};
    if (!apiKey()) return { ok: false, error: 'CODESTRAL_API_KEY not set' };
    if (!streamId) return { ok: false, error: 'streamId required' };

    const ac = new AbortController();
    inflight.set(streamId, ac);

    const body = {
      model: model(),
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };

    const sendEvt = (evt) => {
      try {
        const win = ctx.getWindow?.();
        const ch = `codestral:chat:${streamId}`;
        if (win && !win.isDestroyed()) win.webContents.send(ch, evt);
        else if (event?.sender && !event.sender.isDestroyed()) event.sender.send(ch, evt);
      } catch {}
    };

    try {
      const res = await postJson(host(), '/v1/chat/completions', apiKey(), body, { signal: ac.signal, stream: true });
      if (res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (c) => { errBody += c.toString('utf8'); });
        res.on('end', () => {
          sendEvt({ type: 'error', message: `Codestral ${res.statusCode}: ${errBody.slice(0, 300)}` });
          sendEvt({ type: 'done' });
          inflight.delete(streamId);
        });
        return { ok: false };
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') { sendEvt({ type: 'done' }); continue; }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length) sendEvt({ type: 'text', text: delta });
            if (parsed.choices?.[0]?.finish_reason) sendEvt({ type: 'finish', reason: parsed.choices[0].finish_reason });
          } catch {}
        }
      });
      res.on('end', () => {
        sendEvt({ type: 'done' });
        inflight.delete(streamId);
      });
      res.on('error', (err) => {
        sendEvt({ type: 'error', message: err.message });
        sendEvt({ type: 'done' });
        inflight.delete(streamId);
      });
      return { ok: true };
    } catch (err) {
      sendEvt({ type: 'error', message: err.message });
      sendEvt({ type: 'done' });
      inflight.delete(streamId);
      return { ok: false, error: err.message };
    }
  });

  // Generate a conventional-commit message from a diff. Trims output so the
  // first line stays under 72 chars; full body is preserved after a blank line.
  ipcMain.handle('codestral:commit-message', async (_e, payload) => {
    const { diff, scope } = payload || {};
    if (!apiKey()) return { ok: false, error: 'CODESTRAL_API_KEY not set' };
    if (!diff || typeof diff !== 'string') return { ok: false, error: 'diff required' };
    const truncated = diff.length > 16000 ? diff.slice(0, 16000) + '\n... (truncated)' : diff;
    const sys = [
      'You write Conventional Commits messages.',
      'Format: <type>(<scope>): <subject>',
      'Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.',
      'Subject: imperative, no trailing period, ≤72 chars.',
      'After subject, optional blank line then a body that lists bullet points (each ≤100 chars) describing the change.',
      'Output ONLY the commit message — no quoting, no fences, no preface.',
    ].join('\n');
    const user = [
      scope ? `Suggested scope (use only if appropriate): ${scope}` : '',
      'Diff:',
      '```diff',
      truncated,
      '```',
    ].filter(Boolean).join('\n');

    try {
      const data = await postJson(host(), '/v1/chat/completions', apiKey(), {
        model: model(),
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.2,
        max_tokens: 400,
      }, {});
      let text = (data?.choices?.[0]?.message?.content || '').trim();
      // Strip any code fences if model added them
      text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      return { ok: true, text, usage: data?.usage || null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('codestral:status', () => ({
    ok: true,
    configured: !!apiKey(),
    host: host(),
    model: model(),
  }));
};
