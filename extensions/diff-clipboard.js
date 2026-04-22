// PiPilot IDE Extension: Diff Clipboard
// mod+shift+v: Read clipboard text and open a diff tab comparing it
// against the current file content (or selection if text is selected).

(function (PiPilot, bus, api, state, db) {

  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+v', function () {
      var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;

      // Read clipboard
      var clipboardPromise;
      if (api && api.clipboard && api.clipboard.readText) {
        clipboardPromise = Promise.resolve(api.clipboard.readText());
      } else if (navigator.clipboard && navigator.clipboard.readText) {
        clipboardPromise = navigator.clipboard.readText();
      } else {
        bus.emit('toast:show', { message: 'Clipboard API not available', type: 'error' });
        return;
      }

      Promise.resolve(clipboardPromise).then(function (clipText) {
        if (!clipText && clipText !== '') {
          bus.emit('toast:show', { message: 'Clipboard is empty', type: 'warn' });
          return;
        }
        // Ensure string
        clipText = typeof clipText === 'string' ? clipText : (clipText && clipText.text ? clipText.text : String(clipText || ''));

        if (!clipText.trim()) {
          bus.emit('toast:show', { message: 'Clipboard is empty', type: 'warn' });
          return;
        }

        // Get current file content or selection
        var originalText = '';
        var tabName = 'Clipboard Diff';
        var language = 'text';

        if (ace) {
          var selected = ace.getSelectedText();
          if (selected && selected.trim()) {
            originalText = selected;
            tabName = 'Selection vs Clipboard';
          } else {
            var session = ace.getSession();
            if (session) {
              originalText = session.getValue() || '';
            }
            var activeFile = PiPilot.editor.getActiveFile ? PiPilot.editor.getActiveFile() : null;
            if (activeFile) {
              var fileName = activeFile.split(/[\\/]/).pop() || 'file';
              tabName = fileName + ' vs Clipboard';
              // Detect language from extension
              var ext = (activeFile.match(/\.([^.]+)$/) || [])[1] || '';
              var langMap = {
                js: 'javascript', jsx: 'javascript', mjs: 'javascript',
                ts: 'typescript', tsx: 'typescript',
                py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
                java: 'java', kt: 'kotlin', cs: 'csharp', swift: 'swift',
                php: 'php', html: 'html', css: 'css', scss: 'scss',
                json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml',
                md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
                c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp'
              };
              language = langMap[ext.toLowerCase()] || ext || 'text';
            }
          }
        }

        // Open diff tab
        if (PiPilot.editor && PiPilot.editor.openDiffTab) {
          PiPilot.editor.openDiffTab({
            name: tabName,
            original: originalText,
            modified: clipText,
            language: language,
            originalTitle: ace && ace.getSelectedText && ace.getSelectedText().trim() ? 'Selection' : 'Current File',
            modifiedTitle: 'Clipboard'
          });
          bus.emit('toast:show', { message: 'Opened diff: ' + tabName, type: 'ok' });
        } else {
          bus.emit('toast:show', { message: 'Diff tab API not available', type: 'error' });
        }
      }).catch(function (err) {
        bus.emit('toast:show', { message: 'Failed to read clipboard: ' + (err.message || err), type: 'error' });
      });
    });
  }

  console.log('[ext:diff-clipboard] loaded');
})(PiPilot, bus, api, state, db);
