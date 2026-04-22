// PiPilot IDE Extension: API Playground
// Sidebar panel with HTTP client: method, URL, headers, body, send, response viewer.
// Saves recent requests in db.

(function (PiPilot, bus, api, state, db) {

  var MAX_RECENT = 20;

  // ── Register sidebar panel ──
  if (PiPilot.panels) {
    PiPilot.panels.apiTest = function (container, projectPath) {
      container.innerHTML = '';
      renderPanel(container);
    };
  }

  // ── Activity bar button ──
  var actBar = document.getElementById('activity-bar');
  if (actBar) {
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.dataset.panel = 'apiTest';
    btn.title = 'API Playground';
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></svg>';
    btn.addEventListener('click', function () { bus.emit('panel:switch', 'apiTest'); });
    actBar.insertBefore(btn, actBar.lastElementChild);
  }

  // ── Styles ──
  var style = document.createElement('style');
  style.textContent = '\
.apip-panel { padding: 8px 10px; font-family: var(--font-sans); font-size: 12px; color: var(--text); } \
.apip-panel label { display: block; color: var(--text-mid); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 3px 0; } \
.apip-panel select, .apip-panel input, .apip-panel textarea { \
  width: 100%; box-sizing: border-box; background: var(--surface-alt); color: var(--text); \
  border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 5px 7px; \
  font-family: var(--font-mono); font-size: 11px; outline: none; } \
.apip-panel select:focus, .apip-panel input:focus, .apip-panel textarea:focus { border-color: var(--accent); } \
.apip-panel textarea { resize: vertical; min-height: 60px; } \
.apip-row { display: flex; gap: 6px; } \
.apip-row select { width: 100px; flex-shrink: 0; } \
.apip-row input { flex: 1; } \
.apip-send { \
  width: 100%; margin-top: 10px; padding: 7px; background: var(--accent); color: #fff; \
  border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; font-weight: 600; } \
.apip-send:hover { opacity: 0.9; } \
.apip-send:disabled { opacity: 0.5; cursor: not-allowed; } \
.apip-resp { margin-top: 12px; } \
.apip-resp-status { font-weight: 700; font-size: 13px; margin-bottom: 6px; } \
.apip-resp-body { \
  background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius-sm); \
  padding: 8px; font-family: var(--font-mono); font-size: 11px; max-height: 400px; overflow: auto; \
  white-space: pre-wrap; word-break: break-all; } \
.apip-resp-headers { \
  font-family: var(--font-mono); font-size: 10px; color: var(--text-dim); margin-top: 6px; \
  max-height: 120px; overflow: auto; white-space: pre-wrap; } \
.apip-recent { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 8px; } \
.apip-recent-item { \
  padding: 4px 6px; cursor: pointer; border-radius: var(--radius-sm); font-size: 11px; \
  display: flex; gap: 6px; align-items: center; overflow: hidden; } \
.apip-recent-item:hover { background: var(--surface-alt); } \
.apip-method-badge { \
  font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 2px; \
  color: #fff; flex-shrink: 0; text-transform: uppercase; } \
';
  document.head.appendChild(style);

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function methodColor(m) {
    var map = { GET: '#56d364', POST: '#58a6ff', PUT: '#e5a639', DELETE: '#e5484d', PATCH: '#bc8cff' };
    return map[m] || '#8b949e';
  }

  function renderPanel(container) {
    var panel = document.createElement('div');
    panel.className = 'apip-panel';

    // Header
    var header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = '<span class="panel-title">API Playground</span>';
    container.appendChild(header);

    // Method + URL row
    var lbl1 = document.createElement('label');
    lbl1.textContent = 'Request';
    panel.appendChild(lbl1);

    var row = document.createElement('div');
    row.className = 'apip-row';

    var methodSel = document.createElement('select');
    ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      methodSel.appendChild(opt);
    });
    row.appendChild(methodSel);

    var urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'https://api.example.com/endpoint';
    row.appendChild(urlInput);
    panel.appendChild(row);

    // Headers
    var lblH = document.createElement('label');
    lblH.textContent = 'Headers (key: value, one per line)';
    panel.appendChild(lblH);

    var headersArea = document.createElement('textarea');
    headersArea.rows = 3;
    headersArea.placeholder = 'Content-Type: application/json\nAuthorization: Bearer token';
    panel.appendChild(headersArea);

    // Body
    var lblB = document.createElement('label');
    lblB.textContent = 'Body (POST/PUT/PATCH)';
    panel.appendChild(lblB);

    var bodyArea = document.createElement('textarea');
    bodyArea.rows = 4;
    bodyArea.placeholder = '{"key": "value"}';
    panel.appendChild(bodyArea);

    // Show/hide body based on method
    function toggleBody() {
      var m = methodSel.value;
      var show = m === 'POST' || m === 'PUT' || m === 'PATCH';
      lblB.style.display = show ? '' : 'none';
      bodyArea.style.display = show ? '' : 'none';
    }
    methodSel.addEventListener('change', toggleBody);
    toggleBody();

    // Send button
    var sendBtn = document.createElement('button');
    sendBtn.className = 'apip-send';
    sendBtn.textContent = 'Send Request';
    panel.appendChild(sendBtn);

    // Response area
    var respDiv = document.createElement('div');
    respDiv.className = 'apip-resp';
    respDiv.style.display = 'none';
    panel.appendChild(respDiv);

    // Recent requests
    var recentDiv = document.createElement('div');
    recentDiv.className = 'apip-recent';
    panel.appendChild(recentDiv);

    container.appendChild(panel);

    // Load recent
    loadRecent(recentDiv, methodSel, urlInput, headersArea, bodyArea);

    // ── Send handler ──
    sendBtn.addEventListener('click', function () {
      var method = methodSel.value;
      var url = urlInput.value.trim();
      if (!url) {
        bus.emit('toast:show', { message: 'Enter a URL', type: 'warn' });
        return;
      }

      // Parse headers
      var headers = {};
      var headerLines = headersArea.value.split('\n');
      for (var i = 0; i < headerLines.length; i++) {
        var line = headerLines[i].trim();
        if (!line) continue;
        var colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          var key = line.substring(0, colonIdx).trim();
          var val = line.substring(colonIdx + 1).trim();
          if (key) headers[key] = val;
        }
      }

      var fetchOpts = { method: method, headers: headers };
      if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && bodyArea.value.trim()) {
        fetchOpts.body = bodyArea.value;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
      respDiv.style.display = 'none';

      var startTime = Date.now();

      fetch(url, fetchOpts).then(function (resp) {
        var elapsed = Date.now() - startTime;
        var statusCode = resp.status;
        var statusText = resp.statusText;
        var respHeaders = '';
        try {
          resp.headers.forEach(function (v, k) {
            respHeaders += k + ': ' + v + '\n';
          });
        } catch (e) {}

        return resp.text().then(function (bodyText) {
          return { status: statusCode, statusText: statusText, headers: respHeaders, body: bodyText, elapsed: elapsed };
        });
      }).then(function (result) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Request';

        // Display response
        respDiv.style.display = 'block';
        var statusColor = result.status < 300 ? 'var(--ok)' : (result.status < 400 ? 'var(--warn)' : 'var(--error)');

        var bodyDisplay = result.body;
        try {
          var parsed = JSON.parse(result.body);
          bodyDisplay = JSON.stringify(parsed, null, 2);
        } catch (e) {}

        respDiv.innerHTML = '<div class="apip-resp-status" style="color:' + statusColor + ';">' +
          result.status + ' ' + escapeHtml(result.statusText) +
          ' <span style="color:var(--text-dim);font-weight:400;font-size:11px;">(' + result.elapsed + 'ms)</span></div>' +
          '<div class="apip-resp-body">' + escapeHtml(bodyDisplay) + '</div>' +
          '<details style="margin-top:6px;"><summary style="cursor:pointer;color:var(--text-dim);font-size:10px;">Response Headers</summary>' +
          '<div class="apip-resp-headers">' + escapeHtml(result.headers) + '</div></details>';

        // Save to recent
        saveRecent(method, url, headersArea.value, bodyArea.value, result.status, recentDiv, methodSel, urlInput, headersArea, bodyArea);

      }).catch(function (err) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Request';
        respDiv.style.display = 'block';
        respDiv.innerHTML = '<div class="apip-resp-status" style="color:var(--error);">Error</div>' +
          '<div class="apip-resp-body">' + escapeHtml(err.message || String(err)) + '</div>';
      });
    });
  }

  function saveRecent(method, url, headers, body, status, recentDiv, methodSel, urlInput, headersArea, bodyArea) {
    db.get('recentRequests').then(function (recent) {
      recent = recent || [];
      // Add to front
      recent.unshift({
        method: method,
        url: url,
        headers: headers,
        body: body,
        status: status,
        time: Date.now()
      });
      // Limit
      if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
      return db.set('recentRequests', recent).then(function () {
        loadRecent(recentDiv, methodSel, urlInput, headersArea, bodyArea);
      });
    }).catch(function () {});
  }

  function loadRecent(recentDiv, methodSel, urlInput, headersArea, bodyArea) {
    db.get('recentRequests').then(function (recent) {
      if (!recent || !recent.length) {
        recentDiv.innerHTML = '<div style="color:var(--text-dim);font-size:11px;">No recent requests</div>';
        return;
      }
      var html = '<label style="display:block;color:var(--text-mid);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Recent</label>';
      for (var i = 0; i < recent.length; i++) {
        var r = recent[i];
        var truncUrl = r.url.length > 40 ? r.url.substring(0, 40) + '...' : r.url;
        html += '<div class="apip-recent-item" data-idx="' + i + '">' +
          '<span class="apip-method-badge" style="background:' + methodColor(r.method) + ';">' + r.method + '</span>' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);">' + escapeHtml(truncUrl) + '</span>' +
          '<span style="color:var(--text-dim);margin-left:auto;flex-shrink:0;">' + (r.status || '') + '</span>' +
          '</div>';
      }
      recentDiv.innerHTML = html;

      // Click handlers
      var items = recentDiv.querySelectorAll('.apip-recent-item');
      for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', (function (idx) {
          return function () {
            var r = recent[idx];
            if (!r) return;
            methodSel.value = r.method;
            urlInput.value = r.url;
            headersArea.value = r.headers || '';
            bodyArea.value = r.body || '';
            methodSel.dispatchEvent(new Event('change'));
          };
        })(parseInt(items[j].getAttribute('data-idx'), 10)));
      }
    }).catch(function () {});
  }

  console.log('[ext:api-playground] loaded');
})(PiPilot, bus, api, state, db);
