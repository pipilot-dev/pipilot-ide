// PiPilot IDE Extension: Regex Tester
// Sidebar panel with live regex testing — pattern input, test string area,
// highlighted matches, capture groups listing, and match count.

(function (PiPilot, bus, api, state, db) {

  var PANEL_ID = 'regex';
  var PANEL_NAME = 'Regex Tester';
  var ICON_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><text x="3" y="15" font-size="13" font-weight="bold" fill="currentColor" font-family="monospace">.*</text></svg>';

  var panelEl = null;
  var patternInput = null;
  var flagsInput = null;
  var testArea = null;
  var resultArea = null;
  var matchCountEl = null;
  var highlightArea = null;
  var debounceTimer = null;

  function ensureStyles() {
    if (document.getElementById('pipilot-regex-tester-styles')) return;
    var style = document.createElement('style');
    style.id = 'pipilot-regex-tester-styles';
    style.textContent = '\
.regex-tester-input { \
  width: 100%; \
  box-sizing: border-box; \
  background: var(--bg-input, #181825); \
  border: 1px solid var(--border, #444); \
  border-radius: 4px; \
  color: var(--text, #cdd6f4); \
  font-family: var(--font-mono, monospace); \
  font-size: 12px; \
  padding: 6px 8px; \
  outline: none; \
} \
.regex-tester-input:focus { \
  border-color: var(--accent, #89b4fa); \
} \
.regex-tester-textarea { \
  width: 100%; \
  box-sizing: border-box; \
  min-height: 100px; \
  resize: vertical; \
  background: var(--bg-input, #181825); \
  border: 1px solid var(--border, #444); \
  border-radius: 4px; \
  color: var(--text, #cdd6f4); \
  font-family: var(--font-mono, monospace); \
  font-size: 12px; \
  padding: 6px 8px; \
  outline: none; \
  line-height: 1.5; \
} \
.regex-tester-textarea:focus { \
  border-color: var(--accent, #89b4fa); \
} \
.regex-highlight-area { \
  font-family: var(--font-mono, monospace); \
  font-size: 12px; \
  line-height: 1.5; \
  padding: 6px 8px; \
  background: var(--bg-input, #181825); \
  border: 1px solid var(--border, #444); \
  border-radius: 4px; \
  white-space: pre-wrap; \
  word-break: break-all; \
  min-height: 60px; \
  max-height: 200px; \
  overflow-y: auto; \
  color: var(--text, #cdd6f4); \
} \
.regex-match { \
  background: rgba(250, 179, 135, 0.3); \
  border-bottom: 2px solid #fab387; \
  border-radius: 2px; \
  padding: 0 1px; \
} \
.regex-error { \
  color: #f38ba8; \
  font-size: 11px; \
  font-style: italic; \
  padding: 4px 0; \
} \
.regex-match-list { \
  max-height: 200px; \
  overflow-y: auto; \
} \
.regex-match-item { \
  padding: 4px 8px; \
  font-size: 11px; \
  font-family: var(--font-mono, monospace); \
  border-bottom: 1px solid var(--border, #333); \
  color: var(--text, #cdd6f4); \
} \
.regex-match-item:last-child { border-bottom: none; } \
.regex-match-index { \
  color: var(--text-dim, #888); \
  font-size: 10px; \
  margin-right: 6px; \
} \
.regex-match-full { \
  color: #fab387; \
  font-weight: 600; \
} \
.regex-capture-group { \
  display: block; \
  margin-left: 16px; \
  color: var(--accent, #89b4fa); \
  font-size: 10px; \
} \
.regex-count { \
  font-size: 11px; \
  color: var(--text-dim, #888); \
  padding: 4px 0; \
  font-weight: 600; \
} \
.regex-flags-row { \
  display: flex; \
  gap: 6px; \
  align-items: center; \
} \
.regex-flags-input { \
  width: 50px; \
} \
.regex-section-label { \
  font-size: 10px; \
  font-weight: 600; \
  text-transform: uppercase; \
  letter-spacing: 0.5px; \
  color: var(--text-dim, #888); \
  margin: 8px 0 4px; \
} \
';
    document.head.appendChild(style);
  }

  function registerPanel() {
    var activityBar = document.querySelector('.activity-bar');
    var sidebarContainer = document.querySelector('.sidebar');

    if (!activityBar || !sidebarContainer) {
      setTimeout(registerPanel, 1000);
      return;
    }

    // Activity bar button
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.id = 'activity-btn-' + PANEL_ID;
    btn.title = PANEL_NAME;
    btn.innerHTML = ICON_SVG;
    btn.addEventListener('click', function () { togglePanel(); });
    activityBar.appendChild(btn);

    // Panel
    panelEl = document.createElement('div');
    panelEl.id = 'sidebar-panel-' + PANEL_ID;
    panelEl.className = 'sidebar-panel';
    panelEl.style.cssText = 'display:none;flex-direction:column;height:100%;overflow:hidden;';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border, #333);flex-shrink:0;';
    var title = document.createElement('span');
    title.style.cssText = 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim, #888);';
    title.textContent = 'Regex Tester';
    header.appendChild(title);
    panelEl.appendChild(header);

    // Content area
    var content = document.createElement('div');
    content.style.cssText = 'overflow-y:auto;flex:1;padding:8px 12px;';

    // Pattern row
    var patLabel = document.createElement('div');
    patLabel.className = 'regex-section-label';
    patLabel.textContent = 'Pattern';
    content.appendChild(patLabel);

    var patRow = document.createElement('div');
    patRow.className = 'regex-flags-row';

    patternInput = document.createElement('input');
    patternInput.className = 'regex-tester-input';
    patternInput.type = 'text';
    patternInput.placeholder = 'Enter regex pattern...';
    patternInput.style.flex = '1';

    flagsInput = document.createElement('input');
    flagsInput.className = 'regex-tester-input regex-flags-input';
    flagsInput.type = 'text';
    flagsInput.value = 'g';
    flagsInput.placeholder = 'flags';
    flagsInput.title = 'Regex flags (g, i, m, s, u)';

    patRow.appendChild(patternInput);
    patRow.appendChild(flagsInput);
    content.appendChild(patRow);

    // Test string
    var testLabel = document.createElement('div');
    testLabel.className = 'regex-section-label';
    testLabel.textContent = 'Test String';
    content.appendChild(testLabel);

    testArea = document.createElement('textarea');
    testArea.className = 'regex-tester-textarea';
    testArea.placeholder = 'Enter text to test against...';
    content.appendChild(testArea);

    // Match count
    matchCountEl = document.createElement('div');
    matchCountEl.className = 'regex-count';
    content.appendChild(matchCountEl);

    // Highlighted preview
    var hlLabel = document.createElement('div');
    hlLabel.className = 'regex-section-label';
    hlLabel.textContent = 'Matches Highlighted';
    content.appendChild(hlLabel);

    highlightArea = document.createElement('div');
    highlightArea.className = 'regex-highlight-area';
    content.appendChild(highlightArea);

    // Match list
    var matchLabel = document.createElement('div');
    matchLabel.className = 'regex-section-label';
    matchLabel.textContent = 'Match Details';
    content.appendChild(matchLabel);

    resultArea = document.createElement('div');
    resultArea.className = 'regex-match-list';
    content.appendChild(resultArea);

    panelEl.appendChild(content);
    sidebarContainer.appendChild(panelEl);

    // Events
    patternInput.addEventListener('input', scheduleUpdate);
    flagsInput.addEventListener('input', scheduleUpdate);
    testArea.addEventListener('input', scheduleUpdate);
  }

  function togglePanel() {
    if (!panelEl) return;
    var panels = document.querySelectorAll('.sidebar-panel');
    var buttons = document.querySelectorAll('.activity-btn');
    var wasVisible = panelEl.style.display !== 'none';

    for (var i = 0; i < panels.length; i++) panels[i].style.display = 'none';
    for (var j = 0; j < buttons.length; j++) buttons[j].classList.remove('active');

    if (!wasVisible) {
      panelEl.style.display = 'flex';
      var btn = document.getElementById('activity-btn-' + PANEL_ID);
      if (btn) btn.classList.add('active');
      var sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.style.display = '';
      if (patternInput) patternInput.focus();
    } else {
      var sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.style.display = 'none';
    }
  }

  function scheduleUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runTest, 100);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function runTest() {
    if (!patternInput || !testArea || !resultArea || !highlightArea || !matchCountEl) return;

    var pattern = patternInput.value;
    var flags = flagsInput.value || '';
    var testStr = testArea.value;

    // Clear
    resultArea.innerHTML = '';
    highlightArea.innerHTML = '';
    matchCountEl.textContent = '';

    if (!pattern) {
      highlightArea.textContent = testStr || '';
      return;
    }

    // Try to compile regex
    var regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      highlightArea.innerHTML = '<div class="regex-error">Error: ' + escapeHtml(e.message) + '</div>';
      matchCountEl.textContent = '';
      return;
    }

    if (!testStr) {
      matchCountEl.textContent = '0 matches';
      return;
    }

    // Find all matches
    var matches = [];
    var isGlobal = flags.indexOf('g') !== -1;

    if (isGlobal) {
      var m;
      var safeCount = 0;
      regex.lastIndex = 0;
      while ((m = regex.exec(testStr)) !== null && safeCount < 1000) {
        matches.push({
          full: m[0],
          index: m.index,
          end: m.index + m[0].length,
          groups: m.slice(1)
        });
        if (m[0].length === 0) {
          regex.lastIndex++;
        }
        safeCount++;
      }
    } else {
      var m = regex.exec(testStr);
      if (m) {
        matches.push({
          full: m[0],
          index: m.index,
          end: m.index + m[0].length,
          groups: m.slice(1)
        });
      }
    }

    // Count
    matchCountEl.textContent = matches.length + ' match' + (matches.length !== 1 ? 'es' : '');

    // Build highlighted text
    var html = '';
    var lastEnd = 0;
    for (var i = 0; i < matches.length; i++) {
      var mt = matches[i];
      if (mt.index > lastEnd) {
        html += escapeHtml(testStr.substring(lastEnd, mt.index));
      }
      html += '<span class="regex-match">' + escapeHtml(mt.full) + '</span>';
      lastEnd = mt.end;
    }
    if (lastEnd < testStr.length) {
      html += escapeHtml(testStr.substring(lastEnd));
    }
    highlightArea.innerHTML = html;

    // Build match list
    for (var j = 0; j < matches.length; j++) {
      var mItem = matches[j];
      var div = document.createElement('div');
      div.className = 'regex-match-item';

      var idx = document.createElement('span');
      idx.className = 'regex-match-index';
      idx.textContent = '#' + (j + 1) + ' [' + mItem.index + '-' + mItem.end + ']';

      var full = document.createElement('span');
      full.className = 'regex-match-full';
      full.textContent = ' "' + mItem.full + '"';

      div.appendChild(idx);
      div.appendChild(full);

      // Capture groups
      if (mItem.groups && mItem.groups.length > 0) {
        for (var g = 0; g < mItem.groups.length; g++) {
          var grpSpan = document.createElement('span');
          grpSpan.className = 'regex-capture-group';
          grpSpan.textContent = 'Group ' + (g + 1) + ': "' + (mItem.groups[g] != null ? mItem.groups[g] : 'undefined') + '"';
          div.appendChild(grpSpan);
        }
      }

      resultArea.appendChild(div);
    }
  }

  // ── Init ──
  ensureStyles();
  registerPanel();
  console.log('[ext:regex-tester] Regex Tester loaded');

})(PiPilot, bus, api, state, db);
