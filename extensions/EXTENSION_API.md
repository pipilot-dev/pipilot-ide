# PiPilot IDE Extension API

## How Extensions Work

Extensions are single JavaScript files that run in the renderer process. On load, they receive four arguments:

```javascript
(function (PiPilot, bus, api, state) {
  // Your extension code here
})(PiPilot, bus, api, state);
```

| Argument | Description |
|----------|-------------|
| `PiPilot` | `window.PiPilot` — editor, chat, sidebar, modal, toast, shortcuts |
| `bus` | Event bus — `on(event, fn)`, `off(event, fn)`, `emit(event, data)` |
| `api` | `window.electronAPI` — files, git, terminal, diagnostics, speech, etc. |
| `state` | Shared state — `projectPath`, `activeFile`, `openFiles`, `settings` |

## Publishing an Extension

1. Create a `.js` file following the pattern above
2. Host it on GitHub (or any public URL)
3. Submit a PR to `pipilot-dev/pipilot-ide` adding an entry to `extensions/registry.json`:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "What it does",
  "version": "1.0.0",
  "author": "Your Name",
  "icon": "⚡",
  "url": "https://raw.githubusercontent.com/you/repo/main/extension.js",
  "categories": ["editor", "productivity"]
}
```

## Available APIs

### Editor (`PiPilot.editor`)
- `openFile(path)` — Open file in editor
- `closeFile(path)` — Close tab
- `saveFile(path?)` — Save file
- `getActiveFile()` — Current file path
- `getAce()` — Ace editor instance
- `openVirtualTab({ id, name, mount })` — Custom tab
- `openDiffTab({ name, original, modified })` — Diff view
- `setDiagnostics(path, diagnostics)` — Push error markers

### Chat (`PiPilot.chat`)
- `focus()` — Focus chat input
- `sendMessage(text)` — Send message to AI
- `newSession()` — New chat session
- `stop()` — Stop streaming

### Sidebar (`PiPilot.sidebar`)
- `refresh()` — Reload file tree
- `switchPanel(name)` — Switch panel

### Panels (`PiPilot.panels`)
Register a custom sidebar panel:
```javascript
PiPilot.panels.myPanel = function(container, projectPath) {
  container.innerHTML = '<h3>My Panel</h3>';
};
```

### Modal (`PiPilot.modal`)
- `prompt({ title, label })` — Text input dialog
- `confirm({ title, message })` — Yes/no dialog

### Toast
```javascript
bus.emit('toast:show', { message: 'Hello!', type: 'ok' });
```

### Shortcuts (`PiPilot.shortcuts`)
```javascript
PiPilot.shortcuts.register('mod+shift+w', () => {
  console.log('Custom shortcut fired!');
});
```

### Context Menu
```javascript
bus.emit('contextmenu:show', {
  x: event.clientX, y: event.clientY,
  items: [{ label: 'My Action', onClick: () => {} }]
});
```

## Key Bus Events

| Event | Payload | When |
|-------|---------|------|
| `project:opened` | `{ path, name }` | Project loaded |
| `project:closed` | `{ path, name }` | Project closed |
| `file:open` | `{ path }` | File opened |
| `file:saved` | `{ path }` | File saved |
| `file:external-change` | `{ type, path }` | File changed on disk |
| `editor:active-changed` | `{ path }` | Active tab switched |
| `editor:dirty-changed` | `{ path, dirty }` | File modified state |
| `editor:position` | `{ line, col }` | Cursor moved |
| `panel:switch` | `panelName` | Sidebar panel switched |
| `toast:show` | `{ message, type }` | Show notification |

## Example Extension

```javascript
// Adds a "Copy File Name" button to the status bar
(function (PiPilot, bus, api, state) {
  const statusBar = document.querySelector('.status-right');
  const btn = document.createElement('span');
  btn.className = 'status-item status-item-btn';
  btn.textContent = '📎 Copy Name';
  btn.addEventListener('click', () => {
    const file = PiPilot.editor?.getActiveFile?.();
    if (file) {
      const name = file.split(/[\\/]/).pop();
      navigator.clipboard.writeText(name);
      bus.emit('toast:show', { message: 'Copied: ' + name, type: 'ok' });
    }
  });
  statusBar?.appendChild(btn);
})(PiPilot, bus, api, state);
```
