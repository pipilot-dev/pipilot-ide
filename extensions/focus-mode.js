// PiPilot IDE Extension: Focus Mode / Pomodoro
// mod+shift+f toggles focus mode. Status bar shows pomodoro timer.
// 25min work / 5min break. Tracks total focus time in db.

(function (PiPilot, bus, api, state, db) {

  var DB_KEY_TOTAL = 'focus-mode:total-minutes';
  var WORK_DURATION = 25 * 60; // 25 minutes in seconds
  var BREAK_DURATION = 5 * 60;  // 5 minutes in seconds

  var isFocusMode = false;
  var timerInterval = null;
  var timerRunning = false;
  var isBreak = false;
  var remainingSeconds = WORK_DURATION;
  var sessionStartTime = null;

  var statusItem = null;
  var dimStyleEl = null;

  function getTotalMinutes() {
    var raw = db.get(DB_KEY_TOTAL);
    return raw ? parseFloat(raw) || 0 : 0;
  }

  function addMinutes(mins) {
    var total = getTotalMinutes() + mins;
    db.set(DB_KEY_TOTAL, String(total));
  }

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatTotalTime() {
    var total = getTotalMinutes();
    if (total < 60) return Math.round(total) + 'm';
    return (total / 60).toFixed(1) + 'h';
  }

  // ── Styles ──
  var style = document.createElement('style');
  style.id = 'focus-mode-styles';
  style.textContent = '\
@keyframes focus-pulse { \
  0% { box-shadow: 0 0 0 0 rgba(86,211,100,0.4); } \
  50% { box-shadow: 0 0 12px 4px rgba(86,211,100,0.15); } \
  100% { box-shadow: 0 0 0 0 rgba(86,211,100,0.4); } \
}\
@keyframes break-pulse { \
  0% { box-shadow: 0 0 0 0 rgba(229,166,57,0.4); } \
  50% { box-shadow: 0 0 16px 6px rgba(229,166,57,0.2); } \
  100% { box-shadow: 0 0 0 0 rgba(229,166,57,0.4); } \
}\
.focus-status-item { \
  display:inline-flex; align-items:center; gap:5px; \
  padding:2px 8px; border-radius:3px; cursor:pointer; \
  font-size:11px; font-family:var(--font-mono,monospace); \
  color:var(--text,#ccc); transition:background 0.2s; \
  margin-left:8px; \
}\
.focus-status-item:hover { background:var(--surface-alt,#2a2a33); }\
.focus-status-item.active { color:#56d364; }\
.focus-status-item.break { color:#e5a639; animation:break-pulse 2s infinite; }\
.focus-dim-overlay { transition:opacity 0.4s ease; }\
';
  document.head.appendChild(style);

  // ── Create dim overlay style element ──
  dimStyleEl = document.createElement('style');
  dimStyleEl.id = 'focus-mode-dim';
  document.head.appendChild(dimStyleEl);

  // ── Status bar item ──
  var statusBar = document.querySelector('.status-right');
  if (statusBar) {
    statusItem = document.createElement('span');
    statusItem.className = 'focus-status-item';
    statusItem.title = 'Focus Mode / Pomodoro\nClick to start/pause\nTotal: ' + formatTotalTime();
    updateStatusDisplay();
    statusItem.addEventListener('click', handleStatusClick);
    statusBar.insertBefore(statusItem, statusBar.firstChild);
  }

  function updateStatusDisplay() {
    if (!statusItem) return;

    var icon = isFocusMode ? (isBreak ? '\u2615' : '\uD83C\uDFAF') : '\uD83C\uDFAF';
    var timeStr = formatTime(remainingSeconds);
    var label = isBreak ? 'BREAK' : 'FOCUS';
    var runIcon = timerRunning ? '\u23F8' : '\u25B6';

    statusItem.innerHTML = icon + ' ' + (isFocusMode ? (label + ' ' + timeStr + ' ' + runIcon) : 'Focus');

    statusItem.className = 'focus-status-item' +
      (isFocusMode ? ' active' : '') +
      (isBreak ? ' break' : '');

    statusItem.title = 'Focus Mode / Pomodoro\n' +
      (isFocusMode ? (timerRunning ? 'Click to pause' : 'Click to start') : 'Click to enable focus mode') +
      '\nTotal focus: ' + formatTotalTime();
  }

  function handleStatusClick(e) {
    e.stopPropagation();

    if (!isFocusMode) {
      enableFocusMode();
      return;
    }

    if (timerRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  // ── Focus mode toggle ──
  function enableFocusMode() {
    isFocusMode = true;
    remainingSeconds = WORK_DURATION;
    isBreak = false;

    // Dim sidebar, bottom panel, activity bar
    dimStyleEl.textContent = '\
.sidebar, .activity-bar, .panel-bottom, .bottom-panel, .terminal-panel { \
  opacity: 0.15 !important; \
  pointer-events: none !important; \
  transition: opacity 0.4s ease !important; \
}\
.editor-area, .editor-container, .ace_editor { \
  animation: focus-pulse 3s ease-in-out 2; \
}\
';

    startTimer();
    updateStatusDisplay();

    if (bus && bus.emit) {
      bus.emit('toast:show', { message: 'Focus mode activated. 25 minutes of deep work!', type: 'ok' });
    }
  }

  function disableFocusMode() {
    // Track time spent
    if (sessionStartTime) {
      var elapsed = (Date.now() - sessionStartTime) / 60000;
      addMinutes(elapsed);
      sessionStartTime = null;
    }

    isFocusMode = false;
    isBreak = false;
    stopTimer();
    remainingSeconds = WORK_DURATION;

    // Remove dimming
    dimStyleEl.textContent = '';

    updateStatusDisplay();

    if (bus && bus.emit) {
      bus.emit('toast:show', {
        message: 'Focus mode ended. Total focus: ' + formatTotalTime(),
        type: 'info'
      });
    }
  }

  function toggleFocusMode() {
    if (isFocusMode) {
      disableFocusMode();
    } else {
      enableFocusMode();
    }
  }

  // ── Timer ──
  function startTimer() {
    if (timerRunning) return;
    timerRunning = true;
    sessionStartTime = sessionStartTime || Date.now();

    timerInterval = setInterval(function () {
      remainingSeconds--;

      if (remainingSeconds <= 0) {
        if (isBreak) {
          // Break finished, start new work session
          isBreak = false;
          remainingSeconds = WORK_DURATION;

          if (bus && bus.emit) {
            bus.emit('toast:show', { message: 'Break over! Back to focused work.', type: 'ok' });
          }
        } else {
          // Work session finished, track time
          addMinutes(WORK_DURATION / 60);

          // Start break
          isBreak = true;
          remainingSeconds = BREAK_DURATION;

          // Update dim style to show break animation
          dimStyleEl.textContent = '\
.sidebar, .activity-bar, .panel-bottom, .bottom-panel, .terminal-panel { \
  opacity: 0.15 !important; \
  pointer-events: none !important; \
  transition: opacity 0.4s ease !important; \
}\
.editor-area, .editor-container, .ace_editor { \
  animation: break-pulse 2s infinite !important; \
}\
';

          if (bus && bus.emit) {
            bus.emit('toast:show', { message: 'Great work! Take a 5 minute break.', type: 'warn' });
          }

          // Reset session timer for next session
          sessionStartTime = Date.now();
        }
      }

      updateStatusDisplay();
    }, 1000);
  }

  function pauseTimer() {
    timerRunning = false;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Track elapsed time on pause
    if (sessionStartTime) {
      var elapsed = (Date.now() - sessionStartTime) / 60000;
      addMinutes(elapsed);
      sessionStartTime = null;
    }

    updateStatusDisplay();
  }

  function stopTimer() {
    timerRunning = false;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ── Register shortcut ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+f', function () {
      toggleFocusMode();
    });
  }

  console.log('[ext:focus-mode] loaded');
})(PiPilot, bus, api, state, db);
