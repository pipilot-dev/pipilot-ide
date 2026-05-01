# Keyboard Shortcuts

`Mod` = `Ctrl` on Windows/Linux, `Cmd` on macOS.

## File

| Shortcut | Action |
|----------|--------|
| `Mod+N`              | New file |
| `Mod+O`              | Open folder |
| `Mod+S`              | Save current file |
| `Mod+Shift+S`        | Save all files |
| `Mod+W`              | Close current tab |
| `Mod+Shift+T`        | Reopen last closed tab |
| `Mod+P`              | Quick open file (fuzzy) |
| `Mod+Shift+P`        | Command palette |

## Editing

| Shortcut | Action |
|----------|--------|
| `Mod+/`              | Toggle line comment |
| `Mod+Shift+/`        | Toggle block comment |
| `Mod+D`              | Add next match to multi-cursor |
| `Mod+L`              | Select current line |
| `Alt+↑` / `Alt+↓`    | Move line up / down |
| `Alt+Shift+↑` / `↓`  | Copy line up / down |
| `Mod+Shift+K`        | Delete line |
| `Mod+]` / `Mod+[`    | Indent / outdent |
| `Mod+F`              | Find in file |
| `Mod+H`              | Find + replace |
| `Mod+Shift+F`        | Find across project |
| `Mod+G`              | Go to line |

## Navigation

| Shortcut | Action |
|----------|--------|
| `Mod+B`              | Toggle sidebar |
| `Mod+J`              | Toggle bottom panel |
| `Mod+Tab` / `Shift+` | Cycle through open tabs |
| `Mod+1..9`           | Jump to tab N |
| `F12`                | Go to definition (when LSP is wired) |
| `Alt+←` / `Alt+→`    | Navigate back / forward |

## AI Agent (chat panel)

| Shortcut | Action |
|----------|--------|
| `Mod+I`              | Focus chat input |
| `Enter`              | Send message |
| `Shift+Enter`        | Newline in chat input |
| `Esc`                | Stop streaming response |
| `Mod+K`              | New chat session |

## Debugger

| Shortcut | Action |
|----------|--------|
| `F5`                 | Start debug / continue if paused |
| `Shift+F5`           | Stop debug session |
| `F9`                 | Toggle breakpoint at cursor |
| `F10`                | Step over |
| `F11`                | Step into |
| `Shift+F11`          | Step out |
| Right-click gutter   | Conditional breakpoint / logpoint menu |

## Settings & Help

| Shortcut | Action |
|----------|--------|
| `Mod+,`              | Open Settings tab |
| `Mod+Shift+,`        | Open Help tab |
| `F1`                 | Help / about |

## Status bar

| Shortcut | Action |
|----------|--------|
| Click problem count  | Open Problems pane |
| Click branch name    | Switch / create branch |
| Click LF/CRLF        | Toggle line endings |
| Click language       | Change syntax mode |
| Click position       | Go to line |

## Bottom panel tabs

| Tab | Shortcut | What it shows |
|-----|----------|---------------|
| Terminal | `` Mod+` ``  | xterm with your default shell, profile picker |
| Problems | —            | TS/JSON/lint errors with severity dots |
| Preview  | —            | Inline web preview when a dev server is running |
| Deploy   | —            | Cloud deploy connectors quick-access |
| Debug    | —            | Call stack / scopes / console during a debug session |

## Customising shortcuts

Shortcuts aren't yet user-rebindable from the UI. To customise: edit `renderer/shortcuts.js` (registration site) and any per-feature handlers (`renderer/chat.js`, `renderer/debug.js`). A proper keybindings.json reader is on the roadmap.
