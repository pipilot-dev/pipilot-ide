# PiPilot IDE Extension API

Build extensions that add features to PiPilot IDE — status bar widgets, sidebar panels, editor commands, AI integrations, and more.

---

## Quick Start

Extensions are single JavaScript files. They run in the renderer process and receive four arguments:

```javascript
(function (PiPilot, bus, api, state) {

  // Add a status bar item
  var statusBar = document.querySelector('.status-right');
  var item = document.createElement('span');
  item.className = 'status-item';
  item.textContent = 'My Extension';
  statusBar.appendChild(item);

  console.log('[my-ext] loaded for project:', state.projectPath);

})(PiPilot, bus, api, state);
```

| Argument | What it is | Use for |
|----------|-----------|---------|
| `PiPilot` | `window.PiPilot` namespace | Editor, chat, sidebar, modal, toast, shortcuts |
| `bus` | Event bus | Listen/emit events across the IDE |
| `api` | `window.electronAPI` | File system, git, terminal, diagnostics, IPC |
| `state` | Shared app state | Read `projectPath`, `activeFile`, `settings` |

Extensions activate immediately on install. No restart required.

---

## Publishing to the Registry

1. Create your `.js` extension file
2. Host it at a public URL (GitHub raw works great)
3. Submit a PR to [`pipilot-dev/pipilot-extensions`](https://github.com/pipilot-dev/pipilot-extensions) adding an entry to `registry.json`:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "One-line description of what it does",
  "version": "1.0.0",
  "author": "Your Name",
  "icon": "⚡",
  "url": "https://raw.githubusercontent.com/you/repo/main/my-extension.js",
  "categories": ["editor"]
}
```

**Categories**: `editor`, `productivity`, `sidebar`, `status-bar`, `css`, `git`, `ai`, `themes`, `terminal`, `diagnostics`

---

## API Reference

### Editor — `PiPilot.editor`

Control the code editor, tabs, and file operations.

| Method | Returns | Description |
|--------|---------|-------------|
| `openFile(path, opts?)` | `void` | Open a file. `opts`: `{ line, col }` |
| `closeFile(path)` | `void` | Close a tab |
| `saveFile(path?)` | `void` | Save current or specified file |
| `saveAllFiles()` | `void` | Save all dirty files |
| `getActiveFile()` | `string\|null` | Path of the currently active file |
| `getDirtyFiles()` | `string[]` | Paths of all unsaved files |
| `getAce()` | `AceEditor` | The Ace editor instance (full Ace API) |
| `getSession(path?)` | `AceSession` | Ace session for a file |
| `setDiagnostics(path, diags)` | `void` | Push error/warning markers to a file |
| `openVirtualTab(opts)` | `void` | Open a custom virtual tab |
| `openDiffTab(opts)` | `void` | Open a side-by-side diff tab |
| `isVirtualTab(id)` | `boolean` | Check if a tab is virtual |

**Opening a file at a specific line:**
```javascript
PiPilot.editor.openFile('/path/to/file.js', { line: 42, col: 10 });
```

**Creating a virtual tab** (custom content, not a real file):
```javascript
PiPilot.editor.openVirtualTab({
  id: 'my-ext://dashboard',
  name: 'Dashboard',
  mount: function (container) {
    container.innerHTML = '<h2>My Dashboard</h2><p>Custom content here</p>';
    // Return a cleanup function (optional)
    return function () { /* cleanup */ };
  }
});
```

**Opening a diff tab:**
```javascript
PiPilot.editor.openDiffTab({
  name: 'Before vs After',
  original: 'old code here',
  modified: 'new code here',
  language: 'javascript',
  originalTitle: 'Before',
  modifiedTitle: 'After',
});
```

**Pushing custom diagnostics** (errors/warnings in the editor gutter):
```javascript
PiPilot.editor.setDiagnostics('/path/to/file.js', [
  { line: 10, startCol: 0, endCol: 15, severity: 1, message: 'Unused variable', code: 'no-unused-vars' },
  { line: 25, startCol: 4, endCol: 20, severity: 2, message: 'Possible null', code: 'null-check' },
]);
// severity: 1 = error (red), 2 = warning (orange), 3 = info (blue)
```

**Using the Ace editor directly:**
```javascript
var ace = PiPilot.editor.getAce();
ace.on('change', function () { /* content changed */ });
ace.getSession().setMode('ace/mode/python');
var selectedText = ace.getSelectedText();
ace.insert('// inserted by extension');
var cursorPos = ace.getCursorPosition(); // { row, column }
```

---

### Chat — `PiPilot.chat`

Interact with the AI chat panel programmatically.

| Method | Returns | Description |
|--------|---------|-------------|
| `focus()` | `void` | Focus the chat input |
| `sendMessage(text)` | `void` | Send a message to the AI agent |
| `newSession(title?)` | `void` | Create a new chat session |
| `stop()` | `void` | Stop the current streaming response |
| `getCurrentSession()` | `string` | Current session ID |
| `loadSession(id)` | `void` | Load a previous session |

**Send a prompt to the AI:**
```javascript
PiPilot.chat.sendMessage('Explain the selected code');
```

**Focus chat with prefilled text (via bus):**
```javascript
bus.emit('chat:focus-with-prompt', 'Fix the bug in auth.js');
```

---

### Sidebar — `PiPilot.sidebar`

| Method | Description |
|--------|-------------|
| `refresh()` | Reload the file tree |
| `switchPanel(name)` | Switch sidebar panel |

**Valid panel names**: `explorer`, `search`, `git`, `outline`, `extensions`, `deploy`, `wiki`

---

### Custom Panels — `PiPilot.panels`

Register a custom sidebar panel that appears when the user switches to it.

```javascript
// Register a custom panel
PiPilot.panels.myPanel = function (container, projectPath) {
  container.innerHTML = '';

  var header = document.createElement('div');
  header.className = 'panel-header';
  header.innerHTML = '<span class="panel-title">My Panel</span>';
  container.appendChild(header);

  var content = document.createElement('div');
  content.className = 'p-section';
  content.innerHTML = '<p>Project: ' + projectPath + '</p>';
  container.appendChild(content);
};

// Switch to your panel
PiPilot.sidebar.switchPanel('myPanel');
```

To add an activity bar button for your panel, append to the activity bar DOM:
```javascript
var actBar = document.getElementById('activity-bar');
var btn = document.createElement('button');
btn.className = 'activity-btn';
btn.dataset.panel = 'myPanel';
btn.title = 'My Panel';
btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>';
btn.addEventListener('click', function () { bus.emit('panel:switch', 'myPanel'); });
// Insert before the settings button (last child)
actBar.insertBefore(btn, actBar.lastElementChild);
```

---

### Modal Dialogs — `PiPilot.modal`

| Method | Returns | Description |
|--------|---------|-------------|
| `prompt(opts)` | `Promise<string\|null>` | Text input dialog |
| `confirm(opts)` | `Promise<boolean>` | Yes/no confirmation |
| `alert(opts)` | `Promise<void>` | Info alert |
| `show(el, opts?)` | `void` | Show custom modal content |

```javascript
// Prompt for text input
var name = await PiPilot.modal.prompt({
  title: 'Enter Name',
  label: 'Project name',
  placeholder: 'my-project',
  defaultValue: ''
});
if (name) console.log('User entered:', name);

// Confirm dialog
var ok = await PiPilot.modal.confirm({
  title: 'Delete file?',
  message: 'This action cannot be undone.',
  danger: true,
  confirmText: 'Delete'
});

// Show custom HTML in a modal
var div = document.createElement('div');
div.innerHTML = '<h2>Custom Modal</h2><p>Any HTML content</p>';
PiPilot.modal.show(div, { title: 'My Modal' });
```

---

### Toast Notifications

```javascript
bus.emit('toast:show', { message: 'File saved!', type: 'ok' });
bus.emit('toast:show', { message: 'Something went wrong', type: 'error' });
bus.emit('toast:show', { message: 'Compiling...', type: 'info' });
bus.emit('toast:show', { message: 'Deprecated API used', type: 'warn' });
```

**Types**: `ok` (green), `error` (red), `info` (blue), `warn` (yellow)

---

### Keyboard Shortcuts — `PiPilot.shortcuts`

```javascript
// Register a custom shortcut
PiPilot.shortcuts.register('mod+shift+w', function () {
  bus.emit('toast:show', { message: 'Custom shortcut fired!', type: 'ok' });
});
```

**Key format**: `mod` = Ctrl on Windows/Linux, Cmd on Mac. Combine with `+`: `mod+shift+p`, `alt+f`, `mod+k`.

---

### Context Menu

Show a custom right-click menu anywhere:

```javascript
document.addEventListener('contextmenu', function (e) {
  if (e.target.closest('.my-extension-area')) {
    e.preventDefault();
    bus.emit('contextmenu:show', {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Do Something', onClick: function () { /* action */ } },
        { type: 'separator' },
        { label: 'Settings', onClick: function () { bus.emit('modal:settings'); } },
        { label: 'Disabled Item', disabled: true },
      ]
    });
  }
});
```

---

### File System — `api.files`

Read, write, and watch files on disk.

| Method | Returns | Description |
|--------|---------|-------------|
| `read(path)` | `{ content, encoding, size, mtime }` | Read file content |
| `write(path, content)` | `{ ok }` | Write file to disk |
| `mkdir(path)` | `{ ok }` | Create directory |
| `delete(path)` | `{ ok }` | Delete file or folder |
| `rename(from, to)` | `{ ok }` | Rename/move file |
| `stat(path)` | `{ size, mtime, exists }` | File info |
| `tree(projectPath)` | `Array` | Full directory tree |
| `listDir(path)` | `Array` | List directory contents |
| `search(projectPath, query, opts)` | `Array` | Full-text search |
| `watch(projectPath, callback)` | `Function` | Watch for file changes (returns unsubscribe) |

```javascript
// Read a file
var result = await api.files.read('/path/to/file.js');
console.log(result.content);

// Write a file
await api.files.write('/path/to/file.js', 'new content');

// Watch for changes
var unwatch = api.files.watch(state.projectPath, function (evt) {
  if (evt.type === 'change') console.log('Changed:', evt.path);
  if (evt.type === 'add') console.log('Created:', evt.path);
  if (evt.type === 'unlink') console.log('Deleted:', evt.path);
});
// Later: unwatch() to stop watching
```

---

### Git — `api.git`

| Method | Description |
|--------|-------------|
| `status(path)` | Get git status (branch, files, staged, modified) |
| `log(path, opts)` | Commit history |
| `diff(path, file, staged)` | Get file diff |
| `add(path, files)` | Stage files |
| `commit(path, message)` | Create commit |
| `push(path, opts)` | Push to remote |
| `pull(path, opts)` | Pull from remote |
| `branches(path)` | List branches |
| `checkout(path, branch)` | Switch branch |
| `createBranch(path, name)` | Create new branch |
| `stash(path, opts)` | Stash changes |
| `clone(url, dir, onProgress)` | Clone repository |
| `init(path)` | Initialize new repo |

```javascript
// Get current branch and status
var status = await api.git.status(state.projectPath);
console.log('Branch:', status.branch);
console.log('Modified files:', status.modified);

// Stage and commit
await api.git.add(state.projectPath, ['src/index.js']);
await api.git.commit(state.projectPath, 'feat: add new feature');
```

---

### Terminal — `api.terminal`

| Method | Description |
|--------|-------------|
| `create(opts)` | Create terminal instance, returns `{ id }` |
| `write(id, data)` | Write input to terminal |
| `resize(id, cols, rows)` | Resize terminal |
| `destroy(id)` | Close terminal |
| `onData(id, handler)` | Listen for terminal output |
| `onExit(id, handler)` | Listen for terminal exit |

```javascript
// Run a command in a new terminal
var term = await api.terminal.create({ cwd: state.projectPath });
api.terminal.write(term.id, 'npm test\n');

// Listen for output
api.terminal.onData(term.id, function (data) {
  console.log('Terminal output:', data);
});
```

---

### Diagnostics — `api.diagnostics`

| Method | Description |
|--------|-------------|
| `start(projectPath)` | Start TypeScript diagnostics |
| `stop()` | Stop diagnostics |
| `run(projectPath)` | Run diagnostics check |
| `onUpdate(handler)` | Listen for diagnostic results |

---

### Checkpoints — `api.checkpoints`

| Method | Description |
|--------|-------------|
| `list(path)` | List all checkpoints |
| `create(path, label)` | Create a ZIP snapshot |
| `restore(path, id)` | Restore from checkpoint |
| `delete(path, id)` | Delete a checkpoint |

---

### Dev Server — `api.devServer`

| Method | Description |
|--------|-------------|
| `start(path, cmd)` | Start dev server |
| `stop(id)` | Stop server |
| `startStatic(path)` | Start static file server |
| `list()` | List running servers |

---

### App / Window — `api`

| Method | Description |
|--------|-------------|
| `pickFolder()` | Native folder picker dialog |
| `pickFile(opts)` | Native file picker dialog |
| `getPlatform()` | OS platform (`win32`, `darwin`, `linux`) |
| `clipboard.readText()` | Read clipboard |
| `clipboard.writeText(text)` | Write clipboard |
| `shell.openExternal(url)` | Open URL in default browser |
| `shell.showItemInFolder(path)` | Reveal in OS file explorer |

---

## Bus Events Reference

### Project Lifecycle

| Event | Payload | When |
|-------|---------|------|
| `project:opened` | `{ path, name }` | Project loaded |
| `project:closed` | `{ path, name }` | Project closed |

### File Events

| Event | Payload | When |
|-------|---------|------|
| `file:open` | `{ path }` | File open requested |
| `file:saved` | `{ path }` | File saved to disk |
| `file:renamed` | `{ from, to }` | File renamed |
| `file:deleted` | `{ path }` | File deleted |
| `file:external-change` | `{ type, path }` | File changed on disk (agent/external). `type`: `add`, `change`, `unlink` |
| `files:refresh` | — | File tree reload requested |

### Editor Events

| Event | Payload | When |
|-------|---------|------|
| `editor:active-changed` | `{ path }` | Active tab switched |
| `editor:dirty-changed` | `{ path, dirty }` | File modified/saved state changed |
| `editor:position` | `{ line, col }` | Cursor position changed |
| `editor:language` | `{ language }` | Language mode changed |
| `ace:ready` | `aceEditor` | Ace editor initialized (fires once on startup) |

### UI Events

| Event | Payload | When |
|-------|---------|------|
| `panel:switch` | `panelName` | Sidebar panel switched |
| `bottom:show` | `tabName` | Bottom panel tab shown (`terminal`, `problems`, `preview`) |
| `toast:show` | `{ message, type }` | Show toast notification |
| `contextmenu:show` | `{ x, y, items }` | Show context menu |
| `contextmenu:hide` | — | Hide context menu |
| `modal:settings` | — | Open settings modal |

### Menu Commands

| Event | When |
|-------|------|
| `menu:save` | Save current file |
| `menu:save-all` | Save all files |
| `menu:toggle-sidebar` | Toggle sidebar visibility |
| `menu:toggle-terminal` | Toggle terminal panel |
| `menu:toggle-chat` | Toggle chat panel |
| `menu:file:new-file` | Create new file |
| `menu:file:open-folder` | Open folder dialog |

### Chat Events

| Event | Payload | When |
|-------|---------|------|
| `chat:send` | — | Send chat message |
| `chat:focus-with-prompt` | `text` | Focus chat input with prefilled text |
| `chat:reveal` | — | Show chat panel |
| `chat:clear` | — | Clear chat history |

### Git Events

| Event | When |
|-------|------|
| `git:changed` | Git status changed (refresh UI) |
| `git:branch-changed` | Branch switched |

### Diagnostics Events

| Event | Payload | When |
|-------|---------|------|
| `diagnostics:set` | `{ path, diagnostics }` | Diagnostics updated for a file |
| `problems:count` | `{ errors, warnings, total }` | Problem count changed |
| `problems:updated` | `{ items, counts, byFile }` | Full diagnostics results |

---

## DOM Structure

Key DOM elements you can query and extend:

| Selector | Description |
|----------|-------------|
| `#ide-root` | Main IDE container |
| `#activity-bar` | Left icon bar (panel switcher) |
| `#side-panel` | Sidebar content area |
| `#tab-bar` | Editor tab bar |
| `#breadcrumb` | File path breadcrumb |
| `#editor-container` | Editor wrapper |
| `#monaco-host` | Ace editor host element |
| `#virtual-host` | Virtual tab content host |
| `#terminal-pane` | Terminal panel |
| `#problems-pane` | Problems panel |
| `#chat-panel` | Chat panel |
| `#chat-input` | Chat text input |
| `#chat-messages` | Chat message list |
| `#statusbar` | Bottom status bar |
| `.status-left` | Status bar left section |
| `.status-right` | Status bar right section |
| `#modal-root` | Modal container |
| `#toast-root` | Toast container |
| `#context-menu-root` | Context menu container |
| `#welcome-screen` | Welcome/start screen |

---

## CSS Variables (Design System)

Use these for consistent theming:

```css
--bg: #16161a          /* App background */
--surface: #1c1c21     /* Panel backgrounds */
--surface-alt: #232329  /* Input/card backgrounds */
--border: #2e2e35      /* Borders */
--accent: #FF6B35      /* Primary accent (orange) */
--text: #b0b0b8        /* Default text */
--text-strong: #e7e7ea  /* Headings, emphasis */
--text-mid: #8a8a94    /* Secondary text */
--text-dim: #6b6b76    /* Muted text */
--error: #e5484d       /* Red */
--warn: #e5a639        /* Yellow */
--ok: #56d364          /* Green */
--info: #58a6ff        /* Blue */
--font-mono: 'Geist Mono', 'Cascadia Code', monospace
--font-sans: 'Segoe UI', system-ui, sans-serif
--radius: 6px
--radius-sm: 3px
```

---

## Example Extensions

### Status Bar Widget

```javascript
(function (PiPilot, bus, api, state) {
  var statusBar = document.querySelector('.status-right');
  var item = document.createElement('span');
  item.className = 'status-item status-item-btn';
  item.textContent = 'Copy Name';
  item.addEventListener('click', function () {
    var file = PiPilot.editor.getActiveFile();
    if (file) {
      var name = file.split(/[\\/]/).pop();
      navigator.clipboard.writeText(name);
      bus.emit('toast:show', { message: 'Copied: ' + name, type: 'ok' });
    }
  });
  statusBar.appendChild(item);
})(PiPilot, bus, api, state);
```

### Custom Sidebar Panel

```javascript
(function (PiPilot, bus, api, state) {
  // Register panel renderer
  PiPilot.panels.bookmarks = function (container, projectPath) {
    container.innerHTML = '';
    var header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = '<span class="panel-title">Bookmarks</span>';
    container.appendChild(header);

    var list = JSON.parse(localStorage.getItem('ext:bookmarks') || '[]');
    var sec = document.createElement('div');
    sec.className = 'p-section';
    if (!list.length) {
      sec.innerHTML = '<div style="color:var(--text-dim);font-size:11px;">No bookmarks yet. Right-click a file to bookmark it.</div>';
    }
    list.forEach(function (b) {
      var row = document.createElement('div');
      row.className = 'connector-card';
      row.style.cursor = 'pointer';
      row.innerHTML = '<div class="info"><div class="name">' + b.name + '</div><div class="desc">' + b.path + '</div></div>';
      row.addEventListener('click', function () { PiPilot.editor.openFile(b.path); });
      sec.appendChild(row);
    });
    container.appendChild(sec);
  };

  // Add activity bar button
  var actBar = document.getElementById('activity-bar');
  var btn = document.createElement('button');
  btn.className = 'activity-btn';
  btn.dataset.panel = 'bookmarks';
  btn.title = 'Bookmarks';
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  btn.addEventListener('click', function () { bus.emit('panel:switch', 'bookmarks'); });
  actBar.insertBefore(btn, actBar.lastElementChild);
})(PiPilot, bus, api, state);
```

### File Watcher Integration

```javascript
(function (PiPilot, bus, api, state) {
  // React to external file changes (agent edits, git operations, etc.)
  bus.on('file:external-change', function (evt) {
    if (evt.type === 'add' && evt.path.endsWith('.test.js')) {
      bus.emit('toast:show', { message: 'New test file: ' + evt.path.split(/[\\/]/).pop(), type: 'info' });
    }
  });

  // React to file saves
  bus.on('file:saved', function (evt) {
    console.log('[my-ext] File saved:', evt.path);
  });
})(PiPilot, bus, api, state);
```

### AI Chat Integration

```javascript
(function (PiPilot, bus, api, state) {
  // Add a keyboard shortcut that sends selected code to chat
  PiPilot.shortcuts.register('mod+shift+e', function () {
    var ace = PiPilot.editor.getAce();
    var selected = ace ? ace.getSelectedText() : '';
    if (selected) {
      PiPilot.chat.sendMessage('Explain this code:\n```\n' + selected + '\n```');
    } else {
      bus.emit('toast:show', { message: 'Select some code first', type: 'warn' });
    }
  });
})(PiPilot, bus, api, state);
```

### Custom Editor Commands

```javascript
(function (PiPilot, bus, api, state) {
  var ace = PiPilot.editor.getAce();
  if (!ace) return;

  // Add a command to sort selected lines
  ace.commands.addCommand({
    name: 'sortLines',
    bindKey: { win: 'Alt-Shift-S', mac: 'Alt-Shift-S' },
    exec: function (editor) {
      var range = editor.getSelectionRange();
      var lines = editor.session.getTextRange(range).split('\n');
      lines.sort();
      editor.session.replace(range, lines.join('\n'));
      bus.emit('toast:show', { message: 'Lines sorted', type: 'ok' });
    }
  });
})(PiPilot, bus, api, state);
```

---

## Best Practices

1. **Wrap in IIFE** — Always use `(function (PiPilot, bus, api, state) { ... })(PiPilot, bus, api, state);` to avoid polluting global scope
2. **Use `var` not `const/let`** — Extensions run inside `new Function()`, older syntax is more reliable
3. **Check before using** — Always null-check: `PiPilot.editor && PiPilot.editor.getAce()` before using APIs
4. **Clean up listeners** — If your extension adds event listeners, consider cleanup for when the extension is disabled
5. **Use CSS variables** — Match the IDE theme using `var(--accent)`, `var(--text)`, etc.
6. **Keep it light** — Extensions run in the main renderer thread. Avoid heavy computation that blocks the UI
7. **Namespace localStorage** — Prefix your keys: `localStorage.setItem('ext:myext:data', ...)`
8. **Log with prefix** — Use `console.log('[ext:name] ...')` for easy debugging
