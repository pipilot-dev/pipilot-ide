// PiPilot IDE Extension: Lorem Ipsum Generator
// Right-click context menu items and shortcut to insert lorem ipsum text.

(function (PiPilot, bus, api, state, db) {
  var editor = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
  if (!editor) return;

  // ── Lorem Ipsum Corpus ──
  var WORDS = [
    'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
    'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
    'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
    'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
    'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
    'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
    'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
    'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'pellentesque', 'habitant',
    'morbi', 'tristique', 'senectus', 'netus', 'malesuada', 'fames', 'ac', 'turpis',
    'egestas', 'integer', 'vitae', 'justo', 'lacus', 'vestibulum', 'rhoncus',
    'volutpat', 'diam', 'maecenas', 'accumsan', 'lacinia', 'blandit', 'ante',
    'nibh', 'praesent', 'feugiat', 'leo', 'vel', 'fringilla', 'porttitor',
    'massa', 'risus', 'at', 'varius', 'tortor', 'condimentum', 'ultricies',
    'elementum', 'eu', 'facilisis', 'ligula', 'urna', 'sollicitudin', 'suscipit',
    'tellus', 'mauris', 'augue', 'neque', 'gravida', 'arcu', 'dictum',
    'nunc', 'mattis', 'eros', 'donec', 'pulvinar', 'sapien', 'cras',
    'fermentum', 'posuere', 'pretium', 'pharetra', 'viverra', 'sem', 'scelerisque',
    'convallis', 'ornare', 'imperdiet', 'tincidunt', 'hendrerit', 'lectus',
    'placerat', 'dapibus', 'dignissim', 'sodales', 'congue', 'quisque',
    'sagittis', 'purus', 'iaculis', 'libero', 'aliquet', 'porta',
    'quam', 'bibendum', 'orci', 'nisl', 'tempus', 'interdum', 'vulputate',
    'mi', 'felis', 'nec', 'luctus', 'molestie', 'etiam', 'hac', 'habitasse',
    'platea', 'dictumst', 'fusce', 'proin', 'finibus', 'auctor', 'vehicula',
    'maximus', 'cursus', 'commodi', 'nam', 'consequatur', 'adipisci'
  ];

  var FIRST_SENTENCE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomWord() {
    return WORDS[randomInt(0, WORDS.length - 1)];
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function generateWords(count) {
    var result = [];
    for (var i = 0; i < count; i++) {
      result.push(randomWord());
    }
    return result.join(' ');
  }

  function generateSentence() {
    var len = randomInt(6, 14);
    var words = [];
    for (var i = 0; i < len; i++) {
      words.push(randomWord());
    }
    return capitalize(words.join(' ')) + '.';
  }

  function generateParagraph(isFirst) {
    var sentenceCount = randomInt(4, 8);
    var sentences = [];
    for (var i = 0; i < sentenceCount; i++) {
      if (i === 0 && isFirst) {
        sentences.push(FIRST_SENTENCE);
      } else {
        sentences.push(generateSentence());
      }
    }
    return sentences.join(' ');
  }

  function insertText(text) {
    var ace = PiPilot.editor && PiPilot.editor.getAce ? PiPilot.editor.getAce() : null;
    if (!ace) return;
    ace.insert(text);
    ace.focus();
  }

  // ── Keyboard shortcut: Mod+Shift+L for paragraph ──
  if (PiPilot.shortcuts && PiPilot.shortcuts.register) {
    PiPilot.shortcuts.register('mod+shift+l', function () {
      insertText(generateParagraph(true));
      bus.emit('toast:show', { message: 'Lorem ipsum paragraph inserted', type: 'ok' });
    });
  }

  // ── Context menu ──
  var menuEl = null;

  function dismissMenu() {
    if (menuEl) {
      try { menuEl.remove(); } catch (e) {}
      menuEl = null;
    }
    document.removeEventListener('mousedown', onOutsideClick, true);
    document.removeEventListener('keydown', onEscKey, true);
  }

  function onOutsideClick(e) {
    if (menuEl && !menuEl.contains(e.target)) {
      dismissMenu();
    }
  }

  function onEscKey(e) {
    if (e.key === 'Escape') {
      dismissMenu();
    }
  }

  function showContextMenu(x, y) {
    dismissMenu();

    menuEl = document.createElement('div');
    menuEl.style.cssText = [
      'position:fixed', 'z-index:999999',
      'background:var(--surface,#1c1c21)',
      'border:1px solid var(--border,#2e2e35)',
      'border-radius:6px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.5)',
      'padding:4px 0',
      'min-width:200px',
      'font-size:12px',
      'color:var(--text,#b0b0b8)',
      'font-family:var(--font-sans, system-ui, sans-serif)'
    ].join(';');
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';

    var items = [
      {
        label: 'Lorem: Insert Paragraph',
        shortcut: 'Mod+Shift+L',
        action: function () { insertText(generateParagraph(true)); bus.emit('toast:show', { message: 'Paragraph inserted', type: 'ok' }); }
      },
      {
        label: 'Lorem: Insert Sentence',
        action: function () { insertText(generateSentence()); bus.emit('toast:show', { message: 'Sentence inserted', type: 'ok' }); }
      },
      {
        label: 'Lorem: Insert Words (10)',
        action: function () { insertText(generateWords(10)); bus.emit('toast:show', { message: '10 words inserted', type: 'ok' }); }
      }
    ];

    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 14px;cursor:pointer;';

        var labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        row.appendChild(labelSpan);

        if (item.shortcut) {
          var shortcutSpan = document.createElement('span');
          shortcutSpan.style.cssText = 'font-size:10px;color:var(--text-dim,#555);margin-left:16px;';
          shortcutSpan.textContent = item.shortcut;
          row.appendChild(shortcutSpan);
        }

        row.addEventListener('mouseenter', function () { row.style.background = 'var(--surface-alt,#232329)'; });
        row.addEventListener('mouseleave', function () { row.style.background = ''; });
        row.addEventListener('click', function () {
          dismissMenu();
          item.action();
        });

        menuEl.appendChild(row);
      })(items[i]);
    }

    document.body.appendChild(menuEl);

    // Adjust position if overflowing
    var rect = menuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuEl.style.left = (window.innerWidth - rect.width - 8) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menuEl.style.top = (window.innerHeight - rect.height - 8) + 'px';
    }

    setTimeout(function () {
      document.addEventListener('mousedown', onOutsideClick, true);
      document.addEventListener('keydown', onEscKey, true);
    }, 0);
  }

  // ── Hook into editor's context menu ──
  var editorEl = editor.container;
  if (editorEl) {
    editorEl.addEventListener('contextmenu', function (e) {
      // We need to intercept the context menu. We'll add our items to any existing
      // context menu, or show our own. Wait a tick to see if a PiPilot menu appears.
      var existingMenu = document.querySelector('[data-pipilot-context-menu]');

      // If the native context menu is prevented by Ace, we show our menu
      // alongside Ace's or standalone
      setTimeout(function () {
        // Check if another menu was just created
        var menus = document.querySelectorAll('div[style*="z-index"][style*="position: fixed"], div[style*="z-index"][style*="position:fixed"]');
        var aceMenu = null;
        for (var i = 0; i < menus.length; i++) {
          if (menus[i] !== menuEl && menus[i].textContent.indexOf('Lorem') === -1) {
            aceMenu = menus[i];
            break;
          }
        }

        if (aceMenu) {
          // Append a separator and our items to the existing menu
          var sep = document.createElement('div');
          sep.style.cssText = 'height:1px;background:var(--border,#2e2e35);margin:4px 0;';
          aceMenu.appendChild(sep);

          var loremItems = [
            { label: 'Insert Lorem Paragraph', action: function () { insertText(generateParagraph(true)); } },
            { label: 'Insert Lorem Sentence', action: function () { insertText(generateSentence()); } },
            { label: 'Insert Lorem Words (10)', action: function () { insertText(generateWords(10)); } }
          ];

          for (var j = 0; j < loremItems.length; j++) {
            (function (item) {
              var row = document.createElement('div');
              row.style.cssText = 'display:flex;align-items:center;padding:5px 14px;cursor:pointer;';
              row.textContent = item.label;
              row.addEventListener('mouseenter', function () { row.style.background = 'var(--surface-alt,#232329)'; });
              row.addEventListener('mouseleave', function () { row.style.background = ''; });
              row.addEventListener('click', function () {
                aceMenu.remove();
                item.action();
                bus.emit('toast:show', { message: 'Lorem ipsum inserted', type: 'ok' });
              });
              aceMenu.appendChild(row);
            })(loremItems[j]);
          }
        } else {
          // Show our own context menu
          showContextMenu(e.clientX, e.clientY);
        }
      }, 50);
    });
  }

  console.log('[ext:lorem-ipsum] Lorem Ipsum Generator extension loaded');
})(PiPilot, bus, api, state, db);
