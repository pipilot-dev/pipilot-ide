// PiPilot IDE Extension: Custom AI Chat Panel
// A full-featured chat panel with pluggable AI provider and file system tool calling.
//
// Features:
// - Bring your own API provider (OpenAI, Gemini, Groq, Ollama, Mistral, etc.)
// - Tool calling: read, write, search, list, edit files in current project
// - Streaming responses with markdown rendering
// - Activity bar button + sidebar panel
// - Editor context awareness (current file, selection, cursor position)
//
// Configuration: set your provider in the CONFIG object below.

(function (PiPilot, bus, api, state, db) {

  // ═══════════════════════════════════════════════════════════
  // CONFIGURATION — change these to use your preferred provider
  // ═══════════════════════════════════════════════════════════
  var CONFIG = {
    // OpenAI-compatible endpoint (works with OpenAI, Groq, Mistral, Ollama, LM Studio, etc.)
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '', // Set your API key here or leave empty to prompt on first use
    model: 'llama-3.3-70b-versatile',
    name: 'Custom AI', // Display name in the UI
    icon: '🤖',
    systemPrompt: 'You are a helpful coding assistant integrated into PiPilot IDE. You have access to file system tools to read, write, search, and edit files in the user\'s project. Always use tools to examine files before making changes. Be concise and accurate.',
    maxTokens: 4096,
    temperature: 0.3,
  };

  // ═══════════════════════════════════════════════════════════
  // TOOL DEFINITIONS — file system tools for the AI agent
  // ═══════════════════════════════════════════════════════════
  var TOOLS = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file at the given path (relative to project root)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to project root' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file (creates or overwrites)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to project root' },
            content: { type: 'string', description: 'Full file content to write' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Replace a specific string in a file with new content',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to project root' },
            old_string: { type: 'string', description: 'Exact string to find and replace' },
            new_string: { type: 'string', description: 'Replacement string' }
          },
          required: ['path', 'old_string', 'new_string']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and folders in a directory',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to project root (use "." for root)' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for text/regex pattern across project files. Returns matching lines with file paths and line numbers.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (text or regex pattern)' },
            file_pattern: { type: 'string', description: 'Optional glob pattern to filter files (e.g. "*.ts", "src/**/*.js")' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_editor_context',
        description: 'Get the currently active file content, selection, cursor position, and open file list',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];

  // ═══════════════════════════════════════════════════════════
  // TOOL EXECUTION
  // ═══════════════════════════════════════════════════════════
  function resolvePath(relPath) {
    var root = state.projectPath;
    if (!root) return relPath;
    var sep = root.indexOf('/') >= 0 ? '/' : '\\';
    var clean = relPath.replace(/^[./\\]+/, '');
    return root + sep + clean;
  }

  async function executeTool(name, args) {
    try {
      switch (name) {
        case 'read_file': {
          var result = await api.files.read(resolvePath(args.path));
          if (result && result.binary) return 'Binary file, cannot display content.';
          var content = typeof result === 'string' ? result : (result && result.content) || '';
          return content.length > 50000 ? content.slice(0, 50000) + '\n...(truncated)' : content;
        }
        case 'write_file': {
          await api.files.write(resolvePath(args.path), args.content);
          PiPilot.sidebar.refresh();
          return 'File written successfully: ' + args.path;
        }
        case 'edit_file': {
          var file = await api.files.read(resolvePath(args.path));
          var fileContent = typeof file === 'string' ? file : (file && file.content) || '';
          if (fileContent.indexOf(args.old_string) === -1) {
            return 'Error: old_string not found in ' + args.path;
          }
          var newContent = fileContent.replace(args.old_string, args.new_string);
          await api.files.write(resolvePath(args.path), newContent);
          return 'File edited successfully: ' + args.path;
        }
        case 'list_directory': {
          var dirPath = args.path === '.' ? state.projectPath : resolvePath(args.path);
          var entries = await api.files.listDir(dirPath);
          if (!entries || !entries.length) return 'Empty directory or not found.';
          return entries.map(function (e) {
            return (e.type === 'dir' ? '📁 ' : '📄 ') + e.name;
          }).join('\n');
        }
        case 'search_files': {
          var searchResult = await api.files.search(state.projectPath, args.query, {
            glob: args.file_pattern || '',
            caseSensitive: false,
            maxResults: 30,
          });
          var results = (searchResult && searchResult.results) || searchResult || [];
          if (!results.length) return 'No matches found for: ' + args.query;
          return results.slice(0, 30).map(function (r) {
            return r.file + ':' + (r.line || '') + ' ' + (r.match || r.text || '').trim();
          }).join('\n');
        }
        case 'get_editor_context': {
          var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
          var activeFile = PiPilot.editor.getActiveFile() || 'none';
          var info = { activeFile: activeFile };
          if (ace) {
            info.cursorLine = ace.getCursorPosition().row + 1;
            info.cursorCol = ace.getCursorPosition().column + 1;
            var sel = ace.getSelectedText();
            if (sel) info.selection = sel.length > 2000 ? sel.slice(0, 2000) + '...' : sel;
            info.totalLines = ace.session.getLength();
          }
          var dirty = PiPilot.editor.getDirtyFiles ? PiPilot.editor.getDirtyFiles() : [];
          if (dirty.length) info.unsavedFiles = dirty;
          return JSON.stringify(info, null, 2);
        }
        default:
          return 'Unknown tool: ' + name;
      }
    } catch (err) {
      return 'Tool error: ' + (err.message || err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // API COMMUNICATION
  // ═══════════════════════════════════════════════════════════
  var messages = [];
  var isStreaming = false;

  // Load chat history from SQLite
  if (db) {
    db.get('messages').then(function (saved) {
      if (Array.isArray(saved)) messages = saved;
    });
  }

  function saveMessages() {
    if (db) db.set('messages', messages).catch(function () {});
  }

  var cachedApiKey = CONFIG.apiKey || '';
  var apiKeyLoaded = false;

  async function ensureApiKeyLoaded() {
    if (apiKeyLoaded || cachedApiKey) return;
    apiKeyLoaded = true;
    if (db) {
      try {
        var stored = await db.get('apiKey');
        if (stored) cachedApiKey = stored;
      } catch (e) {}
    }
  }

  // Pre-load key immediately
  ensureApiKeyLoaded();

  async function sendToApi(onChunk, onToolCall, onDone) {
    await ensureApiKeyLoaded();
    var apiKey = cachedApiKey;
    if (!apiKey) {
      apiKey = await promptApiKey();
      if (!apiKey) { onDone('No API key provided'); return; }
    }

    var body = {
      model: CONFIG.model,
      messages: [{ role: 'system', content: CONFIG.systemPrompt }].concat(messages),
      tools: TOOLS,
      max_tokens: CONFIG.maxTokens,
      temperature: CONFIG.temperature,
      stream: true,
    };

    try {
      var resp = await fetch(CONFIG.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        var errText = await resp.text();
        onDone('API error ' + resp.status + ': ' + errText.slice(0, 200));
        return;
      }

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var fullContent = '';
      var toolCalls = [];

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        var lines = buffer.split('\n');
        buffer = lines.pop();

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data: ')) continue;
          var data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            var parsed = JSON.parse(data);
            var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            if (!delta) continue;

            if (delta.content) {
              fullContent += delta.content;
              onChunk(delta.content);
            }

            if (delta.tool_calls) {
              for (var t = 0; t < delta.tool_calls.length; t++) {
                var tc = delta.tool_calls[t];
                var idx = tc.index || 0;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = { id: tc.id || '', name: '', arguments: '' };
                }
                if (tc.function) {
                  if (tc.function.name) toolCalls[idx].name = tc.function.name;
                  if (tc.function.arguments) toolCalls[idx].arguments += tc.function.arguments;
                }
              }
            }
          } catch (e) { /* skip unparseable lines */ }
        }
      }

      // Handle tool calls
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: fullContent || null, tool_calls: toolCalls.map(function (tc, i) {
          return { id: tc.id || ('call_' + Date.now() + '_' + i), type: 'function', function: { name: tc.name, arguments: tc.arguments } };
        })});

        for (var j = 0; j < toolCalls.length; j++) {
          var call = toolCalls[j];
          var toolArgs = {};
          try { toolArgs = JSON.parse(call.arguments); } catch (e) {}

          onToolCall(call.name, toolArgs);
          var toolResult = await executeTool(call.name, toolArgs);

          messages.push({
            role: 'tool',
            tool_call_id: call.id || ('call_' + Date.now() + '_' + j),
            content: toolResult,
          });
        }

        // Continue conversation after tool results
        await sendToApi(onChunk, onToolCall, onDone);
        return;
      }

      if (fullContent) {
        messages.push({ role: 'assistant', content: fullContent });
      }
      saveMessages();
      onDone(null);

    } catch (err) {
      onDone('Request failed: ' + (err.message || err));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // UI RENDERING
  // ═══════════════════════════════════════════════════════════
  var panelStyles = document.createElement('style');
  panelStyles.textContent = '\
.ext-chat-wrap { display:flex; flex-direction:column; height:100%; }\
.ext-chat-header { padding:8px 12px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px; flex-shrink:0; }\
.ext-chat-header-title { font-size:12px; font-weight:600; color:var(--text-strong); }\
.ext-chat-header-model { font-size:9px; color:var(--text-dim); font-family:var(--font-mono); }\
.ext-chat-header-actions { margin-left:auto; display:flex; gap:4px; }\
.ext-chat-messages { flex:1; overflow-y:auto; padding:10px 12px; min-height:0; }\
.ext-chat-msg { margin-bottom:12px; font-size:12px; line-height:1.5; }\
.ext-chat-msg.user { color:var(--text); padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-left:2px solid var(--accent); border-radius:4px; white-space:pre-wrap; }\
.ext-chat-msg.assistant { color:var(--text); }\
.ext-chat-msg.assistant .md-body { font-size:12px; }\
.ext-chat-msg.assistant .md-body p { margin:0 0 6px; }\
.ext-chat-msg.assistant .md-body pre { background:var(--surface-alt); border:1px solid var(--border); border-radius:4px; padding:8px; margin:6px 0; overflow-x:auto; }\
.ext-chat-msg.assistant .md-body code:not(pre code) { background:var(--surface-alt); padding:1px 4px; border-radius:3px; font-size:11px; }\
.ext-chat-msg.error { color:var(--error); font-size:11px; }\
.ext-chat-tool { font-size:10px; color:var(--text-dim); font-family:var(--font-mono); padding:3px 8px; margin:4px 0; background:var(--surface-alt); border-radius:3px; border-left:2px solid var(--info); }\
.ext-chat-compose { padding:8px 10px; border-top:1px solid var(--border); flex-shrink:0; display:flex; gap:6px; }\
.ext-chat-input { flex:1; resize:none; min-height:36px; max-height:120px; background:var(--surface-alt); border:1px solid var(--border); border-radius:4px; padding:8px; color:var(--text); font-size:12px; font-family:var(--font-sans); outline:none; }\
.ext-chat-input:focus { border-color:var(--accent); }\
.ext-chat-send { background:var(--accent); color:white; border:none; border-radius:4px; padding:0 12px; cursor:pointer; font-size:11px; font-weight:600; }\
.ext-chat-send:disabled { opacity:0.4; cursor:not-allowed; }\
.ext-chat-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; flex:1; color:var(--text-dim); text-align:center; padding:24px; }\
.ext-chat-empty-icon { font-size:32px; margin-bottom:8px; }\
.ext-chat-empty-title { font-size:13px; color:var(--text-mid); font-weight:600; margin-bottom:4px; }\
.ext-chat-empty-sub { font-size:11px; }\
';
  document.head.appendChild(panelStyles);

  // Panel renderer
  PiPilot.panels.customAiChat = function (container, projectPath) {
    container.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'ext-chat-wrap';

    // Header
    var header = document.createElement('div');
    header.className = 'ext-chat-header';
    header.innerHTML = '<span class="ext-chat-header-title">' + CONFIG.icon + ' ' + CONFIG.name + '</span>' +
      '<span class="ext-chat-header-model">' + CONFIG.model + '</span>' +
      '<div class="ext-chat-header-actions">' +
        '<button class="icon-btn" title="Clear chat" id="ext-chat-clear" style="font-size:11px;">Clear</button>' +
        '<button class="icon-btn" title="Settings" id="ext-chat-settings" style="font-size:11px;">Settings</button>' +
      '</div>';
    wrap.appendChild(header);

    // Messages area
    var messagesEl = document.createElement('div');
    messagesEl.className = 'ext-chat-messages';
    wrap.appendChild(messagesEl);

    // Compose bar
    var compose = document.createElement('div');
    compose.className = 'ext-chat-compose';
    var input = document.createElement('textarea');
    input.className = 'ext-chat-input';
    input.placeholder = 'Ask ' + CONFIG.name + '...';
    input.rows = 1;
    var sendBtn = document.createElement('button');
    sendBtn.className = 'ext-chat-send';
    sendBtn.textContent = 'Send';
    compose.appendChild(input);
    compose.appendChild(sendBtn);
    wrap.appendChild(compose);

    container.appendChild(wrap);

    // Render existing messages
    function renderMessages() {
      messagesEl.innerHTML = '';
      if (!messages.length) {
        messagesEl.innerHTML = '<div class="ext-chat-empty">' +
          '<div class="ext-chat-empty-icon">' + CONFIG.icon + '</div>' +
          '<div class="ext-chat-empty-title">' + CONFIG.name + '</div>' +
          '<div class="ext-chat-empty-sub">Ask anything. I can read, search, and edit files in your project.</div>' +
          '</div>';
        return;
      }
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (m.role === 'system' || m.role === 'tool') continue;
        var div = document.createElement('div');
        div.className = 'ext-chat-msg ' + m.role;
        if (m.role === 'user') {
          div.textContent = m.content;
        } else if (m.role === 'assistant' && m.content) {
          if (window.marked) {
            try {
              div.innerHTML = '<div class="md-body">' + window.marked.parse(m.content) + '</div>';
            } catch (e) { div.textContent = m.content; }
          } else {
            div.textContent = m.content;
          }
        }
        if (m.tool_calls && m.tool_calls.length) {
          for (var t = 0; t < m.tool_calls.length; t++) {
            var tc = m.tool_calls[t];
            var toolDiv = document.createElement('div');
            toolDiv.className = 'ext-chat-tool';
            var toolArgs = '';
            try { toolArgs = JSON.parse(tc.function.arguments); toolArgs = toolArgs.path || toolArgs.query || ''; } catch (e) {}
            toolDiv.textContent = '⚡ ' + tc.function.name + (toolArgs ? ' → ' + toolArgs : '');
            div.appendChild(toolDiv);
          }
        }
        messagesEl.appendChild(div);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Streaming message element
    var streamingEl = null;

    function startStreamingMessage() {
      streamingEl = document.createElement('div');
      streamingEl.className = 'ext-chat-msg assistant';
      streamingEl.innerHTML = '<div class="md-body" style="color:var(--text-dim);">Thinking...</div>';
      messagesEl.appendChild(streamingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function appendStreamChunk(text) {
      if (!streamingEl) return;
      var body = streamingEl.querySelector('.md-body');
      if (!body) return;
      if (body.textContent === 'Thinking...') body.textContent = '';
      if (!streamingEl._fullText) streamingEl._fullText = '';
      streamingEl._fullText += text;
      if (window.marked) {
        try { body.innerHTML = window.marked.parse(streamingEl._fullText); } catch (e) { body.textContent = streamingEl._fullText; }
      } else {
        body.textContent = streamingEl._fullText;
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showToolCall(name, args) {
      var div = document.createElement('div');
      div.className = 'ext-chat-tool';
      var argStr = args.path || args.query || '';
      div.textContent = '⚡ ' + name + (argStr ? ' → ' + argStr : '');
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Send message
    async function send() {
      var text = input.value.trim();
      if (!text || isStreaming) return;

      // Auto-inject editor context for first message or if @ is used
      if (text.indexOf('@file') >= 0 || text.indexOf('@selection') >= 0) {
        var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
        if (ace) {
          var activeFile = PiPilot.editor.getActiveFile() || '';
          if (text.indexOf('@file') >= 0 && activeFile) {
            var fileResult = await api.files.read(activeFile);
            var fileContent = typeof fileResult === 'string' ? fileResult : (fileResult && fileResult.content) || '';
            text = text.replace(/@file/g, '') + '\n\nCurrent file (' + activeFile.split(/[\\/]/).pop() + '):\n```\n' + fileContent.slice(0, 10000) + '\n```';
          }
          if (text.indexOf('@selection') >= 0) {
            var sel = ace.getSelectedText() || '';
            text = text.replace(/@selection/g, '') + '\n\nSelected code:\n```\n' + sel.slice(0, 5000) + '\n```';
          }
        }
      }

      messages.push({ role: 'user', content: text });
      saveMessages();
      input.value = '';
      input.style.height = 'auto';
      renderMessages();

      isStreaming = true;
      sendBtn.disabled = true;
      sendBtn.textContent = '...';
      startStreamingMessage();

      await sendToApi(
        function (chunk) { appendStreamChunk(chunk); },
        function (name, args) { showToolCall(name, args); },
        function (error) {
          streamingEl = null;
          isStreaming = false;
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
          if (error) {
            var errDiv = document.createElement('div');
            errDiv.className = 'ext-chat-msg error';
            errDiv.textContent = error;
            messagesEl.appendChild(errDiv);
          }
          renderMessages();
        }
      );
    }

    // Event handlers
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Clear button
    var clearBtn = wrap.querySelector('#ext-chat-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      messages = [];
      saveMessages();
      renderMessages();
    });

    // Settings button — change API key
    var settingsBtn = wrap.querySelector('#ext-chat-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', async function () {
      await promptApiKey();
      bus.emit('toast:show', { message: 'API key updated', type: 'ok' });
    });

    renderMessages();
    input.focus();
  };

  // ═══════════════════════════════════════════════════════════
  // ACTIVITY BAR BUTTON
  // ═══════════════════════════════════════════════════════════
  var actBar = document.getElementById('activity-bar');
  if (actBar) {
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.dataset.panel = 'customAiChat';
    btn.title = CONFIG.name;
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>';
    btn.addEventListener('click', function () { bus.emit('panel:switch', 'customAiChat'); });
    // Insert before settings (last button)
    actBar.insertBefore(btn, actBar.lastElementChild);
  }

  console.log('[ext:custom-ai-chat] ' + CONFIG.name + ' extension loaded (' + CONFIG.model + ')');

})(PiPilot, bus, api, state, db);
