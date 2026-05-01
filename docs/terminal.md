# Terminal

xterm.js + node-pty inside a bottom-panel tab. Real PTY, full color, mouse support, hyperlink detection.

## Opening + closing

- **`` Ctrl+` ``** — toggle the terminal panel.
- Bottom panel → **Terminal** tab.
- **`+`** in the terminal tab strip — new terminal in the same panel.
- **`×`** on a tab — close it (kills the underlying PTY).

Multiple terminals are stacked in the tab strip — switch between them with click or `Ctrl+PageUp` / `Ctrl+PageDown`.

## Shell profile

- **`Settings → Terminal → Default Shell`** — picks which shell new terminals start with.
- The dropdown lists every shell PiPilot detected on your system at boot:
  - **Windows** — `cmd.exe`, `powershell.exe`, `pwsh.exe`, Git Bash if installed, WSL if available.
  - **macOS** — `zsh` (default), `bash`, plus any others on `$PATH`.
  - **Linux** — `bash` (default), `zsh`, `fish`, plus any in `/etc/shells`.
- Per-terminal override: top-right of the terminal panel → shell picker → start a new terminal with a different profile.

The default profile is also used by the agent when it shells out via `Bash` or `run_in_terminal`.

## Font + appearance

- **`Settings → Terminal → Terminal Font Size`** — pixels. Live-applies to every running terminal.
- Font family: hard-coded to `JetBrains Mono, Cascadia Code, monospace` (xterm doesn't share `--font-mono` with the rest of the IDE).
- ANSI colors are theme-aware — switching color themes also recolors the terminal palette to match (Dracula gets pink magenta, GitHub Dark gets the GitHub green, etc.).

## Working directory

New terminals open in the current project root. If no project is open, they fall back to your home directory.

The agent's `Bash` tool runs in the project root unless told otherwise.

## Running commands

Just type. Hyperlinks in output (URLs, file paths) are clickable — `Ctrl+Click` opens URLs in the embedded browser, file paths in the editor.

Common shortcuts:

| Shortcut | Action |
|----------|--------|
| `Ctrl+C`   | Send SIGINT (interrupt) |
| `Ctrl+D`   | EOF / exit shell |
| `Ctrl+L`   | Clear screen (or your shell's clear) |
| `Ctrl+R`   | History search (in supporting shells) |
| `↑` / `↓`  | History navigation |

The Web Links addon detects URLs automatically. The Fit addon resizes the PTY to match the panel size whenever you resize.

## Copy / paste

- **Select** with the mouse → automatic copy on selection.
- **`Ctrl+Shift+C`** / **`Cmd+C`** — copy selection.
- **`Ctrl+Shift+V`** / **`Cmd+V`** — paste.
- Right-click → context menu with copy / paste / clear.

xterm's text selection respects word + line boundaries — double-click selects a word, triple-click selects a line.

## Tips

- The terminal is the right tool for one-off git commands not in the Source Control panel UI (rebase, cherry-pick, complex diffs).
- For interactive flows the agent can't drive (`vim`, `npm init`, OAuth logins), the terminal is the escape hatch.
- For commands you want the agent to run instead, ask in chat: "install eslint and configure it for this project" — saves the back-and-forth.
- xterm theme follows the IDE color theme automatically; if your custom theme has unusual ANSI colors, see [Themes](themes.md) for how to override the palette.

## Internals

- Backed by `node-pty` (native module — gets rebuilt for Electron via `electron-rebuild` in the postinstall).
- Each terminal is a separate PTY managed in the main process (`main/ipc-terminal.js`); the renderer just owns the xterm instance.
- Output streams over `terminal:data:<id>` IPC, throttled by xterm's internal write queue.
- PTY resize fires when the terminal panel resizes — debounced to 60ms so a continuous drag doesn't spam the kernel.
