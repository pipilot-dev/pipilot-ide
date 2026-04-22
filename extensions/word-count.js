// PiPilot IDE Extension: Word Count
// Shows word count, character count, and reading time in the status bar.
//
// Extension API: receives (PiPilot, bus, api, state) as arguments.
// - PiPilot: window.PiPilot namespace (editor, chat, sidebar, modal, etc.)
// - bus: event bus for cross-module communication
// - api: window.electronAPI (file system, git, terminal, etc.)
// - state: shared app state (projectPath, activeFile, etc.)

(function (PiPilot, bus, api, state) {
  // Create status bar item
  const statusBar = document.querySelector('.status-right');
  if (!statusBar) return;

  const item = document.createElement('span');
  item.className = 'status-item';
  item.style.cssText = 'font-size:10px;color:var(--text-dim);font-family:var(--font-mono);cursor:default;';
  item.title = 'Word count';
  statusBar.insertBefore(item, statusBar.firstChild);

  function update() {
    const editor = PiPilot.editor?.getAce?.();
    if (!editor) { item.textContent = ''; return; }

    const session = editor.getSession();
    if (!session) { item.textContent = ''; return; }

    const text = session.getValue();
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = session.getLength();
    const readMin = Math.max(1, Math.ceil(words / 200));

    item.textContent = `${words} words  ${lines} lines  ~${readMin}m read`;
  }

  // Update on file switch and content change
  bus.on('editor:active-changed', update);
  bus.on('editor:dirty-changed', update);

  // Also update when Ace content changes (throttled)
  let timer = null;
  bus.on('ace:ready', (ace) => {
    ace.on('change', () => {
      clearTimeout(timer);
      timer = setTimeout(update, 300);
    });
  });

  // Initial update
  setTimeout(update, 500);

  console.log('[ext:word-count] Word Count extension loaded');
})(PiPilot, bus, api, state);
