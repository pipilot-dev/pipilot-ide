// PiPilot IDE Extension: Character Counter
// Shows selection stats in the status bar: chars, words, and lines selected.
// Only visible when text is selected; hides when selection is empty.

(function (PiPilot, bus, api, state, db) {

  var statusBar = document.querySelector('.status-right');
  if (!statusBar) return;

  var item = document.createElement('span');
  item.className = 'status-item';
  item.style.cssText = 'font-size:10px;color:var(--accent, #89b4fa);font-family:var(--font-mono);cursor:default;font-weight:600;';
  item.title = 'Selection stats';
  statusBar.insertBefore(item, statusBar.firstChild);

  var debounceTimer = null;

  function getEditor() {
    return PiPilot && PiPilot.editor && PiPilot.editor.getAce
      ? PiPilot.editor.getAce()
      : null;
  }

  function update() {
    var editor = getEditor();
    if (!editor) { item.textContent = ''; return; }

    var session = editor.getSession();
    if (!session) { item.textContent = ''; return; }

    var selection = editor.getSelection();
    if (!selection) { item.textContent = ''; return; }

    var range = editor.getSelectionRange();
    if (!range) { item.textContent = ''; return; }

    var text = session.getTextRange(range);

    if (!text || text.length === 0) {
      item.textContent = '';
      return;
    }

    var chars = text.length;
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var lines = text.split('\n').length;

    item.textContent = 'Sel: ' + chars + ' chars, ' + words + ' word' + (words !== 1 ? 's' : '') + ', ' + lines + ' line' + (lines !== 1 ? 's' : '');
  }

  function debouncedUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 50);
  }

  function attachToEditor() {
    var editor = getEditor();
    if (!editor) {
      setTimeout(attachToEditor, 1000);
      return;
    }

    var selection = editor.getSelection();
    if (selection) {
      selection.on('changeSelection', debouncedUpdate);
      selection.on('changeCursor', debouncedUpdate);
    }
  }

  // Re-attach when file changes (Ace instance may remain same but good to update)
  bus.on('editor:active-changed', function () {
    item.textContent = '';
    setTimeout(function () { attachToEditor(); update(); }, 100);
  });

  attachToEditor();
  console.log('[ext:character-counter] Character Counter loaded');

})(PiPilot, bus, api, state, db);
