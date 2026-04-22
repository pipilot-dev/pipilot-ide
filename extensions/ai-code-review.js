// PiPilot IDE Extension: AI Code Review
// Select code -> right-click "AI Review" or mod+shift+r.
// Sends to Groq API, shows results in virtual tab with severity markers.

(function (PiPilot, bus, api, state, db) {

  var DB_KEY = 'ai-code-review:groq-key';
  var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  var MODEL = 'llama-3.1-8b-instant';

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getApiKey() {
    return db.get(DB_KEY) || '';
  }

  function setApiKey(key) {
    db.set(DB_KEY, key);
  }

  // ── Prompt for API key ──
  function promptForKey(callback) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;justify-content:center;align-items:center;';

    var dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--surface,#1e1e26);border:1px solid var(--border,#333);border-radius:8px;padding:24px;width:420px;font-family:var(--font-sans);color:var(--text,#ccc);box-shadow:0 8px 32px rgba(0,0,0,0.5);';

    dialog.innerHTML = '<h3 style="margin:0 0 8px;font-size:15px;color:var(--text-strong,#fff);">Groq API Key Required</h3>' +
      '<p style="margin:0 0 16px;font-size:12px;color:var(--text-dim,#888);">Enter your Groq API key to use AI Code Review. Get one at <span style="color:var(--accent,#6c8cff);">console.groq.com</span></p>' +
      '<input id="groq-key-input" type="password" placeholder="gsk_..." style="width:100%;box-sizing:border-box;padding:8px 12px;background:var(--bg,#141417);border:1px solid var(--border,#444);border-radius:4px;color:var(--text,#ccc);font-size:13px;font-family:var(--font-mono,monospace);outline:none;margin-bottom:16px;" />' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button id="groq-key-cancel" style="padding:6px 16px;background:none;border:1px solid var(--border,#444);border-radius:4px;color:var(--text-dim,#888);cursor:pointer;font-size:12px;">Cancel</button>' +
        '<button id="groq-key-save" style="padding:6px 16px;background:var(--accent,#6c8cff);border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:12px;font-weight:500;">Save & Review</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var input = dialog.querySelector('#groq-key-input');
    var cancelBtn = dialog.querySelector('#groq-key-cancel');
    var saveBtn = dialog.querySelector('#groq-key-save');

    if (input) input.focus();

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    if (cancelBtn) cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    if (saveBtn) saveBtn.addEventListener('click', function () {
      var key = input ? input.value.trim() : '';
      if (!key) return;
      setApiKey(key);
      close();
      if (callback) callback(key);
    });

    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var key = input.value.trim();
        if (!key) return;
        setApiKey(key);
        close();
        if (callback) callback(key);
      } else if (e.key === 'Escape') {
        close();
      }
    });
  }

  // ── Call Groq API ──
  function callGroq(code, apiKey, callback) {
    var prompt = 'Review this code for bugs, performance, security issues. Be concise.\n' +
      'Format each finding as:\n' +
      'SEVERITY: bug|perf|security\n' +
      'TITLE: short title\n' +
      'CODE: the relevant code snippet\n' +
      'DESCRIPTION: explanation\n' +
      '---\n\n' +
      'Code to review:\n```\n' + code + '\n```';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', GROQ_URL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if (xhr.status === 200) {
        try {
          var resp = JSON.parse(xhr.responseText);
          var content = resp.choices && resp.choices[0] && resp.choices[0].message
            ? resp.choices[0].message.content : '';
          callback(null, content);
        } catch (e) {
          callback('Failed to parse response: ' + e.message);
        }
      } else if (xhr.status === 401) {
        callback('Invalid API key. Please update your Groq API key.');
        setApiKey('');
      } else {
        callback('API error (HTTP ' + xhr.status + '): ' + xhr.responseText);
      }
    };

    xhr.onerror = function () {
      callback('Network error. Check your connection.');
    };

    try {
      xhr.send(JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000
      }));
    } catch (e) {
      callback('Request failed: ' + e.message);
    }
  }

  // ── Parse findings from response ──
  function parseFindings(text) {
    var findings = [];
    if (!text) return findings;

    var sections = text.split(/---+/);
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i].trim();
      if (!section) continue;

      var severity = 'info';
      var title = '';
      var code = '';
      var description = '';

      var sevMatch = section.match(/SEVERITY:\s*(bug|perf|performance|security)/i);
      if (sevMatch) {
        var sev = sevMatch[1].toLowerCase();
        if (sev === 'bug') severity = 'bug';
        else if (sev === 'perf' || sev === 'performance') severity = 'perf';
        else if (sev === 'security') severity = 'security';
      }

      var titleMatch = section.match(/TITLE:\s*(.+)/i);
      if (titleMatch) title = titleMatch[1].trim();

      var codeMatch = section.match(/CODE:\s*`*([^`\n]+(?:\n[^`\n]+)*)`*/i);
      if (codeMatch) code = codeMatch[1].trim();
      // Also try code blocks
      var codeBlockMatch = section.match(/```[\s\S]*?\n([\s\S]*?)```/);
      if (codeBlockMatch && !code) code = codeBlockMatch[1].trim();

      var descMatch = section.match(/DESCRIPTION:\s*([\s\S]+?)(?=\n(?:SEVERITY|TITLE|CODE):|$)/i);
      if (descMatch) description = descMatch[1].trim();

      // Fallback: if no structured format, treat whole section as a finding
      if (!title && !description && section.length > 10) {
        description = section;
        title = section.split('\n')[0].substring(0, 60);
      }

      if (title || description) {
        findings.push({ severity: severity, title: title, code: code, description: description });
      }
    }

    // If no findings parsed, wrap entire response as one
    if (findings.length === 0 && text.length > 10) {
      findings.push({ severity: 'info', title: 'Review Results', code: '', description: text });
    }

    return findings;
  }

  // ── Show results in virtual tab ──
  function showResults(code, findings, error) {
    if (!PiPilot.editor || !PiPilot.editor.openVirtualTab) return;

    PiPilot.editor.openVirtualTab({
      id: 'ext://ai-code-review',
      name: 'AI Code Review',
      mount: function (container) {
        container.innerHTML = '';
        container.style.cssText = 'overflow:auto;padding:24px 32px;font-family:var(--font-sans);color:var(--text,#ccc);background:var(--bg,#141417);';

        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'max-width:800px;margin:0 auto;';

        // Header
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:20px;';
        header.innerHTML = '<h2 style="margin:0;font-size:18px;color:var(--text-strong,#fff);">AI Code Review</h2>' +
          '<span style="font-size:12px;color:var(--text-dim,#888);">Powered by Groq</span>';
        wrapper.appendChild(header);

        if (error) {
          var errEl = document.createElement('div');
          errEl.style.cssText = 'padding:16px;background:#e5484d22;border:1px solid #e5484d44;border-radius:6px;color:#e5484d;font-size:13px;';
          errEl.textContent = error;
          wrapper.appendChild(errEl);

          // Show button to set API key
          var keyBtn = document.createElement('button');
          keyBtn.style.cssText = 'margin-top:12px;padding:6px 16px;background:var(--accent,#6c8cff);border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:12px;';
          keyBtn.textContent = 'Set API Key';
          keyBtn.addEventListener('click', function () { promptForKey(null); });
          wrapper.appendChild(keyBtn);
        } else {
          // Severity icons
          var sevIcons = { bug: '\uD83D\uDD34', perf: '\uD83D\uDFE1', security: '\uD83D\uDFE0', info: '\uD83D\uDD35' };
          var sevLabels = { bug: 'Bug', perf: 'Performance', security: 'Security', info: 'Info' };
          var sevColors = { bug: '#e5484d', perf: '#e5a639', security: '#f0883e', info: '#58a6ff' };

          // Summary
          var summary = document.createElement('div');
          summary.style.cssText = 'display:flex;gap:16px;margin-bottom:20px;padding:12px 16px;background:var(--surface,#1e1e26);border-radius:6px;';
          var counts = { bug: 0, perf: 0, security: 0, info: 0 };
          for (var c = 0; c < findings.length; c++) {
            counts[findings[c].severity] = (counts[findings[c].severity] || 0) + 1;
          }
          var summaryHtml = '';
          var sevKeys = ['bug', 'perf', 'security', 'info'];
          for (var sk = 0; sk < sevKeys.length; sk++) {
            if (counts[sevKeys[sk]] > 0) {
              summaryHtml += '<span style="display:flex;align-items:center;gap:4px;font-size:13px;">' +
                sevIcons[sevKeys[sk]] + ' ' + counts[sevKeys[sk]] + ' ' + sevLabels[sevKeys[sk]] + '</span>';
            }
          }
          if (!summaryHtml) summaryHtml = '<span style="color:var(--text-dim,#888);font-size:13px;">No issues found!</span>';
          summary.innerHTML = summaryHtml;
          wrapper.appendChild(summary);

          // Reviewed code
          var codeBlock = document.createElement('details');
          codeBlock.style.cssText = 'margin-bottom:20px;';
          codeBlock.innerHTML = '<summary style="cursor:pointer;font-size:12px;color:var(--text-dim,#888);padding:8px 0;">Reviewed Code (' + code.split('\n').length + ' lines)</summary>' +
            '<pre style="background:var(--surface,#1e1e26);border:1px solid var(--border,#333);border-radius:4px;padding:12px;font-size:12px;font-family:var(--font-mono,monospace);overflow-x:auto;color:var(--text,#ccc);margin:8px 0 0;">' + escapeHtml(code) + '</pre>';
          wrapper.appendChild(codeBlock);

          // Findings
          for (var f = 0; f < findings.length; f++) {
            var finding = findings[f];
            var card = document.createElement('div');
            card.style.cssText = 'margin-bottom:12px;background:var(--surface,#1e1e26);border:1px solid var(--border,#333);border-left:3px solid ' + (sevColors[finding.severity] || '#555') + ';border-radius:4px;padding:14px 16px;';

            var cardHeader = document.createElement('div');
            cardHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
            cardHeader.innerHTML = '<span style="font-size:16px;">' + (sevIcons[finding.severity] || '') + '</span>' +
              '<span style="font-weight:600;font-size:13px;color:var(--text-strong,#fff);">' + escapeHtml(finding.title) + '</span>' +
              '<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:' + (sevColors[finding.severity] || '#555') + '22;color:' + (sevColors[finding.severity] || '#888') + ';">' + (sevLabels[finding.severity] || '') + '</span>';
            card.appendChild(cardHeader);

            if (finding.code) {
              var codeSnippet = document.createElement('pre');
              codeSnippet.style.cssText = 'background:var(--bg,#141417);border:1px solid var(--border,#333);border-radius:3px;padding:8px 10px;font-size:11px;font-family:var(--font-mono,monospace);overflow-x:auto;color:#e5a639;margin:0 0 8px;';
              codeSnippet.textContent = finding.code;
              card.appendChild(codeSnippet);
            }

            if (finding.description) {
              var desc = document.createElement('p');
              desc.style.cssText = 'margin:0;font-size:12px;color:var(--text,#ccc);line-height:1.6;';
              desc.textContent = finding.description;
              card.appendChild(desc);
            }

            wrapper.appendChild(card);
          }
        }

        container.appendChild(wrapper);
      }
    });
  }

  // ── Main review function ──
  function doReview() {
    var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
    if (!ace) {
      if (bus && bus.emit) bus.emit('toast:show', { message: 'No editor available', type: 'warn' });
      return;
    }

    var selected = ace.getSelectedText();
    if (!selected || !selected.trim()) {
      if (bus && bus.emit) bus.emit('toast:show', { message: 'Select code to review', type: 'warn' });
      return;
    }

    var code = selected.trim();
    var apiKey = getApiKey();

    if (!apiKey) {
      promptForKey(function (key) {
        if (key) performReview(code, key);
      });
      return;
    }

    performReview(code, apiKey);
  }

  function performReview(code, apiKey) {
    if (bus && bus.emit) bus.emit('toast:show', { message: 'Sending code for AI review...', type: 'info' });

    callGroq(code, apiKey, function (err, response) {
      if (err) {
        showResults(code, [], err);
        return;
      }

      var findings = parseFindings(response);
      showResults(code, findings, null);

      if (bus && bus.emit) {
        bus.emit('toast:show', {
          message: 'Review complete: ' + findings.length + ' finding(s)',
          type: findings.length > 0 ? 'warn' : 'ok'
        });
      }
    });
  }

  // ── Register shortcut ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+r', function () {
      doReview();
    });
  }

  // ── Right-click context menu ──
  if (bus && bus.on) {
    // Listen for editor context menu to inject our item
    var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
    if (ace) {
      ace.container.addEventListener('contextmenu', function (e) {
        var selected = ace.getSelectedText();
        if (!selected || !selected.trim()) return;

        e.preventDefault();
        e.stopPropagation();

        if (bus && bus.emit) {
          bus.emit('contextmenu:show', {
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: '\uD83D\uDD0D AI Code Review', action: function () { doReview(); } },
              { type: 'separator' },
              { label: 'Copy', action: function () { document.execCommand('copy'); } },
              { label: 'Cut', action: function () { document.execCommand('cut'); } },
              { label: 'Paste', action: function () { document.execCommand('paste'); } }
            ]
          });
        }
      });
    }
  }

  console.log('[ext:ai-code-review] loaded');
})(PiPilot, bus, api, state, db);
