// PiPilot IDE Extension: Word Count
// Shows word count, character count, and reading time in the status bar.

(function (PiPilot, bus, api, state) {
  var statusBar = document.querySelector('.status-right');
  if (!statusBar) return;

  var item = document.createElement('span');
  item.className = 'status-item';
  item.style.cssText = 'font-size:10px;color:var(--text-dim);font-family:var(--font-mono);cursor:default;';
  item.title = 'Word count';
  statusBar.insertBefore(item, statusBar.firstChild);

  function update() {
    var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
    if (!editor) { item.textContent = ''; return; }
    var session = editor.getSession();
    if (!session) { item.textContent = ''; return; }
    var text = session.getValue();
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var lines = session.getLength();
    var readMin = Math.max(1, Math.ceil(words / 200));
    item.textContent = words + ' words  ' + lines + ' lines  ~' + readMin + 'm read';
  }

  // Update on file switch and content change
  bus.on('editor:active-changed', update);
  bus.on('editor:dirty-changed', update);

  // Hook into existing Ace instance for live typing updates
  var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (ace) {
    var timer = null;
    ace.on('change', function () {
      clearTimeout(timer);
      timer = setTimeout(update, 300);
    });
  }

  // Initial update
  setTimeout(update, 500);
  console.log('[ext:word-count] Word Count extension loaded');
})(PiPilot, bus, api, state);
